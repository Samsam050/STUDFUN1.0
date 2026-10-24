/* Visaren: PDF:en som den ser ut, en sida i taget, med Tudi bredvid.
   När studenten frågar Tudi skickas sidnumret, sidans text och en bild av sidan med.
   Bilden ritas här i webbläsaren, inte på servern. */
import { h, ikon } from "../dom.js";
import { api, navigera } from "../app.js";
import { oppnaPdf, ritaSida } from "../pdf.js";
import { samtal } from "../tudi.js";
import { kommIhagKurs } from "./fraga.js";

const ZOOM = [0.75, 1, 1.25, 1.5, 2];

export default async function visa(main, { kursId, filId }) {
  let dok, kurs;
  try {
    [dok, kurs] = await Promise.all([api("GET", `/api/dokument/${filId}`), api("GET", `/api/kurser/${kursId}`)]);
    if (dok.kursId !== kurs.id) throw Object.assign(new Error(), { status: 404 });
  } catch (e) {
    main.className = "sf-ensam";
    main.append(h("section", { class: "sf-ruta sf-ruta--stor" },
      h("h1", {}, e.status === 404 ? "Filen finns inte" : "Filen gick inte att öppna"),
      h("p", {}, e.status === 404 ? "Den kan ha raderats." : "Det kan bero på anslutningen. Försök igen om en stund."),
      h("a", { href: `/kurser/${kursId}`, class: "sf-btn sf-btn--primar" }, "Till kursen")));
    return;
  }
  document.title = `${dok.titel} · StudFun`;
  kommIhagKurs(kurs.id);

  const fran = Number(new URLSearchParams(location.search).get("sida"));
  let sida = Math.min(Math.max(fran || dok.senastSida || 1, 1), dok.sidor);
  let zoom = 1;
  let pdf = null, sidtexter = [];

  const sidaAv = h("span", { class: "sf-etikett", "aria-live": "polite" });
  const forra = h("button", { type: "button", class: "sf-btn sf-btn--sekundar sf-btn--liten" }, ikon("tillbaka", 20), "Föregående");
  const nasta = h("button", { type: "button", class: "sf-btn sf-btn--sekundar sf-btn--liten" }, "Nästa", ikon("pil", 20));
  const sidFalt = h("input", { id: "v-sida", class: "sf-falt sf-sidfalt", type: "text", inputmode: "numeric", autocomplete: "off" });
  const zoomText = h("span", { class: "sf-zoom-text" });
  const lasLank = h("a", { class: "sf-btn sf-btn--accent sf-btn--liten" }, ikon("dokument", 20), "Läsläge");
  const canvas = h("canvas", { "aria-hidden": "true" });
  const sidtext = h("div", { class: "sf-dold" });
  const papper = h("div", { class: "sf-papper", tabindex: "0", role: "group", "aria-roledescription": "sida" }, canvas, sidtext);
  const status = h("div", { class: "sf-visare-status" });
  const yta = h("div", { class: "sf-visare-yta" }, status, papper);

  forra.addEventListener("click", () => ga(sida - 1));
  nasta.addEventListener("click", () => ga(sida + 1));
  papper.addEventListener("keydown", e => {
    if (e.key === "ArrowLeft") { e.preventDefault(); ga(sida - 1); }
    if (e.key === "ArrowRight") { e.preventDefault(); ga(sida + 1); }
  });
  let startX = null;
  papper.addEventListener("touchstart", e => { startX = e.touches.length === 1 ? e.touches[0].clientX : null; }, { passive: true });
  papper.addEventListener("touchend", e => {
    if (startX == null || zoom > 1) return; // inzoomad sida flyttas med svep, då bläddrar vi inte
    const dx = e.changedTouches[0].clientX - startX;
    if (Math.abs(dx) > 60) ga(sida + (dx < 0 ? 1 : -1));
  });
  const zooma = steg => { zoom = ZOOM[Math.min(ZOOM.length - 1, Math.max(0, ZOOM.indexOf(zoom) + steg))]; rita(); };

  let sparTimer = 0;
  function ga(nr) {
    const ny = Math.min(Math.max(Number(nr) || 1, 1), dok.sidor); // ett tal utanför PDF:en ger första eller sista sidan
    if (ny === sida && pdf) return rita();
    sida = ny;
    history.replaceState(null, "", `/kurser/${kurs.id}/visa/${dok.id}?sida=${sida}`);
    rita();
    clearTimeout(sparTimer);
    sparTimer = setTimeout(() => api("PUT", `/api/dokument/${dok.id}/position`, { sida }).catch(() => {}), 1000);
  }

  async function rita() {
    sidaAv.textContent = `Sida ${sida} av ${dok.sidor}`;
    sidFalt.value = String(sida);
    forra.disabled = sida <= 1;
    nasta.disabled = sida >= dok.sidor;
    zoomText.textContent = `${Math.round(zoom * 100)} %`;
    lasLank.href = `/kurser/${kurs.id}/las/${dok.id}?sida=${sida}`;
    papper.setAttribute("aria-label", `Sida ${sida} av ${dok.sidor}. Texten på sidan kan läsas upp i läsläget.`);
    sidtext.textContent = sidtexter[sida - 1] || "";
    duArPa.replaceChildren(ikon("dokument", 20), `Du är på sida ${sida}`);
    visaTudi.lastChild.textContent = `Fråga Tudi om sida ${sida}`;
    if (!pdf) return;
    status.replaceChildren(h("p", { role: "status", class: "sf-hjalp" }, `Hämtar sida ${sida} …`));
    try {
      await ritaSida(pdf, sida, canvas, Math.min(yta.clientWidth - 32, 900), zoom);
      status.replaceChildren();
    } catch (e) {
      if (e && e.name === "RenderingCancelledException") return;
      visaFel();
    }
  }

  function visaFel() {
    status.replaceChildren(h("div", { class: "sf-medd-stor sf-medd-stor--fel sf-ruta", role: "alert" },
      h("div", { class: "sf-rad" }, ikon("fel", 28), h("p", { class: "sf-medd-rubrik" }, `Sida ${sida} går inte att visa`)),
      h("p", {}, "Det kan bero på anslutningen. Försök igen, eller läs texten på sidan i läsläget."),
      h("div", { class: "sf-knapprad" },
        h("button", { type: "button", class: "sf-btn sf-btn--primar", onclick: ladda }, "Försök igen"),
        h("a", { href: `/kurser/${kurs.id}/las/${dok.id}?sida=${sida}`, class: "sf-btn sf-btn--sekundar" }, "Öppna i läsläget"))));
  }

  async function ladda() {
    status.replaceChildren(h("p", { role: "status", class: "sf-hjalp" }, `Hämtar sida ${sida} …`));
    try {
      const svar = await fetch(`/api/dokument/${dok.id}/fil`);
      if (!svar.ok) throw new Error();
      [pdf, { sidor: sidtexter }] = await Promise.all([
        oppnaPdf(new Uint8Array(await svar.arrayBuffer())),
        api("GET", `/api/dokument/${dok.id}/sidor`).catch(() => ({ sidor: [] })),
      ]);
      rita();
    } catch { visaFel(); }
  }

  let storlekTimer = 0;
  const vidStorlek = () => { clearTimeout(storlekTimer); storlekTimer = setTimeout(() => { if (main.isConnected) rita(); }, 200); };
  addEventListener("resize", vidStorlek);
  const stad = new MutationObserver(() => {
    if (main.isConnected) return;
    removeEventListener("resize", vidStorlek);
    tudi.stang();
    pdf?.loadingTask.destroy();
    stad.disconnect();
  });
  stad.observe(document.getElementById("app"), { childList: true });

  /* Tudi-panelen. Öppen från början på dator, hopfälld på mobil. */
  async function sidbild() {
    if (!pdf) return undefined;
    const c = document.createElement("canvas");
    await ritaSida(pdf, sida, c, 1100 / Math.min(window.devicePixelRatio || 1, 2)); // ungefär 1100 px bred bild
    return c.toDataURL("image/jpeg", 0.75);
  }
  const tudi = samtal({
    kursId: kurs.id,
    serSidan: true,
    etikett: "Din fråga om sidan",
    platshallare: "Till exempel: Vad visar bilden?",
    tomText: "Fråga något om sidan du tittar på. Tudi ser sidan och svarar utifrån ditt material.",
    kontext: async () => ({ sida: { dokId: dok.id, nr: sida }, bild: await sidbild().catch(() => undefined) }),
    oppnaKalla: k => (k.dokId === dok.id ? ga(k.sida) : navigera(`/kurser/${kurs.id}/visa/${k.dokId}?sida=${k.sida}`)),
  });
  const duArPa = h("p", { class: "sf-du-ar-pa", "aria-live": "polite" });
  const forklara = h("button", { type: "button", class: "sf-btn sf-btn--accent", onclick: () => tudi.skicka({ fraga: "Förklara den här sidan." }, "Förklara den här sidan.", false) }, "Förklara den här sidan");
  const fallIhop = h("button", { type: "button", class: "sf-btn sf-btn--sekundar sf-btn--liten", "aria-expanded": "true", "aria-controls": "tudi-panel" }, "Fäll ihop");
  const visaTudi = h("button", { type: "button", class: "sf-btn sf-btn--primar sf-visa-tudi", "aria-expanded": "false", "aria-controls": "tudi-panel" },
    h("img", { src: "/bilder/tudi-ansikte.png", alt: "", class: "sf-tudi-ansikte sf-tudi-ansikte--liten" }), h("span", {}, "Fråga Tudi"));
  const panel = h("aside", { id: "tudi-panel", class: "sf-tudi-panel", "aria-label": "Tudi" },
    h("div", { class: "sf-rad-mellan" },
      h("div", { class: "sf-rad sf-rad--tat" }, h("img", { src: "/bilder/tudi-ansikte.png", alt: "", class: "sf-tudi-ansikte" }), h("span", { class: "sf-rad-rubrik" }, "Tudi")),
      fallIhop),
    duArPa, forklara, tudi.el);
  let panelOppen = matchMedia("(min-width: 1024px)").matches;
  function ritaPanel(fokus) {
    panel.hidden = !panelOppen;
    visaTudi.hidden = panelOppen;
    if (fokus) (panelOppen ? forklara : visaTudi).focus();
  }
  fallIhop.addEventListener("click", () => { panelOppen = false; ritaPanel(true); });
  visaTudi.addEventListener("click", () => { panelOppen = true; ritaPanel(true); tudi.ladda(); });
  ritaPanel(false);
  if (panelOppen) tudi.ladda();

  const form = h("form", { class: "sf-rad sf-rad--tat", novalidate: true },
    h("label", { for: "v-sida", class: "sf-etikett" }, "Gå till sida"), sidFalt,
    h("button", { type: "submit", class: "sf-btn sf-btn--sekundar sf-btn--liten" }, "Gå"));
  form.addEventListener("submit", e => { e.preventDefault(); ga(sidFalt.value); papper.focus(); });

  main.className = "sf-visare";
  main.append(
    h("header", { class: "sf-visare-huvud" },
      h("div", { class: "sf-rad sf-rad--tat sf-vaxer" },
        h("a", { href: `/kurser/${kurs.id}`, class: "sf-tillbaka" }, ikon("tillbaka", 20), kurs.namn),
        h("div", { class: "sf-stapel sf-visare-titel" }, h("h1", {}, dok.titel), sidaAv)),
      h("div", { class: "sf-rad sf-rad--tat", role: "toolbar", "aria-label": "Bläddra och zooma" },
        h("div", { class: "sf-rad sf-rad--tat" }, forra, form, nasta),
        h("div", { class: "sf-rad sf-rad--tat", role: "group", "aria-label": "Zoom" },
          h("button", { type: "button", class: "sf-btn sf-btn--sekundar sf-btn--liten sf-btn--ruta", "aria-label": "Zooma ut", onclick: () => zooma(-1) }, "−"),
          zoomText,
          h("button", { type: "button", class: "sf-btn sf-btn--sekundar sf-btn--liten sf-btn--ruta", "aria-label": "Zooma in", onclick: () => zooma(1) }, "+")),
        lasLank, visaTudi)),
    h("div", { class: "sf-visare-kropp" }, yta, panel));
  rita();
  ladda();
  api("PUT", `/api/dokument/${dok.id}/position`, { sida }).catch(() => {}); // filen räknas som påbörjad
}
