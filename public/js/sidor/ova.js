/* Öva: quiz och flashcards från kursens material. /ova öppnar quiz för kursen studenten senast använde.
   Servern rättar varje svar och sparar det. */
import { h, ikon, felMedForsok } from "../dom.js";
import { api, app, navigera } from "../app.js";
import * as ljud from "../upplasning.js";
import { kommIhagKurs, senasteKurs } from "./fraga.js";

/* Gemensamt för quiz och flashcards: kursen, en ny omgång, och lägena laddar, tomt och fel.
   repetera: i stället för en ny omgång, frågorna studenten senast svarade fel på */
async function starta(main, kursId, typ, rita, repetera = false) {
  if (!kursId) {
    let k;
    try { k = await senasteKurs(); }
    catch { main.append(h("div", { class: "sf-sida" }, h("h1", {}, "Öva"), felMedForsok("Kunde inte hämta kurserna.", () => { main.replaceChildren(); starta(main, kursId, typ, rita, repetera); }))); return; }
    if (k) return navigera(`/kurser/${k.id}/ova/quiz`, { ersatt: true });
    main.append(h("div", { class: "sf-sida" }, h("h1", {}, "Öva"), h("p", {}, "Skapa en kurs och ladda upp material först. Sedan kan Tudi göra quiz och flashcards från det."),
      h("a", { href: "/kurser", class: "sf-btn sf-btn--primar sf-btn--sjalv" }, "Till Mina kurser")));
    return;
  }
  let kurs;
  try { kurs = await api("GET", `/api/kurser/${kursId}`); }
  catch (e) {
    main.append(h("div", { class: "sf-sida" }, h("h1", {}, e.status === 404 ? "Kursen finns inte" : "Öva"),
      e.status === 404 ? h("a", { href: "/kurser", class: "sf-btn sf-btn--primar sf-btn--sjalv" }, "Till Mina kurser")
        : felMedForsok("Kunde inte hämta kursen.", () => { main.replaceChildren(); starta(main, kursId, typ, rita, repetera); })));
    return;
  }
  kommIhagKurs(kurs.id);
  const quiz = typ === "quiz";
  const rubrik = `${repetera ? "Repetera" : quiz ? "Quiz" : "Flashcards"}: ${kurs.namn}`;
  document.title = `${rubrik} · StudFun`;
  const status = h("span", { class: "sf-etikett", role: "status" });
  const innehall = h("div", { class: "sf-stapel sf-stapel--luft" });
  main.append(h("div", { class: "sf-sida sf-sida--smal" },
    h("header", { class: "sf-stapel" },
      h("div", { class: "sf-rad-mellan" },
        h("a", { href: `/kurser/${kurs.id}`, class: "sf-tillbaka" }, ikon("tillbaka", 20), quiz ? "Avsluta quizet" : "Avsluta"),
        h("a", { href: `/kurser/${kurs.id}/ova/${quiz ? "flashcards" : "quiz"}`, class: "sf-tillbaka" }, quiz ? "Byt till flashcards" : "Byt till quiz")),
      h("h1", { class: "sf-ova-rubrik" }, rubrik), status),
    innehall));

  async function ny() {
    innehall.replaceChildren(h("div", { class: "sf-ruta sf-ova-laddar", role: "status" },
      h("img", { src: "/bilder/tudi-ansikte.png", alt: "", class: "sf-tudi-ansikte" }),
      h("p", {}, quiz ? "Tudi gör i ordning frågor från ditt material …" : "Tudi gör i ordning flashcards från ditt material …")));
    try {
      const { kort } = repetera ? await api("GET", `/api/kurser/${kurs.id}/repetera-${typ}`) : await api("POST", `/api/kurser/${kurs.id}/ova`, { typ });
      if (!kort.length) {
        innehall.replaceChildren(h("div", { class: "sf-ruta sf-resultat" },
          h("img", { src: "/bilder/tudi.png", alt: "", class: "sf-klar-tudi" }),
          h("div", { class: "sf-stapel sf-stapel--luft sf-vaxer" }, h("p", { class: "sf-rad-rubrik" }, "Du har inget att repetera just nu"),
            h("p", {}, "Allt du har övat på senast kunde du. Gör en ny omgång för att öva på mer."),
            h("a", { href: `/kurser/${kurs.id}/ova/${typ}`, class: "sf-btn sf-btn--accent sf-btn--sjalv" }, quiz ? "Nytt quiz" : "Nya flashcards"))));
        return;
      }
      rita({ kurs, kort, innehall, status, ny });
    } catch (e) {
      innehall.replaceChildren(e.status === 409
        ? h("div", { class: "sf-tom" }, h("img", { src: "/bilder/tudi.png", alt: "", class: "sf-tom-tudi" }),
            h("div", { class: "sf-stapel sf-stapel--luft sf-vaxer" }, h("p", { class: "sf-rad-rubrik" }, "Ladda upp material först"), h("p", {}, e.message),
              h("a", { href: `/kurser/${kurs.id}/ladda-upp`, class: "sf-btn sf-btn--accent sf-btn--sjalv" }, ikon("laddaUpp", 22), "Ladda upp PDF")))
        : felMedForsok(e.message, e.status === 429 ? null : ny));
      if (e.status === 429) innehall.querySelector("button")?.remove();
    }
  }
  await ny();
}

