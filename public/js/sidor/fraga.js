/* Fråga Tudi: chatten för en kurs. /fraga öppnar den kurs studenten senast använde. */
import { h, ikon, felMedForsok } from "../dom.js";
import { api, navigera } from "../app.js";
import { samtal } from "../tudi.js";

const lagra = (k, v) => { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch { return null; } };
export const kommIhagKurs = id => lagra("sf.kurs", String(id));

/* Vilken kurs menyvalen Fråga Tudi och Öva öppnar: den senast använda, annars den nyaste */
export async function senasteKurs() {
  const { kurser } = await api("GET", "/api/kurser");
  return kurser.find(k => String(k.id) === lagra("sf.kurs")) || kurser[0] || null;
}

export default async function visa(main, { kursId }) {
  if (!kursId) {
    let k;
    try { k = await senasteKurs(); }
    catch { main.append(h("div", { class: "sf-sida" }, h("h1", {}, "Fråga Tudi"), felMedForsok("Kunde inte hämta kurserna.", () => { main.replaceChildren(); visa(main, {}); }))); return; }
    if (k) return navigera(`/kurser/${k.id}/fraga`, { ersatt: true });
    main.append(h("div", { class: "sf-sida" }, h("h1", {}, "Fråga Tudi"),
      h("p", {}, "Skapa en kurs och ladda upp material först. Sedan kan Tudi svara utifrån det."),
      h("a", { href: "/kurser", class: "sf-btn sf-btn--primar sf-btn--sjalv" }, "Till Mina kurser")));
    return;
  }

  let kurser, dokument;
  try {
    [{ kurser }, { dokument }] = await Promise.all([api("GET", "/api/kurser"), api("GET", `/api/kurser/${kursId}/dokument`)]);
  } catch (e) {
    main.append(h("div", { class: "sf-sida" }, h("h1", {}, e.status === 404 ? "Kursen finns inte" : "Fråga Tudi"),
      e.status === 404 ? h("a", { href: "/kurser", class: "sf-btn sf-btn--primar sf-btn--sjalv" }, "Till Mina kurser")
        : felMedForsok("Kunde inte hämta kursen.", () => { main.replaceChildren(); visa(main, { kursId }); })));
    return;
  }
  const kurs = kurser.find(k => k.id === Number(kursId));
  kommIhagKurs(kurs.id);
  const klara = dokument.filter(d => d.status === "klar");

  const s = samtal({
    kursId: kurs.id,
    oppnaKalla: k => navigera(`/kurser/${kurs.id}/visa/${k.dokId}?sida=${k.sida}`),
  });
  if (!klara.length) {
    s.el.querySelector("form").hidden = true;
  }

  const kursval = h("select", { id: "kursval", class: "sf-falt sf-falt--kort" }, kurser.map(k => h("option", { value: k.id }, k.namn)));
  kursval.value = String(kurs.id);
  kursval.addEventListener("change", () => navigera(`/kurser/${kursval.value}/fraga`));

  main.append(h("div", { class: "sf-chatt" },
    h("section", { class: "sf-chatt-huvud", "aria-labelledby": "chatt-rubrik" },
      h("header", { class: "sf-rad-mellan sf-chatt-topp" },
        h("div", { class: "sf-rad" },
          h("img", { src: "/bilder/tudi-ansikte.png", alt: "", class: "sf-tudi-ansikte sf-tudi-ansikte--stor" }),
          h("div", { class: "sf-stapel" }, h("h1", { id: "chatt-rubrik" }, "Fråga Tudi"),
            h("p", { class: "sf-hjalp" }, "Svarar utifrån ditt material och visar sidan"))),
        h("div", { class: "sf-rad sf-rad--tat" }, h("label", { for: "kursval", class: "sf-etikett-stor" }, "Kurs"), kursval)),
      !klara.length && h("div", { class: "sf-medd sf-medd--knapp sf-medd--info", role: "status" }, ikon("dokument"),
        h("p", { class: "sf-vaxer" }, dokument.length ? "Tudi gör i ordning ditt material. Du kan fråga när en PDF är klar." : "Kursen har inget material än. Ladda upp en PDF, så kan Tudi svara utifrån den."),
        !dokument.length && h("a", { href: `/kurser/${kurs.id}/ladda-upp`, class: "sf-btn sf-btn--sekundar sf-btn--liten" }, "Ladda upp PDF")),
      s.el),
    h("aside", { class: "sf-ruta sf-tudi-laser", "aria-labelledby": "material-rubrik" },
      h("h2", { id: "material-rubrik" }, "Tudi läser i"),
      klara.length
        ? h("ul", { class: "sf-lista sf-stapel sf-stapel--luft" }, klara.map(d => h("li", { class: "sf-rad sf-rad--tat sf-rad--topp" }, ikon("dokument", 22),
            h("span", { class: "sf-stapel" }, h("span", { class: "sf-bryt" }, d.titel), h("span", { class: "sf-etikett" }, d.sidor === 1 ? "1 sida" : `${d.sidor} sidor`)))))
        : h("p", { class: "sf-hjalp" }, "Inga filer är klara än."),
      h("p", { class: "sf-hjalp" }, "Tudi svarar bara utifrån de här filerna. Finns svaret inte där säger Tudi det."))));
  await s.ladda();
  const stad = new MutationObserver(() => { if (!main.isConnected) { s.stang(); stad.disconnect(); } });
  stad.observe(document.getElementById("app"), { childList: true });
}
