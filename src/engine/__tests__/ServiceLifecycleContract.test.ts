/**
 * ServiceLocator dispose → reinitialize contract (QA-25 / QA-WO13).
 *
 * The audit's lifecycle gap: `ServiceLocator.dispose()` clears its own map and
 * calls each service's `dispose()`, but the registered engine services are
 * `X.getInstance()` singletons whose static instance field the locator cannot
 * clear — so a re-init reused the SAME, already-disposed object.
 *
 * Fix (WO13, reset-on-dispose): a stateful registration supplies
 * `reset: () => X.resetInstance()`; `dispose()` calls it after the service's own
 * `dispose()`, so a re-init gets a fresh instance. These tests lock that: a
 * registration WITHOUT reset still reuses the singleton (opt-in), and one WITH
 * reset yields a fresh, non-disposed instance. The last case guards that the
 * stateful engine services actually wire `reset`.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { SCENE_SERVICES } from "../core/EngineServices";
import { type Service, ServiceLocator } from "../core/ServiceLocator";

/** A singleton service in the same shape as the real engine services. */
class SingletonService implements Service {
  private static _instance: SingletonService | null = null;
  disposed = false;

  static getInstance(): SingletonService {
    if (!SingletonService._instance) SingletonService._instance = new SingletonService();
    return SingletonService._instance;
  }

  static resetInstance(): void {
    SingletonService._instance = null;
  }

  init(): void {}
  dispose(): void {
    this.disposed = true;
  }
}

function register(withReset: boolean): void {
  ServiceLocator.getInstance().register({
    name: "singleton",
    factory: () => SingletonService.getInstance(),
    reset: withReset ? () => SingletonService.resetInstance() : undefined,
    phase: "core",
  });
}

describe("ServiceLocator dispose → reinitialize contract (QA-WO13)", () => {
  beforeEach(() => {
    ServiceLocator.resetInstance();
    SingletonService.resetInstance();
  });

  it("without reset: dispose runs but the disposed singleton is reused on reinit", async () => {
    register(false);
    await ServiceLocator.getInstance().initCore();
    const first = ServiceLocator.get<SingletonService>("singleton");

    ServiceLocator.getInstance().dispose();
    expect(first.disposed).toBe(true);

    register(false);
    await ServiceLocator.getInstance().initCore();
    const second = ServiceLocator.get<SingletonService>("singleton");

    // The QA-25 gap when a service opts out of reset: same disposed instance.
    expect(second).toBe(first);
    expect(second.disposed).toBe(true);
  });

  it("with reset: reinit after dispose yields a fresh, non-disposed instance", async () => {
    register(true);
    await ServiceLocator.getInstance().initCore();
    const first = ServiceLocator.get<SingletonService>("singleton");

    ServiceLocator.getInstance().dispose();
    expect(first.disposed).toBe(true);

    register(true);
    await ServiceLocator.getInstance().initCore();
    const second = ServiceLocator.get<SingletonService>("singleton");

    expect(second).not.toBe(first);
    expect(second.disposed).toBe(false);
  });

  it("the stateful engine services wire reset-on-dispose", () => {
    const stateful = [
      "textureManager",
      "proceduralTextures",
      "modelLoader",
      "spriteManager",
      "spriteBuildingManager",
      "skyLightSystem",
      "postProcessing",
      "audioManager",
      "worldIndicators",
    ];
    for (const name of stateful) {
      const reg = SCENE_SERVICES.find((s) => s.name === name);
      expect(reg, `missing scene service '${name}'`).toBeDefined();
      expect(typeof reg?.reset, `service '${name}' must wire reset-on-dispose`).toBe("function");
    }
  });
});
