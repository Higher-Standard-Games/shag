/**
 * Pickup static-registry tests
 *
 * Targets the static server-deactivation API on the engine Pickup class:
 *   - allPickups / pickupById registries
 *   - deactivateById (O(1) id lookup + fallback)
 *   - deactivateByPosition (XZ proximity + weapon-id prefix variants)
 *   - pendingDeactivations queue (for race where deactivate-event arrives
 *     before client Pickup constructs)
 *
 * Constructing a real Pickup requires a Babylon Scene + async model loading,
 * which we can't spin up in vitest. Instead we inject fake-Pickup-shaped
 * objects into the static registries via the `as any` escape hatch, the
 * same pattern used by BuildableSystem.test.ts to reset its singleton.
 *
 * This locks the deactivation contract before the planned Pickup → engine
 * Pickup + FPSPickup Option-B split (see docs/research/0.9.13-QA-improvements.md
 * §10 Q5a/Q5b/Q5c/Q5d). Once that lands, the registry moves to FPSPickup and
 * these tests should follow it.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { FPSPickup as Pickup } from "../../games/fps/world/FPSPickup";

interface FakePickup {
  isActive: boolean;
  options: { value?: string | number; id: string; pickupId?: number };
  position: { x: number; y: number; z: number };
  deactivateFromServer: ReturnType<typeof vi.fn>;
}

function makeFakePickup(opts: {
  id: string;
  value?: string;
  pickupId?: number;
  x?: number;
  y?: number;
  z?: number;
}): FakePickup {
  return {
    isActive: true,
    options: { id: opts.id, value: opts.value, pickupId: opts.pickupId },
    position: { x: opts.x ?? 0, y: opts.y ?? 0, z: opts.z ?? 0 },
    deactivateFromServer: vi.fn(function (this: FakePickup) {
      this.isActive = false;
    }),
  };
}

function resetRegistry() {
  // biome-ignore lint/suspicious/noExplicitAny: tests reach into private statics intentionally — see BuildableSystem.test.ts for the same pattern
  const P = Pickup as any;
  P.allPickups = [];
  P.pickupById = new Map();
  P.pendingDeactivations = [];
  P.nearbyWeaponPickup = null;
}

function injectPickup(p: FakePickup) {
  // biome-ignore lint/suspicious/noExplicitAny: tests reach into private statics intentionally
  const P = Pickup as any;
  P.allPickups.push(p);
  if (p.options.pickupId !== undefined) {
    P.pickupById.set(p.options.pickupId, p);
  }
}

describe("Pickup — server-driven deactivation registry", () => {
  beforeEach(() => {
    resetRegistry();
    vi.useFakeTimers();
  });

  describe("deactivateById (O(1) lookup)", () => {
    it("deactivates the pickup matching the registered pickupId", () => {
      const p = makeFakePickup({ id: "weapon_riotgun", value: "riotgun", pickupId: 42, x: 100, z: 100 });
      injectPickup(p);

      Pickup.deactivateById(42, "riotgun", 100, 0, 100);

      expect(p.deactivateFromServer).toHaveBeenCalledOnce();
      expect(p.isActive).toBe(false);
    });

    it("does NOT call deactivateFromServer twice if the pickup is already inactive", () => {
      const p = makeFakePickup({ id: "weapon_riotgun", value: "riotgun", pickupId: 7, x: 0, z: 0 });
      p.isActive = false;
      injectPickup(p);

      Pickup.deactivateById(7, "riotgun", 0, 0, 0);

      expect(p.deactivateFromServer).not.toHaveBeenCalled();
    });

    it("falls back to position match when pickupId is not registered", () => {
      const p = makeFakePickup({ id: "weapon_rocket", value: "rocket", x: 50, z: 50 });
      injectPickup(p); // No pickupId registered

      Pickup.deactivateById(999, "rocket", 50, 0, 50);

      // The id-lookup misses, the position-match path picks it up
      expect(p.deactivateFromServer).toHaveBeenCalledOnce();
    });
  });

  describe("deactivateByPosition — weapon-id prefix variants", () => {
    it.each<[string, string]>([
      ["weapon_riotgun", "riotgun"], // pickup prefixed, server bare
      ["riotgun", "riotgun"], // both bare
      ["weapon_riotgun", "weapon_riotgun"], // both prefixed
    ])("matches when pickup.value=%s and server weaponId=%s", (pickupValue, serverWeaponId) => {
      const p = makeFakePickup({ id: pickupValue, value: pickupValue, x: 0, z: 0 });
      injectPickup(p);

      Pickup.deactivateByPosition(serverWeaponId, 0, 0, 0);

      expect(p.deactivateFromServer).toHaveBeenCalledOnce();
    });

    it("known asymmetry: pickup.value=bare + server=prefixed does NOT match (server sends bare in practice)", () => {
      const p = makeFakePickup({ id: "riotgun", value: "riotgun", x: 0, z: 0 });
      injectPickup(p);

      Pickup.deactivateByPosition("weapon_riotgun", 0, 0, 0);

      // Documents current behavior: matching is one-directional. The server-side
      // contract is "always send bare weapon id". If the server ever sends a
      // `weapon_`-prefixed id, this asymmetry is exposed.
      expect(p.deactivateFromServer).not.toHaveBeenCalled();
    });

    it("does NOT match when weapon id is different", () => {
      const p = makeFakePickup({ id: "weapon_rocket", value: "rocket", x: 0, z: 0 });
      injectPickup(p);

      Pickup.deactivateByPosition("plasma", 0, 0, 0);

      expect(p.deactivateFromServer).not.toHaveBeenCalled();
    });

    it("matches the CLOSEST candidate when multiple pickups share the same weaponId", () => {
      const near = makeFakePickup({ id: "weapon_rocket", value: "rocket", x: 10, z: 10 });
      const far = makeFakePickup({ id: "weapon_rocket", value: "rocket", x: 150, z: 150 });
      injectPickup(near);
      injectPickup(far);

      // Server says deactivate the rocket at (5, _, 5)
      Pickup.deactivateByPosition("rocket", 5, 0, 5);

      expect(near.deactivateFromServer).toHaveBeenCalledOnce();
      expect(far.deactivateFromServer).not.toHaveBeenCalled();
    });

    it("uses XZ-only distance (ignores Y) since dropToGround changes server-vs-client Y", () => {
      const p = makeFakePickup({ id: "weapon_rocket", value: "rocket", x: 0, y: 500, z: 0 });
      injectPickup(p);

      // Server sends Y=0 (raw entity y), client placed it at y=500 after dropToGround
      Pickup.deactivateByPosition("rocket", 0, 0, 0);

      expect(p.deactivateFromServer).toHaveBeenCalledOnce();
    });

    it("does NOT match when XZ distance exceeds the 200-unit tolerance", () => {
      const p = makeFakePickup({ id: "weapon_rocket", value: "rocket", x: 0, z: 0 });
      injectPickup(p);

      Pickup.deactivateByPosition("rocket", 500, 0, 500);

      expect(p.deactivateFromServer).not.toHaveBeenCalled();
    });

    it("skips inactive pickups even when weapon and position match", () => {
      const p = makeFakePickup({ id: "weapon_rocket", value: "rocket", x: 0, z: 0 });
      p.isActive = false;
      injectPickup(p);

      Pickup.deactivateByPosition("rocket", 0, 0, 0);

      expect(p.deactivateFromServer).not.toHaveBeenCalled();
    });
  });

  describe("pendingDeactivations queue (race-window safety)", () => {
    it("queues a deactivation when no matching pickup exists yet", () => {
      Pickup.deactivateByPosition("rocket", 0, 0, 0);

      // biome-ignore lint/suspicious/noExplicitAny: inspecting private static
      const queued = (Pickup as any).pendingDeactivations as Array<{ weaponId: string }>;
      expect(queued).toHaveLength(1);
      expect(queued[0]?.weaponId).toBe("rocket");
    });

    it("prunes queue entries older than 10 seconds on next deactivate call", () => {
      // biome-ignore lint/suspicious/noExplicitAny: inspecting/seeding private static
      const P = Pickup as any;
      P.pendingDeactivations = [
        { weaponId: "old", x: 0, y: 0, z: 0, timestamp: Date.now() - 11_000 },
      ];

      // Trigger a fresh deactivate-by-position (which itself queues + prunes)
      Pickup.deactivateByPosition("fresh", 100, 0, 100);

      const queued = P.pendingDeactivations as Array<{ weaponId: string }>;
      // Old entry pruned; fresh one queued (no matching pickup yet)
      expect(queued.find((q) => q.weaponId === "old")).toBeUndefined();
      expect(queued.find((q) => q.weaponId === "fresh")).toBeDefined();
    });
  });

  describe("triggerUseAction", () => {
    it("clears nearbyWeaponPickup when one is set", () => {
      // biome-ignore lint/suspicious/noExplicitAny: seeding private static
      (Pickup as any).nearbyWeaponPickup = makeFakePickup({ id: "weapon_rocket", value: "rocket" });

      Pickup.triggerUseAction();

      // biome-ignore lint/suspicious/noExplicitAny: inspecting private static
      expect((Pickup as any).nearbyWeaponPickup).toBeNull();
    });

    it("is a no-op when no nearbyWeaponPickup is set", () => {
      // Nothing set — should not throw
      expect(() => Pickup.triggerUseAction()).not.toThrow();
    });
  });
});
