/*
  AI: alla anrop till OpenAI går härifrån. Se AI-ARKITEKTUR i projektet för vad varje funktion skickar.

  * Prompterna ligger i prompts/ och läses om när filen ändras. En prompt kan alltså ändras utan ny kod och utan omstart.
  * Modell och tänkande för varje funktion står i CONFIG.ai, som läses från .env.
  * Varje anrop har store: false, ett tak för svarslängd och tänkandet satt uttryckligen.
  * Det som är lika i varje anrop läggs först (systemprompten, sedan dokumentets sammanfattning) och det som ändras sist.
    Då kan OpenAI återanvända början av anropet, och den delen kostar en tiondel.
  * Svarar OpenAI inte, eller kommer JSON tillbaka trasig, görs ett nytt försök. Går det inte heller ger anropet upp.
  * Varje anrop mäts i ai_anrop: funktion, modell, token, tid och studentens slumpade id. Aldrig text.
  * Felsökning med AI_LOGG i .env:
      AI_LOGG=1      en rad per anrop i serverns logg: funktion, modell, tänkande, token, tid, och för chatten vad nano valde
                     och vilket material Luna fick. Ingen text från studenten eller materialet.
      AI_LOGG=fullt  dessutom hela anropen och svaren i DATA_DIR/ai-logg/<dag>.jsonl. Innehåller studentens frågor
                     och kursmaterial, så bara för test. Filerna raderas efter 7 dagar.
  * Svar som kan komma igen sparas i ai_cache, per student. Nyckeln innehåller prompten och modellen,
    så en ändrad prompt eller modell ger nya svar.
*/
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { dag } = require("./db");

const MAPP = path.join(__dirname, "prompts");
const CACHE_DAGAR = 90; // sparade svar som ingen har hämtat på så här länge städas bort
const LOGG_DAGAR = 7;    // filerna med AI_LOGG=fullt

const lasta = new Map();
/* Prompten i prompts/<namn>.md */
function prompt(namn) {
  if (!/^[a-z-]+$/.test(namn)) throw new Error("promptnamn");
  const fil = path.join(MAPP, `${namn}.md`);
  const tid = fs.statSync(fil).mtimeMs;
  const l = lasta.get(namn);
  if (l && l.tid === tid) return l.text;
  const text = fs.readFileSync(fil, "utf8").trim();
  lasta.set(namn, { tid, text });
  return text;
}
/* Systemprompten för en funktion där Tudi pratar med studenten: den gemensamma grunden först, alltid likadan */
const tudiPrompt = namn => `${prompt("tudi-grund")}\n\n${prompt(namn)}`;

/* Text från dokument och studenter får inte kunna stänga <material> i förtid */
const ren = t => String(t).replace(/<\s*\/?\s*material\s*>/gi, " ");
const material = t => `<material>\n${ren(t)}\n</material>`;

const hash = (...delar) => crypto.createHash("sha256").update(JSON.stringify(delar)).digest("hex");

/* Texten i ett svar från Responses API */
const utText = j => (j.output || []).filter(o => o.type === "message")
  .flatMap(o => o.content || []).filter(c => c.type === "output_text").map(c => c.text).join("").trim();

const fel = kod => Object.assign(new Error("openai"), { code: kod });

