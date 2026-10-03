// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";
import { UIStyles } from "../UIStyles";

const styleId = "menu-style-reload-test";

afterEach(() => UIStyles.removeCSS(styleId));

describe("UIStyles", () => {
  it("updates an injected stylesheet in place when its raw CSS changes", () => {
    UIStyles.injectCSS(styleId, ".menu-key::before { content: ''; }");
    const style = document.getElementById(`ui-styles-${styleId}`);
    expect(style).not.toBeNull();

    UIStyles.injectCSS(styleId, ".menu-key::before { content: none; display: none; }");
    expect(document.getElementById(`ui-styles-${styleId}`)).toBe(style);
    expect(style?.textContent).toContain("display: none");
    expect(document.querySelectorAll(`#ui-styles-${styleId}`)).toHaveLength(1);
  });
});
