/**
 * AccountSession — this browser's player account: logging in to the lobby,
 * keeping the key, renaming, and deleting it.
 *
 * The key lives in its own localStorage entry, never inside PlayerProfile,
 * whose JSON is meant to sync to a server one day. The account's name is copied
 * into PlayerProfile.name, which is what the game shows and sends to game
 * servers. See docs/research/PLAYER_IDENTITY.md.
 */

import { PlayerProfile } from "../engine/player/PlayerProfile";
import type { LobbyClient } from "./LobbyClient";
import { checkPlayerName, normalizeKey, type PlayerNameReservation } from "./PlayerIdentity";
import { startSettingsSync } from "./SettingsSync";
import type {
  AuthErrorCode,
  AuthErrorMessage,
  IdentityDeletedMessage,
  IdentityErrorCode,
  IdentityErrorMessage,
  IdentityRenamedMessage,
  PlayerIdentityInfo,
  WelcomeMessage,
} from "./types";

const KEY_STORAGE = "shag_player_key";
/** A key the lobby no longer knew; kept so the player can still try restoring it. */
const UNKNOWN_KEY_STORAGE = "shag_player_key_unknown";
const ANSWER_TIMEOUT_MS = 10_000;
/** The name PlayerProfile makes up for a new browser (Player_ and 4 base36 characters). */
const LOCAL_DEFAULT_NAME = /^Player_[a-z0-9]{4}$/;

export type RenameFailure = IdentityErrorCode | "not_connected" | "timeout";

export type RenameOutcome = { ok: true; identity: PlayerIdentityInfo } | { ok: false; code: RenameFailure };

const RENAME_FAILURES: Record<RenameFailure, string> = {
  name_invalid: "Names are 2–16 letters, digits, _ or -.",
  name_reserved: "That name is kept for bots and new players.",
  name_offensive: "That name isn't allowed. Pick another.",
  name_taken: "Someone already has that name.",
  in_lobby: "Leave the room first, then rename.",
  rate_limited: "Too many tries. Try again in a minute.",
  not_confirmed: "Tick the box first.",
  wrong_key: "That isn't this player's key. Paste the whole key again.",
  timeout: "The lobby didn't answer. Try again.",
  not_connected: "Not connected to the lobby.",
};

/** What to tell the player when a rename fails. */
export function renameFailureText(code: RenameFailure): string {
  return RENAME_FAILURES[code] ?? `Rename failed: ${code}`;
}

/** Login failed with an answer from the lobby, as opposed to a lost connection. */
export class LoginError extends Error {
  constructor(
    readonly code: AuthErrorCode,
    /** `lobby_full`: seconds the lobby asks the client to wait before trying again. */
    readonly retryAfterSec?: number,
  ) {
    super(`Lobby refused the login: ${code}`);
  }
}

/** Keep welcome and Profile consistent about why an account restore failed. */
export function loginFailureText(code: AuthErrorCode): string {
  const messages: Record<AuthErrorCode, string> = {
    unknown_key: "No player has that key. Check it, or keep the player you have.",
    rate_limited: "Too many tries. Wait a minute, then try again.",
    lobby_full: "Servers are full. Your current player key is unchanged. Try again shortly.",
    already_authenticated: "This connection is already logged in. Try again.",
  };
  return messages[code];
}

/** The lobby's answer as a LoginError. */
function refused(answer: AuthErrorMessage): LoginError {
  return new LoginError(answer.code, answer.retryAfterSec);
}

let identity: PlayerIdentityInfo | null = null;
let activeClient: LobbyClient | null = null;
let newAccount = false;
const watchedClients = new WeakSet<LobbyClient>();
const sessionValues = new Map<string, string | null>();
const sessionOnly = new Set<string>();

function readStorage(name: string): string | null {
  if (sessionOnly.has(name)) return sessionValues.get(name) ?? null;
  try {
    const value = localStorage.getItem(name);
    sessionValues.set(name, value);
    return value;
  } catch {
    sessionOnly.add(name);
    return sessionValues.get(name) ?? null;
  }
}

