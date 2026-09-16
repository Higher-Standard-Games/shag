/**
 * ConnectionWatchdog: a connection that stays open while nothing arrives must be
 * noticed, and a gap the client caused itself must not be mistaken for one.
 */

import { describe, expect, it } from "vitest";
import { ConnectionWatchdog } from "../network/client/ConnectionWatchdog";

describe("ConnectionWatchdog", () => {
  it("warns once a couple of seconds pass without data, then tells the player once", () => {
    const watchdog = new ConnectionWatchdog(2000, 8000);
    watchdog.start(0);

    expect(watchdog.check(1999)).toBeNull();
    expect(watchdog.check(2000)).toBe("warn");
    expect(watchdog.check(5000)).toBeNull();
    expect(watchdog.check(8000)).toBe("notice");
    expect(watchdog.check(20000)).toBeNull();
  });

  it("reports how long a stall lasted when data arrives again", () => {
    const watchdog = new ConnectionWatchdog(2000, 8000);
    watchdog.start(0);
    watchdog.check(3000);

    expect(watchdog.dataArrived(3500)).toBe(3500);
    expect(watchdog.check(4000)).toBeNull();
  });

  it("says nothing when data arrives before any stall was reported", () => {
    const watchdog = new ConnectionWatchdog(2000, 8000);
    watchdog.start(0);

    expect(watchdog.dataArrived(1500)).toBeNull();
    expect(watchdog.check(3000)).toBeNull();
    expect(watchdog.check(3500)).toBe("warn");
  });

  it("does not count a gap while the client was not running", () => {
    const watchdog = new ConnectionWatchdog(2000, 8000);
    watchdog.start(0);

    // A map build blocked the main thread for eleven seconds.
    watchdog.skipGap(11000);

    expect(watchdog.check(12000)).toBeNull();
    expect(watchdog.check(13000)).toBe("warn");
  });

  it("keeps a stall reported while running when the client then stops running", () => {
    const watchdog = new ConnectionWatchdog(2000, 8000);
    watchdog.start(0);
    expect(watchdog.check(2500)).toBe("warn");

    watchdog.skipGap(6000);

    expect(watchdog.check(8000)).toBe("notice");
  });

  it("reports nothing once stopped", () => {
    const watchdog = new ConnectionWatchdog(2000, 8000);
    watchdog.start(0);
    watchdog.stop();

    expect(watchdog.check(60000)).toBeNull();
    expect(watchdog.dataArrived(60000)).toBeNull();
    expect(watchdog.silentFor(60000)).toBe(0);
  });
});
