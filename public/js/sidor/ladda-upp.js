/* Ladda upp PDF. Filtypen kontrolleras på innehållet innan något skickas.
   Texten plockas ut här i webbläsaren med pdf.js, sedan skickas texten och filen till servern.
   Fler filer läggs i kö och visas som egna rader. */
import { h, ikon, felMedForsok } from "../dom.js";
import { api } from "../app.js";
import { oppnaPdf, sidtext } from "../pdf.js";

const MAX_MB = 50;
const MAX_SIDOR = 300;
const MIN_TECKEN_PER_SIDA = 10;
const BARA_PDF = "StudFun kan bara läsa PDF just nu.";

/* Vilken sorts fil det är, utifrån de första byten. Namnet används bara för att säga vad det är. */
async function filtyp(fil) {
  const b = String.fromCharCode(...new Uint8Array(await fil.slice(0, 8).arrayBuffer()));
  if (b.startsWith("%PDF-")) return "pdf";
  const namn = fil.name.toLowerCase();
  if (/\.(docx?|odt|rtf|pages)$/.test(namn)) return "en Word-fil";
  if (/\.(pptx?|odp|key)$/.test(namn)) return "en PowerPoint-fil";
  if (/\.(xlsx?|ods|numbers|csv)$/.test(namn)) return "ett kalkylark";
  if (/^\x89PNG|^\xFF\xD8\xFF|^GIF8/.test(b) || /\.(png|jpe?g|gif|webp|heic|tiff?)$/.test(namn)) return "en bildfil";
  if (namn.endsWith(".pdf")) return "inte en riktig PDF";
  return "inte en PDF";
}

const mb = n => (n / 1024 / 1024).toLocaleString("sv-SE", { maximumFractionDigits: 1 }) + " MB";

