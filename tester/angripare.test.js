/* Steg 8: tester som går igenom hela appen som en angripare.
   Adresserna läses ur koden, så att en ny adress automatiskt kommer med.
   Kör: npm test */
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { DatabaseSync } = require("node:sqlite");
const { startaServer, falskOpenAI } = require("./hjalp");

const ROT = path.join(__dirname, "..");
const OPPNA = ["POST /api/konto", "POST /api/logga-in", "POST /api/logga-ut"];

/* Alla rutt("METOD", "/api/...") i serverns filer. ${typ} blir quiz och flashcards, :namn blir 1. */
function allaAdresser() {
  const ut = [];
  for (const fil of fs.readdirSync(ROT).filter(f => f.endsWith(".js"))) {
    for (const [, metod, monster] of fs.readFileSync(path.join(ROT, fil), "utf8").matchAll(/rutt\("([A-Z]+)", [`"]([^`"]+)[`"]/g)) {
      for (const m of monster.includes("${typ}") ? ["quiz", "flashcards"].map(t => monster.replace("${typ}", t)) : [monster]) {
        ut.push({ metod, monster: m, adress: m.replace(/:\w+/g, "1") });
      }
    }
  }
  return ut;
}

let s, oa;
before(async () => {
  oa = await falskOpenAI();
  s = await startaServer({ OPENAI_API_KEY: "test-nyckel", OPENAI_BASE: oa.bas });
});
after(() => { s.stang(); oa.stang(); });

test("koden har alla adresser vi väntar oss", () => {
  const adresser = allaAdresser();
  assert.ok(adresser.length >= 32, `hittade bara ${adresser.length}`);
  for (const a of ["GET /api/dokument/:id/fil", "POST /api/kurser/:kursId/fraga", "DELETE /api/konto", "GET /api/kurser/:kursId/repetera-quiz"]) {
    assert.ok(adresser.some(x => `${x.metod} ${x.monster}` === a), a);
  }
});

test("varje adress utom inloggningen nekas utan inloggning", async () => {
  for (const { metod, monster, adress } of allaAdresser()) {
    if (OPPNA.includes(`${metod} ${monster}`)) continue;
    const r = await s.anrop(metod, adress, { data: metod === "GET" ? undefined : {} });
    assert.equal(r.status, 401, `${metod} ${monster} gav ${r.status}`);
    assert.ok(!r.text.includes("Error") && !r.text.includes("at "), `${metod} ${monster} visar teknik`);
  }
});

test("varje ändrande adress nekas från en annan webbplats, även med giltig inloggning", async () => {
  const kaka = await s.nyttKonto("origin@exempel.se");
  for (const { metod, monster, adress } of allaAdresser()) {
    if (metod === "GET") continue;
    for (const origin of ["https://ond.example", "null", null]) {
      const r = await s.anrop(metod, adress, { kaka, origin, data: {} });
      assert.equal(r.status, 403, `${metod} ${monster} med Origin ${origin} gav ${r.status}`);
    }
  }
  assert.equal((await s.anrop("GET", "/api/jag", { kaka })).status, 200, "kontot finns kvar");
});

test("utan APP_ORIGIN godtas bara datorns egna adresser, med APP_ORIGIN bara den", async () => {
  const lokal = await startaServer({ APP_ORIGIN: "" });
  try {
    for (const origin of ["localhost", "127.0.0.1", "[::1]"]) {
      const port = new URL(lokal.logg().match(/StudFun 1\.0 på (\S+)/)[1]).port;
      const r = await lokal.anrop("POST", "/api/konto", { origin: `http://${origin}:${port}`, data: { mejl: `${origin.replace(/\W/g, "")}@exempel.se`, losen: "tio tecken!!", godkant: true } });
      assert.equal(r.status, 201, origin);
    }
    assert.equal((await lokal.anrop("POST", "/api/konto", { origin: "http://localhost:1", data: {} })).status, 403, "fel port");
    assert.equal((await lokal.anrop("POST", "/api/konto", { origin: "http://studfun.evil", data: {} })).status, 403);
    assert.match(lokal.logg(), /nekad: fel Origin/);
  } finally { lokal.stang(); }
  const port = new URL(s.logg().match(/StudFun 1\.0 på (\S+)/)[1]).port;
  assert.equal((await s.anrop("POST", "/api/konto", { origin: `http://127.0.0.1:${port}`, data: {} })).status, 403, "med APP_ORIGIN är kontrollen strikt");
});

test("fel och okända adresser visar aldrig tekniska detaljer", async () => {
  const kaka = await s.nyttKonto("teknik@exempel.se");
  for (const [metod, adress, data] of [["GET", "/api/finns-inte"], ["PATCH", "/api/kurser"], ["GET", "/api/kurser/9999999999999999999999"],
    ["POST", "/api/kurser", "{trasig"], ["GET", "/api/kort/1/svar"]]) {
    const r = await s.anrop(metod, adress, typeof data === "string" ? { kaka, ra: data, headers: { "content-type": "application/json" } } : { kaka, data });
    assert.ok(r.status >= 400 && r.status < 500, `${metod} ${adress} gav ${r.status}`);
    assert.ok(r.json && typeof r.json.fel === "string", `${metod} ${adress} ska ge ett vänligt fel`);
    assert.doesNotMatch(r.text, /sqlite|node:|\.js:|stack|SELECT/i);
  }
});

test("radera kontot efter att ha använt allt: inget av studentens data finns kvar", async () => {
  const MARKOR = "Zebrafinken Ottilia";
  const mejl = "allt.ska.bort@exempel.se";
  const kaka = await s.nyttKonto(mejl, "ett langt losenord");
  const kurs = (await s.anrop("POST", "/api/kurser", { kaka, data: { namn: `Kurs om ${MARKOR}` } })).json.id;
  const text = `${MARKOR} är ett påhittat begrepp i den här testboken. Det används för att se att ingenting finns kvar efter att kontot raderats, varken i databasen eller på disken. Texten är lite längre, så att den räcker till övningar.`;
  const dok = (await s.anrop("POST", `/api/kurser/${kurs}/dokument`, { kaka, data: { titel: MARKOR, sidor: [text, text] } })).json.id;
  await s.anrop("PUT", `/api/dokument/${dok}/fil`, { kaka, ra: Buffer.from("%PDF-1.4\n%%EOF\n"), headers: { "content-type": "application/pdf" } });
  for (let i = 0; i < 100 && (await s.anrop("GET", `/api/dokument/${dok}`, { kaka })).json.status !== "klar"; i++) await new Promise(r => setTimeout(r, 50));

  /* Använd allt som sparar något */
  await s.anrop("PUT", `/api/dokument/${dok}/position`, { kaka, data: { sida: 2 } });
  assert.equal((await s.anrop("POST", `/api/dokument/${dok}/upplas`, { kaka, data: { text } })).status, 200);
  assert.equal((await s.anrop("POST", `/api/kurser/${kurs}/fraga`, { kaka, data: { fraga: `Vad är ${MARKOR}?` } })).status, 200);
  const quiz = (await s.anrop("POST", `/api/kurser/${kurs}/ova`, { kaka, data: { typ: "quiz" } })).json.kort;
  await s.anrop("POST", `/api/kort/${quiz[0].id}/svar`, { kaka, data: { val: quiz[0].alternativ[0] } });
  const kort = (await s.anrop("POST", `/api/kurser/${kurs}/ova`, { kaka, data: { typ: "flashcards" } })).json.kort;
  await s.anrop("POST", `/api/kort/${kort[0].id}/svar`, { kaka, data: { kunde: false } });
  await s.anrop("PUT", "/api/installningar", { kaka, data: { typsnitt: "atkinson" } });

  const db = new DatabaseSync(path.join(s.dataDir, "studfun.db"));
  const uid = db.prepare("SELECT id FROM users WHERE mejl = ?").get(mejl).id;
  const tabeller = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND sql LIKE '%user_id%'").all().map(t => t.name);
  const fil = db.prepare("SELECT fil FROM documents WHERE id = ?").get(dok).fil;
  for (const t of tabeller) assert.ok(db.prepare(`SELECT COUNT(*) AS n FROM ${t} WHERE user_id = ?`).get(uid).n > 0, `testet ska ha skapat rader i ${t}`);
  db.close();
  assert.ok(fs.existsSync(path.join(s.dataDir, "pdf", fil)));
  assert.ok(fs.readdirSync(path.join(s.dataDir, "upplasning", String(dok))).length > 0);

  assert.equal((await s.anrop("DELETE", "/api/konto", { kaka })).status, 200);

  const db2 = new DatabaseSync(path.join(s.dataDir, "studfun.db"));
  for (const t of [...tabeller, "users"]) {
    const kol = t === "users" ? "id" : "user_id";
    assert.equal(db2.prepare(`SELECT COUNT(*) AS n FROM ${t} WHERE ${kol} = ?`).get(uid).n, 0, `rader kvar i ${t}`);
  }
  db2.close();
  assert.ok(!fs.existsSync(path.join(s.dataDir, "pdf", fil)), "PDF:en ska vara borta");
  assert.ok(!fs.existsSync(path.join(s.dataDir, "upplasning", String(dok))), "uppläsningen ska vara borta");
  const filer = fs.readdirSync(s.dataDir).filter(f => f.startsWith("studfun.db"));
  for (const f of filer) {
    const innehall = fs.readFileSync(path.join(s.dataDir, f)).toString("utf8");
    assert.ok(!innehall.includes(MARKOR) && !innehall.includes(mejl), `text finns kvar i ${f}`);
  }
  assert.equal((await s.anrop("GET", "/api/jag", { kaka })).status, 401);
});
