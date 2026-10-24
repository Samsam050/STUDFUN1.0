/*
  Uppläsning med gpt-4o-mini-tts, som läser exakt det som står.
  Ljudet sparas på disken, en mapp per fil, så att samma text bara hämtas en gång.
  Mappen raderas när filen raderas. Tempot sätts i webbläsaren, så det kostar inget nytt ljud.
*/
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { forbruka } = require("./db");

const MAX_TECKEN = 1500;           // per anrop. Visaren skickar en mening i taget, högst 400 tecken
const TAK_PER_DAG = 50000;         // tecken som inte redan finns sparade, ungefär en timme ljud
const INSTRUKTION = "Läs texten högt på svenska för en vuxen student som tycker att läsning är svårt. " +
  "Lugnt och tydligt, med naturliga pauser vid punkt och kommatecken. Läs exakt det som står, och lägg inte till något. " +
  "Uttala alla ord med svenskt uttal.";
const PROVTEXT = "Hej! Så här låter jag när jag läser upp ditt kursmaterial.";

module.exports = function ({ db, CONFIG, Fel, rutt, konto }) {
  /* mapp null: ljudet sparas inte, till exempel Tudis svar som bara läses en gång */
  async function ljud(ctx, mapp, rost, text) {
    const fil = mapp && path.join(mapp, crypto.createHash("sha256").update(`${rost}\n${text}`).digest("hex") + ".mp3");
    let data = fil && await fs.promises.readFile(fil).catch(() => null);
    if (!data) {
      if (!CONFIG.openaiKey) throw new Fel(503, "Uppläsningen fungerar inte just nu.");
      if (!forbruka(db, ctx.user.id, "upplasning", text.length, TAK_PER_DAG)) {
        throw new Fel(429, "Du har använt dagens uppläsning. Den fungerar igen i morgon från klockan 06.00. Det du redan har lyssnat på går att spela igen.");
      }
      const r = await fetch(`${CONFIG.openaiBase}/v1/audio/speech`, {
        method: "POST",
        headers: { Authorization: `Bearer ${CONFIG.openaiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model: "gpt-4o-mini-tts", voice: rost, input: text, instructions: INSTRUKTION, response_format: "mp3" }),
        signal: AbortSignal.timeout(60_000),
      }).catch(() => null);
      if (!r || !r.ok) {
        console.error(`[sf] uppläsning misslyckades u=${ctx.user.id} ${r ? r.status : "natverk"}`);
        throw new Fel(502, "Uppläsningen fungerar inte just nu.");
      }
      data = Buffer.from(await r.arrayBuffer());
      if (fil) {
        await fs.promises.mkdir(mapp, { recursive: true, mode: 0o700 });
        await fs.promises.writeFile(fil, data, { mode: 0o600 });
      }
    }
    ctx.res.writeHead(200, { ...CONFIG.sakerhet, "Content-Type": "audio/mpeg", "Cache-Control": "private, max-age=86400", "Content-Length": data.length });
    ctx.res.end(data);
  }

  /* Läser upp text ur studentens egen fil. Rösten är den som är vald i Inställningar. */
  rutt("POST", "/api/dokument/:id/upplas", async ctx => {
    if (!db.prepare("SELECT 1 FROM documents WHERE id = ? AND user_id = ? AND status != 'vantar_fil'").get(ctx.params.id, ctx.user.id)) {
      throw new Fel(404, "Filen finns inte.");
    }
    const text = typeof ctx.body.text === "string" ? ctx.body.text.replace(/\s+/g, " ").trim() : "";
    if (!text) throw new Fel(400, "Det finns ingen text att läsa upp.");
    if (text.length > MAX_TECKEN) throw new Fel(400, "Texten är för lång för att läsas upp på en gång.");
    await ljud(ctx, path.join(CONFIG.ttsDir, String(ctx.params.id)), konto.installningar(ctx.user.id).rost, text);
  });

  /* Läser upp ett svar från Tudi. Sparas inte, eftersom samma svar sällan läses två gånger. */
  rutt("POST", "/api/upplas-svar", async ctx => {
    const text = typeof ctx.body.text === "string" ? ctx.body.text.replace(/\s+/g, " ").trim() : "";
    if (!text) throw new Fel(400, "Det finns ingen text att läsa upp.");
    if (text.length > 2000) throw new Fel(400, "Texten är för lång för att läsas upp på en gång.");
    await ljud(ctx, null, konto.installningar(ctx.user.id).rost, text);
  });

  /* Provar en röst i Inställningar. Samma mening för alla, så den sparas en gång per röst. */
  rutt("POST", "/api/rostprov", async ctx => {
    if (!konto.ROSTER.includes(ctx.body.rost)) throw new Fel(400, "Den rösten finns inte.");
    await ljud(ctx, path.join(CONFIG.ttsDir, "prov"), ctx.body.rost, PROVTEXT);
  });
};
