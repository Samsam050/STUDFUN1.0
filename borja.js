/*
  Börja här: Tudi föreslår i vilken ordning studenten ska gå igenom kursens material.

  Bara dokumentens titlar och sammanfattningar skickas, inte texten. Förslaget sparas tills nytt material
  laddas upp eller något raderas, eftersom nyckeln innehåller dokumenten och deras sammanfattningar.
  Föreslå en ny ordning tar bort det sparade förslaget och ber om ett nytt.
*/
const { forbruka } = require("./db");

const BORJA_PER_DAG = 10;
const MAX_STEG = 6;
const SCHEMA = {
  namn: "borja_har",
  schema: {
    type: "object", additionalProperties: false, required: ["steg"],
    properties: { steg: { type: "array", items: { type: "object", additionalProperties: false, required: ["dokument_id", "sidor", "varfor"],
      properties: { dokument_id: { type: "string" }, sidor: { type: "string" }, varfor: { type: "string" } } } } },
  },
};

module.exports = function ({ db, CONFIG, Fel, rutt, ai }) {
  function dokument(uid, kursId) {
    if (!db.prepare("SELECT 1 FROM courses WHERE id = ? AND user_id = ?").get(kursId, uid)) throw new Fel(404, "Kursen finns inte.");
    return db.prepare(`SELECT id, titel, sidor, kort, sammanfattning, delar FROM documents
      WHERE course_id = ? AND user_id = ? AND status = 'klar' AND sammanfattning IS NOT NULL ORDER BY skapad, id`).all(kursId, uid);
  }
  const nyckel = dok => [ai.version("borja", undefined, "borja-har"), dok.map(d => [d.id, d.sidor, d.sammanfattning, d.delar])];

  async function forslag(uid, kursId, dok) {
    const r = await ai.cachad({ uid, typ: "borja", kursId, nyckel: nyckel(dok) }, async () => {
      if (!forbruka(db, uid, "borja", 1, BORJA_PER_DAG)) throw new Fel(429, "Tudi har föreslagit dagens ordningar. Du kan be om en ny i morgon från klockan 06.00.");
      const ut = await ai.svar({
        funktion: "borja", uid, schema: SCHEMA, system: ai.prompt("borja-har"),
        inne: [{ role: "user", content: ai.material(dok.map(d => {
          let delar = [];
          try { delar = JSON.parse(d.delar || "[]"); } catch { /* inga delar */ }
          return [`dokument_id: ${d.id}`, `Titel: ${d.titel}`, `Sidor: 1–${d.sidor}`, d.kort ? `Kort: ${d.kort}` : "",
            `Sammanfattning: ${d.sammanfattning}`, ...delar.map(x => `• s. ${x.sidor}: ${x.handlar_om}`)].filter(Boolean).join("\n");
        }).join("\n\n")) }],
      });
      /* Bara dokument och sidor som finns */
      const steg = [];
      for (const s of (Array.isArray(ut.steg) ? ut.steg : []).slice(0, MAX_STEG)) {
        const d = dok.find(x => String(x.id) === String(s.dokument_id).trim());
        const m = /^\s*(\d+)\s*(?:[–-]\s*(\d+))?\s*$/.exec(String(s.sidor || ""));
        if (!d || !m) continue;
        const fran = Number(m[1]), till = Number(m[2] || m[1]);
        if (fran < 1 || till > d.sidor || fran > till) continue;
        steg.push({ dokId: d.id, fran, till, varfor: String(s.varfor || "").trim().slice(0, 300) });
      }
      return { steg };
    });
    const titlar = new Map(dok.map(d => [d.id, d.titel]));
    return { steg: r.svar.steg.filter(s => titlar.has(s.dokId)).map(s => ({ ...s, titel: titlar.get(s.dokId) })) };
  }

  async function svara(uid, kursId, ny) {
    const dok = dokument(uid, kursId);
    if (!dok.length || !CONFIG.openaiKey) return { steg: [] };
    if (ny) ai.glom(uid, "borja", nyckel(dok));
    try { return await forslag(uid, kursId, dok); }
    catch (e) {
      if (e instanceof Fel) throw e;
      console.error(`[sf] borja har misslyckades u=${uid} k=${kursId} ${e.code || e.name}`);
      throw new Fel(502, "Tudi kunde inte föreslå en ordning just nu. Försök igen om en stund.");
    }
  }

  rutt("GET", "/api/kurser/:kursId/borja", ctx => svara(ctx.user.id, ctx.params.kursId, false));
  /* Föreslå en ny ordning */
  rutt("POST", "/api/kurser/:kursId/borja", ctx => svara(ctx.user.id, ctx.params.kursId, true));
};
