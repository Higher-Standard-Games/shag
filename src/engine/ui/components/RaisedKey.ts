/**
 * RaisedKey — builds the menu's 3D key: a face standing on its side.
 * Styles and states are described in styles/RaisedKey.css.
 *
 *   const find = createRaisedKey({ label: "Find duel", variants: ["cta"] });
 *   raiseKey(tabButton, { label: "Play", hint: "4 modes", variants: ["nav"] });
 */

import { UIStyles } from "../UIStyles";
import raisedKeyCSS from "./styles/RaisedKey.css?raw";

export type RaisedKeyVariant = "nav" | "sm" | "cream" | "ink" | "cta" | "util" | "inline" | (string & {});

export interface RaisedKeyOptions {
  label?: string;
  hint?: string;
  variants?: RaisedKeyVariant[];
  /** Face content in place of the label and hint. */
  content?: Node[];
}

/**
 * Add the key styles to the page. A stylesheet that adds its own variants
 * calls this before injecting itself, so its rules come later and win.
 */
export function injectRaisedKeyStyles(): void {
  UIStyles.injectCSS("raised-key", raisedKeyCSS);
}

/** Turn an existing button into a raised key, keeping its listeners and attributes. */
export function raiseKey<T extends HTMLElement>(element: T, options: RaisedKeyOptions): T {
  injectRaisedKeyStyles();
  element.classList.add("raised-key", ...(options.variants ?? []).map((variant) => `raised-key--${variant}`));

  const side = document.createElement("span");
  side.className = "raised-key__side";
  side.setAttribute("aria-hidden", "true");
  const face = document.createElement("span");
  face.className = "raised-key__face";
  if (options.content) {
    face.append(...options.content);
  } else {
    const label = document.createElement("span");
    label.className = "raised-key__label";
    face.appendChild(label);
    const hint = document.createElement("span");
    hint.className = "raised-key__hint";
    face.appendChild(hint);
  }
  element.replaceChildren(side, face);
  if (!options.content) setRaisedKeyText(element, options.label ?? "", options.hint);
  return element;
}

/** A new raised key button. */
export function createRaisedKey(options: RaisedKeyOptions): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  return raiseKey(button, options);
}

/** Change a key's label and hint; an empty hint hides it. */
export function setRaisedKeyText(key: HTMLElement, label: string, hint?: string): void {
  const labelEl = key.querySelector<HTMLElement>(".raised-key__label");
  if (labelEl) labelEl.textContent = label;
  const hintEl = key.querySelector<HTMLElement>(".raised-key__hint");
  if (hintEl) {
    hintEl.textContent = hint ?? "";
    hintEl.hidden = !hint;
  }
}
