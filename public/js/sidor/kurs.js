/* En kurs: namn och termin, materialet och radera kursen.
   Öva kommer i steg 6. */
import { h, ikon, meddelande, felMedForsok, dialog, laddar } from "../dom.js";
import { api, app } from "../app.js";
import { kursDialog } from "../kurs-delar.js";
import { kommIhagKurs } from "./fraga.js";

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
  kommIhagKurs(kurs.id);

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

  /* Materialet. Uppdateras av sig själv medan någon fil bearbetas. */
  const materialRuta = h("div", {}, laddar("Hämtar materialet …", 1));
  const fragaRuta = h("span", { class: "sf-knapprad" });
  const fragaSparr = h("p", { id: "fraga-sparr", class: "sf-hjalp", hidden: true }, "Fråga Tudi går att använda när en PDF i kursen är klar.");
  const meddela = h("p", { class: "sf-dold", "aria-live": "polite" });
  let forra = new Map();
  async function hamtaMaterial() {
    let lista;
    try { ({ dokument: lista } = await api("GET", `/api/kurser/${kurs.id}/dokument`)); }
    catch { materialRuta.replaceChildren(felMedForsok("Kunde inte hämta materialet.", hamtaMaterial)); return; }
    for (const d of lista) if (forra.get(d.id) === "bearbetas" && d.status === "klar") meddela.textContent = `${d.titel} är klar.`;
    forra = new Map(lista.map(d => [d.id, d.status]));
    materialRuta.replaceChildren(lista.length ? h("ul", { class: "sf-lista sf-material" }, lista.map(materialRad)) : tomKurs());
    /* Fråga Tudi är spärrad, med en förklaring, tills en PDF är klar */
    const klar = lista.some(d => d.status === "klar");
    fragaRuta.replaceChildren(klar
      ? h("a", { href: `/kurser/${kurs.id}/fraga`, class: "sf-btn sf-btn--primar" }, ikon("chatt", 22), "Fråga Tudi")
      : h("button", { type: "button", class: "sf-btn sf-btn--primar", disabled: true, "aria-describedby": "fraga-sparr" }, ikon("chatt", 22), "Fråga Tudi"));
    fragaSparr.hidden = klar;
    if (lista.some(d => d.status === "bearbetas")) setTimeout(() => { if (materialRuta.isConnected) hamtaMaterial(); }, 3000);
  }
  const tomKurs = () => h("div", { class: "sf-tom" },
    h("img", { src: "/bilder/tudi.png", alt: "", class: "sf-tom-tudi" }),
    h("div", { class: "sf-stapel sf-stapel--luft sf-vaxer" },
      h("p", { class: "sf-rad-rubrik" }, "Kursen har inget material än"),
      h("p", {}, "Ladda upp en PDF, till exempel kursboken eller anteckningar från en föreläsning. Sedan kan Tudi läsa upp, förklara och göra övningar."),
      h("a", { href: `/kurser/${kurs.id}/ladda-upp`, class: "sf-btn sf-btn--accent sf-btn--sjalv" }, ikon("laddaUpp", 22), "Ladda upp din första PDF")));
  const STATUS = {
    klar: ["klar", "bock", "Klar"],
    bearbetas: ["vantar", "klocka", "Bearbetas", "Tudi gör i ordning filen. Det brukar ta någon minut."],
    fel: ["fel", "fel", "Gick inte att läsa", "Något gick fel när filen gjordes i ordning. Radera den och ladda upp den igen."],
  };
  function materialRad(d) {
    const [klass, ik, text, not] = STATUS[d.status] || STATUS.bearbetas;
    return h("li", { class: "sf-material-rad" },
      h("span", { class: "sf-ikonruta sf-ikonruta--gradde", "aria-hidden": "true" }, ikon("dokument")),
      h("div", { class: "sf-stapel sf-vaxer" },
        h("span", { class: "sf-rad-rubrik sf-bryt" }, d.titel),
        h("span", { class: "sf-rad" },
          h("span", { class: "sf-etikett" }, d.sidor === 1 ? "1 sida" : `${d.sidor} sidor`),
          h("span", { class: `sf-marke sf-marke--${klass}` }, ikon(ik, 18), text)),
        not && h("span", { class: "sf-hjalp" }, not)),
      h("div", { class: "sf-knapprad" },
        d.status !== "fel" && h("a", { href: `/kurser/${kurs.id}/visa/${d.id}?sida=${d.senastSida}`, class: "sf-btn sf-btn--sekundar sf-btn--liten", "aria-label": `Öppna ${d.titel}` }, "Öppna"),
        d.status === "fel" && h("a", { href: `/kurser/${kurs.id}/ladda-upp`, class: "sf-btn sf-btn--sekundar sf-btn--liten" }, "Ladda upp igen"),
        h("button", { type: "button", class: "sf-btn sf-btn--fara-kant sf-btn--liten", "aria-label": `Radera ${d.titel}`, onclick: () => raderaFil(d) }, "Radera")));
  }
  const raderaFil = d => dialog({
    rubrik: `Radera ${d.titel}?`,
    text: "Filen försvinner, och Tudi kan inte längre svara utifrån den. Det går inte att ångra.",
    knapp: "Radera filen",
    utfor: async () => {
      await api("DELETE", `/api/dokument/${d.id}`);
      return () => {
        status.replaceChildren(meddelande("klar", `${d.titel} är raderad.`));
        hamtaMaterial();
        status.querySelector(".sf-medd").setAttribute("tabindex", "-1");
        status.querySelector(".sf-medd").focus();
      };
    },
  });
  hamtaMaterial();

  main.append(h("div", { class: "sf-sida" },
    h("header", { class: "sf-kurs-huvud" },
      h("a", { href: "/kurser", class: "sf-tillbaka" }, ikon("tillbaka", 20), "Alla kurser"),
      h("div", { class: "sf-sidhuvud sf-sidhuvud--knapp" },
        h("div", { class: "sf-stapel" }, rubrik, termin),
        h("div", { class: "sf-knapprad" },
          h("a", { href: `/kurser/${kurs.id}/ladda-upp`, class: "sf-btn sf-btn--accent" }, ikon("laddaUpp", 22), "Ladda upp PDF"),
          fragaRuta,
          h("button", { type: "button", class: "sf-btn sf-btn--sekundar", onclick: andra }, "Ändra namn och termin"))),
      fragaSparr),
    status,
    h("section", { class: "sf-stapel sf-stapel--luft", "aria-labelledby": "material-rubrik" },
      h("h2", { id: "material-rubrik" }, "Material"), materialRuta, meddela),
    h("section", { class: "sf-sektion sf-rad-mellan", "aria-labelledby": "radera-rubrik" },
      h("div", { class: "sf-stapel sf-vaxer" }, h("h2", { id: "radera-rubrik" }, "Radera kursen"),
        h("p", { class: "sf-hjalp" }, "Allt material, alla frågor och alla flashcards i kursen försvinner.")),
      h("button", { type: "button", class: "sf-btn sf-btn--fara-kant", onclick: radera }, "Radera kursen"))));
}
