"use client";

import { useEffect, useState } from "react";
import styles from "./chat.module.css";

type Theme = "system" | "light" | "dark";
const key = "studio-nova-theme";
const valid = (value: string | null): Theme => value === "light" || value === "dark" ? value : "system";
function apply(theme: Theme) {
  if (theme === "system") document.documentElement.removeAttribute("data-theme");
  else document.documentElement.dataset.theme = theme;
}

export default function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>("system");
  useEffect(() => {
    const sync = () => {
      let next: Theme = "system";
      try { next = valid(localStorage.getItem(key)); } catch { /* Motyw systemowy działa też bez pamięci. */ }
      setTheme(next); apply(next);
    };
    sync();
    const onStorage = (event: StorageEvent) => { if (event.key === key || event.key === null) sync(); };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);
  const next: Theme = theme === "system" ? "light" : theme === "light" ? "dark" : "system";
  const labels = { system: "System", light: "Jasny", dark: "Ciemny" };
  return <button className={styles.themeToggle} type="button"
    aria-label={`Motyw: ${labels[theme]}. Przełącz na ${labels[next].toLowerCase()}`}
    title="Zmień motyw: system → jasny → ciemny" onClick={() => {
      setTheme(next); apply(next);
      try { localStorage.setItem(key, next); } catch { /* Wybór nadal działa w bieżącej karcie. */ }
    }}>
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
      <circle cx="12" cy="12" r="8" /><path d="M12 4a8 8 0 0 1 0 16Z" fill="currentColor" stroke="none" />
    </svg>
    {labels[theme]}
  </button>;
}
