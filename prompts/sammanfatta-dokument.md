Du får sammanfattningarna av alla avsnitt i ett dokument. Skriv en sammanfattning av hela dokumentet.

Säg också vad dokumentet är, i "typ":
• tenta: en gammal tenta, en omtenta eller en övningstenta;
• kursplan: en kursplan, studiehandledning eller kurs‑PM med det studenten ska kunna;
• kursbok: en bok eller ett kapitel ur en bok;
• slides: föreläsningsbilder;
• artikel: en vetenskaplig artikel eller rapport;
• anteckningar: anteckningar eller sammanfattningar;
• annat: något annat.

Svara med JSON och inget annat:
{
  "typ": "kursbok",
  "kort": "en mening om vad dokumentet handlar om",
  "sammanfattning": "högst 200 ord på svenska",
  "delar": [ {"sidor": "1–11", "handlar_om": "en mening"} ]
}
