/* Steg 4: visaren med uppläsning. Ord och meningar på sidan, var studenten slutade, uppläsning med sparat ljud och dagstak.
   Kör: npm test */
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { startaServer, falskOpenAI } = require("./hjalp");

let s, oa, a, b, kursA, dokA;
const PDF = Buffer.from("%PDF-1.4\n%%EOF\n");
const SIDOR = ["Första sidan. Den har två meningar.", "", "Tredje sidan har text igen."];

before(async () => {
  oa = await falskOpenAI();
  s = await startaServer({ OPENAI_API_KEY: "test-nyckel", OPENAI_BASE: oa.bas });
  a = await s.nyttKonto("a@exempel.se");
  b = await s.nyttKonto("b@exempel.se");
  kursA = (await s.anrop("POST", "/api/kurser", { kaka: a, data: { namn: "Civilrätt" } })).json.id;
  dokA = (await s.anrop("POST", `/api/kurser/${kursA}/dokument`, { kaka: a, data: { titel: "Bok", sidor: SIDOR } })).json.id;
  await s.anrop("PUT", `/api/dokument/${dokA}/fil`, { kaka: a, ra: PDF, headers: { "content-type": "application/pdf" } });
});
after(() => { s.stang(); oa.stang(); });

const upplas = (kaka, text, dok = dokA) => s.anrop("POST", `/api/dokument/${dok}/upplas`, { kaka, data: { text } });

test("orden på en PDF-sida hittas med sina rutor, och inget ord tappas", async () => {
  const { ordFranText, meningar } = await import("../public/js/delar.js");
  const bitar = [
    { str: "Ett anbud gäller", x: 0, y: 0, b: 160, h: 10, eol: false },
    { str: " ", x: 160, y: 0, b: 5, h: 10, eol: false },
    { str: "bara under en be-", x: 165, y: 0, b: 170, h: 10, eol: true },
    { str: "handling. Ny", x: 0, y: 12, b: 120, h: 10, eol: false },
    { str: "het!", x: 120, y: 12, b: 40, h: 10, eol: true },
    { str: "x".repeat(500), x: 0, y: 24, b: 500, h: 10, eol: true },
  ];
  const ord = ordFranText(bitar);
  assert.deepEqual(ord.slice(0, 8).map(o => o.text), ["Ett", "anbud", "gäller", "bara", "under", "en", "behandling.", "Nyhet!"]);
  assert.equal(ord[6].rutor.length, 2, "ett avstavat ord markeras på båda raderna");
  assert.equal(ord[7].rutor.length, 2, "två textbitar utan mellanslag är ett ord");
  assert.deepEqual(ord[1].rutor[0], { x: 40, y: 0, b: 50, h: 10 }, "ordets ruta räknas fram ur bokstäverna");
  const M = meningar(ord);
  assert.deepEqual(M.map(m => [m.fran, m.till]), [[0, 6], [7, 7], [8, 8]]);
  assert.equal(M.flatMap(m => ord.slice(m.fran, m.till + 1)).length, ord.length, "varje ord hör till en mening");
  assert.deepEqual(meningar([]), []);
});

test("var studenten slutade sparas och används nästa gång", async () => {
  assert.equal((await s.anrop("GET", `/api/dokument/${dokA}`, { kaka: a })).json.senastSida, 1);
  assert.equal((await s.anrop("PUT", `/api/dokument/${dokA}/position`, { kaka: a, data: { sida: 3 } })).status, 200);
  assert.equal((await s.anrop("GET", `/api/dokument/${dokA}`, { kaka: a })).json.senastSida, 3);
  for (const sida of [0, 4, 1.5, "2", -1]) {
    assert.equal((await s.anrop("PUT", `/api/dokument/${dokA}/position`, { kaka: a, data: { sida } })).status, 400, String(sida));
  }
});

test("konto B kan inte flytta positionen eller få A:s text uppläst", async () => {
  assert.equal((await s.anrop("PUT", `/api/dokument/${dokA}/position`, { kaka: b, data: { sida: 2 } })).status, 404);
  assert.equal((await upplas(b, "Första sidan.")).status, 404);
  assert.equal((await s.anrop("GET", `/api/dokument/${dokA}`, { kaka: a })).json.senastSida, 3, "A:s position är orörd");
  for (const [metod, adress, data] of [["PUT", `/api/dokument/${dokA}/position`, { sida: 1 }],
    ["POST", `/api/dokument/${dokA}/upplas`, { text: "x" }], ["POST", "/api/rostprov", { rost: "marin" }]]) {
    assert.equal((await s.anrop(metod, adress, { data })).status, 401, `${metod} ${adress} utan inloggning`);
  }
});

