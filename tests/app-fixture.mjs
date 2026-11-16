import { mkdtemp, readFile, writeFile, rm, mkdir, readdir } from "node:fs/promises";
import { resolve, join, dirname } from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";

// Kompilujemy kod aplikacji, bez Next.js i bez ładowania .env.
export async function loadApp(t) {
  await mkdir(".next", { recursive: true });
  const temp = await mkdtemp(resolve(".next/app-tests-"));
  t.after(() => rm(temp, { recursive: true, force: true }));
  const files = (await readdir("lib")).filter((name) => name.endsWith(".ts")).map((name) => `lib/${name}`);
  files.push("app/api/dashboard/route.ts", "app/api/agent/route.ts", "app/api/login/route.ts", "app/api/logout/route.ts");
  for (const path of files) {
    const source = (await readFile(path, "utf8")).replace(/(from\s+["'])(\.[^"']+)(["'])/g, "$1$2.mjs$3");
    const target = join(temp, path.replace(/\.ts$/, ".mjs"));
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
    }).outputText);
  }
  return (path) => import(pathToFileURL(join(temp, path.replace(/\.ts$/, ".mjs"))).href);
}
