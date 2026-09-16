/**
 * A delta snapshot whose baseline the receiver no longer holds is dropped, and
 * the one-tick events it carried are lost with it. That must be visible.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { GameState } from "../../shared/net/GameState";
import { SnapshotReceiver } from "../network/client/SnapshotReceiver";
import { MessageCodec } from "../network/protocol/MessageCodec";

afterEach(() => vi.restoreAllMocks());

function state(tick: number): GameState {
  const value = new GameState();
  value.tick = tick;
  return value;
}

describe("SnapshotReceiver", () => {
  it("warns when it drops a snapshot whose baseline is missing", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    expect(new SnapshotReceiver().receive(MessageCodec.encodeSnapshot(state(3), state(1)))).toBeNull();

    expect(warn).toHaveBeenCalledWith("[SnapshotReceiver]", expect.stringContaining("dropped snapshot 3: baseline 1"));
  });

  it("does not warn for snapshots it accepts", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const receiver = new SnapshotReceiver();

    receiver.receive(MessageCodec.encodeSnapshot(state(1)));
    receiver.receive(MessageCodec.encodeSnapshot(state(2), state(1)));

    expect(warn).not.toHaveBeenCalled();
  });
});
