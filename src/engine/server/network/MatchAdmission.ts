/** Server-only match seat credentials. Names sent by clients never identify accounts. */
import { createHash, randomBytes } from "node:crypto";
import { type BotReference, canonicalBotReference } from "../../../shared/ranking/BotReference";

export interface MatchSeat {
  /** Lobby connection id, used only to address its private ticket. */
  lobbyPlayerId: string;
  accountId: number | null;
  name: string;
  team: string;
  isBot: boolean;
  botReference?: BotReference;
}

export interface AdmissionGrant extends Omit<MatchSeat, "lobbyPlayerId"> {
  tokenHash: string;
  /** Both credentials for one seat share a claim, even across socket drops. */
  seatId?: string;
  notBefore?: number;
  expiresAt?: number;
}

export interface AdmissionManifest {
  matchId: string;
  expiresAt: number;
  grants: AdmissionGrant[];
}

/**
 * The stdin command a lobby sends its own game server to add seats while the
 * match runs, followed by the base64url JSON of the grants. Only the parent
 * process can write to a child's stdin, and the grants carry hashes only.
 */
export const ADMIT_COMMAND = "admit";
/** The stdout line a game server prints once it holds the grants for a seat. */
export const ADMIT_ACK_PREFIX = "SHAG_ADMITTED ";

function hash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** A recovery ticket: the same seat again, claimable later and for longer. */
export interface RecoveryTicket {
  ticket: string;
  availableAt: number;
  expiresAt: number;
}

/**
 * The grants for one human or bot seat: its ticket, and for a human a recovery
 * ticket on the same seat that unlocks when the first one expires.
 */
function grantSeat(
  seat: Omit<MatchSeat, "lobbyPlayerId">,
  now: number,
  lifetimeMs: number,
  recoveryLifetimeMs: number,
): { ticket: string; grants: AdmissionGrant[]; recovery: RecoveryTicket | null } {
  const ticket = randomBytes(32).toString("base64url");
  const seatId = randomBytes(16).toString("base64url");
  if (seat.botReference !== undefined) {
    if (!seat.isBot) throw new Error("Human seat cannot carry a bot reference");
    seat = { ...seat, botReference: canonicalBotReference(seat.botReference) };
  }
  const grants: AdmissionGrant[] = [{ ...seat, seatId, tokenHash: hash(ticket) }];
  if (recoveryLifetimeMs <= 0 || seat.isBot) return { ticket, grants, recovery: null };
  const fallback = randomBytes(32).toString("base64url");
  const availableAt = now + lifetimeMs;
  const expiresAt = now + recoveryLifetimeMs;
  grants.push({ ...seat, seatId, tokenHash: hash(fallback), notBefore: availableAt, expiresAt });
  return { ticket, grants, recovery: { ticket: fallback, availableAt, expiresAt } };
}

function validLifetimes(now: number, lifetimeMs: number, recoveryLifetimeMs: number): boolean {
  return (
    Number.isSafeInteger(now) &&
    Number.isSafeInteger(lifetimeMs) &&
    lifetimeMs > 0 &&
    Number.isSafeInteger(now + lifetimeMs) &&
    Number.isSafeInteger(recoveryLifetimeMs) &&
    recoveryLifetimeMs >= 0 &&
    (recoveryLifetimeMs === 0 || (recoveryLifetimeMs > lifetimeMs && Number.isSafeInteger(now + recoveryLifetimeMs)))
  );
}

/** Split private per-player tickets from the manifest passed to the spawned server. */
export function issueMatchAdmission(
  matchId: string,
  seats: readonly MatchSeat[],
  now = Date.now(),
  lifetimeMs = 2 * 60_000,
  recoveryLifetimeMs = 0,
): {
  manifest: AdmissionManifest;
  tickets: Map<string, string>;
  recoveryTickets: Map<number, { ticket: string; availableAt: number; expiresAt: number }>;
} {
  if (!matchId || seats.length === 0 || !validLifetimes(now, lifetimeMs, recoveryLifetimeMs)) {
    throw new Error("Invalid match admission metadata");
  }
  const tickets = new Map<string, string>();
  const recoveryTickets = new Map<number, RecoveryTicket>();
  const humanAccounts = new Set<number>();
  const grants: AdmissionGrant[] = [];
  for (const { lobbyPlayerId, ...seat } of seats) {
    if (
      !lobbyPlayerId ||
      tickets.has(lobbyPlayerId) ||
      !seat.name ||
      !seat.team ||
      (seat.isBot
        ? seat.accountId !== null
        : !Number.isSafeInteger(seat.accountId) || (seat.accountId ?? 0) <= 0 || humanAccounts.has(seat.accountId!))
    ) {
      throw new Error("Invalid match seat");
    }
    if (!seat.isBot) humanAccounts.add(seat.accountId!);
    const granted = grantSeat(seat, now, lifetimeMs, recoveryLifetimeMs);
    tickets.set(lobbyPlayerId, granted.ticket);
    grants.push(...granted.grants);
    if (granted.recovery) recoveryTickets.set(seat.accountId!, granted.recovery);
  }
  return { manifest: { matchId, expiresAt: now + lifetimeMs, grants }, tickets, recoveryTickets };
}

