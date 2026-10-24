/*
  StudFun 1.0, server.
  Node utan paket utifrån. Kräver Node 22.5 eller senare (inbyggd SQLite).

  Starta:   npm start          (eller: node --experimental-sqlite server.js)
  Testa:    npm test

  Inställningar (miljövariabler):
    PORT=8788
    HOST=127.0.0.1               lyssnar bara lokalt. Proxy eller Funnel framför sköter resten.
    APP_ORIGIN=http://localhost:8788   StudFuns egen adress. Ändrande anrop från andra adresser nekas.
                                 Sätts alltid på servern. Utan den godtas bara localhost, 127.0.0.1 och [::1].
    DATA_DIR=./data              databasen och PDF:erna. Ska bara kunna läsas av StudFuns användare.
    TRUST_PROXY=1                läs studentens adress från X-Forwarded-For (bara bakom egen proxy)
    OPENAI_API_KEY=sk-...        stannar på servern. Utan den blir uppladdade filer aldrig klara för Tudi.
    OPENAI_BASE=https://api.openai.com
    MODEL_*, EFFORT_*, TTS_MOTOR  modell och tänkande för varje AI-funktion. Se .env.example.

  Finns en fil .env bredvid server.js läses den först. Det som redan står i miljön går före filen.
*/
const http = require("http");
const fs = require("fs");
const path = require("path");
try { process.loadEnvFile(path.join(__dirname, ".env")); } catch (e) { if (e.code !== "ENOENT") throw e; }
const { oppna } = require("./db");

const PORT = Number(process.env.PORT || 8788);
const CONFIG = {
  port: PORT,
  host: process.env.HOST || "127.0.0.1",
  origin: process.env.APP_ORIGIN || `http://localhost:${PORT}`,
  /* Utan APP_ORIGIN körs appen lokalt, och då är localhost, 127.0.0.1 och [::1] samma dator */
  tillatna: process.env.APP_ORIGIN ? [process.env.APP_ORIGIN] : ["localhost", "127.0.0.1", "[::1]"].map(v => `http://${v}:${PORT}`),
  dataDir: process.env.DATA_DIR || path.join(__dirname, "data"),
  trustProxy: process.env.TRUST_PROXY === "1",
  openaiKey: process.env.OPENAI_API_KEY || "",
  openaiBase: process.env.OPENAI_BASE || "https://api.openai.com",
  vektorDim: 512, // räcker för sökningen och gör den lätt nog för en liten server
};
/* Modell, tänkande och tak för svarslängd för varje AI-funktion. Modell och tänkande går att byta i .env utan ny kod.
   Tomt tänkande (EFFORT_X=) skickar inget tänkande alls, för modeller som inte tänker. */
const modell = (namn, standard) => process.env[namn] || standard;
const tank = (namn, standard) => process.env[namn] ?? standard;
CONFIG.ai = {
  ord: { modell: modell("MODEL_ORD", "gpt-6-luna"), effort: tank("EFFORT_ORD", "none"), maxUt: 150 },
  sida: { modell: modell("MODEL_SIDA", "gpt-6-luna"), effort: tank("EFFORT_SIDA", "none"), igen: tank("EFFORT_SIDA_IGEN", "low"), maxUt: 600 },
  chatt: { modell: modell("MODEL_CHATT", "gpt-6-luna"), effort: tank("EFFORT_CHATT", "low"), maxUt: 800 },
  sammanfattning: { modell: modell("MODEL_SAMMANFATTNING", "gpt-5-nano"), effort: tank("EFFORT_SAMMANFATTNING", "minimal"), maxUt: 400 },
  borja: { modell: modell("MODEL_BORJA", "gpt-6-luna"), effort: tank("EFFORT_BORJA", "none"), maxUt: 600 },
  ova: { modell: modell("MODEL_OVA", "gpt-6-luna"), effort: tank("EFFORT_OVA", "low"), maxUt: 2000 },
  ratta: { modell: modell("MODEL_RATTA", "gpt-6-luna"), effort: tank("EFFORT_RATTA", "low"), maxUt: 150 },
  embed: { modell: modell("MODEL_EMBED", "text-embedding-3-small") }, // byts den måste alla filer laddas upp igen
  tal: { modell: modell("MODEL_TAL", "gpt-4o-mini-transcribe") },
  tts: { motor: modell("TTS_MOTOR", "openai"), modell: modell("MODEL_TTS", "gpt-4o-mini-tts") },
};
CONFIG.pdfDir = path.join(CONFIG.dataDir, "pdf");
CONFIG.ttsDir = path.join(CONFIG.dataDir, "upplasning"); // sparat ljud, en mapp per fil
fs.mkdirSync(CONFIG.pdfDir, { recursive: true, mode: 0o700 });
fs.mkdirSync(CONFIG.ttsDir, { recursive: true, mode: 0o700 });

