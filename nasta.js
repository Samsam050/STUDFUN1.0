/*
  Nästa steg på startsidan, och repetition av det studenten svarade fel på.
  En enkel regel, ingen AI. I den här ordningen:
    1. quizfrågor som studenten senast svarade fel på
    2. flashcards som studenten senast inte kunde
    3. en PDF som studenten har börjat läsa
    4. en ny PDF som är klar
    5. allt är läst och inget är fel: öva på det
    6. en kurs utan material: ladda upp
  Bygger bara på studentens egna svar och läsning.
*/
const MAX_REPETERA = 10;
const TYPER = { quiz: ["flerval", "kort"], flashcards: ["flashcard"] };

/* Frågor vars senaste svar var fel. Senast felsvarade först. */
const FEL = `FROM cards c JOIN attempts a ON a.card_id = c.id
  WHERE c.user_id = ? AND a.id = (SELECT MAX(id) FROM attempts WHERE card_id = c.id) AND a.ratt = 0`;
const iTyper = typer => `c.typ IN (${typer.map(() => "?").join(", ")})`;

module.exports = function ({ db, Fel, rutt }) {
  rutt("GET", "/api/nasta-steg", ctx => {
    const uid = ctx.user.id;
    for (const typ of ["quiz", "flashcards"]) {
      const r = db.prepare(`SELECT c.course_id, COUNT(*) AS antal, MAX(a.tid) AS tid ${FEL} AND ${iTyper(TYPER[typ])}
        GROUP BY c.course_id ORDER BY tid DESC LIMIT 1`).get(uid, ...TYPER[typ]);
      if (r) return { typ: typ === "quiz" ? "repetera" : "repeteraKort", kursId: r.course_id, kurs: kursNamn(uid, r.course_id), antal: Math.min(r.antal, MAX_REPETERA), lasa: paborjad(uid) };
    }
    const p = paborjad(uid);
    if (p) return { typ: "fortsatt", ...p };
    const ny = db.prepare(`SELECT d.id, d.titel, d.course_id, c.namn FROM documents d JOIN courses c ON c.id = d.course_id
      WHERE d.user_id = ? AND d.status = 'klar' AND d.senast_last IS NULL ORDER BY d.skapad DESC LIMIT 1`).get(uid);
    if (ny) return { typ: "borja", kursId: ny.course_id, kurs: ny.namn, dokId: ny.id, titel: ny.titel, sida: 1 };
    const last = db.prepare(`SELECT d.course_id, c.namn FROM documents d JOIN courses c ON c.id = d.course_id
      WHERE d.user_id = ? AND d.status = 'klar' ORDER BY d.senast_last DESC LIMIT 1`).get(uid);
    if (last) return { typ: "ova", kursId: last.course_id, kurs: last.namn };
    const kurs = db.prepare("SELECT id, namn FROM courses WHERE user_id = ? ORDER BY skapad DESC, id DESC LIMIT 1").get(uid);
    if (kurs) return { typ: "laddaUpp", kursId: kurs.id, kurs: kurs.namn };
    return { typ: "ingen" };
  });

  /* Frågorna att repetera i en kurs. Quizfrågor skickas utan facit, flashcards med baksidan. */
  for (const typ of Object.keys(TYPER)) {
    rutt("GET", `/api/kurser/:kursId/repetera-${typ}`, ctx => {
      const uid = ctx.user.id;
      if (!db.prepare("SELECT 1 FROM courses WHERE id = ? AND user_id = ?").get(ctx.params.kursId, uid)) throw new Fel(404, "Kursen finns inte.");
      const kort = db.prepare(`SELECT c.* ${FEL} AND c.course_id = ? AND ${iTyper(TYPER[typ])} ORDER BY a.tid DESC LIMIT ?`)
        .all(uid, ctx.params.kursId, ...TYPER[typ], MAX_REPETERA);
      return { kort: kort.map(k => ({ id: k.id, typ: k.typ, fraga: k.fraga, alternativ: JSON.parse(k.alternativ), sida: k.kalla_sida, dokId: k.document_id, ...(typ === "flashcards" ? { svar: k.svar } : {}) })) };
    });
  }

  const kursNamn = (uid, kursId) => db.prepare("SELECT namn FROM courses WHERE id = ? AND user_id = ?").get(kursId, uid).namn;
  /* Filen studenten senast läste i, om den inte är utläst */
  function paborjad(uid) {
    const d = db.prepare(`SELECT d.id, d.titel, d.course_id, d.senast_sida, c.namn FROM documents d JOIN courses c ON c.id = d.course_id
      WHERE d.user_id = ? AND d.status != 'vantar_fil' AND d.senast_last IS NOT NULL AND d.senast_sida < d.sidor ORDER BY d.senast_last DESC LIMIT 1`).get(uid);
    return d ? { kursId: d.course_id, kurs: d.namn, dokId: d.id, titel: d.titel, sida: d.senast_sida } : null;
  }
};