/**
 * One more human seat for a match already running: a player dropping into
 * free room. Its ticket expires on its own clock rather than the manifest's,
 * which ran out minutes after the match started.
 */
export function issueDropInSeat(
  seat: Omit<MatchSeat, "lobbyPlayerId">,
  now = Date.now(),
  lifetimeMs = 2 * 60_000,
  recoveryLifetimeMs = 0,
): { ticket: string; grants: AdmissionGrant[]; recovery: RecoveryTicket | null } {
  if (
    !validLifetimes(now, lifetimeMs, recoveryLifetimeMs) ||
    seat.isBot ||
    !seat.name ||
    !seat.team ||
    !Number.isSafeInteger(seat.accountId) ||
    (seat.accountId ?? 0) <= 0
  ) {
    throw new Error("Invalid drop-in seat");
  }
  const granted = grantSeat(seat, now, lifetimeMs, recoveryLifetimeMs);
  granted.grants[0].expiresAt = now + lifetimeMs;
  return granted;
}

/** True for a grant shaped as issueDropInSeat makes them, as read back off a pipe. */
function isDropInGrant(value: unknown): value is AdmissionGrant {
  const grant = value as Partial<AdmissionGrant> | null;
  return (
    !!grant &&
    typeof grant.tokenHash === "string" &&
    /^[0-9a-f]{64}$/.test(grant.tokenHash) &&
    typeof grant.seatId === "string" &&
    grant.seatId.length > 0 &&
    grant.isBot === false &&
    grant.botReference === undefined &&
    Number.isSafeInteger(grant.accountId) &&
    (grant.accountId ?? 0) > 0 &&
    typeof grant.name === "string" &&
    grant.name.length > 0 &&
    typeof grant.team === "string" &&
    grant.team.length > 0 &&
    Number.isSafeInteger(grant.expiresAt) &&
    (grant.notBefore === undefined || Number.isSafeInteger(grant.notBefore))
  );
}

/** A consumed ticket cannot be used to claim a second player entity. */
export class MatchAdmission {
  private readonly grants: Map<string, AdmissionGrant>;
  private readonly claimedSeats = new Map<string, string>();
  private readonly issued: Map<string, AdmissionGrant>;

  constructor(readonly manifest: AdmissionManifest) {
    for (const grant of manifest.grants)
      if (grant.botReference !== undefined) {
        if (!grant.isBot) throw new Error("Human seat cannot carry a bot reference");
        grant.botReference = canonicalBotReference(grant.botReference);
      }
    this.issued = new Map(manifest.grants.map((grant) => [grant.tokenHash, grant]));
    this.grants = new Map(this.issued);
    if (this.grants.size !== manifest.grants.length) throw new Error("Duplicate match seat credential");
  }

  /**
   * Add a drop-in seat while the match runs. All of a seat's grants arrive
   * together; none is taken if any is malformed, already issued, or would give
   * an account a second seat.
   */
  admit(grants: readonly unknown[]): boolean {
    if (grants.length === 0 || !grants.every(isDropInGrant)) return false;
    const seatId = grants[0].seatId;
    const accountId = grants[0].accountId;
    if (grants.some((grant) => grant.seatId !== seatId || grant.accountId !== accountId)) return false;
    if (new Set(grants.map((grant) => grant.tokenHash)).size !== grants.length) return false;
    for (const issued of this.issued.values()) {
      if (grants.some((grant) => grant.tokenHash === issued.tokenHash)) return false;
      if (issued.accountId === accountId) return false;
    }
    for (const grant of grants) {
      this.issued.set(grant.tokenHash, grant);
      this.grants.set(grant.tokenHash, grant);
      this.manifest.grants.push(grant);
    }
    return true;
  }

  consume(token: string | undefined, now = Date.now()): AdmissionGrant | null {
    if (!token) return null;
    const key = hash(token);
    const grant = this.grants.get(key);
    if (!grant || now < (grant.notBefore ?? 0) || now > (grant.expiresAt ?? this.manifest.expiresAt)) return null;
    const seatId = grant.seatId ?? key;
    if (this.claimedSeats.has(seatId)) return null;
    this.grants.delete(key);
    this.claimedSeats.set(seatId, key);
    return grant;
  }

  /** Restore a claim only if its socket dropped before becoming a player. */
  releaseUnplayed(grant: AdmissionGrant, now = Date.now()): boolean {
    const key = grant.tokenHash;
    const seatId = grant.seatId ?? key;
    if (this.issued.get(key) !== grant || this.claimedSeats.get(seatId) !== key) return false;
    this.claimedSeats.delete(seatId);
    if (now > (grant.expiresAt ?? this.manifest.expiresAt)) return false;
    this.grants.set(key, grant);
    return true;
  }
}