const PUBLIC = path.join(__dirname, "public");
const db = oppna(CONFIG.dataDir);

const SAKERHET = {
  "Content-Security-Policy": [
    "default-src 'self'", "script-src 'self' 'wasm-unsafe-eval'", "style-src 'self'", "img-src 'self' data: blob:",
    "font-src 'self'", "connect-src 'self'", "media-src 'self' blob:", "worker-src 'self' blob:", "object-src 'none'",
    "base-uri 'none'", "form-action 'self'", "frame-ancestors 'none'",
  ].join("; "),
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "same-origin",
  "Cross-Origin-Opener-Policy": "same-origin",
  "Permissions-Policy": "camera=(), geolocation=(), payment=()",
};
if (CONFIG.origin.startsWith("https:")) SAKERHET["Strict-Transport-Security"] = "max-age=31536000";
CONFIG.sakerhet = SAKERHET;

const TYPER = {
  ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".png": "image/png", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".txt": "text/plain; charset=utf-8",
  /* pdf.js */
  ".mjs": "text/javascript; charset=utf-8", ".bcmap": "application/octet-stream", ".pfb": "application/octet-stream",
  ".ttf": "font/ttf", ".wasm": "application/wasm",
};

/* Ett fel som är menat för studenten. Andra fel visas aldrig med detaljer. */
class Fel extends Error {
  constructor(status, text) { super(text); this.status = status; }
}

/* Rutterna. :namn i mönstret matchar bara siffror, så id:n kan aldrig vara text.
   ra: rutten tar emot en fil av den typen i stället för JSON. */
const rutter = [];
function rutt(metod, monster, fn, val = {}) {
  const re = new RegExp("^" + monster.replace(/:(\w+)/g, "(?<$1>\\d+)") + "$");
  rutter.push({ metod, monster, re, fn, oppen: !!val.oppen, ra: val.ra, maxBody: val.maxBody || 64 * 1024 });
}

function lasBody(req, max) {
  return new Promise((resolve, reject) => {
    if (Number(req.headers["content-length"] || 0) > max) return reject(new Fel(413, "Anropet är för stort."));
    const delar = []; let storlek = 0;
    req.on("data", d => {
      storlek += d.length;
      if (storlek > max) { reject(new Fel(413, "Anropet är för stort.")); req.destroy(); return; }
      delar.push(d);
    });
    req.on("end", () => resolve(Buffer.concat(delar)));
    req.on("error", reject);
  });
}

async function lasJson(req, max) {
  const ra = await lasBody(req, max);
  if (ra.length === 0) return {};
  if (!String(req.headers["content-type"] || "").startsWith("application/json")) throw new Fel(415, "Fel sorts anrop.");
  try {
    const v = JSON.parse(ra.toString("utf8"));
    if (!v || typeof v !== "object" || Array.isArray(v)) throw 0;
    return v;
  } catch { throw new Fel(400, "Anropet gick inte att läsa."); }
}

