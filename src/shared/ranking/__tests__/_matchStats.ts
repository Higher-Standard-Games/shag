import type { MatchStats } from "../MatchStats";
export function matchStats(): MatchStats {
  return {
    version: 1,
    score: 250,
    frags: 4,
    teamFrags: 1,
    deaths: 2,
    damageGiven: 1234.5,
    teamDamageGiven: 20,
    plants: 1,
    defuses: 2,
    activeTimeMs: 10000,
  };
}
