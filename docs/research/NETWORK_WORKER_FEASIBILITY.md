# Network Worker — Feasibility Analysis

Investigation into offloading network serialization to a dedicated worker thread.
Status: **Not building yet — profiling first to determine if it's needed.**

---

## What Burns Server CPU

The server tick budget at 128Hz = **7.8ms per tick**. Networking cost breakdown:

| Hot Path | What It Does | Per-tick Cost (8 players) |
| -------- | ------------ | ------------------------ |
| `toGameState()` | Copies ECS → GameState (class instances) | ~0.2ms |
| `encodeSnapshot()` × N | Binary encode + delta compress per client | **~1-2ms** |
| `decodeCommand()` × N | Decode incoming inputs | ~0.1ms |
| WebSocket `.send()` × N | Buffer + kernel handoff | ~0.1ms |

**Encoding is 80%+ of the network CPU.** The rest (transport I/O, decode) is cheap.

---

## The Hard Problem: State Transfer

Workers can't share JS object references. Data must cross the boundary via:

1. **`postMessage()`** — structured clone (copies everything, slow for complex objects)
2. **`SharedArrayBuffer`** — zero-copy shared memory (fast, requires manual layout)
3. **Transferable objects** — `ArrayBuffer`, `MessagePort` (transferred, not copied)

`GameState` contains Maps of Entity class instances with methods and closures — **not transferable**. Moving it to a worker requires either serialization (which may cost as much as the encoding) or rewriting the ECS into flat typed arrays.

---

## Architecture Options

### Option A: Codec-Only Worker (Medium effort)

Move **only** `MessageCodec.encodeSnapshot()` to a worker. Transport stays on main thread.

```text
Main Thread                          Worker Thread
───────────────────────────          ──────────────────────────
GameServer.tick()
  → toGameState()
  → serialize → flat buffer  ────→  encodeSnapshot(buffer, baseline)
                                       → snapshotBytes
  ← ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─    transfer back
  → transport.send(snapshotBytes)
```

- **Pro:** Moderate changes, keeps transport simple
- **Con:** Serialization tax may negate worker benefit, adds ~1 frame latency

### Option B: Full Transport Worker (High effort)

Move transport + encoding + decoding into the worker. Main thread only runs simulation.

- **Pro:** Zero encoding work on main thread, transport fully off-thread
- **Con:** WebSocket handles can't transfer between Node.js threads, massive refactor, debugging across threads is painful

### Option C: Profile First (Recommended)

Add timing instrumentation to `broadcastSnapshot()`. If encoding is consistently under 1-2ms with delta compression active, the worker adds more complexity than it saves.

---

## Estimates

| Metric | Option A | Option B |
| ------ | -------- | -------- |
| New code | ~400 LOC | ~1000 LOC |
| Modified files | 3-4 | 8-10 |
| Risk level | Medium | High |
| Estimated time | 2-3 days | 5-7 days |
| Break-even player count | ~12+ | ~8+ |

---

## Key Risks

| Risk | Severity |
| ---- | -------- |
| Serialization tax negates worker benefit | **High** |
| SharedArrayBuffer forces ECS rewrite | **High** |
| Latency increase (async encode round-trip) | Medium |
| WebSocket handle ownership (Option B) | Medium |
| Debugging across threads | Medium |

---

## Decision

**Profile first, build later if justified.** The break-even point is ~12-16 players. Below that, worker overhead likely costs more than encoding.

If we build it later, **Option A (Codec Worker)** is the pragmatic choice — moderate risk, doesn't touch transport architecture.

### Profiling Added

`broadcastSnapshot()` in `GameServer.ts` now logs encoding time every 100 ticks. Run the server with 4-8 players and check the `[Perf]` output to measure actual cost.
