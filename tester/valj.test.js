/* Nano sorterar frågorna i chatten, och Luna får bara det material som behövs.
   Servern körs med MAX_TOKEN_HELA=60, så att "Lång bok" räknas som lång och "Kort text" som kort.
   Kör: npm test */
const { test, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const { DatabaseSync } = require("node:sqlite");
const { startaServer, falskOpenAI, inneText } = require("./hjalp");

let s, oa, a, kurs, kort, lang;
const PDF = Buffer.from("%PDF-1.4\n%%EOF\n");
const BILD = "data:image/jpeg;base64," + Buffer.from("låtsasbild").toString("base64");
const LANG = [1, 2, 3].map(n => `Sida ${n} i den långa boken. Ett anbud är ett erbjudande om att ingå ett avtal, och det gäller en viss tid. Ett ja kallas accept.`);

async function laddaUpp(kaka, kursId, sidor, titel) {
  const id = (await s.anrop("POST", `/api/kurser/${kursId}/dokument`, { kaka, data: { titel, sidor } })).json.id;
  await s.anrop("PUT", `/api/dokument/${id}/fil`, { kaka, ra: PDF, headers: { "content-type": "application/pdf" } });
  for (let i = 0; i < 100; i++) {
    if ((await s.anrop("GET", `/api/dokument/${id}`, { kaka })).json.status === "klar") return id;
    await new Promise(r => setTimeout(r, 50));
  }
  throw new Error("blev aldrig klar");
}
const fraga = data => s.anrop("POST", `/api/kurser/${kurs}/fraga`, { kaka: a, data });
const nano = () => oa.anrop.filter(x => x.json?.text?.format?.name === "val");
const luna = () => oa.anrop.filter(x => x.url === "/v1/responses" && !x.json.text?.format);
/* Låt nano välja typ (och dokument och sidor) för nästa fråga */
const valjer = (typ, dokument_id = "", sidor = []) => {
  oa.svar = json => (json.text?.format?.name === "val" ? { typ, dokument_id: String(dokument_id), sidor } : undefined);
};

before(async () => {
  oa = await falskOpenAI();
  s = await startaServer({ OPENAI_API_KEY: "test-nyckel", OPENAI_BASE: oa.bas, MAX_TOKEN_HELA: "60" });
  a = await s.nyttKonto("a@exempel.se");
  kurs = (await s.anrop("POST", "/api/kurser", { kaka: a, data: { namn: "Civilrätt" } })).json.id;
  kort = await laddaUpp(a, kurs, ["Kort text om skadestånd."], "Kort text");
  lang = await laddaUpp(a, kurs, LANG, "Lång bok");
});
after(() => { s.stang(); oa.stang(); });
beforeEach(() => { oa.anrop.length = 0; oa.svar = null; oa.felOm = null; });

test("nano får dokumentlistan, sidan som är öppen och frågan, med gpt-5-nano och minimal", async () => {
  valjer("specifik");
  await fraga({ fraga: "Vad är ett anbud?", sida: { dokId: lang, nr: 2 } });
  const [x] = nano();
  assert.equal(x.json.model, "gpt-5-nano");
  assert.deepEqual(x.json.reasoning, { effort: "minimal" });
  assert.equal(x.json.store, false);
  assert.match(x.json.input[0].content, /^Du sorterar en students fråga i StudFun/);
  assert.match(x.json.input[1].content, new RegExp(`id: ${lang} \\| Lång bok \\| 3 sidor \\| typ: kursbok`));
  assert.match(x.json.input[2].content, new RegExp(`Studenten har sida 2 av 3 öppen i dokument id ${lang}\\.[\\s\\S]*Frågan:\\n<material>\\nVad är ett anbud\\?\\n</material>`));
  assert.ok(!inneText(x.json).includes("erbjudande om att ingå"), "nano får inte dokumentens text");
});

test("specifik: sidan som är öppen och utdrag, som förut", async () => {
  valjer("specifik");
  await fraga({ fraga: "Vad är en accept?", sida: { dokId: lang, nr: 1 } });
  const text = inneText(luna()[0].json);
  assert.match(text, /Sidan studenten har öppen: Lång bok, sida 1\./);
  assert.match(text, /Utdrag ur materialet som liknar frågan/);
});

test("sidan: samma förklaring som knappen, ur samma cache, och bilden används bara då", async () => {
  valjer("sidan");
  const r = await fraga({ fraga: "Jag förstår inte den här sidan", sida: { dokId: lang, nr: 3 }, bild: BILD });
  assert.equal(r.status, 200);
  assert.deepEqual(r.json.svar.meta, { typ: "sida", dokId: lang, sida: 3, bild: true, satt: null });
  const [x] = oa.anrop.filter(y => y.url === "/v1/responses" && y.json.input[0].content.includes("Förklara sidan studenten har öppen"));
  assert.ok(JSON.stringify(x.json.input).includes("input_image"));

  oa.anrop.length = 0;
  const knapp = await fraga({ forklara: true, sida: { dokId: lang, nr: 3 }, bild: BILD });
  assert.equal(knapp.json.fraga.text, "Förklara sida 3");
  assert.equal(knapp.json.svar.text, r.json.svar.text);
  assert.equal(oa.anrop.length, 0, "knappen hämtar samma förklaring ur cachen");

  valjer("specifik");
  await fraga({ fraga: "Vad är ett anbud?", sida: { dokId: lang, nr: 3 }, bild: BILD });
  assert.ok(!JSON.stringify(luna()[0].json.input).includes("input_image"), "ingen bild när frågan inte gäller sidan");
});

test("sidor: bara texten på de sidorna", async () => {
  valjer("sidor", lang, [2, 99]);
  await fraga({ fraga: "Vad står på sida 2?" });
  const text = inneText(luna()[0].json);
  assert.match(text, /Sidorna studenten frågar om, ur Lång bok:\n<material>\n\[s\. 2\]\nSida 2 i den långa boken/);
  assert.ok(!text.includes("Sida 1 i den långa boken") && !text.includes("Sida 3 i den långa boken"));
});

test("dokument: hela texten när den är kort, sammanfattningar av avsnitten när den är lång", async () => {
  valjer("dokument", kort);
  await fraga({ fraga: "Sammanfatta den korta texten" });
  assert.match(inneText(luna()[0].json), /Hela texten i Kort text \(kursbok, 1 sidor\):\n<material>\n\[s\. 1\]\nKort text om skadestånd\./);

  oa.anrop.length = 0;
  valjer("dokument", "");
  oa.svar = json => (json.text?.format?.name === "val" ? { typ: "dokument", dokument_id: "", sidor: [] } : "Boken handlar om avtal [s. 1–3]. Och [s. 2].");
  const r = await fraga({ fraga: "Vad handlar boken om?", sida: { dokId: lang, nr: 1 } });
  const text = inneText(luna()[0].json);
  assert.match(text, /Lång bok \(kursbok, 3 sidor\) är för långt för att skickas helt\. Här är sammanfattningarna av avsnitten:\n<material>\n\[s\. 1–3\] Avtal\n/);
  assert.ok(!text.includes("Sida 2 i den långa boken"), "ett långt dokument skickas aldrig helt");
  assert.equal(r.json.svar.text, "Boken handlar om avtal [s. 1–3]. Och.", "avsnittet får hänvisas till, men inte en sida Tudi inte fick se");
});

test("tenta: gamla tentor och kursplanen, och annars beskedet att de saknas", async () => {
  valjer("tenta");
  await fraga({ fraga: "Vad behöver jag kunna inför tentan?" });
  assert.match(inneText(luna()[0].json), /Det finns inga gamla tentor och ingen kursplan bland kursens dokument\./);
  assert.match(luna()[0].json.input[0].content, /Finns gamla tentor: sammanfatta vad de frågar om, och säg i hur många av tentorna/);

  oa.svar = json => (json.text?.format?.name === "dokument" ? { typ: "tenta", kort: "En gammal tenta.", sammanfattning: "Frågor om avtal.", delar: [] } : undefined);
  const tenta = await laddaUpp(a, kurs, ["Fråga 1. Vad är ett anbud?"], "Tentamen VT 2025");
  oa.anrop.length = 0;
  valjer("tenta");
  await fraga({ fraga: "Vad brukar komma på tentan?" });
  const text = inneText(luna()[0].json);
  assert.match(text, /Hela texten i Tentamen VT 2025 \(tenta, 1 sidor\):\n<material>\n\[s\. 1\]\nFråga 1\. Vad är ett anbud\?/);
  assert.ok(!text.includes("Lång bok (kursbok"), "bara tentor och kursplan");
  await s.anrop("DELETE", `/api/dokument/${tenta}`, { kaka: a });
});

test("ovrigt: inget extra material, och kurs: sammanfattningarna", async () => {
  valjer("ovrigt");
  await fraga({ fraga: "Hej Tudi!" });
  assert.equal(luna()[0].json.input.filter(m => m.role === "user" && m.content.includes("<material>")).length, 1, "bara dokumentlistan");
  oa.anrop.length = 0;
  valjer("kurs");
  await fraga({ fraga: "Vad handlar kursen om?" });
  assert.match(inneText(luna()[0].json), /Sammanfattningar av avsnitten i kursens dokument/);
});

test("går nano fel blir det specifik, och sidan eller ett dokument som inte finns gör också det", async () => {
  oa.felOm = (url, json) => json.text?.format?.name === "val";
  const r = await fraga({ fraga: "Vad är ett anbud?", sida: { dokId: lang, nr: 1 } });
  assert.equal(r.status, 200);
  assert.match(inneText(luna()[0].json), /Utdrag ur materialet som liknar frågan/);
  oa.felOm = null;
  oa.anrop.length = 0;
  valjer("sidan");
  await fraga({ fraga: "Förklara sidan" });
  assert.match(inneText(luna()[0].json), /Utdrag ur materialet/, "sidan utan öppen sida blir specifik");
  oa.anrop.length = 0;
  valjer("dokument", 99999);
  await fraga({ fraga: "Sammanfatta" });
  assert.match(inneText(luna()[0].json), /Utdrag ur materialet/, "inget dokument att välja blir specifik");
});

test("knapparna under svaren: en sida förklaras på ett annat sätt, och chattsvar får samma material igen", async () => {
  const forst = await fraga({ forklara: true, sida: { dokId: lang, nr: 1 } });
  assert.equal(forst.json.svar.meta.typ, "sida");
  oa.anrop.length = 0;
  oa.svar = () => "Enklare: ett anbud är ett erbjudande [s. 1].";
  const enklare = await fraga({ foljd: "enklare" });
  assert.deepEqual(enklare.json.svar.meta, { typ: "sida", dokId: lang, sida: 1, bild: false, satt: "enklare" });
  const x = oa.anrop.at(-1).json;
  assert.match(x.input[0].content, /Förklara sidan studenten har öppen/);
  assert.match(x.input.at(-1).content, /^Studenten förstod inte förklaringen ovan/);

  valjer("dokument", kort);
  await fraga({ fraga: "Sammanfatta den korta texten" });
  oa.anrop.length = 0;
  await fraga({ foljd: "steg" });
  assert.equal(nano().length, 0, "knapparna sorteras inte igen");
  assert.match(inneText(luna()[0].json), /Hela texten i Kort text/);

  const m = (await s.anrop("GET", `/api/kurser/${kurs}/meddelanden`, { kaka: a })).json.meddelanden;
  assert.deepEqual(m.slice(-8).map(x => x.roll), ["student", "tudi", "student", "tudi", "student", "tudi", "student", "tudi"]);
  assert.deepEqual(m.slice(-8).filter(x => x.roll === "student").map(x => x.text), ["Förklara sida 1", "Enklare", "Sammanfatta den korta texten", "Steg för steg"], "i tidsordning");
});

test("taken: en fråga räknas mot chatten, knappen mot sidorna, och nano kostar inget eget tak", async () => {
  const d = new DatabaseSync(path.join(s.dataDir, "studfun.db"));
  const anv = typ => d.prepare("SELECT antal FROM anvandning WHERE typ = ?").get(typ)?.antal || 0;
  const [chatt, sida] = [anv("chatt"), anv("sida")];
  valjer("sidan");
  await fraga({ fraga: "Förklara den här sidan", sida: { dokId: kort, nr: 1 } });
  assert.equal(anv("chatt"), chatt + 1);
  assert.equal(anv("sida"), sida, "en fråga som blir en förklaring räknas bara mot chatten");
  await fraga({ forklara: true, sida: { dokId: lang, nr: 2 } });
  assert.equal(anv("sida"), sida + 1);
  d.close();
});
