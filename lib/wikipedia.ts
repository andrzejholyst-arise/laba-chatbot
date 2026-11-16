import { z } from "zod";
import { failure, publicJson, retrievedAt } from "./public-api";

export const wikipediaInputSchema = z.strictObject({ haslo: z.string().trim().min(1).max(160).regex(/^[^|\u0000-\u001f]+$/) });
const pageSchema = z.object({ ns: z.number().int().optional(), title: z.string(), missing: z.boolean().optional(), invalid: z.boolean().optional(),
  extract: z.string().optional(), fullurl: z.string().url().optional(), pageprops: z.object({ disambiguation: z.string().optional() }).optional() });
const responseSchema = z.object({ query: z.object({ pages: z.array(pageSchema).length(1) }) });
export async function wikipedia(input: z.input<typeof wikipediaInputSchema>, signal?: AbortSignal) {
  const parsed = wikipediaInputSchema.safeParse(input);
  if (!parsed.success) return failure("Podaj jedno hasło Wikipedii, do 160 znaków, bez znaku | ani znaków sterujących.");
  try {
    const url = new URL("https://pl.wikipedia.org/w/api.php");
    url.search = new URLSearchParams({ action: "query", format: "json", formatversion: "2", titles: parsed.data.haslo,
      redirects: "1", prop: "extracts|info|pageprops", inprop: "url", explaintext: "1", exintro: "1", exchars: "800" }).toString();
    const page = responseSchema.parse(await publicJson(url, signal)).query.pages[0];
    if (page.missing || page.invalid || page.ns !== 0) return failure("Nie znaleziono takiego artykułu w polskiej Wikipedii. Sprawdź lub doprecyzuj hasło.");
    if (page.pageprops?.disambiguation !== undefined) return failure("To hasło jest wieloznaczne. Poproś o doprecyzowanie tematu i ponów wyszukiwanie.");
    if (!page.extract?.trim() || !page.fullurl) return failure("Artykuł nie ma dostępnego krótkiego streszczenia. Spróbuj doprecyzować hasło.");
    const article = new URL(page.fullurl);
    if (article.protocol !== "https:" || article.hostname !== "pl.wikipedia.org" || article.port || article.username || article.password) throw new Error("Niezaufany link");
    return { ok: true as const, tytul: page.title, streszczenie: page.extract.slice(0, 1200), source: article.href, retrievedAt: retrievedAt() };
  } catch { return failure("Nie udało się pobrać poprawnego streszczenia z polskiej Wikipedii. API może nie odpowiadać. Spróbuj później."); }
}
