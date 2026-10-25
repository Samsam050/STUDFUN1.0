# StudFun 1.0

En AI‑lärare för universitetsstudenter med dyslexi och andra läs‑ och skrivsvårigheter.
Node utan paket utifrån. Kräver Node 22.5 eller senare.

## Köra på din dator

```bash
npm start
```

Utan `OPENAI_API_KEY` går det att ladda upp PDF:er, men de blir aldrig klara för Tudi. Kopiera `.env.example` till `.env` och fyll i nyckeln, eller:

```bash
OPENAI_API_KEY=sk-... npm start
```

Hur AI:n används, vilken modell som gör vad och vad som skickas står i `AI-ARKITEKTUR.md`. Kostnaden per funktion och dag: `npm run kostnad`.

Öppna sedan http://localhost:8788 (eller http://127.0.0.1:8788) i valfri webbläsare. Lokalt på http är inloggningskakan inte `Secure`, eftersom Safari då inte sparar den. På servern sätts `APP_ORIGIN` till en https-adress, och då är kakan `Secure` och heter `__Host-sf`.

## Testa

```bash
npm test
```

Testerna startar en egen server med en tom datamapp och provar också det som ska nekas.

## Filer

| Fil | Vad |
|---|---|
| `server.js` | Servern: adresser, säkerhetshuvuden, gränser och statiska filer. Inställningarna står överst. |
| `db.js` | Databasen och dess schema. Se `DATABAS.md`. |
| `konto.js` | Konto, inloggning, inställningar och radering. |
| `kurser.js` | Kurser. |
| `dokument.js` | PDF:er: uppladdning, bitar med sidnummer, vektorer, sammanfattning, hämta och radera. |
| `ai.js` | Alla anrop till OpenAI: prompterna, modellerna från `.env`, nytt försök vid fel, mätning och cache. |
| `prompts/` | Systemprompterna, en fil per funktion. Kan ändras utan att röra koden. |
| `kallor.js` | Kontrollerar sidhänvisningarna `[s. 12]` i Tudis svar. |
| `upplasning.js` | Uppläsning med sparat ljud och dagstak. |
| `tudi.js` | Chatten med Tudi: nano sorterar frågan, Luna får materialet för den (sidan, vissa sidor, ett dokument, kursen, tentor eller utdrag), och knappen Förklara den här sidan. Tal till text och dagstak. |
| `forklara.js` | Förklara den här sidan, sätten att förklara och ett ord. |
| `ova.js` | Quiz och flashcards: urval av material, nya omgångar, rättning och sparade svar. |
| `borja.js` | Börja här: Tudis förslag på i vilken ordning materialet kan läsas. |
| `kostnad.js`, `priser.json` | Kostnaden för AI per funktion och dag, ur mätningen. |
| `AI-ARKITEKTUR.md` | Hur AI:n används: modeller, vad som skickas och prompterna. |
| `nasta.js` | Nästa steg på startsidan, och repetition av det studenten svarade fel på. En enkel regel, ingen AI. |
| `public/` | Appen. `tokens.css` har designens variabler, `app.css` komponenterna och `js/` sidorna. |
| `public/vendor/pdfjs-6.4.299/` | pdf.js från npm (`pdfjs-dist`), utan delen som kör JavaScript i PDF:er. Byt hela mappen när en ny version kommer. |
| `tester/` | Testerna, ett test per steg. |
| `SERVER-KRAV.md` | Det servern behöver, till sessionen för Del A. |
| `DATABAS.md` | Varje tabell och fält, och varför det behövs. |
| `TESTER.md` | Testlistan: vad som testas, byggpromptens angripartester och vad som inte är prövat än. |
| `VERSION-1-KLAR.md` | Avbockningen av "Version 1 är klar när", och vad som är kvar. |
| `TILL-SAHRA.md` | Det Sahra behöver ta ställning till, till exempel informationstexten och hur länge data sparas. |
