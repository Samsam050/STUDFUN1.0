/* Felsökning med AI_LOGG: AI_LOGG=1 ger en rad per anrop utan text, AI_LOGG=fullt sparar hela anropen i en fil.
   Fel från OpenAI loggas med OpenAI:s förklaring.
   Kör: npm test */
const { test, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { startaServer, falskOpenAI } = require("./hjalp");

const PDF = Buffer.from("%PDF-1.4\n%%EOF\n");
const servrar = [];
after(() => servrar.forEach(([s, oa]) => { s.stang(); oa.stang(); }));

async function medKurs(env) {
  const oa = await falskOpenAI();
  const s = await startaServer({ OPENAI_API_KEY: "test-nyckel", OPENAI_BASE: oa.bas, ...env });
  servrar.push([s, oa]);
  const kaka = await s.nyttKonto("a@exempel.se");
  const kurs = (await s.anrop("POST", "/api/kurser", { kaka, data: { namn: "Kurs" } })).json.id;
  const dok = (await s.anrop("POST", `/api/kurser/${kurs}/dokument`, { kaka, data: { titel: "Hemlig titel", sidor: ["Hemlig text om anbud."] } })).json.id;
  await s.anrop("PUT", `/api/dokument/${dok}/fil`, { kaka, ra: PDF, headers: { "content-type": "application/pdf" } });
  for (let i = 0; i < 100 && (await s.anrop("GET", `/api/dokument/${dok}`, { kaka })).json.status !== "klar"; i++) await new Promise(r => setTimeout(r, 50));
  return { s, oa, kaka, kurs, dok };
}

test("AI_LOGG=1: modell, token och vad nano valde, men ingen text", async () => {
  const { s, oa, kaka, kurs, dok } = await medKurs({ AI_LOGG: "1" });
  oa.svar = json => (json.text?.format?.name === "val" ? { typ: "specifik", dokument_id: "", sidor: [] } : undefined);
  await s.anrop("POST", `/api/kurser/${kurs}/fraga`, { kaka, data: { fraga: "Vad handlar den här pdfen om?", sida: { dokId: dok, nr: 1 } } });
  const logg = s.logg();
  assert.match(logg, /\[ai\] valj gpt-5-nano tänkande=minimal in=100 cache=0 ut=20/);
  assert.match(logg, new RegExp(`\\[ai\\] valj nano=specifik blev=dokument dok=${dok} öppen=${dok}:1`));
  assert.match(logg, /\[ai\] chatt material typ=dokument \[hel text ~\d+ token\]/);
  assert.match(logg, /\[ai\] chatt gpt-6-luna tänkande=low/);
  for (const ord of ["Hemlig", "anbud", "Vad handlar"]) assert.ok(!logg.includes(ord), ord);
  assert.ok(!fs.existsSync(path.join(s.dataDir, "ai-logg")), "ingen fil utan AI_LOGG=fullt");
});

test("AI_LOGG=fullt: hela anropen i en fil som bara servern kan läsa, och fel från OpenAI med förklaring", async () => {
  const { s, oa, kaka, kurs, dok } = await medKurs({ AI_LOGG: "fullt" });
  await s.anrop("POST", `/api/kurser/${kurs}/fraga`, { kaka, data: { fraga: "Vad är ett anbud?", sida: { dokId: dok, nr: 1 } } });
  const filer = fs.readdirSync(path.join(s.dataDir, "ai-logg"));
  assert.equal(filer.length, 1);
  const fil = path.join(s.dataDir, "ai-logg", filer[0]);
  assert.equal(fs.statSync(fil).mode & 0o777, 0o600);
  const rader = fs.readFileSync(fil, "utf8").trim().split("\n").map(JSON.parse);
  const chatt = rader.find(r => r.funktion === "chatt");
  assert.equal(chatt.anrop.model, "gpt-6-luna");
  assert.ok(JSON.stringify(chatt.anrop.input).includes("Vad är ett anbud?"));
  assert.equal(typeof chatt.svar, "string");

  /* OpenAI säger nej till modellen: förklaringen syns i loggen */
  const http = require("http");
  const nej = http.createServer((req, res) => {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: { type: "invalid_request_error", code: "model_not_found", param: "model", message: "The model `gpt-6-luna` does not exist." } }));
  });
  await new Promise(r => nej.listen(0, "127.0.0.1", r));
  const s2 = await startaServer({ OPENAI_API_KEY: "test-nyckel", OPENAI_BASE: `http://127.0.0.1:${nej.address().port}` });
  const k2 = await s2.nyttKonto("b@exempel.se");
  const kurs2 = (await s2.anrop("POST", "/api/kurser", { kaka: k2, data: { namn: "K" } })).json.id;
  const d2 = (await s2.anrop("POST", `/api/kurser/${kurs2}/dokument`, { kaka: k2, data: { titel: "T", sidor: ["Text om anbud."] } })).json.id;
  await s2.anrop("PUT", `/api/dokument/${d2}/fil`, { kaka: k2, ra: PDF, headers: { "content-type": "application/pdf" } });
  for (let i = 0; i < 100 && !s2.logg().includes("model_not_found"); i++) await new Promise(r => setTimeout(r, 50));
  assert.match(s2.logg(), /misslyckades .*model_not_found param=model The model `gpt-6-luna` does not exist\./);
  s2.stang(); nej.closeAllConnections(); nej.close();
});
