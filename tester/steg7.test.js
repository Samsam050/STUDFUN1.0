/* Steg 7: nästa steg och startsidan. Nästa steg bygger bara på studentens egna svar och läsning.
   Kör: npm test */
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { startaServer, falskOpenAI } = require("./hjalp");

let s, oa;
const PDF = Buffer.from("%PDF-1.4\n%%EOF\n");
const SIDA = "Ett anbud är ett erbjudande om att ingå ett avtal. Ett anbud gäller bara under en viss tid. Om anbudet saknar svarsfrist ska mottagaren svara inom skälig tid. Ett ja till ett anbud kallas accept, och då blir avtalet klart.";

before(async () => {
  oa = await falskOpenAI();
  s = await startaServer({ OPENAI_API_KEY: "test-nyckel", OPENAI_BASE: oa.bas });
});
after(() => { s.stang(); oa.stang(); });

async function laddaUpp(kaka, kurs, titel = "Kursbok") {
  const id = (await s.anrop("POST", `/api/kurser/${kurs}/dokument`, { kaka, data: { titel, sidor: [SIDA, SIDA, SIDA] } })).json.id;
  await s.anrop("PUT", `/api/dokument/${id}/fil`, { kaka, ra: PDF, headers: { "content-type": "application/pdf" } });
  for (let i = 0; i < 100; i++) {
    if ((await s.anrop("GET", `/api/dokument/${id}`, { kaka })).json.status === "klar") return id;
    await new Promise(r => setTimeout(r, 50));
  }
  throw new Error("blev aldrig klar");
}
const nasta = async kaka => (await s.anrop("GET", "/api/nasta-steg", { kaka })).json;

test("nästa steg följer ordningen: fel svar, påbörjad PDF, ny PDF, ladda upp", async () => {
  const a = await s.nyttKonto("a@exempel.se");
  assert.equal((await nasta(a)).typ, "ingen");

  const kurs = (await s.anrop("POST", "/api/kurser", { kaka: a, data: { namn: "Civilrätt" } })).json.id;
  assert.deepEqual(await nasta(a), { typ: "laddaUpp", kursId: kurs, kurs: "Civilrätt" });

  const dok = await laddaUpp(a, kurs);
  assert.deepEqual(await nasta(a), { typ: "borja", kursId: kurs, kurs: "Civilrätt", dokId: dok, titel: "Kursbok", sida: 1 });

  await s.anrop("PUT", `/api/dokument/${dok}/position`, { kaka: a, data: { sida: 2 } });
  assert.deepEqual(await nasta(a), { typ: "fortsatt", kursId: kurs, kurs: "Civilrätt", dokId: dok, titel: "Kursbok", sida: 2 });

  const kort = (await s.anrop("POST", `/api/kurser/${kurs}/ova`, { kaka: a, data: { typ: "flashcards" } })).json.kort;
  await s.anrop("POST", `/api/kort/${kort[0].id}/svar`, { kaka: a, data: { kunde: false } });
  const kortSteg = await nasta(a);
  assert.equal(kortSteg.typ, "repeteraKort");
  assert.equal(kortSteg.antal, 1);
  assert.equal(kortSteg.lasa.sida, 2, "Fortsätt läsa istället finns kvar som val");

  const quiz = (await s.anrop("POST", `/api/kurser/${kurs}/ova`, { kaka: a, data: { typ: "quiz" } })).json.kort;
  const flerval = quiz.filter(k => k.typ === "flerval");
  for (const k of flerval.slice(0, 3)) await s.anrop("POST", `/api/kort/${k.id}/svar`, { kaka: a, data: { val: "Fel ett" } });
  const quizSteg = await nasta(a);
  assert.equal(quizSteg.typ, "repetera", "fel svar i quiz går först");
  assert.equal(quizSteg.antal, 3);
  assert.equal(quizSteg.kursId, kurs);

  /* Ett rätt svar senare gör att frågan inte längre ska repeteras */
  for (const k of flerval.slice(0, 3)) await s.anrop("POST", `/api/kort/${k.id}/svar`, { kaka: a, data: { val: "Rätt" } });
  await s.anrop("POST", `/api/kort/${kort[0].id}/svar`, { kaka: a, data: { kunde: true } });
  assert.equal((await nasta(a)).typ, "fortsatt");

  /* En utläst fil räknas inte som påbörjad */
  await s.anrop("PUT", `/api/dokument/${dok}/position`, { kaka: a, data: { sida: 3 } });
  assert.deepEqual(await nasta(a), { typ: "ova", kursId: kurs, kurs: "Civilrätt" }, "allt är läst och inget är fel: öva på det");
});

