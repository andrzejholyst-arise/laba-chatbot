"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { useEffect, useRef, useState } from "react";
import styles from "./chat.module.css";

const transport = new DefaultChatTransport({
  api: "/api/chat",
  fetch: async (url, options) => {
    const response = await fetch(url, options);
    if (response.status === 401) window.location.replace("/");
    return response;
  },
});

export default function Chat() {
  const { messages, sendMessage, status, error, clearError, stop } = useChat({ transport });
  const [input, setInput] = useState("");
  const [leaving, setLeaving] = useState(false);
  const [logoutError, setLogoutError] = useState("");
  const conversation = useRef<HTMLElement>(null);
  const busy = status === "submitted" || status === "streaming";

  useEffect(() => {
    conversation.current?.scrollTo({ top: conversation.current.scrollHeight });
  }, [messages]);

  return (
    <main className={styles.chat}>
      <h1>Mój chatbot</h1>
      <div className={styles.controls}>
        <button type="button" disabled={leaving} onClick={async () => {
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
            {message.parts.map((part, index) =>
              part.type === "text" ? <p key={index}>{part.text}</p> : null,
            )}
          </div>
        ))}
      </section>
      {busy && (
        <p role="status">
          {status === "submitted" ? "Czekam na odpowiedź…" : "Chatbot pisze…"}
        </p>
      )}
      {error && (
        <p className={styles.error} role="alert">
          {error.message.startsWith("Brak konfiguracji:")
            ? error.message
            : "Nie udało się uzyskać odpowiedzi. Sprawdź połączenie oraz klucz, model i środki w OpenRouter. Spróbuj ponownie."}
        </p>
      )}
      <form
        className={styles.composer}
        onSubmit={(event) => {
          event.preventDefault();
          const text = input.trim();
          if (!text || busy || leaving) return;
          clearError();
          setInput("");
          void sendMessage({ text });
        }}
      >
        <label htmlFor="message">Wiadomość</label>
        <div className={styles.controls}>
          <input
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
      </form>
    </main>
  );
}
