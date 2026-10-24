/* Startsidan. Snabbvalen och nästa steg läggs till när det de leder till finns, i steg 3 till 7. */
import { h, ikon, felMedForsok, laddar } from "../dom.js";
import { api, app, navigera } from "../app.js";
import { kurskort, kursDialog } from "../kurs-delar.js";

export default async function visa(main) {
  const nyKurs = () => kursDialog({ klar: k => { app.kvitto = `Kursen ${k.namn} är skapad.`; navigera(`/kurser/${k.id}`); } });
  const sida = h("div", { class: "sf-sida" });
  main.append(sida);
  const vantar = laddar("Hämtar dina kurser …");
  sida.append(vantar);

  let lista;
  try { ({ kurser: lista } = await api("GET", "/api/kurser")); }
  catch (e) {
    vantar.replaceWith(felMedForsok("Kunde inte hämta kurserna.", () => { main.replaceChildren(); visa(main); }));
    return;
  }

  const kursRubrik = h("div", { class: "sf-rad-mellan" }, h("h2", { id: "mina-kurser" }, "Mina kurser"),
    lista.length > 0 && h("button", { type: "button", class: "sf-btn sf-btn--sekundar", onclick: nyKurs }, ikon("plus"), "Skapa ny kurs"));
  const kurssektion = h("section", { class: "sf-stapel sf-stapel--luft", "aria-labelledby": "mina-kurser" }, kursRubrik,
    lista.length
      ? h("ul", { class: "sf-kurs-grid sf-lista" }, lista.map((k, i) => kurskort(k, i, "h3")))
      : h("div", { class: "sf-tom sf-tom--liten" }, h("div", { class: "sf-stapel" },
          h("p", { class: "sf-rad-rubrik" }, "Du har inga kurser än"),
          h("p", { class: "sf-hjalp" }, "När du skapar en kurs visas den här."))));

  sida.replaceChildren(
    lista.length
      ? h("header", { class: "sf-stapel" }, h("h1", {}, "Hej!"), h("p", { class: "sf-ingress sf-text-2" }, "Vad vill du göra idag?"))
      : h("section", { class: "sf-valkommen" },
          h("img", { src: "/bilder/tudi.png", alt: "Tudi, StudFuns AI-lärare, vinkar", class: "sf-valkommen-tudi" }),
          h("div", { class: "sf-valkommen-text" },
            h("h1", {}, "Välkommen till StudFun!"),
            h("p", { class: "sf-ingress" }, "Här läser du ditt kursmaterial i din egen takt. Tudi kan läsa upp, förklara och öva med dig, och visar alltid vilken sida svaret kommer från."),
            h("ol", { class: "sf-steg-lista" },
              ["Skapa en kurs, till exempel Civilrätt", "Ladda upp kursmaterialet som PDF", "Läs, lyssna och öva tillsammans med Tudi"]
                .map((t, i) => h("li", {}, h("span", { class: "sf-steg-nr", "aria-hidden": "true" }, i + 1), t))),
            h("button", { type: "button", class: "sf-btn sf-btn--accent sf-btn--sjalv", onclick: nyKurs }, ikon("plus"), "Skapa din första kurs"))),
    kurssektion);
}
