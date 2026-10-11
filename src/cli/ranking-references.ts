/** Operator tooling. Listing never creates storage; installing requires an explicit path/artifact. */
import * as fs from "node:fs";
import * as path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { BotCalibrationStore } from "../lobby/BotCalibrationStore";
import { MatchResultStore } from "../lobby/MatchResultStore";
import { RatingStore } from "../lobby/RatingStore";
import { canonicalCalibration } from "../shared/ranking/BotRatingReferences";

const args = process.argv.slice(2).filter((v) => v !== "--");
const value = (flag: string) => {
  const i = args.indexOf(flag);
  return i < 0 ? undefined : args[i + 1];
};
if (args.includes("--help") || args.length === 0) {
  console.log(`Usage:
  npm run ranking:references -- --list --data-dir <dir>
  npm run ranking:references -- --check <artifact.json>
  npm run ranking:references -- --install <artifact.json> --data-dir <dir>

No bot strengths are shipped. Artifacts require operator-reviewed human pilots.
Install binds an immutable calibration to the current policy, mode and exact bot
configuration. Revisions need a new policy/replay. Older pending results stay pending.`);
  process.exit(0);
}
try {
  const check = value("--check");
  const install = value("--install");
  if ([args.includes("--list"), args.includes("--check"), args.includes("--install")].filter(Boolean).length !== 1)
    throw new Error("Choose exactly one of list, check or install");
  const artifactPath = check ?? install;
  const artifact = artifactPath
    ? canonicalCalibration(JSON.parse(fs.readFileSync(path.resolve(artifactPath), "utf8")))
    : null;
  if (check) {
    console.log(JSON.stringify({ valid: true, artifact }, null, 2));
    process.exit(0);
  }
  const dataDir = value("--data-dir");
  if (!dataDir || dataDir.startsWith("--")) throw new Error("An explicit --data-dir is required");
  const dir = path.resolve(dataDir);
  const file = path.join(dir, "players.db");
  if (!fs.existsSync(file)) throw new Error("Database is unavailable; initialize fresh lobby storage first");
  if (install && artifact) {
    if (RatingStore.inspect(dir, true).status !== "ready")
      throw new Error("Initialized, consistent ranking storage is required before installing a reference");
    const results = MatchResultStore.open(dir);
    try {
      console.log(
        JSON.stringify({
          dataDirectory: dir,
          status: results.ratings.calibrations.register(artifact),
          calibrationId: artifact.id,
        }),
      );
    } finally {
      results.close();
    }
  } else if (args.includes("--list")) {
    const db = new DatabaseSync(file, { readOnly: true });
    try {
      console.log(JSON.stringify({ dataDirectory: dir, calibrations: new BotCalibrationStore(db).list() }, null, 2));
    } finally {
      db.close();
    }
  } else throw new Error("Choose --list, --check or --install");
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
