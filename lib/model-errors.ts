import { APICallError, StreamProviderError } from "ai";

// Tylko stałe komunikaty i kod HTTP. Surowe body i wiadomości dostawcy
// mogą zawierać fragmenty promptu lub konfiguracji i nie trafiają do UI.
export function modelHttpError(status?: number) {
  const messages: Record<number, string> = {
    401: "OpenRouter odrzucił klucz API. Sprawdź konfigurację na serwerze.",
    402: "OpenRouter zgłosił brak środków lub wyczerpany budżet konta.",
    403: "OpenRouter odmówił dostępu. Sprawdź uprawnienia i ograniczenia konta.",
    408: "OpenRouter zgłosił przekroczenie czasu oczekiwania.",
    429: "OpenRouter lub dostawca modelu ograniczył liczbę żądań. Spróbuj ponownie później.",
    500: "OpenRouter lub dostawca modelu zgłosił błąd serwera.",
    502: "OpenRouter otrzymał nieprawidłową odpowiedź od dostawcy modelu.",
    503: "Model lub jego dostawca jest chwilowo niedostępny.",
    504: "Przekroczono czas oczekiwania po stronie dostawcy modelu.",
  };
  return status && Number.isInteger(status) && status >= 400 && status <= 599
    ? `[OPENROUTER_HTTP_${status}] ${messages[status] ?? "OpenRouter odrzucił żądanie. Sprawdź ustawienia modelu."}`
    : "[OPENROUTER_STREAM] Nie udało się dokończyć odpowiedzi modelu. Zachowano dostępny wynik częściowy.";
}

export function modelErrorMessage(error: unknown) {
  if (APICallError.isInstance(error)) return modelHttpError(error.statusCode);
  if (StreamProviderError.isInstance(error)) return modelHttpError(error.statusCode ?? Number(error.code));
  return modelHttpError();
}
