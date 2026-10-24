# Databasen

En SQLite‑fil, `data/studfun.db`, inbyggd i Node. Schemat finns i `db.js`.

**Grundregel:** varje tabell har `user_id`, utom mätningen `ai_anrop`, som bara har ett slumpat id och inga texter. Då hämtas allt med id:t från inloggningen, så att en student aldrig når en annan students rader, och hela kontot raderas på en gång (`ON DELETE CASCADE`).

Databasen är inställd så att raderade rader skrivs över med nollor (`secure_delete`). När ett konto raderas töms också WAL‑filen, så att inget ligger kvar i databasfilerna. Säkerhetskopior innehåller data tills de byts ut. Hur länge de sparas är en fråga till Sahra.

## users
| Fält | Varför |
|---|---|
| `id` | Kopplar allt annat till studenten. |
| `mejl` | För inloggning. Sparas med små bokstäver och kan bara finnas en gång. |
| `losen_hash` | Lösenordet som scrypt‑hash med eget salt. Lösenordet i klartext sparas aldrig. |
| `skapad` | När kontot skapades. Behövs för att kunna gallra gamla konton. |
| `godkant_tid`, `godkant_version` | När studenten godkände informationstexten, och vilken version. Krävs för att visa vad studenten har godkänt. |
| `matid` | Ett slumpat id som bara används i mätningen `ai_anrop`. Skapas första gången studenten använder AI. Raderas med kontot, och då finns ingen koppling kvar mellan mätningen och studenten. |

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
| `textstorlek` | Används inte längre. Fanns för läsläget, som togs bort den 24 oktober 2026. Kolumnen ligger kvar, eftersom gamla ändringar i schemat aldrig skrivs om. |
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
| `status` | `vantar_fil` medan PDF:en laddas upp, `bearbetas` medan vektorerna och sammanfattningen görs ("Tudi läser igenom materialet"), `klar` eller `fel`. Uppladdningar som avbröts och är äldre än en timme raderas automatiskt. |
| `fil` | Slumpat namn på PDF:en i `data/pdf/`, till exempel `1f69…e075.pdf`. Aldrig studentens filnamn. |
| `storlek` | Filens storlek i byte, högst 50 MB. |
| `skapad` | Ordningen i listan, nyaste först. |
| `senast_sida` | Sidan studenten senast läste. Visaren öppnar där. |
| `senast_last` | När studenten senast läste i filen. Tom om filen aldrig har öppnats. Nästa steg och "Du läste senast" bygger på den. |
| `innehall` | sha256 av filens text. Laddar samma student upp samma PDF igen återanvänds vektorerna och sammanfattningen, utan nya anrop. |
| `kort` | En mening om vad filen handlar om, från sammanfattningen. |
| `sammanfattning` | Sammanfattningen av hela filen, högst cirka 200 ord. Görs en gång vid uppladdningen. Tudi använder den i chatten, i Förklara den här sidan och i Börja här. Tom tills den är klar. |
| `delar` | Filens delar som JSON: sidor och en mening om vad varje del handlar om. |

En student kan ha högst 20 filer.

## chunks
| Fält | Varför |
|---|---|
| `user_id`, `document_id` | Vems texten är och vilken fil den kommer från. |
| `sida` | Sidan biten står på. Tudi visar den som källa. |
| `text` | Ungefär en halv sida text. Bryts aldrig mitt i en mening, och sträcker sig aldrig över två sidor. |
| `vektor` | Vektorn från OpenAI (`MODEL_EMBED`, standard `text-embedding-3-small`, 512 dimensioner), sparad som 32‑bitars flyttal. Görs en gång per fil. |

## avsnitt
Sammanfattningen av varje avsnitt i en fil. Filen delas i avsnitt om ungefär 10 sidor, och hela filen sammanfattas sedan utifrån avsnitten.

| Fält | Varför |
|---|---|
| `user_id`, `document_id` | Vems avsnittet är och vilken fil. Raderas med filen. |
| `fran`, `till` | Avsnittets sidor. Tudi får hänvisa till dem som ett spann. |
| `rubrik` | En kort rubrik på svenska. |
| `sammanfattning` | Högst cirka 120 ord på svenska. Läses av Tudi, inte av studenten. |
| `begrepp` | Viktiga begrepp på originalspråket, som JSON. |

## anvandning
| Fält | Varför |
|---|---|
| `user_id` | Vems användning det är. |
| `dag` | Dagen, som byts klockan 06.00 svensk tid. Rader äldre än en vecka raderas. |
| `typ` | Vad som räknas: `upplasning` (tecken som lästs upp och inte redan fanns sparade), `chatt` (frågor i chatten), `sida` (Förklara den här sidan), `ord` (förklara eller ge exempel på ett ord), `tal` (tal till text), `quiz` och `flashcards` (nya omgångar), `rattning` (korta svar som modellen fick rätta) och `borja` (nya förslag i Börja här). Svar som hämtas ur `ai_cache` räknas inte. |
| `antal` | Hur mycket som använts. Jämförs med dagens tak. |

