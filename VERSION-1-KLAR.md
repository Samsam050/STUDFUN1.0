# Version 1 är klar när

Listan kommer från `STUDFUN-1.0-VERSIONER-OCH-PLAN.md`. Avbockad den 24 oktober 2026, på Hayssams Mac med låtsas‑OpenAI.

| Krav | Klart | Hur det visas |
|---|---|---|
| En student kan skapa konto och skapa en kurs. | Ja | steg1, steg2, och provat i webbläsaren |
| Studenten kan ladda upp en PDF, och Tudi kan använda den. | Ja | steg3, steg5. En kursbok på 200 sidor gick igenom |
| Tudi svarar med stöd i materialet och visar sidan svaret kommer från. | Ja | steg5. Servern kontrollerar varje källa, och ett svar utan giltig källa blir "Jag hittar inte svaret i ditt material" |
| Studenten kan göra quiz och flashcards, och resultaten sparas. | Ja | steg6. Varje svar sparas i `attempts` |
| Resultaten påverkar minst en rekommendation. | Ja | steg7. Fel svar blir nästa steg på startsidan, "Repetera de 2 frågor du svarade fel på" |
| Studenten kan radera sitt material och sitt konto. | Ja | Radera fil, kurs, allt material och konto. angripare: inget finns kvar |
| Ingen kan se en annan students material. | Ja | Ägarkontroll i varje fråga till databasen, testad för kurs, dokument, PDF, text, uppläsning, samtal, kort och nästa steg |
| Sidan fungerar på dator och mobil. | Ja | Granskat på 1024, 375 och 320 px |
| Alla knappar fungerar, eller är tydligt märkta som kommande. | Ja | Enda kommande: "Har du glömt lösenordet? Att återställa det själv kommer snart." Fråga Tudi och Öva är spärrade med en förklaring tills en PDF är klar |

## Från funktionstabellen i planfilen

| Funktion | Status |
|---|---|
| Konto och inloggning | Klart |
| Skapa kurs | Klart |
| Ladda upp PDF | Klart. Andra filtyper nekas med "Bara PDF just nu" |
| Visa originalet med Tudi bredvid | Klart. Tudi får sidan, dess text och en bild av den |
| Börja här | Inte byggt. Planfilen säger "om tid finns" |
| Läsläge för dyslexi | Klart: uppläsning, tryck på ett ord (läs upp, förklara, ge exempel), textstorlek, läslinjal, korta delar |
| Tudi svarar på frågor om materialet | Klart |
| Olika sätt att förklara | Klart: Enklare, Steg för steg, Ge ett exempel, Förklara på ett annat sätt |
| Quiz från materialet | Klart: flerval och korta svar |
| Flashcards från materialet | Klart |
| Resultat sparas | Klart |
| Ett nästa steg | Klart |
| Radera material, kurs och konto | Klart |
| Fokusläge med timer | Inte byggt. Planfilen säger "om tid finns" |

## Kvar innan studenter bjuds in

1. **Prova mot riktig OpenAI.** Starta med `OPENAI_API_KEY=sk-... npm start`. Kontrollera Tudis svar och källor, quizfrågorna och uppläsningen. Prova också en PDF som försöker styra Tudi.
2. **Del A, servern:** en egen Node 22.5 eller senare, en egen användare, säkerhetskopior. Se `SERVER-KRAV.md`.
3. **Sahras beslut** i `TILL-SAHRA.md`, framför allt informationstexten.
4. **Prova på en riktig iPhone och i Safari**, med mikrofonen.
