/**
 * ServerData — where server-side state lives, and the secret the lobby shares
 * with its bot server.
 *
 * The lobby, the bot server and the game servers always run on one machine.
 * A bot still has to present the shared secret to be treated as a bot, and the
 * bot server's control port refuses anyone who doesn't send it.
 *
 * Node-only: imported by the lobby server, the bot server and their CLIs.
 */

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

/** Header the lobby sends when it opens the bot server's control port. */
export const BOT_SECRET_HEADER = "x-bot-secret";

/**
 * The server data directory: `override`, else SERVER_DATA_DIR, else
 * `server-data/` under the working directory. Never under `public/`, which the
 * dev server hands to anyone who asks.
 */
export function resolveDataDir(override?: string): string {
  return path.resolve(override || process.env.SERVER_DATA_DIR || path.join(process.cwd(), "server-data"));
}

/**
 * The shared bot secret. BOT_SECRET wins when set. Otherwise the first process
 * to start writes a random one to `<dataDir>/bot-secret` and every later one
 * reads it, so the lobby and the bot server agree without any setup.
 *
 * The file is written in full under a temporary name and then hard-linked into
 * place. The link fails if the file already exists, so two processes starting
 * together can never end up with different secrets or read a half-written one.
 */
export function loadBotSecret(dataDir: string): string {
  const fromEnv = process.env.BOT_SECRET?.trim();
  if (fromEnv) return fromEnv;

  fs.mkdirSync(dataDir, { recursive: true });
  const file = path.join(dataDir, "bot-secret");
  if (!fs.existsSync(file)) {
    const temp = `${file}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`;
    fs.writeFileSync(temp, randomBytes(32).toString("hex"), { mode: 0o600 });
    try {
      fs.linkSync(temp, file);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
    } finally {
      fs.rmSync(temp, { force: true });
    }
  }

  const secret = fs.readFileSync(file, "utf8").trim();
  if (!secret) throw new Error(`Bot secret file is empty: ${file}`);
  return secret;
}

/** Whether `presented` is the expected secret, compared in constant time. */
export function secretMatches(expected: string | undefined, presented: unknown): boolean {
  if (!expected || typeof presented !== "string" || presented.length === 0) return false;
  // Hash both sides so timingSafeEqual always compares equal lengths
  const digest = (value: string) => new Uint8Array(createHash("sha256").update(value).digest());
  return timingSafeEqual(digest(expected), digest(presented));
}
