/**
 * v0.9.23 pickup landing probe: where every map weapon comes to rest.
 *
 * Run from the repository root:
 *   npx vite-node docs/research/v0.9.23-pickup-landing-probe.ts -- wdm2 acidwdm2
 *
 * For each map, builds two independent collision worlds from the BSP — one per
 * side, as the server and a client each do — lands the pickup table in both,
 * and reports how far each weapon moved from its authored spot and whether both
 * sides agree exactly. Exits non-zero if any landing differs.
 */

import * as path from "node:path";
import { createHeadlessCollisionWorld } from "../../src/cli/HeadlessBSPCollisionWorld";
import { BspLoader } from "../../src/engine/loader/bsp/BspLoader";
import { resolveMapBspViaIndex } from "../../src/engine/loader/pk3/NodePk3";
import { extractPickups } from "../../src/shared/bsp/PickupTable";
import { landMapPickups } from "../../src/shared/items/ItemThrow";

const print = console.log;
const fmt = (p: { x: number; y: number; z: number }) => `${p.x.toFixed(1)},${p.y.toFixed(1)},${p.z.toFixed(1)}`;

async function main() {
  const maps = process.argv.slice(2).filter((arg) => !arg.startsWith("-"));
  console.log = () => {};
  let agree = true;

  for (const map of maps.length > 0 ? maps : ["wdm2"]) {
    const buffer = await resolveMapBspViaIndex([path.resolve("public/data")], map);
    if (!buffer) {
      print(`${map}: BSP not found`);
      agree = false;
      continue;
    }
    const bsp = BspLoader.load(buffer);
    const table = extractPickups(bsp.entities);
    const server = landMapPickups(table, await createHeadlessCollisionWorld(bsp));
    const client = landMapPickups(table, await createHeadlessCollisionWorld(bsp));

    print(`\n== ${map}`);
    for (const [i, authored] of table.entries()) {
      if (authored.type !== "weapon") continue;
      const from = authored.position;
      const rest = server[i].position;
      const other = client[i].position;
      const same = rest.x === other.x && rest.y === other.y && rest.z === other.z;
      agree &&= same;
      print(
        `   ${authored.classname}#${authored.id} ${fmt(from)} -> ${fmt(rest)}: ` +
          `${Math.hypot(rest.x - from.x, rest.z - from.z).toFixed(1)}u across, ${(rest.y - from.y).toFixed(1)}u vertical, ` +
          `${server[i] === authored ? "kept authored spot" : "landed"}, sides ${same ? "agree" : "DISAGREE"}`,
      );
    }
  }

  print(agree ? "\nBoth sides agree on every landing." : "\nSIDES DISAGREE on at least one landing.");
  process.exitCode = agree ? 0 : 1;
}

main().catch((error) => {
  print(error);
  process.exitCode = 1;
});
