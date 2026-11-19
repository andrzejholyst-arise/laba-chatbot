import { mkdtemp, readFile, writeFile, rm, mkdir, readdir } from "node:fs/promises";
import { resolve, join, dirname } from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";

// Kompilujemy kod aplikacji, bez Next.js i bez ładowania .env.
export async function loadApp(t, { persistence = false, profile = false, knowledge = false } = {}) {
  await mkdir(".next", { recursive: true });
  const temp = await mkdtemp(resolve(".next/app-tests-"));
  t.after(() => rm(temp, { recursive: true, force: true }));
  const files = (await readdir("lib")).filter((name) => name.endsWith(".ts")).map((name) => `lib/${name}`);
  files.push("app/api/dashboard/route.ts", "app/api/agent/route.ts", "app/api/login/route.ts", "app/api/logout/route.ts", "app/api/conversations/route.ts", "app/api/profile/route.ts", "app/api/knowledge/route.ts");
  for (const path of files) {
    // server-only jest sprawdzane przez Next.js podczas buildu; testy działają w Node.
    const source = (await readFile(path, "utf8")).replace(/^import "server-only";\s*/m, "").replace(/(from\s+["'])(\.[^"']+)(["'])/g, "$1$2.mjs$3");
    const target = join(temp, path.replace(/\.ts$/, ".mjs"));
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
    }).outputText);
  }
  if (!knowledge) {
    // Pozostałe zestawy izolują dawne narzędzia, historię i UI od wyszukiwania.
    // Testy RAG używają knowledge:true i rzeczywistej klasyfikacji pytań.
    await writeFile(join(temp, "lib/knowledge-intent.mjs"), "export function isCompanyQuestion() { return false; }");
  }
  if (!profile) {
    await writeFile(join(temp, "lib/user-profile.mjs"), `
      export class ProfileError extends Error {}
      export async function loadUserProfile() { return { name: null, preferences: {} }; }
      export async function saveUserProfile() { return { name: null, preferences: {} }; }
    `);
  }
  if (!persistence) {
    // Starsze testy narzędzi izolują model od magazynu. Zapis ma osobne testy
    // z prawdziwym klientem Supabase i atrapą jego HTTP (persistence: true).
    await writeFile(join(temp, "lib/conversation-store.mjs"), `
      export class ConversationError extends Error {}
      export async function prepareConversation(request, messages) {
        return { conversationId: "offline", assistantId: "offline-assistant", user: messages.at(-1), messages };
      }
      export async function saveConversationTurn() {}
      export async function saveConversationTitle() {}
      export function messageText() { return "Tekst testowy"; }
      export async function deleteConversation() {}
      export async function loadLatestConversation() { return { conversationId: null, messages: [] }; }
      export async function loadConversation() { return { conversationId: null, messages: [] }; }
      export async function listConversations() { return { conversations: [], nextOffset: null }; }
    `);
  }
  return (path) => import(pathToFileURL(join(temp, path.replace(/\.ts$/, ".mjs"))).href);
}
