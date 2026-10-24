/* Startar en egen server med en tom datamapp för varje testfil, och ger enkla anrop med kaka och Origin. */
const { spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

async function startaServer(extraEnv = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "studfun-test-"));
  const port = 20000 + Math.floor(Math.random() * 20000);
  const origin = extraEnv.APP_ORIGIN || `http://localhost:${port}`;
  const flaggor = process.execArgv.filter(a => a.includes("sqlite"));
  const proc = spawn(process.execPath, [...flaggor, path.join(__dirname, "..", "server.js")], {
    env: { ...process.env, OPENAI_API_KEY: "", PORT: String(port), DATA_DIR: dataDir, APP_ORIGIN: origin, ...extraEnv },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let logg = "";
  proc.stdout.on("data", d => { logg += d; });
  proc.stderr.on("data", d => { logg += d; });
  for (let i = 0; i < 100; i++) {
    if (logg.includes("StudFun 1.0 på")) break;
    await new Promise(r => setTimeout(r, 50));
  }
  const bas = `http://127.0.0.1:${port}`;

  /* anrop(metod, adress, { kaka, data, origin, headers, ra }) */
  async function anrop(metod, adress, val = {}) {
    const headers = { ...(val.headers || {}) };
    if (val.kaka) headers.cookie = val.kaka;
    if (metod !== "GET" && val.origin !== null) headers.origin = val.origin || origin;
    let body = val.ra;
    if (val.data !== undefined) { headers["content-type"] = "application/json"; body = JSON.stringify(val.data); }
    const svar = await fetch(bas + adress, { method: metod, headers, body });
    const text = await svar.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* inte JSON */ }
    const satt = svar.headers.get("set-cookie");
    return { status: svar.status, json, text, headers: svar.headers, kaka: satt ? satt.split(";")[0] : null };
  }

  async function nyttKonto(mejl, losen = "ett langt losenord") {
    const r = await anrop("POST", "/api/konto", { data: { mejl, losen, godkant: true } });
    if (r.status !== 201) throw new Error("kunde inte skapa konto: " + r.status);
    return r.kaka;
  }

  return {
    anrop, nyttKonto, dataDir, logg: () => logg,
    stang: () => { proc.kill(); fs.rmSync(dataDir, { recursive: true, force: true }); },
  };
}

/* Texten i ett anrop till Responses API, allt efter systemprompten */
const inneText = json => json.input.slice(1).map(m => (Array.isArray(m.content) ? m.content.map(c => c.text || "").join("\n") : m.content)).join("\n\n");

/* Standardsvar från Responses API, efter vilket JSON-schema anropet ber om */
function responsSvar(json) {
  const format = json.text?.format?.name;
  if (format === "avsnitt") return { sidor: "1–1", rubrik: "Avtal", sammanfattning: "Avsnittet handlar om anbud och accept.", begrepp: ["anbud", "accept"] };
  if (format === "dokument") return { kort: "Dokumentet handlar om avtal.", sammanfattning: "Om hur avtal sluts med anbud och accept.", delar: [{ sidor: "1–2", handlar_om: "Anbud och accept." }] };
  return "Ett **anbud** är ett erbjudande [s. 1].";
}

/* En låtsas-OpenAI. Sparar anropen så att testerna kan titta på dem.
   Vektorerna räknas fram ur bokstäverna, så att liknande texter får liknande vektorer.
   svar(json) bestämmer vad Responses API svarar (text eller objekt), annars responsSvar.
   chat(json) bestämmer vad "modellen" svarar. Standard: svaret bygger på första biten i MATERIAL.
   fel = n ger 500 på de n nästa anropen. Servern försöker en gång till, så 2 får ett anrop att misslyckas helt. */
