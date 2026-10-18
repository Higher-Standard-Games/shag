# Release bot movement training

## S&D1: release_snd1, 2026-10-18

Source: `public/data/demos/training/washoi_snd1_release_snd1.shagdemo`
(910,937 bytes; recording ignored by Git).
SHA256: `0b00693bb5a5685824f56073b4b23378f17963a5bdc6c12a8d9794fa2edab51b`.

Command: `npm run bot:learn -- washoi_snd1_release_snd1`.

- 34 candidates; 28 accepted and saved, six rejected. No previous S&D1 library.
- 25 jump routes and three wall-jump routes.
- 20 routes passed five starting positions; eight passed four of five.
- A separate replay of all 28 saved scripts matched command counts and landed
  within four units of the stored endpoints.

Changed data: `config/bot-routes/washoi_snd1.json`.
Verification: `npx vite-node .cache/verify-release-snd1.ts`.
Logs: `.cache/snd1-training.log`, `.cache/snd1-verify.log`.

Assumption: the installed Jal BSP under `washoi_snd1` is the release geometry.
The recording teaches movement segments, not team tactics or patrol behavior.
Site patrolling was implemented separately in the rule-based brain. Restart
the bot service to load the new library. Running user services were left alone.
Live route choice and successful retakes/defuses remain unverified.

## DM11: release_dm11, 2026-10-18

Source: `public/data/demos/training/washoi_dm11_release_dm11.shagdemo`
(1,333,380 bytes; recording ignored by Git).
SHA256: `d2b1c7012a5eb26533d08b3986f8ea87a64ad23542a5241825bada1eb2cdad5c`.

Command: `npm run bot:learn -- washoi_dm11_release_dm11`.

- 67 candidate tricks; 53 passed replay and robustness verification.
- 14 rejected: 13 could not be reproduced reliably from a standstill;
  one missed during replay alignment.
- Duplicate merging retained 47 distinct routes: 10 wall-jump routes and
  37 other jump routes. No existing `washoi_dm11.json` library was present.
- 30 retained routes passed all five starting positions; 17 passed four of five.
- A separate replay of all 47 saved scripts passed: decoded command counts
  matched stored tick counts and endpoints were within four units.

Changed route data: `config/bot-routes/washoi_dm11.json`.
Verification command: `npx vite-node .cache/verify-release-dm11.ts`.
Logs: `.cache/release-dm11-learn.log`, `.cache/release-dm11-verify.log`.

Assumption: the installed `washoi_dm11` BSP is the target release geometry.
Live route selection and match performance remain unverified. Start a fresh bot
session to load the new library; running user servers were not restarted.

## DM5: release_dm5, 2026-10-18

Source: `public/data/demos/training/washoi_dm5_release_dm5.shagdemo`
(1,416,704 bytes; recording ignored by Git).
SHA256: `a2b5c7769ed5669701389ffeda534b3d20790c9ec05835fc5eaa15b6eed7d121`.

Command: `npm run bot:learn -- washoi_dm5_release_dm5`.

- 70 candidate tricks; 56 passed replay and robustness verification.
- 14 rejected: 13 could not be reproduced reliably from a standstill;
  one missed during replay alignment.
- Duplicate merging retained 46 distinct routes: 11 wall-jump routes and
  35 other jump routes. No existing `washoi_dm5.json` library was present.
- 30 retained routes passed all five starting positions; 16 passed four of five.
- A separate replay of all 46 saved scripts passed: decoded command counts
  matched stored tick counts and endpoints were within four units.

Changed route data: `config/bot-routes/washoi_dm5.json`.
Verification command: `npx vite-node .cache/verify-release-dm5.ts`.
Logs: `.cache/release-dm5-learn.log`, `.cache/release-dm5-verify.log`.

Assumption: the installed `washoi_dm5` BSP is the target release geometry.
Live route selection and match performance remain unverified. Start a fresh bot
session to load the new library; running user servers were not restarted.

## DM2: release_dm2, 2026-10-18

Source: `public/data/demos/training/washoi_dm2_release_dm2.shagdemo`
(1,605,917 bytes; recordings are ignored by Git).

Command: `npm run bot:learn -- washoi_dm2_release_dm2`.

- 77 candidate tricks; 55 passed replay and robustness verification.
- 22 rejected: 20 could not be reproduced reliably from a standstill;
  2 missed during command alignment.
- After duplicate merging: 77 saved routes, up from 37.
- 44 retained routes come from this recording: 14 wall-jump routes and
  30 other jump routes. Some replace existing entries; this is not 44 net additions.
- Each accepted attempt landed from at least four of five tested starting
  positions, including the original start and offsets of eight units.

Changed route data: `config/bot-routes/washoi_dm2.json`.
The existing route library was merged, not replaced wholesale.

An additional scratch verification decoded and replayed all 44 retained scripts
from the saved JSON against the installed map. All reproduced their stored
endpoints within four units and had the expected tick counts.
Commands: `npx vite-node .cache/verify-release-dm2.ts` (44 passed).
Training output: `.cache/release-dm2-learn.log`.

Assumption: the installed `washoi_dm2` BSP is the target release geometry.
These checks validate the movement scripts; route selection and performance
during live bot matches remain unverified. Start a fresh bot session to load
the updated route library.

Training-demo filenames are claimed with an exclusive filesystem write.
Repeating the recording name saves a numbered file instead of overwriting it.
