/* Visaren: PDF:en som den ser ut, en sida i taget, med Tudi bredvid.
   Läs upp läser sidan studenten är på, och ordet som läses markeras direkt på sidan.
   När sidan är slut fortsätter uppläsningen på nästa sida. Tempot väljs i Inställningar.
   Ovanpå sidan ligger ett lager med ett osynligt ord per ord i PDF:en: det är dem som markeras,
   som går att trycka på (läs upp, förklara, ge exempel, läs härifrån) och som skärmläsare läser.
   När studenten frågar Tudi skickas sidnumret med. Förklara den här sidan skickar en bild av sidan bara när
   sidan har lite text eller mycket bilder, eller när studenten trycker Titta på bilden också. */
import { h, ikon } from "../dom.js";
import { api, app, navigera } from "../app.js";
import { oppnaPdf, ritaSida, textrutor, sidtext, bildAndel } from "../pdf.js";
import { svarElement, talbar } from "../svar.js";
import { ordFranText, meningar } from "../delar.js";
import * as ljud from "../upplasning.js";
import { samtal } from "../tudi.js";
import { kommIhagKurs } from "./fraga.js";

const ZOOM = [0.75, 1, 1.25, 1.5, 2];
/* Regeln för när Förklara den här sidan skickar en bild av sidan */
const BILD_UNDER_TECKEN = 400;
const BILD_OVER_ANDEL = 0.3;
const SATT = [["enklare", "Enklare"], ["steg", "Steg för steg"], ["exempel", "Ge ett exempel"], ["annat", "Förklara på ett annat sätt"]];
/* Hur länge ett ord tar att säga, ungefär: bokstäverna plus en paus efter skiljetecken.
   shortcut: markeringen räknas fram ur ljudets längd, inte ur talmotorns ordgränser. Byt om OpenAI börjar ge tidsstämplar för uppläst ljud. */
