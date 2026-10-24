/* Startsidan. I steg 1 finns inga kurser än, så den visar välkomstrutan.
   Kurserna, snabbvalen och nästa steg läggs till i steg 2, 3 och 7. */
import { h } from "../dom.js";

export default function (main) {
  main.append(
    h("div", { class: "sf-sida" },
      h("section", { class: "sf-valkommen" },
        h("img", { src: "/bilder/tudi.png", alt: "Tudi, StudFuns AI-lärare, vinkar", class: "sf-valkommen-tudi" }),
        h("div", { class: "sf-valkommen-text" },
          h("h1", {}, "Välkommen till StudFun!"),
          h("p", { class: "sf-ingress" }, "Här läser du ditt kursmaterial i din egen takt. Tudi kan läsa upp, förklara och öva med dig, och visar alltid vilken sida svaret kommer från."),
          h("ol", { class: "sf-steg-lista" },
            ["Skapa en kurs, till exempel Civilrätt", "Ladda upp kursmaterialet som PDF", "Läs, lyssna och öva tillsammans med Tudi"]
              .map((t, i) => h("li", {}, h("span", { class: "sf-steg-nr", "aria-hidden": "true" }, i + 1), t)))))));
}
