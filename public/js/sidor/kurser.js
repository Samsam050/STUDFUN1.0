/* Mina kurser */
import { h, ikon, meddelande, felMedForsok, laddar } from "../dom.js";
import { api, app, navigera } from "../app.js";
import { kurskort, kursDialog } from "../kurs-delar.js";

export default async function visa(main) {
  const franMeny = location.search === "?meny";
  if (franMeny) history.replaceState(null, "", "/kurser");
  const nyKurs = () => kursDialog({ klar: k => { app.kvitto = `Kursen ${k.namn} är skapad.`; navigera(`/kurser/${k.id}`); } });

  const sida = h("div", { class: "sf-sida" },
    h("header", { class: "sf-sidhuvud sf-sidhuvud--knapp" },
      h("div", { class: "sf-stapel" }, h("h1", {}, "Mina kurser"),
        h("p", { class: "sf-ingress sf-text-2" }, "Varje kurs har sitt eget material, sina frågor och sina flashcards.")),
      h("button", { type: "button", class: "sf-btn sf-btn--accent", onclick: nyKurs }, ikon("plus"), "Skapa ny kurs")));
  main.append(sida);

  const innehall = laddar("Hämtar dina kurser …");
  sida.append(innehall);
  let lista;
  try { ({ kurser: lista } = await api("GET", "/api/kurser")); }
  catch (e) {
    innehall.replaceWith(felMedForsok("Kunde inte hämta kurserna.", () => { main.replaceChildren(); visa(main); }));
    return;
  }
  if (franMeny && lista.length === 1) return navigera(`/kurser/${lista[0].id}`, { ersatt: true });

  if (app.kvitto) { sida.append(meddelande("klar", app.kvitto)); app.kvitto = null; }
  innehall.replaceWith(lista.length
    ? h("ul", { class: "sf-kurs-grid sf-lista" }, lista.map((k, i) => kurskort(k, i)))
    : h("section", { class: "sf-tom" },
        h("img", { src: "/bilder/tudi.png", alt: "", class: "sf-tom-tudi" }),
        h("div", { class: "sf-stapel sf-stapel--luft sf-vaxer" },
          h("h2", {}, "Du har inga kurser än"),
          h("p", {}, "Skapa en kurs för varje ämne du läser, till exempel Civilrätt. Sedan laddar du upp materialet i kursen."),
          h("button", { type: "button", class: "sf-btn sf-btn--accent sf-btn--sjalv", onclick: nyKurs }, ikon("plus"), "Skapa din första kurs"))));
}
