/* Delar som används på flera sidor: kurskortet och dialogen för att skapa eller ändra en kurs. */
import { h, ikon, meddelande } from "./dom.js";
import { api } from "./app.js";

const antalPdf = n => (n === 1 ? "1 PDF" : `${n} PDF:er`);
export const kursMeta = k => [k.termin, k.antalPdf ? antalPdf(k.antalPdf) : "Inget material än"].filter(Boolean).join(" · ");

export function kurskort(k, i, rubrik = "h2") {
  return h("li", { class: "sf-ruta sf-kurskort" },
    h("div", { class: "sf-kurskort-topp" },
      h("div", { class: "sf-stapel" }, h(rubrik, { class: "sf-kurskort-namn" }, k.namn), h("p", { class: "sf-etikett" }, kursMeta(k))),
      h("span", { class: `sf-ikonruta${i % 2 ? " sf-ikonruta--orange" : ""}`, "aria-hidden": "true" }, ikon("kurser"))),
    h("a", { href: `/kurser/${k.id}`, class: "sf-btn sf-btn--primar sf-btn--liten sf-btn--sjalv", "aria-label": `Öppna kursen ${k.namn}` }, "Öppna kursen"));
}

/* Innevarande termin och de två nästa. Höstterminen räknas från juli. */
function terminer(nu = new Date()) {
  let ar = nu.getFullYear(), ht = nu.getMonth() >= 6;
  const lista = [];
  for (let i = 0; i < 3; i++) {
    lista.push(`${ht ? "HT" : "VT"} ${ar}`);
    if (ht) { ar++; ht = false; } else ht = true;
  }
  return lista;
}

/* Skapar en ny kurs, eller ändrar namn och termin om kurs skickas med. klar(kurs) anropas efteråt. */
export function kursDialog({ kurs, klar }) {
  const forra = document.activeElement;
  const namn = h("input", { id: "kd-namn", class: "sf-falt", type: "text", maxlength: 100, autocomplete: "off",
    placeholder: "Till exempel Familjerätt", "aria-describedby": "kd-namn-fel" });
  namn.value = kurs ? kurs.namn : "";
  const namnFel = h("span", { id: "kd-namn-fel", class: "sf-faltfel" });
  const val = terminer();
  if (kurs && kurs.termin && !val.includes(kurs.termin)) val.unshift(kurs.termin);
  const termin = h("select", { id: "kd-termin", class: "sf-falt", "aria-describedby": "kd-termin-hjalp" },
    val.map(t => h("option", { value: t }, t)), h("option", { value: "" }, "Ingen termin"));
  termin.value = kurs ? kurs.termin : val[0];
  const fel = h("div", { class: "sf-topp-fel" });
  const spara = h("button", { type: "submit", class: "sf-btn sf-btn--primar" }, kurs ? "Spara" : "Skapa kurs");

  const form = h("form", { class: "sf-dialog-form", novalidate: true },
    fel,
    h("div", { class: "sf-falt-grupp" }, h("label", { for: "kd-namn" }, "Kursens namn"), namn, namnFel),
    h("div", { class: "sf-falt-grupp" }, h("label", { for: "kd-termin" }, "Termin"), termin,
      h("span", { id: "kd-termin-hjalp", class: "sf-hjalp" }, "Du kan ändra namn och termin senare.")),
    h("div", { class: "sf-dialog-knappar" },
      h("button", { type: "button", class: "sf-btn sf-btn--sekundar", onclick: () => d.close() }, "Avbryt"), spara));
  const d = h("dialog", { class: "sf-dialog", "aria-labelledby": "kd-rubrik" },
    h("h2", { id: "kd-rubrik" }, kurs ? "Ändra kursen" : "Skapa ny kurs"), form);

  form.addEventListener("submit", async e => {
    e.preventDefault();
    fel.replaceChildren();
    const text = namn.value.trim();
    namn.setAttribute("aria-invalid", String(!text));
    namnFel.replaceChildren(...(text ? [] : [ikon("fel", 20), "Skriv ett namn på kursen."]));
    if (!text) return namn.focus();
    spara.disabled = true;
    try {
      const ny = await api(kurs ? "PUT" : "POST", kurs ? `/api/kurser/${kurs.id}` : "/api/kurser", { namn: text, termin: termin.value });
      d.close();
      klar(ny);
    } catch (err) {
      fel.append(meddelande("fel", err.message));
      spara.disabled = false;
    }
  });
  d.addEventListener("close", () => { d.remove(); if (forra && forra.isConnected) forra.focus(); });
  document.body.append(d);
  d.showModal();
}
