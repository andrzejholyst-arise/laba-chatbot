"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { ConversationHistory, ConversationSummary } from "../../lib/conversation-history";
import ThemeToggle from "../theme-toggle";
import styles from "./history.module.css";

const dateFormat = new Intl.DateTimeFormat("pl-PL", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Warsaw" });

export default function History() {
  const [items, setItems] = useState<ConversationSummary[]>([]);
  const [nextOffset, setNextOffset] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const pending = useRef(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const deletePending = useRef(false);

  async function remove(item: ConversationSummary) {
    if (deletePending.current || pending.current) return;
    if (!window.confirm(`Usunąć rozmowę „${item.title}” wraz ze wszystkimi wiadomościami? Tej operacji nie można cofnąć.`)) return;
    deletePending.current = true;
    setDeleting(item.conversationId); setError("");
    try {
      const response = await fetch(`/api/conversations?id=${item.conversationId}`, { method: "DELETE" });
      if (response.status === 401) { window.location.replace("/"); return; }
      if (!response.ok) {
        const body = await response.json();
        throw new Error(body.error?.message || "Nie udało się usunąć rozmowy.");
      }
      setItems(current => current.filter(row => row.conversationId !== item.conversationId));
      await load();
    } catch (error) {
      setError(error instanceof Error ? error.message : "Nie udało się usunąć rozmowy.");
    } finally { deletePending.current = false; setDeleting(null); }
  }

  async function load(offset = 0, signal?: AbortSignal) {
    if (pending.current) return;
    pending.current = true;
    setLoading(true); setError("");
    try {
      const response = await fetch(`/api/conversations?list=1&offset=${offset}`, { cache: "no-store", signal });
      if (response.status === 401) { window.location.replace("/"); return; }
      const body = await response.json();
      if (!response.ok) throw new Error(body.error?.message || "Nie udało się wczytać historii.");
      if (signal?.aborted) return;
      const result = body as ConversationHistory;
      setItems(current => offset === 0 ? result.conversations : [...new Map([...current, ...result.conversations].map(item => [item.conversationId, item])).values()]);
      setNextOffset(result.nextOffset);
    } catch (error) {
      if (!signal?.aborted) setError(error instanceof Error ? error.message : "Nie udało się wczytać historii.");
    } finally {
      pending.current = false;
      if (!signal?.aborted) setLoading(false);
    }
  }

  useEffect(() => {
    const controller = new AbortController();
    void load(0, controller.signal);
    return () => { controller.abort(); pending.current = false; };
  }, []);

  return <main className={styles.page}>
    <aside className={styles.sidebar}>
      <Link href="/" prefetch={false} className={styles.brand}>Studio Nova</Link>
      <p>Twoje rozmowy</p>
      <Link href="/?new=1" prefetch={false} className={styles.newChat}>＋ Nowa rozmowa</Link>
      <Link href="/" prefetch={false}>Wróć do czatu →</Link>
      <ThemeToggle />
    </aside>
    <section className={styles.content} aria-labelledby="history-title" aria-busy={loading}>
      <header className={styles.header}>
        <div><p className={styles.eyebrow}>STUDIO NOVA</p><h1 id="history-title">Historia rozmów</h1></div>
        <button type="button" disabled={loading || !!deleting} onClick={() => void load()}>Odśwież</button>
      </header>
      <p className={styles.description}>Wybierz rozmowę, aby wrócić do niej i kontynuować.</p>
      {error && <p className={styles.error} role="alert">{error} <button type="button" disabled={loading} onClick={() => void load()}>Spróbuj ponownie</button></p>}
      {loading && <p role="status">Wczytuję historię…</p>}
      {!loading && !error && !items.length && <div className={styles.empty}>
        <h2>Ułóżmy pierwszą dobrą odpowiedź</h2>
        <p>Masz wiadomość od klienta? Wklej ją w czacie, a pomogę Ci przygotować krótką, uprzejmą odpowiedź w stylu Studio Nova.</p>
        <Link href="/?new=1" prefetch={false}>Zacznijmy rozmowę →</Link>
      </div>}
      <ol className={styles.list} aria-label="Zapisane rozmowy">
        {items.map(item => <li key={item.conversationId} className={styles.item}>
          <Link href={`/?conversation=${item.conversationId}`} prefetch={false} className={styles.row}>
            <span className={styles.icon} aria-hidden="true">↗</span>
            <span className={styles.details}><strong>{item.title}</strong><span>
              <time dateTime={item.createdAt}>{dateFormat.format(new Date(item.createdAt))}</time>
              <span> · Liczba wiadomości: {item.messageCount}</span>
            </span></span>
            <span aria-hidden="true">→</span>
          </Link>
          <button type="button" className={styles.deleteButton} disabled={loading || !!deleting}
            aria-label={`Usuń rozmowę: ${item.title}`} onClick={() => void remove(item)}>
            {deleting === item.conversationId ? "Usuwam…" : "Usuń"}
          </button>
        </li>)}
      </ol>
      {nextOffset !== null && <button type="button" disabled={loading || !!deleting} onClick={() => void load(nextOffset)}>Pokaż starsze rozmowy</button>}
    </section>
  </main>;
}
