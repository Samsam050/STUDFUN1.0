/* Tudis svar som element: stycken, punktlistor, numrerade listor, fetstil och sidhänvisningar som knappar.
   Allt blir textnoder, aldrig HTML. Servern har redan tagit bort hänvisningar till sidor Tudi inte fick se,
   och kallor[i] hör till den i:te hänvisningen i texten. Mönstret är samma som i kallor.js på servern. */
import { h, ikon } from "./dom.js";

const KALLA = /\[\s*(?:([^\[\]]{1,200}?),\s*)?s\.\s*(\d{1,4})(?:\s*[–-]\s*(\d{1,4}))?\s*\]/g;
const PUNKT = /^\s*(?:[-•*]|•)\s+/;
const NUMMER = /^\s*\d{1,2}[.)]\s+/;

/* oppna(kalla) anropas när studenten trycker på en hänvisning: { dokId, titel, sida } */
export function svarElement(text, kallor = [], oppna) {
  let i = 0;
  function kalla(m) {
    const k = kallor[i++];
    const visas = `${m[1] ? `${m[1].trim()}, ` : ""}s. ${m[2]}${m[3] ? `–${m[3]}` : ""}`;
    if (!k || !oppna) return visas;
    return h("button", { type: "button", class: "sf-kalla sf-kalla--i-text", "aria-label": `Öppna ${k.titel}, sida ${k.sida}`, onclick: () => oppna(k) },
      ikon("dokument", 16), visas);
  }
  function hanvisningar(t) {
    const ut = [];
    let sist = 0;
    for (const m of t.matchAll(KALLA)) {
      if (m.index > sist) ut.push(t.slice(sist, m.index));
      ut.push(kalla(m));
      sist = m.index + m[0].length;
    }
    if (sist < t.length) ut.push(t.slice(sist));
    return ut;
  }
  /* **fetstil** och hänvisningar på en rad */
  const rad = t => t.split(/(\*\*[^*\n]+\*\*)/).flatMap(del =>
    /^\*\*[^*]+\*\*$/.test(del) ? [h("strong", {}, hanvisningar(del.slice(2, -2)))] : hanvisningar(del));

  const block = [];
  let lista = null, stycke = [];
  const avslutaStycke = () => { if (stycke.length) block.push(h("p", {}, rad(stycke.join(" ")))); stycke = []; };
  for (const r of String(text).split("\n")) {
    const typ = PUNKT.test(r) ? "ul" : NUMMER.test(r) ? "ol" : null;
    if (typ) {
      avslutaStycke();
      if (!lista || lista.tagName.toLowerCase() !== typ) { lista = h(typ, { class: "sf-svar-lista" }); block.push(lista); }
      lista.append(h("li", {}, rad(r.replace(typ === "ul" ? PUNKT : NUMMER, ""))));
    } else if (!r.trim()) { avslutaStycke(); lista = null; }
    else { lista = null; stycke.push(r.trim()); }
  }
  avslutaStycke();
  return block;
}

/* Texten som den ska läsas upp: utan stjärnor, och [s. 12] blir "sidan 12" */
export const talbar = text => String(text)
  .replace(KALLA, (_, titel, a, b) => `${titel ? `${titel.trim()}, ` : ""}${b ? `sidorna ${a} till ${b}` : `sidan ${a}`}`)
  .replace(/\*\*/g, "").replace(/^\s*(?:[-•*])\s+/gm, "");
