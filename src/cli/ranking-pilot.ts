/** Reproducible pilot export/analysis. Database opens are always read-only. */

import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { BotPilotStore, botReferenceId } from "../lobby/BotPilotStore";
import { analyzePilot, type BotPilot, pilotArtifact, validatePilot } from "../shared/ranking/BotPilot";
import { RATING_POLICY, type RatingMode } from "../shared/ranking/RatingPolicy";

const args = process.argv.slice(2).filter((arg) => arg !== "--");
const value = (name: string) => {
  const i = args.indexOf(name);
  const v = i >= 0 ? args[i + 1] : undefined;
  if (v?.startsWith("--")) throw new Error(`Missing ${name} value`);
  return v;
};
const required = (name: string) => {
  const v = value(name);
  if (!v) throw new Error(`${name} is required`);
  return v;
};
if (!args.length || args.includes("--help")) {
  console.log(`Usage:
  npm run ranking:pilot -- --plan --output pilot-plan.json
  npm run ranking:pilot -- --export --mode duel --data-dir <dir> --output pilot.json [--anchor-scope private|public] [--after-sequence N] [--through-sequence N]
  npm run ranking:pilot -- --analyze pilot.json --output analysis.json
  npm run ranking:pilot -- --artifact pilot.json --reference <digest> --id <versioned-id> --report analysis.json --reviewed --output calibration.json

One bot per trial, unchanged map bytes and established same-mode human anchors.
Public anchors are an explicit offline calibration choice; live pools remain separate.
Export verifies the journal in one WAL snapshot. Analyze produces drafts only.
Artifact creation requires explicit operator review. Nothing installs strengths or resets storage.`);
  process.exit(0);
}
try {
  if (["--plan", "--export", "--analyze", "--artifact"].filter((flag) => args.includes(flag)).length !== 1)
    throw new Error("Choose exactly one pilot action");
  let output: unknown;
  if (args.includes("--plan")) {
    output = {
      version: 1,
      policyVersion: RATING_POLICY.version,
      maps: ["wdm2"],
      modes: ["duel", "amphi", "ffa", "snd"],
      recommendedTrialsPerReference: 30,
      recommendedDistinctHumans: 3,
      botsPerTrial: 1,
      steps: [
        "Establish human ratings in the chosen same-mode anchor pool before pilots.",
        "Keep each bot preset, model/build and map bytes fixed; finish normal private games.",
        "Use one bot plus humans: Duel/Amphi 1v1; FFA up to ten seats; S&D team standings.",
        "Export after a recorded sequence boundary; inspect every skipped reason.",
        "Analyze each reference; inspect sample coverage and outcome diversity.",
        "Review real human evidence before producing/installing the immutable artifact.",
      ],
      note: "Recommendations guide pilot review; they are not new live eligibility or scoring rules.",
    };
  } else if (args.includes("--export")) {
    const dir = path.resolve(required("--data-dir")),
      file = path.join(dir, "players.db");
    if (!fs.existsSync(file)) throw new Error("Pilot database is unavailable");
    const db = new DatabaseSync(file, { readOnly: true });
    try {
      output = new BotPilotStore(db).export(
        required("--mode") as RatingMode,
        (value("--anchor-scope") ?? "private") as "private" | "public",
        Number(value("--after-sequence") ?? 0),
        value("--through-sequence") === undefined ? undefined : Number(value("--through-sequence")),
      );
    } finally {
      db.close();
    }
  } else {
    const input = required(args.includes("--analyze") ? "--analyze" : "--artifact");
    const pilot = JSON.parse(fs.readFileSync(path.resolve(input), "utf8")) as BotPilot;
    validatePilot(pilot);
    for (const ref of pilot.references)
      if (botReferenceId(ref.reference) !== ref.id) throw new Error("Pilot reference digest differs from its identity");
    const analysis = {
      ...analyzePilot(pilot),
      inputDigest: createHash("sha256").update(JSON.stringify(pilot)).digest("hex"),
    };
    if (args.includes("--artifact")) {
      if (!args.includes("--reviewed"))
        throw new Error("Artifact creation requires explicit --reviewed human evidence");
      const report = required("--report");
      if (JSON.stringify(JSON.parse(fs.readFileSync(path.resolve(report), "utf8"))) !== JSON.stringify(analysis))
        throw new Error("Review report does not match this pilot dataset/analysis");
      output = pilotArtifact(pilot, required("--reference"), required("--id"), report);
    } else output = analysis;
  }
  const target = path.resolve(required("--output"));
  // Refuse overwrites: reruns cannot accidentally replace evidence or a database.
  fs.writeFileSync(target, `${JSON.stringify(output, null, 2)}\n`, { flag: "wx", mode: 0o600 });
  console.log(
    JSON.stringify({ output: target, action: args.includes("--artifact") ? "reviewed_artifact" : "pilot_tooling" }),
  );
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
