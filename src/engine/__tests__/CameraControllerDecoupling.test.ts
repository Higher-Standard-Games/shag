/**
 * Camera controller → game decoupling guard (QA-2 / QA-WO7).
 *
 * Engine camera controllers use engine-owned interfaces and registries.
 * The concrete Washoi FPS controller lives in the game repository.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";

const CONTROLLER_DIR = path.resolve(__dirname, "../camera/controllers");

/** Controllers proven free of any `games/` import. */
const DECOUPLED = ["SpectatorController.ts", "FreeflyController.ts"];

const GAMES_IMPORT = /from\s+["'][^"']*\/games\/|from\s+["']@game(s)?\b/;

describe("decoupled camera controllers import no game", () => {
  for (const file of DECOUPLED) {
    it(`${file} imports nothing from games/`, () => {
      const source = fs.readFileSync(path.join(CONTROLLER_DIR, file), "utf8");
      const match = source.match(GAMES_IMPORT);
      expect(match?.[0] ?? null, `${file} must not import from games/`).toBeNull();
    });
  }
});