test("uppläsningen hämtas en gång och sparas sedan, med vald röst", async () => {
  const fore = oa.anrop.filter(x => x.url === "/v1/audio/speech").length;
  const r1 = await upplas(a, "Första sidan.");
  assert.equal(r1.status, 200);
  assert.equal(r1.headers.get("content-type"), "audio/mpeg");
  assert.equal(r1.headers.get("x-content-type-options"), "nosniff");
  const r2 = await upplas(a, "  Första   sidan. ");
  assert.equal(r2.text, r1.text, "samma text ger samma ljud");
  const tal = oa.anrop.filter(x => x.url === "/v1/audio/speech");
  assert.equal(tal.length, fore + 1, "andra gången kommer ljudet från disken");
  assert.equal(tal.at(-1).json.model, "gpt-4o-mini-tts");
  assert.equal(tal.at(-1).json.voice, "marin");
  assert.equal(tal.at(-1).json.input, "Första sidan.");

  assert.equal((await s.anrop("PUT", "/api/installningar", { kaka: a, data: { rost: "cedar" } })).status, 200);
  assert.match((await upplas(a, "Första sidan.")).text, /cedar/, "ny röst ger nytt ljud");
  assert.equal((await s.anrop("PUT", "/api/installningar", { kaka: a, data: { rost: "fel" } })).status, 400);
});

test("tom text, för lång text och okänd röst nekas", async () => {
  assert.equal((await upplas(a, "   ")).status, 400);
  assert.equal((await upplas(a, "x".repeat(1501))).status, 400);
  assert.equal((await upplas(a, 42)).status, 400);
  assert.equal((await s.anrop("POST", "/api/rostprov", { kaka: a, data: { rost: "../../etc" } })).status, 400);
  assert.equal((await s.anrop("POST", "/api/rostprov", { kaka: a, data: { rost: "shimmer" } })).status, 200);
});

test("radera filen tar bort det sparade ljudet", async () => {
  const dok = (await s.anrop("POST", `/api/kurser/${kursA}/dokument`, { kaka: a, data: { titel: "Ljud", sidor: SIDOR } })).json.id;
  await s.anrop("PUT", `/api/dokument/${dok}/fil`, { kaka: a, ra: PDF, headers: { "content-type": "application/pdf" } });
  assert.equal((await upplas(a, "Tredje sidan har text igen.", dok)).status, 200);
  const mapp = path.join(s.dataDir, "upplasning", String(dok));
  assert.equal(fs.readdirSync(mapp).length, 1);
  assert.equal((await s.anrop("DELETE", `/api/dokument/${dok}`, { kaka: a })).status, 200);
  assert.ok(!fs.existsSync(mapp), "ljudet ska vara borta");
});

test("dagstaket för uppläsning stoppar ny uppläsning men inte det som redan är sparat", async () => {
  const c = await s.nyttKonto("c@exempel.se");
  const kurs = (await s.anrop("POST", "/api/kurser", { kaka: c, data: { namn: "K" } })).json.id;
  const dok = (await s.anrop("POST", `/api/kurser/${kurs}/dokument`, { kaka: c, data: { titel: "T", sidor: SIDOR } })).json.id;
  await s.anrop("PUT", `/api/dokument/${dok}/fil`, { kaka: c, ra: PDF, headers: { "content-type": "application/pdf" } });
  const statusar = [];
  for (let i = 0; i < 35; i++) statusar.push((await upplas(c, `${i} `.padEnd(1500, "a"), dok)).status);
  assert.deepEqual(statusar.slice(0, 33), Array(33).fill(200));
  assert.equal(statusar.at(-1), 429);
  const r = await upplas(c, "0 ".padEnd(1500, "a"), dok);
  assert.equal(r.status, 200, "sparat ljud går att spela igen");
  assert.match((await upplas(c, "något nytt ".padEnd(600, "b"), dok)).json.fel, /06\.00/, "taket visas i klartext med när det börjar om");
});

test("loggen innehåller ingen text som lästs upp", () => {
  for (const ord of ["Första sidan", "Tredje sidan", "något nytt"]) assert.ok(!s.logg().includes(ord), ord);
});
