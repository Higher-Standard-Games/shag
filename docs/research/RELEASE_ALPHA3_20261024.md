# Alpha.3 release and regional rollout — 2026-10-24

The user authorized finalizing, pushing and deploying alpha.3 to US first and
then EU. They also explicitly authorized proceeding with EU's existing lobby
connection; no running match was present before its backend restart.

## Published revision pair

| Component | Revision |
| --- | --- |
| SHAG release commit | `33a3a11ff9a7dbe33502f0a5fafd53cf75a5f458` |
| Annotated release tag | `v1.0.0-alpha.3` |
| Washoi main/game pin | `76f361a724100d8c953a8522ffdf66ea84ac6ff6` |
| Deployment pair fingerprint | `b0780eb86ae1e5412b19c85e18826a0b5cbeea34` |

Washoi main was pushed before SHAG main/tag. SHAG main and the annotated tag
were pushed atomically. Both remotes were fetched first and accepted ordinary
fast-forward pushes. No history was rewritten. The tag resolves to the release
commit above.

Exact release files changed: `package.json`, `package-lock.json` (both root
version fields), `src/engine/version.txt`, `docs/changelog/index.md`,
`docs/changelog/v1.0.0-alpha.3.md` and the new alpha.4 changelog stub. Released
version files remain `1.0.0-alpha.3`; creating the stub did not start alpha.4
runtime development. This receipt is a subsequent documentation-only commit.

The validated rendering/application checkpoint is recorded under “Alpha.3 local
main preparation” in `ENGINE_GAME_SPLIT_PROGRESS.md`: all 723 test files passed,
5,648 tests passed and one skipped; build/typecheck/lint, simulation/physics,
determinism/fuzz, map/replay, runtime parity and bundled server probes passed.
Subsequent application changes were release metadata only; operator script
validation and the regional production checks are recorded below.

## US

Backed up the alpha.2 release selection, deploy state and built server artifacts
under `/srv/washoi/backups/alpha3-release-20261024`, and ran the online database
backup script. Media and original Git/operator backups already existed under
`backups/git-split-20261024-us`.

Paused deploy/activation timers, selected the exact released pair atomically,
and built with `/srv/washoi/deploy.sh`. The previous backend remained active
while the build ran. A fresh `npm ci` completed for the changed lockfile; the
game-owned server and production browser build commands passed. New client and
server artifacts were staged under `.pending/<pair fingerprint>/`.

`sudo -u washoi /srv/washoi/validate.sh` passed before activation. It ran:

- Game-owned `test:simulation`, `test:physics`, `server:tick` and
  `server:fuzz -- --ticks 1000`.
- `cli:game -- --exec "bsp load <map>; bsp info; quit"` for all five installed
  maps: washoi_dm2, washoi_dm5, washoi_dm11, washoi_amphi1 and washoi_snd1.
- A 91-tick crouch/jump replay.
- The staged `ServerRuntimeProbe.mjs` in a separate validation root, with
  scratch database/storage and media links excluding live demos. Its real
  lobby/room/owned-match/result flow passed and owned children shut down cleanly.

Full output: `/srv/washoi/logs/alpha3-headless-20261024.log`.

Exercised the actual systemd path with `systemctl start washoi-deploy.service`
and resumed `washoi-deploy.timer` / `washoi-activate.timer`. The activation
timer ran the existing idle/maintenance guard and activated the staged pair.
`pending.sha` and the maintenance flag were cleared; `game.sha` recorded the new
fingerprint. Final lobby/bot PIDs: 14603/14604, both active with zero automatic
restart attempts at the final check. US monitoring reported `ok`.

## EU

Prepared online player-database and prior-selection/deploy-state backups under
`/srv/washoi/backups/alpha3-release-20261024`; copied the previous static game
tree for rollback. Persistent-media/operator/Git backups remain under
`backups/git-split-20261024-eu`.

After confirming no match processes, paused deployment/monitor timers and
stopped bots/lobby for the authorized reconnect window. Selected the same exact
pair atomically and ran `/srv/washoi/deploy.sh game`. Fresh dependency
installation, server bundle build and game production build passed. Published
the client and started both services using the new bundles. A rollback trap
was prepared but was not needed. Restored the timers after service checks.

EU release log: `/srv/washoi/logs/alpha3-eu-release-20261024.log`.
Final lobby/bot PIDs: 260510/260512; both active with zero automatic restarts.

The resumed deploy timer automatically ran its normal `all` target. It built
and published the engine API/manual and game manual, then correctly skipped
the unchanged game and unrelated site/studio surfaces. The systemd unit
finished successfully. Log: `deploy-20261024T172124Z.log` under the regional
logs directory.

Post-deploy game-owned simulation/physics, deterministic tick, 1,000-tick fuzz
and all five installed-map BSP checks passed with scratch server data. Log:
`/srv/washoi/logs/alpha3-eu-headless-20261024.log`.

A pre-existing EU health check used `washoi.net/docs/` and `washoi.net/manual/`,
which returned HTTP 308. Verified the actual canonical origins `shag.dev/` and
`manual.washoi.net/` return HTTP 200, then updated only those two monitor URLs
with a backup at `alpha3-release-20261024/monitor.sh.previous` and a successful
`bash -n`. No proxy changes or manual notification-hook invocation was needed.

## Public verification and preserved state

On both origins (`us.washoi.net` and `eu.washoi.net`):

- Downloaded HTTPS `/` and compared it byte-for-byte to the published
  `releases/game/index.html`.
- Verified the published JavaScript contains `1.0.0-alpha.3`.
- A real secure WebSocket upgrade to `/lobby` passed, then the test socket
  closed without sending account/login messages. Ordinary HTTP `/lobby`
  correctly returned 426.
- The representative map `data/map_washoi_dm2.pk3` returned HTTP 200.
- Exact checkout/release-pair and active deployment fingerprints matched.
- `public/data` still resolves to `/srv/washoi/assets/data`; asset archives,
  live demos, account databases, secrets, TLS and environment configuration
  were retained. Normal builds regenerated the PK3 index in place.
- Both lobby/bot services and deployment timers remained active at the final
  check. EU live authentication also continued after the restart.

US timer-driven activation and EU timer-driven documentation publication were
observed, not just inferred from shell success. Release selection remains an
explicit operator action through `release-pair.json`; pushing a future main
commit alone intentionally does not select it for production.

## Commands, assumptions and limits

Local `npm.cmd run docs:build`, `git diff --check` and the pre-commit Biome gate
passed for release metadata. Production commands above used the installed
operator scripts; the driver files and public-artifact/WebSocket checks are
under local `.cache/production-split/`, invoked through
`.cache/engine-game-split/remote.mjs` over SSH. Regional build logs retain full
command output. No interactive browser/GPU match was played by this agent;
the real bundled match/result probe was isolated from live account storage.
No local submodule detachment was performed. Both production game repositories
already have independent Git metadata from the preceding operator migration.