test("repetitionen ger bara frågor som senast blev fel, quizfrågor utan facit", async () => {
  const b = await s.nyttKonto("b@exempel.se");
  const kurs = (await s.anrop("POST", "/api/kurser", { kaka: b, data: { namn: "K" } })).json.id;
  await laddaUpp(b, kurs);
  const quiz = (await s.anrop("POST", `/api/kurser/${kurs}/ova`, { kaka: b, data: { typ: "quiz" } })).json.kort.filter(k => k.typ === "flerval");
  await s.anrop("POST", `/api/kort/${quiz[0].id}/svar`, { kaka: b, data: { val: "Fel ett" } });
  await s.anrop("POST", `/api/kort/${quiz[1].id}/svar`, { kaka: b, data: { val: "Rätt" } });
  await s.anrop("POST", `/api/kort/${quiz[2].id}/svar`, { kaka: b, data: { val: "Rätt" } });
  await s.anrop("POST", `/api/kort/${quiz[2].id}/svar`, { kaka: b, data: { val: "Fel två" } });
  const r = (await s.anrop("GET", `/api/kurser/${kurs}/repetera-quiz`, { kaka: b })).json.kort;
  assert.deepEqual(r.map(k => k.id).sort(), [quiz[0].id, quiz[2].id].sort());
  assert.ok(r.every(k => k.svar === undefined), "facit skickas inte");
  assert.deepEqual((await s.anrop("GET", `/api/kurser/${kurs}/repetera-flashcards`, { kaka: b })).json.kort, []);
});

test("konto B ser aldrig konto A:s nästa steg eller repetition", async () => {
  const a = await s.nyttKonto("a2@exempel.se");
  const b = await s.nyttKonto("b2@exempel.se");
  const kurs = (await s.anrop("POST", "/api/kurser", { kaka: a, data: { namn: "A:s kurs" } })).json.id;
  await laddaUpp(a, kurs, "A:s hemliga bok");
  const k = (await s.anrop("POST", `/api/kurser/${kurs}/ova`, { kaka: a, data: { typ: "quiz" } })).json.kort.find(x => x.typ === "flerval");
  await s.anrop("POST", `/api/kort/${k.id}/svar`, { kaka: a, data: { val: "Fel ett" } });
  assert.equal((await nasta(a)).typ, "repetera");
  assert.deepEqual(await nasta(b), { typ: "ingen" });
  assert.equal((await s.anrop("GET", `/api/kurser/${kurs}/repetera-quiz`, { kaka: b })).status, 404);
  assert.equal((await s.anrop("GET", "/api/nasta-steg")).status, 401);
  assert.equal((await s.anrop("GET", `/api/kurser/${kurs}/repetera-quiz`)).status, 401);
});

test("kurslistan visar var studenten slutade läsa och vad som bearbetas", async () => {
  const c = await s.nyttKonto("c@exempel.se");
  const kurs = (await s.anrop("POST", "/api/kurser", { kaka: c, data: { namn: "K" } })).json.id;
  const lista = async () => (await s.anrop("GET", "/api/kurser", { kaka: c })).json.kurser[0];
  assert.equal((await lista()).senast, null);
  const dok = await laddaUpp(c, kurs);
  await s.anrop("PUT", `/api/dokument/${dok}/position`, { kaka: c, data: { sida: 2 } });
  assert.deepEqual((await lista()).senast, { dokId: dok, titel: "Kursbok", sida: 2 });
  assert.equal((await lista()).bearbetas, 0);
});
