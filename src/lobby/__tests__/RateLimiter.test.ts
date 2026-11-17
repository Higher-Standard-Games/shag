import { describe, expect, it } from "vitest";
import { RateLimiter } from "../RateLimiter";

describe("RateLimiter", () => {
  it("allows the limit in a window, then again once it has passed", () => {
    let now = 1_000;
    const limiter = new RateLimiter(2, 100, () => now);
    expect(limiter.tryRecord("a")).toBe(true);
    expect(limiter.tryRecord("a")).toBe(true);
    expect(limiter.tryRecord("a")).toBe(false);
    expect(limiter.tryRecord("b")).toBe(true);
    now += 101;
    expect(limiter.tryRecord("a")).toBe(true);
  });

  it("drops keys whose events have all expired, without being asked about them", () => {
    let now = 1_000;
    const limiter = new RateLimiter(5, 100, () => now);
    for (let i = 0; i < 50; i++) limiter.record(`address ${i}`);
    expect(limiter.size).toBe(50);
    now += 101;
    limiter.record("newcomer");
    expect(limiter.size).toBe(1);
  });
});
