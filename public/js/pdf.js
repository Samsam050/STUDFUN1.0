/* pdf.js, lokalt i vendor. Laddas bara på sidor som behöver den.
   isEvalSupported: false gör att pdf.js aldrig kör kod som byggs ur dokumentet. */
const BAS = "/vendor/pdfjs-6.4.299/";
let pdfjs;

export async function oppnaPdf(data) {
  if (!pdfjs) {
    pdfjs = await import(BAS + "pdf.min.mjs");
    pdfjs.GlobalWorkerOptions.workerSrc = BAS + "pdf.worker.min.mjs";
  }
  return pdfjs.getDocument({
    data, isEvalSupported: false, enableXfa: false,
    cMapUrl: BAS + "cmaps/", cMapPacked: true, standardFontDataUrl: BAS + "standard_fonts/", wasmUrl: BAS + "wasm/",
  }).promise;
}

/* Texten på en sida, med radbrytningar där pdf.js ser slutet på en rad */
export async function sidtext(pdf, nr) {
  const sida = await pdf.getPage(nr);
  const { items } = await sida.getTextContent();
  sida.cleanup();
  return items.map(it => (it.str || "") + (it.hasEOL ? "\n" : "")).join("")
    .replace(/(\p{L})-\n(\p{Ll})/gu, "$1$2"); // ord som avstavats vid radslut blir hela igen
}

/* Textbitarna på en sida med sina rutor i bildpunkter, i samma skala som viewport från ritaSida.
   y är radens överkant: pdf.js ger baslinjen, och bokstäverna når ungefär 0,9 teckenhöjd upp. */
export async function textrutor(pdf, nr, viewport) {
  const sida = await pdf.getPage(nr);
  const { items } = await sida.getTextContent();
  return items.map(it => {
    const t = pdfjs.Util.transform(viewport.transform, it.transform);
    const hojd = Math.hypot(t[2], t[3]);
    return { str: it.str || "", x: t[4], y: t[5] - hojd * 0.9, b: it.width * viewport.scale, h: hojd * 1.15, eol: !!it.hasEOL };
  });
}

/* Ritar en sida på en canvas så att den fyller bredden gånger zoom. Skarp även på skärmar med hög upplösning. */
export async function ritaSida(pdf, nr, canvas, bredd, zoom = 1) {
  canvas.ritning?.cancel(); // en ritning som pågår avbryts, och dess löfte ger RenderingCancelledException
  const sida = await pdf.getPage(nr);
  const bas = sida.getViewport({ scale: 1 });
  const viewport = sida.getViewport({ scale: (bredd / bas.width) * zoom });
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.floor(viewport.width * dpr);
  canvas.height = Math.floor(viewport.height * dpr);
  canvas.style.width = `${Math.floor(viewport.width)}px`;
  canvas.style.height = `${Math.floor(viewport.height)}px`;
  const uppgift = sida.render({ canvasContext: canvas.getContext("2d"), viewport, transform: dpr === 1 ? null : [dpr, 0, 0, dpr, 0, 0] });
  canvas.ritning = uppgift; // så att en ny ritning kan avbryta den gamla
  await uppgift.promise;
  return viewport;
}