const sidaLank = (kurs, svar, text) => h("a", { href: `/kurser/${kurs.id}/visa/${svar.dokId}?sida=${svar.sida}`, class: "sf-kalla" }, ikon("dokument", 18), text);
const lasUpp = (dokId, text) => {
  const knapp = h("button", { type: "button", class: "sf-btn sf-btn--sekundar" }, ikon("hogtalare", 22), "Läs upp");
  knapp.addEventListener("click", async () => {
    try { await ljud.spela(await ljud.hamta(dokId, text), ljud.TEMPO[app.jag.installningar.tempo] || 1); } catch { /* uppläsningen är ett stöd, quizet fungerar utan */ }
  });
  return knapp;
};

/* Quiz: en fråga i taget, Kontrollera svar, sedan resultatsidan med ett nästa steg */
function ritaQuiz({ kurs, kort, innehall, status, ny }) {
  const resultat = [];
  let nr = 0;
  const fyll = h("div", { class: "sf-stapel-fyll" });
  const forlopp = h("div", { class: "sf-forlopp", role: "progressbar", "aria-label": "Hur långt du har kommit", "aria-valuemin": 1, "aria-valuemax": kort.length }, fyll);

  function fraga() {
    const k = kort[nr];
    status.textContent = `Fråga ${nr + 1} av ${kort.length}`;
    forlopp.setAttribute("aria-valuenow", nr + 1);
    fyll.style.width = `${((nr + 1) / kort.length) * 100}%`;
    const kontrollera = h("button", { type: "button", class: "sf-btn sf-btn--primar", disabled: true }, "Kontrollera svar");
    const svarRuta = h("div", {});
    let svarEl, varde = () => null;
    if (k.typ === "flerval") {
      const radioer = k.alternativ.map(a => h("input", { type: "radio", name: `svar-${k.id}`, value: a }));
      svarEl = h("div", { class: "sf-stapel sf-alternativ", role: "radiogroup", "aria-labelledby": "fraga-text" },
        k.alternativ.map((a, i) => h("label", { class: "sf-alt" }, radioer[i], h("span", { class: "sf-vaxer" }, a), h("span", { class: "sf-alt-etikett" }))));
      svarEl.addEventListener("change", () => { kontrollera.disabled = false; });
      varde = () => radioer.find(r => r.checked)?.value;
    } else {
      const falt = h("input", { id: "kort-svar", class: "sf-falt", type: "text", autocomplete: "off", maxlength: "200", placeholder: "Skriv här" });
      falt.addEventListener("input", () => { kontrollera.disabled = !falt.value.trim(); });
      falt.addEventListener("keydown", e => { if (e.key === "Enter" && falt.value.trim()) kontrollera.click(); });
      svarEl = h("div", { class: "sf-falt-grupp" }, h("label", { for: "kort-svar" }, "Ditt svar, ett eller några ord"), falt);
      varde = () => falt.value.trim();
    }
    const knappar = h("div", { class: "sf-knapprad" }, kontrollera);
    kontrollera.addEventListener("click", async () => {
      kontrollera.disabled = true;
      const v = varde();
      let svar;
      try { svar = await api("POST", `/api/kort/${k.id}/svar`, k.typ === "flerval" ? { val: v } : { text: v }); }
      catch (e) { svarRuta.replaceChildren(felMedForsok(e.message, () => { svarRuta.replaceChildren(); kontrollera.click(); })); kontrollera.disabled = false; return; }
      resultat.push({ k, svar });
      svarEl.querySelectorAll("input").forEach(i => { i.disabled = true; });
      /* Fel svar markeras med orange och texten Ditt svar, rätt svar med grönt. Inte bara med färg. */
      svarEl.querySelectorAll(".sf-alt").forEach(l => {
        const a = l.querySelector("input").value;
        if (a === svar.rattSvar) { l.classList.add("sf-alt--ratt"); l.querySelector(".sf-alt-etikett").textContent = "Rätt svar"; }
        else if (a === v) { l.classList.add("sf-alt--fel"); l.querySelector(".sf-alt-etikett").textContent = "Ditt svar"; }
      });
      svarRuta.replaceChildren(h("div", { class: `sf-medd-stor sf-ruta sf-quiz-svar sf-quiz-svar--${svar.ratt ? "ratt" : "fel"}`, role: "status" },
        h("p", { class: "sf-medd-rubrik sf-rad" }, ikon(svar.ratt ? "bock" : "fel", 26), svar.ratt ? "Rätt!" : "Inte riktigt"),
        !svar.ratt && h("p", {}, h("strong", {}, "Rätt svar: "), svar.rattSvar),
        svar.forklaring && h("p", {}, svar.forklaring),
        sidaLank(kurs, svar, `Det står på sida ${svar.sida}`)));
      const sista = nr === kort.length - 1;
      const vidare = h("button", { type: "button", class: "sf-btn sf-btn--primar" }, sista ? "Se resultatet" : "Nästa fråga", ikon("pil", 22));
      vidare.addEventListener("click", () => { nr++; sista ? visaResultat() : fraga(); });
      knappar.replaceChildren(vidare);
      vidare.focus();
    });
    innehall.replaceChildren(forlopp, h("section", { class: "sf-ruta sf-quiz", "aria-labelledby": "fraga-text" },
      h("div", { class: "sf-rad-mellan sf-rad--topp" }, h("h2", { id: "fraga-text", tabindex: "-1" }, k.fraga), lasUpp(k.dokId, k.fraga)),
      svarEl, svarRuta, knappar));
    innehall.querySelector("#fraga-text").focus();
  }

  function visaResultat() {
    const ratt = resultat.filter(r => r.svar.ratt).length;
    const forstaFel = resultat.find(r => !r.svar.ratt);
    status.textContent = "";
    innehall.replaceChildren(h("section", { class: "sf-stapel sf-stapel--luft", "aria-labelledby": "res-rubrik" },
      h("div", { class: "sf-ruta sf-resultat" },
        h("img", { src: "/bilder/tudi.png", alt: "", class: "sf-klar-tudi" }),
        h("div", { class: "sf-stapel sf-vaxer" },
          h("h2", { id: "res-rubrik", tabindex: "-1" }, `Du hade ${ratt} av ${resultat.length} rätt`),
          h("p", {}, ratt === resultat.length ? "Snyggt! Du kunde allt i den här omgången." : "Bra jobbat. Läs sidan där svaret står, och gör sedan quizet en gång till."))),
      h("ul", { class: "sf-lista sf-material" }, resultat.map(r => h("li", { class: "sf-material-rad" },
        h("span", { class: `sf-marke sf-marke--${r.svar.ratt ? "klar" : "fel"}` }, ikon(r.svar.ratt ? "bock" : "fel", 18), r.svar.ratt ? "Rätt" : "Fel"),
        h("span", { class: "sf-vaxer" }, r.k.fraga), h("span", { class: "sf-etikett" }, `Sida ${r.svar.sida}`)))),
      h("div", { class: "sf-nasta-steg sf-mork" },
        h("span", { class: "sf-nasta-etikett" }, "Nästa steg"),
        h("p", {}, forstaFel ? `Läs sida ${forstaFel.svar.sida} igen. Där står svaret på den första frågan du svarade fel på.` : "Gör ett nytt quiz, eller öva med flashcards."),
        h("div", { class: "sf-knapprad" },
          forstaFel ? h("a", { href: `/kurser/${kurs.id}/visa/${forstaFel.svar.dokId}?sida=${forstaFel.svar.sida}`, class: "sf-btn sf-btn--accent" }, `Läs sida ${forstaFel.svar.sida}`)
            : h("button", { type: "button", class: "sf-btn sf-btn--accent", onclick: ny }, "Nytt quiz"),
          h("button", { type: "button", class: "sf-btn sf-btn--ljus", onclick: () => { resultat.length = 0; nr = 0; fraga(); } }, "Gör quizet igen")))));
    innehall.querySelector("#res-rubrik").focus();
  }
  fraga();
}

