import { createHash } from "node:crypto";
import { z } from "zod";
import { failure, retrievedAt } from "./public-api";
import { sessionFromRequest, validSession } from "./session";

// Jeden obiekt na poziomie głównym jest czytelniejszym kontraktem function calling.
// Zależność treści od operacji nadal sprawdzamy po stronie serwera.
export const notesInputSchema = z.strictObject({
  operacja: z.enum(["zapisz", "pokaz"], { error: 'Pole operacja musi mieć wartość "zapisz" albo "pokaz".' }),
  tresc: z.string({ error: "Pole tresc musi być tekstem." }).trim()
    .min(1, "Treść notatki nie może być pusta.")
    .max(1000, "Treść notatki może mieć najwyżej 1000 znaków.").optional(),
}, { error: "Dozwolone pola to wyłącznie operacja i tresc." }).superRefine((input, ctx) => {
  if (input.operacja === "zapisz" && input.tresc === undefined)
    ctx.addIssue({ code: "custom", path: ["tresc"], message: "Operacja zapisz wymaga pola tresc (1–1000 znaków)." });
  if (input.operacja === "pokaz" && input.tresc !== undefined)
    ctx.addIssue({ code: "custom", path: ["tresc"], message: "Operacja pokaz nie przyjmuje pola tresc." });
});

export function notesInputError(input: unknown) {
  const parsed = notesInputSchema.safeParse(input);
  return parsed.success ? undefined : [...new Set(parsed.error.issues.map(issue => issue.message))].join(" ");
}
type Note = { id: number; tresc: string; zapisano: string };
const stores = new Map<string, { expiresAt: number; notes: Note[] }>();
const warning = "Notatki są tylko w pamięci tej instancji serwera, w bieżącej sesji. Znikną po restarcie lub wygaśnięciu sesji; inne instancje Vercel mogą ich nie widzieć.";

export function sessionNotes(request: Request) {
  // Zakres pochodzi wyłącznie ze zweryfikowanego cookie; model go nie wybiera.
  const token = sessionFromRequest(request);
  const scope = token ? createHash("sha256").update(token).digest("hex") : "";
  return (input: z.input<typeof notesInputSchema>) => {
    const parsed = notesInputSchema.safeParse(input);
    if (!parsed.success) return failure("Aby zapisać notatkę, podaj operacja=zapisz i treść od 1 do 1000 znaków. Aby odczytać, podaj tylko operacja=pokaz.");
    if (!token || !validSession(token)) return failure("Sesja wygasła. Zaloguj się ponownie, aby użyć notatek.");
    const now = Date.now();
    for (const [key, bucket] of stores) if (bucket.expiresAt <= now) stores.delete(key);
    let bucket = stores.get(scope);
    if (parsed.data.operacja === "pokaz") return { ok: true as const, notatki: bucket?.notes.map(note => ({ ...note })) ?? [], uwaga: warning, retrievedAt: retrievedAt() };
    if (!bucket) {
      if (stores.size >= 1000) return failure("Pamięć notatek jest pełna. Spróbuj ponownie po wygaśnięciu starszych sesji.");
      const payload = JSON.parse(Buffer.from(token.split(".")[0], "base64url").toString());
      bucket = { expiresAt: payload.exp * 1000, notes: [] }; stores.set(scope, bucket);
    }
    if (bucket.notes.length >= 50) return failure("Osiągnięto limit 50 notatek w sesji. Nie zapisano nowej notatki.");
    const notatka = { id: bucket.notes.length + 1, tresc: parsed.data.tresc!, zapisano: retrievedAt() };
    bucket.notes.push(notatka);
    return { ok: true as const, notatka: { ...notatka }, uwaga: warning, retrievedAt: retrievedAt() };
  };
}
