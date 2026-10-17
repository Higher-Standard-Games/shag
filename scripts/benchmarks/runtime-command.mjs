import fs from "node:fs";
import path from "node:path";

/** Resolve Windows npm's Bun shim to its native executable without a shell. */
export function bunExecutable(command = "bun") {
  if (command !== "bun" || process.platform !== "win32") return command;
  for (const directory of (process.env.PATH ?? "").split(path.delimiter)) {
    for (const relative of ["bun.exe", "node_modules/bun/bin/bun.exe"]) {
      const candidate = path.join(directory, relative);
      if (fs.existsSync(candidate)) return candidate;
    }
  }
  throw new Error("Bun executable not found; install Bun or pass --bun <native executable>");
}
