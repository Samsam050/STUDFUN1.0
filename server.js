/*
  StudFun 1.0, server.
  Node utan paket utifrån. Kräver Node 22.5 eller senare (inbyggd SQLite).

  Starta:   npm start          (eller: node --experimental-sqlite server.js)
  Testa:    npm test

  Inställningar (miljövariabler):
    PORT=8788
    HOST=127.0.0.1               lyssnar bara lokalt. Proxy eller Funnel framför sköter resten.
    APP_ORIGIN=http://localhost:8788   StudFuns egen adress. Ändrande anrop från andra adresser nekas.
    DATA_DIR=./data              databasen och PDF:erna. Ska bara kunna läsas av StudFuns användare.
    TRUST_PROXY=1                läs studentens adress från X-Forwarded-For (bara bakom egen proxy)
    OPENAI_API_KEY=sk-...        stannar på servern. Utan den blir uppladdade filer aldrig klara för Tudi.
    OPENAI_BASE=https://api.openai.com
    VEKTOR_MODELL=text-embedding-3-small
*/
const http = require("http");
const fs = require("fs");
const path = require("path");
const { oppna } = require("./db");

const PORT = Number(process.env.PORT || 8788);
const CONFIG = {
  port: PORT,
  host: process.env.HOST || "127.0.0.1",
  origin: process.env.APP_ORIGIN || `http://localhost:${PORT}`,
  dataDir: process.env.DATA_DIR || path.join(__dirname, "data"),
  trustProxy: process.env.TRUST_PROXY === "1",
  openaiKey: process.env.OPENAI_API_KEY || "",
  openaiBase: process.env.OPENAI_BASE || "https://api.openai.com",
  vektorModell: process.env.VEKTOR_MODELL || "text-embedding-3-small",
};
CONFIG.pdfDir = path.join(CONFIG.dataDir, "pdf");
fs.mkdirSync(CONFIG.pdfDir, { recursive: true, mode: 0o700 });

const PUBLIC = path.join(__dirname, "public");
const db = oppna(CONFIG.dataDir);

const SAKERHET = {
  "Content-Security-Policy": [
    "default-src 'self'", "script-src 'self'", "style-src 'self'", "img-src 'self' data: blob:",
    "font-src 'self'", "connect-src 'self'", "worker-src 'self' blob:", "object-src 'none'",
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

/* Tar bort en PDF från disken. Namnet kontrolleras, så att inget utanför mappen kan raderas. */
function raderaPdf(fil) {
  if (/^[a-f0-9]{32}\.pdf$/.test(fil)) fs.rmSync(path.join(CONFIG.pdfDir, fil), { force: true });
}

const delar = { db, CONFIG, Fel, rutt, raderaPdf };
const konto = require("./konto")(delar);
require("./kurser")(delar);
require("./dokument")(delar);

async function api(req, res, url) {
  /* Anrop som ändrar något godtas bara från StudFuns egen adress */
  if (req.method !== "GET" && req.method !== "HEAD" && req.headers.origin !== CONFIG.origin) {
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
