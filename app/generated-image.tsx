import { imageToolResultSchema } from "../lib/image-tool-result";
import styles from "./chat.module.css";

export default function GeneratedImage({ output, id }: { output: unknown; id: string }) {
  const parsed = imageToolResultSchema.safeParse(output);
  if (!parsed.success) return <p role="alert" className={styles.error}>Narzędzie zwróciło nieprawidłowy wynik obrazu.</p>;
  if (!parsed.data.ok) return <p role="alert" className={styles.error}>{parsed.data.error}</p>;
  return <div>
    <img className={styles.generatedImage} src={parsed.data.dataUrl} alt="Obraz wygenerowany dla Studio Nova" />
    <a className={styles.downloadImage} href={parsed.data.dataUrl} download={`studio-nova-${id}.png`}>Pobierz</a>
    <small className={styles.modelCaption}>Model: {parsed.data.modelId || "API nie podało identyfikatora użytego modelu."}</small>
  </div>;
}
