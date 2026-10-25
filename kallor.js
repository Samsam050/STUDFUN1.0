/*
  Sidhänvisningar i Tudis svar: [s. 12], [s. 12–14] och [Titel, s. 12].

  Servern godtar bara sidor som faktiskt skickades till Tudi. Andra hänvisningar tas bort ur texten,
  så att studenten aldrig ser ett sidnummer som Tudi har hittat på. De som är kvar blir knappar i appen.
  Samma mönster finns i public/js/svar.js. Ändras det här måste det ändras där också.
*/
const KALLA = /\[\s*(?:([^\[\]]{1,200}?),\s*)?s\.\s*(\d{1,4})(?:\s*[–-]\s*(\d{1,4}))?\s*\]/g;

const lika = (a, b) => a.trim().toLowerCase() === b.trim().toLowerCase();

/* Tillåtna sidor att hänvisa till. Lägg till sidor och sidspann ("12–21") per dokument. */
function tillatna() {
  const sidor = new Map(), spann = new Map();
  return {
    sida(dokId, nr) { if (!sidor.has(dokId)) sidor.set(dokId, new Set()); sidor.get(dokId).add(nr); },
    spann(dokId, text) {
      const m = /^\s*(\d+)\s*[–-]\s*(\d+)\s*$/.exec(String(text || ""));
      if (!m) return;
      if (!spann.has(dokId)) spann.set(dokId, new Set());
      spann.get(dokId).add(`${Number(m[1])}-${Number(m[2])}`);
    },
    har(dokId, fran, till) {
      if (till == null || till === fran) return !!sidor.get(dokId)?.has(fran) || [...(spann.get(dokId) || [])].some(s => s === `${fran}-${fran}`);
      return !!spann.get(dokId)?.has(`${fran}-${till}`) || !!sidor.get(dokId)?.has(fran);
    },
    dokument: () => new Set([...sidor.keys(), ...spann.keys()]),
  };
}

/* Kontrollerar hänvisningarna i text.
   till        från tillatna()
   dokument    [{ id, titel }] som Tudi fick se
   standard    dokumentet som en hänvisning utan titel gäller, till exempel det som är öppet
   Returnerar { text, kallor } där kallor[i] hör till den i:te hänvisningen som är kvar i texten. */
function kontrollera(text, { till, dokument, standard = null }) {
  const kallor = [];
  const ut = String(text).replace(KALLA, (helt, titel, a, b) => {
    const fran = Number(a), sist = b ? Number(b) : null;
    let dok = null;
    if (titel) dok = dokument.find(d => lika(d.titel, titel));
    else if (standard != null && till.har(standard, fran, sist)) dok = dokument.find(d => d.id === standard);
    else dok = dokument.find(d => till.har(d.id, fran, sist));
    if (!dok || !till.har(dok.id, fran, sist)) return "";
    kallor.push({ dokId: dok.id, titel: dok.titel, sida: fran, ...(sist && sist !== fran ? { till: sist } : {}) });
    return helt;
  }).replace(/[ \t]+([.,;:!?])/g, "$1").replace(/[ \t]{2,}/g, " ").trim();
  return { text: ut, kallor };
}

module.exports = { KALLA, tillatna, kontrollera };
