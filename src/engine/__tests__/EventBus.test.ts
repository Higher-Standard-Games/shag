import { beforeEach, describe, expect, it, vi } from "vitest";
import { EventBus } from "../core/EventBus";

describe("EventBus", () => {
  beforeEach(() => {
    // Clear all listeners before each test
    EventBus.clear();
  });

  describe("on/emit", () => {
    it("should call listener when event is emitted", () => {
      const callback = vi.fn();
      EventBus.on("plant:water", callback);

      EventBus.emit("plant:water", { plantId: "test-plant" });

      expect(callback).toHaveBeenCalledTimes(1);
      expect(callback).toHaveBeenCalledWith({ plantId: "test-plant" });
    });

    it("should call multiple listeners for same event", () => {
      const callback1 = vi.fn();
      const callback2 = vi.fn();

      EventBus.on("plant:water", callback1);
      EventBus.on("plant:water", callback2);

      EventBus.emit("plant:water", { plantId: "test" });

      expect(callback1).toHaveBeenCalledTimes(1);
      expect(callback2).toHaveBeenCalledTimes(1);
    });

    it("should not call listeners for different events", () => {
      const waterCallback = vi.fn();
      const harvestCallback = vi.fn();

      EventBus.on("plant:water", waterCallback);
      EventBus.on("plant:harvest", harvestCallback);

      EventBus.emit("plant:water", { plantId: "test" });

      expect(waterCallback).toHaveBeenCalledTimes(1);
      expect(harvestCallback).not.toHaveBeenCalled();
    });
  });

  describe("off", () => {
    it("should remove listener", () => {
      const callback = vi.fn();
      EventBus.on("plant:water", callback);
      EventBus.off("plant:water", callback);

      EventBus.emit("plant:water", { plantId: "test" });

      expect(callback).not.toHaveBeenCalled();
    });

    it("should only remove specified listener", () => {
      const callback1 = vi.fn();
      const callback2 = vi.fn();

      EventBus.on("plant:water", callback1);
      EventBus.on("plant:water", callback2);
      EventBus.off("plant:water", callback1);

      EventBus.emit("plant:water", { plantId: "test" });

      expect(callback1).not.toHaveBeenCalled();
      expect(callback2).toHaveBeenCalledTimes(1);
    });
  });

  describe("once", () => {
    it("should only call listener once", () => {
      const callback = vi.fn();
      EventBus.once("plant:water", callback);

      EventBus.emit("plant:water", { plantId: "test1" });
      EventBus.emit("plant:water", { plantId: "test2" });

      expect(callback).toHaveBeenCalledTimes(1);
      expect(callback).toHaveBeenCalledWith({ plantId: "test1" });
    });
  });

  describe("clear", () => {
    it("should remove all listeners", () => {
      const callback1 = vi.fn();
      const callback2 = vi.fn();

      EventBus.on("plant:water", callback1);
      EventBus.on("plant:harvest", callback2);
      EventBus.clear();

      EventBus.emit("plant:water", { plantId: "test" });
      EventBus.emit("plant:harvest", { plantId: "test", quality: 100 });

      expect(callback1).not.toHaveBeenCalled();
      expect(callback2).not.toHaveBeenCalled();
    });
  });
});
