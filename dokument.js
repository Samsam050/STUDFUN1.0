/*
  Dokument: ladda upp PDF, dela texten i bitar, vektorer från OpenAI, hämta och radera.

  Texten plockas ut i studentens webbläsare med pdf.js och skickas hit sida för sida.
  Själva PDF:en sparas med ett slumpat namn i datamappen. Servern öppnar den aldrig,
  den skickas bara tillbaka till ägaren.

  Flödet:
    1. POST /api/kurser/:kursId/dokument  { titel, sidor: [text för sida 1, sida 2, ...] }
       Skapar dokumentet med status vantar_fil och sparar bitarna.
    2. PUT /api/dokument/:id/fil  (själva PDF:en, application/pdf)
       Sparar filen och sätter status bearbetas. Vektorerna görs i bakgrunden, sedan klar.
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

module.exports = function ({ db, CONFIG, Fel, rutt, raderaPdf }) {
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
    const id = transaktion(db, () => {
      const r = db.prepare("INSERT INTO documents (user_id, course_id, titel, sidor, status, fil, storlek, skapad) VALUES (?, ?, ?, ?, 'vantar_fil', ?, 0, ?)")
        .run(uid, ctx.params.kursId, titel, rena.length, fil, Date.now());
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

  /* Texten sida för sida, till läsläget. Sidor utan text blir tomma. */
  rutt("GET", "/api/dokument/:id/sidor", ctx => {
    const d = dokument(ctx.user.id, ctx.params.id);
    const sidor = Array.from({ length: d.sidor }, () => []);
    for (const b of db.prepare("SELECT sida, text FROM chunks WHERE document_id = ? AND user_id = ? ORDER BY id").all(d.id, ctx.user.id)) {
      if (sidor[b.sida - 1]) sidor[b.sida - 1].push(b.text);
    }
    return { sidor: sidor.map(t => t.join(" ")) };
  });

  /* Var studenten slutade läsa, så att filen öppnas där nästa gång */
  rutt("PUT", "/api/dokument/:id/position", ctx => {
    const d = dokument(ctx.user.id, ctx.params.id);
    const sida = ctx.body.sida;
    if (!Number.isInteger(sida) || sida < 1 || sida > d.sidor) throw new Fel(400, "Sidan finns inte.");
    db.prepare("UPDATE documents SET senast_sida = ? WHERE id = ? AND user_id = ?").run(sida, d.id, ctx.user.id);
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

  /* Vektorerna görs en gång per dokument, ett dokument i taget, i bakgrunden */
  const ko = [];
  let igang = false;
  function koa(id) { if (!ko.includes(id)) ko.push(id); kor(); }
  async function kor() {
    if (igang) return;
    igang = true;
    while (ko.length) {
      const id = ko.shift();
      for (let forsok = 1; ; forsok++) {
        try { await vektorisera(id); break; }
        catch (e) {
          console.error(`[sf] vektorer misslyckades d=${id} forsok=${forsok} ${e.code || e.name}`);
          if (forsok === 3) { db.prepare("UPDATE documents SET status = 'fel' WHERE id = ? AND status = 'bearbetas'").run(id); break; }
          await new Promise(r => setTimeout(r, forsok * 5000));
        }
      }
    }
    igang = false;
  }
  async function vektorisera(id) {
    if (!CONFIG.openaiKey) { console.error(`[sf] OPENAI_API_KEY saknas, d=${id} väntar`); return; }
    const bitar = db.prepare("SELECT id, text FROM chunks WHERE document_id = ? AND vektor IS NULL ORDER BY id").all(id);
    for (let i = 0; i < bitar.length; i += VEKTOR_PER_ANROP) {
      const del = bitar.slice(i, i + VEKTOR_PER_ANROP);
      const r = await fetch(`${CONFIG.openaiBase}/v1/embeddings`, {
        method: "POST",
        headers: { Authorization: `Bearer ${CONFIG.openaiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model: CONFIG.vektorModell, input: del.map(b => b.text) }),
        signal: AbortSignal.timeout(60_000),
      });
      if (!r.ok) throw Object.assign(new Error("openai"), { code: `OPENAI_${r.status}` });
      const { data } = await r.json();
      if (!Array.isArray(data) || data.length !== del.length) throw Object.assign(new Error("openai"), { code: "OPENAI_SVAR" });
      const spara = db.prepare("UPDATE chunks SET vektor = ? WHERE id = ? AND document_id = ?");
      transaktion(db, () => data.forEach((v, k) => spara.run(Buffer.from(new Float32Array(v.embedding).buffer), del[k].id, id)));
    }
    db.prepare("UPDATE documents SET status = 'klar' WHERE id = ? AND status = 'bearbetas'").run(id);
    console.log(`[sf] dokument klart d=${id} bitar=${bitar.length}`);
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