function writeStorage(name: string, value: string | null): void {
  sessionValues.set(name, value);
  try {
    if (value === null) localStorage.removeItem(name);
    else localStorage.setItem(name, value);
    sessionOnly.delete(name);
  } catch {
    sessionOnly.add(name);
  }
}

/** The key this browser logs in with, if it has one. */
export function storedPlayerKey(): string | null {
  return readStorage(KEY_STORAGE);
}

/** Whether the accepted key is available here but could not be kept for a reload. */
export function playerKeyIsSessionOnly(): boolean {
  return storedPlayerKey() !== null && sessionOnly.has(KEY_STORAGE);
}

/** The key the lobby last refused as unknown, if any. */
export function unknownPlayerKey(): string | null {
  return readStorage(UNKNOWN_KEY_STORAGE);
}

/** The account this browser is logged in to, or null before login and for bots. */
export function currentIdentity(): PlayerIdentityInfo | null {
  return identity;
}

/**
 * Whether the last login made this browser a new account that nobody has
 * named yet: the moment to ask the player who they are. A browser carrying a
 * name from before accounts asks for that name instead, so it doesn't count.
 */
export function accountIsNew(): boolean {
  return newAccount;
}

/** Take the lobby's word for who we are, and show that name everywhere. */
function adopt(next: PlayerIdentityInfo): void {
  identity = next;
  const profile = PlayerProfile.load();
  if (profile.name !== next.name) {
    profile.name = next.name;
    profile.save();
  }
}

/** Use `client` from now on, and follow renames made from any tab logged in to this account. */
function attach(client: LobbyClient): void {
  activeClient = client;
  if (watchedClients.has(client)) return;
  watchedClients.add(client);
  client.on("identity:renamed", (msg: IdentityRenamedMessage) => adopt(msg.identity));
  // Deleted from another tab: this one forgets the account too
  client.on("identity:deleted", () => forgetDeletedAccount());
}

/** Send `auth` and wait for the lobby's answer. */
function sendAuth(client: LobbyClient, key: string | undefined): Promise<WelcomeMessage | AuthErrorMessage> {
  return new Promise((resolve, reject) => {
    const finish = (fn: () => void) => {
      clearTimeout(timer);
      for (const unsubscribe of unsubscribers) unsubscribe();
      fn();
    };
    const unsubscribers = [
      client.on("welcome", (msg: WelcomeMessage) => finish(() => resolve(msg))),
      client.on("auth:error", (msg: AuthErrorMessage) => finish(() => resolve(msg))),
      client.on("_disconnected", () => finish(() => reject(new Error("Lobby connection closed during login")))),
    ];
    const timer = setTimeout(
      () => finish(() => reject(new Error("Lobby did not answer the login"))),
      ANSWER_TIMEOUT_MS,
    );
    client.auth(key);
  });
}

/**
 * Log in on a connected client: with the stored key, or into a new account
 * whose key is then stored. Resolves with the lobby's welcome.
 *
 * If the lobby doesn't know the stored key (for example its accounts were
 * reset), the key is set aside (see unknownPlayerKey) and a new account made.
 * A browser that had a name before accounts existed asks for that name on its
 * new account; if it's taken, the account keeps its Player_<number> name.
 */
export async function logIn(client: LobbyClient, isReserved?: PlayerNameReservation): Promise<WelcomeMessage> {
  attach(client);
  newAccount = false;

  const key = storedPlayerKey();
  if (key) {
    const answer = await sendAuth(client, key);
    if (answer.type === "welcome") {
      // Retry saving a session key when storage becomes available again.
      writeStorage(KEY_STORAGE, key);
      if (answer.identity) adopt(answer.identity);
      void startSettingsSync(client, answer);
      return answer;
    }
    if (answer.code !== "unknown_key") throw refused(answer);
    writeStorage(UNKNOWN_KEY_STORAGE, key);
    writeStorage(KEY_STORAGE, null);
  }

  const answer = await sendAuth(client, undefined);
  if (answer.type !== "welcome") throw refused(answer);
  if (answer.key) writeStorage(KEY_STORAGE, answer.key);

  const earlierName = PlayerProfile.load().name;
  if (answer.identity) adopt(answer.identity);
  if (!LOCAL_DEFAULT_NAME.test(earlierName) && checkPlayerName(earlierName, isReserved) === null) {
    client.rename(earlierName);
  } else {
    newAccount = true;
  }
  void startSettingsSync(client, answer);
  return answer;
}

