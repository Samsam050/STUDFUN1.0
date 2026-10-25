# Till Sahra: det du behöver ta ställning till

Juridik och innehåll som StudFun 1.0 behöver innan studenter bjuds in. Allt som inte är bestämt står som **[ATT FYLLA I]**. Inget här är juridisk rådgivning. Det är en lista över frågor.

## 1. Informationstexten till studenterna
Ett utkast finns i appen, under länken "hur StudFun hanterar mina uppgifter" när man skapar konto (`public/integritet.html`). Det beskriver vad appen faktiskt gör. Det som saknas:

* Vem som är personuppgiftsansvarig, med namn och kontaktuppgift: **[ATT FYLLA I]**.
* Rättslig grund för behandlingen, till exempel samtycke: **[ATT FYLLA I]**.
* Hur studenten begär ut sina uppgifter. Appen har ingen export i version 1.
* När texten ändras sparar appen vilken version studenten godkände. Den nuvarande versionen heter `2026-10-24`.

## 2. Hur länge uppgifter sparas
* Hur länge sparas ett konto som inte används? **[ATT FYLLA I]**. Appen raderar inget av sig själv i dag.
* Hur länge sparas säkerhetskopior? Raderad data finns kvar i kopiorna tills de byts ut. **[ATT FYLLA I]**.
* Serverns loggar innehåller bara id, aldrig text eller mejl. Hur länge de sparas: **[ATT FYLLA I]**.

## 3. OpenAI
Det här skickas till OpenAI:
* frågor till Tudi, med delar av kursmaterialet och en bild av sidan studenten tittar på;
* text som ska läsas upp, eller som quiz och flashcards görs från;
* ljudet när studenten talar in en fråga.

Ta ställning till:
* Avtal med OpenAI om behandling av personuppgifter: **[ATT FYLLA I]**.
* Var datan behandlas, inom EU eller i USA, och om det behöver stå i informationstexten: **[ATT FYLLA I]**.
* Om OpenAI får spara eller träna på datan, enligt OpenAI:s villkor för API:t: **[ATT FYLLA I]**.

## 4. Kursmaterial och upphovsrätt
Studenter laddar upp kursböcker, artiklar och föreläsningsslides. Det sparas bara för studenten själv och delas aldrig.
* Behöver villkoren säga att studenten bara får ladda upp material hen har rätt att använda? **[ATT FYLLA I]**.
* Kursmaterial kan innehålla andras namn, till exempel lärares eller i rättsfall. Planfilen säger att bara det som behövs sparas och att studenten kan radera allt. Räcker det? **[ATT FYLLA I]**.

## 5. Dyslexi och känsliga uppgifter
* Appen frågar aldrig om diagnos, enligt ditt dokument.
* Studenter kan ändå skriva om sin dyslexi i frågor till Tudi. Ska informationstexten be dem att inte göra det? **[ATT FYLLA I]**.

## 6. Bekräftelse när kontot raderas
Designen visar att en bekräftelse skickas till studentens mejl. Servern kan inte skicka mejl än, så det är inte byggt. Ska det finnas innan studenter bjuds in? **[ATT FYLLA I]**.

## 7. Tak och kostnad
Taken per student och dag är satta utan mätningar:
* 40 frågor till Tudi, där en fråga med bild räknas som två;
* 10 nya quiz eller flashcards;
* ungefär en timme ny uppläsning;
* 40 tal till text;
* högst 20 filer och 300 sidor per fil.

Planfilen säger att kostnaden ska mätas den första veckan. Vad är rimligt pris och tak per student? **[ATT FYLLA I]**.

## 8. Tentor
Tudi har regeln att aldrig antyda vad som kommer på en tenta, både i chatten och när frågor görs. Stämmer formuleringen med hur du vill att StudFun ska uttrycka sig? Se `REGLER` överst i `tudi.js` och `ova.js`.
