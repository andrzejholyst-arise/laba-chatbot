"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { DOCUMENT_CONTENT_LIMIT, documentInputSchema, importStages, type ImportStage, type KnowledgeSummary, type ChunkingMode } from "../../lib/knowledge-document";
import { readKnowledgeImport } from "../../lib/knowledge-stream";
import ThemeToggle from "../theme-toggle";
import styles from "./upload.module.css";

const dates = new Intl.DateTimeFormat("pl-PL", { dateStyle: "medium", timeStyle: "medium", timeZone: "Europe/Warsaw" });
export default function Upload() {
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [chunkingMode, setChunkingMode] = useState<ChunkingMode>("paragraphs");
  const [attempted, setAttempted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState<ImportStage | null>(null);
  const stageRef = useRef<ImportStage>("splitting");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [documents, setDocuments] = useState<KnowledgeSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [listReady, setListReady] = useState(false);
  const [listError, setListError] = useState("");
  const pending = useRef(false);
  const titleError = (attempted || title.length > 0) && !title.trim() ? "Podaj tytuł dokumentu." : "";
  const contentError = (attempted || content.length > 0) && !content.trim() ? "Wklej treść dokumentu." : "";
  async function load(signal?: AbortSignal) {
    setLoading(true); setListError("");
    try {
      const response = await fetch("/api/knowledge", { cache: "no-store", signal });
      if (response.status === 401) { window.location.replace("/"); return; }
      const body = await response.json();
      if (!response.ok) throw new Error(body.error?.message || "Nie udało się wczytać listy. Spróbuj ją odświeżyć.");
      if (!signal?.aborted) { setDocuments(body.documents); setListReady(true); }
    } catch (error) { if (!signal?.aborted) { setListError(error instanceof Error ? error.message : "Nie udało się wczytać listy."); setListReady(false); } }
    finally { if (!signal?.aborted) setLoading(false); }
  }
  useEffect(() => { const controller = new AbortController(); void load(controller.signal); return () => controller.abort(); }, []);
  function progress(value: ImportStage) { stageRef.current = value; setStage(value); }
  async function submit() {
    if (pending.current || !listReady || loading) return;
    setAttempted(true); setError(""); setSuccess("");
    const parsed = documentInputSchema.safeParse({ title, content, chunkingMode });
    if (!parsed.success) return;
    const matching = documents.filter(doc => doc.title.trim().toLowerCase() === parsed.data.title.toLowerCase());
    if (matching.length && !window.confirm(`Zastąpić dokument „${parsed.data.title}”? Jego poprzednia wersja i stare fragmenty zostaną zastąpione nową treścią.`)) return;
    pending.current = true; setBusy(true); progress("splitting");
    try {
      const response = await fetch("/api/knowledge", { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/x-ndjson" }, body: JSON.stringify({ ...parsed.data, expectedVersions: matching.map(({ id, createdAt }) => ({ id, createdAt })) }) });
      if (response.status === 401) { window.location.replace("/"); return; }
      const body = await readKnowledgeImport(response, progress);
      setSuccess(`Zapisano dokument „${body.title}”: ${body.chunkCount} fragmentów. Wszystkie fragmenty mają embeddingi.${body.backfilledCount ? ` Uzupełniono też ${body.backfilledCount} wcześniejszych fragmentów.` : ""}`);
      setTitle(""); setContent(""); setAttempted(false);
      await load();
    } catch (error) {
      const message = error instanceof Error && !(error instanceof TypeError) && !(error instanceof SyntaxError) ? error.message : "Połączenie zostało przerwane. Odśwież listę dokumentów przed kolejną próbą; treść formularza została zachowana.";
      setError(`Etap: ${importStages[stageRef.current]} ${message}`);
    } finally { pending.current = false; setBusy(false); setStage(null); }
  }
  async function remove(doc: KnowledgeSummary) {
    if (pending.current || loading || !window.confirm(`Usunąć dokument „${doc.title}” wraz ze wszystkimi fragmentami? Tej operacji nie można cofnąć.`)) return;
    pending.current = true; setBusy(true); setError(""); setSuccess("");
    try {
      const response = await fetch("/api/knowledge", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: doc.id, createdAt: doc.createdAt }) });
      if (response.status === 401) { window.location.replace("/"); return; }
      if (!response.ok) { const body = await response.json(); throw new Error(body.error?.message || "Nie udało się usunąć dokumentu. Odśwież listę."); }
      setSuccess(`Usunięto dokument „${doc.title}”.`); await load();
    } catch (error) { setError(`Usuwanie: ${error instanceof Error ? error.message : "Nie udało się połączyć. Odśwież listę przed kolejną próbą."}`); }
    finally { pending.current = false; setBusy(false); }
  }
  return <main className={styles.page}>
    <header className={styles.header}><div><p>STUDIO NOVA</p><h1>Baza wiedzy</h1></div><ThemeToggle /></header>
    <nav className={styles.navigation}><Link href="/" prefetch={false}>Wróć do czatu</Link><Link href="/history" prefetch={false}>Historia</Link><Link href="/profile" prefetch={false}>Profil</Link></nav>
    <p>Dodaj cennik, FAQ lub zasady Studio Nova. Oddziel akapity pustą linią.</p>
    <form noValidate aria-busy={busy} onSubmit={event => { event.preventDefault(); void submit(); }}>
      <label htmlFor="document-title">Tytuł</label>
      <input id="document-title" value={title} maxLength={200} required disabled={busy} aria-invalid={!!titleError} aria-describedby={titleError ? "title-error" : undefined} onBlur={() => { if (!title.trim()) setAttempted(true); }} onChange={event => { setTitle(event.target.value); setSuccess(""); }} />
      {titleError && <p id="title-error" className={styles.error} role="alert">{titleError}</p>}
      <label htmlFor="document-content">Treść</label>
      <textarea id="document-content" rows={18} value={content} maxLength={DOCUMENT_CONTENT_LIMIT} required disabled={busy} aria-invalid={!!contentError} aria-describedby={`content-count${contentError ? " content-error" : ""}`} onBlur={() => { if (!content.trim()) setAttempted(true); }} onChange={event => { setContent(event.target.value); setSuccess(""); }} />
      <small id="content-count">{content.length.toLocaleString("pl-PL")} / 20 000 znaków</small>
      {contentError && <p id="content-error" className={styles.error} role="alert">{contentError}</p>}
      <label htmlFor="document-chunking">Sposób dzielenia</label>
      <select id="document-chunking" value={chunkingMode} disabled={busy} onChange={event => setChunkingMode(event.target.value as ChunkingMode)}>
        <option value="paragraphs">akapity</option>
        <option value="fixed">stałe kawałki — 300 znaków, zakładka 50 znaków</option>
      </select>
      <button type="submit" disabled={busy || loading || !listReady}>{stage ? importStages[stage] : "Dodaj do bazy wiedzy"}</button>
      {stage && <ol className={styles.progress} aria-label="Etapy importu">{(Object.keys(importStages) as ImportStage[]).map(value => <li key={value} aria-current={value === stage ? "step" : undefined}>{importStages[value]}</li>)}</ol>}
      {stage && <p role="status">{importStages[stage]}</p>}
      {error && <p className={styles.error} role="alert">{error}</p>}
      {success && <p className={styles.success} role="status">{success}</p>}
    </form>
    <section className={styles.documents} aria-labelledby="documents-heading" aria-busy={loading}>
      <div className={styles.header}><h2 id="documents-heading">Dokumenty w bazie</h2><button disabled={busy || loading} onClick={() => void load()}>Odśwież listę</button></div>
      <p>Tytuł jest nazwą źródła. Data dodania określa jego wersję.</p>
      {loading && <p role="status">Wczytuję dokumenty…</p>}
      {listError && <p role="alert" className={styles.error}>{listError}</p>}
      {listReady && !loading && !documents.length && <p>Dodaj pierwszy dokument, aby Studio Nova mogło korzystać z Twojej wiedzy.</p>}
      <ul className={styles.list} aria-label="Dokumenty w bazie">{documents.map(doc => <li key={doc.id}>
        <div><strong>{doc.title}</strong><p>Wersja: <time dateTime={doc.createdAt}>{dates.format(new Date(doc.createdAt))}</time> · Liczba fragmentów: {doc.chunkCount}</p></div>
        <button type="button" disabled={busy || loading} aria-label={`Usuń dokument: ${doc.title}`} onClick={() => void remove(doc)}>Usuń</button>
      </li>)}</ul>
    </section>
  </main>;
}
