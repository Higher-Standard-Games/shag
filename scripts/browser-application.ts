import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import type { Plugin } from "vite";

/** Select browser composition without importing any game's code or defaults. */
export function resolveBrowserApplication(root: string, explicit?: string) {
  const local = path.join(root, ".shag-application.json");
  const selection = explicit ?? (existsSync(local) ? JSON.parse(readFileSync(local, "utf8").replace(/^\uFEFF/, "")).application : "engine");
  if (typeof selection !== "string" || !selection.trim()) {
    throw new Error("Browser application must be 'engine' or a directory containing browser.json");
  }
  if (selection === "engine") return { directory: root, entry: path.join(root, "src/main.ts"), html: null, optimizeDeps: [] as string[] };
  const directory = path.resolve(root, selection);
  const manifest = JSON.parse(readFileSync(path.join(directory, "browser.json"), "utf8"));
  for (const key of ["entry", "html"] as const) {
    if (typeof manifest[key] !== "string" || !manifest[key]) throw new Error(`browser.json requires ${key}`);
  }
  const entry = path.resolve(directory, manifest.entry);
  const html = path.resolve(directory, manifest.html);
  if (!existsSync(entry) || !existsSync(html)) throw new Error("Browser application entry or HTML is missing");
  const optimizeDeps: unknown = manifest.optimizeDeps ?? [];
  if (!Array.isArray(optimizeDeps) || optimizeDeps.some((value) => typeof value !== "string" || !value))
    throw new Error("browser.json optimizeDeps must be an array of module specifiers");
  return { directory, entry, html, optimizeDeps: optimizeDeps as string[] };
}

export function browserApplicationPlugin(root: string, application: ReturnType<typeof resolveBrowserApplication>): Plugin {
  const relative = path.relative(root, application.entry).replace(/\\/g, "/");
  const entryUrl = relative.startsWith("../") || path.isAbsolute(relative)
    ? `/@fs/${application.entry.replace(/\\/g, "/")}` : `/${relative}`;
  return {
    name: "shag-browser-application",
    transformIndexHtml: {
      order: "pre",
      handler(html, context) {
        if (path.resolve(context.filename) !== path.join(root, "index.html")) return html;
        const template = application.html ? readFileSync(application.html, "utf8") : html;
        if (!template.includes("<!-- SHAG_APPLICATION_ENTRY -->")) {
          throw new Error("Application HTML requires <!-- SHAG_APPLICATION_ENTRY -->");
        }
        return template.replace("<!-- SHAG_APPLICATION_ENTRY -->", `<script type="module" src="${entryUrl}"></script>`);
      },
    },
  };
}
