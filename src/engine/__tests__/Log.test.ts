/**
 * log façade contract (QA-15 / QA-WO10) — the rate-limited warn must fire
 * once per tag per window (hot paths stay visible without spamming), and
 * plain warns must always fire.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { log } from "../core/Log";

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("log.warnRateLimited", () => {
  it("fires once per tag inside the window, again after it", () => {
    vi.setSystemTime(1_000_000);
    log.warnRateLimited("qa-test-a", "first");
    log.warnRateLimited("qa-test-a", "suppressed");
    expect(console.warn).toHaveBeenCalledTimes(1);

    vi.setSystemTime(1_000_000 + 5001);
    log.warnRateLimited("qa-test-a", "second window");
    expect(console.warn).toHaveBeenCalledTimes(2);
  });

  it("tracks tags independently", () => {
    vi.setSystemTime(2_000_000);
    log.warnRateLimited("qa-test-b", "b");
    log.warnRateLimited("qa-test-c", "c");
    expect(console.warn).toHaveBeenCalledTimes(2);
  });
});

describe("log.errorRateLimited", () => {
  it("fires once per tag inside the window, again after it", () => {
    vi.setSystemTime(3_000_000);
    log.errorRateLimited("qa-test-e", "first");
    log.errorRateLimited("qa-test-e", "suppressed");
    expect(console.error).toHaveBeenCalledTimes(1);

    vi.setSystemTime(3_000_000 + 5001);
    log.errorRateLimited("qa-test-e", "second window");
    expect(console.error).toHaveBeenCalledTimes(2);
  });

  it("is not suppressed by a warn on the same tag", () => {
    vi.setSystemTime(4_000_000);
    log.warnRateLimited("qa-test-f", "warn");
    log.errorRateLimited("qa-test-f", "error");
    expect(console.warn).toHaveBeenCalledTimes(1);
    expect(console.error).toHaveBeenCalledTimes(1);
  });
});

describe("log.warn", () => {
  it("always fires and prefixes the tag", () => {
    log.warn("qa-test-d", "x");
    log.warn("qa-test-d", "y");
    expect(console.warn).toHaveBeenCalledTimes(2);
    expect(console.warn).toHaveBeenLastCalledWith("[qa-test-d]", "y");
  });
});
