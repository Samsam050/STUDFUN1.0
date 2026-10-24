/*
  Tudi i chatten: svarar på frågor utifrån kursens material, med sidhänvisningar som [s. 12].

  Det här skickas, i den här ordningen. Det som är lika mellan frågorna först, så att OpenAI kan spara början:
    1. Den gemensamma grunden och chatt.md.
    2. Kursens dokument med titel, antal sidor och sammanfattning.
    3. Sidan studenten har öppen, om det finns en.
    4. De 4 bitar ur kursen som liknar frågan mest.
    5. De 6 senaste meddelandena.
    6. Frågan.
  Ingen bild skickas. Frågor om hela dokumentet besvaras med sammanfattningarna, hela dokumentet skickas aldrig.
  Servern kontrollerar sidhänvisningarna. Hänvisningar till sidor Tudi inte fick se tas bort.
*/
const { forbruka } = require("./db");
const kallor = require("./kallor");

const CHATT_PER_DAG = 80;
const TAL_PER_DAG = 40;
const BITAR = 4;
const HISTORIK = 6;
const MAX_FRAGA = 1000;
const TAK_TEXT = "Du har ställt dagens frågor till Tudi. Du kan fråga igen i morgon från klockan 06.00. Sidan, uppläsningen och övningarna fungerar som vanligt.";
const INGET_MATERIAL = "Det finns inget färdigt material i kursen än. Ladda upp en PDF, så kan jag svara utifrån den.";
/* Knapparna under senaste svaret. Tillägget är samma prompt som för sidan. */
const FOLJD = {
  enklare: ["Enklare", "satt-enklare"],
  steg: ["Steg för steg", "satt-steg-for-steg"],
  exempel: ["Ge ett exempel", "satt-exempel"],
  annat: ["Förklara på ett annat sätt", "satt-annat-satt"],
};

function cosinus(a, b) {
  let p = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { p += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return p / (Math.sqrt(na * nb) || 1);
}
const vektorAv = blob => new Float32Array(blob.buffer, blob.byteOffset, blob.byteLength / 4);
const lasDelar = d => { try { return JSON.parse(d.delar || "[]"); } catch { return []; } };

module.exports = function ({ db, CONFIG, Fel, rutt, ai }) {
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
      `Dokument: ${d.titel}`, `Antal sidor: ${d.sidor}`,
      d.kort ? `Kort: ${d.kort}` : "", d.sammanfattning ? `Sammanfattning: ${d.sammanfattning}` : "",
      ...lasDelar(d).map(x => `• s. ${x.sidor}: ${x.handlar_om}`),
    ].filter(Boolean).join("\n")).join("\n\n"));
  }

  /* Ställer frågan till modellen. Returnerar svaret och sidhänvisningarna i den ordning de står. */
  async function svara(ctx, { kursId, fraga, sokText, sida, historik }) {
    const uid = ctx.user.id;
    const dok = db.prepare("SELECT * FROM documents WHERE course_id = ? AND user_id = ? AND status = 'klar' ORDER BY skapad, id").all(kursId, uid);
    if (!dok.length) return { svar: INGET_MATERIAL, kallor: [] };
    if (!CONFIG.openaiKey) throw new Fel(503, "Tudi kunde inte svara just nu.");
    if (!forbruka(db, uid, "chatt", 1, CHATT_PER_DAG)) throw new Fel(429, TAK_TEXT);

    try {
      const till = kallor.tillatna();
      for (const d of dok) {
        for (const x of lasDelar(d)) till.spann(d.id, x.sidor);
        for (const a of db.prepare("SELECT fran, till FROM avsnitt WHERE document_id = ?").all(d.id)) till.spann(d.id, `${a.fran}-${a.till}`);
      }
      const delar = [];
      if (sida) {
        const text = db.prepare("SELECT text FROM chunks WHERE document_id = ? AND sida = ? ORDER BY id").all(sida.dokId, sida.nr).map(b => b.text).join(" ");
        delar.push(`Sidan studenten har öppen: ${sida.titel}, sida ${sida.nr}.\n${ai.material(text || "Sidan har ingen text.")}`);
        till.sida(sida.dokId, sida.nr);
      }
      const bitar = await sok(uid, kursId, sokText || fraga, sida);
      if (bitar.length) {
        delar.push(`Utdrag ur materialet som liknar frågan:\n${ai.material(bitar.map(b => `[${b.titel}, s. ${b.sida}]\n${b.text}`).join("\n\n"))}`);
        for (const b of bitar) till.sida(b.document_id, b.sida);
      }
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
      const k = kallor.kontrollera(ut, { till, dokument: dok.map(d => ({ id: d.id, titel: d.titel })), standard: sida ? sida.dokId : null });
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
    return { dokId: d.id, nr: s.nr, titel: d.titel };
  }

  const meddelande = m => ({ id: m.id, roll: m.roll, text: m.text, kallor: JSON.parse(m.kallor), tid: m.tid });

  rutt("GET", "/api/kurser/:kursId/meddelanden", ctx => {
    kurs(ctx.user.id, ctx.params.kursId);
    const rader = db.prepare("SELECT * FROM messages WHERE course_id = ? AND user_id = ? ORDER BY id DESC LIMIT 60").all(ctx.params.kursId, ctx.user.id);
    return { meddelanden: rader.reverse().map(meddelande) };
  });

  /* En fråga i chatten eller i visaren. foljd: en av knapparna under senaste svaret. */
  rutt("POST", "/api/kurser/:kursId/fraga", async ctx => {
    const uid = ctx.user.id, kursId = ctx.params.kursId;
    kurs(uid, kursId);
    const b = ctx.body;
    const historik = db.prepare("SELECT roll, text FROM messages WHERE course_id = ? AND user_id = ? ORDER BY id DESC LIMIT ?").all(kursId, uid, HISTORIK).reverse();
    let fraga, visas, sokText;
    if (b.foljd !== undefined) {
      if (!FOLJD[b.foljd]) throw new Fel(400, "Det valet finns inte.");
      if (historik.length < 2 || historik.at(-1).roll !== "tudi") throw new Fel(400, "Det finns inget svar att förklara.");
      visas = FOLJD[b.foljd][0];
      fraga = ai.prompt(FOLJD[b.foljd][1]);
      const etiketter = Object.values(FOLJD).map(f => f[0]);
      sokText = historik.filter(m => m.roll === "student" && !etiketter.includes(m.text)).at(-1)?.text || historik.at(-1).text;
    } else {
      fraga = typeof b.fraga === "string" ? b.fraga.trim() : "";
      if (!fraga) throw new Fel(400, "Skriv en fråga först.");
      if (fraga.length > MAX_FRAGA) throw new Fel(400, "Frågan är för lång. Dela upp den i flera frågor.");
      visas = fraga;
    }
    const sida = lasSida(uid, kursId, b.sida);
    const svar = await svara(ctx, { kursId, fraga, sokText, sida, historik });
    const nu = Date.now();
    const spara = db.prepare("INSERT INTO messages (user_id, course_id, roll, text, kallor, tid) VALUES (?, ?, ?, ?, ?, ?)");
    const fr = spara.run(uid, kursId, "student", visas, "[]", nu);
    const sv = spara.run(uid, kursId, "tudi", svar.svar, JSON.stringify(svar.kallor), nu);
    return {
      fraga: { id: Number(fr.lastInsertRowid), roll: "student", text: visas, kallor: [], tid: nu },
      svar: { id: Number(sv.lastInsertRowid), roll: "tudi", text: svar.svar, kallor: svar.kallor, tid: nu },
    };
  });

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
