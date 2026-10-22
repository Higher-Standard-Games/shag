// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { EventFeed } from "../ui/hud/EventFeed";

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  EventFeed.getInstance().dispose();
  vi.useRealTimers();
});

it("fades a message after six seconds and removes it a second later, without a frame loop", () => {
  const raf = vi.spyOn(window, "requestAnimationFrame");
  const feed = EventFeed.getInstance();
  feed.addKill("sundflux", "Wraith");
  const entry = document.querySelector(".fps-event-entry")!;
  expect(raf).toHaveBeenCalledTimes(1); // the stamp-in only

  vi.advanceTimersByTime(5999);
  expect(entry.classList.contains("fps-event-entry--out")).toBe(false);
  vi.advanceTimersByTime(1);
  expect(entry.classList.contains("fps-event-entry--out")).toBe(true);
  vi.advanceTimersByTime(1000);
  expect(entry.isConnected).toBe(false);
  expect(raf).toHaveBeenCalledTimes(1);
});

it("still keeps only the newest six", () => {
  const feed = EventFeed.getInstance();
  for (let i = 0; i < 8; i++) feed.addCustom(`<b>${i}</b>`);
  const shown = [...document.querySelectorAll(".fps-event-entry")].map((e) => e.textContent);
  expect(shown).toEqual(["2", "3", "4", "5", "6", "7"]);
});
