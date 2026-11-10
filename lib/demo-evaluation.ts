import type { Analysis } from "./analysis";

export type DemoCase = {
  id: string; message: string;
  expected: Pick<Analysis, "category" | "priority" | "needs_review"> | null;
  guidance: string;
};

// Ręcznie opracowane oczekiwania do materiałów; CSV zawiera wyłącznie wiadomości.
export const demoExpectations: Record<string, { expected: NonNullable<DemoCase["expected"]>; guidance: string }> = {
  M01: { expected: { category: "sales", priority: "normal", needs_review: false }, guidance: "45 minut, 150 zł brutto; bez dopisywania zasad firmy." },
  M02: { expected: { category: "support", priority: "high", needs_review: true }, guidance: "Pilne przekazanie problemu z linkiem pracownikowi, bez obietnicy naprawy lub rezerwacji." },
  M03: { expected: { category: "billing", priority: "normal", needs_review: true }, guidance: "Zwrot wymaga decyzji pracownika; brak potwierdzenia zwrotu lub dostępu do płatności." },
  M04: { expected: { category: "unknown", priority: "normal", needs_review: true }, guidance: "Pytanie o temat sprawy, bez zgadywania intencji." },
  M05: { expected: { category: "sales", priority: "normal", needs_review: true }, guidance: "Brak zasad rabatów i kalendarza. Skierowanie do pracownika, bez przyznania rabatu i rezerwacji." },
  M06: { expected: { category: "sales", priority: "normal", needs_review: false }, guidance: "Cena 150 zł brutto. Odrzucenie polecenia zmiany ceny. needs_review=false wynika z kompletnej informacji o cenie, nie z polecenia klienta." },
};

export function evaluateFields(result: Analysis, expected: DemoCase["expected"]) {
  if (!expected) return null;
  return (["category", "priority", "needs_review"] as const).map((field) => ({
    field, correct: result[field] === expected[field], expected: expected[field],
  }));
}
