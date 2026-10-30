---
name: protocol-change
description: Checklist for changing what SHAG sends over the network or records in demos - snapshot fields, entity flags, message types, the movement byte, event payloads, or the .shagdemo format and its version. Use this before adding or changing any field in src/shared/net/BinaryProtocol.ts, MessageCodec, SnapshotBuilder, snapshot events, DemoRecorder or DemoReader, whenever a feature needs "extra data in snapshots" or "in demos", and when a test fails on a golden snapshot or a demo version number.
---

# Changing the wire or demo format

One field added to a snapshot touches the encoder, the decoder, the server that
fills it, the client buffers that carry it, the demo format that records it,
tests in three places and two guides. Miss one and the failure is quiet: an old
demo stops playing, a client misreads a byte, or a golden test is "fixed" by
regenerating it without anyone noticing what changed.

Snapshots are also the demo format: a demo records the encoded snapshot stream,
so a snapshot change is a demo change.

## Design first

- **Stay readable backwards.** Demos recorded by older builds must still play.
  Put new data behind a flag or a spare bit that old recordings never set, so
  the decoder knows whether the bytes are there. The movement byte's bit 7,
  which marks four optional view bytes, is the pattern to follow.
- **Make new fields optional** in the TypeScript shapes (`field?: T`), and let
  every consumer handle `undefined` from an old recording rather than defaulting
  it to a value that looks real.
- **Size it.** Snapshots go out 60 times a second per client. Quantize: phases
  as `uint8` (0–255 for 0–1), small offsets as `int8` in fixed units, keys as
  bit fields.
- **Server truth only.** Derive the value on the server from authoritative state
  (`src/games/fps/server/`), never from what a client claims.

## Touchpoints

Work through all of them; search for a neighbouring field to find each spot.

**Encoding**
- `src/shared/net/BinaryProtocol.ts`: the shape interfaces, the flag or bit, the
  encoder and the decoder, and the format comment at the top of the snapshot
  section.
- For a new message type: the `MessageType` enum in `BinaryProtocol.ts`
  and `src/engine/network/protocol/MessageCodec.ts`.

**Server**
- The system that computes the value (for movement,
  `src/games/fps/server/systems/FPSMovementSubsystem.ts`) and the component it
  lands in (`src/shared/server/simulation/components/`, including its clone
  function).
- `src/games/fps/server/SnapshotBuilder.ts`, which copies components into the
  snapshot.

**Client**
- `src/engine/network/client/SnapshotBuffer.ts`: the field on both
  `EntitySnapshot` and `InterpolatedEntity`, `copyEntity`, extrapolation (hold
  the last value) and interpolation (`lerpOptional` for continuous values; step
  discrete ones such as keys).
- `src/games/fps/client/RemotePlayerLogic.ts` (reading the component) and, for
  demos, `src/games/fps/client/DemoEntityTimeline.ts`.

**Demo format**, when recordings change
- `DEMO_VERSION` in `src/games/fps/server/DemoRecorder.ts`: bump it.
- `src/shared/demo/DemoReader.ts`: widen the accepted range
  (`version < 1 || version > N`) and update the comment on what the new version
  adds. Older builds then refuse the new file cleanly instead of misreading it.
- Tests that assert the version: `src/games/fps/server/__tests__/DemoRecorder.test.ts`,
  `src/games/fps/bot/__tests__/DemoPipelineEndToEnd.test.ts`,
  `src/games/fps/server/__tests__/lobby/RoomToRanking.test.ts`. Search for the old number
  (`version).toBe(`, `version: `) to catch any new ones.

**Tests**
- A round-trip test for the new field, and a test that a recording made before
  it (the flag unset) still decodes, with the field `undefined`. See
  `src/engine/__tests__/WatchedViewWire.test.ts`.
- `src/games/fps/server/__tests__/SnapshotGolden.test.ts` holds an inline
  snapshot of the encoded output. Update it only after reading the diff and
  confirming every changed byte is the one you intended.
- A test of the server-side derivation of the value.

**Docs** (edit these directly; load `docs-edit` only to add a new page)
- `docs/manual/guides/networking.md`: the snapshot format and message tables.
- `docs/manual/guides/lobby-server.md` (Demo privacy) and
  `docs/manual/guides/headless-mode.md` (Demos) state the current demo version
  and what the reader accepts.
- The living changelog.
- Run `npm run docs:build`; it fails on a dead link.

## Verify

Run only the steps that apply. The old-recording decode test under **Tests**
is the backwards-compatibility check; don't repeat it by hand.

1. Always: the gates and the regression set from the `regression-check` skill.
2. Only if `DEMO_VERSION` changed, or you edited demo playback
   (`SnapshotBuffer.ts`, `DemoEntityTimeline.ts`, `DemoReader.ts`): record a
   fresh demo with
   `npm --prefix src/games/fps run demo:record -- --map washoi_dm2 --bots 2 --seconds 30`,
   then play it and one **older** recording with the `browser-probe` demo
   probe. Both must play, and the old one plays without the new detail.
3. Only for a new message type, or data that is sent live but not recorded:
   spectate a bot over a real server connection and confirm the field arrives.

Report the new format version if there is one, which steps you ran or skipped
and why, and the regression results.
