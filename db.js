/*
  Databasen. SQLite inbyggd i Node (22.5 eller senare).
  Varje tabell har user_id, så att varje rad går att spåra till en student,
  kontrolleras i varje anrop och raderas när kontot raderas.
*/
const { DatabaseSync } = require("node:sqlite");
const fs = require("fs");
const path = require("path");

/* Ändringar i databasen läggs till sist i listan, aldrig ändras i efterhand.
   PRAGMA user_version håller reda på hur många som redan körts. */
const MIGRATIONER = [
  `CREATE TABLE users (
     id INTEGER PRIMARY KEY,
     mejl TEXT NOT NULL UNIQUE,
     losen_hash TEXT NOT NULL,
     skapad INTEGER NOT NULL,
     godkant_tid INTEGER NOT NULL,
     godkant_version TEXT NOT NULL
   );
   CREATE TABLE sessions (
     id TEXT PRIMARY KEY,                -- sha256 av kakans värde, aldrig själva värdet
     user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     gar_ut INTEGER NOT NULL
   );
   CREATE INDEX sessions_user ON sessions(user_id);
   CREATE TABLE courses (
     id INTEGER PRIMARY KEY,
     user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     namn TEXT NOT NULL,
     termin TEXT NOT NULL DEFAULT '',
     skapad INTEGER NOT NULL
   );
   CREATE INDEX courses_user ON courses(user_id);
   CREATE TABLE documents (
     id INTEGER PRIMARY KEY,
     user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     course_id INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
     titel TEXT NOT NULL,
     sidor INTEGER NOT NULL DEFAULT 0,
     status TEXT NOT NULL,
     fil TEXT NOT NULL UNIQUE,           -- slumpat filnamn i datamappen
     storlek INTEGER NOT NULL,
     skapad INTEGER NOT NULL
   );
   CREATE INDEX documents_user ON documents(user_id);
   CREATE INDEX documents_course ON documents(course_id);
   CREATE TABLE chunks (
     id INTEGER PRIMARY KEY,
     user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     document_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
     sida INTEGER NOT NULL,
     text TEXT NOT NULL,
     vektor BLOB
   );
   CREATE INDEX chunks_document ON chunks(document_id);
   CREATE TABLE messages (
     id INTEGER PRIMARY KEY,
     user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     course_id INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
     roll TEXT NOT NULL,
     text TEXT NOT NULL,
     kallor TEXT NOT NULL DEFAULT '[]',
     tid INTEGER NOT NULL
   );
   CREATE INDEX messages_course ON messages(course_id);
   CREATE TABLE cards (
     id INTEGER PRIMARY KEY,
     user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     course_id INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
     document_id INTEGER REFERENCES documents(id) ON DELETE CASCADE,
     typ TEXT NOT NULL,
     fraga TEXT NOT NULL,
     svar TEXT NOT NULL,
     kalla_sida INTEGER
   );
   CREATE INDEX cards_course ON cards(course_id);
   CREATE TABLE attempts (
     id INTEGER PRIMARY KEY,
     user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     card_id INTEGER NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
     ratt INTEGER NOT NULL,
     tid INTEGER NOT NULL
   );
   CREATE INDEX attempts_card ON attempts(card_id);
   CREATE TABLE settings (
     user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
     textstorlek INTEGER NOT NULL DEFAULT 22,
     typsnitt TEXT NOT NULL DEFAULT 'lexend',
     rost TEXT NOT NULL DEFAULT '',
     tempo TEXT NOT NULL DEFAULT 'normalt'
   );`,
  /* Steg 4: var studenten slutade läsa, och hur mycket studenten har använt per dag (för taken) */
  `ALTER TABLE documents ADD COLUMN senast_sida INTEGER NOT NULL DEFAULT 1;
   CREATE TABLE anvandning (
     user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     dag TEXT NOT NULL,
     typ TEXT NOT NULL,
     antal INTEGER NOT NULL DEFAULT 0,
     PRIMARY KEY (user_id, dag, typ)
   );`,
  /* Steg 6: svarsalternativ och förklaring till quizfrågor och flashcards */
  `ALTER TABLE cards ADD COLUMN alternativ TEXT NOT NULL DEFAULT '[]';
   ALTER TABLE cards ADD COLUMN forklaring TEXT NOT NULL DEFAULT '';
   ALTER TABLE cards ADD COLUMN skapad INTEGER NOT NULL DEFAULT 0;
   CREATE INDEX attempts_user ON attempts(user_id);`,
  /* Steg 7: när studenten senast läste i filen, för nästa steg och Fortsätt läsa */
  `ALTER TABLE documents ADD COLUMN senast_last INTEGER;`,
];

function oppna(dataDir) {
  fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(path.join(dataDir, "studfun.db"));
  db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA secure_delete = ON; PRAGMA busy_timeout = 5000;");
  const klara = db.prepare("PRAGMA user_version").get().user_version;
  for (let i = klara; i < MIGRATIONER.length; i++) {
    db.exec("BEGIN");
    try {
      db.exec(MIGRATIONER[i]);
      db.exec(`PRAGMA user_version = ${i + 1}`);
      db.exec("COMMIT");
    } catch (e) { db.exec("ROLLBACK"); throw e; }
  }
  return db;
}

/* Kör fn i en transaktion. Går något fel ändras ingenting. */
function transaktion(db, fn) {
  db.exec("BEGIN");
  try { const r = fn(); db.exec("COMMIT"); return r; }
  catch (e) { db.exec("ROLLBACK"); throw e; }
}

/* Dagen byts klockan 06.00 svensk tid, så att taken börjar om på morgonen och inte mitt i en kvällsläsning */
function dag(nu = new Date()) {
  return new Date(nu.getTime() - 6 * 3600 * 1000).toLocaleDateString("sv-SE", { timeZone: "Europe/Stockholm" });
}

/* Räknar upp studentens användning av typ idag. Returnerar false, och räknar inte, om taket skulle passeras. */
function forbruka(db, userId, typ, mangd, max) {
  return transaktion(db, () => {
    const d = dag();
    const nu = db.prepare("SELECT antal FROM anvandning WHERE user_id = ? AND dag = ? AND typ = ?").get(userId, d, typ);
    if ((nu ? nu.antal : 0) + mangd > max) return false;
    db.prepare(`INSERT INTO anvandning (user_id, dag, typ, antal) VALUES (?, ?, ?, ?)
      ON CONFLICT (user_id, dag, typ) DO UPDATE SET antal = antal + excluded.antal`).run(userId, d, typ, mangd);
    db.prepare("DELETE FROM anvandning WHERE dag < ?").run(dag(new Date(Date.now() - 7 * 86400 * 1000)));
    return true;
  });
}

module.exports = { oppna, transaktion, dag, forbruka };
