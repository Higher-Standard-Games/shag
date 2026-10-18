# DM2 teleporter effect

`teleglow_01.tga` is copied unchanged from `archive/data0_21.pk3`, path
`textures/baxandall/teleglow_01.tga`. SHA-256:
`35db5592db5eeb988c954ed4c5902fcc4490475514444465cc0369bffb3885b6`.

`teleglow_02.original.txt` preserves the effect definition from
`archive/data0_21pure.pk3`, `scripts/baxandall.shader`.
These are existing upstream assets; their original rights remain unchanged.

`dm2_portal.shader` preserves the two rotating, stretching, pulsing additive
layers and autosprite deformation. It uses an explicit TGA path, double-sided
rendering, and an alias under DM2's existing material name,
`textures/wsw_cave1/ball_glowb_portal`.
All four DM2 portal surfaces reference that material. No BSP recompile is needed.

After constructing the combined texture bank from upstream map media:

```sh
npm run tools:billboards
npm run tools:teleporter
npm run tools:manifest
npm run tools:textures
```

The packaging commands are independent patches and preserve each other's files.
`tools:teleporter -- --package <path>` selects a different combined texture bank.
It verifies CRCs, every file hash and unrelated shader definitions before replacing
the package, updates the per-map dependency ledgers, and includes asset provenance
in `media-manifests/washoi_teleporter.json`.
