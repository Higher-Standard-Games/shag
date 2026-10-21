/** Authoritative gameplay totals. Absence means unavailable, never zero. */
export interface MatchStats {
  version: 1;
  score: number;
  frags: number;
  teamFrags: number;
  deaths: number;
  damageGiven: number;
  teamDamageGiven: number;
  plants: number;
  defuses: number;
  activeTimeMs: number;
}
export const STAT_COUNTERS = ["frags", "teamFrags", "deaths", "plants", "defuses", "activeTimeMs"] as const;
export function canonicalMatchStats(value: MatchStats): MatchStats {
  if (
    value?.version !== 1 ||
    !Number.isSafeInteger(value.score) ||
    STAT_COUNTERS.some((key) => !Number.isSafeInteger(value[key]) || value[key] < 0) ||
    [value.damageGiven, value.teamDamageGiven].some((n) => !Number.isFinite(n) || n < 0 || n > Number.MAX_SAFE_INTEGER)
  )
    throw new Error("Invalid authoritative match stats");
  return {
    version: 1,
    score: value.score,
    frags: value.frags,
    teamFrags: value.teamFrags,
    deaths: value.deaths,
    damageGiven: value.damageGiven,
    teamDamageGiven: value.teamDamageGiven,
    plants: value.plants,
    defuses: value.defuses,
    activeTimeMs: value.activeTimeMs,
  };
}
