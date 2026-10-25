# Krav från appen till servern (Del A)

Det här behöver StudFun 1.0 på servern. Läs det tillsammans med Del A i `STUDFUN-1.0/BYGG-PROMPT-VERSION-1.md`.

## Node

* **Servern har i dag Node v20.20.2** (kontrollerat med `node --version` den 24 oktober 2026). Det räcker inte. Den inbyggda databasen `node:sqlite` kräver **22.5 eller senare**.
* **StudFun 1.0 ska köras med en egen Node i en separat miljö**, ungefär som en venv i Python:
  * en egen Node, 22.5 eller senare (gärna aktuell LTS), packas upp i StudFun 1.0:s egen mapp, till exempel `/opt/studfun-uni/node/`;
  * tjänsten för StudFun 1.0 startar den med hela sökvägen, till exempel `/opt/studfun-uni/node/bin/node server.js`;
  * systemets Node 20 rörs inte. Dagens StudFun, AI‑assistenten och allt annat fortsätter använda den;
  * ångra: stoppa tjänsten och radera mappen.
* På Node 22.5 till 22.12 behöver startkommandot flaggan `--experimental-sqlite`. Från 22.13 behövs den inte, men den gör ingen skada.

## OpenAI

* Från steg 3 behöver servern miljövariabeln `OPENAI_API_KEY`. Utan den laddas filer upp, men de blir aldrig klara för Tudi.
* Nyckeln läggs i tjänstens miljöfil, som bara StudFun 1.0:s användare kan läsa. Den får aldrig ligga i koden eller i git.
* Servern behöver kunna nå `api.openai.com` på port 443 utåt.
* Modell och tänkande för varje AI‑funktion står i `.env` (se `.env.example` och `AI-ARKITEKTUR.md`): `MODEL_ORD`, `MODEL_SIDA`, `MODEL_VALJ`, `MODEL_CHATT`, `MODEL_SAMMANFATTNING`, `MODEL_BORJA`, `MODEL_OVA`, `MODEL_RATTA`, med `EFFORT_*` för tänkandet, samt `MODEL_EMBED`, `MODEL_TAL`, `TTS_MOTOR` och `MODEL_TTS`. `MAX_TOKEN_HELA` (standard 15 000) är gränsen för när ett helt dokument skickas till Luna i chatten. Byts `MODEL_EMBED` måste alla filer laddas upp igen. `.env` läses bara om den finns bredvid `server.js`. Det som står i tjänstens miljöfil går före.
* Prompterna ligger i `prompts/`, en fil per funktion. En ändrad prompt gäller direkt, utan omstart.
* Alla anrop går till Responses API (`/v1/responses`) med `store: false`.
* Taken per student och dag: Förklara den här sidan 60, ord 200, chatten 80, nya quiz 10, nya flashcards 10, rättningar av korta svar 200, Börja här 10, tal till text 40 och 50 000 tecken ny uppläsning. Svar ur cachen räknas inte. Taken står överst i `forklara.js`, `tudi.js`, `ova.js`, `borja.js` och `upplasning.js`.
* Kostnaden per funktion och dag: `npm run kostnad` på servern (med samma `DATA_DIR`). Priserna står i `priser.json`.

## Datamappen

* `DATA_DIR` innehåller databasen och PDF:erna (`data/pdf/`). Servern skapar mapparna med rättigheten 700 och filerna med 600.
* En PDF får vara högst 50 MB, och en student kan ha högst 20 filer. Räkna med upp till 1 GB per student i värsta fall. Mät den första veckan.
* Säkerhetskopian måste ta med både `studfun.db` och `pdf/`. Mappen `upplasning/` är sparat ljud som kan hämtas igen, och behöver inte säkerhetskopieras.
* CSP:n tillåter `wasm-unsafe-eval`. pdf.js behöver det för att visa vissa bildformat i PDF:er. Det tillåter inte `eval`.
