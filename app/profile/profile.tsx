"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { UserProfile } from "../../lib/profile-rules";
import { contactTimes } from "../../lib/profile-rules";
import type { ProfileEdit } from "../../lib/profile-edit";
import ThemeToggle from "../theme-toggle";
import styles from "./profile.module.css";

const labels: Record<string, string> = { miasto: "Miejsce zamieszkania", ulubione_jedzenie: "Ulubiona potrawa", lubiane_jedzenie: "Lubiane jedzenie", styl_odpowiedzi: "Styl odpowiedzi", ulubiony_napoj: "Ulubiony napój", ulubiony_kolor: "Ulubiony kolor", hobby: "Hobby", jezyk: "Język", preferowana_pora_konsultacji: "Pora konsultacji", preferowany_czas_kontaktu: "Preferowany czas kontaktu" };

export default function Profile() {
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [name, setName] = useState("");
  const [preferences, setPreferences] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const pending = useRef(false);
  function apply(value: UserProfile) { setProfile(value); setName(value.name ?? ""); setPreferences(value.preferences); }
  async function load(signal?: AbortSignal) {
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch("/api/profile", { cache: "no-store", signal });
      if (response.status === 401) { window.location.replace("/"); return; }
      const body = await response.json();
      if (!response.ok) throw new Error(body.error?.message || "Nie udało się wczytać profilu.");
      if (!signal?.aborted) apply(body);
    } catch (error) { if (!signal?.aborted) setError(error instanceof Error ? error.message : "Nie udało się wczytać profilu."); }
    finally { if (!signal?.aborted) setBusy(false); }
  }
  useEffect(() => { const controller = new AbortController(); void load(controller.signal); return () => controller.abort(); }, []);
  async function change(edit: ProfileEdit, message: string) {
    if (pending.current || busy) return;
    if (edit.action === "clear" && !window.confirm("Wyczyścić imię i wszystkie preferencje? Zapisane rozmowy pozostaną w historii.")) return;
    pending.current = true; setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch("/api/profile", { method: edit.action === "clear" ? "DELETE" : "PATCH", headers: { "Content-Type": "application/json" }, ...(edit.action === "clear" ? {} : { body: JSON.stringify(edit) }) });
      if (response.status === 401) { window.location.replace("/"); return; }
      const body = await response.json();
      if (!response.ok) throw new Error(body.error?.message || "Nie udało się zmienić profilu.");
      apply(body); setNotice(message);
    } catch (error) { setError(error instanceof Error ? error.message : "Nie udało się zmienić profilu."); }
    finally { pending.current = false; setBusy(false); }
  }
  return <main className={styles.page}>
    <header className={styles.header}><div><p>STUDIO NOVA</p><h1>Twój profil</h1></div><ThemeToggle /></header>
    <nav className={styles.controls} aria-label="Nawigacja profilu"><Link href="/" prefetch={false}>Wróć do czatu</Link><Link href="/?new=1" prefetch={false}>Nowa rozmowa</Link><Link href="/history" prefetch={false}>Historia</Link></nav>
    <p>Tu widzisz, co o Tobie pamiętam. Możesz poprawić lub usunąć każdą informację.</p>
    {busy && <p role="status">{profile ? "Zapisuję zmiany…" : "Wczytuję profil…"}</p>}
    {error && <p className={styles.error} role="alert">{error} <button disabled={busy} onClick={() => void load()}>Odśwież profil</button></p>}
    {notice && <p role="status">{notice}</p>}
    {profile && <section aria-label="Zapisany profil" aria-busy={busy}>
      <form className={styles.row} onSubmit={event => { event.preventDefault(); void change({ action: "set-name", value: name.trim() || null }, "Zapisano imię."); }}>
        <label htmlFor="profile-name">Imię</label>
        <input id="profile-name" value={name} maxLength={60} disabled={busy} autoComplete="given-name" placeholder="Jak mam się do Ciebie zwracać?" onChange={event => setName(event.target.value)} />
        <div className={styles.controls}><button disabled={busy || name.trim() === (profile.name ?? "")} type="submit">Zapisz imię</button><button type="button" disabled={busy || !profile.name} onClick={() => void change({ action: "set-name", value: null }, "Usunięto imię.")}>Usuń imię</button></div>
      </form>
      <h2>Preferencje</h2>
      {!Object.keys(profile.preferences).length && <p>Nie mam jeszcze zapisanych preferencji. Opowiedz mi w czacie, co lubisz i jak mam odpowiadać.</p>}
      {[...new Set([...Object.keys(profile.preferences), "ulubiony_kolor", "preferowany_czas_kontaktu"])].map((key, index) => <form key={key} className={styles.row} onSubmit={event => { event.preventDefault(); void change({ action: "set-preference", key, value: (preferences[key] ?? "").trim() }, "Zapisano preferencję."); }}>
        <label htmlFor={`preference-${index}`}>{labels[key] ?? key}</label>
        {key === "preferowany_czas_kontaktu"
          ? <select id={`preference-${index}`} value={preferences[key] ?? ""} required disabled={busy} onChange={event => setPreferences(current => ({ ...current, [key]: event.target.value }))}><option value="">Wybierz czas kontaktu</option>{contactTimes.map(time => <option key={time} value={time}>{time}</option>)}</select>
          : <input id={`preference-${index}`} value={preferences[key] ?? ""} required maxLength={160} disabled={busy} onChange={event => setPreferences(current => ({ ...current, [key]: event.target.value }))} />}
        {key === "styl_odpowiedzi" && <small>Wpisz: krótko lub długo (polskie znaki są opcjonalne).</small>}
        <div className={styles.controls}><button type="submit" disabled={busy || !(preferences[key] ?? "").trim() || (preferences[key] ?? "").trim() === profile.preferences[key]} aria-label={`Zapisz: ${labels[key] ?? key}`}>Zapisz</button><button type="button" disabled={busy || !profile.preferences[key]} aria-label={`Usuń: ${labels[key] ?? key}`} onClick={() => void change({ action: "remove-preference", key }, "Usunięto preferencję.")}>Usuń</button></div>
      </form>)}
      <div className={styles.clear}><button type="button" disabled={busy || (!profile.name && !Object.keys(profile.preferences).length)} onClick={() => void change({ action: "clear" }, "Wyczyszczono cały profil.")}>Wyczyść cały profil</button><p>Usuwa zapamiętane imię i preferencje. Rozmowy pozostają w historii.</p></div>
    </section>}
  </main>;
}
