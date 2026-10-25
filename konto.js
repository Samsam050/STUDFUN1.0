/*
  Konto, inloggning, inställningar och radering.
  Lösenord hashas med scrypt. Inloggningen är en slumpad kaka som skript inte kan läsa.
  I databasen sparas bara en hash av kakan, så en läckt databas ger inga inloggningar.
*/
const crypto = require("crypto");
const { promisify } = require("util");
const { transaktion } = require("./db");
const scrypt = promisify(crypto.scrypt);

const SESSION_TID = 30 * 24 * 3600 * 1000;
const GODKANNANDE_VERSION = "2026-10-24";
const LOSEN_MIN = 10, LOSEN_MAX = 200;
const TYPSNITT = ["lexend", "atkinson"];
const TEMPON = ["langsamt", "normalt", "snabbt"];
const ROSTER = ["marin", "cedar", "shimmer"]; // Röst 1, 2 och 3 i Inställningar

/* Gränser för försök. shortcut: räknas i minnet och nollas vid omstart, byt till databasen om servern startas om ofta. */
const FONSTER = 15 * 60 * 1000;
/* Per adress är taket högt, eftersom en hel skola kan dela adress bakom samma nätverk */
const MAX_FEL_PER_MEJL = 10, MAX_FEL_PER_IP = 100, MAX_NYA_PER_IP = 50;
const forsok = new Map();
function antal(nyckel) {
  const nu = Date.now();
  const t = (forsok.get(nyckel) || []).filter(x => nu - x < FONSTER);
  if (t.length) forsok.set(nyckel, t); else forsok.delete(nyckel);
  return t.length;
}
function notera(nyckel) { antal(nyckel); forsok.set(nyckel, [...(forsok.get(nyckel) || []), Date.now()]); }

