# Mój chatbot — kurs LABA

Czat korzysta z AI SDK 7.0.157, `@ai-sdk/react` 4.0.161 oraz
`@openrouter/ai-sdk-provider` 3.1.0. Wymaga Node.js 22 lub nowszego.
Zgodność: [OpenRouter](https://github.com/OpenRouterTeam/ai-sdk-provider#setup-for-ai-sdk-v7)
i [interfejs czatu AI SDK 7](https://ai-sdk.dev/docs/ai-sdk-ui/chatbot).
Dokładne wersje zależności zapisuje `package-lock.json`; instalacja: `npm ci`.

## Konfiguracja lokalna

### Hasło warsztatowe i sesja

W `.env.local` ustaw `CHAT_PASSWORD` na własne hasło warsztatowe.
`SESSION_SECRET` został lokalnie wygenerowany kryptograficznie (48 losowych bajtów)
i dopisany do `.env.local` bez odczytywania poprzedniej zawartości ani wypisywania
wartości. Nie zastępuj go pustym polem z `.env.example`.
Po zmianie konfiguracji uruchom ponownie serwer.

Sesja trwa 4 godziny; podpis HMAC-SHA256 i termin ważności są sprawdzane
na serwerze, również przed każdym `/api/chat`. Cookie ma HttpOnly,
SameSite=Strict i w produkcji Secure oraz prefiks `__Host-`.
Cookie zawiera termin i losowy identyfikator, bez hasła.
Brak hasła lub sekret krótszy niż 32 bajty blokuje dostęp.
Zmiana hasła albo sekretu unieważnia wszystkie wcześniejsze sesje.
„Wyjdź” usuwa cookie z przeglądarki i czyści widok rozmowy.
Sesje są bezstanowe: kopia wcześniej skradzionego cookie pozostaje ważna do
wygaśnięcia lub zmiany hasła/sekretu; bez wspólnego magazynu nie prowadzimy listy unieważnień.

### Ograniczenie prób na Vercel

Lokalnie obowiązuje 10 prób logowania na minutę łącznie w procesie.
Restart procesu zeruje ten licznik. Nie jest to globalna ochrona hostingu.

W produkcji kod zawsze używa `@vercel/firewall`, bez lokalnego fallbacku.
W projekcie Vercel otwórz Firewall → Configure → New Rule. Utwórz regułę
z warunkiem `@vercel/firewall`, Rate limit ID `workshop-login`, limitem
10 żądań na 60 sekund i odpowiedzią 429. Zapisz i opublikuj regułę.
Nie dodawaj warunku ścieżki `/api/login`: reguła SDK jest sprawdzana przez
wewnętrzny endpoint zapory. Klucz `workshop-login` współdzieli limit między
wszystkimi próbami i instancjami w danym regionie, niezależnie od IP.
Vercel liczy limity osobno w regionach; nie deklarujemy jednego globalnego
limitu dla całego świata. Próg reguły można zmienić w panelu.

Na Vercel ustaw te same cztery zmienne z `.env.example` w ustawieniach projektu
(sekret wygeneruj odrębnie lokalnie lub przenieś prywatnie, nigdy przez rozmowę).
Standardowe zmienne systemowe Vercel muszą być dostępne. Zapytanie do zapory
używa domeny aktualnego żądania, a nie chronionego adresu `VERCEL_URL`.
Brak reguły, timeout
lub błąd zapory blokuje logowanie komunikatem 503. Inny hosting jest blokowany,
dopóki nie zostanie dodany właściwy współdzielony limiter.
W środowisku Preview zapora SDK może wymagać konfiguracji Protection Bypass
for Automation zgodnie z dokumentacją Vercel.

Dokumentacja: [Vercel Rate Limiting SDK](https://vercel.com/docs/vercel-firewall/vercel-waf/rate-limiting-sdk).

### Sprawdzenia

`npm run test:auth` sprawdza poprawne i błędne hasło, podpis/wygaśnięcie sesji,
wyjście, odmowę `/api/chat`, źródło żądania, limit i bezpieczną odmowę przy
brakującej konfiguracji. Testy mają sztuczne sekrety i blokują połączenia sieciowe.
`npx tsc --noEmit` sprawdza TypeScript.

Ręcznie w przeglądarce sprawdź błędne hasło, poprawne hasło, odświeżenie,
„Wyjdź” i ponowne żądanie hasła. Na Vercel dodatkowo sprawdź cookie Secure
oraz 429 po przekroczeniu limitu i 503 przy wyłączonej regule.
Wysłanie prawdziwej wiadomości do modelu wykonaj samodzielnie.

### Publikacja we własnym GitHub i Vercel

Repozytorium ma należeć do Twojego konta GitHub, nie do organizacji kursu.
Utwórz puste prywatne repozytorium bez README, licencji i .gitignore,
a następnie podłącz je jako `origin` tego projektu i wypchnij bieżącą gałąź.
Sekrety wpisuj wyłącznie lokalnie albo w panelu Vercel; nie dodawaj ich do Git.

W Vercel wybierz Add New → Project i zaimportuj swoje repozytorium.
Framework: Next.js, katalog: główny, Node.js: 22.x,
komenda budowania: `npm run build`, katalog wyjściowy: domyślny.
W ustawieniach Environment Variables dodaj tylko prywatnie wartości:
`OPENROUTER_API_KEY`, `OPENROUTER_MODEL`, `CHAT_PASSWORD`, `SESSION_SECRET`.
Zmiana zmiennych wymaga nowego wdrożenia. Skonfiguruj też opisaną wyżej
regułę zapory `workshop-login`; bez niej logowanie jest blokowane.

Po wdrożeniu sprawdź opublikowany adres w oknie prywatnym: ekran hasła,
błędne hasło, poprawne hasło, odświeżenie i wyjście.
`POST /api/chat` bez cookie musi zwrócić 401, bez wywołania modelu.
Potwierdź HttpOnly, SameSite=Strict i Secure w cookie oraz działanie limitu.
Dopiero potem wykonaj samodzielnie próbę rozmowy z modelem (możliwa opłata).
Publikację uznajemy za zakończoną po tych sprawdzeniach na działającym linku.

### Konfiguracja modelu

W głównym folderze projektu utwórz samodzielnie `.env.local` (jeśli już istnieje,
uzupełnij go zamiast zastępować). Wpisz lokalnie dwie wartości:

```dotenv
OPENROUTER_API_KEY=
OPENROUTER_MODEL=
```

Po pierwszym `=` wpisz swój klucz OpenRouter, a po drugim dokładny identyfikator
wybranego modelu z OpenRouter, w formacie `dostawca/model`.
Pusty wzór znajduje się również w `.env.example`.
Klucza nie wklejaj do rozmowy ani do kodu strony. Nie dodawaj przedrostka
`NEXT_PUBLIC_`: konfiguracja jest używana wyłącznie w serwerowym `/api/chat`.
Git ignoruje `.env` i `.env.local`.

Po zapisaniu konfiguracji uruchom ponownie serwer (`Ctrl+C`, potem `npm run dev`)
i otwórz adres podany w terminalu, zwykle http://localhost:3000.
Bez konfiguracji wysłanie wiadomości pokaże komunikat o brakujących zmiennych.
Pierwszą prawdziwą wiadomość wyślij samodzielnie w przeglądarce; może naliczyć
opłatę w OpenRouter. Historia istnieje tylko w bieżącej karcie i znika po odświeżeniu.

---

This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
