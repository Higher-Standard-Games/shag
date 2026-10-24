/** Minimal offline delivery inspection and conservative retention; preview by default. */
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { MatchResultStore } from "../lobby/MatchResultStore";
import { RatingStore } from "../lobby/RatingStore";
import { ResultDeliveryStore } from "../lobby/ResultDeliveryStore";

const args = process.argv.slice(2).filter((arg) => arg !== "--");
const value = (flag: string) => {
  const i = args.indexOf(flag);
  return i < 0 ? undefined : args[i + 1];
};
if (!args.length || args.includes("--help")) {
  console.log(`Usage:
  npm run ranking:delivery -- --info --data-dir <dir> [--offset N]
  npm run ranking:delivery -- --recover --data-dir <dir>
  npm run ranking:delivery -- --cleanup --data-dir <dir> [--older-than-hours 168] [--apply]

Stop the lobby before applying offline cleanup. Preview is read-only.
Only committed leftovers, old closed matches without reports and old owned temporary
files are eligible. Unresolved reports and unknown/running matches are retained.
Inspection never returns verification keys, admission tickets or raw reports.`);
  process.exit(0);
}
try {
  if (
    ["--info", "--cleanup", "--recover"].filter((flag) => args.includes(flag)).length !== 1 ||
    (args.includes("--apply") && !args.includes("--cleanup"))
  )
    throw new Error("Choose info, recover or cleanup; apply is only available for cleanup");
  const dataDir = value("--data-dir");
  if (!dataDir || dataDir.startsWith("--")) throw new Error("An explicit --data-dir is required");
  const dir = path.resolve(dataDir),
    file = path.join(dir, "players.db");
  if (!fs.existsSync(file)) throw new Error("Delivery database is unavailable");
  const age = Number(value("--older-than-hours") ?? 168) * 3600000;
  if (args.includes("--recover")) {
    if (RatingStore.inspect(dir, true).status !== "ready")
      throw new Error("Initialized, consistent ranking storage is required for result recovery");
    const results = MatchResultStore.open(dir);
    try {
      results.deliveries.loseBotControl();
      const delivery = results.deliveries.retryAll(0);
      console.log(JSON.stringify({ dataDirectory: dir, delivery }, null, 2));
      if (delivery.failed || delivery.rejected) process.exitCode = 1;
    } finally {
      results.close();
    }
  } else if (args.includes("--apply")) {
    if (RatingStore.inspect(dir, true).status !== "ready")
      throw new Error("Consistent ranking storage is required before cleanup");
    const results = MatchResultStore.open(dir);
    try {
      console.log(JSON.stringify(results.deliveries.cleanup(age, true), null, 2));
    } finally {
      results.close();
    }
  } else {
    const db = new DatabaseSync(file, { readOnly: true });
    try {
      const delivery = new ResultDeliveryStore(
        db,
        file,
        () => {
          throw new Error("Read-only operation");
        },
        false,
      );
      console.log(
        JSON.stringify(
          args.includes("--info") ? delivery.inspect(Number(value("--offset") ?? 0)) : delivery.cleanup(age),
          null,
          2,
        ),
      );
    } finally {
      db.close();
    }
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
