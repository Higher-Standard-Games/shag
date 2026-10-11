import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { type BotReference, canonicalBotReference } from "../shared/ranking/BotReference";
import { type BotOptions, defaultGoalArbiterMode, resolveDifficulty } from "./BotConfig";

let behavior: string | undefined;
/** Conservative source/dependency/route fingerprint. Names and tests are omitted. */
function behaviorDigest(): string {
  if (behavior) return behavior;
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const hash = createHash("sha256");
  const visit = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.name.startsWith(".") || entry.name === "__tests__" || entry.name === "BotNames.ts") continue;
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) visit(file);
      else if (entry.isFile() && entry.name.endsWith(".ts")) {
        hash.update(path.relative(root, file).split(path.sep).join("/"));
        hash.update("\0");
        hash.update(new Uint8Array(fs.readFileSync(file)));
        hash.update("\0");
      }
    }
  };
  visit(root);
  const dependencies = path.resolve(root, "../package-lock.json");
  hash.update(new Uint8Array(fs.readFileSync(dependencies)));
  const routes = path.resolve(root, "../config/bot-routes");
  if (fs.existsSync(routes))
    for (const file of fs.readdirSync(routes).sort()) {
      if (!file.endsWith(".json")) continue;
      hash.update(`routes/${file}\0`);
      hash.update(new Uint8Array(fs.readFileSync(path.join(routes, file))));
      hash.update("\0");
    }
  behavior = hash.digest("hex");
  return behavior;
}

/** Hash only metadata and model artifacts, not directory names or timestamps. */
export function modelDigest(dir: string): string | null {
  try {
    const hash = createHash("sha256");
    let files = 0;
    const visit = (folder: string) => {
      for (const entry of fs
        .readdirSync(folder, { withFileTypes: true })
        .sort((a, b) => a.name.localeCompare(b.name))) {
        const file = path.join(folder, entry.name);
        if (entry.isDirectory() && ["tactical", "combat"].includes(entry.name)) visit(file);
        else if (entry.isFile() && (entry.name.endsWith(".json") || entry.name.endsWith(".bin"))) {
          hash.update(path.relative(dir, file).split(path.sep).join("/"));
          hash.update("\0");
          hash.update(new Uint8Array(fs.readFileSync(file)));
          hash.update("\0");
          files++;
        }
      }
    };
    visit(dir);
    return files ? hash.digest("hex") : null;
  } catch {
    return null;
  }
}

export function initialBotReference(options: BotOptions): BotReference {
  const preset =
    typeof options.difficulty === "string"
      ? ["easy", "medium", "hard", "insane"].includes(options.difficulty)
        ? options.difficulty
        : "medium"
      : "custom";
  return canonicalBotReference({
    version: 1,
    preset,
    difficulty: resolveDifficulty(typeof options.difficulty === "string" ? preset : options.difficulty),
    goalArbiter: options.goalArbiter ?? defaultGoalArbiterMode(),
    behavior: behaviorDigest(),
    model: { status: options.modelDir ? "loading" : "none", digest: null, tactical: false, combat: false },
  });
}
