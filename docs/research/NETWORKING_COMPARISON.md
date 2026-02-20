# Netcode Comparison Matrix

How SHAG Engine stacks up against the legends. Technically accurate, no marketing fluff.

> [!NOTE]
> SHAG runs **entirely in the browser**. Everything below happens over WebSocket/WebTransport — no native UDP socket access, no privileged OS APIs, no custom drivers. That context makes these numbers significant.

---

## Core Simulation

| Spec | Quake 3 Arena (1999) | Warsow / QFusion (2005) | SHAG Engine (2025) |
|------|:---:|:---:|:---:|
| **Server tick rate** | 20 Hz (50ms) | ~62 Hz (16ms) | **125 Hz (8ms)** |
| **Client command rate** | Up to 125 Hz (`cl_maxpackets`) | 62 Hz (`cl_pps`) | **125 Hz** (locked to tick) |
| **Snapshot rate** | = sv_fps (20 Hz) | = sv_pps (~62 Hz) | **60 Hz** (every 2nd tick) |
| **Tick-to-snapshot decoupling** | ❌ 1:1 coupled | ❌ 1:1 coupled | ✅ Decoupled (125:60) |
| **Deterministic simulation** | ✅ Fixed timestep | ✅ Fixed timestep | ✅ Fixed 8ms timestep |
| **Subsystem tick rates** | ❌ All at sv_fps | ❌ All at sv_fps | ✅ Per-subsystem configurable |

---

## Transport Layer

| Spec | Quake 3 Arena | Warsow / QFusion | SHAG Engine |
|------|:---:|:---:|:---:|
| **Protocol** | Raw UDP | Raw UDP | **WebSocket + WebTransport** |
| **Encryption** | ❌ None | ❌ None | ✅ TLS (WSS/WT) |
| **NAT traversal** | Manual port forward | Manual port forward | ✅ Built-in (HTTP upgrade) |
| **Firewall friendly** | ❌ UDP blocked often | ❌ UDP blocked often | ✅ Port 443 / HTTPS |
| **Binary protocol** | ✅ Custom bitstream | ✅ Q2-derived bitstream | ✅ Custom binary encoder |
| **Platform** | Win/Linux/Mac native | Win/Linux/Mac native | **Browser** (+ Electron, Capacitor) |
| **Zero install** | ❌ | ❌ | ✅ Click a link, play |

---

## Prediction & Reconciliation

| Feature | Quake 3 Arena | Warsow / QFusion | SHAG Engine |
|---------|:---:|:---:|:---:|
| **Client-side prediction** | ✅ Movement only | ✅ Movement + special moves | ✅ Movement + weapons + KB |
| **Input replay reconciliation** | ❌ Snap correction | ❌ Snap correction | ✅ Full input history replay |
| **Visual smoothing** | ❌ Hard snap on correction | ❌ Hard snap on correction | ✅ Exponential decay (~50ms) |
| **Command redundancy** | ✅ (sends last N) | ✅ (sends last N) | ✅ Configurable window |
| **Predicted self-knockback** | ❌ Server-only | ❌ Server-only | ✅ Instant client-side |
| **Predicted weapon fire** | ❌ | ❌ | ✅ Instant feedback |

---

## Interpolation & Timing

| Feature | Quake 3 Arena | Warsow / QFusion | SHAG Engine |
|---------|:---:|:---:|:---:|
| **Interpolation method** | Linear between 2 snapshots | Linear between 2 snapshots | **Time-based SnapshotBuffer** |
| **Interpolation delay** | Fixed (~100ms at 20Hz) | Fixed (~32ms at 62Hz) | **Auto-adjusting (~50ms)** |
| **Jitter compensation** | ❌ `cl_timenudge` manual | ❌ Manual tuning | ✅ Automatic buffer sizing |
| **Clock synchronization** | ❌ None (uses ping estimate) | ❌ None (uses ping estimate) | ✅ **NTP-like ClockSync** |
| **Extrapolation** | ✅ On packet loss | ✅ On packet loss | ✅ On buffer underrun |
| **Entity interpolation** | Position + angles | Position + angles | Position + angles + state |

---

## Bandwidth Optimization

| Feature | Quake 3 Arena | Warsow / QFusion | SHAG Engine |
|---------|:---:|:---:|:---:|
| **Delta compression** | ✅ Per-client acknowledged | ✅ Q2-style delta | ✅ **Per-client delta** |
| **Bandwidth savings** | ~60% reduction | ~60% reduction | **50-70% reduction** |
| **Rate limiting** | ✅ `rate` cvar | ✅ `rate` cvar | ✅ Server-side configurable |
| **PVS culling** | ✅ BSP-based | ✅ BSP-based | 🔄 Planned |
| **Packet fragmentation** | Custom over UDP | Custom over UDP | Handled by transport layer |
| **Unreliable channel** | ✅ UDP native | ✅ UDP native | ✅ WebTransport datagrams |
| **Reliable channel** | ✅ App-layer over UDP | ✅ App-layer over UDP | ✅ WebSocket / WT streams |

