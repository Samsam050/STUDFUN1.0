/* Visas efter att kontot raderats. Studenten är redan utloggad. */
import { h } from "../dom.js";

export default function (main) {
  main.className = "sf-ensam";
  main.append(
    h("section", { class: "sf-ruta sf-ruta--stor" },
      h("h1", {}, "Ditt konto är raderat"),
      h("p", {}, "Allt material och alla uppgifter är borttagna."),
      h("a", { href: "/logga-in", class: "sf-btn sf-btn--primar" }, "Till inloggningen")));
}
