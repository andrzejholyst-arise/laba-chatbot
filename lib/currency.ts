import { z } from "zod";
import { failure, isoDate, publicJson, PublicApiError, retrievedAt } from "./public-api";

export const currencyInputSchema = z.strictObject({
  waluta: z.string().regex(/^[A-Za-z]{3}$/), kwota: z.number().min(0).max(1_000_000_000_000).optional(),
  kierunek: z.enum(["na_PLN", "z_PLN"]).optional(),
});
const rateSchema = z.object({ table: z.enum(["A", "B"]), code: z.string(), rates: z.array(z.object({ effectiveDate: isoDate, mid: z.number().positive() })).length(1) });
export async function waluty(input: z.input<typeof currencyInputSchema>, signal?: AbortSignal) {
  const parsed = currencyInputSchema.safeParse(input);
  if (!parsed.success) return failure("Podaj trzyliterowy kod waluty, nieujemną kwotę do 1 biliona i kierunek na_PLN albo z_PLN.");
  const waluta = parsed.data.waluta.toUpperCase();
  const kwota = parsed.data.kwota ?? 1;
  const kierunek = parsed.data.kierunek ?? "na_PLN";
  let kursPLN = 1, dataKursu: string | null = null;
  try {
    if (waluta !== "PLN") {
      let rate;
      for (const table of ["a", "b"]) {
        const url = new URL(`https://api.nbp.pl/api/exchangerates/rates/${table}/${waluta}/?format=json`);
        try { rate = rateSchema.parse(await publicJson(url, signal)); break; }
        catch (error) { if (error instanceof PublicApiError && error.status === 404) continue; throw error; }
      }
      if (!rate) return failure("NBP nie publikuje kursu tej waluty w tabelach A ani B. Sprawdź trzyliterowy kod waluty.");
      if (rate.code.toUpperCase() !== waluta) throw new Error("Niewłaściwa waluta");
      kursPLN = rate.rates[0].mid; dataKursu = rate.rates[0].effectiveDate;
    }
    const result = kierunek === "na_PLN" ? kwota * kursPLN : kwota / kursPLN;
    if (!Number.isFinite(result) || result > Number.MAX_SAFE_INTEGER / 100) return failure("Wynik przeliczenia jest zbyt duży. Podaj mniejszą kwotę.");
    return { ok: true as const, waluta, kursPLN, dataKursu, kwota, kierunek,
      wynik: Math.round((result + Number.EPSILON) * 100) / 100, walutaWyniku: kierunek === "na_PLN" ? "PLN" : waluta,
      uwaga: waluta === "PLN" ? "Przeliczenie PLN na PLN; kurs równy 1, bez notowania NBP." : "Ostatni opublikowany średni kurs NBP. To przeliczenie orientacyjne, bez marży i prowizji; nie jest kursem transakcyjnym.",
      source: "https://api.nbp.pl/", retrievedAt: retrievedAt() };
  } catch { return failure("Nie udało się pobrać prawidłowego kursu NBP. API nie odpowiada lub zwróciło niekompletne dane. Spróbuj później."); }
}
