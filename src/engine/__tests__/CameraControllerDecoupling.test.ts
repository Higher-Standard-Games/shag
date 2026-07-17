/**
 * Camera controller → game decoupling guard (QA-2 / QA-WO7).
 *
 * The FPS-coupled controllers imported `games/fps/Game` directly, a build-time
 * cycle. As each is decoupled (via GameFrameHook / PlayerContext), it is added
 * here and asserted to import nothing from games/. SpectatorController is fully
 * decoupled; FreeflyController/FPSController still import fps input actions
 * (FPSActions) and are tracked in the WO7 relocation pass — not yet listed.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";

const CONTROLLER_DIR = path.resolve(__dirname, "../camera/controllers");

/** Controllers proven free of any `games/` import. */
const DECOUPLED = ["SpectatorController.ts"];

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
