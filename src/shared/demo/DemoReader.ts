/**
 * DemoReader — Shared .shagdemo file parser
 *
 * Used by:
 *   1. Server-side brain.js training pipeline (readAllFrames)
 *   2. Client-side demo viewer (readHeader + seekFrame)
 *
 * The .shagdemo format stores full (non-delta) snapshots per frame,
 * so any frame can be decoded independently via the index table.
 */

import type { GameState } from "../../engine/network/core/GameState";
import { BinaryProtocol } from "../../engine/network/protocol/BinaryProtocol";

// zlib is Node-only. Lazy-loaded to avoid crashes when this module is
// imported in a browser context (future demo viewer will use DecompressionStream).
let zlib: typeof import("zlib") | null = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  zlib = require("node:zlib");
} catch {
  // Running in browser — zlib unavailable
}

// ── Types ───────────────────────────────────────────────────────────────

export interface DemoHeader {
  /** Format version */
  version: number;
  /** Map name */
  map: string;
  /** Gametype (duel, ffa, tdm, etc.) */
  gametype: string;
  /** Server tick rate */
  tickRate: number;
  /** Snapshot rate */
  snapshotRate: number;
  /** Recording start time (ms since epoch) */
  startTime: number;
  /** Player roster */
  players: DemoPlayerInfo[];
}

export interface DemoPlayerInfo {
  playerId: string;
  name: string;
  team: string;
}

export interface DemoFrame {
  /** Server tick number */
  tick: number;
  /** Decoded GameState */
  state: GameState;
}

export interface DemoIndex {
  /** Total number of frames */
  frameCount: number;
  /** Tick → byte offset mapping */
  entries: Array<{ tick: number; offset: number }>;
  /** Total duration in ms */
  durationMs: number;
  /** Byte offset where index table starts */
  indexOffset: number;
}

// ── Magic bytes ─────────────────────────────────────────────────────────

const DEMO_MAGIC = [0x53, 0x48, 0x41, 0x47]; // "SHAG"

// ── DemoReader ──────────────────────────────────────────────────────────

export class DemoReader {
  private _data: Uint8Array;
  private _header: DemoHeader | null = null;
  private _index: DemoIndex | null = null;

  constructor(data: Uint8Array | ArrayBuffer) {
    let raw = data instanceof Uint8Array ? data : new Uint8Array(data);

    // Auto-detect gzip: magic bytes 0x1f 0x8b
    if (raw.length >= 2 && raw[0] === 0x1f && raw[1] === 0x8b) {
      if (!zlib) {
        throw new Error(
          "DemoReader: gzip-compressed demo cannot be read in browser (zlib unavailable). Use DecompressionStream API instead.",
        );
      }
      raw = new Uint8Array(zlib.gunzipSync(raw));
    }

    this._data = raw;
  }

  // ── Header ───────────────────────────────────────────────────────

  /**
   * Parse the demo header (metadata + player roster).
   * Throws if the file is not a valid .shagdemo.
   */
  readHeader(): DemoHeader {
    if (this._header) return this._header;

    const view = new DataView(this._data.buffer, this._data.byteOffset, this._data.byteLength);
    let offset = 0;

    // Validate magic bytes
    for (let i = 0; i < 4; i++) {
      if (this._data[offset + i] !== DEMO_MAGIC[i]) {
        throw new Error("Not a valid .shagdemo file (bad magic bytes)");
      }
    }
    offset += 4;

    // Version
    const version = view.getUint8(offset);
    offset += 1;
    if (version !== 1) {
      throw new Error(`Unsupported demo version: ${version}`);
    }

    // Map name
    const [map, mapLen] = this._readString(offset);
    offset += mapLen;

    // Gametype
    const [gametype, gtLen] = this._readString(offset);
    offset += gtLen;

    // Tick rate
    const tickRate = view.getUint8(offset);
    offset += 1;

    // Snapshot rate
    const snapshotRate = view.getUint8(offset);
    offset += 1;

    // Start timestamp (uint32 high + uint32 low → 64-bit)
    const tsHigh = view.getUint32(offset);
    offset += 4;
    const tsLow = view.getUint32(offset);
    offset += 4;
    const startTime = tsHigh * 0x100000000 + tsLow;

    // Player roster
    const playerCount = view.getUint8(offset);
    offset += 1;
    const players: DemoPlayerInfo[] = [];

    for (let i = 0; i < playerCount; i++) {
      const [playerId, pidLen] = this._readString(offset);
      offset += pidLen;
      const [name, nameLen] = this._readString(offset);
      offset += nameLen;
      const [team, teamLen] = this._readString(offset);
      offset += teamLen;
      players.push({ playerId, name, team });
    }

    // headerEndOffset = offset (for sequential frame reading)
    this._header = { version, map, gametype, tickRate, snapshotRate, startTime, players };
    return this._header;
  }

