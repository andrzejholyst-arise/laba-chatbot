// Imię i avatar do nagłówka. Dane konta Google trafiają do user_metadata; pola czytamy ostrożnie,
// bo każde może nie istnieć (konto e-mail nie ma żadnego). Zwracamy tylko krótki tekst i adres https.
type Metadata = Record<string, unknown> | null | undefined;
const text = (value: unknown, max: number) => typeof value === "string" ? value.trim().slice(0, max) : "";

export function accountDisplay(metadata: Metadata) {
  const meta = metadata ?? {};
  const name = text(meta.full_name, 80) || text(meta.name, 80) || null;
  let avatarUrl: string | null = null;
  for (const candidate of [meta.avatar_url, meta.picture]) {
    const value = text(candidate, 500);
    if (!value) continue;
    try { if (new URL(value).protocol === "https:") { avatarUrl = value; break; } } catch { /* Nieprawidłowy adres pomijamy. */ }
  }
  return { name, avatarUrl };
}

// Imię do profilu: pierwsze słowo pełnej nazwy konta (np. „Anna Nowak” → „Anna”).
export function givenName(fullName: string | null) {
  const first = fullName?.trim().split(/\s+/)[0] ?? "";
  return first || null;
}