/**
 * Log in with a key the player pasted, to restore their account in this
 * browser. `client` must be connected and not yet logged in, which means a new
 * connection when switching accounts. The pasted key replaces the stored one
 * only once the lobby accepts it: a mistyped key rejects with
 * LoginError("unknown_key") and leaves the stored key alone.
 */
export async function restoreAccount(client: LobbyClient, pastedKey: string): Promise<WelcomeMessage> {
  const key = normalizeKey(pastedKey);
  if (!key) throw new LoginError("unknown_key");
  const answer = await sendAuth(client, key);
  if (answer.type !== "welcome") throw refused(answer);
  attach(client);
  newAccount = false;
  writeStorage(KEY_STORAGE, key);
  if (answer.identity) adopt(answer.identity);
  void startSettingsSync(client, answer);
  return answer;
}

/**
 * Rename the logged-in account. Every tab logged in to it takes the new name,
 * and PlayerProfile.name follows.
 */
export function renameAccount(name: string): Promise<RenameOutcome> {
  const client = activeClient;
  if (!client?.connected || !identity) return Promise.resolve({ ok: false, code: "not_connected" });

  return new Promise((resolve) => {
    const finish = (outcome: RenameOutcome) => {
      clearTimeout(timer);
      for (const unsubscribe of unsubscribers) unsubscribe();
      resolve(outcome);
    };
    const unsubscribers = [
      client.on("identity:renamed", (msg: IdentityRenamedMessage) => finish({ ok: true, identity: msg.identity })),
      client.on("identity:error", (msg: IdentityErrorMessage) => finish({ ok: false, code: msg.code })),
      client.on("_disconnected", () => finish({ ok: false, code: "not_connected" })),
    ];
    const timer = setTimeout(() => finish({ ok: false, code: "timeout" }), ANSWER_TIMEOUT_MS);
    client.rename(name);
  });
}

export type DeleteOutcome = { ok: true } | { ok: false; code: RenameFailure };

/**
 * Delete the logged-in account for good, if `pastedKey` is its key. On success
 * this browser forgets the key and the name, so the next visit starts a new
 * player; the lobby closes the connection itself.
 */
export function deleteAccount(pastedKey: string, confirmed: boolean): Promise<DeleteOutcome> {
  const client = activeClient;
  if (!client?.connected || !identity) return Promise.resolve({ ok: false, code: "not_connected" });

  return new Promise((resolve) => {
    const finish = (outcome: DeleteOutcome) => {
      clearTimeout(timer);
      for (const unsubscribe of unsubscribers) unsubscribe();
      resolve(outcome);
    };
    const unsubscribers = [
      // attach() has already forgotten the account by the time this runs
      client.on("identity:deleted", (_msg: IdentityDeletedMessage) => finish({ ok: true })),
      client.on("identity:error", (msg: IdentityErrorMessage) => finish({ ok: false, code: msg.code })),
      client.on("_disconnected", () => finish({ ok: false, code: "not_connected" })),
    ];
    const timer = setTimeout(() => finish({ ok: false, code: "timeout" }), ANSWER_TIMEOUT_MS);
    client.deleteAccount(pastedKey, confirmed);
  });
}

/** The account is gone: drop its key and name here, so nothing logs back in or reclaims the name. */
function forgetDeletedAccount(): void {
  identity = null;
  newAccount = false;
  writeStorage(KEY_STORAGE, null);
  writeStorage(UNKNOWN_KEY_STORAGE, null);
  const profile = PlayerProfile.load();
  profile.name = PlayerProfile.defaultName();
  profile.save();
}

/** Forget the session, for tests. Leaves stored keys alone. */
export function resetAccountSessionForTests(): void {
  identity = null;
  activeClient = null;
  newAccount = false;
  sessionValues.clear();
  sessionOnly.clear();
}
