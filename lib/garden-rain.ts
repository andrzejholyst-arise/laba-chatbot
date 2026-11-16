import { AGENT_TOOL_TIMEOUT_MS } from "./tool-catalog";
import { z } from "zod";

export const gardenRainInputSchema = z.strictObject({
  latitude: z.number().min(-90).max(90).describe("Szerokość geograficzna ogrodu w WGS84, podana lub potwierdzona przez użytkownika."),
  longitude: z.number().min(-180).max(180).describe("Długość geograficzna ogrodu w WGS84, podana lub potwierdzona przez użytkownika."),
  days: z.number().int().min(1).max(7).default(7).describe("Liczba dni prognozy od dzisiaj, maksymalnie 7."),
});

const forecastSchema = z.object({
  timezone: z.literal("Europe/Warsaw"),
  daily_units: z.object({ rain_sum: z.literal("mm"), showers_sum: z.literal("mm") }),
  daily: z.object({
    time: z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)),
    rain_sum: z.array(z.number().nonnegative()),
    showers_sum: z.array(z.number().nonnegative()),
  }),
});

export async function opadyDlaOgrodnika(input: z.input<typeof gardenRainInputSchema>, signal?: AbortSignal) {
  const failure = (message: string) => ({ ok: false as const, message, checkedAt: new Date().toISOString() });
  const parsedInput = gardenRainInputSchema.safeParse(input);
  if (!parsedInput.success) return failure("Podaj prawidłowe współrzędne ogrodu i liczbę dni od 1 do 7.");
  const { latitude, longitude, days } = parsedInput.data;
  const url = new URL("https://api.open-meteo.com/v1/forecast");
  url.search = new URLSearchParams({
    latitude: String(latitude), longitude: String(longitude),
    daily: "rain_sum,showers_sum", precipitation_unit: "mm",
    timezone: "Europe/Warsaw", forecast_days: String(days),
  }).toString();
  try {
    const timeout = AbortSignal.timeout(AGENT_TOOL_TIMEOUT_MS);
    const response = await fetch(url, {
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      cache: "no-store", redirect: "error",
    });
    if (!response.ok) return failure("Open-Meteo nie udostępniło prognozy deszczu. Spróbuj ponownie za chwilę.");
    const parsed = forecastSchema.safeParse(await response.json());
    if (!parsed.success) return failure("Open-Meteo zwróciło niekompletną lub nieprawidłową prognozę. Nie można podać ilości deszczu.");
    const { daily, timezone } = parsed.data;
    if ([daily.time.length, daily.rain_sum.length, daily.showers_sum.length].some((length) => length !== days) ||
      daily.time.some((date, index) => index > 0 && date <= daily.time[index - 1])) {
      return failure("Open-Meteo zwróciło niekompletny zakres prognozy. Spróbuj ponownie później.");
    }
    return {
      ok: true as const, latitude, longitude, timeZone: timezone, unit: "mm",
      days: daily.time.map((date, index) => ({
        date, rainMm: Math.round((daily.rain_sum[index] + daily.showers_sum[index]) * 100) / 100,
      })),
      retrievedAt: new Date().toISOString(), source: "https://open-meteo.com/",
    };
  } catch {
    return failure("Nie udało się pobrać prognozy deszczu z Open-Meteo: brak połączenia, przekroczony czas oczekiwania lub nieprawidłowa odpowiedź. Spróbuj ponownie później.");
  }
}
