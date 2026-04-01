# Demo Parsing Bug Investigation

**Status:** Root cause identified — endianness mismatch in DemoReader  
**Date:** 2026-04-01

---

## Symptom

The demo archive shows "No recorded demos yet." despite `.shagdemo` files existing on disk. The server logs show:

```
[LobbyServer] Failed to parse demo: wdm2_duel_20260323_173335.shagdemo
  Invalid demo index offset: 2345837312 (file length: 10914815)
```

Every single demo fails. The reported `indexOffset` values are wildly larger than the file sizes — sometimes by 100–250×. Two demos crash with `Offset is outside the bounds of the DataView` instead.

---

## Is the problem writing or reading?

**Reading.** The files are written correctly by `DemoRecorder`. The bug is in `DemoReader`.

---

## Root Cause: Missing `littleEndian` parameter on all `DataView.getUint32()` calls

`DemoRecorder` uses `BinaryEncoder`, which writes all multi-byte integers as **little-endian** (second argument = `true`):

```typescript
// BinaryProtocol.ts — BinaryEncoder
this.view.setUint32(this.offset, value, true);   // little-endian ✓
this.view.setUint16(this.offset, value, true);   // little-endian ✓
```

`DemoReader` reads them directly with `DataView`, but **omits the `littleEndian` argument on every call**, so it defaults to **big-endian**:

```typescript
// DemoReader.ts line 178 — THE CRITICAL ONE
const indexOffset = view.getUint32(fileLen - 4);   // reads big-endian ✗
```

### Why the numbers look so wrong

When a little-endian uint32 is read as big-endian, the byte order is reversed. Example:

| Actual value | Bytes on disk (LE) | Misread as BE |
|---|---|---|
| `10,914,815` = `0x00A68ABF` | `BF 8A A6 00` | `0xBF8AA600` = **3,213,869,568** |

The misread value is always well beyond the file size, which is why every demo fails the bounds check at [DemoReader.ts:182](../../src/shared/demo/DemoReader.ts#L182).

---

## All affected call sites in DemoReader.ts

Every `DataView` multi-byte read in the file is missing `true`:

| Line | Call | Purpose |
|---|---|---|
| 139 | `view.getUint32(offset)` | Timestamp high bits |
| 141 | `view.getUint32(offset)` | Timestamp low bits |
| **178** | `view.getUint32(fileLen - 4)` | **Index offset — primary failure point** |
| **179** | `view.getUint32(fileLen - 8)` | Duration ms |
| 188 | `view.getUint32(offset)` | Frame count (in index table) |
| 193 | `view.getUint32(offset)` | Tick (in index entry) |
| 195 | `view.getUint32(offset)` | Byte offset (in index entry) |
| 282 | `view.getUint32(offset)` | Frame tick |
| 286 | `view.getUint32(offset)` | Frame length |
| 308 | `view.getUint16(offset)` | String length prefix |

All 10 calls need `, true` added as the second argument.

---

## The two `Offset is outside the bounds of the DataView` errors

These are a secondary symptom of the same bug. After the misread `indexOffset` passes the `>= fileLen - 8` check by coincidence (e.g. a small file where the reversed bytes happen to fall near the end), the subsequent `view.getUint32(offset)` read at that garbage position falls outside the DataView bounds, throwing the DataView error instead.

---

## Fix

In [src/shared/demo/DemoReader.ts](../../src/shared/demo/DemoReader.ts), add `, true` to every `getUint32` and `getUint16` call on a raw `DataView`. Do **not** change calls that go through `BinaryDecoder` — those already pass `true` internally.

The fix is mechanical: 10 one-character additions. No format change is needed; the on-disk files are correct.

---

## Verification

After the fix, load any existing `.shagdemo` file. The `indexOffset` should equal a value smaller than `fileLen - 8`. A file of ~18 MB should report an offset of roughly `fileLen - (frameCount × 8 + 4)` bytes from the end — a few hundred KB at most for a typical match.
