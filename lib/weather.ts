import { cityDateInputSchema, resolveCity } from "./geocoding";
import { z } from "zod";
import { failure, isoDate, publicJson, retrievedAt, validTimeZone } from "./public-api";

export const weatherInputSchema = cityDateInputSchema;
const daySchema = z.object({
  timezone: z.string().refine(validTimeZone),
  daily_units: z.object({ temperature_2m_max: z.literal("°C"), temperature_2m_min: z.literal("°C"), precipitation_sum: z.literal("mm") }),
  daily: z.object({ time: z.array(isoDate).length(1), temperature_2m_max: z.array(z.number()).length(1),
    temperature_2m_min: z.array(z.number()).length(1), precipitation_sum: z.array(z.number().nonnegative()).length(1),
    weather_code: z.array(z.number().int().min(0).max(99)).length(1) }),
});
export async function pogoda(input: z.input<typeof weatherInputSchema>, signal?: AbortSignal) {
  const parsed = weatherInputSchema.safeParse(input);
  if (!parsed.success) return failure("Podaj miasto, prawdziwą datę RRRR-MM-DD i opcjonalnie dwuliterowy kod kraju oraz region.");
  const { data } = parsed.data;
  try {
    const location = await resolveCity(parsed.data, signal);
    if (!location.ok) return location;
    const place = location.place;
    const today = new Intl.DateTimeFormat("sv-SE", { timeZone: place.timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
    const daysAhead = (Date.parse(`${data}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000;
    if (daysAhead < 0 || daysAhead > 15) return failure(`Prognoza obejmuje dzisiaj i kolejne 15 dni w strefie ${place.timezone}. Wybierz datę w tym zakresie.`);
    const url = new URL("https://api.open-meteo.com/v1/forecast");
    url.search = new URLSearchParams({ latitude: String(place.latitude), longitude: String(place.longitude),
      daily: "temperature_2m_max,temperature_2m_min,precipitation_sum,weather_code", timezone: place.timezone,
      start_date: data, end_date: data, temperature_unit: "celsius", precipitation_unit: "mm" }).toString();
    const forecast = daySchema.parse(await publicJson(url, signal));
    const d = forecast.daily;
    if (d.time[0] !== data || forecast.timezone !== place.timezone || d.temperature_2m_min[0] > d.temperature_2m_max[0]) throw new Error("Niespójna prognoza");
    return { ok: true as const, miasto: place.name, kraj: place.country_code, region: place.admin1 ?? null,
      data, strefa: place.timezone, temperaturaMinC: d.temperature_2m_min[0], temperaturaMaxC: d.temperature_2m_max[0],
      opadyMm: d.precipitation_sum[0], kodPogodyWMO: d.weather_code[0], retrievedAt: retrievedAt(), source: "https://open-meteo.com/" };
  } catch { return failure("Nie udało się pobrać poprawnej prognozy z Open-Meteo. API może nie odpowiadać lub nie mieć danych na ten dzień. Spróbuj później."); }
}
