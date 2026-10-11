/** Headless numerical smoke/simulation only. Does not open a lobby or database. */
import { mulberry32 } from "../shared/DeterministicRng";
import { rateWithFixedReferences } from "../shared/ranking/FixedReferenceRating";
import {
  displayRating,
  initialRating,
  isProvisional,
  RATING_POLICY,
  type RatingMode,
} from "../shared/ranking/RatingPolicy";
import { type RatingGroup, rateMatch } from "../shared/ranking/TrueSkillRating";

function simulate(mode: RatingMode, count: number, skillGap: boolean) {
  const random = mulberry32(927);
  const players = Array.from({ length: count }, (_, i) => ({
    playerId: String(i).padStart(2, "0"),
    trueMu: skillGap ? 15 + (20 * i) / (count - 1) : 25,
    state: initialRating(),
    firstNonProvisionalMatch: null as number | null,
  }));
  const checkpoints = [];
  for (let match = 1; match <= 500; match++) {
    const performance = players.map((entry) => ({
      entry,
      value:
        entry.trueMu + RATING_POLICY.beta * Math.sqrt(-2 * Math.log(1 - random())) * Math.cos(2 * Math.PI * random()),
      shuffle: random(),
    }));
    let groups: RatingGroup[];
    if (mode === "snd") {
      performance.sort((a, b) => a.shuffle - b.shuffle);
      const sides = [performance.slice(0, count / 2), performance.slice(count / 2)];
      const winner =
        sides[0].reduce((sum, p) => sum + p.value, 0) >= sides[1].reduce((sum, p) => sum + p.value, 0) ? 0 : 1;
      groups = sides.map((side, i) => ({ rank: i === winner ? 0 : 1, players: side.map(({ entry }) => entry) }));
    } else {
      performance.sort((a, b) => b.value - a.value);
      groups = performance.map(({ entry }, rank) => ({ rank, players: [entry] }));
    }
    const updates = new Map(rateMatch(mode, groups).map(({ playerId, after }) => [playerId, after]));
    for (const entry of players) {
      const state = updates.get(entry.playerId);
      if (!state) throw new Error(`Simulation dropped player ${entry.playerId}`);
      entry.state = state;
      if (entry.firstNonProvisionalMatch === null && !isProvisional(state)) {
        entry.firstNonProvisionalMatch = match;
      }
    }
    if ([1, 10, 30, 100, 500].includes(match)) {
      checkpoints.push({
        matchesPerPlayer: match,
        provisionalPlayers: players.filter(({ state }) => isProvisional(state)).length,
        sigmaRange: [
          Math.min(...players.map(({ state }) => state.sigma)),
          Math.max(...players.map(({ state }) => state.sigma)),
        ].map((value) => Number(value.toFixed(3))),
        ratings: players.map(({ state }) => displayRating(state)),
      });
    }
  }
  return {
    mode,
    players: count,
    skillGap,
    firstNonProvisionalMatches: players.map((entry) => entry.firstNonProvisionalMatch),
    checkpoints,
  };
}

function fixedOpponent(mu: number, humanWins: boolean) {
  const bot = { ...initialRating(), mu, sigma: 2 };
  let human = initialRating();
  const checkpoints = [];
  for (let match = 1; match <= 500; match++) {
    const updates = rateWithFixedReferences("duel", [
      { rank: humanWins ? 0 : 1, players: [{ playerId: "human", state: human }] },
      { rank: humanWins ? 1 : 0, players: [{ playerId: "bot", state: bot, fixed: true }] },
    ]);
    human = updates[0].after;
    if ([1, 10, 30, 100, 500].includes(match))
      checkpoints.push({
        matches: match,
        mu: Number(human.mu.toFixed(3)),
        sigma: Number(human.sigma.toFixed(3)),
        rating: displayRating(human),
      });
  }
  return { syntheticBotMu: mu, syntheticBotSigma: 2, humanWins, fixedBotAfter: bot, checkpoints };
}

console.log(
  JSON.stringify(
    {
      policy: RATING_POLICY,
      seed: 927,
      note: "Synthetic numerical checks only; fixed bot strengths are illustrative, not human-pilot calibrations and never installed. Human scenarios use Gaussian performance noise and no draws.",
      scenarios: [
        simulate("duel", 2, false),
        simulate("duel", 2, true),
        simulate("ffa", 10, true),
        simulate("snd", 10, true),
      ],
      fixedOpponents: [fixedOpponent(10, true), fixedOpponent(35, true), fixedOpponent(10, false)],
    },
    null,
    2,
  ),
);
