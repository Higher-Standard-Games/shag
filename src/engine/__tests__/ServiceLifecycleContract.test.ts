/**
 * ServiceLocator dispose → reinitialize contract (QA-25 / QA-WO13).
 *
 * The audit's core lifecycle concern, encoded executably. `ServiceLocator.dispose()`
 * clears its own map and calls each service's `dispose()`, but the registered
 * engine services are `X.getInstance()` singletons whose static instance field
 * the locator cannot clear (only GamePaths even has a `resetInstance`). So a
 * re-init after dispose reuses the SAME, already-disposed object — stale caches,
 * torn-down GPU resources, cvars registered twice, etc.
 *
 * `singletonFactoryService` mirrors that real pattern (factory returns a class
 * singleton). The contract test asserting a fresh instance after dispose is
 * `.skip`ped because the lifecycle-only locator does not meet it today — unskip
 * when WO13 lands reset-on-dispose (or real constructor-DI). The other cases
 * pass and characterize the current behavior so the fix is a visible change.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { type Service, ServiceLocator } from "../core/ServiceLocator";

/** A singleton service in the same shape as the real engine services. */
class SingletonService implements Service {
  private static _instance: SingletonService | null = null;
  disposed = false;
  initCount = 0;

  static getInstance(): SingletonService {
    if (!SingletonService._instance) SingletonService._instance = new SingletonService();
    return SingletonService._instance;
  }

  /** The static-field clear a fix (reset-on-dispose) would call. */
  static resetInstance(): void {
    SingletonService._instance = null;
  }

  init(): void {
    this.initCount++;
  }

  dispose(): void {
    this.disposed = true;
  }
}

function registerSingleton(): void {
  ServiceLocator.getInstance().register({
    name: "singleton",
    factory: () => SingletonService.getInstance(),
    phase: "core",
  });
}

describe("ServiceLocator dispose → reinitialize contract (QA-WO13)", () => {
  beforeEach(() => {
    ServiceLocator.resetInstance();
    SingletonService.resetInstance();
  });

  it("characterizes the gap: dispose runs, but the singleton persists across reinit", async () => {
    registerSingleton();
    await ServiceLocator.getInstance().initCore();
    const first = ServiceLocator.get<SingletonService>("singleton");

    ServiceLocator.getInstance().dispose();
    expect(first.disposed).toBe(true); // the service WAS disposed
    expect(ServiceLocator.has("singleton")).toBe(false); // locator forgot it

    // Re-init: the factory calls getInstance() again → the SAME disposed object.
    registerSingleton();
    await ServiceLocator.getInstance().initCore();
    const second = ServiceLocator.get<SingletonService>("singleton");

    // This is the QA-25 bug, documented: a disposed instance is reused.
    expect(second).toBe(first);
    expect(second.disposed).toBe(true);
  });

  // The intended contract — reinit after dispose must yield a usable (not
  // formerly-disposed) service. Fails on the current lifecycle-only locator.
  it.skip("reinit after dispose yields a fresh, non-disposed service instance (WO13)", async () => {
    registerSingleton();
    await ServiceLocator.getInstance().initCore();
    const first = ServiceLocator.get<SingletonService>("singleton");

    ServiceLocator.getInstance().dispose();

    registerSingleton();
    await ServiceLocator.getInstance().initCore();
    const second = ServiceLocator.get<SingletonService>("singleton");

    expect(second).not.toBe(first);
    expect(second.disposed).toBe(false);
  });
});
