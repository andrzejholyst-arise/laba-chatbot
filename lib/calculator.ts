import { z } from "zod";
import { failure, retrievedAt } from "./public-api";

export const calculatorInputSchema = z.strictObject({
  dzialanie: z.enum(["dodaj", "odejmij", "pomnoz", "podziel", "potega"]),
  a: z.number().min(-1e12).max(1e12), b: z.number().min(-1e12).max(1e12),
});
export function kalkulator(input: z.input<typeof calculatorInputSchema>) {
  const parsed = calculatorInputSchema.safeParse(input);
  if (!parsed.success) return failure("Podaj działanie i dwie skończone liczby a oraz b (od -1 biliona do 1 biliona), bez kodu i wyrażeń tekstowych.");
  const { a, b, dzialanie } = parsed.data;
  if (dzialanie === "podziel" && b === 0) return failure("Nie można dzielić przez zero.");
  const wynik = dzialanie === "dodaj" ? a + b : dzialanie === "odejmij" ? a - b : dzialanie === "pomnoz" ? a * b : dzialanie === "podziel" ? a / b : a ** b;
  if (!Number.isFinite(wynik) || Math.abs(wynik) > Number.MAX_SAFE_INTEGER) return failure("Wynik nie jest skończoną liczbą rzeczywistą lub przekracza bezpieczny zakres. Podaj inne liczby.");
  return { ok: true as const, dzialanie, a, b, wynik, retrievedAt: retrievedAt() };
}
