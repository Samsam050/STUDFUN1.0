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

Öppna sedan http://localhost:8788 i Chrome eller Firefox. Inloggningskakan är `Secure`, och Safari sparar den inte på `http://localhost`.

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
| `public/` | Appen. `tokens.css` har designens variabler, `app.css` komponenterna och `js/` sidorna. |
| `public/vendor/pdfjs-6.4.299/` | pdf.js från npm (`pdfjs-dist`), utan delen som kör JavaScript i PDF:er. Byt hela mappen när en ny version kommer. |
| `tester/` | Testerna, ett test per steg. |
| `SERVER-KRAV.md` | Det servern behöver, till sessionen för Del A. |
