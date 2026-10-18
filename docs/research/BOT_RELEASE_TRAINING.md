# Release bot movement training

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
