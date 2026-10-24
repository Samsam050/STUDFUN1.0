/*
  Kostnaden för AI per dag och funktion, ur mätningen i databasen. Ingen text, bara siffror.

  npm run kostnad          de senaste 14 dagarna
  npm run kostnad -- 30    de senaste 30 dagarna

  Priserna står i priser.json. Token från cache är början av anropet som OpenAI återanvände.
*/
const fs = require("fs");
const path = require("path");
try { process.loadEnvFile(path.join(__dirname, ".env")); } catch (e) { if (e.code !== "ENOENT") throw e; }
const { oppna, dag } = require("./db");

const dagar = Number(process.argv[2]) || 14;
const db = oppna(process.env.DATA_DIR || path.join(__dirname, "data"));
const priser = JSON.parse(fs.readFileSync(path.join(__dirname, "priser.json"), "utf8"));
const fran = dag(new Date(Date.now() - (dagar - 1) * 86400 * 1000));

const rader = db.prepare(`SELECT dag, funktion, modell, COUNT(*) AS anrop, SUM(1 - ok) AS fel, COUNT(DISTINCT student) AS studenter,
    SUM(token_in) AS token_in, SUM(token_cache) AS token_cache, SUM(token_ut) AS token_ut, SUM(token_tank) AS token_tank,
    SUM(tecken) AS tecken, CAST(AVG(ms) AS INTEGER) AS ms
  FROM ai_anrop WHERE dag >= ? GROUP BY dag, funktion, modell ORDER BY dag DESC, funktion`).all(fran);

/* Dollar, eller null om priset saknas */
function kostnad(r) {
  const p = priser[r.modell];
  if (!p || p.in == null || p.ut == null) return null;
  return ((r.token_in - r.token_cache) * p.in + r.token_cache * (p.cache ?? p.in) + r.token_ut * p.ut) / 1e6;
}
const dollar = v => (v == null ? "pris saknas" : `$${v.toFixed(4)}`);

if (!rader.length) { console.log(`Inga anrop sedan ${fran}.`); process.exit(0); }
console.table(rader.map(r => ({
  dag: r.dag, funktion: r.funktion, modell: r.modell, anrop: r.anrop, fel: r.fel, studenter: r.studenter,
  "token in": r.token_in, "varav cache": r.token_cache, "token ut": r.token_ut, "varav tänkande": r.token_tank,
  ...(r.tecken ? { tecken: r.tecken } : {}), "ms i snitt": r.ms, kostnad: dollar(kostnad(r)),
})));

const perFunktion = {};
for (const r of rader) {
  const f = (perFunktion[r.funktion] ||= { anrop: 0, kostnad: 0, saknas: false });
  f.anrop += r.anrop;
  const k = kostnad(r);
  if (k == null) f.saknas = true; else f.kostnad += k;
}
console.log(`\nSumma per funktion sedan ${fran}:`);
console.table(Object.fromEntries(Object.entries(perFunktion).map(([f, v]) =>
  [f, { anrop: v.anrop, kostnad: v.saknas && !v.kostnad ? "pris saknas" : dollar(v.kostnad) + (v.saknas ? " (pris saknas för någon modell)" : "") }])));
