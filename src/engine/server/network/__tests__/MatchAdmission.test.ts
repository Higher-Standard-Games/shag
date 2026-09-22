import { describe, expect, it } from "vitest";
import { issueMatchAdmission, MatchAdmission } from "../MatchAdmission";

describe("match admission", () => {
  it("issues separate unguessable tickets and consumes them once before expiry", () => {
    const { manifest, tickets } = issueMatchAdmission(
      "match-1",
      [
        { lobbyPlayerId: "p1", accountId: 12, name: "Alice", team: "udon", isBot: false },
        { lobbyPlayerId: "bot", accountId: null, name: "Bot", team: "soba", isBot: true },
      ],
      1000,
      200,
    );
    const first = tickets.get("p1")!;
    expect(first).not.toBe(tickets.get("bot"));
    expect(JSON.stringify(manifest)).not.toContain(first);
    const gate = new MatchAdmission(manifest);
    expect(gate.consume("wrong", 1000)).toBeNull();
    expect(gate.consume(first, 1200)).toMatchObject({ accountId: 12, name: "Alice", team: "udon" });
    expect(gate.consume(first, 1200)).toBeNull();
    expect(gate.consume(tickets.get("bot"), 1201)).toBeNull();
  });

  it("rejects duplicate lobby seats and self-asserted human accounts", () => {
    const human = { lobbyPlayerId: "p1", accountId: 12, name: "Alice", team: "udon", isBot: false };
    expect(() => issueMatchAdmission("match-1", [human, human])).toThrow("Invalid match seat");
    expect(() => issueMatchAdmission("match-1", [{ ...human, accountId: null }])).toThrow("Invalid match seat");
  });

  it("allows a dropped pre-game claimant to retry but never revives an expired ticket", () => {
    const { manifest, tickets } = issueMatchAdmission(
      "match-2",
      [{ lobbyPlayerId: "p1", accountId: 12, name: "Alice", team: "udon", isBot: false }],
      1000,
      200,
    );
    const ticket = tickets.get("p1")!;
    const gate = new MatchAdmission(manifest);
    const grant = gate.consume(ticket, 1100)!;
    expect(gate.consume(ticket, 1101)).toBeNull();
    expect(gate.releaseUnplayed(grant, 1102)).toBe(true);
    expect(gate.consume(ticket, 1103)).toBe(grant);
    expect(gate.releaseUnplayed(grant, 1201)).toBe(false);
    expect(gate.consume(ticket, 1201)).toBeNull();
  });

  it("releases a time-gated fallback only for an unplayed logical seat", () => {
    const { manifest, tickets, recoveryTickets } = issueMatchAdmission(
      "match-recovery",
      [{ lobbyPlayerId: "p1", accountId: 12, name: "Alice", team: "udon", isBot: false }],
      1000,
      200,
      2000,
    );
    const first = tickets.get("p1")!;
    const fallback = recoveryTickets.get(12)!.ticket;
    expect(JSON.stringify(manifest)).not.toContain(fallback);
    const gate = new MatchAdmission(manifest);
    expect(gate.consume(fallback, 1199)).toBeNull();
    const firstGrant = gate.consume(first, 1199)!;
    expect(gate.consume(fallback, 1200)).toBeNull();
    expect(gate.releaseUnplayed(firstGrant, 1201)).toBe(false); // expiry prevents replay, but frees the seat
    expect(gate.consume(first, 1201)).toBeNull();
    const recovered = gate.consume(fallback, 1201)!;
    expect(recovered).toMatchObject({ accountId: 12, name: "Alice", team: "udon" });
    expect(gate.releaseUnplayed(firstGrant, 1202)).toBe(false); // stale release cannot clear a newer claim
    expect(gate.consume(fallback, 1202)).toBeNull();
    expect(gate.releaseUnplayed(recovered, 1203)).toBe(true);
    expect(gate.consume(fallback, 3001)).toBeNull();

    const played = new MatchAdmission(manifest);
    expect(played.consume(first, 1100)).not.toBeNull();
    expect(played.consume(fallback, 1201)).toBeNull(); // no pre-game release after JoinGame
  });
});
