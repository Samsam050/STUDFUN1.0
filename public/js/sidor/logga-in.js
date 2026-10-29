/* Logga in och skapa konto. Flikarna byter formulär utan att ladda om, ifyllda fält ligger kvar. */
import { h, ikon, meddelande } from "../dom.js";
import { api, app, navigera, tillampa } from "../app.js";

export default function (main) {
  let ny = location.pathname === "/skapa-konto";
  let visaLosen = false;

  const rubrik = h("h1", {});
  const toppFel = h("div", { class: "sf-topp-fel" });

  const flikIn = h("button", { type: "button", role: "tab", id: "flik-in", "aria-controls": "konto-form" }, "Logga in");
  const flikNy = h("button", { type: "button", role: "tab", id: "flik-ny", "aria-controls": "konto-form" }, "Skapa konto");
  const flikar = h("div", { class: "sf-flikar", role: "tablist", "aria-label": "Välj" }, flikIn, flikNy);
  flikIn.addEventListener("click", () => byt(false));
  flikNy.addEventListener("click", () => byt(true));
  flikar.addEventListener("keydown", e => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    byt(!ny);
    (ny ? flikNy : flikIn).focus();
  });

  const mejl = h("input", { id: "f-mejl", class: "sf-falt", type: "email", autocomplete: "email", placeholder: "namn@exempel.se", "aria-describedby": "f-mejl-fel" });
  const mejlFel = h("span", { id: "f-mejl-fel", class: "sf-faltfel" });
  const losen = h("input", { id: "f-losen", class: "sf-falt", type: "password", "aria-describedby": "f-losen-hjalp" });
  const losenHjalp = h("span", { id: "f-losen-hjalp", class: "sf-hjalp" });
  const visaKnapp = h("button", { type: "button", class: "sf-textknapp", "aria-controls": "f-losen" });
  visaKnapp.addEventListener("click", () => { visaLosen = !visaLosen; uppdatera(); });

  const godkann = h("input", { type: "checkbox", class: "sf-kryss", "aria-describedby": "f-godk-fel" });
  const godkannFel = h("span", { id: "f-godk-fel", class: "sf-faltfel" });
  const godkannRad = h("div", { class: "sf-falt-grupp" },
    h("label", { class: "sf-kryss-rad" }, godkann,
      h("span", {}, "Jag har läst och godkänner ",
        h("a", { href: "/integritet.html", target: "_blank", rel: "noopener" }, "hur StudFun hanterar mina uppgifter"))),
    godkannFel);

  /* Inbjudningskoden visas bara när servern kräver den, i betan */
  const kod = h("input", { id: "f-kod", class: "sf-falt", type: "text", autocomplete: "off", spellcheck: "false", "aria-describedby": "f-kod-fel" });
  const kodFel = h("span", { id: "f-kod-fel", class: "sf-faltfel" });
  const kodRad = h("div", { class: "sf-falt-grupp", hidden: true },
    h("label", { for: "f-kod" }, "Inbjudningskod"), kod,
    h("span", { class: "sf-hjalp" }, "StudFun är i beta. Du får koden av den som bjöd in dig."), kodFel);
  let kodKravs = false;
  fetch("/api/konto/krav").then(r => r.json()).then(j => { kodKravs = !!j.inbjudningskod; uppdatera(); }, () => {});

  const skickaKnapp = h("button", { type: "submit", class: "sf-btn sf-btn--primar sf-btn--bred" });
  const glomt = h("p", { class: "sf-hjalp" }, "Har du glömt lösenordet? Att återställa det själv kommer snart.");

  const form = h("form", { id: "konto-form", role: "tabpanel", novalidate: true, class: "sf-inlogg-form" },
    toppFel,
    h("div", { class: "sf-falt-grupp" }, h("label", { for: "f-mejl" }, "Mejladress"), mejl, mejlFel),
    h("div", { class: "sf-falt-grupp" },
      h("div", { class: "sf-falt-rad" }, h("label", { for: "f-losen" }, "Lösenord"), visaKnapp),
      losen, losenHjalp),
    kodRad,
    godkannRad,
    h("div", { class: "sf-inlogg-knappar" }, skickaKnapp, glomt));
  form.addEventListener("submit", skicka);

  function faltFel(falt, span, text) {
    falt.setAttribute("aria-invalid", text ? "true" : "false");
    span.replaceChildren(...(text ? [ikon("fel", 20), text] : []));
  }

  function byt(tillNy) {
    if (tillNy === ny) return;
    ny = tillNy;
    history.replaceState(null, "", ny ? "/skapa-konto" : "/logga-in");
    document.title = (ny ? "Skapa konto" : "Logga in") + " · StudFun";
    toppFel.replaceChildren();
    faltFel(mejl, mejlFel, ""); faltFel(godkann, godkannFel, ""); faltFel(kod, kodFel, "");
    losen.setAttribute("aria-invalid", "false");
    uppdatera();
  }

  function uppdatera(laddar = false) {
    rubrik.textContent = ny ? "Skapa ditt konto" : "Välkommen tillbaka";
    flikIn.setAttribute("aria-selected", String(!ny)); flikIn.tabIndex = ny ? -1 : 0;
    flikNy.setAttribute("aria-selected", String(ny)); flikNy.tabIndex = ny ? 0 : -1;
    form.setAttribute("aria-labelledby", ny ? "flik-ny" : "flik-in");
    losen.type = visaLosen ? "text" : "password";
    losen.autocomplete = ny ? "new-password" : "current-password";
    visaKnapp.textContent = visaLosen ? "Dölj lösenord" : "Visa lösenord";
    if (losen.getAttribute("aria-invalid") !== "true") {
      losenHjalp.className = "sf-hjalp";
      losenHjalp.textContent = ny ? "Minst 10 tecken. Du kan använda mellanslag." : "Skriv lösenordet du valde när du skapade kontot.";
    }
    godkannRad.hidden = !ny;
    kodRad.hidden = !(ny && kodKravs);
    glomt.hidden = ny;
    skickaKnapp.disabled = laddar;
    skickaKnapp.textContent = laddar ? (ny ? "Skapar konto …" : "Loggar in …") : (ny ? "Skapa konto" : "Logga in");
  }

  async function skicka(e) {
    e.preventDefault();
    toppFel.replaceChildren();
    const m = mejl.value.trim();
    const mejlText = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(m) ? "" : "Skriv en mejladress, till exempel namn@exempel.se.";
    faltFel(mejl, mejlFel, mejlText);
    let losenText = "";
    if (ny && losen.value.length < 10) losenText = "Lösenordet behöver minst 10 tecken.";
    if (!ny && !losen.value) losenText = "Skriv ditt lösenord.";
    losen.setAttribute("aria-invalid", losenText ? "true" : "false");
    if (losenText) { losenHjalp.className = "sf-faltfel"; losenHjalp.replaceChildren(ikon("fel", 20), losenText); }
    const kodText = ny && kodKravs && !kod.value.trim() ? "Skriv inbjudningskoden." : "";
    faltFel(kod, kodFel, kodText);
    const godkText = ny && !godkann.checked ? "Kryssa i rutan för att kunna skapa ett konto." : "";
    faltFel(godkann, godkannFel, godkText);
    uppdatera();
    const forsta = [mejlText && mejl, losenText && losen, kodText && kod, godkText && godkann].find(Boolean);
    if (forsta) return forsta.focus();

    uppdatera(true);
    try {
      app.jag = await api("POST", ny ? "/api/konto" : "/api/logga-in",
        ny ? { mejl: m, losen: losen.value, godkant: true, kod: kod.value.trim() } : { mejl: m, losen: losen.value });
      /* Kontrollera att webbläsaren sparade inloggningen, annars hamnar studenten tillbaka här utan förklaring */
      const sparad = await fetch("/api/jag").then(r => r.ok, () => false);
      if (!sparad) {
        app.jag = null;
        throw new Error("Webbläsaren sparade inte inloggningen. Kontrollera att kakor är tillåtna för den här sidan, och försök igen.");
      }
      tillampa(app.jag.installningar);
      navigera("/");
    } catch (err) {
      uppdatera();
      toppFel.replaceChildren(meddelande("fel", err.message));
    }
  }

  uppdatera();
  if (app.kvitto) { toppFel.replaceChildren(meddelande("klar", app.kvitto)); app.kvitto = null; }
  main.className = "sf-inlogg";
  main.append(
    h("aside", { class: "sf-inlogg-sida sf-mork" },
      h("img", { src: "/bilder/logga-vit.png", alt: "StudFun", class: "sf-inlogg-logga" }),
      h("div", { class: "sf-inlogg-text" },
        h("p", { class: "sf-inlogg-stor" }, "Läs, lyssna och öva på ditt eget kursmaterial."),
        h("p", { class: "sf-inlogg-ingress" }, "Tudi läser upp, förklarar och visar alltid vilken sida svaret kommer från.")),
      h("img", { src: "/bilder/tudi.png", alt: "", class: "sf-inlogg-tudi" })),
    h("div", { class: "sf-inlogg-huvud" },
      h("div", { class: "sf-inlogg-kolumn" }, rubrik, flikar, form)));
}
