/**
 * biome-gate — fail-on-NEW-diagnostics ratchet (QA-WO6 / QA-12).
 *
 * Biome has no built-in baseline, and the repo carries ~1,500 legacy
 * diagnostics that can't all be fixed at once. This gate runs `biome check src`
 * and compares the total error/warning counts against `biome-baseline.json`:
 *
 *   - counts ABOVE baseline  → exit 1 (you introduced new diagnostics)
 *   - counts BELOW baseline  → exit 0 + a nudge to ratchet the baseline down
 *   - counts AT baseline     → exit 0
 *
 * Update the baseline (after fixing diagnostics, never to admit new ones):
 *   node scripts/biome-gate.mjs --update
 *
 * Used by the pre-commit hook and CI. Count-based is deliberately simple; it
 * can't catch a fix+regress swap within one commit, but it holds the total
 * line and costs ~3s.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const baselinePath = join(repoRoot, "biome-baseline.json");

function currentCounts() {
  let output = "";
  try {
    output = execFileSync("npx", ["biome", "check", "src"], {
      cwd: repoRoot,
      encoding: "utf8",
      shell: process.platform === "win32", // npx is npx.cmd on Windows
      maxBuffer: 64 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"], // keep biome's diagnostic firehose off the console
    });
  } catch (err) {
    // biome exits non-zero when diagnostics exist — the summary is still printed.
    output = `${err.stdout ?? ""}${err.stderr ?? ""}`;
    if (!/Found \d+ error/.test(output) && !/Found \d+ warning/.test(output)) {
      console.error("[biome-gate] biome did not produce a summary — raw output follows:");
      console.error(output.slice(-2000));
      process.exit(1);
    }
  }
  const errors = Number(/Found (\d+) errors?\./.exec(output)?.[1] ?? 0);
  const warnings = Number(/Found (\d+) warnings?\./.exec(output)?.[1] ?? 0);
  return { errors, warnings };
}

const counts = currentCounts();

if (process.argv.includes("--update")) {
  writeFileSync(baselinePath, `${JSON.stringify(counts, null, 2)}\n`);
  console.log(`[biome-gate] baseline updated: ${counts.errors} errors, ${counts.warnings} warnings`);
  process.exit(0);
}

let baseline;
try {
  baseline = JSON.parse(readFileSync(baselinePath, "utf8"));
} catch {
  console.error(`[biome-gate] missing/invalid ${baselinePath} — run with --update to create it`);
  process.exit(1);
}

const overErrors = counts.errors - baseline.errors;
const overWarnings = counts.warnings - baseline.warnings;

if (overErrors > 0 || overWarnings > 0) {
  console.error(
    `[biome-gate] FAIL — new diagnostics over baseline: ` +
      `errors ${counts.errors}/${baseline.errors} (+${Math.max(0, overErrors)}), ` +
      `warnings ${counts.warnings}/${baseline.warnings} (+${Math.max(0, overWarnings)})`,
  );
  console.error(`[biome-gate] fix the new diagnostics (run: npx biome check src) — do not raise the baseline`);
  process.exit(1);
}

if (overErrors < 0 || overWarnings < 0) {
  console.log(
    `[biome-gate] OK — below baseline (errors ${counts.errors}/${baseline.errors}, ` +
      `warnings ${counts.warnings}/${baseline.warnings}). ` +
      `Ratchet it down: node scripts/biome-gate.mjs --update`,
  );
} else {
  console.log(`[biome-gate] OK — at baseline (${counts.errors} errors, ${counts.warnings} warnings)`);
}
