// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConnectingOverlay } from "../ConnectingOverlay";
import { clearNetworkConnector, registerNetworkConnector } from "../NetworkConnector";

describe("lobby match connection", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = "";
    Object.defineProperty(document, "fonts", {
      configurable: true,
      value: { ready: Promise.resolve() },
    });
  });

  afterEach(() => {
    clearNetworkConnector();
    vi.useRealTimers();
  });

  it("uses a full-screen handoff rail and stage for spectator connections", async () => {
    registerNetworkConnector({ isConnected: () => true, connect: vi.fn() });
    const overlay = new ConnectingOverlay();
    const serverUrl = 'ws://match.test/<img src=x onerror="alert(1)">';
    const shown = overlay.show(serverUrl, true);
    await vi.advanceTimersByTimeAsync(0);

    const root = document.querySelector<HTMLElement>(".connecting-overlay");
    expect(root?.getAttribute("role")).toBe("dialog");
    expect(root?.getAttribute("aria-label")).toBe("Joining live match");
    expect(document.activeElement).toBe(root);
    expect(root?.querySelector(".connecting-overlay__rail")).not.toBeNull();
    expect(root?.querySelector(".connecting-overlay__stage")).not.toBeNull();
    expect(root?.querySelector(".connecting-overlay__content")).toBeNull();
    expect(root?.querySelectorAll(".connecting-overlay__step")).toHaveLength(3);
    expect(root?.querySelector(".connecting-overlay__server")?.textContent).toBe(serverUrl);
    expect(root?.querySelector("img")).toBeNull();
    expect(root?.querySelector("[role='progressbar']")?.getAttribute("aria-label")).toBe("Connecting to match server");

    await vi.advanceTimersByTimeAsync(4000);
    await shown;
    expect(document.querySelector(".connecting-overlay")).toBeNull();
  });

  it("retries one transient pre-game drop with the same private ticket", async () => {
    const connect = vi
      .fn()
      .mockRejectedValueOnce(new Error("Disconnected before handshake"))
      .mockResolvedValueOnce(undefined);
    registerNetworkConnector({ isConnected: () => false, connect });
    const overlay = new ConnectingOverlay();
    const shown = overlay.show("ws://localhost:7777", false, "seat-ticket");
    await vi.advanceTimersByTimeAsync(6000);
    await shown;
    expect(connect).toHaveBeenCalledTimes(2);
    expect(connect).toHaveBeenNthCalledWith(1, "ws://localhost:7777", {
      autoJoin: true,
      watchOnly: false,
      admissionTicket: "seat-ticket",
    });
    expect(connect).toHaveBeenNthCalledWith(2, "ws://localhost:7777", {
      autoJoin: true,
      watchOnly: false,
      admissionTicket: "seat-ticket",
    });
    expect(document.querySelector(".connecting-overlay")).toBeNull();
  });

  it("does not retry a rejected ticket", async () => {
    const connect = vi.fn().mockRejectedValue(new Error("invalid match ticket"));
    registerNetworkConnector({ isConnected: () => false, connect });
    const overlay = new ConnectingOverlay();
    const shown = overlay.show("ws://localhost:7777", false, "seat-ticket");
    await vi.advanceTimersByTimeAsync(6000);
    await shown;
    expect(connect).toHaveBeenCalledTimes(1);
  });

  it("privately recovers an expired ticket once and finishes the connection", async () => {
    const connect = vi.fn().mockRejectedValueOnce(new Error("invalid match ticket")).mockResolvedValueOnce(undefined);
    const recover = vi.fn().mockResolvedValue("reserved-ticket");
    registerNetworkConnector({ isConnected: () => false, connect });
    const overlay = new ConnectingOverlay();
    const shown = overlay.show("ws://localhost:7777", false, "expired-ticket", recover);
    await vi.advanceTimersByTimeAsync(6000);
    await shown;
    expect(recover).toHaveBeenCalledTimes(1);
    expect(connect).toHaveBeenNthCalledWith(2, "ws://localhost:7777", {
      autoJoin: true,
      watchOnly: false,
      admissionTicket: "reserved-ticket",
    });
    expect(document.querySelector(".connecting-overlay")).toBeNull();
  });

  it("takes a seat on the match already being watched instead of connecting again", async () => {
    const connect = vi.fn();
    const claimSeat = vi.fn(() => true);
    registerNetworkConnector({ isConnected: () => true, connect, claimSeat });
    await new ConnectingOverlay().show("ws://localhost:7781", false, "drop-in-ticket");
    expect(claimSeat).toHaveBeenCalledWith("ws://localhost:7781", "drop-in-ticket");
    expect(connect).not.toHaveBeenCalled();
    // Nothing over the game: the player is already looking at the match.
    expect(document.querySelector(".connecting-overlay")).toBeNull();
  });

  it("gives a spectator's connection the way to ask for a seat", async () => {
    const connect = vi.fn().mockResolvedValue(undefined);
    registerNetworkConnector({ isConnected: () => false, connect });
    const requestSeat = vi.fn();
    const shown = new ConnectingOverlay().show("ws://localhost:7781", true, undefined, undefined, requestSeat);
    await vi.advanceTimersByTimeAsync(6000);
    await shown;
    expect(connect).toHaveBeenCalledWith(
      "ws://localhost:7781",
      expect.objectContaining({ watchOnly: true, requestSeat }),
    );
  });
});
