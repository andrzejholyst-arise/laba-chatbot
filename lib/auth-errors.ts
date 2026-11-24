export function authErrorMessage(code?: string, status?: number) {
  switch (code) {
    case "invalid_credentials": return "Nieprawidłowy e-mail lub hasło.";
    case "user_already_exists": case "email_exists": return "Konto z tym adresem e-mail już istnieje. Zaloguj się.";
    case "weak_password": return "Hasło musi mieć minimum 8 znaków i spełniać wymagania bezpieczeństwa konta.";
    case "email_not_confirmed": return "Potwierdź adres e-mail, klikając link w wiadomości od Supabase.";
    case "email_address_not_authorized":
      return "Supabase nie może wysłać potwierdzenia na ten adres. Użyj adresu członka zespołu projektu albo skonfiguruj własny SMTP. [email_address_not_authorized]";
    case "over_email_send_rate_limit":
      return "Supabase osiągnął limit wysyłki e-maili. Spróbuj ponownie później. [over_email_send_rate_limit]";
    case "over_request_rate_limit":
      return "Za dużo prób. Odczekaj chwilę i spróbuj ponownie. [over_request_rate_limit]";
    case "email_provider_disabled":
      return "Włącz logowanie e-mailem w ustawieniach Authentication projektu Supabase. [email_provider_disabled]";
    case "request_timeout":
      return "Supabase Auth nie odpowiedział na czas. Spróbuj ponownie za chwilę. [request_timeout]";
    case "unexpected_failure":
      return "Supabase Auth zgłosił błąd. Sprawdź logi Auth projektu w Supabase. [unexpected_failure]";
    case "email_address_invalid": case "validation_failed": return "Sprawdź poprawność adresu e-mail i hasła.";
    case "signup_disabled": return "Rejestracja jest obecnie wyłączona. Skontaktuj się z właścicielem aplikacji.";
  }
  if (status === 401 || status === 403) {
    return `Supabase odrzucił żądanie. Sprawdź, czy publiczny adres i klucz publishable pochodzą z tego samego projektu. [HTTP ${status}]`;
  }
  if (status === 429) {
    return "Za dużo prób. Odczekaj chwilę i spróbuj ponownie. [HTTP 429]";
  }
  if (status === 0) {
    return "Nie udało się połączyć z Supabase Auth. Sprawdź połączenie i publiczny adres projektu. [AUTH_CONNECTION]";
  }
  if (typeof status === "number" && Number.isInteger(status) && status >= 400 && status <= 599) {
    return `Nie udało się wykonać tej operacji. Sprawdź logi Auth projektu w Supabase. [HTTP ${status}]`;
  }
  return "Nie udało się wykonać tej operacji. Sprawdź logi Auth projektu w Supabase. [AUTH_UNKNOWN]";
}

// Komunikaty dla parametru ?error= na stronie logowania (trasy /auth/callback i /auth/google).
export function callbackErrorMessage(code: string | null) {
  switch (code) {
    case "google_cancelled": return "Logowanie przez Google zostało anulowane. Możesz spróbować ponownie albo zalogować się e-mailem.";
    case "google_unavailable": return "Logowanie przez Google jest teraz niedostępne. Zaloguj się e-mailem lub spróbuj później.";
    case "google_failed": return "Nie udało się zalogować przez Google. Spróbuj ponownie albo zaloguj się e-mailem.";
    case "confirmation": return "Link potwierdzający wygasł lub jest nieprawidłowy. Spróbuj zalogować się ponownie.";
    default: return code ? "Nie udało się zalogować. Spróbuj ponownie." : "";
  }
}
