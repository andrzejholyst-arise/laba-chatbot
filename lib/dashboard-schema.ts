import { z } from "zod";
import { isoDate, countryCode } from "./public-api";

export const dashboardRequestSchema = z.strictObject({
  miasto: z.string().trim().min(2).max(100), data: isoDate,
  kraj: countryCode.optional(), region: z.string().trim().min(1).max(100).optional(),
}).refine(value => Number(value.data.slice(0, 4)) >= 1970 && Number(value.data.slice(0, 4)) <= 2100);
export const dashboardChoicesSchema = z.array(z.strictObject({ miasto: z.string().min(1).max(100), kraj: countryCode, region: z.string().max(100).nullable() })).max(5);
const source = { sourceName: z.string().min(1), sourceUrl: z.string().url(), retrievedAt: z.string().datetime() };
const message = z.string().min(1).max(1000);
function card<T extends z.ZodType>(data: T) {
  return z.discriminatedUnion("status", [
    z.strictObject({ status: z.literal("ok"), data, ...source }),
    z.strictObject({ status: z.literal("partial"), data, message, ...source }),
    z.strictObject({ status: z.literal("error"), message, ...source }),
  ]);
}
export const dashboardCardsSchema = z.strictObject({
  weather: card(z.strictObject({ date: isoDate, minC: z.number(), maxC: z.number(), rainMm: z.number().nonnegative(), zone: z.string() })),
  currency: card(z.strictObject({ rates: z.array(z.strictObject({ code: z.string().regex(/^[A-Z]{3}$/), pln: z.number().positive(), published: isoDate.nullable() })).min(1).max(5) })),
  holidays: card(z.strictObject({ items: z.array(z.strictObject({ date: isoDate, name: z.string() })).max(3), throughYear: z.number().int(), from: isoDate })),
  wikipedia: card(z.strictObject({ sentences: z.array(z.string().min(1)).min(1).max(2), articleUrl: z.string().url().refine(url => {
    try { const parsed = new URL(url); return parsed.protocol === "https:" && parsed.hostname === "pl.wikipedia.org" && !parsed.username && !parsed.password && !parsed.port; } catch { return false; }
  }) })),
  time: card(z.strictObject({ date: isoDate, time: z.string(), weekday: z.string(), zone: z.string(), differenceMinutes: z.number().int().min(-1560).max(1560) })),
});
export const dashboardSummaryOutputSchema = z.strictObject({ sentences: z.array(z.string().trim().min(3).max(400)).min(2).max(3) });
export const dashboardSummarySchema = z.discriminatedUnion("status", [
  z.strictObject({ status: z.literal("ok"), sentences: z.array(z.string()).min(2).max(3), retrievedAt: z.string().datetime(), modelId: z.string().nullable() }),
  z.strictObject({ status: z.literal("error"), message, retrievedAt: z.string().datetime() }),
]);
export const dashboardCityReportSchema = z.strictObject({
  query: dashboardRequestSchema,
  destination: z.strictObject({ city: z.string(), country: countryCode, region: z.string().nullable(), zone: z.string() }),
  cards: dashboardCardsSchema,
});
export const dashboardResponseSchema = dashboardCityReportSchema.extend({ summary: dashboardSummarySchema });
export type DashboardCityReport = z.infer<typeof dashboardCityReportSchema>;
export type DashboardQuery = z.infer<typeof dashboardRequestSchema>;
export type DashboardCards = z.infer<typeof dashboardCardsSchema>;
export type DashboardResponse = z.infer<typeof dashboardResponseSchema>;
export type DashboardSummary = z.infer<typeof dashboardSummarySchema>;

// Nazwy pochodzą z konfiguracji aplikacji, a nie z tekstu dostawcy lub modelu.
export function missingDashboardSources(cards: DashboardCards): string | null {
  const names: Record<keyof DashboardCards, string> = {
    weather: "Open-Meteo (pogoda)", currency: "NBP / Unicode CLDR (waluty)",
    holidays: "Nager.Date (święta)", wikipedia: "Polska Wikipedia (opis miasta)", time: "zegar serwera (czas)",
  };
  const missing = (Object.keys(names) as (keyof DashboardCards)[]).filter(key => cards[key].status !== "ok");
  return missing.length ? `Brak pełnych danych ze źródeł: ${missing.map(key => names[key]).join(", ")} — spróbuj odświeżyć.` : null;
}

const comparisonCitySchema = z.strictObject({ miasto: z.string().trim().min(2).max(100), kraj: countryCode.optional(), region: z.string().trim().min(1).max(100).optional() });
export const dashboardComparisonRequestSchema = z.strictObject({
  mode: z.literal("compare"), data: isoDate,
  cities: z.tuple([comparisonCitySchema, comparisonCitySchema]),
}).refine(value => Number(value.data.slice(0, 4)) >= 1970 && Number(value.data.slice(0, 4)) <= 2100)
  .refine(value => {
    const identity = (city: z.infer<typeof comparisonCitySchema>) => [city.miasto, city.kraj ?? "", city.region ?? ""].join("|").toLocaleLowerCase("pl");
    return identity(value.cities[0]) !== identity(value.cities[1]);
  }, "Wybierz dwa różne miasta.");
export const dashboardApiRequestSchema = z.union([dashboardRequestSchema, dashboardComparisonRequestSchema]);
const cityIndex = z.union([z.literal(0), z.literal(1)]);
export const comparisonReasonSchema = z.strictObject({
  cityIndex, card: z.enum(["weather", "currency", "holidays", "wikipedia", "time"]),
  explanation: z.string().trim().min(3).max(400),
});
export const comparisonOutputSchema = z.strictObject({
  recommendedIndex: cityIndex, reasons: z.array(comparisonReasonSchema).min(2).max(3),
}).refine(value => value.reasons.some(reason => reason.cityIndex === 0) && value.reasons.some(reason => reason.cityIndex === 1), "Uzasadnij wybór danymi obu miast.");
const comparisonCityResultSchema = z.discriminatedUnion("status", [
  z.strictObject({ status: z.literal("ok"), report: dashboardCityReportSchema }),
  z.strictObject({ status: z.literal("error"), query: dashboardRequestSchema, code: z.string(), message, choices: dashboardChoicesSchema.optional() }),
]);
const recommendationCommon = { retrievedAt: z.string().datetime(), missingSources: z.array(z.string()).max(2) };
export const comparisonRecommendationSchema = z.discriminatedUnion("status", [
  z.strictObject({ status: z.literal("ok"), recommendedIndex: cityIndex,
    reasons: z.array(comparisonReasonSchema.extend({ evidence: z.string().min(1).max(1600) })).min(2).max(3),
    modelId: z.string().nullable(), ...recommendationCommon }),
  z.strictObject({ status: z.literal("error"), message, ...recommendationCommon }),
]);
export const dashboardComparisonResponseSchema = z.strictObject({
  mode: z.literal("compare"), query: dashboardComparisonRequestSchema,
  cities: z.tuple([comparisonCityResultSchema, comparisonCityResultSchema]),
  recommendation: comparisonRecommendationSchema,
});
export type DashboardComparisonQuery = z.infer<typeof dashboardComparisonRequestSchema>;
export type DashboardComparisonResponse = z.infer<typeof dashboardComparisonResponseSchema>;
export type ComparisonCityResult = z.infer<typeof comparisonCityResultSchema>;
export type ComparisonRecommendation = z.infer<typeof comparisonRecommendationSchema>;
