/* Bygger sidan med riktiga element. Text blir alltid textnoder, aldrig HTML,
   så att text från studenter och dokument inte kan köras som kod. */
export function h(tagg, attr = {}, ...barn) {
  const el = document.createElement(tagg);
  for (const [k, v] of Object.entries(attr)) {
    if (v === false || v == null) continue;
    if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if (k === "class") el.className = v;
    else el.setAttribute(k, v === true ? "" : String(v));
  }
  lagg(el, barn);
  return el;
}

function lagg(el, barn) {
  for (const b of barn.flat()) {
    if (b === false || b == null) continue;
    el.append(b instanceof Node ? b : document.createTextNode(String(b)));
  }
}

/* Ikoner från designen. Visas bara som stöd bredvid text, därför aria-hidden. */
const IKONER = {
  hem: ["M3 10.5 12 3l9 7.5", "M5 9.5V21h14V9.5", "M10 21v-6h4v6"],
  kurser: ["M4 19V5a2 2 0 0 1 2-2h14v14H6a2 2 0 0 0-2 2 2 2 0 0 0 2 2h14", "M8 7h8"],
  chatt: ["M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"],
  ova: ["M7 3h12a2 2 0 0 1 2 2v12", "m7 13.5 2.5 2.5L14 11", { rect: [3, 6, 14, 15, 2] }],
  installningar: ["M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12", { cirkel: [16, 6, 2] }, { cirkel: [10, 12, 2] }, { cirkel: [18, 18, 2] }],
  pil: ["M5 12h14", "m13 6 6 6-6 6"],
  tillbaka: ["M19 12H5", "m11 18-6-6 6-6"],
  laddaUpp: ["M12 15V3", "m7 8 5-5 5 5", "M4 15v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4"],
  dokument: ["M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z", "M14 3v6h6"],
  klocka: [{ cirkel: [12, 12, 9] }, "M12 7v5l3 2"],
  plus: ["M12 5v14M5 12h14"],
  fel: [{ cirkel: [12, 12, 9] }, "M12 7v6", "M12 16.5v.5"],
  bock: ["m5 12.5 4.5 4.5L19 7"],
};
const NS = "http://www.w3.org/2000/svg";
export function ikon(namn, storlek = 24) {
  const svg = document.createElementNS(NS, "svg");
  for (const [k, v] of Object.entries({ width: storlek, height: storlek, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor",
    "stroke-width": 2, "stroke-linecap": "round", "stroke-linejoin": "round", "aria-hidden": "true", focusable: "false" })) svg.setAttribute(k, v);
  for (const d of IKONER[namn]) {
    let el;
    if (typeof d === "string") { el = document.createElementNS(NS, "path"); el.setAttribute("d", d); }
    else if (d.cirkel) { el = document.createElementNS(NS, "circle"); ["cx", "cy", "r"].forEach((k, i) => el.setAttribute(k, d.cirkel[i])); }
    else { el = document.createElementNS(NS, "rect"); ["x", "y", "width", "height", "rx"].forEach((k, i) => el.setAttribute(k, d.rect[i])); }
    svg.append(el);
  }
  return svg;
}

/* Meddelande i rutan, till exempel fel eller kvitto. Fel läses upp direkt, kvitton lugnt. */
export function meddelande(typ, text) {
  return h("div", { class: `sf-medd sf-medd--${typ}`, role: typ === "fel" ? "alert" : "status" },
    ikon(typ === "fel" ? "fel" : "bock"), h("p", {}, text));
}

/* Dialog som frågar innan något raderas. Med kryss måste studenten kryssa i rutan först.
   Fokus stannar i dialogen, Esc stänger, och fokus går tillbaka till knappen som öppnade den.
   utfor() kan lämna tillbaka en funktion som körs när dialogen har stängts, till exempel för att byta sida. */
export function dialog({ rubrik, text, kryss, knapp, utfor }) {
  const forra = document.activeElement;
  const fel = h("div", { class: "sf-topp-fel" });
  const ruta = kryss && h("input", { type: "checkbox", class: "sf-kryss" });
  const ok = h("button", { type: "button", class: "sf-btn sf-btn--fara", disabled: !!kryss }, knapp);
  const d = h("dialog", { class: "sf-dialog", "aria-labelledby": "dialog-rubrik", "aria-describedby": "dialog-text" },
    h("h2", { id: "dialog-rubrik" }, rubrik),
    h("p", { id: "dialog-text" }, text),
    kryss && h("label", { class: "sf-kryss-rad sf-kryss-rad--fara" }, ruta, h("span", {}, kryss)),
    fel,
    h("div", { class: "sf-dialog-knappar" },
      h("button", { type: "button", class: "sf-btn sf-btn--sekundar", onclick: () => d.close() }, "Avbryt"), ok));
  if (ruta) ruta.addEventListener("change", () => { ok.disabled = !ruta.checked; });
  ok.addEventListener("click", async () => {
    ok.disabled = true;
    fel.replaceChildren();
    try { const efter = await utfor(); d.close(); if (efter) efter(); }
    catch (e) { fel.append(meddelande("fel", e.message)); ok.disabled = false; }
  });
  d.addEventListener("close", () => { d.remove(); if (forra && forra.isConnected) forra.focus(); });
  document.body.append(d);
  d.showModal();
}

/* Fel när något inte gick att hämta, med en knapp som provar igen */
export function felMedForsok(text, forsok) {
  return h("div", { class: "sf-stapel sf-stapel--luft" }, meddelande("fel", text),
    h("button", { type: "button", class: "sf-btn sf-btn--sekundar sf-btn--sjalv", onclick: forsok }, "Försök igen"));
}

/* Lugna platshållare medan något hämtas. Inget rör sig. */
export function laddar(text, antal = 3) {
  return h("div", { role: "status", class: "sf-stapel sf-stapel--luft" }, h("p", { class: "sf-hjalp" }, text),
    h("div", { class: "sf-kurs-grid", "aria-hidden": "true" }, Array.from({ length: antal }, () =>
      h("div", { class: "sf-ruta sf-platshallare-kort" }, h("div", {}), h("div", {}), h("div", {})))));
}
