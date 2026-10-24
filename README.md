# StudFun 1.0

En AI‑lärare för universitetsstudenter med dyslexi och andra läs‑ och skrivsvårigheter.
Node utan paket utifrån. Kräver Node 22.5 eller senare.

## Köra på din dator

```bash
npm start
```

Utan `OPENAI_API_KEY` går det att ladda upp PDF:er, men de blir aldrig klara för Tudi:

```bash
OPENAI_API_KEY=sk-... npm start
```

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
| `dokument.js` | PDF:er: uppladdning, bitar med sidnummer, vektorer, hämta och radera. |
| `upplasning.js` | Uppläsning med sparat ljud och dagstak. |
| `tudi.js` | Tudi: sökning i kursen, svar med källor, sidan och bilden från visaren, tal till text och dagstak. |
| `ova.js` | Quiz och flashcards: nya omgångar från materialet, rättning och sparade svar. |
| `nasta.js` | Nästa steg på startsidan, och repetition av det studenten svarade fel på. En enkel regel, ingen AI. |
| `public/` | Appen. `tokens.css` har designens variabler, `app.css` komponenterna och `js/` sidorna. |
| `public/vendor/pdfjs-6.4.299/` | pdf.js från npm (`pdfjs-dist`), utan delen som kör JavaScript i PDF:er. Byt hela mappen när en ny version kommer. |
| `tester/` | Testerna, ett test per steg. |
| `SERVER-KRAV.md` | Det servern behöver, till sessionen för Del A. |
| `DATABAS.md` | Varje tabell och fält, och varför det behövs. |
| `TESTER.md` | Testlistan: vad som testas, byggpromptens angripartester och vad som inte är prövat än. |
| `VERSION-1-KLAR.md` | Avbockningen av "Version 1 är klar när", och vad som är kvar. |
| `TILL-SAHRA.md` | Det Sahra behöver ta ställning till, till exempel informationstexten och hur länge data sparas. |
