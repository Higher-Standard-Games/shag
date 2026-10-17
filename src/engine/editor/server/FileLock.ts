import { randomUUID } from "node:crypto";
import { renameSync, writeFileSync } from "node:fs";
import { mkdir, readFile, rm, rmdir, writeFile } from "node:fs/promises";
import { hostname } from "node:os";
import path from "node:path";

interface Owner {
  pid: number;
  host: string;
  token: string;
  childPid?: number;
}

function dead(owner: Owner): boolean {
  if (owner.host !== hostname() || !Number.isSafeInteger(owner.pid) || owner.pid < 1) return false;
  const gone = (pid: number) => {
    try {
      process.kill(pid, 0);
      return false;
    } catch (error) {
      return (error as NodeJS.ErrnoException).code === "ESRCH";
    }
  };
  return gone(owner.pid) && (owner.childPid === undefined || gone(owner.childPid));
}

async function ownerOf(directory: string): Promise<Owner | null> {
  try {
    const owner = JSON.parse(await readFile(path.join(directory, "owner.json"), "utf8")) as Owner | null;
    return owner &&
      typeof owner.host === "string" &&
      Number.isSafeInteger(owner.pid) &&
      typeof owner.token === "string" &&
      /^[a-f0-9-]{36}$/.test(owner.token)
      ? owner
      : null;
  } catch (error) {
    if (error instanceof SyntaxError) return null; // Owner registration may still be writing.
    if (["ENOENT", "ENOTDIR"].includes((error as NodeJS.ErrnoException).code ?? "")) return null;
    throw error;
  }
}

/** Never expire a live owner's lease. Recover only a confirmed dead local PID. */
async function reclaim(directory: string): Promise<void> {
  const observed = await ownerOf(directory);
  if (!observed || !dead(observed)) return;
  const guard = path.join(directory, "reaping");
  try {
    await mkdir(guard);
  } catch (error) {
    if (["EEXIST", "ENOENT", "ENOTDIR"].includes((error as NodeJS.ErrnoException).code ?? "")) return;
    throw error;
  }
  let removed = false;
  try {
    const current = await ownerOf(directory);
    if (current?.token === observed.token && dead(current)) {
      await rm(path.join(directory, "owner.json"));
      removed = true;
    }
  } finally {
    await rmdir(guard);
  }
  if (removed) {
    // Only remove an empty directory. A concurrently created recovery marker
    // prevents removal rather than allowing a recursive delete of a new owner.
    try {
      await rmdir(directory);
    } catch (error) {
      if (!["ENOENT", "ENOTEMPTY", "EEXIST"].includes((error as NodeJS.ErrnoException).code ?? "")) throw error;
    }
  }
}

/** Filesystem coordination across server/CLI/MCP instances on this machine. */
export async function withFileLock<T>(
  directory: string,
  work: (lease: { child(pid: number | null): void }) => Promise<T>,
  timeoutMs = 65 * 60_000,
): Promise<T> {
  await mkdir(path.dirname(directory), { recursive: true });
  const owner: Owner = { pid: process.pid, host: hostname(), token: randomUUID() };
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      await mkdir(directory);
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      await reclaim(directory);
      if (Date.now() >= deadline)
        throw new Error(`Timed out waiting for lock ${directory}; owner ${JSON.stringify(await ownerOf(directory))}`);
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
  try {
    await writeFile(path.join(directory, "owner.json"), JSON.stringify(owner), "utf8");
    return await work({
      child(pid) {
        if (pid === null) delete owner.childPid;
        else owner.childPid = pid;
        const file = path.join(directory, "owner.json");
        writeFileSync(`${file}.tmp`, JSON.stringify(owner), "utf8");
        renameSync(`${file}.tmp`, file);
      },
    });
  } finally {
    const current = await ownerOf(directory);
    if (current?.token === owner.token) {
      await rm(path.join(directory, "owner.json"));
      await rmdir(directory);
    }
  }
}