## Sparad uppläsning (inte i databasen)
Uppläst ljud sparas som filer i `data/upplasning/<filens id>/`, så att samma text bara hämtas en gång från OpenAI. Mappen raderas när filen, kursen, allt material eller kontot raderas. Röstproven i Inställningar ligger i `data/upplasning/prov/` och innehåller ingen text från studenter.

## messages
Samtalet med Tudi i en kurs. Förklaringar av enskilda ord i visaren sparas inte.

| Fält | Varför |
|---|---|
| `user_id`, `course_id` | Vems samtalet är och i vilken kurs. |
| `roll` | `student` eller `tudi`. |
| `text` | Frågan, eller Tudis svar med sidhänvisningar som `[s. 12]`. För följdknapparna sparas knappens text, till exempel "Enklare". |
| `kallor` | Sidhänvisningarna i Tudis svar som JSON, i samma ordning som de står i texten: fil‑id, filens titel och sida. Servern har tagit bort hänvisningar till sidor Tudi inte fick se. |
| `tid` | När det skrevs. |

Bilden av sidan som skickas med Förklara den här sidan sparas inte, och inte heller ljudet från tal till text.

## cards
Quizfrågor och flashcards. Görs av modellen från bitar i kursen och raderas med filen de bygger på.

| Fält | Varför |
|---|---|
| `user_id`, `course_id` | Vems frågan är och i vilken kurs. |
| `document_id` | Filen frågan bygger på. Raderas filen, raderas frågan och svaren på den. |
| `typ` | `flerval`, `kort` (kort svar) eller `flashcard`. |
| `fraga` | Frågan, eller begreppet på flashcardets framsida. |
| `svar` | Facit, eller förklaringen på baksidan. Facit skickas aldrig med quizfrågorna, bara efter att studenten svarat. |
| `alternativ` | De fyra svarsalternativen för flerval som JSON, i blandad ordning. Tom för andra typer. (Frågor från före AI‑arkitekturen har tre.) |
| `forklaring` | En eller två meningar om varför svaret är rätt. |
| `kalla_sida` | Sidan frågan bygger på. Visas efter svaret, och nästa steg pekar dit. |
| `skapad` | När frågan gjordes. |

## attempts
Varje svar studenten ger. Det är resultaten som sparas, och som nästa steg ska bygga på.

| Fält | Varför |
|---|---|
| `user_id`, `card_id` | Vem som svarade på vilken fråga. |
| `ratt` | 1 för rätt eller Kunde, 0 för fel, delvis rätt eller Kunde inte. Servern rättar alltid, aldrig webbläsaren. |
| `bedomning` | För korta svar: `ratt`, `delvis` eller `fel`. Tom för andra typer. |
| `tid` | När studenten svarade. |

## ai_cache
Svar från AI som kan komma igen, så att samma fråga inte kostar något andra gången. Se `ai.js`.

| Fält | Varför |
|---|---|
| `user_id` | Vems svaret är. Svar delas aldrig mellan studenter. |
| `nyckel` | sha256 av allt som gör svaret unikt: prompten, modellen, tänkandet och det som skickades, till exempel fil, sida och sätt. En ändrad prompt i `prompts/` ger alltså en ny nyckel och ett nytt svar. |
| `typ` | Vad svaret är: `sida:forklara`, `sida:enklare` och de andra sätten, `ord:forklara`, `ord:exempel`, `ratta` eller `borja`. |
| `document_id`, `course_id` | Svaret raderas med filen eller kursen. |
| `svar` | Svaret som JSON. |
| `skapad`, `anvand` | När svaret skapades och senast hämtades. Svar som inte har hämtats på 90 dagar raderas. |

## ai_anrop
Mätningen av varje anrop till OpenAI, så att kostnaden per funktion och dag går att se med `npm run kostnad`. **Ingen text sparas här.**

| Fält | Varför |
|---|---|
| `dag`, `tid` | När anropet gjordes. Dagen byts klockan 06.00 som för taken. |
| `funktion` | `sida`, `ord`, `chatt`, `sammanfattning`, `ova`, `ratta`, `borja`, `vektorer`, `sok`, `tal` eller `upplasning`. |
| `modell` | Modellen som användes. |
| `student` | Studentens slumpade `matid`. Går inte att koppla till en student när kontot är raderat. |
| `token_in`, `token_cache`, `token_ut`, `token_tank` | OpenAI:s egen räkning. `token_cache` är början av anropet som OpenAI återanvände och som kostar en tiondel. `token_tank` är tänkandet, som ingår i `token_ut`. |
| `tecken` | För uppläsningen: antal tecken. |
| `ms` | Hur lång tid anropet tog. |
| `ok` | 1 om anropet lyckades. Ett misslyckat anrop som görs om ger två rader. |

## Ändringar i schemat
Nya ändringar läggs till sist i listan `MIGRATIONER` i `db.js`. En gammal ändring skrivs aldrig om. `PRAGMA user_version` håller reda på vilka som redan har körts.
