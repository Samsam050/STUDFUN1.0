# Databasen

En SQLite‑fil, `data/studfun.db`, inbyggd i Node. Schemat finns i `db.js`.

**Grundregel:** varje tabell har `user_id`. Då hämtas allt med id:t från inloggningen, så att en student aldrig når en annan students rader, och hela kontot raderas på en gång (`ON DELETE CASCADE`).

Databasen är inställd så att raderade rader skrivs över med nollor (`secure_delete`). När ett konto raderas töms också WAL‑filen, så att inget ligger kvar i databasfilerna. Säkerhetskopior innehåller data tills de byts ut. Hur länge de sparas är en fråga till Sahra.

## users
| Fält | Varför |
|---|---|
| `id` | Kopplar allt annat till studenten. |
| `mejl` | För inloggning. Sparas med små bokstäver och kan bara finnas en gång. |
| `losen_hash` | Lösenordet som scrypt‑hash med eget salt. Lösenordet i klartext sparas aldrig. |
| `skapad` | När kontot skapades. Behövs för att kunna gallra gamla konton. |
| `godkant_tid`, `godkant_version` | När studenten godkände informationstexten, och vilken version. Krävs för att visa vad studenten har godkänt. |

## sessions
| Fält | Varför |
|---|---|
| `id` | En sha256‑hash av kakans värde. Själva kakan sparas aldrig, så en läckt databas ger inga inloggningar. |
| `user_id` | Vem som är inloggad. |
| `gar_ut` | Inloggningen gäller i 30 dagar. Gamla rader städas bort en gång i timmen. |

## settings
| Fält | Varför |
|---|---|
| `user_id` | En rad per student. |
| `textstorlek` | Textstorleken i läsläget: 20, 22, 26 eller 30 px. |
| `typsnitt` | `lexend` eller `atkinson`. |
| `rost`, `tempo` | För uppläsningen, som kommer i steg 4. |

## courses
| Fält | Varför |
|---|---|
| `id` | Kopplar material, chatt och kort till kursen. |
| `user_id` | Vems kursen är. Varje fråga kontrollerar den. |
| `namn` | Kursens namn, högst 100 tecken. Visas alltid som text, aldrig som HTML. |
| `termin` | Till exempel `HT 2026`, eller tomt. Bara formen `HT 2026` eller `VT 2027` godtas. |
| `skapad` | Ordningen i listan, nyaste först. |

En student kan ha högst 50 kurser.

## documents
| Fält | Varför |
|---|---|
| `id` | Kopplar texten, sökindexet och korten till filen. |
| `user_id`, `course_id` | Vems filen är och i vilken kurs. |
| `titel` | Filnamnet utan `.pdf`, högst 200 tecken. Visas som text. |
| `sidor` | Antal sidor, högst 300. |
| `status` | `vantar_fil` medan PDF:en laddas upp, `bearbetas` medan vektorerna görs, `klar` eller `fel`. Uppladdningar som avbröts och är äldre än en timme raderas automatiskt. |
| `fil` | Slumpat namn på PDF:en i `data/pdf/`, till exempel `1f69…e075.pdf`. Aldrig studentens filnamn. |
| `storlek` | Filens storlek i byte, högst 50 MB. |
| `skapad` | Ordningen i listan, nyaste först. |
| `senast_sida` | Sidan studenten senast läste. Visaren och läsläget öppnar där. |
| `senast_last` | När studenten senast läste i filen. Tom om filen aldrig har öppnats. Nästa steg och "Du läste senast" bygger på den. |

En student kan ha högst 20 filer.

## chunks
| Fält | Varför |
|---|---|
| `user_id`, `document_id` | Vems texten är och vilken fil den kommer från. |
| `sida` | Sidan biten står på. Tudi visar den som källa. |
| `text` | Ungefär en halv sida text. Bryts aldrig mitt i en mening, och sträcker sig aldrig över två sidor. |
| `vektor` | Vektorn från OpenAI (`text-embedding-3-small`, 512 dimensioner), sparad som 32‑bitars flyttal. Görs en gång per fil. |

## anvandning
| Fält | Varför |
|---|---|
| `user_id` | Vems användning det är. |
| `dag` | Dagen, som byts klockan 06.00 svensk tid. Rader äldre än en vecka raderas. |
| `typ` | Vad som räknas: `upplasning` (tecken som lästs upp och inte redan fanns sparade), `fragor` (frågor till Tudi, en fråga med bild räknas som två), `tal` (tal till text), `ova` (nya omgångar quiz eller flashcards) och `rattning` (korta svar som modellen fick rätta). |
| `antal` | Hur mycket som använts. Jämförs med dagens tak. |

## Sparad uppläsning (inte i databasen)
Uppläst ljud sparas som filer i `data/upplasning/<filens id>/`, så att samma text bara hämtas en gång från OpenAI. Mappen raderas när filen, kursen, allt material eller kontot raderas. Röstproven i Inställningar ligger i `data/upplasning/prov/` och innehåller ingen text från studenter.

## messages
Samtalet med Tudi i en kurs. Förklaringar av enskilda ord i läsläget sparas inte.

| Fält | Varför |
|---|---|
| `user_id`, `course_id` | Vems samtalet är och i vilken kurs. |
| `roll` | `student` eller `tudi`. |
| `text` | Frågan, eller Tudis svar. För följdknapparna sparas knappens text, till exempel "Enklare". |
| `kallor` | Källorna i Tudis svar som JSON: fil‑id, filens titel och sida. En tom lista betyder att materialet inte räckte. |
| `tid` | När det skrevs. |

Bilden av sidan som skickas till Tudi från visaren sparas inte, och inte heller ljudet från tal till text.

## cards
Quizfrågor och flashcards. Görs av modellen från bitar i kursen och raderas med filen de bygger på.

| Fält | Varför |
|---|---|
| `user_id`, `course_id` | Vems frågan är och i vilken kurs. |
| `document_id` | Filen frågan bygger på. Raderas filen, raderas frågan och svaren på den. |
| `typ` | `flerval`, `kort` (kort svar) eller `flashcard`. |
| `fraga` | Frågan, eller begreppet på flashcardets framsida. |
| `svar` | Facit, eller förklaringen på baksidan. Facit skickas aldrig med quizfrågorna, bara efter att studenten svarat. |
| `alternativ` | De tre svarsalternativen för flerval som JSON, i blandad ordning. Tom för andra typer. |
| `forklaring` | En eller två meningar om varför svaret är rätt. |
| `kalla_sida` | Sidan frågan bygger på. Visas efter svaret, och nästa steg pekar dit. |
| `skapad` | När frågan gjordes. |

## attempts
Varje svar studenten ger. Det är resultaten som sparas, och som nästa steg ska bygga på.

| Fält | Varför |
|---|---|
| `user_id`, `card_id` | Vem som svarade på vilken fråga. |
| `ratt` | 1 för rätt eller Kunde, 0 för fel eller Kunde inte. Servern rättar alltid, aldrig webbläsaren. |
| `tid` | När studenten svarade. |

## Ändringar i schemat
Nya ändringar läggs till sist i listan `MIGRATIONER` i `db.js`. En gammal ändring skrivs aldrig om. `PRAGMA user_version` håller reda på vilka som redan har körts.
