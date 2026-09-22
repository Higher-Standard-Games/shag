/**
 * A game server the lobby gave up on must not keep running. Its port is handed
 * out again, and nobody is left who knows the process exists.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { abandonSpawnedChild } from "../GameServerSpawner";

interface FakeChild {
  killed: boolean;
  exitCode: number | null;
  kill: ReturnType<typeof vi.fn>;
}

function fakeChild(over: Partial<FakeChild> = {}): FakeChild {
  const child: FakeChild = {
    killed: false,
    exitCode: null,
    kill: vi.fn((signal?: string) => {
      if (signal === "SIGKILL") child.killed = true;
      return true;
    }),
    ...over,
  };
  return child;
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("abandonSpawnedChild", () => {
  it("asks a running child to stop", () => {
    const child = fakeChild();
    abandonSpawnedChild(child as never);
    expect(child.kill).toHaveBeenCalledWith("SIGTERM");
  });

  it("forces the issue when it does not go", () => {
    const child = fakeChild();
    abandonSpawnedChild(child as never);
    vi.advanceTimersByTime(5_000);
    expect(child.kill).toHaveBeenLastCalledWith("SIGKILL");
  });

  it("leaves a child that stopped on its own alone", () => {
    const child = fakeChild();
    abandonSpawnedChild(child as never);
    child.exitCode = 0;
    vi.advanceTimersByTime(5_000);
    expect(child.kill).toHaveBeenCalledTimes(1);
  });

  it("does nothing to a child that has already been killed or exited", () => {
    const gone = fakeChild({ killed: true });
    const exited = fakeChild({ exitCode: 1 });
    abandonSpawnedChild(gone as never);
    abandonSpawnedChild(exited as never);
    expect(gone.kill).not.toHaveBeenCalled();
    expect(exited.kill).not.toHaveBeenCalled();
  });
});
