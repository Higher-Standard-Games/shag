import { afterEach, describe, expect, it, vi } from "vitest";
import { background, isChunkLoadError, logRejection, onChunkLoadError } from "../AsyncErrors";

describe("background promises", () => {
  afterEach(() => vi.restoreAllMocks());

  it("logs a rejection under its context instead of leaving it unhandled", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    background(Promise.reject(new Error("boom")), "Ragdoll");
    await new Promise((r) => setTimeout(r, 0));
    expect(error).toHaveBeenCalledWith("[Ragdoll]", expect.any(Error));
  });

  it("accepts a non-promise from a mock", () => {
    expect(() => background(undefined, "Mock")).not.toThrow();
  });

  it("recognises a missing lazy chunk in each browser's wording", () => {
    expect(
      isChunkLoadError(new TypeError("Failed to fetch dynamically imported module: /assets/EventFeed-abc.js")),
    ).toBe(true);
    expect(isChunkLoadError(new TypeError("error loading dynamically imported module"))).toBe(true);
    expect(isChunkLoadError(new TypeError("Importing a module script failed."))).toBe(true);
    expect(isChunkLoadError(new Error("model not found"))).toBe(false);
  });

  it("calls the chunk handler only for a missing chunk", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const handler = vi.fn();
    onChunkLoadError(handler);
    logRejection("X")(new Error("model not found"));
    expect(handler).not.toHaveBeenCalled();
    logRejection("X")(new TypeError("Failed to fetch dynamically imported module: /assets/a.js"));
    expect(handler).toHaveBeenCalledOnce();
  });
});
