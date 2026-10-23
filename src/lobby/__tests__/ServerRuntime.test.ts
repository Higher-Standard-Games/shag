import path from "node:path";
import { describe, expect, it } from "vitest";
import { gameServerLaunch } from "../ServerRuntime";

describe("server runtime inheritance", () => {
  const root = path.resolve("a project with spaces");
  const executable = path.join(root, "runtime executable");
  const application = { sourceEntry: "applications/match.ts", bundledEntry: "dist-server/match.mjs" };
  it.each([false, true])("keeps the exact parent executable for Bun=%s", (bun) => {
    const launch = gameServerLaunch(root, application, {
      executable,
      bun,
      entry: path.join(root, "applications/lobby.ts"),
    });
    expect(launch.executable).toBe(executable);
    expect(launch.args).toEqual(
      bun
        ? [path.join(root, "applications/match.ts")]
        : [path.join(root, "node_modules/vite-node/vite-node.mjs"), path.join(root, "applications/match.ts")],
    );
  });
  it.each([false, true])("keeps production children on the common built artifact for Bun=%s", (bun) => {
    expect(
      gameServerLaunch(root, application, { executable, bun, entry: path.join(root, "dist-server/lobby.mjs") }),
    ).toEqual({
      executable,
      args: [path.join(root, "dist-server/match.mjs")],
    });
  });

  it.each([false, true])("accepts absolute application entries outside the root for Bun=%s", (bun) => {
    const entries = {
      sourceEntry: path.resolve("another game with spaces/server.ts"),
      bundledEntry: path.resolve("another game with spaces/server.mjs"),
    };
    expect(
      gameServerLaunch(root, entries, { executable, bun, entry: path.join(root, "dist-server/lobby.mjs") }).args,
    ).toEqual([entries.bundledEntry]);
    expect(
      gameServerLaunch(root, entries, { executable, bun, entry: path.join(root, "applications/lobby.ts") }).args,
    ).toEqual(
      bun ? [entries.sourceEntry] : [path.join(root, "node_modules/vite-node/vite-node.mjs"), entries.sourceEntry],
    );
  });

  it.each([undefined, { sourceEntry: " ", bundledEntry: "match.mjs" }, { sourceEntry: "match.ts", bundledEntry: "" }])(
    "rejects an absent or incomplete application without a game-specific fallback: %j",
    (entries) => {
      expect(() => gameServerLaunch(root, entries)).toThrow("Game server application is not configured");
    },
  );
});
