/** Server-only match seat credentials. Names sent by clients never identify accounts. */
import { createHash, randomBytes } from "node:crypto";

export interface MatchSeat {
  /** Lobby connection id, used only to address its private ticket. */
  lobbyPlayerId: string;
  accountId: number | null;
  name: string;
  team: string;
  isBot: boolean;
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

function hash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
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
  if (
    !matchId ||
    seats.length === 0 ||
    !Number.isSafeInteger(now) ||
    !Number.isSafeInteger(lifetimeMs) ||
    lifetimeMs <= 0 ||
    !Number.isSafeInteger(now + lifetimeMs) ||
    !Number.isSafeInteger(recoveryLifetimeMs) ||
    recoveryLifetimeMs < 0 ||
    (recoveryLifetimeMs > 0 && (recoveryLifetimeMs <= lifetimeMs || !Number.isSafeInteger(now + recoveryLifetimeMs)))
  ) {
    throw new Error("Invalid match admission metadata");
  }
  const tickets = new Map<string, string>();
  const recoveryTickets = new Map<number, { ticket: string; availableAt: number; expiresAt: number }>();
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
    const ticket = randomBytes(32).toString("base64url");
    if (!seat.isBot) humanAccounts.add(seat.accountId!);
    tickets.set(lobbyPlayerId, ticket);
    const seatId = randomBytes(16).toString("base64url");
    grants.push({ ...seat, seatId, tokenHash: hash(ticket) });
    if (recoveryLifetimeMs > 0 && !seat.isBot) {
      const fallback = randomBytes(32).toString("base64url");
      const availableAt = now + lifetimeMs;
      const expiresAt = now + recoveryLifetimeMs;
      recoveryTickets.set(seat.accountId!, { ticket: fallback, availableAt, expiresAt });
      grants.push({ ...seat, seatId, tokenHash: hash(fallback), notBefore: availableAt, expiresAt });
    }
  }
  return { manifest: { matchId, expiresAt: now + lifetimeMs, grants }, tickets, recoveryTickets };
}

/** A consumed ticket cannot be used to claim a second player entity. */
export class MatchAdmission {
  private readonly grants: Map<string, AdmissionGrant>;
  private readonly claimedSeats = new Map<string, string>();
  private readonly issued: Map<string, AdmissionGrant>;

  constructor(readonly manifest: AdmissionManifest) {
    this.issued = new Map(manifest.grants.map((grant) => [grant.tokenHash, grant]));
    this.grants = new Map(this.issued);
    if (this.grants.size !== manifest.grants.length) throw new Error("Duplicate match seat credential");
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
