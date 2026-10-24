/* Läsläget: texten i korta delar, uppläsning där ordet som läses markeras, tryck på ett ord
   (läs upp, förklara, ge exempel), tempo, textstorlek och läslinjal. */
import { h, ikon, felMedForsok, laddar } from "../dom.js";
import { api, app, tillampa } from "../app.js";
import * as ljud from "../upplasning.js";
import { delaUpp } from "../delar.js";
import { kommIhagKurs } from "./fraga.js";

const STORLEKAR = [20, 22, 26, 30];
const TEMPON = [["langsamt", "Långsamt"], ["normalt", "Normalt"], ["snabbt", "Snabbt"]];
/* Hur länge ett ord tar att säga, ungefär: bokstäverna plus en paus efter skiljetecken.
   shortcut: markeringen räknas fram ur ljudets längd, inte ur talmotorns ordgränser. Byt om OpenAI börjar ge tidsstämplar för uppläst ljud. */
const vikt = ord => ord.replace(/[^\p{L}\p{N}]/gu, "").length + 2 + (/[.!?:;]["”’)]*$/.test(ord) ? 6 : /,$/.test(ord) ? 3 : 0);
const rent = ord => ord.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
const lagra = (k, v) => { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch { return null; } };

export default async function visa(main, { kursId, filId }) {
  const vantar = laddar("Hämtar texten …", 1);
  main.append(vantar);
  let dok, kurs, sidor;
  try {
    [dok, kurs, { sidor }] = await Promise.all([api("GET", `/api/dokument/${filId}`), api("GET", `/api/kurser/${kursId}`), api("GET", `/api/dokument/${filId}/sidor`)]);
    if (dok.kursId !== kurs.id) throw Object.assign(new Error(), { status: 404 });
  } catch (e) {
    vantar.replaceWith(e.status === 404
      ? h("div", { class: "sf-sida" }, h("h1", {}, "Filen finns inte"), h("a", { href: `/kurser/${kursId}`, class: "sf-btn sf-btn--primar sf-btn--sjalv" }, "Till kursen"))
      : h("div", { class: "sf-sida" }, h("h1", {}, "Läsläget"), felMedForsok("Kunde inte hämta texten.", () => { main.replaceChildren(); visa(main, { kursId, filId }); })));
    return;
  }
  vantar.remove();
  document.title = `${dok.titel} · StudFun`;
  kommIhagKurs(kurs.id);
  const D = delaUpp(sidor);
  if (!D.length) {
    main.append(h("div", { class: "sf-sida" }, h("h1", {}, dok.titel), h("p", {}, "Den här filen har ingen text att läsa."),
      h("a", { href: `/kurser/${kurs.id}/visa/${dok.id}`, class: "sf-btn sf-btn--primar sf-btn--sjalv" }, "Visa originalet")));
    return;
  }
  const fran = Number(new URLSearchParams(location.search).get("sida")) || dok.senastSida || 1;
  let delIdx = Math.max(0, D.findIndex(d => d.sida >= fran));
  let aktiv = 0, valt = -1, lases = -1, rad = 0;
  let linjalPa = lagra("sf.linjal") !== "0";
  let ord = [], meningAv = [], korning = 0, spelar = false;

  /* Verktygsfältet */
  const spelKnapp = h("button", { type: "button", class: "sf-btn sf-btn--accent sf-spelknapp" });
  spelKnapp.addEventListener("click", () => {
    if (spelar) { ljud.pausa(); spelar = false; return ritaKnapp(); }
    if (ljud.arPausad() && lases >= 0) { spelar = true; ljud.fortsatt(); return ritaKnapp(); }
    lasFran(meningAv[valt >= 0 ? valt : aktiv] || 0);
  });
  const tempoKnappar = TEMPON.map(([v, namn]) => h("button", { type: "button", onclick: () => satTempo(v) }, namn));
  const storlekText = h("span", { class: "sf-storlek-text", "aria-live": "polite" });
  const mindre = h("button", { type: "button", class: "sf-btn sf-btn--sekundar sf-btn--liten sf-btn--ruta", "aria-label": "Mindre text", onclick: () => satStorlek(-1) }, h("span", { "aria-hidden": "true" }, "A−"));
  const storre = h("button", { type: "button", class: "sf-btn sf-btn--sekundar sf-btn--liten sf-btn--ruta", "aria-label": "Större text", onclick: () => satStorlek(1) }, h("span", { "aria-hidden": "true", class: "sf-a-stor" }, "A+"));
  const linjalKnapp = h("button", { type: "button", class: "sf-brytare", role: "switch" }, h("span", { class: "sf-brytare-spar", "aria-hidden": "true" }), "Läslinjal");
  linjalKnapp.addEventListener("click", () => { linjalPa = !linjalPa; lagra("sf.linjal", linjalPa ? "1" : "0"); ritaLinjal(); });

  /* Texten */
  const sidChip = h("span", { class: "sf-sidchip" });
  const delRubrik = h("h2", { id: "del-rubrik", class: "sf-del-rubrik" });
  const text = h("p", { class: "sf-las-text sf-ordgrupp", role: "group", "aria-label": "Texten. Tryck på ett ord för att få det uppläst." });
  const over = h("div", { class: "sf-linjal-dim", "aria-hidden": "true" });
  const band = h("div", { class: "sf-linjal-band", "aria-hidden": "true" });
  const under = h("div", { class: "sf-linjal-dim", "aria-hidden": "true" });
  const meny = h("div", { class: "sf-ordmeny", role: "dialog", hidden: true });
  const textRuta = h("div", { class: "sf-las-ruta" }, text, over, band, under, meny);
  const linjalRad = h("div", { class: "sf-rad" }, h("span", { class: "sf-hjalp" }, "Flytta läslinjalen"),
    h("button", { type: "button", class: "sf-btn sf-btn--sekundar sf-btn--liten", onclick: () => flyttaRad(-1) }, "Upp"),
    h("button", { type: "button", class: "sf-btn sf-btn--sekundar sf-btn--liten", onclick: () => flyttaRad(1) }, "Ner"));
  const forraDel = h("button", { type: "button", class: "sf-btn sf-btn--sekundar", onclick: () => gaTillDel(delIdx - 1) }, ikon("tillbaka", 22), "Föregående del");
  const nastaDel = h("button", { type: "button", class: "sf-btn sf-btn--primar", onclick: () => gaTillDel(delIdx + 1) }, "Nästa del", ikon("pil", 22));
  const felRuta = h("div", { class: "sf-topp-fel" });
  const originalLank = h("a", { class: "sf-btn sf-btn--sekundar" }, "Visa originalet");
  const fragaLank = h("a", { class: "sf-btn sf-btn--primar" }, ikon("chatt", 22), "Fråga Tudi om det här");

  text.addEventListener("keydown", e => {
    const flytt = { ArrowRight: 1, ArrowLeft: -1, Home: -Infinity, End: Infinity }[e.key];
    if (flytt !== undefined) { e.preventDefault(); satAktiv(Math.min(ord.length - 1, Math.max(0, aktiv + flytt)), true); }
    if (e.key === "ArrowUp" || e.key === "ArrowDown") { e.preventDefault(); flyttaRad(e.key === "ArrowUp" ? -1 : 1); }
  });
  meny.addEventListener("keydown", e => { if (e.key === "Escape") { e.preventDefault(); stangMeny(); } });

  function ritaKnapp() {
    spelKnapp.replaceChildren(ikon(spelar ? "paus" : "spela", 22), spelar ? "Pausa" : "Läs upp");
  }
  function ritaVerktyg() {
    const s = app.jag.installningar;
    tempoKnappar.forEach((k, i) => k.setAttribute("aria-pressed", String(TEMPON[i][0] === s.tempo)));
    storlekText.textContent = `${s.textstorlek} px`;
    mindre.disabled = s.textstorlek <= STORLEKAR[0];
    storre.disabled = s.textstorlek >= STORLEKAR[STORLEKAR.length - 1];
    linjalKnapp.setAttribute("aria-checked", String(linjalPa));
  }
  async function sparaInst(andring) {
    Object.assign(app.jag.installningar, andring);
    tillampa(app.jag.installningar);
    ritaVerktyg();
    api("PUT", "/api/installningar", andring).catch(() => {});
  }
  function satTempo(v) { sparaInst({ tempo: v }); ljud.satTempo(ljud.TEMPO[v]); }
  function satStorlek(steg) {
    const i = STORLEKAR.indexOf(app.jag.installningar.textstorlek);
    const ny = STORLEKAR[Math.min(STORLEKAR.length - 1, Math.max(0, (i < 0 ? 1 : i) + steg))];
    sparaInst({ textstorlek: ny });
    requestAnimationFrame(ritaLinjal);
  }

  function ritaDel() {
    const del = D[delIdx];
    stangMeny();
    ord = []; meningAv = []; valt = -1; lases = -1; aktiv = 0; rad = 0;
    text.replaceChildren();
    del.meningar.forEach((m, mi) => m.split(/\s+/).filter(Boolean).forEach(w => {
      const i = ord.length;
      const b = h("button", { type: "button", class: "sf-ord", tabindex: "-1", "aria-expanded": "false" }, w);
      b.addEventListener("click", () => { satAktiv(i, false); oppnaMeny(i); });
      ord.push(b); meningAv.push(mi);
      text.append(b, " ");
    }));
    if (ord.length) ord[0].tabIndex = 0;
    sidChip.replaceChildren(ikon("dokument", 20), `Sida ${del.sida}`);
    delRubrik.textContent = `Del ${delIdx + 1} av ${D.length}`;
    forraDel.disabled = delIdx === 0;
    nastaDel.disabled = delIdx === D.length - 1;
    originalLank.href = `/kurser/${kurs.id}/visa/${dok.id}?sida=${del.sida}`;
    fragaLank.href = `/kurser/${kurs.id}/fraga?fil=${dok.id}&sida=${del.sida}`;
    history.replaceState(null, "", `/kurser/${kurs.id}/las/${dok.id}?sida=${del.sida}`);
    sparaPosition(del.sida);
    requestAnimationFrame(ritaLinjal);
  }

  function gaTillDel(n, fortsatt = false) {
    if (n < 0 || n >= D.length) return;
    if (!fortsatt) stoppa();
    delIdx = n;
    ritaDel();
  }

  function satAktiv(i, fokus) {
    if (ord[aktiv]) ord[aktiv].tabIndex = -1;
    aktiv = i;
    ord[i].tabIndex = 0;
    if (fokus) ord[i].focus();
    foljLinjal(i);
  }

  /* Menyn för ett ord: Läs upp och Stäng. Esc stänger och fokus går tillbaka till ordet. */
  function oppnaMeny(i) {
    stangMeny(false);
    valt = i;
    const b = ord[i];
    const w = rent(b.textContent) || b.textContent;
    b.classList.add("sf-ord--vald");
    b.setAttribute("aria-expanded", "true");
    const lasKnapp = h("button", { type: "button", class: "sf-btn sf-btn--sekundar sf-btn--liten" }, ikon("spela", 20), "Läs upp");
    const info = h("p", { class: "sf-ordmeny-info", role: "status" });
    lasKnapp.addEventListener("click", async () => {
      stoppa();
      try { await ljud.spela(await ljud.hamta(dok.id, w), ljud.TEMPO[app.jag.installningar.tempo] || 1); }
      catch (e) { info.textContent = e.message; }
    });
    /* Förklara och Ge exempel: Tudi svarar utifrån kursmaterialet, med meningen som sammanhang */
    const fraga = typ => async () => {
      info.textContent = "Tudi tänker …";
      try {
        const r = await api("POST", `/api/kurser/${kurs.id}/ord`, { ord: w, typ, mening: D[delIdx].meningar[meningAv[i]], sida: { dokId: dok.id, nr: D[delIdx].sida } });
        info.textContent = r.svar + (r.kallor.length ? ` (${r.kallor.map(k => `sida ${k.sida}`).join(", ")})` : "");
      } catch (e) { info.textContent = e.message; }
    };
    meny.setAttribute("aria-label", `Val för ordet ${w}`);
    meny.replaceChildren(
      h("div", { class: "sf-rad-mellan" }, h("span", { class: "sf-ordmeny-ord" }, w),
        h("button", { type: "button", class: "sf-btn sf-btn--liten sf-btn--text", onclick: () => stangMeny() }, "Stäng")),
      h("div", { class: "sf-knapprad" }, lasKnapp,
        h("button", { type: "button", class: "sf-btn sf-btn--sekundar sf-btn--liten", onclick: fraga("forklara") }, "Förklara"),
        h("button", { type: "button", class: "sf-btn sf-btn--sekundar sf-btn--liten", onclick: fraga("exempel") }, "Ge exempel")),
      info);
    meny.style.top = `${b.offsetTop + b.offsetHeight + 10}px`;
    meny.style.left = `${Math.max(0, Math.min(b.offsetLeft - 8, textRuta.clientWidth - 360))}px`;
    meny.hidden = false;
    lasKnapp.focus();
  }
  function stangMeny(fokusTillbaka = true) {
    if (meny.hidden) return;
    meny.hidden = true;
    const b = ord[valt];
    if (b) { b.classList.remove("sf-ord--vald"); b.setAttribute("aria-expanded", "false"); if (fokusTillbaka) b.focus(); }
    valt = -1;
  }

  /* Läslinjalen: ett band över en rad, resten tonas ner */
  const raderna = () => [...new Set(ord.map(b => b.offsetTop))].sort((a, b) => a - b);
  function ritaLinjal() {
    ritaVerktyg();
    for (const el of [over, band, under, linjalRad]) el.hidden = !linjalPa;
    if (!linjalPa || !ord.length) return;
    const L = raderna();
    rad = Math.min(Math.max(rad, 0), L.length - 1);
    const lh = parseFloat(getComputedStyle(text).lineHeight);
    const topp = Math.max(0, L[rad] + ord[0].offsetHeight / 2 - lh / 2);
    over.style.top = "0px"; over.style.height = `${topp}px`;
    band.style.top = `${topp}px`; band.style.height = `${lh}px`;
    under.style.top = `${topp + lh}px`; under.style.height = `${Math.max(0, textRuta.scrollHeight - topp - lh)}px`;
  }
  function flyttaRad(steg) { if (!linjalPa) return; rad += steg; ritaLinjal(); }
  function foljLinjal(i) {
    if (!ord[i]) return;
    const ny = raderna().indexOf(ord[i].offsetTop);
    if (ny >= 0 && ny !== rad) { rad = ny; ritaLinjal(); }
  }

  /* Uppläsningen, mening för mening. Nästa mening hämtas medan den här spelas. */
  function markera(i) {
    if (i === lases) return;
    ord[lases]?.classList.remove("sf-ord--lases");
    lases = i;
    if (!ord[i]) return;
    ord[i].classList.add("sf-ord--lases");
    foljLinjal(i);
    const r = ord[i].getBoundingClientRect();
    if (r.top < 80 || r.bottom > innerHeight - 80) ord[i].scrollIntoView({ block: "center" });
  }
  function stoppa() {
    korning++;
    spelar = false;
    ljud.stoppa();
    markera(-1);
    ritaKnapp();
  }
  async function lasFran(mi) {
    const mitt = ++korning;
    spelar = true;
    ritaKnapp();
    felRuta.replaceChildren();
    stangMeny(false);
    for (;;) {
      const del = D[delIdx];
      for (let i = mi; i < del.meningar.length; i++) {
        const nasta = del.meningar[i + 1] || D[delIdx + 1]?.meningar[0];
        if (nasta) ljud.hamta(dok.id, nasta).catch(() => {});
        let url;
        try { url = await ljud.hamta(dok.id, del.meningar[i]); }
        catch (e) { if (mitt === korning) { stoppa(); visaLjudFel(e.message, i); } return; }
        if (mitt !== korning) return;
        const forsta = meningAv.indexOf(i);
        const vikter = ord.filter((_, k) => meningAv[k] === i).map(b => vikt(b.textContent));
        const summa = vikter.reduce((a, b) => a + b, 0);
        try {
          await ljud.spela(url, ljud.TEMPO[app.jag.installningar.tempo] || 1, andel => {
            let acc = 0, k = 0;
            while (k < vikter.length - 1 && (acc + vikter[k]) / summa < andel) acc += vikter[k++];
            markera(forsta + k);
          });
        } catch (e) { if (mitt === korning) { stoppa(); visaLjudFel(e.message, i); } return; }
        if (mitt !== korning) return;
      }
      if (delIdx >= D.length - 1) break;
      gaTillDel(delIdx + 1, true); // när delen är slut går uppläsningen vidare till nästa del
      mi = 0;
    }
    stoppa();
  }
  function visaLjudFel(besked, mening) {
    const standard = besked === "Uppläsningen fungerar inte just nu.";
    felRuta.replaceChildren(h("div", { class: "sf-medd sf-medd--fel sf-medd--knapp", role: "alert" }, ikon("fel"),
      h("p", { class: "sf-vaxer" }, standard ? "Uppläsningen fungerar inte just nu. Du kan fortsätta läsa själv under tiden." : besked),
      standard && h("button", { type: "button", class: "sf-btn sf-btn--sekundar sf-btn--liten", onclick: () => lasFran(mening) }, "Försök igen")));
  }

  let posTimer = 0, sparadSida = null; // första delen sparas också, så att filen räknas som påbörjad
  function sparaPosition(sida) {
    if (sida === sparadSida) return;
    clearTimeout(posTimer);
    posTimer = setTimeout(() => { sparadSida = sida; api("PUT", `/api/dokument/${dok.id}/position`, { sida }).catch(() => {}); }, 1000);
  }

  /* Städar när studenten lämnar sidan: inget ljud ska fortsätta i bakgrunden */
  const vidStorlek = () => requestAnimationFrame(ritaLinjal);
  addEventListener("resize", vidStorlek);
  const stad = new MutationObserver(() => {
    if (main.isConnected) return;
    stoppa();
    removeEventListener("resize", vidStorlek);
    stad.disconnect();
  });
  stad.observe(document.getElementById("app"), { childList: true });

  main.append(h("div", { class: "sf-sida sf-sida--las" },
    h("header", { class: "sf-sidhuvud sf-sidhuvud--knapp" },
      h("div", { class: "sf-stapel" },
        h("a", { href: `/kurser/${kurs.id}`, class: "sf-tillbaka" }, ikon("tillbaka", 20), `Tillbaka till ${kurs.namn}`),
        h("h1", {}, dok.titel),
        h("p", { class: "sf-hjalp" }, dok.sidor === 1 ? "1 sida" : `${dok.sidor} sidor`)),
      h("div", { class: "sf-knapprad" }, fragaLank, originalLank)),
    h("div", { class: "sf-verktyg", role: "toolbar", "aria-label": "Uppläsning och visning" },
      spelKnapp,
      h("div", { class: "sf-rad sf-rad--tat" }, h("span", { id: "tempo-etikett", class: "sf-verktyg-etikett" }, "Tempo"),
        h("div", { class: "sf-seg", role: "group", "aria-labelledby": "tempo-etikett" }, tempoKnappar)),
      h("div", { class: "sf-rad sf-rad--tat" }, h("span", { id: "storlek-etikett", class: "sf-verktyg-etikett" }, "Textstorlek"),
        h("div", { class: "sf-rad sf-rad--tat", role: "group", "aria-labelledby": "storlek-etikett" }, mindre, storlekText, storre)),
      linjalKnapp),
    felRuta,
    h("section", { class: "sf-las-del", "aria-labelledby": "del-rubrik" },
      h("div", { class: "sf-rad" }, sidChip, delRubrik),
      textRuta,
      linjalRad,
      h("div", { class: "sf-rad-mellan sf-del-knappar" }, forraDel, nastaDel)),
    h("p", { class: "sf-hjalp" }, "Tryck på ett ord för att få det uppläst, förklarat eller ett exempel. Piltangenterna flyttar mellan orden och flyttar läslinjalen.")));
  ritaKnapp();
  ritaDel();
}