export default async function visa(main, { kursId }) {
  let kurser;
  try { ({ kurser } = await api("GET", "/api/kurser")); }
  catch {
    main.append(h("div", { class: "sf-sida" }, h("h1", {}, "Nytt material"),
      felMedForsok("Kunde inte hämta kurserna.", () => { main.replaceChildren(); visa(main, { kursId }); })));
    return;
  }
  let kurs = kurser.find(k => k.id === Number(kursId));
  if (!kurs) {
    main.append(h("div", { class: "sf-sida" }, h("h1", {}, "Kursen finns inte"),
      h("a", { href: "/kurser", class: "sf-btn sf-btn--primar sf-btn--sjalv" }, "Till Mina kurser")));
    return;
  }

  const tillbakaText = h("span", {}, `Tillbaka till ${kurs.namn}`);
  const tillbaka = h("a", { href: `/kurser/${kurs.id}`, class: "sf-tillbaka" }, ikon("tillbaka", 20), tillbakaText);
  const val = h("select", { id: "upp-kurs", class: "sf-falt sf-falt--kort" }, kurser.map(k => h("option", { value: k.id }, k.namn)));
  val.value = String(kurs.id);
  val.addEventListener("change", () => {
    kurs = kurser.find(k => k.id === Number(val.value));
    history.replaceState(null, "", `/kurser/${kurs.id}/ladda-upp`);
    tillbaka.href = `/kurser/${kurs.id}`;
    tillbakaText.textContent = `Tillbaka till ${kurs.namn}`;
  });

  const input = h("input", { type: "file", accept: "application/pdf,.pdf", multiple: true, class: "sf-osynlig", tabindex: "-1", "aria-hidden": "true" });
  const valjKnapp = h("button", { type: "button", class: "sf-btn sf-btn--accent", onclick: () => input.click() }, "Välj fil på datorn");
  input.addEventListener("change", () => { lagg([...input.files]); input.value = ""; });
  const zon = h("section", { class: "sf-uppladdning", "aria-label": "Välj fil" },
    h("span", { class: "sf-ikonruta sf-ikonruta--orange sf-ikonruta--stor", "aria-hidden": "true" }, ikon("laddaUpp", 32)),
    h("p", { class: "sf-uppladdning-rubrik" }, "Ladda upp PDF"),
    h("p", { class: "sf-text-2" }, "Bara PDF just nu."),
    valjKnapp,
    h("p", { class: "sf-hjalp" }, `Du kan också dra hit filen. Högst ${MAX_SIDOR} sidor och ${MAX_MB} MB per fil.`),
    input);
  zon.addEventListener("dragover", e => { e.preventDefault(); zon.classList.add("sf-uppladdning--over"); });
  zon.addEventListener("dragleave", () => zon.classList.remove("sf-uppladdning--over"));
  zon.addEventListener("drop", e => { e.preventDefault(); zon.classList.remove("sf-uppladdning--over"); lagg([...e.dataTransfer.files]); });

  const rader = h("div", { class: "sf-stapel sf-stapel--luft" });
  const ko = [];
  let igang = false;
  function lagg(filer) {
    for (const f of filer) { const r = rad(f); rader.append(r.el); ko.push(r); }
    kor();
  }
  async function kor() {
    if (igang) return;
    igang = true;
    while (ko.length && main.isConnected) await ko.shift().starta();
    igang = false;
  }

  /* En rad per fil, med eget förlopp, egna fel och egen avbryt-knapp */
  function rad(fil) {
    const titel = fil.name.replace(/\.pdf$/i, "") || "Namnlös PDF";
    const statusText = h("span", { role: "status" }, "Väntar på sin tur …");
    const procentText = h("span", { class: "sf-procent" });
    const stapelFyll = h("div", { class: "sf-stapel-fyll" });
    const stapel = h("div", { class: "sf-forlopp", role: "progressbar", "aria-label": `Förlopp för ${fil.name}`, "aria-valuemin": 0, "aria-valuemax": 100, "aria-valuenow": 0 }, stapelFyll);
    const avbryt = h("button", { type: "button", class: "sf-btn sf-btn--sekundar sf-btn--liten", "aria-label": `Avbryt ${fil.name}` }, "Avbryt");
    const notis = h("p", { hidden: true });
    const el = h("section", { class: "sf-ruta sf-uppladdning-rad", "aria-label": fil.name },
      h("div", { class: "sf-rad-mellan" },
        h("span", { class: "sf-ikonruta sf-ikonruta--gradde", "aria-hidden": "true" }, ikon("dokument")),
        h("div", { class: "sf-stapel sf-vaxer" }, h("span", { class: "sf-rad-rubrik sf-bryt" }, fil.name), h("span", { class: "sf-etikett" }, mb(fil.size))),
        avbryt),
      h("div", { class: "sf-stapel" }, h("div", { class: "sf-rad-mellan" }, statusText, procentText), stapel),
      notis);

    let avbruten = false, xhr = null, docId = null;
    avbryt.addEventListener("click", async () => {
      avbruten = true;
      if (xhr) xhr.abort();
      if (docId) api("DELETE", `/api/dokument/${docId}`).catch(() => {});
      el.remove();
      valjKnapp.focus();
    });

    function forlopp(text, andel) {
      statusText.textContent = text;
      const p = Math.round(andel * 100);
      procentText.textContent = andel == null ? "" : `${p} %`;
      stapel.setAttribute("aria-valuenow", p || 0);
      stapelFyll.style.width = `${p || 0}%`;
    }

    function fel(rubrik, text, tips) {
      el.replaceChildren(h("div", { class: "sf-medd-stor sf-medd-stor--fel", role: "alert" },
        h("div", { class: "sf-rad" }, ikon("fel", 28), h("p", { class: "sf-medd-rubrik" }, rubrik)),
        h("p", {}, text), tips && h("p", {}, tips),
        h("p", { class: "sf-etikett" }, fil.name),
        h("button", { type: "button", class: "sf-btn sf-btn--primar sf-btn--sjalv", onclick: () => { el.remove(); input.click(); } }, "Välj en annan fil")));
    }

    /* Ett oväntat fel får inte stoppa kön */
    const starta = () => steg().catch(e => {
      console.error(e); // stannar i webbläsaren, når aldrig servern
      fel("Det gick inte att ladda upp filen", "Något gick fel. Försök igen om en stund.");
    });

    async function steg() {
      if (avbruten) return;
      const typ = await filtyp(fil);
      if (typ !== "pdf") return fel(`Det här är ${typ}.`, BARA_PDF);
      if (fil.size > MAX_MB * 1024 * 1024) return fel("Filen är för stor", `Den är ${mb(fil.size)}. StudFun klarar högst ${MAX_MB} MB per fil.`, "Dela upp den i mindre delar, till exempel ett kapitel per fil.");

      forlopp("Läser PDF:en …", 0);
      let pdf, antalSidor;
      try { pdf = await oppnaPdf(new Uint8Array(await fil.arrayBuffer())); }
      catch (e) {
        if (e && e.name === "PasswordException") return fel("PDF:en är låst", "Den har ett lösenord, och då kan Tudi inte läsa den.", "Spara en version utan lösenord och prova igen.");
        return fel("Den här PDF:en går inte att läsa", "Filen verkar vara skadad.", "Prova att spara den på nytt eller hämta den igen.");
      }
      try {
        antalSidor = pdf.numPages;
        if (pdf.numPages > MAX_SIDOR) return fel("PDF:en är för lång", `Den har ${pdf.numPages} sidor. StudFun klarar högst ${MAX_SIDOR} sidor per fil.`, "Dela upp den i mindre delar, till exempel ett kapitel per fil, och ladda upp dem en i taget.");
        const sidor = [];
        for (let nr = 1; nr <= pdf.numPages; nr++) {
          if (avbruten) return;
          sidor.push(await sidtext(pdf, nr));
          forlopp(`Läser sida ${nr} av ${pdf.numPages} …`, nr / pdf.numPages);
        }
        const tecken = sidor.reduce((n, s) => n + s.replace(/\s/g, "").length, 0);
        if (tecken < MIN_TECKEN_PER_SIDA * sidor.length) return fel("Den här PDF:en går inte att läsa", "Den verkar vara inskannad, alltså en bild av text. Då kan Tudi inte läsa den.", "Prova att hitta en version där du kan markera texten, eller fråga din lärare om en sådan finns.");

        forlopp("Laddar upp …", 0);
        ({ id: docId } = await api("POST", `/api/kurser/${kurs.id}/dokument`, { titel, sidor }));
        if (avbruten) return;
        await skickaFil(docId, p => forlopp("Laddar upp …", p));
      } catch (e) {
        if (avbruten) return;
        if (docId) api("DELETE", `/api/dokument/${docId}`).catch(() => {});
        return fel("Det gick inte att ladda upp filen", e.message);
      } finally { pdf.loadingTask.destroy(); } // pdf.js 6: dokumentet stängs via sin laddning

      avbryt.remove();
      forlopp("Bearbetas …", 1);
      notis.hidden = false;
      notis.textContent = "Tudi gör i ordning texten. Du kan lämna sidan, vi sparar allt.";
      vantaPaKlar(kurs, antalSidor); // nästa fil i kön behöver inte vänta på det här
    }

    async function vantaPaKlar(kursNu, antalSidor) {
      for (;;) {
        await new Promise(r => setTimeout(r, 3000));
        if (!el.isConnected) return;
        let d;
        try { d = await api("GET", `/api/dokument/${docId}`); } catch { continue; }
        if (d.status === "klar") break;
        if (d.status === "fel") return fel("Det gick inte att göra i ordning filen", "Något gick fel hos oss. Radera filen i kursen och ladda upp den igen.");
      }
      el.replaceChildren(h("div", { class: "sf-medd-stor sf-medd-stor--klar", role: "status" },
        h("img", { src: "/bilder/tudi.png", alt: "", class: "sf-medd-tudi" }),
        h("div", { class: "sf-stapel sf-stapel--luft sf-vaxer" },
          h("p", { class: "sf-medd-rubrik sf-gron-text" }, "Klart! Filen är redo."),
          h("p", {}, `${titel}, ${sidorText(antalSidor)}, finns nu i ${kursNu.namn}.`),
          h("a", { href: `/kurser/${kursNu.id}`, class: "sf-btn sf-btn--primar sf-btn--sjalv" }, `Till ${kursNu.namn}`))));
    }

    /* fetch kan inte visa förlopp för uppladdning, därför XMLHttpRequest här */
    function skickaFil(id, vidFramsteg) {
      return new Promise((klar, misslyckad) => {
        xhr = new XMLHttpRequest();
        xhr.open("PUT", `/api/dokument/${id}/fil`);
        xhr.setRequestHeader("Content-Type", "application/pdf");
        xhr.upload.onprogress = e => { if (e.lengthComputable) vidFramsteg(e.loaded / e.total); };
        xhr.onload = () => {
          let svar = {};
          try { svar = JSON.parse(xhr.responseText); } catch { /* inget svar */ }
          if (xhr.status < 300) klar(svar); else misslyckad(new Error(svar.fel || "Något gick fel. Försök igen om en stund."));
        };
        xhr.onerror = () => misslyckad(new Error("Uppladdningen avbröts. Kontrollera internetanslutningen och försök igen."));
        xhr.onabort = () => misslyckad(new Error("Uppladdningen avbröts."));
        xhr.send(fil);
      });
    }

    return { el, starta };
  }

  main.append(h("div", { class: "sf-sida sf-sida--smal" },
    h("header", { class: "sf-kurs-huvud" }, tillbaka, h("h1", {}, "Nytt material")),
    h("div", { class: "sf-rad sf-rad--luft" }, h("label", { for: "upp-kurs", class: "sf-etikett-stor" }, "Till kurs"), val),
    zon,
    rader));
}

const sidorText = n => (n === 1 ? "1 sida" : `${n} sidor`);
