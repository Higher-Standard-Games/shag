import { describe, expect, it, vi } from "vitest";
import { requestRawPointerLock } from "../RawPointerLock";

const element = (requestPointerLock: (options?: unknown) => Promise<void> | undefined) =>
  ({ requestPointerLock }) as unknown as Element;

describe("requestRawPointerLock", () => {
  it("asks for movement without the system's acceleration", async () => {
    const request = vi.fn(async () => {});
    await requestRawPointerLock(element(request));
    expect(request).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledWith({ unadjustedMovement: true });
  });

  it("captures the ordinary way where the system has no raw movement", async () => {
    const request = vi.fn(async (options?: unknown) => {
      if (options) throw new DOMException("no raw input", "NotSupportedError");
    });
    await requestRawPointerLock(element(request));
    expect(request).toHaveBeenCalledTimes(2);
    expect(request).toHaveBeenLastCalledWith();
  });

  it("reports a refused capture without retrying it", async () => {
    const request = vi.fn(async () => {
      throw new DOMException("no user gesture", "NotAllowedError");
    });
    await expect(requestRawPointerLock(element(request))).rejects.toThrow("no user gesture");
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("accepts a browser whose capture returns nothing", async () => {
    const request = vi.fn(() => undefined);
    await expect(requestRawPointerLock(element(request))).resolves.toBeUndefined();
  });
});
