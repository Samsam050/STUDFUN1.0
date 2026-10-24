/*
  Förklara den här sidan, och knapparna för att få samma sida förklarad på ett annat sätt.

  Tudi får dokumentets titel och sammanfattning (lika för alla sidor, därför först) och sedan sidans text.
  En bild av sidan skickas bara när appen säger att den behövs: sidan har under 400 tecken text,
  bilder täcker mer än 30 % av sidan, eller studenten har tryckt Titta på bilden också.
  Sidans text tas från databasen. Det är samma text som pdf.js plockade ut i webbläsaren vid uppladdningen.

  Svaret sparas med dokumentet, sidan och sättet som nyckel. Samma knapp på samma sida kostar inget andra gången.
*/
const { forbruka } = require("./db");
const kallor = require("./kallor");

const SIDA_PER_DAG = 60;
const MAX_BILD = 2_500_000; // tecken i data-adressen, ungefär 1,8 MB bild
const SATT = { enklare: "satt-enklare", steg: "satt-steg-for-steg", exempel: "satt-exempel", annat: "satt-annat-satt" };

module.exports = function ({ db, CONFIG, Fel, rutt, ai }) {
  function dokument(uid, id) {
    const d = db.prepare("SELECT * FROM documents WHERE id = ? AND user_id = ? AND status = 'klar'").get(id, uid);
    if (!d) throw new Fel(404, "Filen finns inte.");
    return d;
  }
  const sidtext = (dokId, nr) => db.prepare("SELECT text FROM chunks WHERE document_id = ? AND sida = ? ORDER BY id").all(dokId, nr).map(b => b.text).join(" ");
  const delar = d => { try { return JSON.parse(d.delar || "[]"); } catch { return []; } };

  /* Dokumentets titel och sammanfattning. Lika i alla anrop om dokumentet, så OpenAI kan spara början. */
  function oversikt(d) {
    const rader = [`Dokument: ${d.titel}`, `Antal sidor: ${d.sidor}`];
    if (d.sammanfattning) rader.push(`Sammanfattning: ${d.sammanfattning}`);
    const del = delar(d);
    if (del.length) rader.push("Delar:", ...del.map(x => `• s. ${x.sidor}: ${x.handlar_om}`));
    return ai.material(rader.join("\n"));
  }

  /* Sidor Tudi får hänvisa till: sidan själv, och dokumentets delar som spann */
  function tillatna(d, nr) {
    const t = kallor.tillatna();
    t.sida(d.id, nr);
    for (const x of delar(d)) t.spann(d.id, x.sidor);
    for (const a of db.prepare("SELECT fran, till FROM avsnitt WHERE document_id = ?").all(d.id)) t.spann(d.id, `${a.fran}-${a.till}`);
    return t;
  }

  function lasBild(bild) {
    if (bild === undefined || bild === null) return null;
    if (typeof bild !== "string" || bild.length > MAX_BILD || !/^data:image\/(jpeg|png);base64,[A-Za-z0-9+/=]+$/.test(bild)) {
      throw new Fel(400, "Bilden av sidan gick inte att skicka.");
    }
    return bild;
  }

  /* satt: ett av sätten att förklara. forra: nyckeln till förklaringen studenten vill ha på ett annat sätt.
     bild: en bild av sidan, bara när appens regel säger det. */
  rutt("POST", "/api/dokument/:id/sidor/:nr/forklara", async ctx => {
    const uid = ctx.user.id, nr = ctx.params.nr;
    const d = dokument(uid, ctx.params.id);
    if (nr < 1 || nr > d.sidor) throw new Fel(404, "Sidan finns inte.");
    const { satt } = ctx.body;
    if (satt !== undefined && !SATT[satt]) throw new Fel(400, "Det valet finns inte.");
    let forra = null;
    if (satt) {
      forra = ai.sparat(uid, ctx.body.forra);
      if (!forra || !forra.typ.startsWith("sida:") || forra.dokId !== d.id || forra.svar.sida !== nr) throw new Fel(400, "Tryck på Förklara den här sidan först.");
    }
    const bild = lasBild(ctx.body.bild);
    if (!CONFIG.openaiKey) throw new Fel(503, "Tudi kunde inte förklara sidan just nu.");

    /* "Förklara på ett annat sätt" andra gången i rad på samma sida: Tudi får tänka lite mer */
    const effort = satt === "annat" && forra.typ === "sida:annat" ? CONFIG.ai.sida.igen : CONFIG.ai.sida.effort;
    const prompter = ["tudi-grund", "forklara-sidan", ...(satt ? [SATT[satt]] : [])];
    const text = sidtext(d.id, nr);
    const typ = `sida:${satt || "forklara"}`;
    let r;
    try {
      r = await ai.cachad({
        uid, typ, dokId: d.id,
        nyckel: [ai.version("sida", effort, ...prompter), d.id, nr, !!bild, text, d.sammanfattning, forra ? forra.svar.text : null],
      }, async () => {
        if (!forbruka(db, uid, "sida", 1, SIDA_PER_DAG)) {
          throw new Fel(429, "Du har bett Tudi förklara dagens sidor. Det går igen i morgon från klockan 06.00. Sidor Tudi redan har förklarat kan du se igen.");
        }
        const sidan = `Sidan studenten har öppen: sida ${nr} av ${d.sidor}.\n\n${ai.material(text || "Sidan har ingen text.")}`;
        const ut = await ai.svar({
          funktion: "sida", uid, effort, cache: `dok:${d.id}`,
          system: ai.tudiPrompt("forklara-sidan"),
          fast: oversikt(d),
          inne: [
            { role: "user", content: bild ? [{ type: "input_text", text: sidan }, { type: "input_image", image_url: bild, detail: "high" }] : sidan },
            ...(satt ? [{ role: "assistant", content: forra.svar.text }, { role: "user", content: ai.prompt(SATT[satt]) }] : []),
          ],
        });
        const k = kallor.kontrollera(ut, { till: tillatna(d, nr), dokument: [{ id: d.id, titel: d.titel }], standard: d.id });
        return { text: k.text.slice(0, 4000), kallor: k.kallor, sida: nr };
      });
    } catch (e) {
      if (e instanceof Fel) throw e;
      console.error(`[sf] forklara sidan misslyckades u=${uid} d=${d.id} ${e.code || e.name}`);
      throw new Fel(502, "Tudi kunde inte förklara sidan just nu. Försök igen om en stund.");
    }
    return { text: r.svar.text, kallor: r.svar.kallor, sida: nr, satt: satt || null, bild: !!bild, nyckel: r.nyckel };
  }, { maxBody: 3 * 1024 * 1024 });
};
