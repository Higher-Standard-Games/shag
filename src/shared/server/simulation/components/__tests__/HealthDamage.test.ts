import { describe, expect, it } from "vitest";
import { applyDamage, createHealth } from "../HealthComponent";

describe("applyDamage", () => {
  it("lets armor soak whole points, rounded up, so health and armor stay whole", () => {
    const health = { ...createHealth(), health: 100, armor: 100 };
    applyDamage(health, 7);
    // 7 × 0.66 = 4.62: armor takes 5, health 2
    expect(health.armor).toBe(95);
    expect(health.health).toBe(98);
  });

  it("kills a player left with less than one point", () => {
    const health = { ...createHealth(), health: 1.4, armor: 0 };
    applyDamage(health, 1);
    expect(health.dead).toBe(true);
    expect(health.health).toBe(0);
  });
});
