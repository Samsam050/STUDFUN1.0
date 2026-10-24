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

## Tabeller som används från steg 3 och framåt
De skapas redan nu, så att alla rader har `user_id` från början.

| Tabell | Fält |
|---|---|
| `documents` | `course_id`, `titel`, `sidor`, `status`, `fil` (slumpat filnamn, aldrig studentens), `storlek`, `skapad` |
| `chunks` | `document_id`, `sida`, `text`, `vektor` |
| `messages` | `course_id`, `roll`, `text`, `kallor`, `tid` |
| `cards` | `course_id`, `document_id`, `typ`, `fraga`, `svar`, `kalla_sida` |
| `attempts` | `card_id`, `ratt`, `tid` |

Varje fält beskrivs här när steget som använder det är byggt.

## Ändringar i schemat
Nya ändringar läggs till sist i listan `MIGRATIONER` i `db.js`. En gammal ändring skrivs aldrig om. `PRAGMA user_version` håller reda på vilka som redan har körts.
