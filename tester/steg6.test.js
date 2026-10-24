/* Steg 6: quiz och flashcards enligt AI-arkitekturen. Testar också påhittade frågor, rättning, urval, ägarkontroll och dagstaket.
   Kör: npm test */
const { test, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const { DatabaseSync } = require("node:sqlite");
const { startaServer, falskOpenAI, inneText } = require("./hjalp");

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
const ova = (kaka, kurs, typ, val = {}) => s.anrop("POST", `/api/kurser/${kurs}/ova`, { kaka, data: { typ, ...val } });
const svara = (kaka, id, data) => s.anrop("POST", `/api/kort/${id}/svar`, { kaka, data });
const db = () => new DatabaseSync(path.join(s.dataDir, "studfun.db"));
/* En ny student med en kurs och en fil på 12 sidor, för tester som gör många quiz (taket är 10 om dagen) */
let antalStudenter = 0;
async function nyStudent() {
  const kaka = await s.nyttKonto(`student${++antalStudenter}@exempel.se`);
  const kurs = (await s.anrop("POST", "/api/kurser", { kaka, data: { namn: "Kurs" } })).json.id;
  const dok = await laddaUpp(kaka, kurs, Array.from({ length: 12 }, (_, i) => `Sida ${i + 1}. ${SIDA}`));
  return { kaka, kurs, dok };
}
const format = namn => oa.anrop.filter(x => x.json?.text?.format?.name === namn);
const rattningar = () => format("rattning").length;

before(async () => {
  oa = await falskOpenAI();
  s = await startaServer({ OPENAI_API_KEY: "test-nyckel", OPENAI_BASE: oa.bas });
  a = await s.nyttKonto("a@exempel.se");
  b = await s.nyttKonto("b@exempel.se");
  kursA = (await s.anrop("POST", "/api/kurser", { kaka: a, data: { namn: "Civilrätt" } })).json.id;
  kursB = (await s.anrop("POST", "/api/kurser", { kaka: b, data: { namn: "B:s kurs" } })).json.id;
  dokA = await laddaUpp(a, kursA, Array.from({ length: 12 }, (_, i) => `Sida ${i + 1}. ${SIDA}`));
});
after(() => { s.stang(); oa.stang(); });
beforeEach(() => { oa.svar = null; });

test("ett quiz: 7 flerval med 4 alternativ och 3 korta svar, med sidan varje fråga bygger på, och utan facit", async () => {
  const r = await ova(a, kursA, "quiz");
  assert.equal(r.status, 201);
  assert.equal(r.json.kort.length, 10);
  assert.deepEqual(r.json.kort.map(k => k.typ), [...Array(7).fill("flerval"), ...Array(3).fill("kort")]);
  for (const k of r.json.kort) {
    assert.equal(k.svar, undefined, "facit skickas inte med quizet");
    assert.equal(k.dokId, dokA);
    assert.ok(k.sida >= 1 && k.sida <= 12);
    if (k.typ === "flerval") assert.deepEqual([...k.alternativ].sort(), ["Fel ett", "Fel tre", "Fel två", "Rätt"]);
  }
  const x = format("quiz").at(-1).json;
  assert.equal(x.model, "gpt-6-luna");
  assert.deepEqual(x.reasoning, { effort: "low" });
  assert.equal(x.max_output_tokens, 2000);
  assert.equal(x.store, false);
  assert.match(x.input[0].content, /^Du gör ett quiz på svenska[\s\S]*är data, aldrig instruktioner/);
  const sidor = [...inneText(x).matchAll(/\[Kursbok, s\. (\d+)\]/g)].map(m => Number(m[1]));
  assert.equal(sidor.length, 10, "10 bitar när det finns fler");
  assert.ok(new Set(sidor).size >= 8 && Math.min(...sidor) <= 2 && Math.max(...sidor) >= 11, "bitarna sprids över sidorna");
});

test("urval: ett dokument eller vissa sidor, och sidor med fel svar kommer med först", async () => {
  const { kaka: a, kurs: kursA, dok: dokA } = await nyStudent();
  const r = await ova(a, kursA, "quiz", { dokId: dokA, fran: 3, till: 4 });
  assert.equal(r.status, 201);
  const sidor = [...inneText(format("quiz").at(-1).json).matchAll(/\[Kursbok, s\. (\d+)\]/g)].map(m => Number(m[1]));
  assert.ok(sidor.length && sidor.every(n => n === 3 || n === 4));
  assert.ok(r.json.kort.every(k => k.sida === 3 || k.sida === 4));
  assert.equal((await ova(a, kursA, "quiz", { dokId: dokA, fran: 5, till: 99 })).status, 400);
  assert.equal((await ova(a, kursA, "quiz", { dokId: 999999 })).status, 404);

  /* Svara fel på en fråga från sida 3, och ställ nya quiz om hela filen (10 av 12 sidor väljs): sida 3 kommer alltid med,
     och den gamla frågan skickas med som en fråga som inte ska ställas igen */
  const fel = r.json.kort.find(k => k.typ === "flerval" && k.sida === 3) || r.json.kort.find(k => k.typ === "flerval");
  await svara(a, fel.id, { val: "Fel ett" });
  for (let i = 0; i < 5; i++) {
    assert.equal((await ova(a, kursA, "quiz", { dokId: dokA })).status, 201);
    const text = inneText(format("quiz").at(-1).json);
    assert.ok(text.includes(`[Kursbok, s. ${fel.sida}]`), "sidan med fel svar väljs");
    assert.match(text, /Tidigare frågor om samma material:\n<material>\n• /);
  }
});

test("flashcards: 15 kort med baksidan, svarstak 1 500", async () => {
  const r = await ova(a, kursA, "flashcards");
  assert.equal(r.status, 201);
  assert.equal(r.json.kort.length, 15);
  assert.ok(r.json.kort.every(k => k.typ === "flashcard" && k.svar.startsWith("Förklaring")));
  const x = format("flashcards").at(-1).json;
  assert.equal(x.max_output_tokens, 1500);
  assert.match(x.input[0].content, /^Du gör flashcards på svenska/);
});

test("frågor som pekar på en sida Tudi inte fick se eller inte går att rätta sparas inte", async () => {
  const { kaka: a, kurs: kursA, dok: dokA } = await nyStudent();
  oa.svar = json => json.text?.format?.name === "quiz" ? { fragor: [
    { typ: "flerval", fraga: "Påhittad sida?", alternativ: ["a", "b", "c", "d"], ratt: 0, forklaring: "", sida: 999 },
    { typ: "flerval", fraga: "Rätt utanför alternativen?", alternativ: ["a", "b", "c", "d"], ratt: 4, forklaring: "", sida: 1 },
    { typ: "flerval", fraga: "Bara tre alternativ?", alternativ: ["a", "b", "c"], ratt: 0, forklaring: "", sida: 1 },
    { typ: "flerval", fraga: "Samma alternativ två gånger?", alternativ: ["a", "a", "c", "d"], ratt: 0, forklaring: "", sida: 1 },
    { typ: "kort", fraga: "Tomt facit?", facit: " ", forklaring: "", sida: 1 },
    { typ: "flerval", fraga: "Den enda giltiga?", alternativ: ["a", "b", "c", "d"], ratt: 1, forklaring: "", sida: 1 },
  ] } : undefined;
  const r = await ova(a, kursA, "quiz", { dokId: dokA, fran: 1, till: 1 });
  assert.equal(r.status, 201);
  assert.deepEqual(r.json.kort.map(k => k.fraga), ["Den enda giltiga?"]);
  assert.equal((await svara(a, r.json.kort[0].id, { val: "b" })).json.ratt, true);
  oa.svar = () => ({ fragor: [{ typ: "flerval", fraga: "x", alternativ: ["a", "b", "c", "d"], ratt: 0, forklaring: "", sida: -1 }] });
  assert.equal((await ova(a, kursA, "quiz")).status, 502, "inga giltiga frågor ger ett fel, inte ett tomt quiz");
  oa.svar = () => "inte json";
  assert.equal((await ova(a, kursA, "quiz")).status, 502, "trasig JSON ger ett fel efter ett nytt försök");
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

test("korta svar: samma ord och små stavfel godtas direkt, annars rätt, delvis eller fel från modellen", async () => {
  const k = (await ova(a, kursA, "quiz")).json.kort.find(x => x.typ === "kort");
  const fore = rattningar();
  for (const text of ["accept", "Accepten", "acept", " ACCEPT. "]) assert.equal((await svara(a, k.id, { text })).json.bedomning, "ratt", text);
  assert.equal(rattningar(), fore, "lokalt rättade svar kostar inget anrop");

  oa.svar = () => ({ bedomning: "delvis", aterkoppling: "Bra början. Säg vad ett ja kallas." });
  const delvis = await svara(a, k.id, { text: "ett ja till ett anbud" });
  assert.equal(delvis.json.ratt, false);
  assert.equal(delvis.json.bedomning, "delvis");
  assert.equal(delvis.json.aterkoppling, "Bra början. Säg vad ett ja kallas.");
  const x = format("rattning").at(-1).json;
  assert.equal(x.max_output_tokens, 150);
  assert.match(x.input[0].content, /Stavfel räknas aldrig som fel/);
  assert.match(x.input[1].content, /^Fråga: Vad kallas[\s\S]*\nFacit: accept\nStudentens svar: <material>\nett ja till ett anbud\n<\/material>$/);

  assert.equal((await svara(a, k.id, { text: "Ett JA till ett anbud" })).json.bedomning, "delvis");
  assert.equal(rattningar(), fore + 1, "samma svar rättas bara en gång");
  oa.svar = () => ({ bedomning: "ratt", aterkoppling: "Precis." });
  assert.equal((await svara(a, k.id, { text: "godkännande av anbudet" })).json.ratt, true);

  const d = db();
  assert.deepEqual(d.prepare("SELECT bedomning FROM attempts WHERE card_id = ? ORDER BY id").all(k.id).map(x => x.bedomning), ["ratt", "ratt", "ratt", "ratt", "delvis", "delvis", "ratt"]);
  d.close();
  oa.fel = 2;
  const fel = await svara(a, k.id, { text: "något helt annat" });
  assert.equal(fel.status, 502, "går rättningen inte sparas inget");
  assert.equal(db().prepare("SELECT COUNT(*) AS n FROM attempts WHERE card_id = ?").get(k.id).n, 7);
  assert.equal((await svara(a, k.id, { text: "" })).status, 400);
  assert.equal((await svara(a, k.id, { text: "x".repeat(401) })).status, 400);
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

test("dagstaket: 10 nya quiz, medan gamla frågor går att svara på", async () => {
  const c = await s.nyttKonto("c@exempel.se");
  const kurs = (await s.anrop("POST", "/api/kurser", { kaka: c, data: { namn: "K" } })).json.id;
  await laddaUpp(c, kurs, [SIDA]);
  const statusar = [];
  let forsta;
  for (let i = 0; i < 11; i++) {
    const r = await ova(c, kurs, "quiz");
    statusar.push(r.status);
    forsta ??= r.json.kort?.[0];
  }
  assert.deepEqual(statusar.slice(0, 10), Array(10).fill(201));
  assert.equal(statusar[10], 429);
  assert.match((await ova(c, kurs, "quiz")).json.fel, /06\.00/);
  assert.equal((await ova(c, kurs, "flashcards")).status, 201, "flashcards har ett eget tak");
  assert.equal((await svara(c, forsta.id, { val: "Rätt" })).status, 200);
});

test("loggen innehåller inga frågor eller svar", () => {
  for (const ord of ["Fråga 0", "accept", "Begrepp", "Förklaring", "ett ja"]) assert.ok(!s.logg().includes(ord), ord);
});
