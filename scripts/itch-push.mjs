#!/usr/bin/env node
/**
 * Build the itch.io builds and push them with butler.
 *
 *   npm run itch:push -- --staging        dist-itch-staging -> washoi-staging:html5
 *   npm run itch:push -- --production     dist-itch         -> washoi:html5
 *   npm run itch:push -- --staging --production    both (a release)
 *   ... --skip-build                       push what is already built
 *
 * butler comes from BUTLER (a path) or the PATH, and is logged in once with
 * `butler login`, or by BUTLER_API_KEY on a machine without a browser. The
 * production build is labelled with the release version, the staging build
 * with the version and the commit it was built from.
 *
 * A release pushes production together with the host deploy: an itch build
 * that falls behind the servers' protocol cannot play. When a release changes
 * the lobby's login protocol, the lobby must be live before the itch build.
 */

import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ACCOUNT = "higherstandardgames";
const CHANNEL = "html5";
const TARGETS = {
  staging: { build: "build:itch-staging", dir: "dist-itch-staging", project: "washoi-staging" },
  production: { build: "build:itch", dir: "dist-itch", project: "washoi" },
};

const args = process.argv.slice(2);
const wanted = Object.keys(TARGETS).filter((name) => args.includes(`--${name}`));
if (!wanted.length || args.includes("--help")) {
  console.log("Usage: npm run itch:push -- [--staging] [--production] [--skip-build]");
  process.exit(wanted.length ? 0 : 1);
}

const butler = process.env.BUTLER || "butler";
const run = (command, commandArgs, options = {}) => {
  const result = spawnSync(command, commandArgs, { cwd: ROOT, stdio: "inherit", ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
};

try {
  execFileSync(butler, ["-V"], { stdio: "ignore" });
} catch {
  console.error(`butler not found (${butler}). Install it from https://itch.io/docs/butler/ and set BUTLER or PATH.`);
  process.exit(1);
}

const version = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8")).version;
const commit = execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim();

for (const name of wanted) {
  const target = TARGETS[name];
  if (!args.includes("--skip-build")) run("npm", ["run", target.build], { shell: process.platform === "win32" });
  if (!fs.existsSync(path.join(ROOT, target.dir, "index.html"))) {
    console.error(`${target.dir}/index.html is missing: build it first, or drop --skip-build.`);
    process.exit(1);
  }
  const userVersion = name === "production" ? version : `${version}-staging+${commit}`;
  const destination = `${ACCOUNT}/${target.project}:${CHANNEL}`;
  console.log(`\n[itch] ${target.dir} -> ${destination} (${userVersion})`);
  run(butler, ["push", target.dir, destination, "--userversion", userVersion]);
  run(butler, ["status", destination]);
}
