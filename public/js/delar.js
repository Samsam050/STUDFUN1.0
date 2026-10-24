/* Ord och meningar på en PDF-sida, till uppläsningen i visaren. Ingen DOM här, så att det går att testa i Node. */
const MAX_MENING = 400; // tecken, så att en mening alltid ryms i ett anrop till uppläsningen

/* bitar: pdf.js text på sidan, med rutor i bildpunkter: { str, x, y, b, h, eol }.
   Ger ord med en eller flera rutor. En bit utan mellanslag före hör ihop med ordet innan,
   och ett ord som avstavats vid radslut ("be-" "handling") blir ett ord med två rutor.
   matt(text) ger textens bredd i något typsnitt. Ordets plats räknas som dess andel av bitens bredd.
   Utan matt räknas varje bokstav som lika bred. */
export function ordFranText(bitar, matt = t => t.length) {
  const ord = [];
  let hopIhop = false;
  for (const bit of bitar) {
    const s = bit.str || "";
    if (!s.trim()) { hopIhop = false; continue; }
    const skala = bit.b / (matt(s) || 1);
    for (const m of s.matchAll(/\S+/g)) {
      const ruta = { x: bit.x + matt(s.slice(0, m.index)) * skala, y: bit.y, b: matt(m[0]) * skala, h: bit.h };
      const sista = ord[ord.length - 1];
      if (m.index === 0 && hopIhop && sista) {
        sista.text = (sista.avstavat ? sista.text.slice(0, -1) : sista.text) + m[0];
        sista.rutor.push(ruta);
        sista.avstavat = false;
      } else ord.push({ text: m[0], rutor: [ruta], avstavat: false });
    }
    const sista = ord[ord.length - 1];
    sista.avstavat = !!bit.eol && /\p{L}-$/u.test(s);
    hopIhop = sista.avstavat || (!/\s$/.test(s) && !bit.eol);
  }
  return ord.map(({ text, rutor }) => ({ text, rutor }));
}

/* Meningarna som index till första och sista ordet. En mening bryts vid . ! ? eller när den blir för lång. */
export function meningar(ord) {
  const ut = [];
  let fran = 0, langd = 0;
  ord.forEach((o, i) => {
    langd += o.text.length + 1;
    if (/[.!?]["”’)]*$/.test(o.text) || langd > MAX_MENING || i === ord.length - 1) {
      ut.push({ fran, till: i });
      fran = i + 1;
      langd = 0;
    }
  });
  return ut;
}
