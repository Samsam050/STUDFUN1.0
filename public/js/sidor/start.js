/* Startsidan: nästa steg, snabbval och kurserna. Nästa steg räknas fram av servern ur studentens egna svar och läsning. */
import { h, ikon, felMedForsok, laddar } from "../dom.js";
import { api, app, navigera } from "../app.js";
import { kurskort, kursDialog } from "../kurs-delar.js";

const antalOrd = (n, en, flera) => (n === 1 ? en : `de ${n} ${flera}`);

/* Rubrik, text, Tudis pratbubbla och knappar för varje sorts nästa steg */
function nastaSteg(n) {
  const las = (d, text, klass = "sf-btn--accent") => h("a", { href: `/kurser/${d.kursId}/visa/${d.dokId}?sida=${d.sida}`, class: `sf-btn ${klass}` }, text);
  switch (n.typ) {
    case "repetera": return {
      rubrik: `Repetera ${antalOrd(n.antal, "den fråga", "frågor")} du svarade fel på i ${n.kurs}`,
      text: `Det tar ungefär ${n.antal === 1 ? "en minut" : `${n.antal} minuter`}. Efter varje fråga ser du vilken sida svaret står på.`,
      bubbla: "Jag har gjort i ordning frågorna åt dig.",
      knappar: [h("a", { href: `/kurser/${n.kursId}/ova/repetera`, class: "sf-btn sf-btn--accent" }, "Börja repetera", ikon("pil", 22)),
        n.lasa && las(n.lasa, "Fortsätt läsa istället", "sf-btn--ljus")],
    };
    case "repeteraKort": return {
      rubrik: `Öva på ${antalOrd(n.antal, "det kort", "kort")} du inte kunde i ${n.kurs}`,
      text: "Vänd korten och svara ärligt. Korten du inte kan kommer tillbaka.",
      bubbla: "Korten väntar på dig.",
      knappar: [h("a", { href: `/kurser/${n.kursId}/ova/flashcards?repetera`, class: "sf-btn sf-btn--accent" }, "Börja öva", ikon("pil", 22)),
        n.lasa && las(n.lasa, "Fortsätt läsa istället", "sf-btn--ljus")],
    };
    case "fortsatt": return {
      rubrik: `Fortsätt läsa ${n.titel}`,
      text: `Du slutade på sida ${n.sida} i ${n.kurs}. Filen öppnas där, och du kan få den uppläst.`,
      bubbla: "Välkommen tillbaka!",
      knappar: [las(n, "Fortsätt läsa")],
    };
    case "borja": return {
      rubrik: `Börja läsa ${n.titel}`,
      text: `Filen är klar i ${n.kurs}. Du kan lyssna på texten medan du läser.`,
      bubbla: "Din fil är redo.",
      knappar: [las(n, "Börja läsa")],
    };
    case "ova": return {
      rubrik: `Öva på det du har läst i ${n.kurs}`,
      text: "Ett kort quiz visar vad du minns. Efter varje fråga ser du vilken sida svaret står på.",
      bubbla: "Ska vi se vad du kommer ihåg?",
      knappar: [h("a", { href: `/kurser/${n.kursId}/ova/quiz`, class: "sf-btn sf-btn--accent" }, "Gör ett quiz", ikon("pil", 22)),
        h("a", { href: `/kurser/${n.kursId}/ova/flashcards`, class: "sf-btn sf-btn--ljus" }, "Flashcards")],
    };
    default: return {
      rubrik: `Ladda upp material till ${n.kurs}`,
      text: "När du har laddat upp en PDF kan Tudi läsa upp, förklara och öva med dig.",
      bubbla: "Jag väntar på ditt material.",
      knappar: [h("a", { href: `/kurser/${n.kursId}/ladda-upp`, class: "sf-btn sf-btn--accent" }, ikon("laddaUpp", 22), "Ladda upp PDF")],
    };
  }
}

export default async function visa(main) {
  const nyKurs = () => kursDialog({ klar: k => { app.kvitto = `Kursen ${k.namn} är skapad.`; navigera(`/kurser/${k.id}`); } });
  const sida = h("div", { class: "sf-sida" });
  main.append(sida);
  const vantar = laddar("Hämtar dina kurser …");
  sida.append(vantar);

  let lista, nasta;
  try { [{ kurser: lista }, nasta] = await Promise.all([api("GET", "/api/kurser"), api("GET", "/api/nasta-steg")]); }
  catch {
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

  if (!lista.length) {
    sida.replaceChildren(
      h("section", { class: "sf-valkommen" },
        h("img", { src: "/bilder/tudi.png", alt: "Tudi, StudFuns AI-lärare, vinkar", class: "sf-valkommen-tudi" }),
        h("div", { class: "sf-valkommen-text" },
          h("h1", {}, "Välkommen till StudFun!"),
          h("p", { class: "sf-ingress" }, "Här läser du ditt kursmaterial i din egen takt. Tudi kan läsa upp, förklara och öva med dig, och visar alltid vilken sida svaret kommer från."),
          h("ol", { class: "sf-steg-lista" },
            ["Skapa en kurs, till exempel Civilrätt", "Ladda upp kursmaterialet som PDF", "Läs, lyssna och öva tillsammans med Tudi"]
              .map((t, i) => h("li", {}, h("span", { class: "sf-steg-nr", "aria-hidden": "true" }, i + 1), t))),
          h("button", { type: "button", class: "sf-btn sf-btn--accent sf-btn--sjalv", onclick: nyKurs }, ikon("plus"), "Skapa din första kurs"))),
      kurssektion);
    return;
  }

  const n = nastaSteg(nasta);
  const snabbval = [
    ["/fraga", "chatt", "Fråga Tudi", "Ställ en fråga om ditt material", ""],
    ["/ladda-upp", "laddaUpp", "Ladda upp material", "Lägg till en PDF i en kurs", " sf-ikonruta--orange"],
    ["/ova", "ova", "Öva", "Quiz och flashcards", ""],
  ];
  sida.replaceChildren(
    h("header", { class: "sf-stapel" }, h("h1", {}, "Hej!"), h("p", { class: "sf-ingress sf-text-2" }, "Vad vill du göra idag?")),
    h("section", { class: "sf-nasta-steg sf-nasta-steg--start sf-mork", "aria-labelledby": "nasta-steg" },
      h("div", { class: "sf-stapel sf-stapel--luft sf-vaxer sf-nasta-text" },
        h("span", { class: "sf-nasta-etikett" }, "Nästa steg"),
        h("h2", { id: "nasta-steg" }, n.rubrik),
        h("p", { class: "sf-nasta-brod" }, n.text),
        h("div", { class: "sf-knapprad" }, n.knappar)),
      h("div", { class: "sf-nasta-tudi", "aria-hidden": "true" },
        h("p", { class: "sf-pratbubbla" }, n.bubbla),
        h("img", { src: "/bilder/tudi.png", alt: "" }))),
    h("section", { class: "sf-stapel sf-stapel--luft", "aria-labelledby": "snabbval" },
      h("h2", { id: "snabbval" }, "Snabbval"),
      h("div", { class: "sf-kurs-grid" }, snabbval.map(([adress, ik, rubrik, text, farg]) =>
        h("a", { href: adress, class: "sf-ruta sf-snabbval" },
          h("span", { class: `sf-ikonruta sf-ikonruta--stor-ish${farg}`, "aria-hidden": "true" }, ikon(ik, 26)),
          h("span", { class: "sf-stapel" }, h("span", { class: "sf-snabbval-rubrik" }, rubrik), h("span", { class: "sf-hjalp" }, text)))))),
    kurssektion);
}
