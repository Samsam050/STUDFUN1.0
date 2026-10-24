/* Uppläsning: hämtar ljud från servern och spelar det i ett och samma ljudelement.
   Samma text hämtas bara en gång per besök. Tempot är uppspelningshastigheten. */
export const TEMPO = { langsamt: 0.85, normalt: 1, snabbt: 1.2 };

const spelare = new Audio();
spelare.preload = "auto";
spelare.setAttribute("playsinline", "");

/* Safari låter bara sidan spela ljud som studenten själv har startat. Ljudet hämtas först och spelas sedan,
   så ljudelementet låses upp vid studentens första tryck, med en kort tystnad. Samma knep som i dagens app. */
function tystnad() {
  const b = new DataView(new ArrayBuffer(46));
  [..."RIFF"].forEach((c, i) => b.setUint8(i, c.charCodeAt(0))); b.setUint32(4, 38, true);
  [..."WAVEfmt "].forEach((c, i) => b.setUint8(8 + i, c.charCodeAt(0))); b.setUint32(16, 16, true);
  b.setUint16(20, 1, true); b.setUint16(22, 1, true); b.setUint32(24, 8000, true); b.setUint32(28, 8000, true);
  b.setUint16(32, 1, true); b.setUint16(34, 8, true);
  [..."data"].forEach((c, i) => b.setUint8(36 + i, c.charCodeAt(0))); b.setUint32(40, 2, true); b.setUint8(44, 128); b.setUint8(45, 128);
  return URL.createObjectURL(new Blob([b], { type: "audio/wav" }));
}
let upplast = false;
function lasUpp() {
  if (upplast || klar) return;
  upplast = true;
  spelare.src = tystnad();
  spelare.play().catch(() => { upplast = false; });
}
for (const h of ["pointerdown", "keydown", "touchend"]) document.addEventListener(h, lasUpp, { capture: true, passive: true });
const hamtade = new Map();
let klar = null;

/* Ljud för en text i en fil. Fel ger ett meddelande som går att visa för studenten. */
export const hamta = (dokId, text) => hamtaLjud(`${dokId}|${text}`, `/api/dokument/${dokId}/upplas`, { text });
/* Ett svar från Tudi */
export const hamtaSvar = text => hamtaLjud(`svar|${text}`, "/api/upplas-svar", { text });
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
   Löftet blir klart när ljudet är slut eller stoppas, och misslyckas om webbläsaren inte spelar det.
   Ett nekat ljud får aldrig räknas som uppläst, då skulle läsläget hoppa vidare genom hela texten. */
export function spela(url, tempo, vidTid) {
  stoppa();
  return new Promise((ok, fel) => {
    let ram = 0;
    const avsluta = misslyckat => {
      cancelAnimationFrame(ram); spelare.onended = spelare.onerror = null; klar = null;
      misslyckat ? fel(new Error("Uppläsningen kunde inte starta. Tryck på knappen igen.")) : ok();
    };
    klar = () => avsluta(false);
    const tick = () => {
      if (spelare.duration) vidTid?.(spelare.currentTime / spelare.duration);
      ram = requestAnimationFrame(tick);
    };
    spelare.onended = () => avsluta(false);
    spelare.onerror = () => avsluta(true);
    spelare.src = url;
    spelare.playbackRate = tempo;
    spelare.play().then(tick, () => avsluta(true));
  });
}

export function stoppa() { spelare.pause(); if (klar) klar(); }
export function pausa() { spelare.pause(); }
export function fortsatt() { return spelare.play(); }
export const arPausad = () => spelare.paused && !!klar;
export function satTempo(tempo) { spelare.playbackRate = tempo; }
