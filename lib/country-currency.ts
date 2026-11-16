import { z } from "zod";
import { countryCode, isoDate } from "./public-api";

import { countryCurrencyRegions } from "./country-currency-data";
const entrySchema = z.array(z.record(z.string().regex(/^[A-Z]{3}$/), z.object({ _from: isoDate.optional(), _to: isoDate.optional(), _tender: z.enum(["true", "false"]).optional() }))).max(100);
export async function countryCurrencies(country: string, signal?: AbortSignal, now = new Date()): Promise<string[]> {
  const code = countryCode.parse(country).toUpperCase();
  signal?.throwIfAborted();
  const entries = entrySchema.parse(countryCurrencyRegions[code]);
  const today = now.toISOString().slice(0, 10);
  const currencies = [...new Set(entries.flatMap(entry => Object.entries(entry).filter(([, value]) =>
    value._tender !== "false" && (!value._from || value._from <= today) && (!value._to || value._to >= today),
  ).map(([name]) => name)))];
  if (!currencies.length || currencies.length > 5) throw new Error("Brak jednoznacznego zestawu aktualnych walut kraju");
  return currencies;
}
