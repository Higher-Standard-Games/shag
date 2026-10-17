import path from "node:path";

export interface RuntimeContext {
  executable: string;
  bun: boolean;
  entry: string;
}

export function currentServerRuntime(): RuntimeContext {
  return { executable: process.execPath, bun: !!process.versions.bun, entry: process.argv[1] ?? "" };
}

/** Child servers use the parent's actual executable, never an npm/shell wrapper. */
export function gameServerLaunch(
  root: string,
  runtime = currentServerRuntime(),
): { executable: string; args: string[] } {
  const bundled =
    path.dirname(path.resolve(runtime.entry)) === path.join(root, "dist-server") && runtime.entry.endsWith(".mjs");
  const entry = path.join(root, bundled ? "dist-server/headless-netserver-v2.mjs" : "src/cli/headless-netserver-v2.ts");
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
