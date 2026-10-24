/* Inställningar och konto. Ändringar sparas direkt och gäller i hela tjänsten. */
import { h, ikon, meddelande, dialog } from "../dom.js";
import { api, app, navigera, tillampa } from "../app.js";
import * as ljud from "../upplasning.js";

const STORLEKAR = [["Mellan", 20], ["Stor", 22], ["Större", 26], ["Störst", 30]];
const ROSTER = [["marin", "Röst 1, ljus och tydlig"], ["cedar", "Röst 2, mörk och lugn"], ["shimmer", "Röst 3, mjuk"]];
const TEMPON = [["langsamt", "Långsamt"], ["normalt", "Normalt"], ["snabbt", "Snabbt"]];
const PROVTEXT = "Ett anbud gäller bara under en viss tid. Om anbudet saknar svarsfrist ska mottagaren svara inom skälig tid.";

export default function (main) {
  const status = h("div", { class: "sf-status-rad" });

  async function spara(andring) {
    const gammal = { ...app.jag.installningar };
    Object.assign(app.jag.installningar, andring);
    tillampa(app.jag.installningar);
    rita();
    status.replaceChildren();
    try {
      app.jag.installningar = await api("PUT", "/api/installningar", andring);
    } catch (e) {
      app.jag.installningar = gammal;
      tillampa(gammal);
      rita();
      status.replaceChildren(meddelande("fel", "Det gick inte att spara. Försök igen."));
    }
  }

  const storlekKnappar = STORLEKAR.map(([namn, px]) =>
    h("button", { type: "button", onclick: () => spara({ textstorlek: px }) }, `${namn} · ${px} px`));
  const typsnittVal = [["lexend", "Lexend", "Bred och luftig. Standard."], ["atkinson", "Atkinson Hyperlegible", "Tydliga bokstäver som är lätta att skilja åt."]]
    .map(([varde, namn, text]) => {
      const radio = h("input", { type: "radio", name: "typsnitt", value: varde, class: "sf-osynlig-radio", onchange: () => spara({ typsnitt: varde }) });
      return { varde, radio, el: h("label", { class: `sf-typkort sf-typkort--${varde}` }, radio,
        h("span", { class: "sf-typkort-namn" }, namn), h("span", { class: "sf-typkort-text" }, text)) };
    });
  const prov = h("p", { class: "sf-las-text" }, PROVTEXT);

  const rostVal = h("select", { id: "ins-rost", class: "sf-falt sf-falt--kort" }, ROSTER.map(([v, namn]) => h("option", { value: v }, namn)));
  rostVal.addEventListener("change", () => spara({ rost: rostVal.value }));
  const provKnapp = h("button", { type: "button", class: "sf-btn sf-btn--sekundar" });
  const provInfo = h("p", { class: "sf-hjalp", role: "status" });
  let provar = false;
  const ritaProv = () => provKnapp.replaceChildren(ikon("hogtalare", 22), provar ? "Spelar upp …" : "Lyssna på rösten");
  provKnapp.addEventListener("click", async () => {
    if (provar) return;
    provar = true; ritaProv(); provInfo.textContent = "";
    try { await ljud.spela(await ljud.hamtaProv(rostVal.value), ljud.TEMPO[app.jag.installningar.tempo] || 1); }
    catch (e) { provInfo.textContent = e.message; }
    provar = false; ritaProv();
  });
  ritaProv();
  const tempoKnappar = TEMPON.map(([v, namn]) => h("button", { type: "button", onclick: () => spara({ tempo: v }) }, namn));

  function rita() {
    const s = app.jag.installningar;
    storlekKnappar.forEach((k, i) => k.setAttribute("aria-pressed", String(STORLEKAR[i][1] === s.textstorlek)));
    typsnittVal.forEach(t => { t.radio.checked = t.varde === s.typsnitt; });
    rostVal.value = s.rost;
    tempoKnappar.forEach((k, i) => k.setAttribute("aria-pressed", String(TEMPON[i][0] === s.tempo)));
  }

  const raderaMaterial = () => dialog({
    rubrik: "Radera allt material?",
    text: "Alla PDF:er, frågor och flashcards i alla kurser tas bort. Kontot och kursernas namn finns kvar.",
    kryss: "Jag förstår att materialet försvinner och inte går att få tillbaka.",
    knapp: "Radera allt material",
    utfor: async () => {
      await api("POST", "/api/radera-material");
      status.replaceChildren(meddelande("klar", "Allt material är raderat."));
    },
  });
  const raderaKonto = () => dialog({
    rubrik: "Radera ditt konto?",
    text: "Kontot, alla kurser och allt du har laddat upp tas bort. Du kan inte logga in igen med det här kontot.",
    kryss: "Jag förstår att mitt konto försvinner för alltid och inte går att få tillbaka.",
    knapp: "Radera kontot",
    utfor: async () => {
      await api("DELETE", "/api/konto");
      app.jag = null;
      return () => navigera("/konto-raderat");
    },
  });
  async function loggaUt() {
    try { await api("POST", "/api/logga-ut"); } catch { /* kakan rensas ändå när sessionen går ut */ }
    app.jag = null;
    navigera("/logga-in");
  }

  main.append(h("div", { class: "sf-sida sf-sida--smal" },
    h("header", { class: "sf-sidhuvud" },
      h("h1", {}, "Inställningar"),
      h("span", { class: "sf-hjalp" }, "Ändringar sparas direkt")),
    status,
    h("section", { class: "sf-sektion", "aria-labelledby": "ins-las" },
      h("h2", { id: "ins-las" }, "Läsning"),
      h("div", { class: "sf-falt-grupp" },
        h("span", { id: "ins-storlek", class: "sf-etikett-stor" }, "Textstorlek i läsläget"),
        h("div", { class: "sf-seg", role: "group", "aria-labelledby": "ins-storlek" }, storlekKnappar)),
      h("fieldset", { class: "sf-falt-grupp sf-fieldset" },
        h("legend", { class: "sf-etikett-stor" }, "Typsnitt"),
        h("div", { class: "sf-typkort-lista" }, typsnittVal.map(t => t.el))),
      h("div", { class: "sf-prov" },
        h("span", { class: "sf-etikett" }, "Så här ser texten ut i läsläget"), prov)),
    h("section", { class: "sf-sektion", "aria-labelledby": "ins-upp" },
      h("h2", { id: "ins-upp" }, "Uppläsning"),
      h("div", { class: "sf-rad sf-rad--slut" },
        h("div", { class: "sf-falt-grupp" }, h("label", { for: "ins-rost" }, "Röst"), rostVal),
        provKnapp),
      provInfo,
      h("div", { class: "sf-falt-grupp" },
        h("span", { id: "ins-tempo", class: "sf-etikett-stor" }, "Tempo"),
        h("div", { class: "sf-seg", role: "group", "aria-labelledby": "ins-tempo" }, tempoKnappar))),
    h("section", { class: "sf-sektion", "aria-labelledby": "ins-konto" },
      h("h2", { id: "ins-konto" }, "Konto"),
      h("div", { class: "sf-rad-mellan" },
        h("div", { class: "sf-stapel" }, h("span", { class: "sf-etikett" }, "Mejladress"), h("span", { class: "sf-varde" }, app.jag.mejl)),
        h("button", { type: "button", class: "sf-btn sf-btn--sekundar", onclick: loggaUt }, "Logga ut")),
      h("div", { class: "sf-farozon" },
        h("div", { class: "sf-rad-mellan" },
          h("div", { class: "sf-stapel sf-vaxer" }, h("span", { class: "sf-rad-rubrik" }, "Radera allt material"),
            h("span", { class: "sf-hjalp" }, "Alla PDF:er, frågor och flashcards tas bort. Kontot och kurserna finns kvar.")),
          h("button", { type: "button", class: "sf-btn sf-btn--fara-kant", onclick: raderaMaterial }, "Radera allt material")),
        h("div", { class: "sf-rad-mellan" },
          h("div", { class: "sf-stapel sf-vaxer" }, h("span", { class: "sf-rad-rubrik" }, "Radera kontot"),
            h("span", { class: "sf-hjalp" }, "Kontot och allt du har laddat upp tas bort för alltid.")),
          h("button", { type: "button", class: "sf-btn sf-btn--fara-kant", onclick: raderaKonto }, "Radera kontot"))))));
  rita();
}
