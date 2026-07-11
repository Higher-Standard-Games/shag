# In-Game Chat — plan & work orders

Date: 2026-07-11
Status: planned (brainstorm round with user in progress)
Cycle: v0.9.18

## Requirements (user)

- Players can text-chat **in game** (the lobby chat is a separate, lobby-server
  feature and stays as is).
- **T** opens talk mode (input field), **Enter** sends, Esc cancels.
- A **dialog with history**, not just fading toasts.
- Chat **saves to demos** and shows during replay.

## What already exists (survey 2026-07-11)

| Piece | State |
| --- | --- |
| `client/hud/widgets/Chat.ts` (`FPSChat`) | Widget shell EXISTS: log + input, Enter/Esc handling, fade, `onSend`/`addMessage`/`openInput` API. Instantiated in `FPSHud` (`this._chat`) — but **zero wiring**: no T bind, no network, no styling pass. |
| Protocol | `MessageType` enum in `BinaryProtocol.ts` (client→server 0x81–0x88; **0x89 free**). `MessageCodec` encode/decode pairs + `ProtocolCodecs.test.ts` is the pattern. `ServerMessage (0x09)` exists but is transport-level info text — not the chat path. |
| Snapshot one-shot events | `SnapshotBuilder` pushes typed events; `BinaryProtocol.EVT_TYPE_MAP` codes 1–13 (**14 free**); `writeString` UTF-8 exists. Client consumes in `GameEvents`. |
| Demo recording | Post-D16, the snapshot is built ONCE and handed to broadcaster + recorder — **any snapshot event lands in demos automatically**. Playback: `DemoService` dispatches events by type (weapon_fire/death/…) — add a `chat` case. |
| Rate limiting | `AuthorityGuards.rateLimited(lastMs, nowMs, windowMs)` — used for respawn/team gates; reuse for chat. |
| Input capture | ⚠ `CameraInputHandler` keydown/keyup have **no input-element guard** — game keys (WASD/fire binds on keys) would fire while typing. Needs the capture mechanism below. |
| Names | Server knows each connection's display name (`ClientInfo`); killfeed resolves names client-side, but the chat event should CARRY `senderName` so demos replay names without roster lookups. |

## Design

### Wire path (server-authoritative, demo-free-ride)

```
client T→type→Enter
  └─ MessageType.Chat (0x89) { text }                  (sender = connection)
       └─ GameServer: sanitize → rate-limit → queue
            └─ SnapshotBuilder one-shot event
               chat { senderId, senderName, team, text }   (EVT code 14)
                 ├─ broadcast in snapshots → GameEvents → FPSChat.addMessage
                 └─ DemoRecorder (automatic, D16) → DemoService playback case
```

- **Sanitize server-side**: trim; cap length (**128 chars**, also `maxLength` on
  the input); strip control chars/newlines; drop empty. No profanity filter.
- **Rate limit**: reuse `rateLimited` — e.g. min 600ms between messages per
  client, plus a 5-in-5s burst cap. Oversized/overflowing messages are dropped
  silently (log-only, consistent with authority conventions).
- **No local echo** — the message appears when the server event round-trips
  (Q3 behavior; ~1 snapshot of latency, imperceptible, and replay-faithful).
- **Event carries the name string**: slightly larger on wire (rare event, don't
  care) but demos stay self-contained.

### Talk mode & input capture (the tricky part)

- **T** opens the input (preventDefault so the "t" doesn't leak into the field),
  **Enter** sends, **Esc** cancels. T is ignored while: console open, pause
  menu open, settings open, or input already active.
- **Keyboard capture**: add a guard in `CameraInputHandler` keydown/keyup —
  ignore game binds when `document.activeElement` is an INPUT/TEXTAREA. This is
  the generic fix (also future-proofs any other text field over gameplay).
- **Pointer lock stays held; mouse look keeps working while typing** (Q3
  messagemode feel). Movement keys type letters instead of moving — correct.
- Spectators can chat (name prefixed `[SPEC]` in the render, not in the data).

### History dialog

Two presentation states of the same message store (store cap ~100):

- **Closed (default)**: last ~5 messages as an overlay, each fading after 8s —
  the existing FPSChat behavior, restyled.
- **Talk mode (input open)**: the panel expands to a scrollable **history
  dialog** (washoi print-slab: navy scan panel, cyan edge-bar, team-colored
  sender stamps — same vocabulary as the lobby chat restyle), mouse-wheel
  scrollback, all buffered messages visible. Closing collapses back to overlay.

### Team chat (decision needed)

`say_team` (Y key) needs **per-client event filtering** in the snapshot
broadcaster (events are currently broadcast identically to everyone; entities
already get PVS-filtered per client, so a filter hook exists conceptually but
not for events). Proposal: **v1 ships all-chat only**; team chat is a fast
follow once the broadcaster gains per-client event filtering. In demos, team
chat would be visible to all replay viewers (standard).

## Work orders

| WO | Task | Files | Notes |
| --- | --- | --- | --- |
| C1 | Protocol + server: `MessageType.Chat` encode/decode + codec tests; GameServer dispatch → sanitize → `rateLimited` → pending queue; `chat` snapshot event (EVT 14) encode/decode + `ProtocolCodecs.test` | `BinaryProtocol.ts`, `MessageCodec.ts`, `GameServer.ts`, `SnapshotBuilder.ts` | server-authoritative core; unit-testable headlessly |
| C2 | Client talk mode: T bind + input-element guard in `CameraInputHandler`; wire `FPSChat` ↔ `NetworkGameHost` send; `GameEvents` `chat` case → `addMessage` | `CameraInputHandler.ts`, `FPSHud.ts`, `Game.ts`, `GameEvents.ts`, `NetworkGameHost.ts` | browser-heavy; guard interactions with console/menus |
| C3 | History dialog + washoi restyle: expanded scrollback in talk mode, print-slab styling, team-colored senders, `[SPEC]` prefix | `Chat.ts`, `WashikiTheme.css` (or FPS css) | visual-only |
| C4 | Demos: `DemoService` playback `chat` case; regression test that a recorded chat event survives record→read (extend `DemoRecordingCapture`-style test) | `DemoService.ts`, demo tests | recording itself is free (D16) |

Gates: `npm test` (+ codec/demo tests), `server:tick`/`server:fuzz` (chat is
outside the deterministic sim — events only — but run anyway per AGENTS.md),
browser pass with two windows.

## Open questions (brainstorm)

1. **Team chat in v1?** Needs broadcaster per-client event filtering (see above). Recommendation: v1 all-chat, team chat fast-follow.
2. **Enter as a second open-chat key?** Q3 uses T only; Enter is safer left unbound (future ready-up etc.). Recommendation: T only.
3. **History depth**: 100 messages buffered, ~5 visible when closed, 8s fade. OK?
4. **Rate limit numbers**: 600ms min interval, 5-per-5s burst, 128 char cap. OK?
5. **Where on screen?** Bottom-left overlay (killfeed is top-right, vitals bottom). Talk-mode dialog grows upward from the input.
6. **Kill/system lines in the chat history too?** (deaths, joins, match phase) — Q3 mixes them into console; our killfeed is separate. Recommendation: chat shows only player talk + join/leave lines; keep killfeed separate.
7. Sounds: out of scope (no audio system usage yet — same as teleporters).
8. Mute/ignore, profanity filter, chat commands (`/`…): deferred, note only.
