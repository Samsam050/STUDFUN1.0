/* Appens skal: anrop till servern, adresser, menyn och inställningar som gäller överallt. */
import { h, ikon } from "./dom.js";
import loggaIn from "./sidor/logga-in.js";
import start from "./sidor/start.js";
import installningar from "./sidor/installningar.js";
import kontoRaderat from "./sidor/konto-raderat.js";
import kurser from "./sidor/kurser.js";
import kurs from "./sidor/kurs.js";

/* kvitto: ett meddelande som nästa sida visar en gång, till exempel "Kursen är skapad" */
export const app = { jag: null, kvitto: null };

/* oppen: går att se utan inloggning. utanSkal: visas utan meny. */
const SIDOR = [
  { re: /^\/logga-in$/, sida: loggaIn, titel: "Logga in", oppen: true, utanSkal: true },
  { re: /^\/skapa-konto$/, sida: loggaIn, titel: "Skapa konto", oppen: true, utanSkal: true },
  { re: /^\/konto-raderat$/, sida: kontoRaderat, titel: "Kontot är raderat", oppen: true, utanSkal: true },
  { re: /^\/$/, sida: start, titel: "Hem", meny: "hem" },
  { re: /^\/kurser$/, sida: kurser, titel: "Mina kurser", meny: "kurser" },
  { re: /^\/kurser\/(?<kursId>\d+)$/, sida: kurs, titel: "Kurs", meny: "kurser" },
  { re: /^\/installningar$/, sida: installningar, titel: "Inställningar", meny: "installningar" },
];

/* Menyn växer med varje steg. Bara det som finns visas. */
const MENY = [
  { id: "hem", text: "Hem", ikon: "hem", adress: "/" },
  /* ?meny: har studenten bara en kurs öppnas den direkt */
  { id: "kurser", text: "Mina kurser", kort: "Kurser", ikon: "kurser", adress: "/kurser?meny" },
  { id: "installningar", text: "Inställningar", ikon: "installningar", adress: "/installningar", baraDator: true },
];

export async function api(metod, adress, data) {
  let svar;
  try {
    svar = await fetch(adress, {
      method: metod,
      headers: data ? { "Content-Type": "application/json" } : {},
      body: data ? JSON.stringify(data) : undefined,
    });
  } catch {
    throw new Error("Det gick inte att nå StudFun. Kontrollera internetanslutningen och försök igen.");
  }
  const json = await svar.json().catch(() => ({}));
  if (svar.status === 401 && app.jag) { app.jag = null; navigera("/logga-in"); }
  if (!svar.ok) {
    const e = new Error(json.fel || "Något gick fel. Försök igen om en stund.");
    e.status = svar.status;
    throw e;
  }
  return json;
}

/* Typsnitt och textstorlek gäller i hela tjänsten */
export function tillampa(inst) {
  const rot = document.documentElement;
  rot.dataset.typsnitt = inst.typsnitt;
  rot.style.setProperty("--sf-fs-las", inst.textstorlek + "px");
}

export function navigera(adress, { ersatt = false } = {}) {
  history[ersatt ? "replaceState" : "pushState"](null, "", adress);
  visa(true);
}

function skal(aktiv) {
  const lank = (m, klass) => h("a", { href: m.adress, class: klass, "aria-current": m.id === aktiv ? "page" : false },
    ikon(m.ikon), klass && m.kort ? m.kort : m.text);
  const mejl = app.jag.mejl;
  const main = h("main", { id: "innehall", class: "sf-main" });
  const flikar = MENY.filter(m => !m.baraDator);
  return {
    main,
    rot: h("div", { class: "sf-skal" },
      h("nav", { class: "sf-sidomeny sf-mork", "aria-label": "Huvudmeny" },
        h("a", { href: "/", class: "sf-sidomeny-logga" }, h("img", { src: "/bilder/logga-vit.png", alt: "StudFun, till startsidan" })),
        h("div", { class: "sf-nav" }, MENY.map(m => lank(m))),
        h("div", { class: "sf-anvandare" },
          h("span", { class: "sf-avatar", "aria-hidden": "true" }, mejl[0].toUpperCase()),
          h("span", { class: "sf-anvandare-mejl" }, mejl))),
      h("header", { class: "sf-topp" },
        h("a", { href: "/", class: "sf-topp-logga" }, h("img", { src: "/bilder/logga.png", alt: "StudFun, till startsidan" })),
        h("a", { href: "/installningar", class: "sf-topp-installningar", "aria-current": aktiv === "installningar" ? "page" : false },
          ikon("installningar", 22), "Inställningar")),
      main,
      flikar.length > 1 && h("nav", { class: "sf-flikrad sf-mork", "aria-label": "Huvudmeny" }, flikar.map(m => lank(m, "sf-flik")))),
  };
}

function inteHittad(main) {
  main.append(h("h1", { tabindex: "-1" }, "Sidan finns inte"),
    h("p", {}, "Adressen leder ingenstans. Gå till startsidan och försök därifrån."),
    h("a", { href: "/", class: "sf-btn sf-btn--primar" }, "Till startsidan"));
}

async function visa(flyttaFokus) {
  const adress = location.pathname;
  const s = SIDOR.find(s => s.re.test(adress));
  if (s && !s.oppen && !app.jag) return navigera("/logga-in", { ersatt: true });
  if (s && s.utanSkal && s.sida === loggaIn && app.jag) return navigera("/", { ersatt: true });
  if (!s && !app.jag) return navigera("/logga-in", { ersatt: true });

  const rot = document.getElementById("app");
  let main;
  if (s && s.utanSkal) {
    main = h("main", { id: "innehall" });
    rot.replaceChildren(main);
  } else {
    const sk = skal(s && s.meny);
    main = sk.main;
    rot.replaceChildren(sk.rot);
  }
  document.title = (s ? s.titel : "Sidan finns inte") + " · StudFun";
  /* Sidan får hämta det den behöver innan fokus flyttas till rubriken */
  if (s) await s.sida(main, s.re.exec(adress).groups || {}); else inteHittad(main);
  if (!main.isConnected) return; // studenten hann byta sida
  if (flyttaFokus) {
    const rubrik = main.querySelector("h1");
    if (rubrik) { rubrik.setAttribute("tabindex", "-1"); rubrik.focus(); }
  }
  window.scrollTo(0, 0);
}

/* Interna länkar byter sida utan att ladda om */
document.addEventListener("click", e => {
  const a = e.target.closest("a[href^='/']");
  if (!a || a.target || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  if (/\.\w+$/.test(a.getAttribute("href"))) return; // filer, till exempel integritet.html
  e.preventDefault();
  navigera(a.getAttribute("href"));
});
addEventListener("popstate", () => visa(true));

(async () => {
  try {
    app.jag = await api("GET", "/api/jag");
    tillampa(app.jag.installningar);
  } catch { app.jag = null; }
  visa(false);
})();
