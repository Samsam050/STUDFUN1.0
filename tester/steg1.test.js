/* Steg 1: konto, inloggning och radering. Testar också det som ska nekas.
   Kör: npm test */
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { startaServer } = require("./hjalp");

let s;
before(async () => { s = await startaServer(); });
after(() => s.stang());

test("skapa konto kräver godkännande, giltig mejl och minst 10 tecken", async () => {
  const fall = [
    { mejl: "a@exempel.se", losen: "tio tecken!", godkant: false },
    { mejl: "inte-en-mejl", losen: "tio tecken!", godkant: true },
    { mejl: "a@exempel.se", losen: "kort", godkant: true },
    { mejl: "a@exempel.se", losen: "x".repeat(201), godkant: true },
  ];
  for (const data of fall) assert.equal((await s.anrop("POST", "/api/konto", { data })).status, 400);
  assert.equal((await s.anrop("POST", "/api/konto", { data: { mejl: "a@exempel.se", losen: "tio tecken!", godkant: true } })).status, 201);
  const igen = await s.anrop("POST", "/api/konto", { data: { mejl: "A@Exempel.se ", losen: "tio tecken!", godkant: true } });
  assert.equal(igen.status, 409);
});

test("på https är kakan __Host-, HttpOnly, Secure och SameSite=Lax", async () => {
  const https = await startaServer({ APP_ORIGIN: "https://studfun.exempel.se" });
  try {
    const r = await https.anrop("POST", "/api/konto", { data: { mejl: "kaka@exempel.se", losen: "ett langt losenord", godkant: true } });
    const satt = r.headers.get("set-cookie");
    assert.match(satt, /^__Host-sf=/);
    for (const del of ["HttpOnly", "Secure", "SameSite=Lax", "Path=/"]) assert.ok(satt.includes(del), del);
    assert.equal((await https.anrop("GET", "/api/jag", { kaka: r.kaka })).status, 200);
    assert.equal((await https.anrop("GET", "/api/jag", { kaka: r.kaka.replace("__Host-sf", "sf") })).status, 401, "på https godtas bara __Host-kakan");
  } finally { https.stang(); }
});

test("lokalt på http är kakan HttpOnly och SameSite=Lax men inte Secure, så att Safari sparar den", async () => {
  const r = await s.anrop("POST", "/api/konto", { data: { mejl: "kaka.lokal@exempel.se", losen: "ett langt losenord", godkant: true } });
  const satt = r.headers.get("set-cookie");
  assert.match(satt, /^sf=/);
  for (const del of ["HttpOnly", "SameSite=Lax", "Path=/"]) assert.ok(satt.includes(del), del);
  assert.ok(!satt.includes("Secure"));
  assert.equal((await s.anrop("GET", "/api/jag", { kaka: r.kaka })).status, 200);
});

test("kakan sparas bara som hash i databasen", async () => {
  const r = await s.anrop("POST", "/api/konto", { data: { mejl: "kaka@exempel.se", losen: "ett langt losenord", godkant: true } });
  const token = r.kaka.split("=")[1];
  const db = fs.readFileSync(path.join(s.dataDir, "studfun.db")).toString("latin1") +
    (fs.existsSync(path.join(s.dataDir, "studfun.db-wal")) ? fs.readFileSync(path.join(s.dataDir, "studfun.db-wal")).toString("latin1") : "");
  assert.ok(!db.includes(token), "kakans värde får inte finnas i databasen");
});

test("fel lösenord 50 gånger i rad spärras, också för rätt lösenord", async () => {
  await s.nyttKonto("offer@exempel.se", "ratt losenord 123");
  const statusar = [];
  for (let i = 0; i < 50; i++) {
    statusar.push((await s.anrop("POST", "/api/logga-in", { data: { mejl: "offer@exempel.se", losen: "fel losenord " + i } })).status);
  }
  assert.deepEqual(statusar.slice(0, 10), Array(10).fill(401));
  assert.ok(statusar.slice(10).every(x => x === 429), "efter 10 fel ska det spärras");
  const ratt = await s.anrop("POST", "/api/logga-in", { data: { mejl: "offer@exempel.se", losen: "ratt losenord 123" } });
  assert.equal(ratt.status, 429);
});

test("okänd mejl och fel lösenord ger samma svar", async () => {
  await s.nyttKonto("finns@exempel.se");
  const a = await s.anrop("POST", "/api/logga-in", { data: { mejl: "finns@exempel.se", losen: "fel fel fel fel" } });
  const b = await s.anrop("POST", "/api/logga-in", { data: { mejl: "finnsinte@exempel.se", losen: "fel fel fel fel" } });
  assert.equal(a.status, 401); assert.equal(b.status, 401);
  assert.equal(a.json.fel, b.json.fel);
});

test("anrop utan inloggning nekas på varje skyddad adress", async () => {
  for (const [metod, adress, data] of [
    ["GET", "/api/jag"], ["PUT", "/api/installningar", { typsnitt: "atkinson" }],
    ["POST", "/api/radera-material", {}], ["DELETE", "/api/konto"],
  ]) {
    assert.equal((await s.anrop(metod, adress, { data })).status, 401, `${metod} ${adress}`);
    assert.equal((await s.anrop(metod, adress, { data, kaka: "sf=pahittad; __Host-sf=pahittad" })).status, 401, `${metod} ${adress} med falsk kaka`);
  }
});

