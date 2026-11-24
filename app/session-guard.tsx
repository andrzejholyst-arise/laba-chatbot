"use client";
import { useEffect } from "react";

// Przeglądarka potrafi przywrócić stronę z pamięci podręcznej po „Wstecz”.
// Wtedy wymuszamy ponowne żądanie, które serwer sprawdzi pod kątem sesji.
export default function SessionGuard() {
  useEffect(() => {
    const onShow = (event: PageTransitionEvent) => { if (event.persisted) window.location.reload(); };
    window.addEventListener("pageshow", onShow);
    return () => window.removeEventListener("pageshow", onShow);
  }, []);
  return null;
}
