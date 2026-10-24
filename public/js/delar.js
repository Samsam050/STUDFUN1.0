/* Delar texten i läsläget. Ingen DOM här, så att den går att testa i Node. */
const MAX_MENING = 400; // längre "meningar", till exempel tabeller, delas vid ett mellanslag

/* Delar sidornas text i delar om tre till fyra meningar. En del bryts aldrig mitt i en mening,
   sträcker sig aldrig över två sidor och har alltid sitt sidnummer. */
export function delaUpp(sidor) {
  const delar = [];
  sidor.forEach((text, i) => {
    const meningar = (text.replace(/\s+/g, " ").trim().match(/[^.!?]*[.!?]+["”’)]*\s*|[^.!?]+/g) || [])
      .flatMap(m => (m.length > MAX_MENING ? m.match(new RegExp(`.{1,${MAX_MENING}}(?:\\s|$)|.{${MAX_MENING}}`, "g")) : [m]))
      .map(m => m.trim()).filter(Boolean);
    for (let k = 0; k < meningar.length;) {
      const del = [meningar[k++]];
      let langd = del[0].length;
      while (k < meningar.length && del.length < 4 && (del.length < 3 || langd < 250) && langd + meningar[k].length <= 700) {
        langd += meningar[k].length;
        del.push(meningar[k++]);
      }
      delar.push({ sida: i + 1, meningar: del });
    }
  });
  return delar;
}
