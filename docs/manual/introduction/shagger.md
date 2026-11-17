# SHAGGER, the Rust counterpart

[SHAGGER](https://github.com/Higher-Standard-Games/shagger) is the Rust
counterpart of SHAG. It ports SHAG's features to Rust, and
[wash-fps-rust](https://github.com/Higher-Standard-Games/wash-fps-rust), the
native Washiki Washoi client, is built on it, as the browser game
(`src/games/fps`) is built on SHAG. Both repositories are MIT licensed and
separate from this one.

## How it maps onto SHAG

| SHAGGER crate | SHAG counterpart | Rule |
| --- | --- | --- |
| `shagger_shared` | `src/shared` | No GPU, no window, no async |
| `shagger` | `src/engine` (without the editor and the server), and the `src/lobby` client | Depends on `shagger_shared` only |

Folder names follow SHAG's, so a SHAG file has an obvious Rust home:
`src/engine/loader/pk3/PK3PublishedIndex.ts` is
`crates/shagger/src/loader/pk3/published_index.rs`. The Rust follows the
TypeScript as directly as Rust allows, and says in a comment where and why it
differs.

## Parity with SHAG

The Rust has to give the same results as SHAG, bit for bit where the
simulation and the wire format are concerned: the native client predicts
movement against the same servers, reads the same snapshots and plays the same
demos as the browser client. Results computed by SHAG's own code (and by V8,
for its `Math.sin` and `Math.cos`) are checked into SHAGGER as golden vectors,
generated from a SHAG checkout:

```sh
node tools/golden/generate.mjs ../shag    # in SHAGGER, beside a SHAG checkout
cargo test
```

Each golden file names the SHAG commit it was made from.

## What this means for SHAG changes

Some SHAG changes are also SHAGGER changes:

- **Deterministic code** in `src/shared` (movement, collision, simulation)
  and **the wire format** (snapshots, messages, the demo format) must stay
  in step: when they change here, SHAGGER's golden vectors are regenerated
  against the new commit and the Rust is brought level with them. The
  [protocol change checklist](https://github.com/Higher-Standard-Games/shag/blob/main/.claude/skills/protocol-change/SKILL.md)
  lists every place a wire-format change touches.
- **Engine-only browser code** (rendering, the editor, DOM UI) has no
  parity requirement; the native client draws with its own renderer.
- A bug found in one implementation is often in the other. Porting reads
  the TypeScript line by line, which is a review of its own: fixes found
  that way come back to SHAG as ordinary pull requests.

## Licences

SHAGGER is MIT, except for code ported or copied from Babylon.js, which lives
only in `crates/shagger/src/babylon/` under the Apache License 2.0, and V8's
`Math.sin` and `Math.cos`, ported from fdlibm under its own permissive notice.
SHAGGER's CI checks the licences of its dependencies (`cargo deny check`).
