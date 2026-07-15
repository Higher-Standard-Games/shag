# Stat / Account Server Brainstorm

**Status:** deferred brainstorm; no implementation scheduled
**Agreed:** 2026-07-14

## 1. Summary

If SHAG eventually needs accounts, persistent profiles, match history, ratings,
leaderboards, or moderation data, keep those concerns behind a completely
separate network service.

The game, lobby, and dedicated match servers should not know which database is
used and should never receive database credentials. They communicate with a
versioned HTTP API using explicit identity, match-assignment, and completed-match
contracts.

This preserves the important property that SHAG remains easy to run:

- Local, offline, and community-hosted play requires no account service or
  database.
- A lightweight/self-hosted stat service can use SQLite.
- An official hosted service can use PostgreSQL when its operational benefits
  justify the additional setup.
- Changing storage engines does not require changes to the game protocol.

The service boundary is the useful architectural decision. Choosing SQLite or
PostgreSQL is an internal deployment decision that can be deferred.

## 2. Current Codebase Context

- `src/lobby/LobbyServer.ts` currently treats a client-supplied display name as
  authentication. This is suitable for development but is not a persistent
  identity system.
- `src/lobby/GameServerSpawner.ts` launches per-match dedicated servers as child
  processes.
- `src/shared/server/gametype/GametypeTypes.ts` already exposes an authoritative
  post-game winner.
- `src/games/fps/server/Telemetry.ts` derives per-client connection and input
  metrics without affecting deterministic simulation.
- `.shagdemo` files already preserve high-volume authoritative replay/event data
  and should remain files rather than database blobs.

The authoritative simulation runs at 125 Hz. Persistence must never be placed
inside, or awaited by, that tick loop.

## 3. Proposed Boundary

```text
                            SHAG backend service
                          +-------------------------+
Client ---- auth/profile ->| HTTP API                |
Lobby ---- assignments --->|                         |---> SQLite or PostgreSQL
Game server ---- results ->| Identity + persistence |
                          | Ratings + leaderboards  |
                          +-------------------------+

Client <--------- gameplay WebSocket ---------> dedicated game server
```

### Game and lobby responsibilities

- Authoritative simulation and live match state
- Live lobby presence and orchestration
- Matchmaking flow
- Validating short-lived join tickets
- Producing a versioned `CompletedMatch` result
- Retrying/spooling results while the backend is unavailable
- Supporting guest/offline play with no backend

### Backend responsibilities

- Accounts and external identities
- Sessions and revocation
- Persistent player profiles
- Match assignments and join tickets
- Match history and aggregate statistics
- Ratings and leaderboards
- Bans, mutes, reports, and moderation history
- Demo metadata and object/file locations
- Idempotent authoritative result ingestion

### Database responsibilities

The database is private to the backend service. Clients, lobbies, and dedicated
game servers never connect to it directly.

## 4. Storage Strategy

### SQLite mode

Use SQLite for local development, lightweight self-hosting, or an initial
single-instance backend. The backend service should be the sole database owner.

Suggested layout:

```text
data/
|- shag.sqlite
|- demos/
|  `- <match-id>.shagdemo
`- pending-results/
   `- <match-id>.json
