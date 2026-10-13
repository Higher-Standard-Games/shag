// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Cvar } from "../../../core/Cvar";
import { NetGraph } from "../NetGraph";

beforeEach(() => {
  NetGraph.init();
  NetGraph.reset();
  Cvar.set("cl_netgraph", 0);
});
afterEach(() => {
  NetGraph.reset();
  vi.restoreAllMocks();
});

const stats = () =>
  NetGraph.getInstance() as unknown as {
    packetLossPct: number;
    ticksPerSnapshot: number;
    snapshotGaps: number[];
  };

it("refines a first gap containing loss, retaining the missing snapshots in its estimate", () => {
  for (const tick of [100, 104, 106, 108, 112]) NetGraph.recordSnapshot(20, tick);
  expect(stats().ticksPerSnapshot).toBe(2);
  expect(stats().packetLossPct).toBeCloseTo(100 / 3);
  NetGraph.reset();
  for (const tick of [8, 16, 24]) NetGraph.recordSnapshot(20, tick);
  expect(stats().ticksPerSnapshot).toBe(8);
  expect(stats().packetLossPct).toBe(0);
});

it("ignores duplicate ticks and bounds history even after a huge gap", () => {
  NetGraph.setTicksPerSnapshot(2);
  for (const tick of [100, 102, 100, 104]) NetGraph.recordSnapshot(20, tick);
  expect(stats().packetLossPct).toBe(0);
  NetGraph.recordSnapshot(20, 1_000_000_000);
  expect(stats().packetLossPct).toBe(99);
  expect(stats().snapshotGaps.length).toBeLessThanOrEqual(100);
});

it("throttles painting and changes canvas dimensions only when the mode changes", () => {
  const clearRect = vi.fn();
  const ctx = new Proxy(
    { clearRect },
    { get: (target, key) => (key === "clearRect" ? target.clearRect : () => {}), set: () => true },
  );
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
    ctx as unknown as ReturnType<HTMLCanvasElement["getContext"]>,
  );
  let now = 0;
  vi.spyOn(performance, "now").mockImplementation(() => now);
  Cvar.set("cl_netgraph", 1);
  NetGraph.render();
  const canvas = document.getElementById("netgraph-overlay") as HTMLCanvasElement;
  const width = vi.spyOn(canvas, "width", "set");
  const height = vi.spyOn(canvas, "height", "set");
  for (now = 1; now < 100; now++) NetGraph.render();
  expect(clearRect).toHaveBeenCalledTimes(1);
  NetGraph.render();
  expect(clearRect).toHaveBeenCalledTimes(2);
  expect(width).not.toHaveBeenCalled();
  expect(height).not.toHaveBeenCalled();
  Cvar.set("cl_netgraph", 2);
  NetGraph.render();
  expect(height).toHaveBeenCalledOnce();
});
