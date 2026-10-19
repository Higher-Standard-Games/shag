import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Scene } from "@babylonjs/core/scene";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { EventBus } from "../../../core/EventBus";
import { LOADING_EVENTS } from "../../../core/LoadingEvents";
import { BspLoader } from "../../bsp/BspLoader";
import { PK3Index } from "../../pk3/PK3Index";
import { PK3Loader } from "../../pk3/PK3Loader";
import { MapLoader, type MapLoadResult } from "../MapLoader";
import { waitForMapReady, waitForMapVisibility } from "../MapLoadWait";

class DocumentProbe extends EventTarget {
  hidden = false;
  readonly listeners = new Set<EventListenerOrEventListenerObject>();
  override addEventListener(type: string, listener: EventListenerOrEventListenerObject | null) {
    if (type === "visibilitychange" && listener) this.listeners.add(listener);
    super.addEventListener(type, listener);
  }
  override removeEventListener(type: string, listener: EventListenerOrEventListenerObject | null) {
    if (type === "visibilitychange" && listener) this.listeners.delete(listener);
    super.removeEventListener(type, listener);
  }
}
interface Internals {
  isLoadingMap: boolean;
  readinessCheck: (() => void) | null;
  buildBspMap(
    name: string,
    pk3: string,
    scene: Scene,
    progress: (phase: string) => void,
    signal: AbortSignal,
  ): Promise<MapLoadResult>;
}
let doc: DocumentProbe;
let scene: Scene;
let loader: MapLoader;
let internals: Internals;
const result = (name: string): MapLoadResult => ({ success: true, mapName: name, mapType: "bsp" });
beforeEach(() => {
  doc = new DocumentProbe();
  vi.stubGlobal("document", doc);
  scene = new Scene(new NullEngine());
  loader = MapLoader.getInstance();
  internals = loader as unknown as Internals;
  vi.spyOn(PK3Index.getInstance(), "findMap").mockReturnValue("probe.pk3");
  vi.spyOn(PK3Index.getInstance(), "getPK3Path").mockReturnValue("data/probe.pk3");
  vi.spyOn(PK3Loader.getInstance(), "ensurePK3FromUrl").mockResolvedValue();
});
afterEach(async () => {
  await loader.disposeCurrentMap();
  const engine = scene.getEngine();
  scene.dispose();
  engine.dispose();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

it("cleans listeners and busy state after repeated archive failures and permits retry", async () => {
  vi.spyOn(PK3Loader.getInstance(), "ensurePK3FromUrl").mockRejectedValue(new Error("archive failed"));
  for (let i = 0; i < 3; i++) {
    expect((await loader.loadMap("probe", scene)).success).toBe(false);
    expect(doc.listeners.size).toBe(0);
    expect(internals.isLoadingMap).toBe(false);
  }
  vi.spyOn(internals, "buildBspMap").mockImplementation(async (name) => result(name));
  expect((await loader.loadMap("retry", scene)).success).toBe(true);
});

it("releases listeners for a null BSP and emits a single completion on success", async () => {
  vi.spyOn(BspLoader, "loadFromPK3").mockResolvedValue(null);
  expect((await loader.loadMap("null", scene)).success).toBe(false);
  expect(doc.listeners.size).toBe(0);
  const complete = vi.fn();
  const off = EventBus.on(LOADING_EVENTS.COMPLETE, complete);
  try {
    vi.spyOn(internals, "buildBspMap").mockImplementation(async (name) => {
      expect(doc.listeners.size).toBe(1);
      return result(name);
    });
    await loader.loadMap("success", scene);
    expect(complete).toHaveBeenCalledOnce();
    expect(doc.listeners.size).toBe(0);
  } finally {
    off();
  }
});

it("releases temporary state when geometry/material preparation throws", async () => {
  vi.spyOn(internals, "buildBspMap").mockRejectedValue(new Error("material preparation failed"));
  expect((await loader.loadMap("broken", scene)).error).toBe("material preparation failed");
  expect(doc.listeners.size).toBe(0);
  expect(internals.isLoadingMap).toBe(false);
});

it("releases a pending loading-screen readiness listener when clearing the map", async () => {
  const before = EventBus.listenerCount(LOADING_EVENTS.HIDDEN);
  internals.readinessCheck = EventBus.once(LOADING_EVENTS.HIDDEN, () => {});
  expect(EventBus.listenerCount(LOADING_EVENTS.HIDDEN)).toBe(before + 1);
  await loader.disposeCurrentMap();
  expect(EventBus.listenerCount(LOADING_EVENTS.HIDDEN)).toBe(before);
  expect(internals.readinessCheck).toBeNull();
});

it("serializes a newer request behind cancellation of a late older load", async () => {
  let finish!: () => void;
  let entered!: () => void;
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const order: string[] = [];
  vi.spyOn(internals, "buildBspMap").mockImplementation(async (name, _pk3, _scene, progress) => {
    order.push(name);
    if (name === "old") {
      entered();
      await new Promise<void>((resolve) => {
        finish = resolve;
      });
    }
    progress("Complete");
    return result(name);
  });
  const old = loader.loadMap("old", scene);
  await started;
  const next = loader.loadMap("new", scene);
  expect(order).toEqual(["old"]);
  expect(doc.listeners.size).toBe(0);
  finish();
  expect((await old).success).toBe(false);
  expect((await next).success).toBe(true);
  expect(order).toEqual(["old", "new"]);
  expect(internals.isLoadingMap).toBe(false);
});

it("cancels a hidden-tab wait when leaving the map", async () => {
  doc.hidden = true;
  let entered!: () => void;
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  vi.spyOn(internals, "buildBspMap").mockImplementation(async (name, _pk3, _scene, _progress, signal) => {
    entered();
    await waitForMapVisibility(signal);
    return result(name);
  });
  const pending = loader.loadMap("hidden", scene);
  await started;
  expect(doc.listeners.size).toBe(2);
  await loader.disposeCurrentMap();
  expect((await pending).success).toBe(false);
  expect(doc.listeners.size).toBe(0);
});

it("leaves a map without waiting for an archive shared by other consumers", async () => {
  let finish!: () => void;
  let entered!: () => void;
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  vi.spyOn(PK3Loader.getInstance(), "ensurePK3FromUrl").mockImplementation(() => {
    entered();
    return new Promise<void>((resolve) => {
      finish = resolve;
    });
  });
  const pending = loader.loadMap("downloading", scene);
  await started;
  await loader.disposeCurrentMap();
  expect((await pending).success).toBe(false);
  expect(doc.listeners.size).toBe(0);
  finish();
});

it("clears readiness timers after success, rejection, timeout and cancellation", async () => {
  vi.useFakeTimers();
  const controller = new AbortController();
  expect(await waitForMapReady(Promise.resolve(), controller.signal, 15000)).toBe(true);
  await expect(waitForMapReady(Promise.reject(new Error("GPU")), controller.signal, 15000)).rejects.toThrow("GPU");
  const timeout = waitForMapReady(new Promise(() => {}), controller.signal, 15);
  await vi.advanceTimersByTimeAsync(15);
  expect(await timeout).toBe(false);
  const pending = waitForMapReady(new Promise(() => {}), controller.signal, 15000);
  const rejected = expect(pending).rejects.toThrow("cancelled");
  controller.abort(new Error("cancelled"));
  await rejected;
  expect(vi.getTimerCount()).toBe(0);
});
