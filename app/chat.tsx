"use client";

import { useChat } from "@ai-sdk/react";
import { useEffect, useRef, useState } from "react";
import styles from "./chat.module.css";
import MessageAnalysis from "./analysis";
import PromptDemo from "./prompt-demo";
import type { DemoCase } from "../lib/demo-evaluation";
import type { ChatMessage } from "../lib/chat-message";
import MessageSources from "./message-sources";
import SpeechResponse from "./speech-response";
import GeneratedImage from "./generated-image";
import { usedChatTools } from "../lib/used-chat-tools";
import { chatTransport } from "../lib/chat-transport";
import { safeImageDataUrl, validatePhotoFile } from "../lib/image-files";

const imageSuggestions = [
  { label: "Konsultacja online", prompt: "Przyjazna ilustracja konsultacji online: osoba przy laptopie, spokojna atmosfera, miękkie światło, nowoczesny styl, bez napisów." },
  { label: "Grafika Studio Nova", prompt: "Minimalistyczna grafika promująca konsultacje online Studio Nova: laptop, delikatne abstrakcyjne kształty, jasne kolory, miejsce na własny tekst, bez cen i dat." },
  { label: "Miejsce do rozmowy", prompt: "Przytulne domowe miejsce do konsultacji online: biurko z laptopem, roślina i notes, naturalne światło, spokojny fotograficzny styl, bez ludzi i napisów." },
];

