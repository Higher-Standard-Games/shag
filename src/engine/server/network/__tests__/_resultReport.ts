import { normalizeTeamId } from "../../../../shared/server/gametype";
import type { AdmissionManifest } from "../MatchAdmission";
import type { MatchResultReport, ResultTeam } from "../MatchResultReport";

/** Complete V2 fixtures; ranks are explicit win/loss values, not production calculations. */
export function resultReport(
  report: Omit<MatchResultReport, "details">,
  admission: AdmissionManifest,
): MatchResultReport {
  const ffa = report.gametype === "ffa";
  const seats = report.participants.map((player) => {
    const grant = admission.grants.find((grant) => grant.tokenHash === player.tokenHash)!;
    const team: ResultTeam = ffa ? "ffa" : (normalizeTeamId(grant.team) as ResultTeam);
    return {
      seatId: grant.seatId ?? grant.tokenHash,
      tokenHash: player.tokenHash,
      team,
      teamsPlayed: [team],
      joinedAtTick: 0,
      leftAtTick: null,
      disconnected: false,
      forfeited: false,
      lateJoin: false,
      participationInterrupted: false,
      ...(grant.botReference === undefined ? {} : { botReference: grant.botReference }),
      placement: player.outcome === "loss" ? 2 : 1,
    };
  });
  return {
    ...report,
    details: {
      version: 2,
      startedAt: report.endedAt,
      startedAtTick: 0,
      endedAtTick: 1,
      completion: "normal",
      seats,
      teams: ffa
        ? []
        : (["udon", "soba"] as const).map((id) => {
            const index = seats.findIndex((seat) => seat.team === id);
            return { id, score: report.participants[index].score, placement: seats[index].placement };
          }),
    },
  };
}
