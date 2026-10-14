---
name: ranking-change
description: Safely change SHAG's results and ratings - the ranking schema in players.db, TrueSkill policy, rating groups and eligibility, bot preset accounts, stats, or the leaderboard queries - including schema upgrades that re-rate stored results. Use this before editing src/lobby/RatingStore.ts, MatchResultStore.ts, PlayerStatsStore.ts, BotAccountStore.ts, src/shared/ranking/*, or anything that changes who is rated, how, or what the boards show, and whenever the user reports a wrong rank, a missing player on the leaderboard, or wants ratings recomputed.
---

# Changing results and ratings

`players.db` holds real people's records and ratings. A ranking change that is
wrong in code can be fixed by the next commit; one that rewrites the database
wrongly cannot, because the lobby upgrades the store the moment it opens it. So
every change here is tested on a copy of real data before it meets the real
thing.

## How the store is put together

- **Accounts** live in `PlayerStore` with their own `user_version`.
- **The ranking journal** (`src/lobby/RatingStore.ts`) has its own
  `SCHEMA_VERSION` in the `ranking_schema` table. Opening an older supported
  version upgrades it in place; an unknown or partial schema fails rather than
  resetting. Coming from below 3, the upgrade re-rates every stored result in
  sequence order (`rerate()`), because the bot preset accounts changed who is
  rated.
- **Each result is stored as a normalized snapshot.** Ratings are derived from
  those snapshots, so they can always be replayed; the snapshots themselves are
  never rewritten.
- **The numerical policy** is `RATING_POLICY` in `src/shared/ranking/RatingPolicy.ts`,
  versioned (`shag-trueskill-v1`). Rating states carry the policy version; a
  state from another policy is refused.
- **Who is rated** is decided by `MatchRatingGroups.ts` and
  `BotMatchRatingGroups.ts` in `src/shared/ranking/`; exclusions carry a stored
  reason (`bot_custom`, `bot_reference_changed`, …).
- `docs/manual/guides/lobby-server.md` (Results and ranking) describes the rules
  as players see them; keep it in step.

## Decide what kind of change it is

| Change | What it needs |
| --- | --- |
| Display only (board layout, labels, rail) | Normal tests; no schema change |
| New query or column read from existing data | Tests on a copy of real data |
| New table or column | Bump `SCHEMA_VERSION`, an additive upgrade from every supported older version, tests on a copy |
| Who is rated, or how (groups, eligibility, bots) | Bump `SCHEMA_VERSION` and re-rate on upgrade, so stored history follows the new rule |
| Any number in the rating maths | A **new policy version**, not an edit to `shag-trueskill-v1`, and a separate replay |

When bumping `SCHEMA_VERSION`, extend the list of versions the store accepts as
upgradable, and update the tests that assert the version
(`src/lobby/__tests__/RatingStore.test.ts`,
`src/lobby/__tests__/PlayerStatsStore.test.ts`; search `ranking_schema` for
others).

## Test on a copy of the real data

Never point a changed build at the real data directory first.

1. Copy it: `cp -r server-data /tmp/ranking-check` (or a scratch directory in
   the session's temp space). Copy the whole directory: SQLite's `-wal` and
   `-shm` files hold recent commits.
2. Inspect before: `npm run lobby:server -- --ratings-info --data-dir <copy>`.
3. Open the copy with the changed code, which runs the upgrade, then verify:
   `npm run lobby:server -- --ratings-verify --data-dir <copy>`. It replays
   every applied result and must report no divergence.
4. Check the outcome the change is for: the boards (`--results-info`, or the
   leaderboard against the copy through the `local-stack` skill), and the
   specific accounts the user asked about.
5. Compare before and after counts. An upgrade should change ratings, not
   lose results or accounts.

## Also run

```bash
npm run test:run
npm run ranking:simulate     # policy sanity on synthetic matches
npm run ranking:acceptance   # real lobby and game-server result handoffs
```

## Report

Say whether the schema or policy version changed, what the upgrade does to
stored data, and the before/after from the copy: `--ratings-verify` result,
counts, and the ranks of any accounts in question. Remind the user that the
first lobby start with the new code upgrades their real `players.db`, and
suggest backing up the data directory before deploying.
