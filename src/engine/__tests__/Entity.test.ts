/**
 * Entity — Component-based entity system tests
 *
 * Verifies component CRUD, deep clone isolation, serialization,
 * and entity type handling.
 */

import { describe, expect, it } from "vitest";
import type { IComponent, StateEncoder } from "../network/core/Component";
import { Entity, EntityType } from "../network/core/Entity";

// Simple test component
class TestComponent implements IComponent {
  value: number = 0;

  serialize(encoder: StateEncoder): void {
    encoder.writeFloat32(this.value);
  }

  deserialize(decoder: any): void {
    this.value = decoder.readFloat32();
  }

  clone(): TestComponent {
    const c = new TestComponent();
    c.value = this.value;
    return c;
  }
}

describe("Entity", () => {
  describe("Constructor", () => {
    it("should create entity with given ID", () => {
      const entity = new Entity("test-1");
      expect(entity.id).toBe("test-1");
    });

    it("should default to Player type", () => {
      const entity = new Entity("test-1");
      expect(entity.type).toBe(EntityType.Player);
    });

    it("should accept custom entity type", () => {
      const entity = new Entity("proj-1", EntityType.Projectile);
      expect(entity.type).toBe(EntityType.Projectile);
    });
  });

  describe("Component CRUD", () => {
    it("should add and get a component", () => {
      const entity = new Entity("e1");
      const comp = new TestComponent();
      comp.value = 42;

      entity.addComponent("test", comp);
      const retrieved = entity.getComponent<TestComponent>("test");

      expect(retrieved).not.toBeUndefined();
      expect(retrieved!.value).toBe(42);
    });

    it("should return undefined for missing component", () => {
      const entity = new Entity("e1");
      expect(entity.getComponent("nonexistent")).toBeUndefined();
    });

    it("should report hasComponent correctly", () => {
      const entity = new Entity("e1");
      entity.addComponent("test", new TestComponent());

      expect(entity.hasComponent("test")).toBe(true);
      expect(entity.hasComponent("other")).toBe(false);
    });

    it("should remove a component", () => {
      const entity = new Entity("e1");
      entity.addComponent("test", new TestComponent());

      expect(entity.removeComponent("test")).toBe(true);
      expect(entity.hasComponent("test")).toBe(false);
    });

    it("should return false when removing nonexistent component", () => {
      const entity = new Entity("e1");
      expect(entity.removeComponent("nonexistent")).toBe(false);
    });

    it("should list component names", () => {
      const entity = new Entity("e1");
      entity.addComponent("position", new TestComponent());
      entity.addComponent("velocity", new TestComponent());

      const names = entity.getComponentNames();
      expect(names).toContain("position");
      expect(names).toContain("velocity");
      expect(names.length).toBe(2);
    });
  });

  describe("Clone", () => {
    it("should create a deep copy with same ID and type", () => {
      const entity = new Entity("e1", EntityType.Projectile);
      entity.ownerId = "player-1";
      entity.addComponent("test", new TestComponent());

      const cloned = entity.clone();
      expect(cloned.id).toBe("e1");
      expect(cloned.type).toBe(EntityType.Projectile);
      expect(cloned.ownerId).toBe("player-1");
    });

    it("should deep copy components", () => {
      const entity = new Entity("e1");
      const comp = new TestComponent();
      comp.value = 42;
      entity.addComponent("test", comp);

      const cloned = entity.clone();
      const clonedComp = cloned.getComponent<TestComponent>("test");

      expect(clonedComp).not.toBeUndefined();
      expect(clonedComp!.value).toBe(42);
    });

    it("should isolate clone from original (mutation test)", () => {
      const entity = new Entity("e1");
      const comp = new TestComponent();
      comp.value = 42;
      entity.addComponent("test", comp);

      const cloned = entity.clone();

      // Mutate original
      comp.value = 999;

      // Clone should be unaffected
      const clonedComp = cloned.getComponent<TestComponent>("test");
      expect(clonedComp!.value).toBe(42);
    });
  });

  describe("EntityType enum", () => {
    it("should have all expected types", () => {
      expect(EntityType.Player).toBe("player");
      expect(EntityType.Projectile).toBe("projectile");
      expect(EntityType.Item).toBe("item");
      expect(EntityType.Trigger).toBe("trigger");
      expect(EntityType.Effect).toBe("effect");
    });
  });
});
