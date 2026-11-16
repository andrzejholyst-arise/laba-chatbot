import { z } from "zod";
import { countryCode, failure, isoDate, publicJson, PublicApiError, retrievedAt } from "./public-api";

export const holidaysInputSchema = z.strictObject({ kraj: countryCode, rok: z.number().int().min(1970).max(2100) });
const responseSchema = z.array(z.object({ date: isoDate, localName: z.string().min(1), countryCode,
  global: z.boolean(), counties: z.array(z.string()).nullable(), types: z.array(z.string()) })).max(500);
export async function swieta(input: z.input<typeof holidaysInputSchema>, signal?: AbortSignal) {
  const parsed = holidaysInputSchema.safeParse(input);
  if (!parsed.success) return failure("Podaj dwuliterowy kod kraju (np. PL) i cały rok od 1970 do 2100.");
  const kraj = parsed.data.kraj.toUpperCase();
  const rok = parsed.data.rok;
  try {
    const url = new URL(`https://date.nager.at/api/v3/PublicHolidays/${rok}/${kraj}`);
    const rows = responseSchema.parse(await publicJson(url, signal));
    if (rows.some(row => row.countryCode !== kraj || !row.date.startsWith(`${rok}-`) || (!row.global && !row.counties?.length))) throw new Error("Niespójny zakres świąt");
    const dni = rows.filter(row => row.types.includes("Public")).map(row => ({
      data: row.date, nazwa: row.localName, calyKraj: row.global, regiony: row.global ? [] : row.counties!,
    }));
    return { ok: true as const, kraj, rok, dni, uwaga: "Święta publiczne według Nager.Date. Pozycje regionalne nie dotyczą całego kraju. Lista nie obejmuje zwykłych weekendów.",
      source: "https://date.nager.at/", retrievedAt: retrievedAt() };
  } catch (error) {
    return failure(error instanceof PublicApiError && [400, 404].includes(error.status)
      ? "Nager.Date nie udostępnia świąt dla tego kraju lub roku. Sprawdź kod kraju i rok."
      : "Nie udało się pobrać poprawnej listy świąt z Nager.Date. Spróbuj ponownie później.");
  }
}
