import { z } from "zod";

const PRICE_GROSZE = 15_000;
export const consultationCostInputSchema = z.strictObject({
  liczbaKonsultacji: z.number().int().min(1).max(Math.floor(Number.MAX_SAFE_INTEGER / PRICE_GROSZE))
    .describe("Liczba standardowych pojedynczych konsultacji online; dodatnia liczba całkowita, nie liczba osób na spotkaniu grupowym."),
});

export function policzKosztKonsultacji(input: z.infer<typeof consultationCostInputSchema>) {
  const { liczbaKonsultacji } = consultationCostInputSchema.parse(input);
  // Obliczenia w groszach; cena nie pochodzi z argumentów modelu ani przeglądarki.
  return {
    liczbaKonsultacji,
    cenaJednostkowaBrutto: PRICE_GROSZE / 100,
    kosztBrutto: (liczbaKonsultacji * PRICE_GROSZE) / 100,
    waluta: "PLN",
    uwaga: "Kalkulacja standardowych pojedynczych konsultacji, bez rabatów i wyceny grupowej. Nie jest rezerwacją ani potwierdzeniem płatności.",
  };
}
