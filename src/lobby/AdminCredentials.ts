/**
 * Who may sign in to the lobby's admin panel: `admin.json` in the lobby's data
 * directory, which is never committed. Each admin is a name and an scrypt hash
 * of their password; the password itself is not stored. The panel is off while
 * the file is missing or lists nobody.
 *
 * Written by `npm run fair-play -- add-admin <name>` with mode 0600, and read
 * at each sign-in, so adding or removing an admin needs no restart.
 */
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export const ADMIN_FILE = "admin.json";
/** Shortest password `add-admin` accepts. */
export const MIN_ADMIN_PASSWORD = 12;
const ADMIN_NAME = /^[a-zA-Z0-9_.-]{1,32}$/;
const SCRYPT = { N: 1 << 15, r: 8, p: 1, keyLength: 32 };
/** scrypt with N = 2^15 needs 32 MiB; Node's default ceiling is exactly that. */
const SCRYPT_MAXMEM = 64 * 1024 * 1024;

interface AdminFile {
  admins: { name: string; hash: string }[];
}

export function adminFilePath(dataDir: string): string {
  return path.join(dataDir, ADMIN_FILE);
}

export function validAdminName(name: string): boolean {
  return ADMIN_NAME.test(name);
}

/** `scrypt$N$r$p$salt$hash`, salt and hash in base64url. */
export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, Uint8Array.from(salt), SCRYPT.keyLength, {
    N: SCRYPT.N,
    r: SCRYPT.r,
    p: SCRYPT.p,
    maxmem: SCRYPT_MAXMEM,
  });
  return ["scrypt", SCRYPT.N, SCRYPT.r, SCRYPT.p, salt.toString("base64url"), hash.toString("base64url")].join("$");
}

export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [N, r, p] = parts.slice(1, 4).map(Number);
  if (![N, r, p].every(Number.isSafeInteger) || N > 1 << 20 || r > 32 || p > 16) return false;
  const salt = Buffer.from(parts[4], "base64url");
  const wanted = Buffer.from(parts[5], "base64url");
  if (salt.length < 8 || wanted.length < 16) return false;
  try {
    const actual = scryptSync(password, Uint8Array.from(salt), wanted.length, {
      N,
      r,
      p,
      maxmem: Math.max(SCRYPT_MAXMEM, 256 * N * r),
    });
    return timingSafeEqual(Uint8Array.from(actual), Uint8Array.from(wanted));
  } catch {
    return false;
  }
}

function read(file: string): AdminFile {
  let text: string;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    return { admins: [] };
  }
  const data = JSON.parse(text) as Partial<AdminFile>;
  const admins = Array.isArray(data?.admins) ? data.admins : [];
  return {
    admins: admins.filter(
      (a) => a && typeof a.name === "string" && validAdminName(a.name) && typeof a.hash === "string",
    ),
  };
}

function write(file: string, data: AdminFile): void {
  const temp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temp, file);
}

/** Admin names in the file; empty when it is missing or unreadable. */
export function adminNames(file: string): string[] {
  try {
    return read(file).admins.map((a) => a.name);
  } catch {
    return [];
  }
}

/**
 * The admin's name, with its stored capitals, when the password is theirs.
 * An unknown name still costs one scrypt, so timing does not tell names apart.
 */
export function checkAdmin(file: string, name: string, password: string): string | null {
  let admins: AdminFile["admins"] = [];
  try {
    admins = read(file).admins;
  } catch {
    // An unreadable file signs nobody in.
  }
  const admin = admins.find((a) => a.name.toLowerCase() === name.toLowerCase());
  const ok = verifyPassword(password, admin?.hash ?? DUMMY_HASH());
  return admin && ok ? admin.name : null;
}

let dummy: string | null = null;
function DUMMY_HASH(): string {
  dummy ??= hashPassword(randomBytes(16).toString("hex"));
  return dummy;
}

/** Add an admin, or set a new password for one. */
export function setAdmin(file: string, name: string, password: string): void {
  if (!validAdminName(name)) throw new Error("Admin names are 1-32 letters, digits, '_', '.' or '-'");
  if (password.length < MIN_ADMIN_PASSWORD) {
    throw new Error(`The password needs at least ${MIN_ADMIN_PASSWORD} characters`);
  }
  const data = read(file);
  const others = data.admins.filter((a) => a.name.toLowerCase() !== name.toLowerCase());
  write(file, { admins: [...others, { name, hash: hashPassword(password) }] });
}

export function removeAdmin(file: string, name: string): boolean {
  const data = read(file);
  const kept = data.admins.filter((a) => a.name.toLowerCase() !== name.toLowerCase());
  if (kept.length === data.admins.length) return false;
  write(file, { admins: kept });
  return true;
}