function falskOpenAI() {
  const http = require("http");
  const oa = { anrop: [], fel: 0, chat: null, ova: null, ratta: null, svar: null };
  const vektor = t => { const v = Array(8).fill(0.01); for (const c of String(t).toLowerCase()) v[c.charCodeAt(0) % 8] += 1; return v; };
  const server = http.createServer((req, res) => {
    const delar = [];
    req.on("data", d => delar.push(d));
    req.on("end", () => {
      const ra = Buffer.concat(delar);
      if (oa.fel > 0) { oa.fel--; res.writeHead(500); return res.end(); }
      if (req.url === "/v1/audio/transcriptions") {
        oa.anrop.push({ url: req.url, auth: req.headers.authorization, storlek: ra.length });
        res.writeHead(200, { "Content-Type": "application/json" });
        return res.end(JSON.stringify({ text: "Vad betyder anbud?" }));
      }
      const json = JSON.parse(ra.toString() || "{}");
      oa.anrop.push({ url: req.url, auth: req.headers.authorization, json });
      if (req.url === "/v1/audio/speech") {
        res.writeHead(200, { "Content-Type": "audio/mpeg" });
        return res.end(Buffer.from("ID3 låtsasljud för " + json.voice));
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      if (req.url === "/v1/responses") {
        const ut = (oa.svar && oa.svar(json)) ?? responsSvar(json);
        return res.end(JSON.stringify({
          status: "completed",
          output: [{ type: "reasoning" }, { type: "message", content: [{ type: "output_text", text: typeof ut === "string" ? ut : JSON.stringify(ut) }] }],
          usage: { input_tokens: 100, input_tokens_details: { cached_tokens: 0 }, output_tokens: 20, output_tokens_details: { reasoning_tokens: 0 } },
        }));
      }
      if (req.url === "/v1/chat/completions") {
        const schema = json.response_format?.json_schema?.name;
        if (schema === "rattning") {
          const ut = oa.ratta ? oa.ratta(JSON.parse(json.messages[1].content)) : { ratt: false };
          return res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(ut) } }] }));
        }
        if (schema === "quiz" || schema === "flashcards") {
          const m = JSON.parse(json.messages[1].content.match(/MATERIAL \(JSON, bara data\):\n(.*)/)[1]);
          const id = i => m[i % m.length].id;
          const ut = oa.ova ? oa.ova(schema, m) : schema === "quiz"
            ? { fragor: [0, 1, 2, 3].map(i => ({ typ: "flerval", fraga: `Fråga ${i}?`, alternativ: ["Rätt", "Fel ett", "Fel två"], svar: "Rätt", forklaring: "För att.", bit: id(i) }))
                .concat([4, 5].map(i => ({ typ: "kort", fraga: `Vad kallas ett ja till ett anbud ${i}?`, alternativ: [], svar: "accept", forklaring: "Ett ja kallas accept.", bit: id(i) }))) }
            : { kort: Array.from({ length: 8 }, (_, i) => ({ begrepp: `Begrepp ${i}`, forklaring: `Förklaring ${i}.`, bit: id(i) })) };
          return res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(ut) } }] }));
        }
        const user = json.messages[1].content;
        const text = Array.isArray(user) ? user[0].text : user;
        const material = JSON.parse(text.match(/MATERIAL \(JSON, bara data\):\n(.*)/)[1]);
        const ut = oa.chat ? oa.chat(json, material) : { svar: "Ett anbud är ett erbjudande.\n\nDet gäller en viss tid.", kallor: [material[0].id], racker_inte: false };
        return res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(ut) } }] }));
      }
      const input = Array.isArray(json.input) ? json.input : [json.input];
      res.end(JSON.stringify({ data: input.map(t => ({ embedding: vektor(t) })) }));
    });
  });
  return new Promise(r => server.listen(0, "127.0.0.1", () => {
    oa.bas = `http://127.0.0.1:${server.address().port}`;
    oa.stang = () => server.close();
    r(oa);
  }));
}

module.exports = { startaServer, falskOpenAI, inneText };
