/**
 * DemoReaderBrowser tests — Browser gzip decompression via DecompressionStream
 *
 * Tests the DemoReader.fromFile() async factory and _decompressGzip path.
 * Uses Node zlib to create gzipped test data and verifies roundtrip.
 */
import { describe, it, expect } from 'vitest';
import { DemoReader } from '../../shared/demo/DemoReader';
import * as zlib from 'node:zlib';

// ─── Helpers ─────────────────────────────────────────────────────

/**
 * Create a minimal valid .shagdemo file (uncompressed).
 */
function createMinimalDemo(): Uint8Array {
  const parts: number[] = [];

  // Magic: "SHAG"
  parts.push(0x53, 0x48, 0x41, 0x47);

  // Version: 1
  parts.push(1);

  // Map name: "test" (uint16 len + bytes)
  const mapBytes = new TextEncoder().encode('test');
  parts.push(0, mapBytes.length, ...mapBytes);

  // Gametype: "duel"
  const gtBytes = new TextEncoder().encode('duel');
  parts.push(0, gtBytes.length, ...gtBytes);

  // Tick rate: 60
  parts.push(60);

  // Snapshot rate: 20
  parts.push(20);

  // Start time: 8 bytes (uint32 high + uint32 low)
  parts.push(0, 0, 0, 0, 0, 0, 0, 0);

  // Player count: 0
  parts.push(0);

  // No frames, just an index table + footer

  // Index: frameCount = 0
  const indexOffset = parts.length;
  parts.push(0, 0, 0, 0); // frameCount = 0

  // Footer: durationMs (uint32) + indexOffset (uint32)
  const durationMs = 0;
  const footer = new DataView(new ArrayBuffer(8));
  footer.setUint32(0, durationMs);
  footer.setUint32(4, indexOffset);
  for (let i = 0; i < 8; i++) {
    parts.push(new Uint8Array(footer.buffer)[i]);
  }

  return new Uint8Array(parts);
}

/**
 * Gzip compress a Uint8Array using Node zlib.
 */
function gzipCompress(data: Uint8Array): Uint8Array {
  return new Uint8Array(zlib.gzipSync(data));
}

// ─── Tests ───────────────────────────────────────────────────────

describe('DemoReader (browser gzip)', () => {
  // ── Constructor (existing behavior) ───────────────────────────

  it('reads uncompressed demo via constructor', () => {
    const data = createMinimalDemo();
    const reader = new DemoReader(data);
    const header = reader.readHeader();
    expect(header.map).toBe('test');
    expect(header.gametype).toBe('duel');
    expect(header.tickRate).toBe(60);
    expect(header.snapshotRate).toBe(20);
  });

  it('reads gzip-compressed demo via constructor (Node zlib)', () => {
    const demo = createMinimalDemo();
    const compressed = gzipCompress(demo);
    const reader = new DemoReader(compressed);
    const header = reader.readHeader();
    expect(header.map).toBe('test');
    expect(header.gametype).toBe('duel');
  });

  it('rejects invalid magic bytes', () => {
    const data = new Uint8Array([0, 0, 0, 0, 1, 0, 0, 0, 0, 0]);
    expect(() => new DemoReader(data).readHeader()).toThrow('bad magic bytes');
  });

  // ── fromFile (async factory) ──────────────────────────────────

  it('fromFile reads uncompressed demo', async () => {
    const data = createMinimalDemo();
    const reader = await DemoReader.fromFile(data);
    const header = reader.readHeader();
    expect(header.map).toBe('test');
  });

  it('fromFile reads gzip-compressed demo', async () => {
    const demo = createMinimalDemo();
    const compressed = gzipCompress(demo);
    const reader = await DemoReader.fromFile(compressed);
    const header = reader.readHeader();
    expect(header.map).toBe('test');
    expect(header.gametype).toBe('duel');
  });

  it('fromFile accepts ArrayBuffer input', async () => {
    const data = createMinimalDemo();
    const reader = await DemoReader.fromFile(data.buffer as ArrayBuffer);
    const header = reader.readHeader();
    expect(header.map).toBe('test');
  });

  // ── Index + summary ───────────────────────────────────────────

  it('reads index from minimal demo', () => {
    const data = createMinimalDemo();
    const reader = new DemoReader(data);
    reader.readHeader();
    const index = reader.readIndex();
    expect(index.frameCount).toBe(0);
    expect(index.entries).toEqual([]);
  });

  it('provides human-readable summary', () => {
    const data = createMinimalDemo();
    const reader = new DemoReader(data);
    const summary = reader.getSummary();
    expect(summary).toContain('test');
    expect(summary).toContain('duel');
    expect(summary).toContain('0 frames');
  });

  // ── Edge cases ────────────────────────────────────────────────

  it('detects gzip magic bytes correctly', async () => {
    const demo = createMinimalDemo();
    const compressed = gzipCompress(demo);

    // Verify gzip magic bytes
    expect(compressed[0]).toBe(0x1f);
    expect(compressed[1]).toBe(0x8b);

    // fromFile should auto-detect and decompress
    const reader = await DemoReader.fromFile(compressed);
    expect(reader.readHeader().map).toBe('test');
  });

  it('peekHeader works on uncompressed data', () => {
    const data = createMinimalDemo();
    const header = DemoReader.peekHeader(data);
    expect(header.map).toBe('test');
  });
});
