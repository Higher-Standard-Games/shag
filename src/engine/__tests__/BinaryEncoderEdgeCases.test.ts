/**
 * BinaryEncoder/Decoder — Edge case tests
 *
 * Verifies buffer auto-growth, string encoding (unicode, empty, long),
 * data type roundtrips, reset/reuse, and decoder bounds checking.
 */

import { describe, expect, it } from "vitest";
import { BinaryEncoder, BinaryDecoder } from "../network/protocol/BinaryProtocol";

describe("BinaryEncoder", () => {
  describe("Buffer auto-growth", () => {
    it("should grow buffer when data exceeds initial size", () => {
      const encoder = new BinaryEncoder(8); // Tiny initial buffer

      // Write more than 8 bytes
      encoder.writeFloat32(1.0);  // 4 bytes
      encoder.writeFloat32(2.0);  // 4 bytes
      encoder.writeFloat32(3.0);  // 4 bytes — triggers growth

      const data = encoder.getData();
      expect(data.length).toBe(12);

      const decoder = new BinaryDecoder(data);
      expect(decoder.readFloat32()).toBeCloseTo(1.0);
      expect(decoder.readFloat32()).toBeCloseTo(2.0);
      expect(decoder.readFloat32()).toBeCloseTo(3.0);
    });

    it("should handle many sequential growths", () => {
      const encoder = new BinaryEncoder(4); // Very tiny

      for (let i = 0; i < 100; i++) {
        encoder.writeUint32(i);
      }

      const data = encoder.getData();
      expect(data.length).toBe(400); // 100 * 4 bytes

      const decoder = new BinaryDecoder(data);
      for (let i = 0; i < 100; i++) {
        expect(decoder.readUint32()).toBe(i);
      }
    });
  });

  describe("String encoding", () => {
    it("should roundtrip empty string", () => {
      const encoder = new BinaryEncoder(64);
      encoder.writeString("");
      const decoder = new BinaryDecoder(encoder.getData());
      expect(decoder.readString()).toBe("");
    });

    it("should roundtrip ASCII string", () => {
      const encoder = new BinaryEncoder(64);
      encoder.writeString("hello world");
      const decoder = new BinaryDecoder(encoder.getData());
      expect(decoder.readString()).toBe("hello world");
    });

    it("should roundtrip unicode string (UTF-8)", () => {
      const encoder = new BinaryEncoder(256);
      const str = "日本語テスト 🎮🔥";
      encoder.writeString(str);
      const decoder = new BinaryDecoder(encoder.getData());
      expect(decoder.readString()).toBe(str);
    });

    it("should roundtrip string with special characters", () => {
      const encoder = new BinaryEncoder(256);
      const str = "player\nwith\ttabs\"and'quotes\\backslash";
      encoder.writeString(str);
      const decoder = new BinaryDecoder(encoder.getData());
      expect(decoder.readString()).toBe(str);
    });

    it("should handle long strings", () => {
      const encoder = new BinaryEncoder(256);
      const longStr = "x".repeat(10000);
      encoder.writeString(longStr);

      const decoder = new BinaryDecoder(encoder.getData());
      expect(decoder.readString()).toBe(longStr);
    });
  });

  describe("Data type roundtrips", () => {
    it("should roundtrip uint8 (0-255)", () => {
      const encoder = new BinaryEncoder(4);
      encoder.writeUint8(0);
      encoder.writeUint8(127);
      encoder.writeUint8(255);

      const decoder = new BinaryDecoder(encoder.getData());
      expect(decoder.readUint8()).toBe(0);
      expect(decoder.readUint8()).toBe(127);
      expect(decoder.readUint8()).toBe(255);
    });

    it("should roundtrip int8 (-128 to 127)", () => {
      const encoder = new BinaryEncoder(4);
      encoder.writeInt8(-128);
      encoder.writeInt8(0);
      encoder.writeInt8(127);

      const decoder = new BinaryDecoder(encoder.getData());
      expect(decoder.readInt8()).toBe(-128);
      expect(decoder.readInt8()).toBe(0);
      expect(decoder.readInt8()).toBe(127);
    });

    it("should roundtrip uint16 (0-65535)", () => {
      const encoder = new BinaryEncoder(8);
      encoder.writeUint16(0);
      encoder.writeUint16(65535);

      const decoder = new BinaryDecoder(encoder.getData());
      expect(decoder.readUint16()).toBe(0);
      expect(decoder.readUint16()).toBe(65535);
    });

    it("should roundtrip int16 (-32768 to 32767)", () => {
      const encoder = new BinaryEncoder(8);
      encoder.writeInt16(-32768);
      encoder.writeInt16(32767);

      const decoder = new BinaryDecoder(encoder.getData());
      expect(decoder.readInt16()).toBe(-32768);
      expect(decoder.readInt16()).toBe(32767);
    });

    it("should roundtrip uint32 (0 to 4294967295)", () => {
      const encoder = new BinaryEncoder(16);
      encoder.writeUint32(0);
      encoder.writeUint32(4294967295);

      const decoder = new BinaryDecoder(encoder.getData());
      expect(decoder.readUint32()).toBe(0);
      expect(decoder.readUint32()).toBe(4294967295);
    });

    it("should roundtrip float32 with precision", () => {
      const encoder = new BinaryEncoder(32);
      encoder.writeFloat32(0);
      encoder.writeFloat32(-1.5);
      encoder.writeFloat32(3.14159);
      encoder.writeFloat32(1e10);
      encoder.writeFloat32(-1e-10);

      const decoder = new BinaryDecoder(encoder.getData());
      expect(decoder.readFloat32()).toBe(0);
      expect(decoder.readFloat32()).toBeCloseTo(-1.5);
      expect(decoder.readFloat32()).toBeCloseTo(3.14159, 4);
      expect(decoder.readFloat32()).toBeCloseTo(1e10, -5);
      expect(decoder.readFloat32()).toBeCloseTo(-1e-10, 15);
    });

    it("should roundtrip float64 with full precision", () => {
      const encoder = new BinaryEncoder(32);
      encoder.writeFloat64(Math.PI);
      encoder.writeFloat64(-Math.E);

      const decoder = new BinaryDecoder(encoder.getData());
      expect(decoder.readFloat64()).toBe(Math.PI);  // Exact equality for float64
      expect(decoder.readFloat64()).toBe(-Math.E);
    });

    it("should roundtrip boolean via writeBool/readBool", () => {
      const encoder = new BinaryEncoder(4);
      encoder.writeBool(true);
      encoder.writeBool(false);

      const decoder = new BinaryDecoder(encoder.getData());
      expect(decoder.readBool()).toBe(true);
      expect(decoder.readBool()).toBe(false);
    });
  });

  describe("Reset and reuse", () => {
    it("should produce independent data after reset", () => {
      const encoder = new BinaryEncoder(64);

      encoder.writeUint32(0xDEADBEEF);
      const data1 = encoder.getData();

      encoder.reset();
      encoder.writeUint32(0xCAFEBABE);
      const data2 = encoder.getData();

      // Data1 should still be valid (getData copies)
      const dec1 = new BinaryDecoder(data1);
      expect(dec1.readUint32()).toBe(0xDEADBEEF);

      const dec2 = new BinaryDecoder(data2);
      expect(dec2.readUint32()).toBe(0xCAFEBABE);
    });

    it("should reset offset to 0", () => {
      const encoder = new BinaryEncoder(64);
      encoder.writeUint32(1);
      expect(encoder.getOffset()).toBe(4);

      encoder.reset();
      expect(encoder.getOffset()).toBe(0);
    });
  });

  describe("Raw bytes", () => {
    it("should roundtrip raw byte arrays", () => {
      const encoder = new BinaryEncoder(64);
      const bytes = new Uint8Array([1, 2, 3, 4, 5]);
      encoder.writeBytes(bytes);

      const decoder = new BinaryDecoder(encoder.getData());
      const read = decoder.readBytes(5);
      expect(read[0]).toBe(1);
      expect(read[4]).toBe(5);
    });
  });
});

