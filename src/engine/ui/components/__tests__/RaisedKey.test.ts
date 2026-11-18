// @vitest-environment jsdom

/**
 * The menu's 3D key: a face standing on a side, and the label you can change
 * later without rebuilding the key.
 */

import { describe, expect, it } from "vitest";
import { createRaisedKey, raiseKey, setRaisedKeyText } from "../RaisedKey";

describe("RaisedKey", () => {
  it("builds a key with a face, a side and its wording", () => {
    const key = createRaisedKey({ label: "Play", variants: ["nav"] });

    expect(key.type).toBe("button");
    expect(key.classList.contains("raised-key")).toBe(true);
    expect(key.classList.contains("raised-key--nav")).toBe(true);
    expect(key.querySelector(".raised-key__side")?.getAttribute("aria-hidden")).toBe("true");
    expect(key.querySelector(".raised-key__label")?.textContent).toBe("Play");
    // A key says what it does in its label alone
    expect(key.querySelector(".raised-key__hint")).toBeNull();
  });

  it("changes its label in place", () => {
    const key = createRaisedKey({ label: "Send" });
    setRaisedKeyText(key, "Sent");
    expect(key.querySelector(".raised-key__label")?.textContent).toBe("Sent");
  });

  it("keeps an existing button's listeners and attributes when it becomes a key", () => {
    const button = document.createElement("button");
    button.dataset.tabId = "demos";
    let clicks = 0;
    button.addEventListener("click", () => {
      clicks++;
    });

    raiseKey(button, { label: "Demos", variants: ["nav"] });
    button.click();

    expect(clicks).toBe(1);
    expect(button.dataset.tabId).toBe("demos");
    expect(button.querySelector(".raised-key__label")?.textContent).toBe("Demos");
  });

  it("puts given content in the face instead of a label", () => {
    const band = document.createElement("span");
    band.className = "lobby__mode-band";
    const key = createRaisedKey({ variants: ["mode"], content: [band] });

    expect(key.querySelector(".raised-key__face")?.firstElementChild).toBe(band);
    expect(key.querySelector(".raised-key__label")).toBeNull();
  });
});
