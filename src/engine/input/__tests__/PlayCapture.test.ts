// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { Cvar } from "../../core/Cvar";
import { EventBus } from "../../core/EventBus";
import { INPUT_DEVICE_CHANGED } from "../InputDevice";
import {
  enterPlay,
  inPlay,
  inTouchPlay,
  leavePlay,
  PLAY_CHANGE,
  setTouchPlay,
  startPlayCapture,
  stopPlayCapture,
} from "../PlayCapture";

afterEach(() => {
  stopPlayCapture();
  setTouchPlay(false);
  Cvar.set("in_touch", -1);
});

describe("play capture", () => {
  it("counts touch play as play and announces each change once", () => {
    const changes = vi.fn();
    document.addEventListener(PLAY_CHANGE, changes);
    try {
      expect(inPlay()).toBe(false);
      setTouchPlay(true);
      setTouchPlay(true);
      expect(inPlay()).toBe(true);
      expect(inTouchPlay()).toBe(true);
      leavePlay();
      expect(inPlay()).toBe(false);
      expect(changes).toHaveBeenCalledTimes(2);
    } finally {
      document.removeEventListener(PLAY_CHANGE, changes);
    }
  });

  it("enters touch play on a touch screen and locks the pointer otherwise", () => {
    const canvas = document.createElement("canvas");
    const requestPointerLock = vi.fn();
    canvas.requestPointerLock = requestPointerLock;

    Cvar.set("in_touch", 1);
    enterPlay(canvas);
    expect(inTouchPlay()).toBe(true);
    expect(requestPointerLock).not.toHaveBeenCalled();

    setTouchPlay(false);
    Cvar.set("in_touch", 0);
    enterPlay(canvas);
    expect(inTouchPlay()).toBe(false);
    expect(requestPointerLock).toHaveBeenCalledOnce();
  });

  it("ends touch play when the player picks up the mouse, and passes pointer lock changes on", () => {
    startPlayCapture();
    const changes = vi.fn();
    document.addEventListener(PLAY_CHANGE, changes);
    try {
      setTouchPlay(true);
      EventBus.emit(INPUT_DEVICE_CHANGED, { device: "touch" });
      expect(inTouchPlay()).toBe(true);
      EventBus.emit(INPUT_DEVICE_CHANGED, { device: "keyboard_mouse" });
      expect(inTouchPlay()).toBe(false);
      expect(changes).toHaveBeenCalledTimes(2);

      // The suite shares one document, where other files' input systems may
      // still forward pointer lock changes too: count only this module's.
      changes.mockClear();
      document.dispatchEvent(new Event("pointerlockchange"));
      const started = changes.mock.calls.length;
      stopPlayCapture();
      changes.mockClear();
      document.dispatchEvent(new Event("pointerlockchange"));
      expect(started - changes.mock.calls.length).toBe(1);
    } finally {
      document.removeEventListener(PLAY_CHANGE, changes);
    }
  });
});
