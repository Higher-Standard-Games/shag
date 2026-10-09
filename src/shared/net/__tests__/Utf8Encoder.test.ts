import { describe, expect, it } from "vitest";
import { BinaryDecoder, BinaryEncoder } from "../BinaryProtocol";

describe("writeString bytes", () => {
  it("matches TextEncoder for ascii, multibyte, astral, lone surrogates, empty", () => {
    const te = new TextEncoder();
    for (const s of ["", "abc", "wàsh-ïki", "日本語", "😀x", "\ud800", "a\udc00b", "x".repeat(20000)]) {
      const e = new BinaryEncoder(8);
      e.writeString(s);
      e.writeUint8(7);
      const b = te.encode(s);
      const out = e.getData();
      expect(out.length).toBe(2 + b.length + 1);
      expect(out[0] | (out[1] << 8)).toBe(b.length & 0xffff);
      expect([...out.slice(2, 2 + b.length)]).toEqual([...b]);
      expect(out[out.length - 1]).toBe(7);
      if (s.length < 5000) expect(new BinaryDecoder(out).readString()).toBe(new TextDecoder().decode(b));
    }
  });

  // Some snapshot events put numeric entity ids where a string is declared (item_pickup,
  // weapon_drop). TextEncoder.encode coerced them, so writeString must too, byte for byte.
  it.each([50001, 0, undefined, null, true])("encodes %s the way TextEncoder.encode did", (value) => {
    const e = new BinaryEncoder(8);
    e.writeString(value as unknown as string);
    const b = new TextEncoder().encode(value as unknown as string);
    expect([...e.getData()]).toEqual([b.length & 0xff, b.length >> 8, ...b]);
  });
});