module.exports = function ({ db, CONFIG }) {
  async function post(sokvag, body, ms) {
    const r = await fetch(`${CONFIG.openaiBase}${sokvag}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${CONFIG.openaiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(ms),
    }).catch(() => null);
    if (!r || !r.ok) {
      /* OpenAI:s egen förklaring, till exempel en modell som inte finns eller ett värde den inte tar emot. Innehåller ingen text från studenten. */
      const j = r ? await r.json().catch(() => null) : null;
      const e = fel(`OPENAI_${r ? r.status : "NATVERK"}`);
      if (j?.error) e.detalj = `${j.error.code || j.error.type || ""}${j.error.param ? ` param=${j.error.param}` : ""} ${String(j.error.message || "").slice(0, 200)}`.trim();
      throw e;
    }
    return r.json();
  }

  /* Felsökning, se AI_LOGG ovan */
  const loggMapp = path.join(CONFIG.dataDir, "ai-logg");
  function logg(rad) { if (CONFIG.aiLogg) console.log(`[ai] ${rad}`); }
  function loggFullt(post) {
    if (CONFIG.aiLogg !== "fullt") return;
    fs.mkdirSync(loggMapp, { recursive: true, mode: 0o700 });
    /* Bilder blir bara sin storlek, så att filen går att läsa */
    const text = JSON.stringify({ tid: new Date().toISOString(), ...post }, (k, v) => (typeof v === "string" && v.startsWith("data:image/") ? `[bild, ${v.length} tecken]` : v));
    fs.appendFileSync(path.join(loggMapp, `${dag()}.jsonl`), text + "\n", { mode: 0o600 });
  }

  /* Studentens slumpade id i mätningen. Det går inte att räkna ut vem studenten är från id:t,
     och raderas kontot finns ingen koppling kvar. */
  function matId(uid) {
    if (!uid) return "";
    const r = db.prepare("SELECT matid FROM users WHERE id = ?").get(uid);
    if (!r) return "";
    if (r.matid) return r.matid;
    db.prepare("UPDATE users SET matid = ? WHERE id = ? AND matid IS NULL").run(crypto.randomBytes(8).toString("hex"), uid);
    return db.prepare("SELECT matid FROM users WHERE id = ?").get(uid).matid;
  }

  /* Sparar ett anrop i mätningen. usage är OpenAI:s egen räkning. */
  function mat({ funktion, modell, uid, usage, ms, ok, tecken = 0 }) {
    const u = usage || {};
    db.prepare(`INSERT INTO ai_anrop (dag, tid, funktion, modell, student, token_in, token_cache, token_ut, token_tank, tecken, ms, ok)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      dag(), Date.now(), funktion, modell, matId(uid),
      u.input_tokens ?? u.prompt_tokens ?? 0, u.input_tokens_details?.cached_tokens ?? 0,
      u.output_tokens ?? 0, u.output_tokens_details?.reasoning_tokens ?? 0, tecken, ms, ok ? 1 : 0);
  }

  /* Ett anrop till Responses API.
     funktion  nyckel i CONFIG.ai, till exempel "sida"
     system    systemprompten
     fast      text som är lika i flera anrop, till exempel dokumentets sammanfattning. Läggs direkt efter systemprompten.
     inne      resten: en lista med meddelanden { role, content }, det som ändras sist
     schema    { namn, schema }: svaret ska vara JSON enligt schemat, och kommer tillbaka som ett objekt
     effort, maxUt  ändrar funktionens standard
     cache     det som anropet hör till, till exempel dokumentet. Gör att OpenAI skickar liknande anrop till samma maskin. */
  async function svar({ funktion, uid, system, fast, inne, schema, effort, maxUt, cache }) {
    const inst = CONFIG.ai[funktion];
    const tank = effort ?? inst.effort;
    const body = {
      model: inst.modell,
      store: false,
      max_output_tokens: maxUt || inst.maxUt,
      ...(tank ? { reasoning: { effort: tank } } : {}),
      ...(schema ? { text: { format: { type: "json_schema", name: schema.namn, strict: true, schema: schema.schema } } } : {}),
      ...(cache ? { prompt_cache_key: hash(funktion, matId(uid), cache).slice(0, 32) } : {}),
      input: [{ role: "developer", content: system }, ...(fast ? [{ role: "user", content: fast }] : []), ...inne],
    };
    for (let forsok = 1; ; forsok++) {
      const start = Date.now();
      let j = null;
      try {
        j = await post("/v1/responses", body, 90_000);
        const text = utText(j);
        if (!text) throw fel("OPENAI_TOMT");
        if (schema && j.status === "incomplete") throw fel("OPENAI_AVBRUTET");
        const ut = schema ? JSON.parse(text) : text;
        mat({ funktion, modell: inst.modell, uid, usage: j.usage, ms: Date.now() - start, ok: true });
        if (j.status === "incomplete") console.error(`[sf] ai ${funktion} nådde taket för svarslängd`);
        const u = j.usage || {};
        logg(`${funktion} ${inst.modell} tänkande=${tank || "-"} in=${u.input_tokens ?? "?"} cache=${u.input_tokens_details?.cached_tokens ?? "?"} ut=${u.output_tokens ?? "?"} tank=${u.output_tokens_details?.reasoning_tokens ?? "?"} ms=${Date.now() - start}${j.status === "incomplete" ? " AVBRUTET" : ""}`);
        loggFullt({ funktion, anrop: body, svar: ut });
        return ut;
      } catch (e) {
        mat({ funktion, modell: inst.modell, uid, usage: j?.usage, ms: Date.now() - start, ok: false });
        console.error(`[sf] ai ${funktion} ${inst.modell} misslyckades forsok=${forsok} ${e.code || e.name}${e.detalj ? ` ${e.detalj}` : ""}`);
        loggFullt({ funktion, anrop: body, fel: `${e.code || e.name}${e.detalj ? ` ${e.detalj}` : ""}`, svar: j ? utText(j) : null });
        if (forsok === 2) throw e;
      }
    }
  }

  /* Vektorer för sökningen. funktion är bara namnet i mätningen, till exempel "vektorer" vid uppladdning. */
  async function vektorer(texter, { uid, funktion }) {
    const modell = CONFIG.ai.embed.modell;
    for (let forsok = 1; ; forsok++) {
      const start = Date.now();
      let j = null;
      try {
        j = await post("/v1/embeddings", { model: modell, input: texter, dimensions: CONFIG.vektorDim }, 60_000);
        if (!Array.isArray(j.data) || j.data.length !== texter.length) throw fel("OPENAI_SVAR");
        mat({ funktion, modell, uid, usage: j.usage, ms: Date.now() - start, ok: true });
        return j.data.map(d => d.embedding);
      } catch (e) {
        mat({ funktion, modell, uid, usage: j?.usage, ms: Date.now() - start, ok: false });
        if (forsok === 2) throw e;
      }
    }
  }

  /* En nyckel som ändras när modellen, tänkandet eller någon av prompterna ändras */
  function version(funktion, effort, ...prompter) {
    const inst = CONFIG.ai[funktion];
    return hash(inst.modell, effort ?? inst.effort, ...prompter.map(prompt));
  }

  /* Sparat svar, eller ett nytt från skapa(). Ett nytt svar sparas bara om skapa() lyckas.
     typ      vad svaret är, till exempel "sida:enklare"
     nyckel   allt som gör svaret unikt. Börja med version(...)
     dokId, kursId  svaret raderas med dokumentet eller kursen
     Returnerar { svar, nyckel, franCache } */
  async function cachad({ uid, typ, nyckel, dokId = null, kursId = null }, skapa) {
    const n = hash(typ, nyckel);
    const rad = db.prepare("SELECT svar FROM ai_cache WHERE user_id = ? AND nyckel = ?").get(uid, n);
    if (rad) {
      db.prepare("UPDATE ai_cache SET anvand = ? WHERE user_id = ? AND nyckel = ?").run(Date.now(), uid, n);
      return { svar: JSON.parse(rad.svar), nyckel: n, franCache: true };
    }
    const ny = await skapa();
    const nu = Date.now();
    db.prepare(`INSERT OR REPLACE INTO ai_cache (user_id, nyckel, typ, document_id, course_id, svar, skapad, anvand)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(uid, n, typ, dokId, kursId, JSON.stringify(ny), nu, nu);
    return { svar: ny, nyckel: n, franCache: false };
  }

  /* Ett sparat svar med sin nyckel, till exempel förklaringen studenten vill ha på ett annat sätt */
  function sparat(uid, nyckel) {
    if (typeof nyckel !== "string" || !/^[a-f0-9]{64}$/.test(nyckel)) return null;
    const r = db.prepare("SELECT typ, document_id, svar FROM ai_cache WHERE user_id = ? AND nyckel = ?").get(uid, nyckel);
    return r && { typ: r.typ, dokId: r.document_id, svar: JSON.parse(r.svar) };
  }

  /* Byter ut ett sparat svar, till exempel när studenten vill ha en ny ordning i Börja här */
  function glom(uid, typ, nyckel) {
    db.prepare("DELETE FROM ai_cache WHERE user_id = ? AND nyckel = ?").run(uid, hash(typ, nyckel));
  }

  function stada() {
    db.prepare("DELETE FROM ai_cache WHERE anvand < ?").run(Date.now() - CACHE_DAGAR * 86400 * 1000);
    const gammal = dag(new Date(Date.now() - LOGG_DAGAR * 86400 * 1000));
    for (const f of fs.existsSync(loggMapp) ? fs.readdirSync(loggMapp) : []) {
      if (/^\d{4}-\d{2}-\d{2}\.jsonl$/.test(f) && f.slice(0, 10) < gammal) fs.rmSync(path.join(loggMapp, f), { force: true });
    }
  }
  stada();
  setInterval(stada, 24 * 3600 * 1000).unref();

  return { prompt, tudiPrompt, material, ren, post, mat, svar, vektorer, version, cachad, sparat, glom, logg };
};
