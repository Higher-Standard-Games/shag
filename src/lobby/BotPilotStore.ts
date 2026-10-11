/** Read-only export from verified receipts; never reconstructs results from demos. */
import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { type BotPilot, type PilotTrial, validatePilot } from "../shared/ranking/BotPilot";
import { canonicalBotReference, sameBotReference } from "../shared/ranking/BotReference";
import { matchRatingGroups } from "../shared/ranking/MatchRatingGroups";
import { isProvisional, RATING_POLICY, type RatingMode, type RatingState } from "../shared/ranking/RatingPolicy";
import { RatingStore } from "./RatingStore";

export function botReferenceId(reference: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(canonicalBotReference(reference)))
    .digest("hex");
}

export class BotPilotStore {
  constructor(private readonly db: DatabaseSync) {}

  export(
    mode: RatingMode,
    anchorScope: "private" | "public" = "private",
    afterSequence = 0,
    throughSequence?: number,
  ): BotPilot {
    if (
      !Object.keys(RATING_POLICY.drawProbability).includes(mode) ||
      !["private", "public"].includes(anchorScope) ||
      !Number.isSafeInteger(afterSequence) ||
      afterSequence < 0
    )
      throw new Error("Invalid pilot selection");
    const ratings = new RatingStore(this.db, false);
    return ratings.verifiedRead(() => {
      const highWater = Number(this.db.prepare("SELECT MAX(sequence) AS n FROM ranking_results").get()?.n ?? 0);
      const through = throughSequence ?? highWater;
      if (!Number.isSafeInteger(through) || through < afterSequence || through > highWater)
        throw new Error("Invalid pilot sequence boundary");
      const pilot: BotPilot = {
        version: 1,
        kind: "bot_pilot",
        policyVersion: RATING_POLICY.version,
        mode,
        anchorScope,
        afterSequence,
        throughSequence: through,
        capturedAt: Date.now(),
        references: [],
        trials: [],
        skipped: [],
      };
      const rows = this.db
        .prepare(`SELECT sequence, match_id FROM ranking_results
        WHERE scope = 'private' AND gametype = ? AND sequence > ? AND sequence <= ? ORDER BY sequence LIMIT 10001`)
        .all(mode, afterSequence, through);
      if (rows.length > 10000) throw new Error("Pilot export exceeds 10000 matches; use sequence boundaries");
      for (const row of rows) {
        const sequence = Number(row.sequence),
          matchId = String(row.match_id);
        const result = ratings.getResult(matchId)!;
        const snapshot = result.snapshot;
        if (!snapshot.bots) continue;
        const skip = (reason: string) => pilot.skipped.push({ sequence, matchId, reason });
        if (snapshot.bots !== 1) {
          skip("pilot_requires_one_bot");
          continue;
        }
        if (result.receipt.ratingStatus !== "pending" || result.receipt.ratingReason !== "bot_reference_pending") {
          skip(`processing:${result.receipt.ratingReason}`);
          continue;
        }
        if (snapshot.completion !== "normal") {
          skip("pilot_requires_normal_finish");
          continue;
        }
        if (snapshot.botReferenceChanged !== false) {
          skip("bot_control_unknown_or_changed");
          continue;
        }
        if (!snapshot.mapDigest) {
          skip("map_digest_unavailable");
          continue;
        }
        const bot = snapshot.seats.find((seat) => seat.accountId === null);
        const original = snapshot.startingRoster?.find((seat) => seat.isBot);
        if (
          !bot?.botReference ||
          !original?.botReference ||
          !sameBotReference(bot.botReference, original.botReference)
        ) {
          skip("bot_identity_unavailable_or_changed");
          continue;
        }
        const reference = canonicalBotReference(bot.botReference);
        if (reference.preset === "custom" || !["none", "loaded"].includes(reference.model.status)) {
          skip("bot_identity_unresolved");
          continue;
        }
        // One bot only: temporary ID lets the established participation adapter
        // validate the whole contest. This ID never enters any account/rating table.
        let botId = Number.MAX_SAFE_INTEGER;
        while (snapshot.seats.some((seat) => seat.accountId === botId)) botId--;
        const decision = matchRatingGroups({
          ...snapshot,
          bots: 0,
          seats: snapshot.seats.map((seat) => (seat.accountId === null ? { ...seat, accountId: botId } : seat)),
          startingRoster: snapshot.startingRoster!.map((seat) =>
            seat.isBot ? { ...seat, isBot: false, accountId: botId } : seat,
          ),
        });
        if (decision.status !== "applied") {
          skip(`participation:${decision.reason}`);
          continue;
        }
        const anchors = new Map<number, { sequence: number; state: RatingState }>();
        for (const seat of snapshot.seats) {
          if (seat.accountId === null) continue;
          const prior = this.db
            .prepare(`SELECT u.sequence, u.after_mu, u.after_sigma, u.after_matches FROM rating_updates u
            JOIN ranking_results rr ON rr.sequence = u.sequence
            WHERE u.account_id = ? AND u.gametype = ? AND u.scope = ? AND u.policy_version = ?
              AND u.sequence < ? AND rr.ended_at <= ? ORDER BY u.sequence DESC LIMIT 1`)
            .get(seat.accountId, mode, anchorScope, RATING_POLICY.version, sequence, snapshot.startedAt);
          if (!prior) continue;
          const state: RatingState = {
            policyVersion: RATING_POLICY.version,
            mu: Number(prior.after_mu),
            sigma: Number(prior.after_sigma),
            ratedMatches: Number(prior.after_matches),
          };
          if (!isProvisional(state)) anchors.set(seat.accountId, { sequence: Number(prior.sequence), state });
        }
        if (anchors.size !== snapshot.seats.length - 1) {
          skip("established_human_anchor_unavailable");
          continue;
        }
        const referenceId = botReferenceId(reference);
        const trial: PilotTrial = {
          sequence,
          matchId,
          map: snapshot.map,
          mapDigest: snapshot.mapDigest,
          referenceId,
          groups: decision.groups.map((group) => ({
            rank: group.rank,
            players: group.accountIds.map((accountId) => {
              if (accountId === botId) return { kind: "bot" as const, playerId: "bot" };
              const anchor = anchors.get(accountId)!;
              return {
                kind: "human" as const,
                playerId: `h:${accountId}`,
                anchorSequence: anchor.sequence,
                state: anchor.state,
              };
            }),
          })),
        };
        if (!pilot.references.some((ref) => ref.id === referenceId))
          pilot.references.push({ id: referenceId, reference });
        pilot.trials.push(trial);
      }
      pilot.references.sort((a, b) => a.id.localeCompare(b.id));
      validatePilot(pilot);
      return pilot;
    }).data;
  }
}