function skicka(res, status, data, extra = {}) {
  res.writeHead(status, { ...SAKERHET, "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...extra });
  res.end(JSON.stringify(data ?? {}));
}

function ip(req) {
  if (CONFIG.trustProxy && req.headers["x-forwarded-for"]) return String(req.headers["x-forwarded-for"]).split(",")[0].trim();
  return req.socket.remoteAddress || "";
}

/* Tar bort en fils PDF och dess sparade uppläsning från disken.
   Namnet kontrolleras, så att inget utanför mapparna kan raderas. */
function raderaPdf({ id, fil }) {
  if (/^[a-f0-9]{32}\.pdf$/.test(fil)) fs.rmSync(path.join(CONFIG.pdfDir, fil), { force: true });
  if (Number.isInteger(id)) fs.rmSync(path.join(CONFIG.ttsDir, String(id)), { recursive: true, force: true });
}

const delar = { db, CONFIG, Fel, rutt, raderaPdf };
delar.ai = require("./ai")(delar);
const konto = require("./konto")(delar);
delar.konto = konto;
require("./kurser")(delar);
require("./dokument")(delar);
require("./upplasning")(delar);
require("./tudi")(delar);
require("./forklara")(delar);
require("./borja")(delar);
require("./ova")(delar);
require("./nasta")(delar);

async function api(req, res, url) {
  /* Anrop som ändrar något godtas bara från StudFuns egen adress */
  if (req.method !== "GET" && req.method !== "HEAD" && !CONFIG.tillatna.includes(req.headers.origin)) {
    console.error(`[sf] ${req.method} ${url.pathname.replace(/\d+/g, ":id")} nekad: fel Origin`);
    return skicka(res, 403, { fel: "Anropet nekades." });
  }
  const traffar = rutter.filter(r => r.re.test(url.pathname));
  if (!traffar.length) return skicka(res, 404, { fel: "Finns inte." });
  const r = traffar.find(r => r.metod === req.method);
  if (!r) return skicka(res, 405, { fel: "Finns inte." });

  const ctx = { req, res, ip: ip(req), params: {}, status: 200, headers: {}, user: konto.inloggad(req) };
  try {
    if (!r.oppen && !ctx.user) throw new Fel(401, "Du behöver logga in.");
    for (const [k, v] of Object.entries(r.re.exec(url.pathname).groups || {})) ctx.params[k] = Number(v);
    if (req.method === "GET") ctx.body = {};
    else if (r.ra) {
      if (!String(req.headers["content-type"] || "").startsWith(r.ra)) throw new Fel(415, "Fel sorts fil.");
      ctx.body = await lasBody(req, r.maxBody);
    } else ctx.body = await lasJson(req, r.maxBody);
    const data = await r.fn(ctx);
    if (!res.headersSent) skicka(res, ctx.status, data, ctx.headers);
    console.log(`[sf] ${req.method} ${r.monster} ${ctx.status} u=${ctx.user ? ctx.user.id : "-"}`);
  } catch (e) {
    const status = e instanceof Fel ? e.status : 500;
    /* bara rutt, id och felkod i loggen, aldrig text från studenten */
    console.error(`[sf] ${req.method} ${r.monster} ${status} u=${ctx.user ? ctx.user.id : "-"}${status === 500 ? " " + (e.code || e.name) : ""}`);
    if (!res.headersSent) skicka(res, status, { fel: status === 500 ? "Något gick fel. Försök igen om en stund." : e.message }, ctx.headers);
    else res.destroy();
  }
}

async function statisk(req, res, url) {
  let fil;
  if (path.extname(url.pathname)) {
    fil = path.join(PUBLIC, path.normalize(decodeURIComponent(url.pathname)));
    if (!fil.startsWith(PUBLIC + path.sep)) fil = null;
  } else {
    fil = path.join(PUBLIC, "index.html"); // appens egna adresser, som /installningar
  }
  const typ = fil && TYPER[path.extname(fil)];
  let innehall;
  try { innehall = typ && await fs.promises.readFile(fil); } catch { innehall = null; }
  if (!innehall) {
    res.writeHead(404, { ...SAKERHET, "Content-Type": "text/plain; charset=utf-8" });
    return res.end("Finns inte.");
  }
  const lange = /\.(woff2|png)$/.test(fil) || fil.includes(`${path.sep}vendor${path.sep}`); // vendor har versionen i mappnamnet
  res.writeHead(200, { ...SAKERHET, "Content-Type": typ, "Cache-Control": lange ? "public, max-age=604800" : "no-cache" });
  res.end(req.method === "HEAD" ? undefined : innehall);
}

const server = http.createServer(async (req, res) => {
  let url;
  try { url = new URL(req.url, "http://x"); decodeURIComponent(url.pathname); }
  catch { res.writeHead(400, SAKERHET); return res.end(); }
  if (url.pathname.startsWith("/api/")) return api(req, res, url);
  if (req.method !== "GET" && req.method !== "HEAD") { res.writeHead(405, SAKERHET); return res.end(); }
  return statisk(req, res, url);
});
server.requestTimeout = 10 * 60_000; // en PDF på 50 MB över en långsam uppkoppling

server.listen(CONFIG.port, CONFIG.host, () => {
  console.log(`StudFun 1.0 på http://${CONFIG.host}:${CONFIG.port}  (adress ${CONFIG.origin})`);
});