test("ändrande anrop från annan adress eller utan Origin nekas", async () => {
  const kaka = await s.nyttKonto("origin@exempel.se");
  assert.equal((await s.anrop("DELETE", "/api/konto", { kaka, origin: "https://ond.example" })).status, 403);
  assert.equal((await s.anrop("DELETE", "/api/konto", { kaka, origin: null })).status, 403);
  assert.equal((await s.anrop("GET", "/api/jag", { kaka })).status, 200, "kontot ska finnas kvar");
});

test("jättestort anrop, trasig JSON och fel innehållstyp nekas", async () => {
  const kaka = await s.nyttKonto("stor@exempel.se");
  const stor = await s.anrop("PUT", "/api/installningar", { kaka, data: { x: "a".repeat(2_000_000) } });
  assert.equal(stor.status, 413);
  assert.equal((await s.anrop("PUT", "/api/installningar", { kaka, ra: "{inte json", headers: { "content-type": "application/json" } })).status, 400);
  assert.equal((await s.anrop("PUT", "/api/installningar", { kaka, ra: "typsnitt=atkinson", headers: { "content-type": "text/plain" } })).status, 415);
});

test("inställningar tar bara emot tillåtna värden och gäller bara den egna studenten", async () => {
  const a = await s.nyttKonto("a2@exempel.se");
  const b = await s.nyttKonto("b2@exempel.se");
  assert.equal((await s.anrop("PUT", "/api/installningar", { kaka: a, data: { tempo: "turbo" } })).status, 400);
  assert.equal((await s.anrop("PUT", "/api/installningar", { kaka: a, data: { typsnitt: "<script>" } })).status, 400);
  const ok = await s.anrop("PUT", "/api/installningar", { kaka: a, data: { typsnitt: "atkinson", tempo: "snabbt", user_id: 999 } });
  assert.equal(ok.status, 200);
  assert.equal((await s.anrop("GET", "/api/jag", { kaka: a })).json.installningar.typsnitt, "atkinson");
  const jagB = await s.anrop("GET", "/api/jag", { kaka: b });
  assert.equal(jagB.json.mejl, "b2@exempel.se");
  assert.equal(jagB.json.installningar.typsnitt, "lexend");
});

test("säkerhetshuvuden finns på sidan och i API:t", async () => {
  for (const adress of ["/", "/installningar", "/api/jag", "/app.css"]) {
    const r = await s.anrop("GET", adress);
    const csp = r.headers.get("content-security-policy");
    assert.ok(csp && csp.includes("default-src 'self'") && csp.includes("frame-ancestors 'none'"), adress);
    assert.equal(r.headers.get("x-content-type-options"), "nosniff");
    assert.equal(r.headers.get("x-frame-options"), "DENY");
  }
});

test("filer utanför public går inte att hämta", async () => {
  for (const adress of ["/../server.js", "/%2e%2e/server.js", "/..%2fserver.js", "/../data/studfun.db", "/js/../../konto.js"]) {
    const r = await s.anrop("GET", adress);
    assert.ok(r.status === 404 || r.status === 400, `${adress} gav ${r.status}`);
    assert.ok(!r.text.includes("require("), adress);
  }
});

test("radera allt material behåller kontot", async () => {
  const kaka = await s.nyttKonto("material@exempel.se");
  assert.equal((await s.anrop("POST", "/api/radera-material", { kaka, data: {} })).status, 200);
  assert.equal((await s.anrop("GET", "/api/jag", { kaka })).status, 200);
});

test("logga ut gör kakan ogiltig", async () => {
  const kaka = await s.nyttKonto("ut@exempel.se");
  assert.equal((await s.anrop("POST", "/api/logga-ut", { kaka })).status, 200);
  assert.equal((await s.anrop("GET", "/api/jag", { kaka })).status, 401);
});

test("radera kontot tar bort allt, och inget finns kvar i databasfilerna", async () => {
  const mejl = "radera.mig@exempel.se";
  const kaka = await s.nyttKonto(mejl, "hemligt losenord 42");
  const kaka2 = (await s.anrop("POST", "/api/logga-in", { data: { mejl, losen: "hemligt losenord 42" } })).kaka;
  const filer = () => fs.readdirSync(s.dataDir).filter(f => f.startsWith("studfun.db"))
    .map(f => fs.readFileSync(path.join(s.dataDir, f)).toString("latin1")).join("");
  assert.ok(filer().includes(mejl), "testet ska se mejladressen innan radering, annars testar det ingenting");
  assert.equal((await s.anrop("DELETE", "/api/konto", { kaka })).status, 200);
  assert.equal((await s.anrop("GET", "/api/jag", { kaka })).status, 401);
  assert.equal((await s.anrop("GET", "/api/jag", { kaka: kaka2 })).status, 401, "alla sessioner ska vara borta");
  assert.equal((await s.anrop("POST", "/api/logga-in", { data: { mejl, losen: "hemligt losenord 42" } })).status, 401);
  for (const fil of fs.readdirSync(s.dataDir).filter(f => f.startsWith("studfun.db"))) {
    const innehall = fs.readFileSync(path.join(s.dataDir, fil)).toString("latin1");
    assert.ok(!innehall.includes(mejl), `mejladressen finns kvar i ${fil}`);
  }
});

test("loggen innehåller aldrig mejl eller lösenord", async () => {
  await s.nyttKonto("loggtest@exempel.se", "loggtest losenord");
  await s.anrop("POST", "/api/logga-in", { data: { mejl: "loggtest@exempel.se", losen: "fel i loggtest" } });
  const logg = s.logg();
  for (const ord of ["loggtest@exempel.se", "loggtest losenord", "fel i loggtest", "@exempel.se"]) assert.ok(!logg.includes(ord), ord);
});
