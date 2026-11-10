import { describe, expect, it } from "vitest";
import { MessageCodec, MessageType } from "../network/protocol/MessageCodec";

describe("match pause messages", () => {
  it("round-trips the pause state, a paused chat line and a call", () => {
    for (const notice of [
      { state: "timeout", msLeft: 119_500, caller: "Alice", forDrop: false },
      { state: "timein", msLeft: 3000, caller: "Bob", forDrop: true },
      { state: "running", msLeft: 0, caller: "", forDrop: false },
    ] as const) {
      const data = MessageCodec.encodePause(notice);
      expect(data[0]).toBe(MessageType.Pause);
      expect(MessageCodec.decodePause(data)).toEqual(notice);
    }
    const chat = { senderId: "player_2", senderName: "Bob", team: "soba", text: "brb" };
    expect(MessageCodec.decodePausedChat(MessageCodec.encodePausedChat(chat))).toEqual(chat);
    expect(MessageCodec.decodeCallPause(MessageCodec.encodeCallPause(true))).toEqual({ timeout: true });
    expect(MessageCodec.decodeCallPause(MessageCodec.encodeCallPause(false))).toEqual({ timeout: false });
  });

  it("refuses a pause state it does not know", () => {
    const data = MessageCodec.encodePause({ state: "timeout", msLeft: 0, caller: "", forDrop: false });
    data[1] = 7;
    expect(() => MessageCodec.decodePause(data)).toThrow("Unknown pause state");
  });
});