  // ── Index Table ──────────────────────────────────────────────────

  /**
   * Read the index table from the end of the file.
   * Must call readHeader() first.
   */
  readIndex(): DemoIndex {
    if (this._index) return this._index;

    const view = new DataView(this._data.buffer, this._data.byteOffset, this._data.byteLength);
    const fileLen = this._data.byteLength;

    // Footer is last 8 bytes: durationMs (uint32) + indexOffset (uint32)
    const indexOffset = view.getUint32(fileLen - 4);
    const durationMs = view.getUint32(fileLen - 8);

    // Validate indexOffset is within file bounds
    if (indexOffset >= fileLen - 8 || indexOffset < 0) {
      throw new Error(`Invalid demo index offset: ${indexOffset} (file length: ${fileLen})`);
    }

    // Read index table at indexOffset
    let offset = indexOffset;
    const frameCount = view.getUint32(offset);
    offset += 4;

    const entries: Array<{ tick: number; offset: number }> = [];
    for (let i = 0; i < frameCount; i++) {
      const tick = view.getUint32(offset);
      offset += 4;
      const byteOffset = view.getUint32(offset);
      offset += 4;
      entries.push({ tick, offset: byteOffset });
    }

    this._index = { frameCount, entries, durationMs, indexOffset };
    return this._index;
  }

  // ── Frame Reading ────────────────────────────────────────────────

  /**
   * Read all frames sequentially. Good for training data extraction.
   */
  readAllFrames(): DemoFrame[] {
    this.readHeader();
    const index = this.readIndex();
    const frames: DemoFrame[] = [];

    for (const entry of index.entries) {
      const frame = this._readFrameAt(entry.offset);
      if (frame) frames.push(frame);
    }

    return frames;
  }

  /**
   * Read a single frame by index (0-based). Good for demo viewer seeking.
   */
  readFrame(frameIndex: number): DemoFrame | null {
    const index = this.readIndex();
    if (frameIndex < 0 || frameIndex >= index.entries.length) return null;
    return this._readFrameAt(index.entries[frameIndex].offset);
  }

  /**
   * Find the frame index closest to a given tick.
   */
  findFrameByTick(tick: number): number {
    const index = this.readIndex();

    // Binary search for the closest tick
    let lo = 0;
    let hi = index.entries.length - 1;

    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (index.entries[mid].tick < tick) {
        lo = mid + 1;
      } else {
        hi = mid;
      }
    }

    return lo;
  }

  // ── Summary ──────────────────────────────────────────────────────

  /**
   * Get a human-readable summary of the demo.
   */
  getSummary(): string {
    const header = this.readHeader();
    const index = this.readIndex();
    const durSec = (index.durationMs / 1000).toFixed(1);
    const players = header.players.map((p) => p.name).join(", ");
    return `${header.map} (${header.gametype}) — ${durSec}s, ${index.frameCount} frames — Players: ${players}`;
  }

  // ── Private Helpers ──────────────────────────────────────────────

  /**
   * Read a frame at a specific byte offset in the file.
   */
  private _readFrameAt(byteOffset: number): DemoFrame | null {
    // Bounds check: need at least 8 bytes for tick + frameLen
    if (byteOffset < 0 || byteOffset + 8 > this._data.byteLength) {
      console.warn(`[DemoReader] Frame offset ${byteOffset} out of bounds (file: ${this._data.byteLength} bytes)`);
      return null;
    }

    const view = new DataView(this._data.buffer, this._data.byteOffset, this._data.byteLength);
    let offset = byteOffset;

    // Read tick
    const tick = view.getUint32(offset);
    offset += 4;

    // Read frame length
    const frameLen = view.getUint32(offset);
    offset += 4;

    // Extract frame data
    const frameData = this._data.slice(offset, offset + frameLen);

    // Decode using BinaryProtocol (no baseline = full decode)
    try {
      const state = BinaryProtocol.decodeSnapshot(frameData);
      return { tick, state };
    } catch (err) {
      console.warn(`[DemoReader] Failed to decode frame at tick ${tick}:`, err);
      return null;
    }
  }

  /**
   * Read a length-prefixed UTF-8 string at the given offset.
   * Returns [string, totalBytesConsumed].
   */
  private _readString(offset: number): [string, number] {
    const view = new DataView(this._data.buffer, this._data.byteOffset, this._data.byteLength);
    const strLen = view.getUint16(offset);
    offset += 2;
    const bytes = this._data.slice(offset, offset + strLen);
    const decoder = new TextDecoder();
    return [decoder.decode(bytes), 2 + strLen];
  }

  // ── Static Helpers ───────────────────────────────────────────────

  /**
   * Quick header peek without constructing a full DemoReader.
   */
  static peekHeader(data: Uint8Array | ArrayBuffer): DemoHeader {
    return new DemoReader(data).readHeader();
  }
}
