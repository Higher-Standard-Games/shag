# SHAGGER, the Rust counterpart

[SHAGGER](https://github.com/Higher-Standard-Games/shagger) is SHAG in Rust,
for native desktop clients. It is a library:
[wash-fps-rust](https://github.com/Higher-Standard-Games/wash-fps-rust), the
native Washiki Washoi client, is built on it, as the browser game
(`src/games/fps`) is built on SHAG. It reads the same packages, speaks the same
wire protocol, plays the same demos and runs the same shared simulation, bit
for bit where the simulation and the wire format are concerned, so the native
client joins the same lobby and game servers as the browser client and plays
in the same matches. Both repositories are MIT licensed and separate from this
one.

## Its manual

SHAGGER has its own manual, at [shagger.shag.dev](https://shagger.shag.dev/).
It does not repeat this one: each of its guides links to
the SHAG page for the behaviour it ports, and covers only what is particular to
Rust: the crates and their API, building and testing, the native backends
(wgpu, winit, cpal, egui, gilrs, rapier), JavaScript number semantics, golden
vectors, and where the port differs from the TypeScript and why. When the two
disagree, the TypeScript is right unless SHAGGER's guide calls the difference
deliberate.

## What it ports

The client side of the engine: the wire protocol and game state, collision
and the shared simulation's inputs, demos and highlight reels, the game server
connection and lobby client, packages, maps, shaders, textures and models, the
renderer, audio, input, console and cvars, menus and HUD, camera and view
effects, and ragdolls. The game server, the lobby server, the bot server,
SHAGGED, the CLI and headless tools, and the Electron and Capacitor shells stay
in TypeScript only. Its introduction has the table, folder by folder.

| SHAGGER crate | SHAG counterpart |
| --- | --- |
| `shagger_shared` | `src/shared`: no GPU, no window, no async |
| `shagger` | `src/engine` (without the editor and the server), and the `src/lobby` client |

Folder names follow SHAG's, so a SHAG file has an obvious Rust home:
`src/engine/loader/pk3/PK3PublishedIndex.ts` is
`crates/shagger/src/loader/pk3/published_index.rs`.

## What a SHAG change owes it

- **Deterministic code and the wire format.** SHAGGER's tests reproduce
  results computed by SHAG's own TypeScript (and by V8), checked in as golden
  vectors generated from a SHAG checkout; each file names the SHAG commit it
  came from. A change here to `src/shared` simulation, collision or demo code,
  or to snapshots, messages or the demo format, means the vectors are
  regenerated and the Rust brought level. Say so in the pull request; the
  [protocol change checklist](https://github.com/Higher-Standard-Games/shag/blob/main/.claude/skills/protocol-change/SKILL.md)
  lists what a wire-format change touches.
- **This manual's paths.** SHAGGER's guides link to pages here by their
  GitHub paths. Renaming or moving a page in `docs/manual/guides/` breaks
  those links; update them there in the same change.
- **Browser-only code** (rendering details, the editor, DOM UI) has no parity
  requirement: the native client has its own renderer and UI.

Porting reads the TypeScript line by line, which makes it a review of its own:
bugs found that way come back to SHAG as ordinary pull requests.
