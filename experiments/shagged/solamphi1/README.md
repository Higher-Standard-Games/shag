# Sol Amphi 1: Relay Yard

An MCP-authored Amphi arena experiment using wfdm5's industrial material vocabulary: concrete, brick, metal decks, neon, graffiti and packaged Warfork props. The refined fighting footprint is 1680 x 1680 Quake units inside a 1728-unit structural envelope. The surrounding city is scenery, outside the player boundary.

The arena has four recessed slime basins with escape steps, dry lower circulation paths, two crossing reactor underpasses, four stair routes, upper galleries and cardinal bridges. The upper deck is 192 units above the lower floor. An offset maintenance deck, loading deck and cover break some of the long sightlines. Four spawns and armor/health targets provide the test layout; Amphi's existing weapon-kit rules are unchanged.

The first prototype matched wamphi1's outer bounds, not its usable layout. Its outer spawn diagonal was about 22% larger. The refinement uniformly scales that prototype by 0.75; matching the movement feel still needs human comparison.

## Play and edit

The local build is published under `public/data/`. In the normal game session:

```text
developer 1
map solamphi1 amphi
```

`solamphi1.json` is the canonical editor snapshot. The live agent copy is `server-data/shagged/agent/solamphi1.json`. Compiled revisions also appear in SHAGGED's Server Open browser. Packaged BSPs and the compile-time prop archive are local media, excluded from Git.

To compile the tracked snapshot directly:

```text
npm run shagged -- compile experiments/shagged/solamphi1/solamphi1.json --quality default
npm run shagged -- report experiments/shagged/solamphi1/solamphi1.json --quality default
```

Supply the same quality when compiling and reporting to reuse the reviewed build.

## Reproduce the authoring experiment

Run from the repository root with the game's media installed. Prepare the selected unmodified source models from the local Warfork map checkout:

```text
node experiments/shagged/solamphi1/package-props.mjs C:/Users/sundf/Desktop/warfork-maps
node experiments/shagged/solamphi1/prepare-lettering.mjs
npm run tools:manifest
```

The source checkout supplies barrel/crate assets, electrical boxes, cables and original ASE lamps, windows, architectural supports and service props at their original paths. The lettering preparation bakes the installed Droid Sans Bold font using MakeBSP. Keep both `solamphi1_compile_props.pk3` and `solamphi1_lettering.pk3` in the local media folder. The normal Warfork packages supply shared shaders and textures. Original media and font licensing remains applicable.

For a fresh map ID only, run these stages in order:

```text
node experiments/shagged/solamphi1/build.mjs greybox
node experiments/shagged/solamphi1/build.mjs detail
node experiments/shagged/solamphi1/build.mjs polish
node experiments/shagged/solamphi1/build.mjs finish
node experiments/shagged/solamphi1/build.mjs machinery
node experiments/shagged/solamphi1/build.mjs city
node experiments/shagged/solamphi1/refine.mjs asset-probe
node experiments/shagged/solamphi1/refine.mjs compact
node experiments/shagged/solamphi1/refine.mjs basins
node experiments/shagged/solamphi1/refine.mjs architecture
node experiments/shagged/solamphi1/refine.mjs dressing
node experiments/shagged/solamphi1/refine.mjs atmosphere
node experiments/shagged/solamphi1/refine.mjs optimize
node experiments/shagged/solamphi1/refine.mjs lighting
node experiments/shagged/solamphi1/refine.mjs hero
node experiments/shagged/solamphi1/refine.mjs reactor-finish
```

The script refuses to replace an existing map at creation. Later stages also refuse duplicate IDs. Do not rerun them over an existing authored document. The `access` stage is a historical repair for the initial railing revision and is not part of a fresh reproduction.

Each stage connects to the real stdio MCP server and applies a validated transaction. It records its operations and saves an editor snapshot, then checks health and compiles. No direct document injection is used for authoring.

For the final normal-quality compile and movement report in PowerShell:

```powershell
$env:SOLAMPHI_QUALITY = 'default'
node experiments/shagged/solamphi1/refine.mjs report
npx tsx experiments/shagged/solamphi1/verify.ts
```

Run authoring stages sequentially because each depends on the previous document revision. The compiler now coordinates native jobs sharing a media root across local MCP/server processes. Fast compilation deliberately disables compiler chamfering; review the final look using default quality. Reuse fingerprints compiler, profiles, recipe and media as well as source. Use the scripting CLI's `compile ... --force` or MCP `force: true` for an explicit rebuild.

For GPU screenshots, start the private browser-probe Vite server on port 3100, then run `node experiments/shagged/solamphi1/review.mjs`. It writes four views and a browser report under `.cache/` using the repository's headless Edge helper.

## Validation and limits

The checked-in `refinement/report-report.json` and validation notes describe the reviewed revision. `verify.ts` additionally checks actual slime contents, dry paths, escape-step heights, standing-player underpass clearance, solid detail collision and baked lettering. Player reachability and bot navigation must pass again after each layout or collision-affecting detail change. Browser review uses headless Edge with WebGL2 on the real GPU; it is a rendering smoke check, not an Amphi balance test or a collision performance benchmark.

The design still needs human movement and combat feedback, especially spawn exposure, cover and the upper armor route. The reference's diagonal bridges and octagonal platform remain future geometry work; this version uses axis-aligned gameplay brushes and curved decorative patches.

Tool findings and implementation checkpoints are recorded in [the SHAGGED research log](../../../docs/research/SHAGGED_NEEEDED_FEATURES.md).