const SCRYPT = { N: 16384, r: 8, p: 1 };
async function hasha(losen) {
  const salt = crypto.randomBytes(16);
  const h = await scrypt(losen, salt, 64, SCRYPT);
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString("base64")}$${h.toString("base64")}`;
}
async function stammer(losen, lagrad) {
  const [, N, r, p, salt, h] = lagrad.split("$");
  const facit = Buffer.from(h, "base64");
  const test = await scrypt(losen, Buffer.from(salt, "base64"), facit.length, { N: +N, r: +r, p: +p });
  return crypto.timingSafeEqual(test, facit);
}

const sha = s => crypto.createHash("sha256").update(s).digest("hex");
const mejlOk = m => typeof m === "string" && m.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(m);

module.exports = function ({ db, CONFIG, Fel, rutt, raderaPdf }) {
  /* På servern (https) är kakan Secure och heter __Host-sf, så att den bara skickas krypterat och inte kan sättas av en underdomän.
     Lokalt på http går det inte: Safari sparar inte Secure-kakor på http, inte ens på localhost. */
  const HTTPS = CONFIG.origin.startsWith("https:");
  const KAKA = HTTPS ? "__Host-sf" : "sf";
  /* Används för okända mejladresser, så att svaret tar lika lång tid som för riktiga konton */
  const attrapp = hasha(crypto.randomBytes(16).toString("hex"));

  function kaka(ctx, varde, maxAge) {
    ctx.headers["Set-Cookie"] = `${KAKA}=${varde}; Path=/; HttpOnly;${HTTPS ? " Secure;" : ""} SameSite=Lax; Max-Age=${maxAge}`;
  }
  function loggaIn(ctx, userId) {
    const token = crypto.randomBytes(32).toString("base64url");
    db.prepare("INSERT INTO sessions (id, user_id, gar_ut) VALUES (?, ?, ?)").run(sha(token), userId, Date.now() + SESSION_TID);
    kaka(ctx, token, SESSION_TID / 1000);
  }
  function token(req) {
    for (const del of String(req.headers.cookie || "").split(";")) {
      const [k, ...v] = del.trim().split("=");
      if (k === KAKA) return v.join("=");
    }
    return null;
  }
  function inloggad(req) {
    const t = token(req);
    if (!t) return null;
    const rad = db.prepare("SELECT u.id, u.mejl FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id = ? AND s.gar_ut > ?").get(sha(t), Date.now());
    return rad ? { id: rad.id, mejl: rad.mejl } : null;
  }

  function raderaFiler(userId) {
    for (const d of db.prepare("SELECT id, fil FROM documents WHERE user_id = ?").all(userId)) raderaPdf(d);
  }

  function installningar(userId) {
    const s = db.prepare("SELECT typsnitt, rost, tempo FROM settings WHERE user_id = ?").get(userId);
    return { typsnitt: s.typsnitt, rost: s.rost || ROSTER[0], tempo: s.tempo };
  }

  rutt("POST", "/api/konto", async ctx => {
    const mejl = String(ctx.body.mejl || "").trim().toLowerCase();
    const losen = ctx.body.losen;
    if (ctx.body.godkant !== true) throw new Fel(400, "Kryssa i rutan för att kunna skapa ett konto.");
    if (!mejlOk(mejl)) throw new Fel(400, "Skriv en mejladress, till exempel namn@exempel.se.");
    if (typeof losen !== "string" || losen.length < LOSEN_MIN) throw new Fel(400, "Lösenordet behöver minst 10 tecken.");
    if (losen.length > LOSEN_MAX) throw new Fel(400, "Lösenordet får vara högst 200 tecken.");
    if (antal("ny:" + ctx.ip) >= MAX_NYA_PER_IP) throw new Fel(429, "För många nya konton på kort tid. Vänta 15 minuter och försök igen.");
    notera("ny:" + ctx.ip);
    const hash = await hasha(losen);
    const nu = Date.now();
    let id;
    try {
      id = transaktion(db, () => {
        const r = db.prepare("INSERT INTO users (mejl, losen_hash, skapad, godkant_tid, godkant_version) VALUES (?, ?, ?, ?, ?)")
          .run(mejl, hash, nu, nu, GODKANNANDE_VERSION);
        db.prepare("INSERT INTO settings (user_id) VALUES (?)").run(r.lastInsertRowid);
        return Number(r.lastInsertRowid);
      });
    } catch (e) {
      if (String(e.message).includes("UNIQUE")) throw new Fel(409, "Det finns redan ett konto med den mejladressen. Logga in istället.");
      throw e;
    }
    loggaIn(ctx, id);
    ctx.status = 201;
    return { mejl, installningar: installningar(id) };
  }, { oppen: true });

  rutt("POST", "/api/logga-in", async ctx => {
    const mejl = String(ctx.body.mejl || "").trim().toLowerCase();
    const losen = typeof ctx.body.losen === "string" ? ctx.body.losen.slice(0, LOSEN_MAX) : "";
    if (antal("mejl:" + mejl) >= MAX_FEL_PER_MEJL || antal("ip:" + ctx.ip) >= MAX_FEL_PER_IP) {
      throw new Fel(429, "För många försök. Vänta 15 minuter och försök igen.");
    }
    const user = db.prepare("SELECT id, losen_hash FROM users WHERE mejl = ?").get(mejl);
    const ok = await stammer(losen, user ? user.losen_hash : await attrapp) && !!user;
    if (!ok) {
      notera("mejl:" + mejl); notera("ip:" + ctx.ip);
      throw new Fel(401, "Mejladressen eller lösenordet stämmer inte. Kontrollera och försök igen.");
    }
    forsok.delete("mejl:" + mejl);
    loggaIn(ctx, user.id);
    return { mejl, installningar: installningar(user.id) };
  }, { oppen: true });

  rutt("POST", "/api/logga-ut", ctx => {
    const t = token(ctx.req);
    if (t) db.prepare("DELETE FROM sessions WHERE id = ?").run(sha(t));
    kaka(ctx, "", 0);
    return {};
  }, { oppen: true });

  rutt("GET", "/api/jag", ctx => ({ mejl: ctx.user.mejl, installningar: installningar(ctx.user.id) }));

  rutt("PUT", "/api/installningar", ctx => {
    const b = ctx.body;
    if (b.typsnitt !== undefined && !TYPSNITT.includes(b.typsnitt)) throw new Fel(400, "Det typsnittet finns inte.");
    if (b.tempo !== undefined && !TEMPON.includes(b.tempo)) throw new Fel(400, "Det tempot finns inte.");
    if (b.rost !== undefined && !ROSTER.includes(b.rost)) throw new Fel(400, "Den rösten finns inte.");
    db.prepare("UPDATE settings SET typsnitt = COALESCE(?, typsnitt), tempo = COALESCE(?, tempo), rost = COALESCE(?, rost) WHERE user_id = ?")
      .run(b.typsnitt ?? null, b.tempo ?? null, b.rost ?? null, ctx.user.id);
    return installningar(ctx.user.id);
  });

  /* Allt material i alla kurser. Kurserna finns kvar. */
  rutt("POST", "/api/radera-material", ctx => {
    raderaFiler(ctx.user.id);
    transaktion(db, () => {
      for (const t of ["attempts", "cards", "messages", "chunks", "documents"]) {
        db.prepare(`DELETE FROM ${t} WHERE user_id = ?`).run(ctx.user.id);
      }
    });
    console.log(`[sf] material raderat u=${ctx.user.id}`);
    return {};
  });

  rutt("DELETE", "/api/konto", ctx => {
    const id = ctx.user.id;
    raderaFiler(id);
    db.prepare("DELETE FROM users WHERE id = ?").run(id); // resten raderas via ON DELETE CASCADE
    db.exec("PRAGMA wal_checkpoint(TRUNCATE)"); // så att raderade rader inte ligger kvar i WAL-filen
    kaka(ctx, "", 0);
    console.log(`[sf] konto raderat u=${id}`);
    return {};
  });

  /* Städar bort gamla sessioner och försök en gång i timmen */
  setInterval(() => {
    db.prepare("DELETE FROM sessions WHERE gar_ut <= ?").run(Date.now());
    for (const k of forsok.keys()) antal(k);
  }, 3600 * 1000).unref();

  return { inloggad, installningar, ROSTER };
};