```

Suggested SQLite settings:

```sql
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
PRAGMA busy_timeout = 5000;
PRAGMA synchronous = NORMAL;
```

Do not split authentication, profiles, matches, and statistics into separate
SQLite files merely to avoid locks. That makes transactions, joins, migrations,
and backups harder. Avoid lock contention by having one owning service and
short, serialized write transactions.

Splitting by lifecycle is useful: relational state belongs in the database,
large demos remain files, and unsent match results live in a retry spool.

### PostgreSQL mode

Use PostgreSQL for an official hosted backend when the service needs concurrent
writers, multiple instances/hosts, operational replication, or high
availability. Its setup cost is isolated from normal game development and from
community server operators.

PostgreSQL is not required merely because accounts exist. Authentication can be
implemented correctly with either database.

### Storage abstraction

Keep database-specific work behind the service boundary, for example:

```ts
interface PersistenceStore {
  createUser(input: CreateUser): Promise<User>;
  getSession(tokenHash: string): Promise<Session | null>;
  saveCompletedMatch(result: CompletedMatch): Promise<void>;
  getLeaderboard(query: LeaderboardQuery): Promise<LeaderboardEntry[]>;
}
```

A future service may supply `SQLiteStore` and `PostgresStore`. Avoid pretending
that arbitrary SQL is automatically portable; keep dialect-specific migrations
and queries inside their adapters.

## 5. Runtime Modes

### Local/offline mode

- No backend or database is required.
- Players use temporary guest identities.
- Persistent profiles, ratings, and global history are unavailable.
- `npm run dev` and standalone `npm run net:server` remain simple.

### Optional self-hosted backend

- Start one additional backend process.
- It creates and migrates a local SQLite database automatically.
- A backend URL enables accounts/statistics for that deployment.

### Official hosted mode

- The backend is deployed and operated independently.
- It can use managed or self-hosted PostgreSQL.
- Game clients and servers only receive the backend base URL and appropriate
  API credentials/tickets.

## 6. Identity and Authentication

Keep these identifiers distinct:

- `user_id`: stable account UUID
- `provider` + `provider_subject`: external identity, such as an OIDC/platform
  account
- `display_name`: mutable public name
- `connection_id`: temporary lobby connection
- `player_id` / `entity_id`: temporary per-match simulation identity
- `match_id`: globally unique match identity

Possible authentication approaches include platform/OIDC identity,
passwordless login, or locally managed passwords. If passwords are supported,
use a modern password hash such as Argon2id and implement verification,
recovery, throttling, session expiry, and revocation. Do not store plaintext
credentials or raw bearer/session tokens.

Guest identity should remain a supported first-class mode, not an error state.

## 7. Match Join Flow

1. Client authenticates with the backend, or remains a guest for an unranked
   local/private match.
2. Lobby requests or records a match assignment.
3. Backend issues a short-lived signed join ticket containing at least:
   - `userId`
   - `matchId`
   - assigned server
   - team/slot, if relevant
   - expiry
   - unique nonce
4. Client presents the ticket to the dedicated game server.
5. Game server validates the signature locally using a public verification key.
6. Game server tracks used nonces for the life of the match.
7. The match continues without synchronous backend calls.

Local validation prevents a temporary backend outage from interrupting an
already assigned match.

## 8. Result Submission

Only registered dedicated game servers may submit authoritative results.
Clients must never submit ranked results.

The backend should know the expected server, roster, map, gametype, ranked flag,
and assignment expiry before accepting a result. A result is accepted at most
once per `match_id`.

A versioned `CompletedMatch` should contain, at minimum:

- Contract/build/rules version
- Match ID, map, gametype, and server identity
- Start/end timestamps and termination reason
- Ranked/unranked/private classification
- Winner, draw, placement, and team result
- Participant identity and display-name snapshot
- Score, kills, deaths, suicides, damage, and disconnect state
- Optional per-weapon shots, hits, damage, kills, and accuracy
- Demo location, format version, size, and checksum
- Optional summarized telemetry and integrity signals

Result ingestion and all related rating changes should be one database
transaction. Repeated submissions with the same `match_id` must return the
previous successful result rather than awarding statistics twice.

## 9. Failure Handling

The stat service may lose freshness, but it must not stall gameplay.

If the backend is unavailable:

- Active matches continue.
- Previously issued tickets remain locally verifiable until expiry.
- Completed results are atomically written to `pending-results/<match-id>.json`.
- Submission retries use backoff and idempotency.
- A spool entry is deleted only after backend acknowledgement.
- Profiles and leaderboards may show cached data or be temporarily unavailable.
- New authenticated/ranked assignments may be disabled.
- Guest, local, and private games remain available.

The backend must not be queried from the 125 Hz simulation tick.

## 10. Initial API Sketch

Regular versioned HTTP is sufficient initially:

```text
POST  /v1/auth/login
POST  /v1/auth/refresh
POST  /v1/auth/logout