/* Flashcards: vänd kortet, svara Kunde eller Kunde inte. Kort studenten inte kunde kommer tillbaka. */
function ritaFlashcards({ kurs, kort, innehall, status }) {
  let omgang = kort, nr = 0, vand = false;
  const kunde = [], inte = [];

  function visa() {
    const k = omgang[nr];
    status.textContent = `Kort ${nr + 1} av ${omgang.length}`;
    const kortKnapp = h("button", { type: "button", class: `sf-kort${vand ? " sf-kort--bak" : ""}`, "aria-label": `${vand ? `${k.fraga}: ${k.svar}` : k.fraga}`.replace(/[.!?]?$/, ".") + (vand ? " Tryck för att vända tillbaka." : " Tryck för att vända kortet.") },
      h("span", { class: "sf-etikett" }, vand ? `Förklaring · sida ${k.sida}` : "Begrepp"),
      vand ? h("span", { class: "sf-stapel" }, h("span", { class: "sf-kort-begrepp sf-kort-begrepp--liten" }, k.fraga), h("span", { class: "sf-kort-text" }, k.svar))
        : h("span", { class: "sf-kort-begrepp" }, k.fraga),
      h("span", { class: "sf-hjalp sf-rad sf-rad--tat" }, ikon("pil", 18), vand ? "Vänd tillbaka" : "Tryck på kortet för att vända"));
    kortKnapp.addEventListener("click", () => { vand = !vand; visa(); innehall.querySelector(".sf-kort").focus(); });
    const svara = ok => async () => {
      try { await api("POST", `/api/kort/${k.id}/svar`, { kunde: ok }); } catch { /* svaret sparas inte, men studenten kan öva vidare */ }
      (ok ? kunde : inte).push(k);
      vand = false;
      nr++;
      if (nr < omgang.length) { visa(); innehall.querySelector(".sf-kort").focus(); } else klar();
    };
    innehall.replaceChildren(kortKnapp,
      h("div", { class: "sf-rad-mellan" },
        h("div", { class: "sf-knapprad" }, lasUpp(k.dokId, vand ? k.svar : k.fraga), vand && sidaLank(kurs, k, `Öppna sida ${k.sida}`)),
        vand ? h("div", { class: "sf-knapprad", role: "group", "aria-label": "Kunde du det?" },
            h("button", { type: "button", class: "sf-btn sf-btn--accent", onclick: svara(false) }, "Kunde inte"),
            h("button", { type: "button", class: "sf-btn sf-btn--primar", onclick: svara(true) }, "Kunde"))
          : h("button", { type: "button", class: "sf-btn sf-btn--primar", onclick: () => kortKnapp.click() }, "Vänd kortet")),
      h("p", { class: "sf-hjalp" }, "Tänk på svaret först. Vänd sedan kortet och svara ärligt. Korten du inte kunde kommer tillbaka."));
  }

  function klar() {
    status.textContent = "";
    const svara = [...inte];
    innehall.replaceChildren(h("section", { class: "sf-stapel sf-stapel--luft" },
      h("div", { class: "sf-ruta sf-resultat" },
        h("img", { src: "/bilder/tudi.png", alt: "", class: "sf-klar-tudi" }),
        h("div", { class: "sf-stapel sf-vaxer" },
          h("h2", { id: "klar-rubrik", tabindex: "-1" }, `Du kunde ${kunde.length} av ${kunde.length + inte.length}`),
          h("p", {}, svara.length ? "Korten du inte kunde är bra att öva på en gång till." : "Du kunde alla kort i den här omgången."))),
      h("div", { class: "sf-nasta-steg sf-mork" },
        h("span", { class: "sf-nasta-etikett" }, "Nästa steg"),
        h("p", {}, svara.length === 1 ? "Öva på kortet du inte kunde." : svara.length ? `Öva på de ${svara.length} kort du inte kunde.` : "Gör ett quiz och se hur mycket du minns."),
        h("div", { class: "sf-knapprad" },
          svara.length ? h("button", { type: "button", class: "sf-btn sf-btn--accent", onclick: () => { omgang = svara; nr = 0; kunde.length = inte.length = 0; visa(); innehall.querySelector(".sf-kort").focus(); } }, "Öva på dem nu")
            : h("a", { href: `/kurser/${kurs.id}/ova/quiz`, class: "sf-btn sf-btn--accent" }, "Gör ett quiz"),
          h("a", { href: `/kurser/${kurs.id}`, class: "sf-btn sf-btn--ljus" }, "Till kursen")))));
    innehall.querySelector("#klar-rubrik").focus();
  }
  visa();
}

export const quiz = (main, { kursId }) => starta(main, kursId, "quiz", ritaQuiz);
export const flashcards = (main, { kursId }) => starta(main, kursId, "flashcards", ritaFlashcards, location.search === "?repetera");
export const repetera = (main, { kursId }) => starta(main, kursId, "quiz", ritaQuiz, true);
