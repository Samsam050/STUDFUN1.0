/*
  Uppläsning. Motorn väljs med TTS_MOTOR och modellen med MODEL_TTS (standard gpt-4o-mini-tts), som läser exakt det som står.
  Piper på servern kopplas in här när det är provat och godkänt. Till dess används OpenAI:s röst.
  Ljudet sparas på disken, en mapp per fil, så att samma text bara hämtas en gång.
  Mappen raderas när filen raderas. Tempot sätts i webbläsaren, så det kostar inget nytt ljud.
  Varje ny uppläsning mäts i ai_anrop med antal tecken.
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

module.exports = function ({ db, CONFIG, Fel, rutt, konto, ai }) {
  if (CONFIG.ai.tts.motor !== "openai") console.error(`[sf] TTS_MOTOR=${CONFIG.ai.tts.motor} finns inte än, OpenAI:s röst används`);

  /* mapp null: ljudet sparas inte, till exempel Tudis svar som bara läses en gång */
  async function ljud(ctx, mapp, rost, text) {
    const fil = mapp && path.join(mapp, crypto.createHash("sha256").update(`${rost}\n${text}`).digest("hex") + ".mp3");
    let data = fil && await fs.promises.readFile(fil).catch(() => null);
    if (!data) {
      if (!CONFIG.openaiKey) throw new Fel(503, "Uppläsningen fungerar inte just nu.");
      if (!forbruka(db, ctx.user.id, "upplasning", text.length, TAK_PER_DAG)) {
        throw new Fel(429, "Du har använt dagens uppläsning. Den fungerar igen i morgon från klockan 06.00. Det du redan har lyssnat på går att spela igen.");
      }
      const start = Date.now();
      const r = await fetch(`${CONFIG.openaiBase}/v1/audio/speech`, {
        method: "POST",
        headers: { Authorization: `Bearer ${CONFIG.openaiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model: CONFIG.ai.tts.modell, voice: rost, input: text, instructions: INSTRUKTION, response_format: "mp3" }),
        signal: AbortSignal.timeout(60_000),
      }).catch(() => null);
      ai.mat({ funktion: "upplasning", modell: CONFIG.ai.tts.modell, uid: ctx.user.id, ms: Date.now() - start, ok: !!(r && r.ok), tecken: text.length });
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

  /* Läser upp ett svar från Tudi. Ett svar i chatten sparas inte, eftersom samma svar sällan läses två gånger.
     Med dokId (en förklaring av en sida, som också är sparad) sparas ljudet med filen. */
  rutt("POST", "/api/upplas-svar", async ctx => {
    const text = typeof ctx.body.text === "string" ? ctx.body.text.replace(/\s+/g, " ").trim() : "";
    if (!text) throw new Fel(400, "Det finns ingen text att läsa upp.");
    if (text.length > 4000) throw new Fel(400, "Texten är för lång för att läsas upp på en gång.");
    const { dokId } = ctx.body;
    if (dokId !== undefined && dokId !== null && !(Number.isInteger(dokId) && db.prepare("SELECT 1 FROM documents WHERE id = ? AND user_id = ?").get(dokId, ctx.user.id))) {
      throw new Fel(404, "Filen finns inte.");
    }
    await ljud(ctx, dokId ? path.join(CONFIG.ttsDir, String(dokId)) : null, konto.installningar(ctx.user.id).rost, text);
  });

  /* Provar en röst i Inställningar. Samma mening för alla, så den sparas en gång per röst. */
  rutt("POST", "/api/rostprov", async ctx => {
    if (!konto.ROSTER.includes(ctx.body.rost)) throw new Fel(400, "Den rösten finns inte.");
    await ljud(ctx, path.join(CONFIG.ttsDir, "prov"), ctx.body.rost, PROVTEXT);
  });
};
