/*
  Dokument: ladda upp PDF, dela texten i bitar, vektorer från OpenAI, hämta och radera.

  Texten plockas ut i studentens webbläsare med pdf.js och skickas hit sida för sida.
  Själva PDF:en sparas med ett slumpat namn i datamappen. Servern öppnar den aldrig,
  den skickas bara tillbaka till ägaren.

  Flödet:
    1. POST /api/kurser/:kursId/dokument  { titel, sidor: [text för sida 1, sida 2, ...] }
       Skapar dokumentet med status vantar_fil och sparar bitarna.
    2. PUT /api/dokument/:id/fil  (själva PDF:en, application/pdf)
       Sparar filen och sätter status bearbetas. I bakgrunden görs vektorerna och sammanfattningen
       ("Tudi läser igenom materialet"), sedan klar.

  Sammanfattningen: dokumentet delas i avsnitt om ungefär 10 sidor. Varje avsnitt sammanfattas för sig,
  och sedan hela dokumentet utifrån avsnittens sammanfattningar, inte utifrån all text igen.
  Tudi använder sammanfattningarna för att hitta rätt, och för frågor om hela dokumentet.
  Laddar studenten upp samma PDF igen återanvänds vektorerna och sammanfattningen.
*/
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { transaktion } = require("./db");

const MAX_PDF_BYTES = 50 * 1024 * 1024;
const MAX_SIDOR = 300;
const MAX_DOKUMENT = 20;
const MAX_TECKEN_PER_SIDA = 30000;
const MIN_TECKEN_PER_SIDA = 10; // färre i snitt: PDF:en är troligen inskannad
const BIT_MAL = 1200; // ungefär en halv sida
const VEKTOR_PER_ANROP = 96;
const AVSNITT_SIDOR = 10;
const MAX_TECKEN_AVSNITT = 40000; // ungefär 10 000 token. Längre avsnitt kortas.
const SAMTIDIGA_AVSNITT = 4;

const AVSNITT = {
  namn: "avsnitt",
  schema: {
    type: "object", additionalProperties: false, required: ["sidor", "rubrik", "sammanfattning", "begrepp"],
    properties: { sidor: { type: "string" }, rubrik: { type: "string" }, sammanfattning: { type: "string" }, begrepp: { type: "array", items: { type: "string" } } },
  },
};
const TYPER = ["tenta", "kursplan", "kursbok", "slides", "artikel", "anteckningar", "annat"];
const HELA = {
  namn: "dokument",
  schema: {
    type: "object", additionalProperties: false, required: ["typ", "kort", "sammanfattning", "delar"],
    properties: {
      typ: { type: "string", enum: TYPER }, kort: { type: "string" }, sammanfattning: { type: "string" },
      delar: { type: "array", items: { type: "object", additionalProperties: false, required: ["sidor", "handlar_om"],
        properties: { sidor: { type: "string" }, handlar_om: { type: "string" } } } },
    },
  },
};

/* Avsnitt om ungefär 10 sidor, lika stora: 23 sidor blir 1–8, 9–16 och 17–23 */
function avsnitt(sidor) {
  const antal = Math.max(1, Math.ceil(sidor / AVSNITT_SIDOR));
  const storlek = Math.ceil(sidor / antal);
  const ut = [];
  for (let fran = 1; fran <= sidor; fran += storlek) ut.push({ fran, till: Math.min(sidor, fran + storlek - 1) });
  return ut;
}

/* Delar sidornas text i bitar om ungefär en halv sida. En bit bryts aldrig mitt i en mening,
   utom när en "mening" själv är för lång, till exempel en tabell. Varje bit har sitt sidnummer. */
