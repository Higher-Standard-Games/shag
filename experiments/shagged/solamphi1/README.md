# Sol Amphi 1: Relay Yard

An MCP-authored Amphi arena experiment using wfdm5's industrial material vocabulary: concrete, brick, metal decks, neon, graffiti and packaged Warfork props. The fighting footprint is 2240 x 2240 Quake units inside a 2304-unit structural envelope, based on the outer horizontal size of `wamphi1`. The surrounding city is scenery, outside the player boundary.

The arena has a lower circulation loop, four stair routes, upper galleries and cardinal bridges around a reactor. An offset maintenance deck, a loading deck and cover break some of the long sightlines. Four spawns and armor/health targets provide the initial test layout; Amphi's existing weapon-kit rules are unchanged.

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
```

The source checkout supplies the industrial barrel/crate assets, electrical boxes and cables at their original paths. Dependencies and material images are included in the local compile archive. The normal Warfork media packages supply shared shaders and textures. This experiment does not assign a new license to those assets.

For a fresh map ID only, run these stages in order:

```text
node experiments/shagged/solamphi1/build.mjs greybox
node experiments/shagged/solamphi1/build.mjs detail
node experiments/shagged/solamphi1/build.mjs polish
node experiments/shagged/solamphi1/build.mjs finish
node experiments/shagged/solamphi1/build.mjs machinery
node experiments/shagged/solamphi1/build.mjs city
```

The script refuses to replace an existing map at creation. Later stages also refuse duplicate IDs. Do not rerun them over an existing authored document. The `access` stage is a historical repair for the initial railing revision and is not part of a fresh reproduction.

Each stage connects to the real stdio MCP server and applies a validated transaction. It records its operations and saves an editor snapshot, then checks health and compiles. No direct document injection is used for authoring.

For the final normal-quality compile and movement report in PowerShell:

```powershell
$env:SOLAMPHI_QUALITY = 'default'
node experiments/shagged/solamphi1/build.mjs report
```

Fast compilation deliberately disables compiler chamfering. Review the final look using default quality. A changed compiler/profile/media set needs a fresh build: the existing reuse cache only identifies source bytes and quality.

## Validation and limits

The checked-in report and validation notes describe the exact reviewed revision. Player reachability and bot navigation must pass again after each layout or collision-affecting detail change. Browser review uses headless Edge with WebGL2 on the real GPU; it is a rendering smoke check, not an Amphi balance test or a collision performance benchmark.

The design still needs human movement and combat feedback, especially spawn exposure, cover and the upper armor route. The reference's diagonal bridges and octagonal platform remain future geometry work; this version uses axis-aligned gameplay brushes and curved decorative patches.

Tool findings and implementation checkpoints are recorded in [the SHAGGED research log](../../../docs/research/SHAGGED_NEEEDED_FEATURES.md).