GET   /v1/profile/me
PATCH /v1/profile/me
GET   /v1/players/:id

POST  /v1/matches/:id/join-ticket
POST  /v1/server/matches/:id/results

GET   /v1/matches/:id
GET   /v1/players/:id/matches
GET   /v1/leaderboards/:queue
```

The backend does not need WebSockets unless it later owns live presence or the
real-time matchmaking queue.

## 11. Candidate Persistent Data

### First useful slice

- Users, identities, profiles, and sessions
- Match metadata and authoritative outcome
- Match participants and summary statistics
- Per-weapon match summaries
- Demo metadata/checksum
- Per-mode rating and rating history

### Later, if useful

- Awards and achievements
- Per-map and per-mode personal bests
- Item control/pickup summaries
- Movement summaries such as distance, airtime, jumps, wall jumps, slides, and
  peak speed
- Queue time and matchmaking quality
- Latency, jitter, loss, reconnect, and disconnect summaries
- Reports, bans, mutes, trust signals, and review outcomes
- Anti-cheat evidence linked to the supporting demo

### Keep outside the relational database

- Every 125 Hz snapshot
- Every raw user command
- Whole `.shagdemo` blobs
- Videos, screenshots, and generated highlights
- Large training and navigation datasets

High-volume authoritative evidence belongs in demos/object storage. Store only
searchable metadata, checksums, and useful aggregates in the relational store.

## 12. Candidate Tables

```text
users
auth_identities
sessions
player_profiles

matches
match_players
match_player_weapons
match_awards
demos

ratings
rating_changes

moderation_actions
```

Useful invariants:

- Preserve the display name used during a match even if the profile changes.
- Allow guest participants with no persistent `user_id`.
- Make `match_id` globally unique and result ingestion idempotent.
- Store build/rules versions so statistics remain interpretable after balance
  changes.
- Use normal columns for frequent queries and JSON only for experimental or
  gametype-specific details.

## 13. Possible Future Adoption Path

No work is currently scheduled. If this becomes important later:

1. Define stable user, connection, player, server, and match identifiers.
2. Define versioned join-ticket, assignment, and `CompletedMatch` contracts.
3. Implement asynchronous result spooling and idempotent ingestion.
4. Add an optional standalone backend using SQLite.
5. Add real authentication and session validation.
6. Add match history, weapon summaries, ratings, and leaderboards.
7. Add moderation and summarized telemetry only when there is a concrete use.
8. Add PostgreSQL for the hosted deployment when measured operational needs
   justify it.

Do not introduce Redis, a message broker, or a columnar analytics database until
an observed workload requires one.

## 14. Migration Triggers

SQLite remains reasonable until one or more of these are real:

- Multiple backend instances must write concurrently.
- Backend instances and durable storage must live on separate hosts.
- The write queue becomes measurably delayed.
- High availability or automatic failover becomes necessary.
- Large analytical queries disrupt normal account/match operations.
- Operational requirements exceed reliable file-level backup and restore.

At that point the backend may migrate to PostgreSQL without changing the game,
lobby, or dedicated-server protocol.

## 15. Deferred Questions

- Should the backend live in this repository, a workspace package, or a separate
  repository?
- Which identity providers should be supported first?
- Does matchmaking remain in the lobby, or eventually move into the backend?
- How are community servers registered and authorized to submit results?
- Are community-server results globally ranked, separately ranked, or unranked?
- What are the demo retention, privacy, and deletion policies?
- How are server signing keys provisioned and rotated?
- Is SQLite support a permanent self-hosting feature or only a development mode?

These questions are intentionally deferred until persistent online services are
a higher project priority.