const vikt = ord => ord.replace(/[^\p{L}\p{N}]/gu, "").length + 2 + (/[.!?:;]["”’)]*$/.test(ord) ? 6 : /,$/.test(ord) ? 3 : 0);
const rent = ord => ord.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
/* Bokstäverna är olika breda. Ett vanligt PDF-typsnitt ger ordens plats mycket närmare än att räkna bokstäver. */
const mattare = document.createElement("canvas").getContext("2d");
mattare.font = "100px Helvetica, Arial, sans-serif";
const matt = t => mattare.measureText(t).width;

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
  let pdf = null;

  const sidaAv = h("span", { class: "sf-etikett", "aria-live": "polite" });
  const forra = h("button", { type: "button", class: "sf-btn sf-btn--sekundar sf-btn--liten" }, ikon("tillbaka", 20), "Föregående");
  const nasta = h("button", { type: "button", class: "sf-btn sf-btn--sekundar sf-btn--liten" }, "Nästa", ikon("pil", 20));
  const sidFalt = h("input", { id: "v-sida", class: "sf-falt sf-sidfalt", type: "text", inputmode: "numeric", autocomplete: "off" });
  const zoomText = h("span", { class: "sf-zoom-text" });
  const spelKnapp = h("button", { type: "button", class: "sf-btn sf-btn--accent sf-btn--liten sf-spelknapp" });
  const canvas = h("canvas", { "aria-hidden": "true" });
  const ordlager = h("div", { class: "sf-ordlager", role: "group", "aria-label": "Texten på sidan. Tryck på ett ord för att få det uppläst eller förklarat." });
  const meny = h("div", { class: "sf-ordmeny", role: "dialog", hidden: true });
  const papper = h("div", { class: "sf-papper", tabindex: "0", role: "group", "aria-roledescription": "sida" }, canvas, ordlager, meny);
  const status = h("div", { class: "sf-visare-status" });
  const ljudFel = h("div", { class: "sf-visare-status" });
  const yta = h("div", { class: "sf-visare-yta" }, status, ljudFel, papper);

  forra.addEventListener("click", () => ga(sida - 1));
  nasta.addEventListener("click", () => ga(sida + 1));
  papper.addEventListener("keydown", e => {
    if (e.target !== papper) return; // piltangenterna på ett ord flyttar mellan orden
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

  /* Orden på sidan som visas nu. ordEl[i] är ordets rutor, där den första är en knapp. */
  let ord = [], M = [], ordEl = [], aktiv = 0, valt = -1, lases = -1;
  let ritad = Promise.resolve();

  let sparTimer = 0;
  /* fortsatt: uppläsningen går vidare till den här sidan, annars stoppas den */
  function ga(nr, fortsatt = false) {
    const ny = Math.min(Math.max(Number(nr) || 1, 1), dok.sidor); // ett tal utanför PDF:en ger första eller sista sidan
    if (!fortsatt) stoppa();
    if (ny === sida && pdf) return rita();
    sida = ny;
    rensaForklaring();
    history.replaceState(null, "", `/kurser/${kurs.id}/visa/${dok.id}?sida=${sida}`);
    clearTimeout(sparTimer);
    sparTimer = setTimeout(() => api("PUT", `/api/dokument/${dok.id}/position`, { sida }).catch(() => {}), 1000);
    return rita();
  }

  function rita() {
    sidaAv.textContent = `Sida ${sida} av ${dok.sidor}`;
    sidFalt.value = String(sida);
    forra.disabled = sida <= 1;
    nasta.disabled = sida >= dok.sidor;
    zoomText.textContent = `${Math.round(zoom * 100)} %`;
    papper.setAttribute("aria-label", `Sida ${sida} av ${dok.sidor}`);
    duArPa.replaceChildren(ikon("dokument", 20), `Du är på sida ${sida}`);
    visaTudi.lastChild.textContent = `Fråga Tudi om sida ${sida}`;
    if (!pdf) return ritad;
    const nr = sida;
    status.replaceChildren(h("p", { role: "status", class: "sf-hjalp" }, `Hämtar sida ${sida} …`));
    ritad = (async () => {
      try {
        const viewport = await ritaSida(pdf, nr, canvas, Math.min(yta.clientWidth - 32, 900), zoom);
        const nyaOrd = ordFranText(await textrutor(pdf, nr, viewport), matt);
        if (nr !== sida) return;
        ritaOrd(nyaOrd);
        status.replaceChildren();
      } catch (e) {
        if (e && e.name === "RenderingCancelledException") return;
        visaFel();
      }
    })();
    return ritad;
  }

  /* Lägger ett osynligt ord ovanpå varje ord i PDF:en */
  function ritaOrd(nyaOrd) {
    stangMeny(false);
    ord = nyaOrd;
    M = meningar(ord);
    aktiv = 0; valt = -1; lases = -1;
    ordEl = ord.map((o, i) => o.rutor.map((r, k) => {
      const el = h(k === 0 ? "button" : "span", k === 0 ? { type: "button", class: "sf-pdf-ord", tabindex: i === 0 ? "0" : "-1", "aria-expanded": "false" } : { class: "sf-pdf-ord", "aria-hidden": "true" },
        k === 0 ? o.text : "");
      Object.assign(el.style, { left: `${r.x}px`, top: `${r.y}px`, width: `${Math.max(r.b, 4)}px`, height: `${r.h}px` });
      if (k === 0) el.addEventListener("click", () => { satAktiv(i, false); oppnaMeny(i); });
      return el;
    }));
    ordlager.replaceChildren(...ordEl.flat());
    spelKnapp.disabled = !ord.length && sida >= dok.sidor;
  }
  ordlager.addEventListener("keydown", e => {
    const flytt = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: 1, ArrowUp: -1, Home: -Infinity, End: Infinity }[e.key];
    if (flytt === undefined || !ord.length) return;
    e.preventDefault();
    satAktiv(Math.min(ord.length - 1, Math.max(0, aktiv + flytt)), true);
  });
  meny.addEventListener("keydown", e => { if (e.key === "Escape") { e.preventDefault(); stangMeny(); } });

  function satAktiv(i, fokus) {
    if (ordEl[aktiv]) ordEl[aktiv][0].tabIndex = -1;
    aktiv = i;
    ordEl[i][0].tabIndex = 0;
    if (fokus) ordEl[i][0].focus();
  }
  const meningMed = i => M.findIndex(m => i >= m.fran && i <= m.till);
  const meningText = mi => ord.slice(M[mi].fran, M[mi].till + 1).map(o => o.text).join(" ");

  /* Menyn för ett ord. Esc stänger och fokus går tillbaka till ordet. */
  function oppnaMeny(i) {
    stangMeny(false);
    valt = i;
    const b = ordEl[i][0];
    const w = rent(ord[i].text) || ord[i].text;
    ordEl[i].forEach(el => el.classList.add("sf-pdf-ord--vald"));
    b.setAttribute("aria-expanded", "true");
    const lasKnapp = h("button", { type: "button", class: "sf-btn sf-btn--sekundar sf-btn--liten" }, ikon("spela", 20), "Läs upp");
    const info = h("div", { class: "sf-ordmeny-info", role: "status" });
    lasKnapp.addEventListener("click", async () => {
      stoppa();
      try { await ljud.spela(await ljud.hamta(dok.id, w), ljud.TEMPO[app.jag.installningar.tempo] || 1); }
      catch (e) { info.textContent = e.message; }
    });
    /* Förklara och Ge exempel: Tudi får ordet och meningen det står i */
    const fraga = typ => async () => {
      info.textContent = "Tudi tänker …";
      try {
        const r = await api("POST", `/api/kurser/${kurs.id}/ord`, { ord: w, typ, mening: meningText(meningMed(i)).slice(0, 800), sida: { dokId: dok.id, nr: sida } });
        info.replaceChildren(...svarElement(r.svar));
      } catch (e) { info.textContent = e.message; }
    };
    meny.setAttribute("aria-label", `Val för ordet ${w}`);
    meny.replaceChildren(
      h("div", { class: "sf-rad-mellan" }, h("span", { class: "sf-ordmeny-ord" }, w),
        h("button", { type: "button", class: "sf-btn sf-btn--liten sf-btn--text", onclick: () => stangMeny() }, "Stäng")),
      h("div", { class: "sf-knapprad" }, lasKnapp,
        h("button", { type: "button", class: "sf-btn sf-btn--sekundar sf-btn--liten", onclick: fraga("forklara") }, "Förklara"),
        h("button", { type: "button", class: "sf-btn sf-btn--sekundar sf-btn--liten", onclick: fraga("exempel") }, "Ge exempel"),
        h("button", { type: "button", class: "sf-btn sf-btn--sekundar sf-btn--liten", onclick: () => lasFran(meningMed(i)) }, "Läs härifrån")),
      info);
    const r = ord[i].rutor[0];
    meny.style.top = `${r.y + r.h + 8}px`;
    meny.style.left = `${Math.max(0, Math.min(r.x - 8, papper.clientWidth - 360))}px`;
    meny.hidden = false;
    lasKnapp.focus();
  }
  function stangMeny(fokusTillbaka = true) {
    if (meny.hidden) return;
    meny.hidden = true;
    (ordEl[valt] || []).forEach(el => el.classList.remove("sf-pdf-ord--vald"));
    const b = ordEl[valt]?.[0];
    if (b) { b.setAttribute("aria-expanded", "false"); if (fokusTillbaka) b.focus(); }
    valt = -1;
  }

  /* Uppläsningen, mening för mening. Nästa mening hämtas medan den här spelas. */
  let korning = 0, spelar = false;
  function ritaKnapp() { spelKnapp.replaceChildren(ikon(spelar ? "paus" : "spela", 20), spelar ? "Pausa" : "Läs upp"); }
  function markera(i) {
    if (i === lases) return;
    (ordEl[lases] || []).forEach(el => el.classList.remove("sf-pdf-ord--lases"));
    lases = i;
    if (!ordEl[i]) return;
    ordEl[i].forEach(el => el.classList.add("sf-pdf-ord--lases"));
    const r = ordEl[i][0].getBoundingClientRect(), y = yta.getBoundingClientRect();
    if (r.top < y.top + 40 || r.bottom > y.bottom - 40) ordEl[i][0].scrollIntoView({ block: "center", inline: "nearest" });
  }
  function stoppa() {
    korning++;
    spelar = false;
    ljud.stoppa();
    markera(-1);
    ritaKnapp();
  }
  spelKnapp.addEventListener("click", () => {
    if (spelar) { ljud.pausa(); spelar = false; return ritaKnapp(); }
    if (ljud.arPausad() && lases >= 0) { spelar = true; ljud.fortsatt(); return ritaKnapp(); }
    lasFran(Math.max(0, meningMed(valt >= 0 ? valt : aktiv)));
  });
  async function lasFran(mi) {
    const mitt = ++korning;
    spelar = true;
    ritaKnapp();
    ljudFel.replaceChildren();
    stangMeny(false);
    for (;;) {
      for (let i = mi; i < M.length; i++) {
        if (M[i + 1]) ljud.hamta(dok.id, meningText(i + 1)).catch(() => {});
        const text = meningText(i);
        let url;
        try { url = await ljud.hamta(dok.id, text); }
        catch (e) { if (mitt === korning) { stoppa(); visaLjudFel(e.message, i); } return; }
        if (mitt !== korning) return;
        const vikter = ord.slice(M[i].fran, M[i].till + 1).map(o => vikt(o.text));
        const summa = vikter.reduce((a, b) => a + b, 0);
        const forsta = M[i].fran;
        try {
          await ljud.spela(url, ljud.TEMPO[app.jag.installningar.tempo] || 1, andel => {
            let acc = 0, k = 0;
            while (k < vikter.length - 1 && (acc + vikter[k]) / summa < andel) acc += vikter[k++];
            markera(forsta + k);
          });
        } catch (e) { if (mitt === korning) { stoppa(); visaLjudFel(e.message, i); } return; }
        if (mitt !== korning) return;
      }
      if (sida >= dok.sidor) break;
      await ga(sida + 1, true); // när sidan är slut fortsätter uppläsningen på nästa sida
      if (mitt !== korning) return;
      mi = 0;
    }
    stoppa();
  }
  function visaLjudFel(besked, mening) {
    const standard = besked === "Uppläsningen fungerar inte just nu.";
    ljudFel.replaceChildren(h("div", { class: "sf-medd sf-medd--fel sf-medd--knapp", role: "alert" }, ikon("fel"),
      h("p", { class: "sf-vaxer" }, standard ? "Uppläsningen fungerar inte just nu. Du kan fortsätta läsa själv under tiden." : besked),
      h("button", { type: "button", class: "sf-btn sf-btn--sekundar sf-btn--liten", onclick: () => lasFran(mening) }, "Försök igen")));
  }

  function visaFel() {
    status.replaceChildren(h("div", { class: "sf-medd-stor sf-medd-stor--fel sf-ruta", role: "alert" },
      h("div", { class: "sf-rad" }, ikon("fel", 28), h("p", { class: "sf-medd-rubrik" }, `Sida ${sida} går inte att visa`)),
      h("p", {}, "Det kan bero på anslutningen. Försök igen om en stund."),
      h("button", { type: "button", class: "sf-btn sf-btn--primar sf-btn--sjalv", onclick: ladda }, "Försök igen")));
  }

  async function ladda() {
    status.replaceChildren(h("p", { role: "status", class: "sf-hjalp" }, `Hämtar sida ${sida} …`));
    try {
      const svar = await fetch(`/api/dokument/${dok.id}/fil`);
      if (!svar.ok) throw new Error();
      pdf = await oppnaPdf(new Uint8Array(await svar.arrayBuffer()));
      rita();
    } catch { visaFel(); }
  }

  let storlekTimer = 0;
  const vidStorlek = () => { clearTimeout(storlekTimer); storlekTimer = setTimeout(() => { if (main.isConnected) rita(); }, 200); };
  addEventListener("resize", vidStorlek);
  const stad = new MutationObserver(() => {
    if (main.isConnected) return;
    stoppa(); // inget ljud ska fortsätta när studenten har lämnat sidan
    removeEventListener("resize", vidStorlek);
    tudi.stang();
    pdf?.loadingTask.destroy();
    stad.disconnect();
  });
  stad.observe(document.getElementById("app"), { childList: true });

  /* Tudi-panelen. Öppen från början på dator, hopfälld på mobil. */
  async function sidbild(nr = sida) {
    if (!pdf) return undefined;
    const c = document.createElement("canvas");
    await ritaSida(pdf, nr, c, 1200 / Math.min(window.devicePixelRatio || 1, 2)); // 1 200 px bred bild
    return c.toDataURL("image/jpeg", 0.75);
  }
  /* Bild behövs när sidan har under 400 tecken text eller när bilder täcker mer än 30 % av den */
  async function behoverBild(nr) {
    if (!pdf) return false;
    const tecken = (await sidtext(pdf, nr)).replace(/\s/g, "").length;
    return tecken < BILD_UNDER_TECKEN || (await bildAndel(pdf, nr)) > BILD_OVER_ANDEL;
  }

  /* Förklara den här sidan. Svaret visas ovanför samtalet och försvinner när studenten byter sida.
     Knapparna under svaret ber om samma sida på ett annat sätt. */
  const forklaringRuta = h("div", { class: "sf-forklaring", "aria-live": "polite" });
  let forklaring = null, forklarar = false, forklaringSpelas = false;
  function rensaForklaring() {
    if (forklaringSpelas) ljud.stoppa();
    forklaring = null;
    forklaringRuta.replaceChildren();
  }
  async function forklaraSida({ satt, tittaPaBilden = false } = {}) {
    if (forklarar) return;
    forklarar = true;
    const nr = sida;
    forklaringRuta.replaceChildren(h("div", { class: "sf-medd-tudi", role: "status" },
      h("p", { class: "sf-bubbla sf-bubbla--tanker" }, tittaPaBilden ? "Tudi tittar på bilden av sidan …" : `Tudi läser sida ${nr} …`)));
    try {
      const medBild = tittaPaBilden || (satt ? forklaring.bild : await behoverBild(nr).catch(() => false));
      const bild = medBild ? await sidbild(nr).catch(() => undefined) : undefined;
      const r = await api("POST", `/api/dokument/${dok.id}/sidor/${nr}/forklara`, { satt, forra: satt ? forklaring.nyckel : undefined, bild });
      if (nr !== sida) return;
      forklaring = r;
      visaForklaring(r);
    } catch (e) {
      if (nr !== sida) return;
      forklaringRuta.replaceChildren(h("div", { class: "sf-medd sf-medd--fel sf-medd--knapp", role: "alert" }, ikon("fel"),
        h("p", { class: "sf-vaxer" }, e.message),
        e.status !== 429 && h("button", { type: "button", class: "sf-btn sf-btn--sekundar sf-btn--liten", onclick: () => forklaraSida({ satt, tittaPaBilden }) }, "Försök igen")));
    } finally { forklarar = false; }
  }
  function visaForklaring(r) {
    const las = h("button", { type: "button", class: "sf-btn sf-btn--sekundar sf-btn--liten", "aria-pressed": "false" });
    const ritaLas = pa => { las.replaceChildren(ikon(pa ? "paus" : "hogtalare", 20), pa ? "Pausa" : "Läs upp"); las.setAttribute("aria-pressed", String(pa)); };
    ritaLas(false);
    las.addEventListener("click", async () => {
      if (forklaringSpelas) { ljud.stoppa(); return; }
      stoppa();
      forklaringSpelas = true; ritaLas(true);
      try { await ljud.spela(await ljud.hamtaSvar(talbar(r.text), dok.id), ljud.TEMPO[app.jag.installningar.tempo] || 1); }
      catch (e) { ljudFel.replaceChildren(h("div", { class: "sf-medd sf-medd--fel", role: "alert" }, ikon("fel"), h("p", {}, e.message))); }
      forklaringSpelas = false;
      if (las.isConnected) ritaLas(false);
    });
    const satt = SATT.find(([v]) => v === r.satt);
    forklaringRuta.replaceChildren(h("div", { class: "sf-medd-tudi" },
      h("div", { class: "sf-bubbla sf-bubbla--tudi" },
        h("span", { class: "sf-bubbla-namn" }, satt ? `Tudi · sida ${r.sida} · ${satt[1].toLowerCase()}` : `Tudi förklarar sida ${r.sida}`),
        svarElement(r.text, r.kallor, k => ga(k.sida)),
        h("div", { class: "sf-knapprad sf-foljd", role: "group", "aria-label": "Be Tudi förklara sidan på ett annat sätt" },
          SATT.map(([v, t]) => h("button", { type: "button", class: "sf-btn sf-btn--chip", onclick: () => forklaraSida({ satt: v }) }, t)),
          !r.bild && h("button", { type: "button", class: "sf-btn sf-btn--chip", onclick: () => forklaraSida({ tittaPaBilden: true }) }, "Titta på bilden också")),
        h("div", { class: "sf-bubbla-fot" }, las))));
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
  const forklara = h("button", { type: "button", class: "sf-btn sf-btn--accent", onclick: () => forklaraSida() }, "Förklara den här sidan");
  const fallIhop = h("button", { type: "button", class: "sf-btn sf-btn--sekundar sf-btn--liten", "aria-expanded": "true", "aria-controls": "tudi-panel" }, "Fäll ihop");
  const visaTudi = h("button", { type: "button", class: "sf-btn sf-btn--primar sf-visa-tudi", "aria-expanded": "false", "aria-controls": "tudi-panel" },
    h("img", { src: "/bilder/tudi-ansikte.png", alt: "", class: "sf-tudi-ansikte sf-tudi-ansikte--liten" }), h("span", {}, "Fråga Tudi"));
  const panel = h("aside", { id: "tudi-panel", class: "sf-tudi-panel", "aria-label": "Tudi" },
    h("div", { class: "sf-rad-mellan" },
      h("div", { class: "sf-rad sf-rad--tat" }, h("img", { src: "/bilder/tudi-ansikte.png", alt: "", class: "sf-tudi-ansikte" }), h("span", { class: "sf-rad-rubrik" }, "Tudi")),
      fallIhop),
    duArPa, forklara, forklaringRuta, tudi.el);
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

  ritaKnapp();
  main.className = "sf-visare";
  main.append(
    h("header", { class: "sf-visare-huvud" },
      h("div", { class: "sf-rad sf-rad--tat sf-vaxer" },
        h("a", { href: `/kurser/${kurs.id}`, class: "sf-tillbaka" }, ikon("tillbaka", 20), kurs.namn),
        h("div", { class: "sf-stapel sf-visare-titel" }, h("h1", {}, dok.titel), sidaAv)),
      h("div", { class: "sf-rad sf-rad--tat", role: "toolbar", "aria-label": "Läs upp, bläddra och zooma" },
        spelKnapp,
        h("div", { class: "sf-rad sf-rad--tat" }, forra, form, nasta),
        h("div", { class: "sf-rad sf-rad--tat", role: "group", "aria-label": "Zoom" },
          h("button", { type: "button", class: "sf-btn sf-btn--sekundar sf-btn--liten sf-btn--ruta", "aria-label": "Zooma ut", onclick: () => zooma(-1) }, "−"),
          zoomText,
          h("button", { type: "button", class: "sf-btn sf-btn--sekundar sf-btn--liten sf-btn--ruta", "aria-label": "Zooma in", onclick: () => zooma(1) }, "+")),
        visaTudi)),
    h("div", { class: "sf-visare-kropp" }, yta, panel));
  rita();
  ladda();
  api("PUT", `/api/dokument/${dok.id}/position`, { sida }).catch(() => {}); // filen räknas som påbörjad
}
