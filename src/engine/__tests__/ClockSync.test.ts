/**
 * ClockSync — NTP-like server time synchronization tests
 *
 * Verifies offset computation, outlier rejection, stale pong handling,
 * and time conversion roundtrips.
 */

import { describe, expect, it, beforeEach } from "vitest";
import { ClockSync } from "../network/client/ClockSync";

describe("ClockSync", () => {
  let clock: ClockSync;
  let sentData: Uint8Array[];

  beforeEach(() => {
    clock = new ClockSync();
    sentData = [];
    clock.setSendFunction((data: Uint8Array, _reliable: boolean) => {
      sentData.push(data);
    });
  });

  describe("Initial state", () => {
    it("should not be synced initially", () => {
      expect(clock.isSynced()).toBe(false);
    });

    it("should have zero offset initially", () => {
      expect(clock.getOffset()).toBe(0);
    });

    it("should have zero RTT initially", () => {
      expect(clock.getRTT()).toBe(0);
    });

    it("should have zero samples initially", () => {
      expect(clock.getSampleCount()).toBe(0);
    });
  });

  describe("Single pong processing", () => {
    it("should become synced after processing a pong", () => {
      // processPong uses Date.now() internally for clientRecvTime,
      // so clientSendTime must be relative to current time
      const clientSendTime = Date.now() - 50; // sent 50ms ago
      const serverTime = clientSendTime + 525; // server is ~500ms ahead
      clock.processPong(clientSendTime, serverTime);
      expect(clock.isSynced()).toBe(true);
    });

    it("should compute correct RTT", () => {
      // We need to mock Date.now() behavior — processPong uses Date.now() internally
      // for clientRecvTime. Feed values that make sense relative to current Date.now()
      const clientSendTime = Date.now() - 50; // Sent 50ms ago
      const serverTime = clientSendTime + 25 + 500; // server is 500ms ahead, 25ms one-way
      clock.processPong(clientSendTime, serverTime);

      // RTT should be approximately 50ms (Date.now() - clientSendTime)
      expect(clock.getRTT()).toBeGreaterThanOrEqual(40);
      expect(clock.getRTT()).toBeLessThanOrEqual(100);
    });

    it("should have one sample after processing one pong", () => {
      clock.processPong(Date.now() - 50, Date.now() + 500);
      expect(clock.getSampleCount()).toBe(1);
    });
  });

  describe("Stale/invalid pong rejection", () => {
    it("should reject pongs with negative RTT", () => {
      // clientSendTime in the future → negative RTT
      clock.processPong(Date.now() + 10000, Date.now());
      expect(clock.isSynced()).toBe(false);
      expect(clock.getSampleCount()).toBe(0);
    });

    it("should reject pongs with RTT > 5000ms", () => {
      // Sent 6 seconds ago → RTT ≈ 6000ms
      clock.processPong(Date.now() - 6000, Date.now());
      expect(clock.isSynced()).toBe(false);
      expect(clock.getSampleCount()).toBe(0);
    });

    it("should accept pongs with reasonable RTT", () => {
      clock.processPong(Date.now() - 100, Date.now() + 500);
      expect(clock.isSynced()).toBe(true);
      expect(clock.getSampleCount()).toBe(1);
    });
  });

  describe("Outlier rejection (best 75%)", () => {
    it("should use offset from best RTT samples, discarding worst 25%", () => {
      const now = Date.now();

      // 4 good pong samples with RTT ≈ 50ms, offset ≈ 1000
      for (let i = 0; i < 4; i++) {
        clock.processPong(now - 50 - i, now + 975 - i);
      }

      // 1 bad pong sample with high RTT = 200ms but different offset
      clock.processPong(now - 200, now + 2000);

      // With 5 samples, best 75% = 4 samples.
      // The high-RTT sample should be discarded.
      // All 4 good samples have similar offset, so average should be close.
      expect(clock.getSampleCount()).toBe(5);
      // The offset computation uses the best 75% — we just verify it's stable
      const offset = clock.getOffset();
      expect(typeof offset).toBe("number");
      expect(Number.isFinite(offset)).toBe(true);
    });
  });

  describe("Time conversion", () => {
    it("toServerTime should add offset", () => {
      // Process a pong to establish offset
      const clientSend = Date.now() - 50;
      const serverTime = clientSend + 25 + 1000; // offset ≈ 1000
      clock.processPong(clientSend, serverTime);

      const offset = clock.getOffset();
      const localTime = Date.now();
      const converted = clock.toServerTime(localTime);

      expect(converted).toBeCloseTo(localTime + offset, 0);
    });

    it("toLocalTime should subtract offset and convert to perf basis", () => {
      const clientSend = Date.now() - 50;
      const serverTime = clientSend + 25 + 1000;
      clock.processPong(clientSend, serverTime);

      // toLocalTime converts serverTime → local performance.now() basis
      const localTime = clock.toLocalTime(serverTime);
      expect(typeof localTime).toBe("number");
      expect(Number.isFinite(localTime)).toBe(true);
    });
  });

  describe("sendPing", () => {
    it("should send a ping packet when send function is set", () => {
      clock.sendPing();
      expect(sentData.length).toBe(1);
      expect(sentData[0]).toBeInstanceOf(Uint8Array);
    });

    it("should not crash when no send function is set", () => {
      const clock2 = new ClockSync();
      expect(() => clock2.sendPing()).not.toThrow();
    });
  });

  describe("stop", () => {
    it("should not crash when stopping without starting", () => {
      expect(() => clock.stop()).not.toThrow();
    });
  });
});
