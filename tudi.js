/*
  Tudi i chatten: svarar på frågor utifrån kursens material, med sidhänvisningar som [s. 12].

  Först sorterar nano (MODEL_VALJ) frågan, så att Luna bara får det material som behövs:
    sidan      frågan gäller sidan som är öppen: samma förklaring som knappen Förklara den här sidan
    sidor      vissa sidor: texten på dem
    dokument   ett helt dokument: hela texten om den är högst MAX_TOKEN_HELA token, annars sammanfattningarna av avsnitten
    kurs       hela kursen: sammanfattningarna av alla dokument och deras avsnitt
    tenta      tentan: kursens gamla tentor och kursplan, hela eller som sammanfattningar
    specifik   ett begrepp eller en detalj: sidan som är öppen och de 4 mest lika utdragen ur kursen
    ovrigt     en hälsning eller något utanför materialet: inget extra material
  Går sorteringen fel blir det specifik, som är det säkra valet.

  Det här skickas till Luna, i den här ordningen. Det som är lika mellan frågorna först, så att OpenAI kan spara början:
    1. Den gemensamma grunden och chatt.md.
    2. Kursens dokument med titel, typ, antal sidor och sammanfattning.
    3. Materialet för frågans typ.
    4. De 6 senaste meddelandena.
    5. Frågan.
  Servern kontrollerar sidhänvisningarna. Hänvisningar till sidor Tudi inte fick se tas bort.

  Knappen Förklara den här sidan går också hit (forklara: true), så att förklaringen hamnar i samtalet i tidsordning.
  Knapparna under ett svar (foljd) använder samma material som svaret, eller förklarar sidan på ett annat sätt.
*/
const { forbruka } = require("./db");
const kallor = require("./kallor");
const { dokTyp } = require("./dokument");

const CHATT_PER_DAG = 80;
const TAL_PER_DAG = 40;
const BITAR = 4;
const HISTORIK = 6;
const MAX_FRAGA = 1000;
const MAX_SIDOR = 10;          // så många sidor kan en fråga om vissa sidor få
const TECKEN_PER_TOKEN = 3.5;  // ungefär, för svensk och engelsk text
const TAK_TEXT = "Du har ställt dagens frågor till Tudi. Du kan fråga igen i morgon från klockan 06.00. Sidan, uppläsningen och övningarna fungerar som vanligt.";
const INGET_MATERIAL = "Det finns inget färdigt material i kursen än. Ladda upp en PDF, så kan jag svara utifrån den.";
/* Knapparna under senaste svaret. Tillägget är samma prompt som för sidan. */
const FOLJD = {
  enklare: ["Enklare", "satt-enklare"],
  steg: ["Steg för steg", "satt-steg-for-steg"],
  exempel: ["Ge ett exempel", "satt-exempel"],
  annat: ["Förklara på ett annat sätt", "satt-annat-satt"],
};
const TYPER = ["sidan", "sidor", "dokument", "kurs", "tenta", "specifik", "ovrigt"];
/* Ord som betyder hela dokumentet, och ord som betyder sidan. Används om nano väljer sidan fast frågan gäller hela PDF:en. */
const HELA_DOKUMENTET = /(?:^|[^\p{L}])(pdf|pdf:en|pdfen|pdf-en|dokument|dokumentet|fil|filen|bok|boken|kapitel|kapitlet|kompendiet|artikel|artikeln|slides|slidesen|föreläsning|föreläsningen)(?![\p{L}])/iu;
const SIDAN = /(?:^|[^\p{L}])(sida|sidan|bild|bilden|figur|figuren|diagram|diagrammet|tabell|tabellen)(?![\p{L}])/iu;
/* Frågor om helheten: vad något handlar om, sammanfatta, det viktigaste */
const OVERGRIPANDE = /(vad handlar|handlar\s.*\som\b|sammanfatta|sammanfattning|viktigast|huvudpoäng|huvudsak|översikt|övergripande|i stora drag)/iu;
const VAL = {
  namn: "val",
  schema: {
    type: "object", additionalProperties: false, required: ["typ", "dokument_id", "sidor"],
    properties: { typ: { type: "string", enum: TYPER }, dokument_id: { type: "string" }, sidor: { type: "array", items: { type: "integer" } } },
  },
};

