/**
 * AccountSession — this browser's player account: logging in to the lobby,
 * keeping the key, renaming, and deleting it.
 *
 * The key lives in its own localStorage entry, never inside PlayerProfile,
 * whose JSON is meant to sync to a server one day. The account's name is copied
 * into PlayerProfile.name, which is what the game shows and sends to game
 * servers. See docs/research/PLAYER_IDENTITY.md.
 *
 * A hosted build (setUpHostedLogin) keeps the key in memory only and stores a
 * login token per region instead: every itch.io game runs on the same origin
 * and could read storage. The key is shown in the session that made or pasted
 * it; later sessions log in with the token, which never brings the key back.
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
    /** `banned`: the reason, end and appeal route the lobby gave. */
    readonly ban?: { reason?: string; until?: number; appeal?: string },
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
    banned: "This player is banned from Washoi's servers.",
    unknown_token: "This browser's saved login has ended. Paste your key to get your player back.",
    token_reused:
      "This browser's saved login was used somewhere else, so it has ended. Paste your key to get your player back.",
  };
  return messages[code];
}

/** The whole notice for a ban: what happened, why, until when, and how to appeal. */
export function banNoticeText(ban: { reason?: string; until?: number; appeal?: string } | undefined): string {
  const parts = [loginFailureText("banned")];
  if (ban?.reason) parts.push(`Reason: ${ban.reason}`);
  parts.push(ban?.until ? `Until: ${new Date(ban.until).toLocaleString()}` : "Until it is lifted.");
  if (ban?.appeal) parts.push(`To appeal: ${ban.appeal}`);
  return parts.join("\n");
}

/** The lobby's answer as a LoginError. */
function refused(answer: AuthErrorMessage): LoginError {
  return new LoginError(
    answer.code,
    answer.retryAfterSec,
    answer.code === "banned" ? { reason: answer.reason, until: answer.until, appeal: answer.appeal } : undefined,
  );
}

let identity: PlayerIdentityInfo | null = null;
let activeClient: LobbyClient | null = null;
let newAccount = false;
const watchedClients = new WeakSet<LobbyClient>();
const sessionValues = new Map<string, string | null>();
const sessionOnly = new Set<string>();
/** Entries kept in memory by choice, not because storage failed (`keepPlayerKeyInMemory`). */
const memoryOnly = new Set<string>();
/** A hosted build's login: the host label the lobby knows, and where this region's token is stored. */
let hostedLogin: { host: string; tokenStorage: string } | null = null;
/** Why this session's stored token was refused, for the welcome screen to say. */
let endedLogin: "unknown_token" | "token_reused" | null = null;

function readStorage(name: string): string | null {
  if (sessionOnly.has(name) || memoryOnly.has(name)) return sessionValues.get(name) ?? null;
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
  if (memoryOnly.has(name)) return;
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

/**
 * Never write the key to browser storage, for the rest of this page's life. A
 * hosted build calls this: every itch.io game runs on the same origin and
 * could read it there.
 */
export function keepPlayerKeyInMemory(): void {
  memoryOnly.add(KEY_STORAGE);
  memoryOnly.add(UNKNOWN_KEY_STORAGE);
}

/**
 * Log in as a hosted build on `host` ("itch"), in `region`: the key stays in
 * memory and a login token is stored per region (regions have separate
 * accounts, and share one origin here).
 */
export function setUpHostedLogin(host: string, region: string): void {
  keepPlayerKeyInMemory();
  hostedLogin = { host, tokenStorage: `shag_login_token:${region}` };
}

/** A hosted build whose key is not in this session: it was shown when the player was made or pasted. */
export function keyKeptElsewhere(): boolean {
  return hostedLogin !== null && storedPlayerKey() === null;
}

/** A hosted build with the key in this session, which is the one chance to save it. */
export function keyToSaveNow(): string | null {
  return hostedLogin ? storedPlayerKey() : null;
}

/** Why this browser's saved login was refused, when it was; the welcome screen says so. */
export function endedLoginReason(): "unknown_token" | "token_reused" | null {
  return endedLogin;
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
function sendAuth(
  client: LobbyClient,
  key: string | undefined,
  token?: string,
): Promise<WelcomeMessage | AuthErrorMessage> {
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
    client.auth(key, hostedLogin ? { host: hostedLogin.host, token } : undefined);
  });
}

/** Follow the account's settings; in a hosted build the account's copy wins over this browser's. */
function syncSettings(client: LobbyClient, answer: WelcomeMessage): Promise<void> {
  return startSettingsSync(client, answer, { accountCopyWins: hostedLogin !== null });
}

/** Keep the token a hosted build's login brought back. */
function keepToken(answer: WelcomeMessage): void {
  if (hostedLogin && answer.token) writeStorage(hostedLogin.tokenStorage, answer.token);
}

/**
 * A hosted build logs in with its stored token first: logging in with a key
 * would end the account's tokens in other browsers. Null when there is no
 * token, or the lobby refused it (then the token is dropped).
 */
async function logInWithToken(client: LobbyClient): Promise<WelcomeMessage | null> {
  if (!hostedLogin) return null;
  const token = readStorage(hostedLogin.tokenStorage);
  if (!token) return null;
  const answer = await sendAuth(client, undefined, token);
  if (answer.type === "welcome") {
    keepToken(answer);
    return answer;
  }
  if (answer.code !== "unknown_token" && answer.code !== "token_reused") throw refused(answer);
  writeStorage(hostedLogin.tokenStorage, null);
  endedLogin = answer.code;
  return null;
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

  const byToken = await logInWithToken(client);
  if (byToken) {
    if (byToken.identity) adopt(byToken.identity);
    void syncSettings(client, byToken);
    return byToken;
  }

  const key = storedPlayerKey();
  if (key) {
    const answer = await sendAuth(client, key);
    if (answer.type === "welcome") {
      // Retry saving a session key when storage becomes available again.
      writeStorage(KEY_STORAGE, key);
      keepToken(answer);
      if (answer.identity) adopt(answer.identity);
      void syncSettings(client, answer);
      return answer;
    }
    if (answer.code !== "unknown_key") throw refused(answer);
    writeStorage(UNKNOWN_KEY_STORAGE, key);
    writeStorage(KEY_STORAGE, null);
  }

  const answer = await sendAuth(client, undefined);
  if (answer.type !== "welcome") throw refused(answer);
  if (answer.key) writeStorage(KEY_STORAGE, answer.key);
  keepToken(answer);

  const earlierName = PlayerProfile.load().name;
  if (answer.identity) adopt(answer.identity);
  if (!LOCAL_DEFAULT_NAME.test(earlierName) && checkPlayerName(earlierName, isReserved) === null) {
    client.rename(earlierName);
  } else {
    newAccount = true;
  }
  void syncSettings(client, answer);
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
  endedLogin = null;
  writeStorage(KEY_STORAGE, key);
  keepToken(answer);
  if (answer.identity) adopt(answer.identity);
  void syncSettings(client, answer);
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
  if (hostedLogin) writeStorage(hostedLogin.tokenStorage, null);
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
  memoryOnly.clear();
  hostedLogin = null;
  endedLogin = null;
}
