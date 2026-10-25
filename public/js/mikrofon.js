/* Tal till text: spelar in studentens fråga och låter servern skriva ut den. Ljudet sparas inte. */
const MAX_MS = 90_000;

/* Startar inspelningen. Returnerar stoppa(), som ger ljudet. Stannar själv efter 90 sekunder. */
export async function spelaIn(vidMax) {
  const strom = await navigator.mediaDevices.getUserMedia({ audio: true });
  const typ = ["audio/webm", "audio/mp4", "audio/ogg"].find(t => window.MediaRecorder && MediaRecorder.isTypeSupported(t));
  const rec = new MediaRecorder(strom, typ ? { mimeType: typ } : {});
  const delar = [];
  rec.ondataavailable = e => { if (e.data.size) delar.push(e.data); };
  rec.start();
  const vakt = setTimeout(() => vidMax?.(), MAX_MS);
  return {
    stoppa: () => new Promise(ok => {
      clearTimeout(vakt);
      rec.onstop = () => { strom.getTracks().forEach(t => t.stop()); ok(new Blob(delar, { type: (rec.mimeType || "audio/webm").split(";")[0] })); };
      rec.stop();
    }),
  };
}

export async function tillText(ljud) {
  const r = await fetch("/api/tal", { method: "POST", headers: { "Content-Type": ljud.type || "audio/webm" }, body: ljud }).catch(() => null);
  const j = r ? await r.json().catch(() => ({})) : {};
  if (!r || !r.ok) throw new Error(j.fel || "Tal till text fungerar inte just nu. Du kan skriva din fråga under tiden.");
  return j.text;
}
