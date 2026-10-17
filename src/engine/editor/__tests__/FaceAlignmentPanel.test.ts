// @vitest-environment jsdom

/**
 * The alignment panel against a stand-in for the session: each edit is
 * applied to every selected face of a brush, the way one transaction would,
 * and the panel is rendered again from the result.
 */

import { beforeEach, describe, expect, it } from "vitest";
import type { BoxBrush, FaceKey, FaceMaterial } from "../EditorDocument";
import { type FaceUpdate, renderFaceAlignment } from "../FaceAlignmentPanel";
import { faceST, faceTexMatrix, naturalFace } from "../FaceUv";

const face = (patch: Partial<FaceMaterial> = {}): FaceMaterial => ({
  ...naturalFace("blx/blx_white_stripe", [128, 32]),
  ...patch,
});

describe("face alignment panel", () => {
  let host: HTMLElement;
  let brush: BoxBrush;
  let keys: FaceKey[];
  let log: string[];

  const render = () =>
    renderFaceAlignment(host, brush, keys, (describe: string, update: FaceUpdate) => {
      const next = structuredClone(brush);
      for (const key of keys) next.faces![key] = update(next.faces![key]!, key, next);
      brush = next;
      log.push(describe);
      render();
    });
  const input = (name: string) => host.querySelector<HTMLInputElement>(`input[name="${name}"]`)!;
  const button = (selector: string) => host.querySelector<HTMLButtonElement>(selector)!;

  beforeEach(() => {
    host = document.createElement("div");
    document.body.replaceChildren(host);
    brush = {
      id: "pillar",
      min: { x: 0, y: 0, z: 0 },
      max: { x: 64, y: 32, z: 128 },
      shader: "blx/blx_grid",
      faces: { "+X": face({ shift: [8, 4] }), "+Y": face({ shift: [24, 4] }), "-Z": face() },
    };
    keys = ["+X", "+Y"];
    log = [];
  });

  it("shows shared values and leaves differing ones blank", () => {
    render();
    expect(input("shift-u").value).toBe("");
    expect(input("shift-u").placeholder).toBe("mixed");
    expect(input("shift-v").value).toBe("4");
    expect(input("scale-u").value).toBe("0.5");
    expect(input("rotation").value).toBe("0");
  });

  it("nudges each face from its own value, so differing faces keep their difference", () => {
    render();
    button('[data-uv-nudge="shift-u:1"]').click();
    expect(brush.faces!["+X"]!.shift[0]).toBe(16);
    expect(brush.faces!["+Y"]!.shift[0]).toBe(32);
    button('[data-uv-nudge="scale-v:-1"]').click();
    expect(brush.faces!["+X"]!.scale[1]).toBe(0.45);
    expect(log).toEqual(["Shift U +8", "Scale V −0.05"]);
  });

  it("sets a typed value on every face once, whether it arrives by Enter or by leaving the field", () => {
    render();
    input("rotation").value = "90";
    input("rotation").dispatchEvent(new Event("change", { bubbles: true }));
    expect(brush.faces!["+X"]!.rotation).toBe(90);
    expect(brush.faces!["+Y"]!.rotation).toBe(90);
    // a blank (mixed) field is left alone
    expect(brush.faces!["+Y"]!.shift[0]).toBe(24);

    input("shift-u").value = "0";
    const form = host.querySelector("form")!;
    form.dispatchEvent(new Event("change", { bubbles: true }));
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    expect(log).toEqual(["Set rotation", "Set shift u"]);
    expect(brush.faces!["+Y"]!.shift[0]).toBe(0);
  });

  it("fits, resets to natural, and wraps from the first selected face", () => {
    render();
    button('[data-uv-op="fit"]').click();
    // +X spans 32 units across (y) and 128 down (z): 128×32 texels fit at 0.25 and 4 units per texel
    expect(brush.faces!["+X"]).toMatchObject({ scale: [0.25, 4], rotation: 0 });

    button('[data-uv-op="natural"]').click();
    expect(brush.faces!["+X"]).toEqual(face());

    brush.faces!["+X"] = face({ shader: "boqu/floor", size: [256, 256], rotation: 30, shift: [5, 9] });
    render();
    expect(button('[data-uv-op="wrap"]').textContent).toBe("Wrap from +X");
    button('[data-uv-op="wrap"]').click();
    const wrapped = brush.faces!["+Y"]!;
    expect(wrapped).toMatchObject({ shader: "boqu/floor", size: [256, 256], scale: [0.5, 0.5] });
    // continuous on the corner edge x = 64, y = 32
    for (const z of [0, 50, 128]) {
      const p = { x: 64, y: 32, z };
      const a = faceST("+X", faceTexMatrix(brush.faces!["+X"]!), p);
      const b = faceST("+Y", faceTexMatrix(wrapped), p);
      for (const i of [0, 1]) {
        const difference = a[i] - b[i];
        expect(Math.abs(difference - Math.round(difference))).toBeLessThan(1e-6);
      }
    }
    expect(log).toEqual(["Fitted", "Natural alignment", "Wrapped +X around"]);
  });

  it("can't wrap a single face", () => {
    keys = ["+X"];
    render();
    expect(button('[data-uv-op="wrap"]').disabled).toBe(true);
  });
  it("edits skew, resets it with Fit and keeps unknown image-size locks disabled", () => {
    keys = ["+X"];
    render();
    input("skew").value = "25";
    input("skew").dispatchEvent(new Event("change", { bubbles: true }));
    expect(brush.faces!["+X"]!.skew).toBe(25);
    button('[data-uv-op="fit"]').click();
    expect(brush.faces!["+X"]!.skew).toBe(0);
    brush.faces!["+X"]!.sizeKnown = false;
    render();
    expect(input("skew").disabled).toBe(true);
  });

  it("locks the panel while a selected face still has the brush's fixed alignment", () => {
    keys = ["+X", "-X"];
    render();
    expect(host.querySelector(".shagged-uv__warning")!.textContent).toContain("Face -X has no known image size");
    expect([...host.querySelectorAll<HTMLButtonElement>("button")].every((item) => item.disabled)).toBe(true);
    expect([...host.querySelectorAll<HTMLInputElement>("input")].every((item) => item.disabled)).toBe(true);
  });

  it("explains face selection when no face is selected", () => {
    keys = [];
    render();
    expect(host.textContent).toContain("Ctrl+Shift+click a face");
    expect(host.querySelector("form")).toBeNull();
  });
});
