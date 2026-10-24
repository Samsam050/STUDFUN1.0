/* Startar en egen server med en tom datamapp för varje testfil, och ger enkla anrop med kaka och Origin. */
const { spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

async function startaServer(extraEnv = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "studfun-test-"));
  const port = 20000 + Math.floor(Math.random() * 20000);
  const origin = `http://localhost:${port}`;
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

/* En låtsas-OpenAI som svarar på vektoranrop. Sparar anropen så att testerna kan titta på dem. */
function falskOpenAI() {
  const http = require("http");
  const anrop = [];
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", d => { body += d; });
    req.on("end", () => {
      const json = JSON.parse(body || "{}");
      anrop.push({ url: req.url, auth: req.headers.authorization, json });
      if (req.url === "/v1/audio/speech") {
        res.writeHead(200, { "Content-Type": "audio/mpeg" });
        return res.end(Buffer.from("ID3 låtsasljud för " + json.voice));
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ data: (json.input || []).map(() => ({ embedding: Array.from({ length: 8 }, () => Math.random()) })) }));
    });
  });
  return new Promise(r => server.listen(0, "127.0.0.1", () => r({
    bas: `http://127.0.0.1:${server.address().port}`, anrop, stang: () => server.close(),
  })));
}

module.exports = { startaServer, falskOpenAI };
