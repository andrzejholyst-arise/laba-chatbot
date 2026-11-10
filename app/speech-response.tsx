"use client";

import { useState } from "react";
import { speechResultSchema } from "../lib/speech-result";
import styles from "./chat.module.css";

export default function SpeechResponse({ output, id }: { output: unknown; id: string }) {
  const [playbackError, setPlaybackError] = useState(false);
  const parsed = speechResultSchema.safeParse(output);
  if (!parsed.success) return <p role="alert" className={styles.error}>Nieprawidłowy wynik narzędzia głosowego.</p>;
  if (!parsed.data.ok) return <p role="alert" className={styles.error}>{parsed.data.error}</p>;
  return <div>
    <p>Odpowiedź głosowa po polsku</p>
    <audio controls preload="none" src={parsed.data.audioUrl} onError={() => setPlaybackError(true)} aria-label="Odpowiedź głosowa po polsku" />
    {playbackError && <p role="alert" className={styles.error}>Nie można odtworzyć nagrania. Pobierz plik lub skorzystaj z transkrypcji.</p>}
    <a className={styles.downloadImage} href={parsed.data.audioUrl} download={`studio-nova-${id}.mp3`}>Pobierz nagranie</a>
    <details><summary>Tekst nagrania (szkic)</summary><p>{parsed.data.tekst}</p></details>
  </div>;
}
