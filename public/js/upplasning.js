/* Uppläsning: hämtar ljud från servern och spelar det i ett och samma ljudelement.
   Samma text hämtas bara en gång per besök. Tempot är uppspelningshastigheten. */
export const TEMPO = { langsamt: 0.85, normalt: 1, snabbt: 1.2 };

const spelare = new Audio();
spelare.preload = "auto";
const hamtade = new Map();
let klar = null;

/* Ljud för en text i en fil. Fel ger ett meddelande som går att visa för studenten. */
export const hamta = (dokId, text) => hamtaLjud(`${dokId}|${text}`, `/api/dokument/${dokId}/upplas`, { text });
/* En provmening med en viss röst, till Inställningar */
export const hamtaProv = rost => hamtaLjud(`prov|${rost}`, "/api/rostprov", { rost });

function hamtaLjud(nyckel, adress, data) {
  if (!hamtade.has(nyckel)) {
    hamtade.set(nyckel, (async () => {
      const r = await fetch(adress, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data),
      }).catch(() => null);
      if (!r || !r.ok) {
        const j = r ? await r.json().catch(() => ({})) : {};
        throw new Error(j.fel || "Uppläsningen fungerar inte just nu.");
      }
      return URL.createObjectURL(await r.blob());
    })().catch(e => { hamtade.delete(nyckel); throw e; }));
  }
  return hamtade.get(nyckel);
}

/* Spelar ljudet. vidTid(andel) anropas medan ljudet spelas, med hur stor del som är uppläst.
   Löftet blir klart när ljudet är slut eller stoppas. */
export function spela(url, tempo, vidTid) {
  stoppa();
  return new Promise(ok => {
    let ram = 0;
    const slut = () => { cancelAnimationFrame(ram); spelare.onended = spelare.onerror = null; klar = null; ok(); };
    klar = slut;
    const tick = () => {
      if (spelare.duration) vidTid?.(spelare.currentTime / spelare.duration);
      ram = requestAnimationFrame(tick);
    };
    spelare.onended = spelare.onerror = slut;
    spelare.src = url;
    spelare.playbackRate = tempo;
    spelare.play().then(tick, slut);
  });
}

export function stoppa() { spelare.pause(); if (klar) klar(); }
export function pausa() { spelare.pause(); }
export function fortsatt() { return spelare.play(); }
export const arPausad = () => spelare.paused && !!klar;
export function satTempo(tempo) { spelare.playbackRate = tempo; }
