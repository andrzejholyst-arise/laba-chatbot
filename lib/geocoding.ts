import { z } from "zod";
import { countryCode, failure, isoDate, publicJson, validTimeZone } from "./public-api";

export const cityDateInputSchema = z.strictObject({
  miasto: z.string().trim().min(2).max(100), data: isoDate,
  kraj: countryCode.optional(), region: z.string().trim().min(1).max(100).optional(),
});
const placeSchema = z.object({
  name: z.string().min(1), latitude: z.number().min(-90).max(90), longitude: z.number().min(-180).max(180),
  country_code: countryCode, admin1: z.string().optional(), timezone: z.string().refine(validTimeZone),
});
const geocodingSchema = z.object({ results: z.array(placeSchema).max(5).optional() });
// Wspólne dopasowanie miasta dla pogody i długości dnia.
export async function resolveCity(input: z.infer<typeof cityDateInputSchema>, signal?: AbortSignal) {
  const { miasto, kraj, region } = input;
    const geoUrl = new URL("https://geocoding-api.open-meteo.com/v1/search");
    geoUrl.search = new URLSearchParams({ name: miasto, count: "5", language: "pl", format: "json", ...(kraj ? { countryCode: kraj.toUpperCase() } : {}) }).toString();
    let places = geocodingSchema.parse(await publicJson(geoUrl, signal)).results ?? [];
    if (kraj) places = places.filter(place => place.country_code.toUpperCase() === kraj.toUpperCase());
    if (region) {
      const normalizeRegion = (value: string) => value.normalize("NFD").replace(/\p{M}/gu, "").toLocaleLowerCase("pl").replace(/^wojewodztwo\s+/, "").trim();
      places = places.filter(place => place.admin1 && normalizeRegion(place.admin1) === normalizeRegion(region));
    }
    const exact = places.filter(place => place.name.toLocaleLowerCase("pl") === miasto.toLocaleLowerCase("pl"));
    if (exact.length) places = exact;
    if (!places.length) return failure("Nie znaleziono miasta w Open-Meteo. Sprawdź nazwę, kod kraju i region.");
    if (places.length > 1) return { ...failure("Nazwa pasuje do kilku miejsc. Poproś o kraj lub region i ponów wyszukiwanie."),
      miejsca: places.map(place => ({ miasto: place.name, kraj: place.country_code, region: place.admin1 ?? null })) };
    return { ok: true as const, place: places[0] };
}
