/*
  Kurser: skapa, lista, byta namn och termin, radera.
  Varje fråga har "AND user_id = ?" med id:t från inloggningen. En kurs som tillhör
  någon annan finns inte, ur studentens synvinkel, och ger 404.
*/
const { transaktion } = require("./db");

const MAX_KURSER = 50;
const NAMN_MAX = 100;
const TERMIN = /^(HT|VT) \d{4}$/;

const URVAL = `SELECT c.id, c.namn, c.termin,
  (SELECT COUNT(*) FROM documents d WHERE d.course_id = c.id AND d.user_id = c.user_id) AS antal_pdf,
  (SELECT COUNT(*) FROM documents d WHERE d.course_id = c.id AND d.user_id = c.user_id AND d.status = 'bearbetas') AS bearbetas,
  (SELECT json_object('dokId', d.id, 'titel', d.titel, 'sida', d.senast_sida) FROM documents d
    WHERE d.course_id = c.id AND d.user_id = c.user_id AND d.senast_last IS NOT NULL ORDER BY d.senast_last DESC LIMIT 1) AS senast
  FROM courses c`;
/* senast: filen studenten senast läste i kursen, för Du läste senast och Fortsätt läsa */
const svar = k => ({ id: k.id, namn: k.namn, termin: k.termin, antalPdf: k.antal_pdf, bearbetas: k.bearbetas, senast: k.senast ? JSON.parse(k.senast) : null });

module.exports = function ({ db, Fel, rutt, raderaPdf }) {
  function las(body) {
    const namn = typeof body.namn === "string" ? body.namn.trim() : "";
    const termin = typeof body.termin === "string" ? body.termin.trim() : "";
    if (!namn) throw new Fel(400, "Skriv ett namn på kursen.");
    if (namn.length > NAMN_MAX) throw new Fel(400, "Namnet får vara högst 100 tecken.");
    if (termin && !TERMIN.test(termin)) throw new Fel(400, "Välj en termin i listan.");
    return { namn, termin };
  }

  function kurs(userId, id) {
    const k = db.prepare(`${URVAL} WHERE c.id = ? AND c.user_id = ?`).get(id, userId);
    if (!k) throw new Fel(404, "Kursen finns inte.");
    return svar(k);
  }

  rutt("GET", "/api/kurser", ctx => ({
    kurser: db.prepare(`${URVAL} WHERE c.user_id = ? ORDER BY c.skapad DESC, c.id DESC`).all(ctx.user.id).map(svar),
  }));

  rutt("POST", "/api/kurser", ctx => {
    const { namn, termin } = las(ctx.body);
    const antal = db.prepare("SELECT COUNT(*) AS n FROM courses WHERE user_id = ?").get(ctx.user.id).n;
    if (antal >= MAX_KURSER) throw new Fel(400, `Du kan ha högst ${MAX_KURSER} kurser. Radera en kurs du inte använder.`);
    const r = db.prepare("INSERT INTO courses (user_id, namn, termin, skapad) VALUES (?, ?, ?, ?)").run(ctx.user.id, namn, termin, Date.now());
    ctx.status = 201;
    return kurs(ctx.user.id, Number(r.lastInsertRowid));
  });

  rutt("GET", "/api/kurser/:id", ctx => kurs(ctx.user.id, ctx.params.id));

  rutt("PUT", "/api/kurser/:id", ctx => {
    const { namn, termin } = las(ctx.body);
    const r = db.prepare("UPDATE courses SET namn = ?, termin = ? WHERE id = ? AND user_id = ?").run(namn, termin, ctx.params.id, ctx.user.id);
    if (r.changes === 0) throw new Fel(404, "Kursen finns inte.");
    return kurs(ctx.user.id, ctx.params.id);
  });

  /* Kursen och allt i den: PDF:erna på disken, och via ON DELETE CASCADE texten, sökindexet, chatten, korten och svaren */
  rutt("DELETE", "/api/kurser/:id", ctx => {
    kurs(ctx.user.id, ctx.params.id);
    for (const d of db.prepare("SELECT id, fil FROM documents WHERE course_id = ? AND user_id = ?").all(ctx.params.id, ctx.user.id)) raderaPdf(d);
    transaktion(db, () => db.prepare("DELETE FROM courses WHERE id = ? AND user_id = ?").run(ctx.params.id, ctx.user.id));
    console.log(`[sf] kurs raderad u=${ctx.user.id} k=${ctx.params.id}`);
    return {};
  });
};
