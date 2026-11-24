// Dopuszczamy tylko adresy wewnątrz aplikacji. Wszystko inne wraca na stronę główną.
export function safeNext(value: string | null | undefined): string {
  if (!value || value.length > 512 || !value.startsWith("/") || value.startsWith("//") ||
    value.includes("\\") || /[\u0000-\u001f\u007f]/.test(value)) return "/";
  try {
    const url = new URL(value, "http://app.invalid");
    if (url.origin !== "http://app.invalid") return "/";
    if (url.pathname === "/login" || url.pathname.startsWith("/auth/") || url.pathname.startsWith("/api/")) return "/";
    return url.pathname + url.search;
  } catch { return "/"; }
}