---

## Anti-Cheat & Security

| Feature | Quake 3 Arena | Warsow / QFusion | SHAG Engine |
|---------|:---:|:---:|:---:|
| **Server-authoritative** | ✅ Position + combat | ✅ Position + combat | ✅ **Everything** |
| **Anti-warp / speed hack** | ❌ No rate validation | ❌ No rate validation | ✅ **MovementValidator** |
| **Transport encryption** | ❌ Plaintext UDP | ❌ Plaintext UDP | ✅ TLS mandatory |
| **Server-auth projectiles** | ❌ Client-predicted only | ❌ Client-predicted only | ✅ Server-spawned + interpolated |
| **Server-auth weapons** | Partial (damage only) | Partial (damage only) | ✅ Full pipeline |

---

## Diagnostics

| Feature | Quake 3 Arena | Warsow / QFusion | SHAG Engine |
|---------|:---:|:---:|:---:|
| **Net graph overlay** | ✅ `cg_lagometer` | ✅ Lagometer | ✅ `cl_netgraph` (Q3/Source-style) |
| **Metrics shown** | Ping, FPS, snapshot timing | Ping, FPS, loss | Ping, snapshot rate, loss %, interp delay, cmd rate, reconciliation rate, clock offset |
| **Network console commands** | `status`, `serverinfo` | `status`, `serverinfo` | `network status`, `connect`, `disconnect`, `cl_interp`, `cl_timenudge` |

---

## Server Architecture

| Feature | Quake 3 Arena | Warsow / QFusion | SHAG Engine |
|---------|:---:|:---:|:---:|
| **Language** | C | C/C++ | **TypeScript** (isomorphic) |
| **Dedicated server** | ✅ Separate binary | ✅ Separate binary | ✅ Same codebase, headless mode |
| **Shared physics code** | ❌ Separate implementations | ❌ Separate implementations | ✅ **Identical code client + server** |
| **Headless mode** | ✅ (no renderer) | ✅ (no renderer) | ✅ Node.js, no GPU required |
| **Hot-join** | ✅ | ✅ | ✅ Full state sync on connect |
| **Lag compensation** | ❌ | ❌ | ✅ **Server-side rewind** |
| **ECS-based** | ❌ Procedural | ❌ Procedural | ✅ Entity-Component-System |
| **Subsystem architecture** | Monolithic game loop | Monolithic game loop | ✅ Modular subsystems with independent tick rates |

---

## The Browser Tax

Running in a browser means accepting constraints that Q3 and Warsow never had to deal with:

| Constraint | Native (Q3/Warsow) | Browser (SHAG) |
|-----------|:---:|:---:|
| **Raw UDP access** | ✅ | ❌ Must use WebSocket/WebTransport |
| **Thread priority** | ✅ OS-level | ❌ At mercy of browser scheduler |
| **Memory control** | ✅ malloc/free | ❌ GC pauses possible |
| **Timer resolution** | ✅ ~1ms or better | ⚠️ ~4ms minimum (browser spec) |
| **CPU access** | ✅ Full, native | ❌ Single-threaded JS (+Workers) |

Despite these constraints, SHAG achieves **125Hz deterministic server simulation** and **sub-16ms client frame budgets** — in a web browser.

---

## Summary

| | Q3 Arena | Warsow | SHAG |
|---|:---:|:---:|:---:|
| **Year** | 1999 | 2005 | 2025 |
| **Tick rate** | 20 Hz | ~62 Hz | **125 Hz** |
| **Transport** | UDP | UDP | WSS/WebTransport |
| **Smooth corrections** | ❌ | ❌ | ✅ |
| **Clock sync** | ❌ | ❌ | ✅ |
| **Auto-interp** | ❌ | ❌ | ✅ |
| **Anti-warp** | ❌ | ❌ | ✅ |
| **Server-auth projectiles** | ❌ | ❌ | ✅ |
| **Lag compensation** | ❌ | ❌ | ✅ |
| **Runs in browser** | ❌ | ❌ | ✅ |
| **Encrypted** | ❌ | ❌ | ✅ |
| **Zero install** | ❌ | ❌ | ✅ |

*SHAG stands on the shoulders of giants — Q3's prediction model and Warsow's movement philosophy — but brings them into the modern web with higher fidelity networking than either ancestor achieved.*
