/**
 * One file out of a pk3 on disk, read without loading the archive: the
 * central directory finds the entry, only its compressed bytes are read, and
 * they inflate into a buffer of exactly its size, checked against its CRC.
 *
 * NodePk3 uses it for a headless owner's map (bots, game servers, tools): a
 * map's BSP is tens of megabytes inside an archive of tens more, and loading
 * the archive whole held several copies of both at once. Anything this does
 * not read (zip64, an unknown compression method, a damaged directory)
 * returns null, and the caller reads the archive as before.
 */

import * as fs from "node:fs";
import * as zlib from "node:zlib";

const END_OF_DIRECTORY = 0x06054b50;
const DIRECTORY_ENTRY = 0x02014b50;
const LOCAL_HEADER = 0x04034b50;
/** The end-of-directory record and the longest comment it may carry. */
const END_SEARCH = 22 + 0xffff;
const STORED = 0;
const DEFLATED = 8;

/** zlib's CRC-32 (Node 22 and up; the project's type definitions predate it), or undefined without it. */
const crc32 = (zlib as unknown as { crc32?: (data: Uint8Array) => number }).crc32;

/** How a pk3 names a file: lower case, forward slashes, as PK3Loader indexes it. */
function normalize(name: string): string {
  return name.toLowerCase().replace(/\\/g, "/");
}

function readAt(fd: number, position: number, length: number): Buffer {
  const buffer = Buffer.allocUnsafe(length);
  const view = new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  let read = 0;
  while (read < length) {
    const n = fs.readSync(fd, view, read, length - read, position + read);
    if (n === 0) throw new Error("unexpected end of archive");
    read += n;
  }
  return buffer;
}

/** `entry` (as PK3Loader names files) from the pk3 at `file`, or null when this cannot read it. */
export function readZipEntry(file: string, entry: string): ArrayBuffer | null {
  const wanted = normalize(entry);
  let fd: number | null = null;
  try {
    fd = fs.openSync(file, "r");
    const size = fs.fstatSync(fd).size;
    const tailLength = Math.min(size, END_SEARCH);
    const tail = readAt(fd, size - tailLength, tailLength);
    let end = -1;
    for (let i = tail.length - 22; i >= 0; i--) {
      if (tail.readUInt32LE(i) === END_OF_DIRECTORY) {
        end = i;
        break;
      }
    }
    if (end < 0) return null;
    const entries = tail.readUInt16LE(end + 10);
    const directorySize = tail.readUInt32LE(end + 12);
    const directoryOffset = tail.readUInt32LE(end + 16);
    // Zip64 marks these with all ones: not read here
    if (entries === 0xffff || directorySize === 0xffffffff || directoryOffset === 0xffffffff) return null;
    const directory = readAt(fd, directoryOffset, directorySize);
    let at = 0;
    for (let n = 0; n < entries; n++) {
      if (at + 46 > directory.length || directory.readUInt32LE(at) !== DIRECTORY_ENTRY) return null;
      const method = directory.readUInt16LE(at + 10);
      const crc = directory.readUInt32LE(at + 16);
      const compressed = directory.readUInt32LE(at + 20);
      const uncompressed = directory.readUInt32LE(at + 24);
      const nameLength = directory.readUInt16LE(at + 28);
      const extraLength = directory.readUInt16LE(at + 30);
      const commentLength = directory.readUInt16LE(at + 32);
      const localOffset = directory.readUInt32LE(at + 42);
      const name = directory.toString("utf8", at + 46, at + 46 + nameLength);
      at += 46 + nameLength + extraLength + commentLength;
      if (normalize(name) !== wanted) continue;
      if (compressed === 0xffffffff || uncompressed === 0xffffffff || localOffset === 0xffffffff) return null;
      const local = readAt(fd, localOffset, 30);
      if (local.readUInt32LE(0) !== LOCAL_HEADER) return null;
      const start = localOffset + 30 + local.readUInt16LE(26) + local.readUInt16LE(28);
      const read = readAt(fd, start, compressed);
      const data = new Uint8Array(read.buffer, read.byteOffset, read.byteLength);
      let bytes: Uint8Array;
      if (method === STORED) bytes = data;
      else if (method === DEFLATED) {
        // One output chunk a byte longer than the entry: zlib neither joins
        // chunks nor, on filling one exactly, opens another as long
        const inflated = zlib.inflateRawSync(data, {
          chunkSize: Math.max(64, uncompressed + 1),
          maxOutputLength: uncompressed || 1,
        });
        bytes = new Uint8Array(inflated.buffer, inflated.byteOffset, inflated.byteLength);
      } else return null;
      if (!crc32 || bytes.length !== uncompressed || crc32(bytes) !== crc) return null;
      // The bytes as an ArrayBuffer of their own: inflate's chunk cut to length
      // in place, or a copy. A stored entry's bytes may sit in Node's shared
      // Buffer pool (a small read), which must never be cut or handed out.
      const store = bytes.buffer as ArrayBuffer;
      if (store.byteLength === bytes.byteLength) return store;
      if (method === STORED || bytes.byteOffset !== 0)
        return store.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
      return (store as ArrayBuffer & { transfer(length: number): ArrayBuffer }).transfer(bytes.byteLength);
    }
    return null;
  } catch {
    return null;
  } finally {
    if (fd !== null) fs.closeSync(fd);
  }
}