function dela(sidor) {
  const bitar = [];
  sidor.forEach((text, i) => {
    const ren = text.replace(/\s+/g, " ").trim();
    const meningar = (ren.match(/[^.!?]*[.!?]+["”’)]*\s*|[^.!?]+/g) || [])
      .flatMap(m => (m.length > BIT_MAL * 1.5 ? m.match(new RegExp(`.{1,${BIT_MAL}}(?:\\s|$)|.{${BIT_MAL}}`, "g")) || [m] : [m]));
    let nu = "";
    for (const m of meningar) {
      if (nu && (nu + m).length > BIT_MAL) { bitar.push({ sida: i + 1, text: nu.trim() }); nu = ""; }
      nu += m;
    }
    if (nu.trim()) bitar.push({ sida: i + 1, text: nu.trim() });
  });
  return bitar;
}

module.exports = function ({ db, CONFIG, Fel, rutt, raderaPdf, ai }) {
  const svar = d => ({ id: d.id, kursId: d.course_id, titel: d.titel, sidor: d.sidor, status: d.status, storlek: d.storlek, senastSida: d.senast_sida });
  function dokument(userId, id) {
    const d = db.prepare("SELECT * FROM documents WHERE id = ? AND user_id = ? AND status != 'vantar_fil'").get(id, userId);
    if (!d) throw new Fel(404, "Filen finns inte.");
    return d;
  }

  rutt("GET", "/api/kurser/:kursId/dokument", ctx => {
    if (!db.prepare("SELECT 1 FROM courses WHERE id = ? AND user_id = ?").get(ctx.params.kursId, ctx.user.id)) throw new Fel(404, "Kursen finns inte.");
    return {
      dokument: db.prepare("SELECT * FROM documents WHERE course_id = ? AND user_id = ? AND status != 'vantar_fil' ORDER BY skapad DESC, id DESC")
        .all(ctx.params.kursId, ctx.user.id).map(svar),
    };
  });

  rutt("POST", "/api/kurser/:kursId/dokument", ctx => {
    const uid = ctx.user.id;
    if (!db.prepare("SELECT 1 FROM courses WHERE id = ? AND user_id = ?").get(ctx.params.kursId, uid)) throw new Fel(404, "Kursen finns inte.");
    const titel = typeof ctx.body.titel === "string" ? ctx.body.titel.trim().slice(0, 200) : "";
    const sidor = ctx.body.sidor;
    if (!titel) throw new Fel(400, "Filen saknar namn.");
    if (!Array.isArray(sidor) || !sidor.length || sidor.some(s => typeof s !== "string")) throw new Fel(400, "Det gick inte att läsa PDF:en.");
    if (sidor.length > MAX_SIDOR) throw new Fel(400, `PDF:en har ${sidor.length} sidor. StudFun klarar högst ${MAX_SIDOR} sidor per fil.`);
    if (sidor.some(s => s.length > MAX_TECKEN_PER_SIDA)) throw new Fel(400, "En sida har för mycket text.");
    const tecken = sidor.reduce((n, s) => n + s.replace(/\s/g, "").length, 0);
    if (tecken < MIN_TECKEN_PER_SIDA * sidor.length) throw new Fel(400, "PDF:en verkar vara inskannad och saknar text.");
    const antal = db.prepare("SELECT COUNT(*) AS n FROM documents WHERE user_id = ?").get(uid).n;
    if (antal >= MAX_DOKUMENT) throw new Fel(400, `Du kan ha högst ${MAX_DOKUMENT} filer. Radera en fil du inte behöver.`);

    const rena = sidor.map(s => s.replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, " "));
    const fil = crypto.randomBytes(16).toString("hex") + ".pdf";
    const innehall = crypto.createHash("sha256").update(rena.join("\f")).digest("hex");
    const id = transaktion(db, () => {
      const r = db.prepare("INSERT INTO documents (user_id, course_id, titel, sidor, status, fil, storlek, skapad, innehall) VALUES (?, ?, ?, ?, 'vantar_fil', ?, 0, ?, ?)")
        .run(uid, ctx.params.kursId, titel, rena.length, fil, Date.now(), innehall);
      const docId = Number(r.lastInsertRowid);
      const ny = db.prepare("INSERT INTO chunks (user_id, document_id, sida, text) VALUES (?, ?, ?, ?)");
      for (const b of dela(rena)) ny.run(uid, docId, b.sida, b.text);
      return docId;
    });
    ctx.status = 201;
    return { id };
  }, { maxBody: 12 * 1024 * 1024 });

  rutt("PUT", "/api/dokument/:id/fil", async ctx => {
    const d = db.prepare("SELECT id, fil FROM documents WHERE id = ? AND user_id = ? AND status = 'vantar_fil'").get(ctx.params.id, ctx.user.id);
    if (!d) throw new Fel(404, "Filen finns inte.");
    const data = ctx.body;
    if (data.length < 5 || data.subarray(0, 5).toString("latin1") !== "%PDF-") throw new Fel(400, "Det här är inte en PDF. StudFun kan bara läsa PDF just nu.");
    const mal = path.join(CONFIG.pdfDir, d.fil);
    await fs.promises.writeFile(mal + ".tmp", data, { mode: 0o600 });
    await fs.promises.rename(mal + ".tmp", mal);
    const r = db.prepare("UPDATE documents SET status = 'bearbetas', storlek = ? WHERE id = ? AND user_id = ? AND status = 'vantar_fil'")
      .run(data.length, d.id, ctx.user.id);
    if (r.changes === 0) { raderaPdf(d); throw new Fel(404, "Filen finns inte."); } // raderades under uppladdningen
    koa(d.id);
    return svar(dokument(ctx.user.id, d.id));
  }, { ra: "application/pdf", maxBody: MAX_PDF_BYTES });

  rutt("GET", "/api/dokument/:id", ctx => svar(dokument(ctx.user.id, ctx.params.id)));

  /* Var studenten slutade läsa, så att filen öppnas där nästa gång */
  rutt("PUT", "/api/dokument/:id/position", ctx => {
    const d = dokument(ctx.user.id, ctx.params.id);
    const sida = ctx.body.sida;
    if (!Number.isInteger(sida) || sida < 1 || sida > d.sidor) throw new Fel(400, "Sidan finns inte.");
    db.prepare("UPDATE documents SET senast_sida = ?, senast_last = ? WHERE id = ? AND user_id = ?").run(sida, Date.now(), d.id, ctx.user.id);
    return {};
  });

  /* PDF:en, bara till ägaren. attachment gör att webbläsaren aldrig visar den själv. Appen läser den med pdf.js. */
  rutt("GET", "/api/dokument/:id/fil", async ctx => {
    const d = dokument(ctx.user.id, ctx.params.id);
    const data = await fs.promises.readFile(path.join(CONFIG.pdfDir, d.fil));
    ctx.res.writeHead(200, {
      ...CONFIG.sakerhet,
      "Content-Type": "application/pdf",
      "Content-Disposition": 'attachment; filename="dokument.pdf"',
      "Cache-Control": "private, no-store",
      "Content-Length": data.length,
    });
    ctx.res.end(data);
  });

  /* Filen, texten, sökindexet och frågor och kort som gjorts från den (ON DELETE CASCADE) */
  rutt("DELETE", "/api/dokument/:id", ctx => {
    const d = db.prepare("SELECT id, fil FROM documents WHERE id = ? AND user_id = ?").get(ctx.params.id, ctx.user.id);
    if (!d) throw new Fel(404, "Filen finns inte.");
    raderaPdf(d);
    db.prepare("DELETE FROM documents WHERE id = ? AND user_id = ?").run(d.id, ctx.user.id);
    console.log(`[sf] dokument raderat u=${ctx.user.id} d=${d.id}`);
    return {};
  });

  /* Vektorerna och sammanfattningen görs en gång per dokument, ett dokument i taget, i bakgrunden.
     Misslyckas något görs bara det som saknas vid nästa försök. */
  const ko = [];
  let igang = false;
  function koa(id) { if (!ko.includes(id)) ko.push(id); kor(); }
  async function kor() {
    if (igang) return;
    igang = true;
    while (ko.length) {
      const id = ko.shift();
      for (let forsok = 1; ; forsok++) {
        try {
          if (!CONFIG.openaiKey) { console.error(`[sf] OPENAI_API_KEY saknas, d=${id} väntar`); break; }
          await vektorisera(id);
          await sammanfatta(id);
          db.prepare("UPDATE documents SET status = 'klar' WHERE id = ? AND status = 'bearbetas'").run(id);
          console.log(`[sf] dokument klart d=${id}`);
          break;
        }
        catch (e) {
          console.error(`[sf] dokument misslyckades d=${id} forsok=${forsok} ${e.code || e.name}${e.detalj ? ` ${e.detalj}` : ""}`);
          if (forsok === 3) { db.prepare("UPDATE documents SET status = 'fel' WHERE id = ? AND status = 'bearbetas'").run(id); break; }
          await new Promise(r => setTimeout(r, forsok * 5000));
        }
      }
    }
    igang = false;
  }
  /* Samma PDF som studenten redan har laddat upp och som är klar */
  function tvilling(id) {
    const d = db.prepare("SELECT user_id, innehall FROM documents WHERE id = ?").get(id);
    if (!d || !d.innehall) return null;
    return db.prepare("SELECT * FROM documents WHERE user_id = ? AND innehall = ? AND id != ? AND status = 'klar' ORDER BY id LIMIT 1").get(d.user_id, d.innehall, id) || null;
  }

  async function vektorisera(id) {
    const uid = db.prepare("SELECT user_id FROM documents WHERE id = ?").get(id)?.user_id;
    const bitar = db.prepare("SELECT id, text FROM chunks WHERE document_id = ? AND vektor IS NULL ORDER BY id").all(id);
    const tv = bitar.length && tvilling(id);
    if (tv) {
      /* Samma text ger samma bitar i samma ordning */
      const gamla = db.prepare("SELECT text, vektor FROM chunks WHERE document_id = ? ORDER BY id").all(tv.id);
      const alla = db.prepare("SELECT id, text FROM chunks WHERE document_id = ? ORDER BY id").all(id);
      if (gamla.length === alla.length && gamla.every((g, i) => g.vektor && g.text === alla[i].text)) {
        const spara = db.prepare("UPDATE chunks SET vektor = ? WHERE id = ? AND document_id = ?");
        transaktion(db, () => alla.forEach((b, i) => spara.run(gamla[i].vektor, b.id, id)));
        console.log(`[sf] vektorer återanvända d=${id} fran=${tv.id}`);
        return;
      }
    }
    for (let i = 0; i < bitar.length; i += VEKTOR_PER_ANROP) {
      const del = bitar.slice(i, i + VEKTOR_PER_ANROP);
      const data = await ai.vektorer(del.map(b => b.text), { uid, funktion: "vektorer" });
      const spara = db.prepare("UPDATE chunks SET vektor = ? WHERE id = ? AND document_id = ?");
      transaktion(db, () => data.forEach((v, k) => spara.run(Buffer.from(new Float32Array(v).buffer), del[k].id, id)));
    }
  }

  async function sammanfatta(id) {
    const d = db.prepare("SELECT id, user_id, titel, sidor, sammanfattning FROM documents WHERE id = ?").get(id);
    if (!d || d.sammanfattning != null) return;
    const tv = tvilling(id);
    if (tv && tv.sammanfattning != null) {
      transaktion(db, () => {
        db.prepare("DELETE FROM avsnitt WHERE document_id = ?").run(id);
        db.prepare(`INSERT INTO avsnitt (user_id, document_id, fran, till, rubrik, sammanfattning, begrepp)
          SELECT user_id, ?, fran, till, rubrik, sammanfattning, begrepp FROM avsnitt WHERE document_id = ?`).run(id, tv.id);
        db.prepare("UPDATE documents SET typ = ?, kort = ?, sammanfattning = ?, delar = ? WHERE id = ?").run(tv.typ, tv.kort, tv.sammanfattning, tv.delar, id);
      });
      console.log(`[sf] sammanfattning återanvänd d=${id} fran=${tv.id}`);
      return;
    }

    const sidtext = new Map();
    for (const b of db.prepare("SELECT sida, text FROM chunks WHERE document_id = ? ORDER BY id").all(id)) {
      sidtext.set(b.sida, (sidtext.has(b.sida) ? sidtext.get(b.sida) + " " : "") + b.text);
    }
    const klara = new Set(db.prepare("SELECT fran FROM avsnitt WHERE document_id = ?").all(id).map(a => a.fran));
    const kvar = avsnitt(d.sidor).filter(a => !klara.has(a.fran));
    const nyttAvsnitt = db.prepare("INSERT INTO avsnitt (user_id, document_id, fran, till, rubrik, sammanfattning, begrepp) VALUES (?, ?, ?, ?, ?, ?, ?)");
    for (let i = 0; i < kvar.length; i += SAMTIDIGA_AVSNITT) {
      await Promise.all(kvar.slice(i, i + SAMTIDIGA_AVSNITT).map(async a => {
        const text = [];
        for (let s = a.fran; s <= a.till; s++) if (sidtext.get(s)) text.push(`[Sida ${s}]\n${sidtext.get(s)}`);
        const sidor = `${a.fran}–${a.till}`;
        if (!text.length) return nyttAvsnitt.run(d.user_id, id, a.fran, a.till, "", "Sidorna har ingen text, bara bilder.", "[]");
        const ut = await ai.svar({
          funktion: "sammanfattning", uid: d.user_id, schema: AVSNITT,
          system: ai.prompt("sammanfatta-avsnitt"),
          inne: [{ role: "user", content: `Sidorna ${sidor} av ${d.sidor}.\n\n${ai.material(`Dokument: ${d.titel}\n\n${text.join("\n\n").slice(0, MAX_TECKEN_AVSNITT)}`)}` }],
        });
        const begrepp = (Array.isArray(ut.begrepp) ? ut.begrepp : []).map(b => String(b).trim().slice(0, 100)).filter(Boolean).slice(0, 20);
        nyttAvsnitt.run(d.user_id, id, a.fran, a.till, String(ut.rubrik || "").trim().slice(0, 200), String(ut.sammanfattning || "").trim().slice(0, 2000), JSON.stringify(begrepp));
      }));
    }

    const rader = db.prepare("SELECT fran, till, rubrik, sammanfattning, begrepp FROM avsnitt WHERE document_id = ? ORDER BY fran").all(id);
    const ut = await ai.svar({
      funktion: "sammanfattning", uid: d.user_id, schema: HELA, maxUt: 2500,
      system: ai.prompt("sammanfatta-dokument"),
      inne: [{ role: "user", content: `Dokumentet har ${d.sidor} sidor.\n\n${ai.material(`Dokument: ${d.titel}\n\n${JSON.stringify(rader.map(r => ({
        sidor: `${r.fran}–${r.till}`, rubrik: r.rubrik, sammanfattning: r.sammanfattning, begrepp: JSON.parse(r.begrepp),
      })))}`)}` }],
    });
    const delar = (Array.isArray(ut.delar) ? ut.delar : [])
      .map(x => ({ sidor: String(x.sidor || "").trim().slice(0, 20), handlar_om: String(x.handlar_om || "").trim().slice(0, 300) }))
      .filter(x => x.sidor && x.handlar_om).slice(0, 40);
    db.prepare("UPDATE documents SET typ = ?, kort = ?, sammanfattning = ?, delar = ? WHERE id = ?")
      .run(TYPER.includes(ut.typ) ? ut.typ : "annat", String(ut.kort || "").trim().slice(0, 300), String(ut.sammanfattning || "").trim().slice(0, 3000), JSON.stringify(delar), id);
    console.log(`[sf] sammanfattning klar d=${id} avsnitt=${rader.length}`);
  }

  /* Vid start: fortsätt med det som inte hann bli klart, och städa bort uppladdningar som avbröts */
  function stada() {
    for (const d of db.prepare("SELECT id, fil FROM documents WHERE status = 'vantar_fil' AND skapad < ?").all(Date.now() - 3600 * 1000)) {
      raderaPdf(d);
      db.prepare("DELETE FROM documents WHERE id = ?").run(d.id);
    }
  }
  stada();
  setInterval(stada, 3600 * 1000).unref();
  for (const { id } of db.prepare("SELECT id FROM documents WHERE status = 'bearbetas'").all()) koa(id);
};

module.exports.dela = dela;
module.exports.avsnitt = avsnitt;
/* Vad dokumentet är. Dokument från före typen gissas från titeln. */
module.exports.dokTyp = d => d.typ
  || (/tenta|tentamen|exam/i.test(d.titel) ? "tenta" : /kursplan|syllabus|studiehandledning|kurs-?pm/i.test(d.titel) ? "kursplan" : "annat");
