import { loadUserProfile, editUserProfile, ProfileError } from "../../../lib/user-profile";
import { profileEditSchema } from "../../../lib/profile-edit";
import { sameOrigin, sessionFromRequest, validSession } from "../../../lib/session";

const headers = { "Cache-Control": "no-store" };
function denied(request: Request, mutation = false) {
  if (!validSession(sessionFromRequest(request))) return Response.json({ error: { message: "Sesja wygasła. Zaloguj się ponownie." } }, { status: 401, headers });
  if (mutation && !sameOrigin(request)) return Response.json({ error: { message: "Niedozwolone źródło żądania." } }, { status: 403, headers });
}
function failed(error: unknown) {
  return Response.json({ error: { message: error instanceof ProfileError ? error.message : "Nie udało się odczytać lub zmienić profilu. Sprawdź konfigurację Supabase na serwerze." } }, { status: error instanceof ProfileError ? error.status : 503, headers });
}
export async function GET(request: Request) {
  const rejection = denied(request); if (rejection) return rejection;
  try { return Response.json(await loadUserProfile(request), { headers }); } catch (error) { return failed(error); }
}
export async function PATCH(request: Request) {
  const rejection = denied(request, true); if (rejection) return rejection;
  let body: unknown;
  try { body = await request.json(); } catch { return Response.json({ error: { message: "Nieprawidłowe dane profilu." } }, { status: 400, headers }); }
  const parsed = profileEditSchema.safeParse(body);
  if (!parsed.success || parsed.data.action === "clear") return Response.json({ error: { message: "Nieprawidłowa zmiana profilu." } }, { status: 400, headers });
  try { return Response.json(await editUserProfile(request, parsed.data), { headers }); } catch (error) { return failed(error); }
}
export async function DELETE(request: Request) {
  const rejection = denied(request, true); if (rejection) return rejection;
  try { return Response.json(await editUserProfile(request, { action: "clear" }), { headers }); } catch (error) { return failed(error); }
}