function cosinus(a, b) {
  let p = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { p += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return p / (Math.sqrt(na * nb) || 1);
}
const vektorAv = blob => new Float32Array(blob.buffer, blob.byteOffset, blob.byteLength / 4);
const lasDelar = d => { try { return JSON.parse(d.delar || "[]"); } catch { return []; } };
const token = text => Math.ceil(text.length / TECKEN_PER_TOKEN);
/* Vad en del av materialet är, för loggen. Aldrig titlar eller text. */
const slag = del => [[/^Hela texten i /, "hel text"], [/är för långt för att skickas helt/, "sammanfattningar av avsnitt"], [/^Sidorna studenten frågar om/, "vissa sidor"],
  [/^Sidan studenten har öppen/, "öppen sida"], [/^Utdrag ur materialet/, "utdrag"], [/^Sammanfattningar av avsnitten i kursens/, "kursens avsnitt"],
  [/^Det finns inga gamla tentor/, "inga tentor"], [/^Studenten har .* öppen\.$/, "vilken sida som är öppen"]].find(([re]) => re.test(del))?.[1] || "annat";
const lasMeta = m => { try { return JSON.parse(m.meta || "{}"); } catch { return {}; } };

module.exports = function ({ db, CONFIG, Fel, rutt, ai, forklara }) {
  function kurs(userId, kursId) {
    const k = db.prepare("SELECT id, namn FROM courses WHERE id = ? AND user_id = ?").get(kursId, userId);
    if (!k) throw new Fel(404, "Kursen finns inte.");
    return k;
  }

  /* Bitarna i kursen som liknar frågan mest, utom de på sidan som redan skickas hel.
     shortcut: går igenom alla bitar i kursen vid varje fråga, byt till ett vektorindex om kurserna blir mycket större än 20 filer. */
  async function sok(userId, kursId, text, utom) {
    const [fraga] = await ai.vektorer([text], { uid: userId, funktion: "sok" });
    return db.prepare(`SELECT c.id, c.document_id, c.sida, c.text, c.vektor, d.titel FROM chunks c
        JOIN documents d ON d.id = c.document_id
        WHERE c.user_id = ? AND d.user_id = ? AND d.course_id = ? AND d.status = 'klar' AND c.vektor IS NOT NULL`)
      .all(userId, userId, kursId)
      .filter(b => !(utom && b.document_id === utom.dokId && b.sida === utom.nr))
      .map(b => ({ ...b, likhet: cosinus(fraga, vektorAv(b.vektor)) }))
      .sort((a, b) => b.likhet - a.likhet)
      .slice(0, BITAR);
  }

  /* Kursens dokument med sammanfattning. Lika för alla frågor i kursen tills nytt material kommer. */
  function dokumentlista(dok) {
    return ai.material(dok.map(d => [
      `Dokument: ${d.titel}`, `Typ: ${dokTyp(d)}`, `Antal sidor: ${d.sidor}`,
      d.kort ? `Kort: ${d.kort}` : "", d.sammanfattning ? `Sammanfattning: ${d.sammanfattning}` : "",
      ...lasDelar(d).map(x => `• s. ${x.sidor}: ${x.handlar_om}`),
    ].filter(Boolean).join("\n")).join("\n\n"));
  }

  const sidtexter = dokId => {
    const sidor = new Map();
    for (const b of db.prepare("SELECT sida, text FROM chunks WHERE document_id = ? ORDER BY id").all(dokId)) {
      sidor.set(b.sida, (sidor.has(b.sida) ? sidor.get(b.sida) + " " : "") + b.text);
    }
    return sidor;
  };
  const avsnitt = dokId => db.prepare("SELECT fran, till, rubrik, sammanfattning, begrepp FROM avsnitt WHERE document_id = ? ORDER BY fran").all(dokId);

  /* Ett dokument som text till Luna: hela texten om den ryms inom budgeten, annars avsnittens sammanfattningar.
     Lägger till sidorna eller avsnitten som Tudi får hänvisa till. Returnerar { text, token }. */
  function helt(d, budget, till) {
    const sidor = sidtexter(d.id);
    const hel = [...sidor].map(([nr, t]) => `[s. ${nr}]\n${t}`).join("\n\n");
    if (token(hel) <= budget) {
      for (const nr of sidor.keys()) till.sida(d.id, nr);
      return { text: `Hela texten i ${d.titel} (${dokTyp(d)}, ${d.sidor} sidor):\n${ai.material(hel)}`, token: token(hel) };
    }
    const av = avsnitt(d.id);
    for (const a of av) till.spann(d.id, `${a.fran}-${a.till}`);
    const text = av.map(a => {
      let begrepp = [];
      try { begrepp = JSON.parse(a.begrepp); } catch { /* inga begrepp */ }
      return `[s. ${a.fran}–${a.till}] ${a.rubrik}\n${a.sammanfattning}${begrepp.length ? `\nBegrepp: ${begrepp.join(", ")}` : ""}`;
    }).join("\n\n");
    return { text: `${d.titel} (${dokTyp(d)}, ${d.sidor} sidor) är för långt för att skickas helt. Här är sammanfattningarna av avsnitten:\n${ai.material(text)}`, token: token(text) };
  }

  /* Rättar nanos val där frågans ord säger något annat, och där det som valdes inte finns.
     Körs också när nano inte svarar, så att "vad handlar den här pdf:en om" alltid får dokumentet. */
  function ratta(val, { fraga, sida, dok }) {
    let { typ, dokId, sidor } = val;
    const d = dok.find(x => x.id === dokId) || (sida && dok.find(x => x.id === sida.dokId)) || (dok.length === 1 ? dok[0] : null);
    const helt = HELA_DOKUMENTET.test(fraga) && !SIDAN.test(fraga);
    /* Frågan nämner PDF:en, boken eller dokumentet men inte sidan: den gäller hela dokumentet, inte sidan */
    if (typ === "sidan" && helt) typ = "dokument";
    /* "Vad handlar den här pdf:en om", "sammanfatta boken": dokumentet, också om nano valde något annat */
    if (["sidan", "specifik", "ovrigt"].includes(typ) && helt && OVERGRIPANDE.test(fraga)) typ = "dokument";
    if (typ === "sidan" && !sida) typ = "specifik";
    if (typ === "sidor" && !sidor.length) typ = "specifik";
    /* Ett dokument utan att det går att veta vilket: sammanfattningarna av hela kursen */
    if (typ === "dokument" && !d) typ = OVERGRIPANDE.test(fraga) ? "kurs" : "specifik";
    return { typ, dokId: ["dokument", "sidor"].includes(typ) && d ? d.id : null, sidor: typ === "sidor" ? sidor : [] };
  }

  /* Nano sorterar frågan. Returnerar { typ, dokId, sidor }. Går något fel blir det specifik, rättat av ratta(). */
  async function valj(uid, kursId, { fraga, historik, sida, dok }) {
    let val = { typ: "specifik", dokId: null, sidor: [] }, nano = "fel";
    try {
      const ut = await ai.svar({
        funktion: "valj", uid, schema: VAL, cache: `kurs:${kursId}`,
        system: ai.prompt("valj"),
        fast: ai.material(dok.map(d => `id: ${d.id} | ${d.titel} | ${d.sidor} sidor | typ: ${dokTyp(d)}`).join("\n")),
        inne: [{ role: "user", content: [
          sida ? `Studenten har sida ${sida.nr} av ${sida.sidor} öppen i dokument id ${sida.dokId}.` : "Studenten har inget dokument öppet.",
          historik.length ? `Senaste meddelandena:\n${ai.material(historik.slice(-2).map(m => `${m.roll === "tudi" ? "Tudi" : "Studenten"}: ${m.text.slice(0, 400)}`).join("\n"))}` : "",
          `Frågan:\n${ai.material(fraga)}`,
        ].filter(Boolean).join("\n\n") }],
      });
      nano = TYPER.includes(ut.typ) ? ut.typ : "specifik";
      const d = dok.find(x => String(x.id) === String(ut.dokument_id).trim()) || (sida && dok.find(x => x.id === sida.dokId)) || (dok.length === 1 ? dok[0] : null);
      const sidor = [...new Set((Array.isArray(ut.sidor) ? ut.sidor : []).filter(n => Number.isInteger(n) && d && n >= 1 && n <= d.sidor))].slice(0, MAX_SIDOR);
      val = { typ: nano, dokId: d ? d.id : null, sidor };
    } catch (e) {
      console.error(`[sf] valj misslyckades u=${uid} ${e.code || e.name}${e.detalj ? ` ${e.detalj}` : ""}`);
    }
    const ratt = ratta(val, { fraga, sida, dok });
    ai.logg(`valj nano=${nano} blev=${ratt.typ}${ratt.dokId ? ` dok=${ratt.dokId}` : ""}${ratt.sidor.length ? ` sidor=${ratt.sidor.join(",")}` : ""}${sida ? ` öppen=${sida.dokId}:${sida.nr}` : ""}`);
    return ratt;
  }

  /* Materialet för frågans typ. Returnerar texten till Luna och sidorna Tudi får hänvisa till. */
  async function material(uid, kursId, val, { dok, sida, sokText }) {
    const till = kallor.tillatna();
    for (const d of dok) {
      for (const x of lasDelar(d)) till.spann(d.id, x.sidor);
      for (const a of avsnitt(d.id)) till.spann(d.id, `${a.fran}-${a.till}`);
    }
    const delar = [];
    const budget = CONFIG.ai.chatt.maxHela;
    const d = val.dokId ? dok.find(x => x.id === val.dokId) : null;
    if (val.typ === "sidor") {
      const sidor = sidtexter(d.id);
      let kvar = budget;
      const text = [];
      for (const nr of val.sidor) {
        const t = sidor.get(nr) || "Sidan har ingen text.";
        if (token(t) > kvar) break;
        kvar -= token(t);
        text.push(`[s. ${nr}]\n${t}`);
        till.sida(d.id, nr);
      }
      delar.push(`Sidorna studenten frågar om, ur ${d.titel}:\n${ai.material(text.join("\n\n"))}`);
    } else if (val.typ === "dokument") {
      delar.push(helt(d, budget, till).text);
    } else if (val.typ === "kurs") {
      /* Avsnitten för alla dokument, om de ryms. Annars räcker dokumentlistan. */
      const text = dok.map(x => `${x.titel}:\n${avsnitt(x.id).map(a => `[s. ${a.fran}–${a.till}] ${a.rubrik}: ${a.sammanfattning}`).join("\n")}`).join("\n\n");
      if (token(text) <= budget) delar.push(`Sammanfattningar av avsnitten i kursens dokument:\n${ai.material(text)}`);
    } else if (val.typ === "tenta") {
      const tentor = dok.filter(x => dokTyp(x) === "tenta"), planer = dok.filter(x => dokTyp(x) === "kursplan");
      if (!tentor.length && !planer.length) delar.push("Det finns inga gamla tentor och ingen kursplan bland kursens dokument.");
      let kvar = budget;
      for (const x of [...planer, ...tentor]) {
        const h = helt(x, kvar, till);
        kvar = Math.max(0, kvar - h.token);
        delar.push(h.text);
      }
    } else if (val.typ === "specifik") {
      if (sida) {
        const text = db.prepare("SELECT text FROM chunks WHERE document_id = ? AND sida = ? ORDER BY id").all(sida.dokId, sida.nr).map(b => b.text).join(" ");
        delar.push(`Sidan studenten har öppen: ${sida.titel}, sida ${sida.nr}.\n${ai.material(text || "Sidan har ingen text.")}`);
        till.sida(sida.dokId, sida.nr);
      }
      const bitar = await sok(uid, kursId, sokText, sida);
      if (bitar.length) {
        delar.push(`Utdrag ur materialet som liknar frågan:\n${ai.material(bitar.map(b => `[${b.titel}, s. ${b.sida}]\n${b.text}`).join("\n\n"))}`);
        for (const b of bitar) till.sida(b.document_id, b.sida);
      }
    } else if (sida) {
      delar.push(`Studenten har ${sida.titel}, sida ${sida.nr}, öppen.`);
    }
    return { delar, till };
  }

  /* Ställer frågan till Luna med materialet för valet. Returnerar svaret och sidhänvisningarna i den ordning de står. */
  async function svara(uid, kursId, { fraga, sokText, sida, historik, val, dok }) {
    try {
      const { delar, till } = await material(uid, kursId, val, { dok, sida, sokText: sokText || fraga });
      /* Vad Luna får, utan text: rubriken på varje del och ungefär hur många token den är */
      ai.logg(`chatt material typ=${val.typ} ${delar.map(x => `[${slag(x)} ~${token(x)} token]`).join(" ") || "[inget extra]"}`);
      const ut = await ai.svar({
        funktion: "chatt", uid, cache: `kurs:${kursId}`,
        system: ai.tudiPrompt("chatt"),
        fast: dokumentlista(dok),
        inne: [
          ...(delar.length ? [{ role: "user", content: delar.join("\n\n") }] : []),
          ...historik.map(m => ({ role: m.roll === "tudi" ? "assistant" : "user", content: m.text })),
          { role: "user", content: fraga },
        ],
      });
      const d = val.dokId || (sida && sida.dokId);
      const k = kallor.kontrollera(ut, { till, dokument: dok.map(x => ({ id: x.id, titel: x.titel })), standard: d || null });
      return { svar: k.text.slice(0, 4000), kallor: k.kallor };
    } catch (e) {
      if (e instanceof Fel) throw e;
      console.error(`[sf] tudi misslyckades u=${uid} k=${kursId} ${e.code || e.name}`);
      throw new Fel(502, "Tudi kunde inte svara just nu. Din fråga finns kvar, så du kan skicka den igen.");
    }
  }

  /* Sidan studenten tittar på: måste vara studentens egen fil i samma kurs */
  function lasSida(uid, kursId, s) {
    if (!s) return null;
    const d = db.prepare("SELECT id, titel, sidor FROM documents WHERE id = ? AND user_id = ? AND course_id = ?").get(s.dokId, uid, kursId);
    if (!d || !Number.isInteger(s.nr) || s.nr < 1 || s.nr > d.sidor) throw new Fel(404, "Sidan finns inte.");
    return { dokId: d.id, nr: s.nr, titel: d.titel, sidor: d.sidor };
  }

  /* Det appen får veta om ett svar: om det är en förklaring av en sida, och i så fall vilken och om bilden var med */
  const utMeta = meta => (meta.typ === "sida" ? { typ: "sida", dokId: meta.dokId, sida: meta.sida, bild: !!meta.bild, satt: meta.satt || null }
    : meta.val ? { typ: "chatt", val: meta.val.typ } : {});
  const meddelande = m => ({ id: m.id, roll: m.roll, text: m.text, kallor: JSON.parse(m.kallor), tid: m.tid, meta: utMeta(lasMeta(m)) });

  rutt("GET", "/api/kurser/:kursId/meddelanden", ctx => {
    kurs(ctx.user.id, ctx.params.kursId);
    const rader = db.prepare("SELECT * FROM messages WHERE course_id = ? AND user_id = ? ORDER BY id DESC LIMIT 60").all(ctx.params.kursId, ctx.user.id);
    return { meddelanden: rader.reverse().map(meddelande) };
  });

  /* En fråga i chatten eller i visaren.
     { fraga, sida?, bild? }          en fråga. Nano sorterar den. bild används bara om frågan gäller sidan.
     { forklara: true, sida, bild? }  knappen Förklara den här sidan, eller Titta på bilden också (med bild)
     { foljd }                        en av knapparna under senaste svaret */
  rutt("POST", "/api/kurser/:kursId/fraga", async ctx => {
    const uid = ctx.user.id, kursId = ctx.params.kursId;
    kurs(uid, kursId);
    const b = ctx.body;
    const rader = db.prepare("SELECT roll, text, meta FROM messages WHERE course_id = ? AND user_id = ? ORDER BY id DESC LIMIT ?").all(kursId, uid, HISTORIK).reverse();
    const historik = rader.map(m => ({ roll: m.roll, text: m.text }));
    const sida = lasSida(uid, kursId, b.sida);
    const bild = forklara.lasBild(b.bild);
    const dok = db.prepare("SELECT * FROM documents WHERE course_id = ? AND user_id = ? AND status = 'klar' ORDER BY skapad, id").all(kursId, uid);
    const fullDok = id => dok.find(x => x.id === id);

    let visas, svar, meta;
    const forklaraSida = async (d, nr, val) => {
      const r = await forklara.forklaraSida({ uid, d, nr, bild, ...val });
      return { svar: { svar: r.text, kallor: r.kallor }, meta: { typ: "sida", dokId: d.id, sida: nr, bild: r.bild, satt: r.satt, nyckel: r.nyckel } };
    };

    if (b.forklara === true) {
      if (!sida || !fullDok(sida.dokId)) throw new Fel(404, "Sidan finns inte.");
      visas = bild && b.tittaPaBilden ? `Titta på bilden av sida ${sida.nr}` : `Förklara sida ${sida.nr}`;
      ({ svar, meta } = await forklaraSida(fullDok(sida.dokId), sida.nr, {}));
    } else if (b.foljd !== undefined) {
      if (!FOLJD[b.foljd]) throw new Fel(400, "Det valet finns inte.");
      if (rader.length < 2 || rader.at(-1).roll !== "tudi") throw new Fel(400, "Det finns inget svar att förklara.");
      visas = FOLJD[b.foljd][0];
      const forra = lasMeta(rader.at(-1));
      if (forra.typ === "sida") {
        /* Förklaringen av en sida, på ett annat sätt */
        const d = fullDok(forra.dokId);
        if (!d) throw new Fel(404, "Filen finns inte.");
        ({ svar, meta } = await forklaraSida(d, forra.sida, { satt: b.foljd, forraNyckel: forra.nyckel, bild: null }));
      } else {
        if (!dok.length) throw new Fel(400, "Det finns inget svar att förklara.");
        if (!CONFIG.openaiKey) throw new Fel(503, "Tudi kunde inte svara just nu.");
        if (!forbruka(db, uid, "chatt", 1, CHATT_PER_DAG)) throw new Fel(429, TAK_TEXT);
        const etiketter = Object.values(FOLJD).map(f => f[0]);
        const sokText = historik.filter(m => m.roll === "student" && !etiketter.includes(m.text) && !/^(Förklara sida|Titta på bilden av sida) \d+$/.test(m.text)).at(-1)?.text || historik.at(-1).text;
        /* Samma material som svaret som ska förklaras */
        const val = forra.val || { typ: "specifik", dokId: null, sidor: [] };
        meta = { typ: "chatt", val };
        svar = await svara(uid, kursId, { fraga: ai.prompt(FOLJD[b.foljd][1]), sokText, sida, historik, val, dok });
      }
    } else {
      const fraga = typeof b.fraga === "string" ? b.fraga.trim() : "";
      if (!fraga) throw new Fel(400, "Skriv en fråga först.");
      if (fraga.length > MAX_FRAGA) throw new Fel(400, "Frågan är för lång. Dela upp den i flera frågor.");
      visas = fraga;
      if (!dok.length) { svar = { svar: INGET_MATERIAL, kallor: [] }; meta = {}; }
      else {
        if (!CONFIG.openaiKey) throw new Fel(503, "Tudi kunde inte svara just nu.");
        if (!forbruka(db, uid, "chatt", 1, CHATT_PER_DAG)) throw new Fel(429, TAK_TEXT);
        const val = await valj(uid, kursId, { fraga, historik, sida, dok });
        if (val.typ === "sidan") ({ svar, meta } = await forklaraSida(fullDok(sida.dokId), sida.nr, { kvot: false }));
        else {
          meta = { typ: "chatt", val };
          svar = await svara(uid, kursId, { fraga, sida, historik, val, dok });
        }
      }
    }

    const nu = Date.now();
    const spara = db.prepare("INSERT INTO messages (user_id, course_id, roll, text, kallor, tid, meta) VALUES (?, ?, ?, ?, ?, ?, ?)");
    const fr = spara.run(uid, kursId, "student", visas, "[]", nu, "{}");
    const sv = spara.run(uid, kursId, "tudi", svar.svar, JSON.stringify(svar.kallor), nu, JSON.stringify(meta));
    return {
      fraga: { id: Number(fr.lastInsertRowid), roll: "student", text: visas, kallor: [], tid: nu, meta: {} },
      svar: { id: Number(sv.lastInsertRowid), roll: "tudi", text: svar.svar, kallor: svar.kallor, tid: nu, meta: utMeta(meta) },
    };
  }, { maxBody: 3 * 1024 * 1024 });

  /* Tal till text, för att ställa frågor med rösten. Ljudet sparas inte. */
  rutt("POST", "/api/tal", async ctx => {
    const typ = String(ctx.req.headers["content-type"] || "").split(";")[0];
    if (!/^audio\/(webm|mp4|ogg|mpeg|wav|x-m4a)$/.test(typ)) throw new Fel(415, "Fel sorts ljud.");
    if (ctx.body.length < 100) throw new Fel(400, "Inget ljud kom fram. Försök igen.");
    if (!CONFIG.openaiKey) throw new Fel(503, "Tal till text fungerar inte just nu.");
    if (!forbruka(db, ctx.user.id, "tal", 1, TAL_PER_DAG)) throw new Fel(429, "Du har använt dagens tal till text. Det fungerar igen i morgon från klockan 06.00. Du kan skriva din fråga under tiden.");
    const fd = new FormData();
    fd.append("file", new Blob([ctx.body], { type: typ }), `tal.${typ.split("/")[1].replace("x-m4a", "m4a")}`);
    fd.append("model", CONFIG.ai.tal.modell);
    fd.append("language", "sv");
    const start = Date.now();
    const r = await fetch(`${CONFIG.openaiBase}/v1/audio/transcriptions`, {
      method: "POST", headers: { Authorization: `Bearer ${CONFIG.openaiKey}` }, body: fd, signal: AbortSignal.timeout(60_000),
    }).catch(() => null);
    const j = r && r.ok ? await r.json().catch(() => null) : null;
    ai.mat({ funktion: "tal", modell: CONFIG.ai.tal.modell, uid: ctx.user.id, usage: j?.usage, ms: Date.now() - start, ok: !!j });
    if (!j) {
      console.error(`[sf] tal till text misslyckades u=${ctx.user.id} ${r ? r.status : "natverk"}`);
      throw new Fel(502, "Tal till text fungerar inte just nu. Du kan skriva din fråga under tiden.");
    }
    return { text: String(j.text || "").trim().slice(0, MAX_FRAGA) };
  }, { ra: "audio/", maxBody: 5 * 1024 * 1024 });

};
