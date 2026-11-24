import { verifiedUser } from "../../../lib/auth";
import { sameOrigin } from "../../../lib/request-origin";
import { TaskBudget } from "../../../lib/task-budget";
import { readChatBody } from "../../../lib/chat-upload";
import { dashboardApiRequestSchema } from "../../../lib/dashboard-schema";
import { loadTravelComparison } from "../../../lib/dashboard-comparison";
import { DashboardFailure, loadTravelDashboard } from "../../../lib/travel-dashboard";

export const maxDuration = 65;
export async function POST(request: Request) {
  const headers = { "Cache-Control": "no-store" };
  const fail = (code: string, message: string, status: number, choices?: DashboardFailure["choices"]) => Response.json({ error: { code, message }, ...(choices ? { choices } : {}) }, { status, headers });
  // Pierwsza operacja: sesja, zanim odczytamy body lub uruchomimy źródła i model.
  if (!(await verifiedUser(request))) return fail("unauthorized", "Sesja wygasła. Zaloguj się ponownie.", 401);
  if (!sameOrigin(request)) return fail("forbidden", "Niedozwolone źródło żądania.", 403);
  const budget = new TaskBudget(request.signal);
  try {
    const parsed = dashboardApiRequestSchema.safeParse(await budget.waitFor(readChatBody(request)));
    if (!parsed.success) return fail("invalid_request", "Podaj miasto (lub dwa różne miasta w trybie Porównaj) i prawdziwą datę od 1970 do 2100 roku. Nie można nadpisywać modelu ani uprawnień.", 400);
    const key = process.env.OPENROUTER_API_KEY?.trim(), model = process.env.OPENROUTER_MODEL?.trim();
    const result = "mode" in parsed.data
      ? await budget.waitFor(loadTravelComparison(parsed.data, budget, key, model))
      : await budget.waitFor(loadTravelDashboard(parsed.data, budget, key, model));
    return Response.json(result, { headers });
  } catch (error) {
    if (budget.reason === "time_limit") return fail("task_timeout", "Upłynął limit 60 sekund. Spróbuj ponownie.", 408);
    if (error instanceof DashboardFailure) return fail(error.code, error.message, error.code === "location_unavailable" ? 502 : 422, error.choices);
    return fail("dashboard_error", "Nie udało się przygotować danych podróży. Sprawdź dane lub spróbuj ponownie później.", 502);
  } finally { budget.dispose(); }
}
