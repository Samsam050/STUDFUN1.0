/* Samtalet med Tudi. Används både på sidan Fråga Tudi och i panelen bredvid sidan i visaren.
   Allt hamnar i samtalet i tidsordning, också förklaringar av sidor från knappen Förklara den här sidan.
   Tudis svar visas alltid som text, aldrig som HTML. */
import { h, ikon } from "./dom.js";
import { api, app } from "./app.js";
import * as ljud from "./upplasning.js";
import { spelaIn, tillText } from "./mikrofon.js";
import { svarElement, talbar } from "./svar.js";

const FOLJD = [["enklare", "Enklare"], ["steg", "Steg för steg"], ["exempel", "Ge ett exempel"], ["annat", "Förklara på ett annat sätt"]];
const EXEMPEL = ["Vad är det viktigaste i materialet?", "Förklara ett svårt begrepp i materialet.", "Sammanfatta materialet i fem korta punkter."];

/*
  kursId       kursen frågorna gäller
  etikett      texten ovanför frågefältet. doljEtikett: bara för skärmläsare
  kontext(d)   (valfri) extra fält till frågan d, till exempel sidan studenten är på och en bild av den
  oppnaKalla   anropas med { dokId, titel, sida } när studenten trycker på en sidhänvisning
  tomText      visas när samtalet är tomt
  serSidan     Tudi vet vilken sida studenten är på, som i visaren
  bildAv(d, n) (valfri) en bild av sida n i dokument d, för Titta på bilden också. Utan den visas inte knappen.
*/
export function samtal({ kursId, etikett = "Din fråga till Tudi", doljEtikett = false, platshallare = "Till exempel: Hur länge gäller ett anbud?", kontext, oppnaKalla, tomText, serSidan = false, bildAv }) {
  const lista = h("ol", { class: "sf-samtal", "aria-label": "Samtal med Tudi" });
  const meddela = h("p", { class: "sf-dold", "aria-live": "polite" });
  const falt = h("textarea", { id: `fraga-${kursId}`, class: "sf-falt sf-fragefalt", rows: "2", placeholder: platshallare, maxlength: "1000" });
  const skickaKnapp = h("button", { type: "submit", class: "sf-btn sf-btn--primar" }, "Skicka", ikon("pil", 22));
  const mikKnapp = h("button", { type: "button", class: "sf-btn sf-btn--sekundar", "aria-pressed": "false" });
  const lyssnar = h("p", { class: "sf-lyssnar", role: "status", hidden: true });
  const form = h("form", { class: "sf-fragaform", novalidate: true },
    h("label", { for: falt.id, class: doljEtikett ? "sf-dold" : "sf-etikett-stor" }, etikett), lyssnar,
    h("div", { class: "sf-rad sf-rad--slut" }, falt, h("div", { class: "sf-knapprad" }, mikKnapp, skickaKnapp)));
  let upptagen = false, spelas = null;

  form.addEventListener("submit", e => {
    e.preventDefault();
    const text = falt.value.trim();
    if (!text) return falt.focus();
    skicka({ fraga: text }, text, true);
  });
  falt.addEventListener("keydown", e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); form.requestSubmit(); } });

  /* Mikrofonen: Tala in startar, Klar stoppar och skriver in texten i fältet */
  let inspelning = null;
  const ritaMik = (text, pa) => { mikKnapp.replaceChildren(ikon(pa ? "paus" : "mikrofon", 22), text); mikKnapp.setAttribute("aria-pressed", String(pa)); };
  ritaMik("Tala in", false);
  async function stoppaMik() {
    const r = inspelning; inspelning = null;
    ritaMik("Skriver ut …", false);
    mikKnapp.disabled = true;
    lyssnar.hidden = true;
    try {
      const text = await tillText(await r.stoppa());
      falt.value = [falt.value.trim(), text].filter(Boolean).join(" ");
      falt.focus();
    } catch (e) { visaFel(e.message); }
    mikKnapp.disabled = false;
    ritaMik("Tala in", false);
  }
  mikKnapp.addEventListener("click", async () => {
    if (inspelning) return stoppaMik();
    try { inspelning = await spelaIn(stoppaMik); }
    catch { return visaFel("Mikrofonen gick inte att starta. Kontrollera att webbläsaren får använda den, eller skriv din fråga."); }
    ritaMik("Klar", true);
    lyssnar.hidden = false;
    lyssnar.replaceChildren(ikon("mikrofon", 22), "Tudi lyssnar. Tryck på Klar när du har pratat färdigt.");
  });

  function visaFel(text, igen) {
    lista.querySelector(".sf-samtal-fel")?.remove();
    lista.append(h("li", { class: "sf-medd sf-medd--fel sf-medd--knapp sf-samtal-fel", role: "alert" }, ikon("fel"),
      h("p", { class: "sf-vaxer" }, text),
      igen && h("button", { type: "button", class: "sf-btn sf-btn--sekundar sf-btn--liten", onclick: igen }, "Försök igen")));
  }

  /* dokId: förklaringen av en sida är sparad, så ljudet sparas med filen */
  function lasUppKnapp(text, dokId) {
    const knapp = h("button", { type: "button", class: "sf-btn sf-btn--sekundar sf-btn--liten", "aria-pressed": "false" });
    const rita = pa => { knapp.replaceChildren(ikon(pa ? "paus" : "hogtalare", 20), pa ? "Pausa" : "Läs upp svaret"); knapp.setAttribute("aria-pressed", String(pa)); };
    rita(false);
    knapp.addEventListener("click", async () => {
      if (spelas === knapp) { ljud.stoppa(); return; }
      spelas?.dispatchEvent(new Event("stoppad"));
      spelas = knapp;
      rita(true);
      try { await ljud.spela(await ljud.hamtaSvar(talbar(text), dokId), ljud.TEMPO[app.jag.installningar.tempo] || 1); }
      catch (e) { visaFel(e.message); }
      if (spelas === knapp) spelas = null;
      rita(false);
    });
    knapp.addEventListener("stoppad", () => rita(false));
    return knapp;
  }

  function bubbla(m) {
    if (m.roll === "student") {
      return h("li", { class: "sf-medd-du" }, h("span", { class: "sf-etikett" }, "Du"), h("p", { class: "sf-bubbla sf-bubbla--du" }, m.text));
    }
    const text = svarElement(m.text, m.kallor, oppnaKalla);
    /* Svar från före sidhänvisningarna i texten har sina källor i en egen rad */
    const iText = text.some(el => el.querySelector(".sf-kalla"));
    const flera = new Set(m.kallor.map(k => k.dokId)).size > 1;
    const sida = m.meta?.typ === "sida";
    const el = h("li", { class: "sf-medd-tudi" },
      h("img", { src: "/bilder/tudi-ansikte.png", alt: "", class: "sf-tudi-ansikte" }),
      h("div", { class: "sf-bubbla sf-bubbla--tudi" },
        h("span", { class: "sf-bubbla-namn" }, sida ? `Tudi förklarar sida ${m.meta.sida}` : "Tudi"),
        text,
        !iText && m.kallor.length > 0 && h("div", { class: "sf-rad" }, h("span", { class: "sf-hjalp" }, "Källor"),
          m.kallor.map(k => h("button", { type: "button", class: "sf-kalla", "aria-label": `Öppna ${k.titel}, sida ${k.sida}`, onclick: () => oppnaKalla(k) },
            ikon("dokument", 18), flera ? `${k.titel}, sida ${k.sida}` : `Sida ${k.sida}`))),
        !m.kallor.length && /inte i materialet|inget färdigt material/i.test(m.text) &&
          h("a", { href: `/kurser/${kursId}/ladda-upp`, class: "sf-btn sf-btn--sekundar sf-btn--liten sf-btn--sjalv" }, ikon("laddaUpp", 20), "Ladda upp material"),
        h("div", { class: "sf-bubbla-fot" }, lasUppKnapp(m.text, sida ? m.meta.dokId : undefined))));
    el.meta = m.meta || {};
    return el;
  }

  /* Knapparna för att få svaret förklarat på ett annat sätt, bara under senaste svaret.
     Under en förklaring av en sida utan bild finns också Titta på bilden också. */
  function foljdKnappar() {
    lista.querySelector(".sf-foljd")?.remove();
    const sista = [...lista.querySelectorAll(".sf-medd-tudi")].pop();
    if (!sista || sista !== lista.lastElementChild || !sista.meta) return;
    const meta = sista.meta;
    const visa = meta.typ === "sida" || (meta.typ === "chatt" && meta.val !== "ovrigt") || (!meta.typ && sista.querySelector(".sf-kalla"));
    if (!visa) return;
    const titta = meta.typ === "sida" && !meta.bild && bildAv && h("button", { type: "button", class: "sf-btn sf-btn--chip", onclick: async () => {
      let bild;
      try { bild = await bildAv(meta.dokId, meta.sida); } catch { bild = undefined; }
      if (!bild) return visaFel("Bilden av sidan gick inte att göra. Försök igen.");
      skicka({ forklara: true, tittaPaBilden: true, sida: { dokId: meta.dokId, nr: meta.sida }, bild }, `Titta på bilden av sida ${meta.sida}`, false, true);
    } }, "Titta på bilden också");
    sista.querySelector(".sf-bubbla").append(h("div", { class: "sf-knapprad sf-foljd", role: "group", "aria-label": "Be Tudi förklara på ett annat sätt" },
      FOLJD.map(([v, t]) => h("button", { type: "button", class: "sf-btn sf-btn--chip", onclick: () => skicka({ foljd: v }, t, false) }, t)), titta));
  }

  function tomt() {
    if (lista.children.length) return;
    lista.append(h("li", { class: "sf-samtal-tom" },
      h("p", {}, tomText || "Fråga något om ditt material. Tudi svarar utifrån det och visar vilken sida svaret kommer från."),
      h("p", { class: "sf-hjalp" }, "Exempel på frågor att börja med:"),
      h("div", { class: "sf-knapprad" }, EXEMPEL.map(t => h("button", { type: "button", class: "sf-btn sf-btn--chip", onclick: () => skicka({ fraga: t }, t, false) }, t)))));
  }

  /* utanKontext: data har redan allt, till exempel sidan och bilden för Titta på bilden också */
  async function skicka(data, visas, franFalt, utanKontext = false) {
    if (upptagen) return;
    upptagen = true;
    skickaKnapp.disabled = true;
    lista.querySelector(".sf-samtal-fel")?.remove();
    lista.querySelector(".sf-samtal-tom")?.remove();
    lista.querySelector(".sf-foljd")?.remove();
    const du = bubbla({ roll: "student", text: visas });
    const tanker = h("li", { class: "sf-medd-tudi", role: "status" },
      h("img", { src: "/bilder/tudi-ansikte.png", alt: "", class: "sf-tudi-ansikte" }),
      h("p", { class: "sf-bubbla sf-bubbla--tanker" }, data.forklara ? "Tudi läser sidan …" : serSidan ? "Tudi läser sidan och letar i ditt material …" : "Tudi letar i ditt material …"));
    lista.append(du, tanker);
    /* Fältet töms direkt, så att det syns att frågan är skickad. Går den inte fram kommer texten tillbaka. */
    if (franFalt) falt.value = "";
    /* Allt nytt hamnar sist i samtalet. Det scrollas fram, också när studenten har scrollat upp, till exempel till Förklara den här sidan. */
    du.scrollIntoView({ block: "start" });
    try {
      const extra = kontext && !utanKontext ? await kontext(data) : {};
      const r = await api("POST", `/api/kurser/${kursId}/fraga`, { ...extra, ...data });
      const svar = bubbla(r.svar);
      tanker.replaceWith(svar);
      meddela.textContent = "Tudi har svarat.";
      foljdKnappar();
      svar.scrollIntoView({ block: "start" });
    } catch (e) {
      du.remove(); tanker.remove();
      if (franFalt && !falt.value.trim()) falt.value = visas;
      visaFel(e.message, e.status === 429 || e.status === 400 ? null : () => skicka(data, visas, franFalt, utanKontext));
      tomt();
    } finally {
      upptagen = false;
      skickaKnapp.disabled = false;
    }
  }

  async function ladda() {
    try {
      const { meddelanden } = await api("GET", `/api/kurser/${kursId}/meddelanden`);
      lista.replaceChildren(...meddelanden.map(bubbla));
      foljdKnappar();
      tomt();
      lista.lastElementChild?.scrollIntoView({ block: "nearest" });
    } catch { visaFel("Kunde inte hämta samtalet.", ladda); }
  }

  return { el: h("div", { class: "sf-samtal-ruta" }, lista, meddela, form), skicka, ladda, falt,
    stang: () => { if (inspelning) inspelning.stoppa(); ljud.stoppa(); } };
}
