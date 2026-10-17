import path from "node:path";
import { describe, expect, it } from "vitest";
import { gameServerLaunch } from "../ServerRuntime";

describe("server runtime inheritance", () => {
  const root = path.resolve("a project with spaces");
  const executable = path.join(root, "runtime executable");
  it.each([false, true])("keeps the exact parent executable for Bun=%s", (bun) => {
    const launch = gameServerLaunch(root, { executable, bun, entry: path.join(root, "src/cli/lobby-server.ts") });
    expect(launch.executable).toBe(executable);
    expect(launch.args).toEqual(
      bun
        ? [path.join(root, "src/cli/headless-netserver-v2.ts")]
        : [
            path.join(root, "node_modules/vite-node/vite-node.mjs"),
            path.join(root, "src/cli/headless-netserver-v2.ts"),
          ],
    );
  });
  it.each([false, true])("keeps production children on the common built artifact for Bun=%s", (bun) => {
    expect(gameServerLaunch(root, { executable, bun, entry: path.join(root, "dist-server/lobby-server.mjs") })).toEqual(
      {
        executable,
        args: [path.join(root, "dist-server/headless-netserver-v2.mjs")],
      },
    );
  });
});
