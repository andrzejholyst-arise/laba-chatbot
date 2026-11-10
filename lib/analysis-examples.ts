import type { Analysis } from "./analysis";

// Przykłady dydaktyczne, inne niż wiadomości M01–M06 używane do oceny.
export const analysisExamples: { message: string; output: Analysis }[] = [
  {
    message: "Proszę o ofertę dla 8 osób.",
    output: { category: "sales", priority: "normal", draft: "Dziękuję za wiadomość. Czy chodzi o osiem indywidualnych konsultacji, czy o spotkanie grupowe? Po doprecyzowaniu przekażemy sprawę pracownikowi.", needs_review: true },
  },
  {
    message: "Nie mogę się zalogować.",
    output: { category: "support", priority: "normal", draft: "Napisz proszę, jaki komunikat pojawia się podczas logowania.", needs_review: true },
  },
  {
    message: "Zapłaciłam za konsultację za 15 minut, ale aplikacja blokuje wejście.",
    output: { category: "support", priority: "high", draft: "Dziękuję za zgłoszenie. Sprawa wymaga pilnego sprawdzenia przez pracownika. Prześlij proszę komunikat błędu.", needs_review: true },
  },
];
