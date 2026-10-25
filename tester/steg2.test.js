/* Steg 2: kurser. Testar också att ingen kommer åt någon annans kurs.
   Kör: npm test */
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { DatabaseSync } = require("node:sqlite");
const { startaServer } = require("./hjalp");

let s, a, b;
before(async () => {
  s = await startaServer();
  a = await s.nyttKonto("a@exempel.se");
  b = await s.nyttKonto("b@exempel.se");
});
after(() => s.stang());

const nyKurs = async (kaka, namn = "Civilrätt", termin = "HT 2026") =>
  (await s.anrop("POST", "/api/kurser", { kaka, data: { namn, termin } })).json;

/* Lägger in en PDF direkt i databasen och på disken, så att raderingen kan testas före steg 3 */
function laggTillPdf(kursId) {
  const db = new DatabaseSync(path.join(s.dataDir, "studfun.db"));
  db.exec("PRAGMA busy_timeout = 5000");
  const fil = crypto.randomBytes(16).toString("hex") + ".pdf";
  const userId = db.prepare("SELECT user_id FROM courses WHERE id = ?").get(kursId).user_id;
  db.prepare("INSERT INTO documents (user_id, course_id, titel, status, fil, storlek, skapad) VALUES (?, ?, 'Bok', 'klar', ?, 9, 0)")
    .run(userId, kursId, fil);
  db.close();
  fs.writeFileSync(path.join(s.dataDir, "pdf", fil), "%PDF-1.4");
  return path.join(s.dataDir, "pdf", fil);
}

test("skapa kurs kontrollerar namn och termin", async () => {
  for (const data of [{ namn: "" }, { namn: "   " }, { namn: "x".repeat(101) }, { namn: "Ok", termin: "Hösten" }, { namn: 5 }]) {
    assert.equal((await s.anrop("POST", "/api/kurser", { kaka: a, data })).status, 400, JSON.stringify(data).slice(0, 40));
  }
  const k = await nyKurs(a, "  <b>Processrätt</b>  ", "");
  assert.equal(k.namn, "<b>Processrätt</b>", "namnet sparas som text, och appen visar det som text");
  assert.equal(k.termin, "");
  assert.equal(k.antalPdf, 0);
});

test("listan visar bara studentens egna kurser", async () => {
  await nyKurs(b, "B:s hemliga kurs");
  const listaA = (await s.anrop("GET", "/api/kurser", { kaka: a })).json.kurser;
  assert.ok(listaA.length > 0);
  assert.ok(!listaA.some(k => k.namn === "B:s hemliga kurs"));
});

test("konto B kan inte läsa, ändra eller radera konto A:s kurs genom att byta id", async () => {
  const k = await nyKurs(a, "A:s kurs");
  const pdf = laggTillPdf(k.id);
  assert.equal((await s.anrop("GET", `/api/kurser/${k.id}`, { kaka: b })).status, 404);
  assert.equal((await s.anrop("PUT", `/api/kurser/${k.id}`, { kaka: b, data: { namn: "Kapad", termin: "" } })).status, 404);
  assert.equal((await s.anrop("DELETE", `/api/kurser/${k.id}`, { kaka: b })).status, 404);
  const efter = (await s.anrop("GET", `/api/kurser/${k.id}`, { kaka: a })).json;
  assert.equal(efter.namn, "A:s kurs");
  assert.equal(efter.antalPdf, 1);
  assert.ok(fs.existsSync(pdf), "A:s PDF ska finnas kvar");
});

test("id som inte är siffror, eller som inte finns, ger 404", async () => {
  for (const adress of ["/api/kurser/abc", "/api/kurser/1%20OR%201=1", "/api/kurser/-1", "/api/kurser/1.5", "/api/kurser/999999"]) {
    assert.equal((await s.anrop("GET", adress, { kaka: a })).status, 404, adress);
  }
});

test("anrop utan inloggning nekas på varje kursadress", async () => {
  const k = await nyKurs(a);
  for (const [metod, adress, data] of [["GET", "/api/kurser"], ["POST", "/api/kurser", { namn: "x" }],
    ["GET", `/api/kurser/${k.id}`], ["PUT", `/api/kurser/${k.id}`, { namn: "x" }], ["DELETE", `/api/kurser/${k.id}`]]) {
    assert.equal((await s.anrop(metod, adress, { data })).status, 401, `${metod} ${adress}`);
  }
});

test("byta namn och termin", async () => {
  const k = await nyKurs(a, "Gammalt namn");
  const r = await s.anrop("PUT", `/api/kurser/${k.id}`, { kaka: a, data: { namn: "Nytt namn", termin: "VT 2027" } });
  assert.equal(r.status, 200);
  assert.equal(r.json.namn, "Nytt namn");
  assert.equal(r.json.termin, "VT 2027");
});

test("radera kursen tar bort PDF:en på disken och allt i databasen", async () => {
  const k = await nyKurs(a, "Ska raderas");
  const pdf = laggTillPdf(k.id);
  assert.equal((await s.anrop("DELETE", `/api/kurser/${k.id}`, { kaka: a })).status, 200);
  assert.equal((await s.anrop("GET", `/api/kurser/${k.id}`, { kaka: a })).status, 404);
  assert.ok(!fs.existsSync(pdf), "PDF:en ska vara borta från disken");
  const db = new DatabaseSync(path.join(s.dataDir, "studfun.db"));
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM documents WHERE course_id = ?").get(k.id).n, 0);
  db.close();
});

test("radera kontot tar bort kurserna och PDF:erna", async () => {
  const c = await s.nyttKonto("c@exempel.se");
  const k = await nyKurs(c, "C:s kurs");
  const pdf = laggTillPdf(k.id);
  assert.equal((await s.anrop("DELETE", "/api/konto", { kaka: c })).status, 200);
  assert.ok(!fs.existsSync(pdf));
  const db = new DatabaseSync(path.join(s.dataDir, "studfun.db"));
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM courses WHERE namn = 'C:s kurs'").get().n, 0);
  db.close();
});

test("högst 50 kurser per student", async () => {
  const d = await s.nyttKonto("d@exempel.se");
  for (let i = 0; i < 50; i++) assert.equal((await s.anrop("POST", "/api/kurser", { kaka: d, data: { namn: `Kurs ${i}` } })).status, 201);
  assert.equal((await s.anrop("POST", "/api/kurser", { kaka: d, data: { namn: "En för mycket" } })).status, 400);
});

test("radera allt material tar bort PDF:erna men behåller kurserna", async () => {
  const e = await s.nyttKonto("e@exempel.se");
  const k = await nyKurs(e, "E:s kurs");
  const pdf = laggTillPdf(k.id);
  const pdfA = laggTillPdf((await nyKurs(a, "A:s andra kurs")).id);
  assert.equal((await s.anrop("POST", "/api/radera-material", { kaka: e, data: {} })).status, 200);
  assert.ok(!fs.existsSync(pdf));
  assert.ok(fs.existsSync(pdfA), "andra studenters PDF:er ska finnas kvar");
  const efter = (await s.anrop("GET", `/api/kurser/${k.id}`, { kaka: e })).json;
  assert.equal(efter.namn, "E:s kurs");
  assert.equal(efter.antalPdf, 0);
});
