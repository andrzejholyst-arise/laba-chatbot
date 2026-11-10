import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { demoExpectations, type DemoCase } from "./demo-evaluation";

export function parseDemoCases(csv: string): DemoCase[] {
  const [header, ...lines] = csv.replace(/^\uFEFF/, "").trim().split(/\r?\n/);
  if (header !== "id;wiadomosc") throw new Error("Nieprawidłowy nagłówek danych demo.");
  const ids = new Set<string>();
  return lines.filter(Boolean).map((line) => {
    // Format dostarczonego pliku: id;tekst. Średniki w tekście pozostają w wiadomości.
    const separator = line.indexOf(";");
    const id = line.slice(0, separator);
    const message = line.slice(separator + 1);
    if (separator < 1 || !message.trim() || ids.has(id)) throw new Error("Nieprawidłowy rekord danych demo.");
    ids.add(id);
    const reference = demoExpectations[id];
    return { id, message, expected: reference?.expected ?? null, guidance: reference?.guidance ?? "Brak wzorca. Oceń wynik ręcznie." };
  });
}

export async function loadDemoCases() {
  const csv = await readFile(join(process.cwd(), "materiały/dane/wiadomosci_testowe.csv"), "utf8");
  return parseDemoCases(csv);
}
