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
  return items.map(it => (it.str || "") + (it.hasEOL ? "\n" : "")).join("");
}
