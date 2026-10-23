import path from "node:path";

export interface RuntimeContext {
  executable: string;
  bun: boolean;
  entry: string;
}

/** Application entry paths, absolute or relative to the assembled project root. */
export interface GameServerApplication {
  readonly sourceEntry: string;
  readonly bundledEntry: string;
}

export function currentServerRuntime(): RuntimeContext {
  return { executable: process.execPath, bun: !!process.versions.bun, entry: process.argv[1] ?? "" };
}

/** Child servers use the parent's actual executable, never an npm/shell wrapper. */
export function gameServerLaunch(
  root: string,
  application: GameServerApplication | undefined,
  runtime = currentServerRuntime(),
): { executable: string; args: string[] } {
  if (!application?.sourceEntry?.trim() || !application.bundledEntry?.trim()) {
    throw new Error("Game server application is not configured: sourceEntry and bundledEntry are required");
  }
  const bundled =
    path.dirname(path.resolve(runtime.entry)) === path.join(root, "dist-server") && runtime.entry.endsWith(".mjs");
  const entry = path.resolve(root, bundled ? application.bundledEntry : application.sourceEntry);
  return {
    executable: runtime.executable,
    args: runtime.bun || bundled ? [entry] : [path.join(root, "node_modules/vite-node/vite-node.mjs"), entry],
  };
}

export function describeServerRuntime(): string {
  return JSON.stringify({
    runtime: process.versions.bun ? "bun" : "node",
    version: process.versions.bun ?? process.versions.node,
    pid: process.pid,
    executable: process.execPath,
  });
}
