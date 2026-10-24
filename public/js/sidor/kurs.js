/* En kurs: namn och termin, materialet och radera kursen.
   Ladda upp PDF kommer i steg 3, Fråga Tudi i steg 5 och Öva i steg 6. */
import { h, ikon, meddelande, felMedForsok, dialog } from "../dom.js";
import { api, app } from "../app.js";
import { kursDialog } from "../kurs-delar.js";

export default async function visa(main, { kursId }) {
  let kurs;
  try { kurs = await api("GET", `/api/kurser/${kursId}`); }
  catch (e) {
    if (e.status === 404) {
      main.append(h("div", { class: "sf-sida" }, h("h1", {}, "Kursen finns inte"),
        h("p", {}, "Den kan ha raderats. Du hittar dina kurser under Mina kurser."),
        h("a", { href: "/kurser", class: "sf-btn sf-btn--primar sf-btn--sjalv" }, "Till Mina kurser")));
    } else {
      main.append(h("div", { class: "sf-sida" }, h("h1", {}, "Kursen"),
        felMedForsok("Kunde inte hämta kursen.", () => { main.replaceChildren(); visa(main, { kursId }); })));
    }
    return;
  }
  document.title = `${kurs.namn} · StudFun`;

  const rubrik = h("h1", {}, kurs.namn);
  const termin = h("p", { class: "sf-ingress sf-text-2" }, kurs.termin);
  const status = h("div", { class: "sf-status-rad" });
  if (app.kvitto) { status.append(meddelande("klar", app.kvitto)); app.kvitto = null; }

  const andra = () => kursDialog({ kurs, klar: ny => {
    kurs = ny;
    rubrik.textContent = ny.namn;
    termin.textContent = ny.termin;
    document.title = `${ny.namn} · StudFun`;
    status.replaceChildren(meddelande("klar", "Ändringen är sparad."));
  } });

  const radera = () => dialog({
    rubrik: `Radera kursen ${kurs.namn}?`,
    text: "Allt material, alla frågor och alla flashcards i kursen försvinner. Det går inte att ångra.",
    knapp: "Radera kursen",
    utfor: async () => {
      await api("DELETE", `/api/kurser/${kurs.id}`);
      return () => {
        const klar = h("section", { class: "sf-ruta sf-ruta--stor", role: "status" },
          h("h1", { tabindex: "-1" }, `Kursen ${kurs.namn} är raderad`),
          h("p", {}, "Materialet, frågorna och flashcards är borttagna."),
          h("a", { href: "/", class: "sf-btn sf-btn--primar" }, "Till startsidan"));
        main.replaceChildren(h("div", { class: "sf-sida sf-sida--smal" }, klar));
        klar.querySelector("h1").focus();
      };
    },
  });

  main.append(h("div", { class: "sf-sida" },
    h("header", { class: "sf-kurs-huvud" },
      h("a", { href: "/kurser", class: "sf-tillbaka" }, ikon("tillbaka", 20), "Alla kurser"),
      h("div", { class: "sf-sidhuvud sf-sidhuvud--knapp" },
        h("div", { class: "sf-stapel" }, rubrik, termin),
        h("button", { type: "button", class: "sf-btn sf-btn--sekundar sf-btn--liten", onclick: andra }, "Ändra namn och termin"))),
    status,
    h("section", { class: "sf-stapel sf-stapel--luft", "aria-labelledby": "material-rubrik" },
      h("h2", { id: "material-rubrik" }, "Material"),
      h("div", { class: "sf-tom" },
        h("img", { src: "/bilder/tudi.png", alt: "", class: "sf-tom-tudi" }),
        h("div", { class: "sf-stapel sf-stapel--luft sf-vaxer" },
          h("p", { class: "sf-rad-rubrik" }, "Kursen har inget material än"),
          h("p", {}, "Ladda upp en PDF, till exempel kursboken eller anteckningar från en föreläsning. Sedan kan Tudi läsa upp, förklara och göra övningar.")))),
    h("section", { class: "sf-sektion sf-rad-mellan", "aria-labelledby": "radera-rubrik" },
      h("div", { class: "sf-stapel sf-vaxer" }, h("h2", { id: "radera-rubrik" }, "Radera kursen"),
        h("p", { class: "sf-hjalp" }, "Allt material, alla frågor och alla flashcards i kursen försvinner.")),
      h("button", { type: "button", class: "sf-btn sf-btn--fara-kant", onclick: radera }, "Radera kursen"))));
}
