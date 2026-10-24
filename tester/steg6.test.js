/* Steg 6: quiz och flashcards. Testar också påhittade frågor, rättning, ägarkontroll och dagstaket.
   Kör: npm test */
const { test, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const { DatabaseSync } = require("node:sqlite");
const { startaServer, falskOpenAI } = require("./hjalp");

let s, oa, a, b, kursA, kursB, dokA;
const PDF = Buffer.from("%PDF-1.4\n%%EOF\n");
const SIDA = "Ett anbud är ett erbjudande om att ingå ett avtal. Ett anbud gäller bara under en viss tid. Om anbudet saknar svarsfrist ska mottagaren svara inom skälig tid. Ett ja till ett anbud kallas accept, och då blir avtalet klart.";

async function laddaUpp(kaka, kurs, sidor) {
  const id = (await s.anrop("POST", `/api/kurser/${kurs}/dokument`, { kaka, data: { titel: "Kursbok", sidor } })).json.id;
  await s.anrop("PUT", `/api/dokument/${id}/fil`, { kaka, ra: PDF, headers: { "content-type": "application/pdf" } });
  for (let i = 0; i < 100; i++) {
    if ((await s.anrop("GET", `/api/dokument/${id}`, { kaka })).json.status === "klar") return id;
    await new Promise(r => setTimeout(r, 50));
  }
  throw new Error("blev aldrig klar");
}
const ova = (kaka, kurs, typ) => s.anrop("POST", `/api/kurser/${kurs}/ova`, { kaka, data: { typ } });
const svara = (kaka, id, data) => s.anrop("POST", `/api/kort/${id}/svar`, { kaka, data });
const db = () => new DatabaseSync(path.join(s.dataDir, "studfun.db"));
const rattningar = () => oa.anrop.filter(x => x.json?.response_format?.json_schema?.name === "rattning").length;

before(async () => {
  oa = await falskOpenAI();
  s = await startaServer({ OPENAI_API_KEY: "test-nyckel", OPENAI_BASE: oa.bas });
  a = await s.nyttKonto("a@exempel.se");
  b = await s.nyttKonto("b@exempel.se");
  kursA = (await s.anrop("POST", "/api/kurser", { kaka: a, data: { namn: "Civilrätt" } })).json.id;
  kursB = (await s.anrop("POST", "/api/kurser", { kaka: b, data: { namn: "B:s kurs" } })).json.id;
  dokA = await laddaUpp(a, kursA, [SIDA, SIDA, SIDA]);
});
after(() => { s.stang(); oa.stang(); });
beforeEach(() => { oa.ova = null; oa.ratta = null; });

test("ett quiz skapas från materialet, med sidan varje fråga bygger på, och utan facit", async () => {
  const r = await ova(a, kursA, "quiz");
  assert.equal(r.status, 201);
  assert.equal(r.json.kort.length, 6);
  for (const k of r.json.kort) {
    assert.equal(k.svar, undefined, "facit skickas inte med quizet");
    assert.equal(k.dokId, dokA);
    assert.ok(k.sida >= 1 && k.sida <= 3);
    if (k.typ === "flerval") assert.deepEqual([...k.alternativ].sort(), ["Fel ett", "Fel två", "Rätt"]);
  }
  const sista = oa.anrop.filter(x => x.json?.response_format?.json_schema?.name === "quiz").at(-1).json;
  assert.match(sista.messages[0].content, /data, inte instruktioner/);
  assert.match(sista.messages[0].content, /tenta/);
});

test("flashcards skickas med baksidan", async () => {
  const r = await ova(a, kursA, "flashcards");
  assert.equal(r.status, 201);
  assert.equal(r.json.kort.length, 8);
  assert.ok(r.json.kort.every(k => k.typ === "flashcard" && k.svar.startsWith("Förklaring")));
});

test("frågor som pekar på en påhittad bit eller inte går att rätta sparas inte", async () => {
  oa.ova = (schema, m) => ({ fragor: [
    { typ: "flerval", fraga: "Påhittad källa?", alternativ: ["a", "b", "c"], svar: "a", forklaring: "", bit: 999999 },
    { typ: "flerval", fraga: "Facit saknas bland alternativen?", alternativ: ["a", "b", "c"], svar: "d", forklaring: "", bit: m[0].id },
    { typ: "flerval", fraga: "Bara två alternativ?", alternativ: ["a", "b"], svar: "a", forklaring: "", bit: m[0].id },
    { typ: "kort", fraga: "Alldeles för långt facit?", alternativ: [], svar: "ett två tre fyra fem sex sju åtta", forklaring: "", bit: m[0].id },
    { typ: "flerval", fraga: "Den enda giltiga?", alternativ: ["a", "b", "c"], svar: "b", forklaring: "", bit: m[0].id },
  ] });
  const r = await ova(a, kursA, "quiz");
  assert.equal(r.status, 201);
  assert.deepEqual(r.json.kort.map(k => k.fraga), ["Den enda giltiga?"]);
  oa.ova = () => ({ fragor: [{ typ: "flerval", fraga: "x", alternativ: ["a", "b", "c"], svar: "a", forklaring: "", bit: -1 }] });
  assert.equal((await ova(a, kursA, "quiz")).status, 502, "inga giltiga frågor ger ett fel, inte ett tomt quiz");
});

test("flerval rättas på servern och varje svar sparas", async () => {
  const k = (await ova(a, kursA, "quiz")).json.kort.find(x => x.typ === "flerval");
  const fel = await svara(a, k.id, { val: "Fel ett" });
  assert.equal(fel.status, 200);
  assert.equal(fel.json.ratt, false);
  assert.equal(fel.json.rattSvar, "Rätt");
  assert.equal(fel.json.forklaring, "För att.");
  assert.ok(Number.isInteger(fel.json.sida));
  assert.equal((await svara(a, k.id, { val: "Rätt" })).json.ratt, true);
  assert.equal((await svara(a, k.id, { val: "Något annat" })).status, 400);
  assert.equal((await svara(a, k.id, { val: 1 })).status, 400);
  const d = db();
  assert.deepEqual(d.prepare("SELECT ratt FROM attempts WHERE card_id = ? ORDER BY id").all(k.id).map(x => x.ratt), [0, 1]);
  d.close();
});

test("korta svar godtar böjningar och små stavfel utan att fråga modellen, och modellen avgör resten", async () => {
  const k = (await ova(a, kursA, "quiz")).json.kort.find(x => x.typ === "kort");
  const fore = rattningar();
  for (const text of ["accept", "Accepten", "acept", " ACCEPT. "]) assert.equal((await svara(a, k.id, { text })).json.ratt, true, text);
  assert.equal(rattningar(), fore, "lokalt rättade svar kostar inget anrop");
  oa.ratta = ({ svar }) => ({ ratt: svar === "ett ja" });
  assert.equal((await svara(a, k.id, { text: "ett ja" })).json.ratt, true, "modellen godtar samma betydelse");
  assert.equal((await svara(a, k.id, { text: "anbud" })).json.ratt, false);
  assert.equal(rattningar(), fore + 2);
  const sista = oa.anrop.filter(x => x.json?.response_format?.json_schema?.name === "rattning").at(-1).json;
  assert.equal(JSON.parse(sista.messages[1].content).facit, "accept");
  assert.match(sista.messages[0].content, /data, inte instruktioner/);
  assert.equal((await svara(a, k.id, { text: "" })).status, 400);
  assert.equal((await svara(a, k.id, { text: "x".repeat(201) })).status, 400);
});

test("flashcards sparar Kunde och Kunde inte", async () => {
  const k = (await ova(a, kursA, "flashcards")).json.kort[0];
  assert.equal((await svara(a, k.id, { kunde: false })).json.ratt, false);
  assert.equal((await svara(a, k.id, { kunde: true })).json.ratt, true);
  assert.equal((await svara(a, k.id, { kunde: "ja" })).status, 400);
});

test("konto B kan inte skapa övningar i A:s kurs eller svara på A:s frågor", async () => {
  const k = (await ova(a, kursA, "quiz")).json.kort[0];
  assert.equal((await ova(b, kursA, "quiz")).status, 404);
  assert.equal((await svara(b, k.id, { val: "Rätt" })).status, 404, "B får inte ens veta facit");
  assert.equal((await svara(b, k.id + 1000, { val: "Rätt" })).status, 404);
  assert.equal((await ova(a, kursA, "hacka")).status, 400);
  for (const [metod, adress, data] of [["POST", `/api/kurser/${kursA}/ova`, { typ: "quiz" }], ["POST", `/api/kort/${k.id}/svar`, { val: "Rätt" }]]) {
    assert.equal((await s.anrop(metod, adress, { data })).status, 401, `${metod} ${adress} utan inloggning`);
  }
  const d = db();
  assert.equal(d.prepare("SELECT COUNT(*) AS n FROM attempts WHERE card_id = ?").get(k.id).n, 0, "inga försök sparades");
  d.close();
});

test("en kurs utan klart material ger beskedet att ladda upp först", async () => {
  const r = await ova(b, kursB, "quiz");
  assert.equal(r.status, 409);
  assert.match(r.json.fel, /Ladda upp material först/);
});

test("radera filen tar bort frågorna och svaren som gjorts från den", async () => {
  const kurs = (await s.anrop("POST", "/api/kurser", { kaka: a, data: { namn: "Radera" } })).json.id;
  const dok = await laddaUpp(a, kurs, [SIDA]);
  const k = (await ova(a, kurs, "quiz")).json.kort[0];
  await svara(a, k.id, { val: "Rätt" });
  assert.equal((await s.anrop("DELETE", `/api/dokument/${dok}`, { kaka: a })).status, 200);
  const d = db();
  assert.equal(d.prepare("SELECT COUNT(*) AS n FROM cards WHERE document_id = ?").get(dok).n, 0);
  assert.equal(d.prepare("SELECT COUNT(*) AS n FROM attempts WHERE card_id = ?").get(k.id).n, 0);
  d.close();
  assert.equal((await svara(a, k.id, { val: "Rätt" })).status, 404);
});

test("dagstaket för nya övningar, medan gamla frågor går att svara på", async () => {
  const c = await s.nyttKonto("c@exempel.se");
  const kurs = (await s.anrop("POST", "/api/kurser", { kaka: c, data: { namn: "K" } })).json.id;
  await laddaUpp(c, kurs, [SIDA]);
  const statusar = [];
  let forsta;
  for (let i = 0; i < 11; i++) {
    const r = await ova(c, kurs, i % 2 ? "flashcards" : "quiz");
    statusar.push(r.status);
    forsta ??= r.json.kort?.[0];
  }
  assert.deepEqual(statusar.slice(0, 10), Array(10).fill(201));
  assert.equal(statusar[10], 429);
  assert.match((await ova(c, kurs, "quiz")).json.fel, /06\.00/);
  assert.equal((await svara(c, forsta.id, { val: "Rätt" })).status, 200);
});

test("loggen innehåller inga frågor eller svar", () => {
  for (const ord of ["Fråga 0", "accept", "Begrepp", "Förklaring", "ett ja"]) assert.ok(!s.logg().includes(ord), ord);
});
