import { describe, expect, it } from "vitest";
import { MessageType } from "../network/protocol/BinaryProtocol";
import { MessageCodec } from "../network/protocol/MessageCodec";

describe("ClientPrefs message", () => {
  it("round-trips the auto-switch preference", () => {
    expect(MessageCodec.decodeClientPrefs(MessageCodec.encodeClientPrefs({ autoSwitch: false }))).toEqual({
      autoSwitch: false,
    });
    expect(MessageCodec.decodeClientPrefs(MessageCodec.encodeClientPrefs({ autoSwitch: true }))).toEqual({
      autoSwitch: true,
    });
  });

  it("reads a message without flags as the defaults", () => {
    expect(MessageCodec.decodeClientPrefs(new Uint8Array([MessageType.ClientPrefs]))).toEqual({ autoSwitch: true });
  });
});