describe("BinaryDecoder", () => {
  describe("Bounds checking", () => {
    it("should throw on buffer underflow", () => {
      const data = new Uint8Array([0x01]); // Only 1 byte
      const decoder = new BinaryDecoder(data);

      decoder.readUint8(); // OK
      expect(() => decoder.readUint8()).toThrow("Buffer underflow");
    });

    it("should throw descriptive error with offset info", () => {
      const data = new Uint8Array([0x01, 0x02]);
      const decoder = new BinaryDecoder(data);

      decoder.readUint16(); // Consume both bytes
      expect(() => decoder.readUint32()).toThrow(/offset 2/);
    });
  });

  describe("hasMore / remaining", () => {
    it("should report remaining bytes correctly", () => {
      const encoder = new BinaryEncoder(16);
      encoder.writeUint8(1);
      encoder.writeUint16(2);

      const decoder = new BinaryDecoder(encoder.getData());
      expect(decoder.remaining()).toBe(3);
      expect(decoder.hasMore()).toBe(true);

      decoder.readUint8();
      expect(decoder.remaining()).toBe(2);

      decoder.readUint16();
      expect(decoder.remaining()).toBe(0);
      expect(decoder.hasMore()).toBe(false);
    });
  });

  describe("getOffset", () => {
    it("should track read position", () => {
      const encoder = new BinaryEncoder(16);
      encoder.writeUint32(1);
      encoder.writeUint8(2);

      const decoder = new BinaryDecoder(encoder.getData());
      expect(decoder.getOffset()).toBe(0);

      decoder.readUint32();
      expect(decoder.getOffset()).toBe(4);

      decoder.readUint8();
      expect(decoder.getOffset()).toBe(5);
    });
  });
});