export default function Chat({ demoCases }: { demoCases: DemoCase[] }) {
  const { messages, sendMessage, status, error, clearError, stop } = useChat<ChatMessage>({ transport: chatTransport });
  const [input, setInput] = useState("");
  const [leaving, setLeaving] = useState(false);
  const [logoutError, setLogoutError] = useState("");
  const [mode, setMode] = useState<"chat" | "analysis" | "demo">("chat");
  const conversation = useRef<HTMLElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const messageInput = useRef<HTMLInputElement>(null);
  const [photo, setPhoto] = useState<FileList>();
  const [imageBusy, setImageBusy] = useState(false);
  const [imageError, setImageError] = useState("");
  const [photoValidating, setPhotoValidating] = useState(false);
  const photoValidation = useRef(false);
  const imageGeneration = useRef(false);
  const messageSending = useRef(false);
  const [voiceBusy, setVoiceBusy] = useState(false);
  const busy = status === "submitted" || status === "streaming" || imageBusy || voiceBusy || photoValidating;

  useEffect(() => () => { void stop(); }, [stop]);

  async function sendText(responseFormat: "text" | "audio" = "text") {
    const text = input.trim();
    if (!text || busy || leaving || messageSending.current || imageGeneration.current || photoValidation.current) return;
    messageSending.current = true;
    setVoiceBusy(responseFormat === "audio");
    clearError(); setInput(""); setImageError("");
    const files = photo;
    setPhoto(undefined);
    if (fileInput.current) fileInput.current.value = "";
    try { await sendMessage({ text, files }, { body: { responseFormat } }); }
    catch { setImageError("Nie udało się wysłać wiadomości. Spróbuj ponownie."); }
    finally { messageSending.current = false; setVoiceBusy(false); }
  }

  async function generatePicture() {
    const prompt = input.trim();
    // Ref blokuje kolejne kliknięcie również przed następnym renderem Reacta.
    if (!prompt || busy || leaving || messageSending.current || imageGeneration.current || photoValidation.current) return;
    setImageError("");
    if (prompt.length > 500) { setImageError("Opis obrazu może mieć maksymalnie 500 znaków."); return; }
    if (photo?.length) { setImageError("Usuń załączone zdjęcie, aby wygenerować nowy obraz z opisu."); return; }
    imageGeneration.current = true;
    setImageBusy(true);
    clearError();
    setInput("");
    const timer = window.setTimeout(() => { void stop(); }, 55_000);
    try {
      await sendMessage({ text: `Wygeneruj obraz: ${prompt}` });
    } catch {
      setImageError("Nie udało się uruchomić generowania obrazu. Spróbuj ponownie.");
    } finally {
      window.clearTimeout(timer); imageGeneration.current = false; setImageBusy(false);
    }
  }

  const generatingVoice = voiceBusy || ((status === "submitted" || status === "streaming") &&
    !!messages.at(-1)?.parts.some((part) => part.type === "tool-odpowiedzPoPolsku" &&
      (part.state === "input-streaming" || part.state === "input-available")));

  const generatingImage = imageBusy || ((status === "submitted" || status === "streaming") &&
    !!messages.at(-1)?.parts.some((part) => part.type === "tool-generujObraz" &&
      (part.state === "input-streaming" || part.state === "input-available")));

  useEffect(() => {
    conversation.current?.scrollTo({ top: conversation.current.scrollHeight });
  }, [messages]);

  return (
    <main className={styles.chat}>
      <h1>Mój chatbot</h1>
      <div className={styles.controls}>
        <button type="button" disabled={leaving || imageBusy} onClick={async () => {
          setLeaving(true);
          setLogoutError("");
          void stop();
          try {
            const response = await fetch("/api/logout", { method: "POST" });
            if (!response.ok) throw new Error("logout");
            window.location.replace("/");
          } catch {
            setLogoutError("Nie udało się wyjść. Spróbuj ponownie.");
            setLeaving(false);
          }
        }}>Wyjdź</button>
      </div>
      {logoutError && <p className={styles.error} role="alert">{logoutError}</p>}
      <div className={styles.controls} aria-label="Tryb pracy">
        <button type="button" aria-pressed={mode === "chat"} disabled={busy || leaving}
          onClick={() => setMode("chat")}>Zwykły czat</button>
        <button type="button" aria-pressed={mode === "analysis"} disabled={busy || leaving}
          onClick={() => setMode("analysis")}>Analiza JSON</button>
        <button type="button" aria-pressed={mode === "demo"} disabled={busy || leaving}
          onClick={() => setMode("demo")}>Demo instrukcji A/B</button>
      </div>
      {mode === "analysis" && <MessageAnalysis disabled={leaving} />}
      {mode === "demo" && <PromptDemo cases={demoCases} disabled={leaving} />}
      <div hidden={mode !== "chat"} className={styles.composer}>
      <section
        className={styles.conversation}
        ref={conversation}
        aria-label="Rozmowa"
        role="log"
        aria-live="polite"
        aria-busy={busy}
      >
        {messages.map((message) => (
          <div className={styles.message} key={message.id}>
            <strong>{message.role === "user" ? "Ty" : "Chatbot"}</strong>
            {usedChatTools(message).length > 0 && <div className={styles.toolBadges} aria-label="Użyte narzędzia">
              {usedChatTools(message).map((label, index) => <span key={`${index}-${label}`}>{index + 1}. {label}</span>)}
            </div>}
            {message.parts.map((part, index) => {
              if (part.type === "tool-odpowiedzPoPolsku" && part.state === "output-available") return <SpeechResponse key={index} output={part.output} id={`${message.id}-${index}`} />;
              if (part.type === "tool-odpowiedzPoPolsku" && part.state === "output-error") return <p key={index} role="alert" className={styles.error}>Nie udało się przygotować nagrania.</p>;
              if (part.type === "tool-generujObraz" && part.state === "output-available") return <GeneratedImage key={index} output={part.output} id={`${message.id}-${index}`} />;
              if (part.type === "tool-generujObraz" && part.state === "output-error") return <p key={index} role="alert" className={styles.error}>Nie udało się wygenerować obrazu.</p>;
              if (part.type === "text") return <p key={index}>{part.text}</p>;
              if (part.type === "file" && (safeImageDataUrl(part.url, part.mediaType) || (message.metadata?.generatedImage && part.url.startsWith("blob:")))) {
                return <div key={index}>
                  <img src={part.url} alt={part.filename || "Załączone zdjęcie"}
                    className={message.metadata?.generatedImage ? styles.generatedImage : styles.photoThumbnail} />
                  {message.metadata?.generatedImage && <a className={styles.downloadImage} href={part.url}
                    download={`studio-nova-${message.id}.${part.mediaType === "image/jpeg" ? "jpg" : part.mediaType === "image/webp" ? "webp" : "png"}`}>Pobierz</a>}
                </div>;
              }
              return null;
            })}
            {message.role === "assistant" && message.metadata?.stepLimitReached &&
              <p role="status">Przerwałem po 5 krokach</p>}
            {message.role === "assistant" && (message.metadata?.vision || message.metadata?.generatedImage) &&
              <small className={styles.modelCaption}>Model: {message.metadata.modelId || "API nie podało identyfikatora użytego modelu."}</small>}
            <MessageSources message={message} />
          </div>
        ))}
      </section>
      {busy && (
        <p role="status">
          {generatingVoice ? "Przygotowuję odpowiedź głosową…" : generatingImage ? "Generuję obraz…" : photoValidating ? "Sprawdzam zdjęcie…" : status === "submitted" ? "Czekam na odpowiedź…" : "Chatbot pisze…"}
        </p>
      )}
      {error && (
        <p className={styles.error} role="alert">
          {error.message.startsWith("Failed") ? "Nie udało się połączyć z serwerem. Spróbuj ponownie." : error.message}
        </p>
      )}
      {imageError && <p className={styles.error} role="alert">{imageError}</p>}
      <form
        className={styles.composer}
        onSubmit={(event) => {
          event.preventDefault();
          void sendText();
        }}
      >
        <label htmlFor="message">Wiadomość</label>
        <small>Domyślnie odpowiadam tekstem. Aby dostać nagranie, napisz „odpowiedz głosem” lub użyj przycisku.</small>
        <div className={styles.controls}>
          <input
            ref={messageInput}
            id="message"
            name="message"
            type="text"
            value={input}
            onChange={(event) => setInput(event.target.value)}
            disabled={busy || leaving}
            placeholder="Napisz wiadomość…"
          />
          <button type="submit" disabled={busy || leaving || !input.trim()}>Wyślij</button>
        </div>
        <div className={styles.imageSuggestions} aria-label="Podpowiedzi opisów obrazu">
          {imageSuggestions.map((suggestion) => <button key={suggestion.label} type="button" disabled={busy || leaving}
            onClick={() => { setInput(suggestion.prompt); setImageError(""); messageInput.current?.focus(); }}>
            {suggestion.label}
          </button>)}
        </div>
        <small>Styl obrazów Studio Nova: banan, jaskrawe kolory pozostałych elementów i format 800 × 800 px.</small>
        <div className={styles.controls}>
          <input ref={fileInput} type="file" hidden accept="image/jpeg,image/png,image/webp" disabled={busy || leaving}
            onChange={async (event) => {
              const element = event.currentTarget;
              const files = event.target.files;
              const file = files?.[0];
              setImageError("");
              setPhoto(undefined);
              if (!file) return;
              photoValidation.current = true;
              setPhotoValidating(true);
              try {
                const validationError = await validatePhotoFile(file);
                if (validationError) {
                  setImageError(validationError); element.value = ""; return;
                }
                setPhoto(files || undefined);
              } finally {
                photoValidation.current = false;
                setPhotoValidating(false);
              }
            }} />
          <button type="button" disabled={busy || leaving || !input.trim()} onClick={() => void sendText("audio")}>Odpowiedz głosem</button>
          {generatingVoice && <button type="button" onClick={() => { void stop(); }}>Przerwij odpowiedź</button>}
          <button type="button" disabled={busy || leaving} onClick={() => fileInput.current?.click()}>Dodaj zdjęcie</button>
          <button type="button" disabled={busy || leaving || !input.trim()} onClick={() => void generatePicture()}>Wygeneruj obraz</button>
          {generatingImage && <button type="button" onClick={() => { void stop(); }}>Przerwij generowanie</button>}
        </div>
        {photo?.[0] && <p>Zdjęcie: {photo[0].name} <button type="button" disabled={busy || leaving} onClick={() => {
          setPhoto(undefined); if (fileInput.current) fileInput.current.value = "";
        }}>Usuń zdjęcie</button></p>}
      </form>
      </div>
    </main>
  );
}
