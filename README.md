# StudFun 1.0

En AI‑lärare för universitetsstudenter med dyslexi och andra läs‑ och skrivsvårigheter.
Node utan paket utifrån. Kräver Node 22.5 eller senare.

## Köra på din dator

```bash
npm start
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
| `public/` | Appen. `tokens.css` har designens variabler, `app.css` komponenterna och `js/` sidorna. |
| `tester/` | Testerna, ett test per steg. |
| `SERVER-KRAV.md` | Det servern behöver, till sessionen för Del A. |
