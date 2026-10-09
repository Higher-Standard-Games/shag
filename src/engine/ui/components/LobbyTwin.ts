/**
 * LobbyTwin — the lobby's rail and stage backdrop, for the screens before and
 * between it: the start-up screen, the match handoff, the map loading screen and
 * the join screen over a live match (styles/LobbyTwin.css).
 *
 * The lobby takes over from these screens, or they from it, so a change of
 * screen should only change what the rail and stage hold, never where they are.
 * Each screen builds the rail here and puts its own content on the stage.
 *
 * Engine code, game-agnostic: the game names its brand and the console once, at
 * boot, with `configureLobbyTwin`.
 */

import { EngineVersion } from "../../core/EngineVersion";

import "./styles/LobbyTwin.css";

/** The game's logo at the head of the rail, as its lobby shows it. */
export interface LobbyTwinBrand {
  /** Image URL. Game data, so it may not be installed: `name` stands in until it loads. */
  logo?: string;
  name: string;
}

let brand: LobbyTwinBrand | null = null;
let openConsole: (() => void) | null = null;

/** Set by the game at boot: its logo, and how the rail's Console key opens the console. */
export function configureLobbyTwin(options: { brand?: LobbyTwinBrand; onConsole?: () => void }): void {
  if (options.brand) brand = options.brand;
  if (options.onConsole) openConsole = options.onConsole;
}

export type TwinStepState = "done" | "active" | "pending" | "error";

const STEP_HINTS: Record<TwinStepState, string> = {
  done: "Done",
  active: "Loading",
  pending: "",
  error: "Failed",
};

export interface TwinRail {
  rail: HTMLElement;
  steps: HTMLElement[];
  /** The panel's heading: what this screen is (a match handoff, a local map). */
  context: HTMLElement;
  /** Set each step's state at once, in order. */
  setSteps(states: readonly TwinStepState[]): void;
  /** A fact at the head of the panel (the map, the server), added or updated by key. */
  setFact(key: string, label: string, value: string): void;
  /** A line in the panel's log, newest last. */
  log(line: string): void;
}

/** Lines kept in a rail's log; older ones scroll away. */
const LOG_LINES = 40;

/** The root's class: the lobby's backdrop, full screen. Add the screen's own classes beside it. */
export const TWIN_ROOT_CLASS = "twin";

/** The stage's drifting light, as the lobby's: three blurred fields wandering slowly. */
export function buildTwinLight(): HTMLElement {
  const light = element("div", "twin__light");
  light.setAttribute("aria-hidden", "true");
  light.append(
    element("div", "twin__orb twin__orb--accent"),
    element("div", "twin__orb twin__orb--violet"),
    element("div", "twin__orb twin__orb--deep"),
  );
  return light;
}

/**
 * The rail: the game's logo, the screen's steps as the lobby's nav keys, a panel
 * with the screen's facts and log where the lobby lists rooms, the engine in the
 * player card's place, and the utility keys (only Console works).
 */
export function buildTwinRail(options: { label: string; steps: readonly string[]; context: string }): TwinRail {
  const version = EngineVersion.getInstance();
  const rail = element("aside", "twin__rail");
  rail.setAttribute("aria-label", options.label);

  const stepList = element("ol", "twin__steps");
  stepList.setAttribute("aria-label", "Steps");
  const steps = options.steps.map((label) => {
    const item = twinKey("li", label, true);
    stepList.appendChild(item);
    return item;
  });

  const panel = element("section", "twin__log");
  const heading = element("div", "twin__label");
  const context = element("span", "twin__context", options.context);
  heading.append(context, element("span", "", version.getVersionString()));
  const box = element("div", "twin__log-box");
  const facts = element("dl", "twin__facts");
  const lines = element("ol", "twin__log-lines");
  lines.setAttribute("aria-live", "polite");
  box.append(facts, lines);
  panel.append(heading, box);

  const card = element("div", "twin__card");
  const avatar = element("span", "twin__avatar");
  avatar.setAttribute("aria-hidden", "true");
  const who = element("div", "twin__who");
  who.append(element("strong", "", version.getEngineName()), element("span", "", version.getVersionString()));
  card.append(avatar, who);

  // The lobby's utility row, so nothing shifts when it takes over
  const utility = element("div", "twin__utility");
  const keys = ["Profile", "Settings", "Console"].map((label) => {
    const key = twinKey("button", label) as HTMLButtonElement;
    key.type = "button";
    key.classList.add("twin-key--util");
    key.disabled = label !== "Console" || !openConsole;
    return key;
  });
  keys[2].addEventListener("click", (event) => {
    // Not a click on the screen behind it: a screen that starts on a click must not start
    event.stopPropagation();
    openConsole?.();
  });
  utility.append(...keys);

  rail.append(buildBrand(), stepList, panel, card, utility);

  const factValues = new Map<string, HTMLElement>();
  return {
    rail,
    steps,
    context,
    setSteps(states) {
      for (const [index, item] of steps.entries()) setTwinStepState(item, states[index] ?? "pending");
    },
    setFact(key, label, value) {
      let valueEl = factValues.get(key);
      if (!valueEl) {
        const term = element("dt", "twin__fact-label", label);
        valueEl = element("dd", "twin__fact-value");
        valueEl.dataset.fact = key;
        facts.append(term, valueEl);
        factValues.set(key, valueEl);
      }
      valueEl.textContent = value;
      valueEl.title = value;
    },
    log(line) {
      if (!line || lines.lastElementChild?.textContent === line) return;
      const item = element("li", "twin__log-line", line);
      item.title = line;
      lines.appendChild(item);
      while (lines.childElementCount > LOG_LINES) lines.firstElementChild?.remove();
    },
  };
}

/** A step's state: done (lit), active (latched in ink), pending (unlit) or error. */
export function setTwinStepState(item: HTMLElement, state: TwinStepState): void {
  item.classList.remove("is-done", "is-active", "is-pending", "is-error");
  item.classList.add(`is-${state}`);
  if (state === "active") item.setAttribute("aria-current", "step");
  else item.removeAttribute("aria-current");
  const hint = item.querySelector(".twin-key__hint");
  if (hint) hint.textContent = STEP_HINTS[state];
}

/** A key in the rail's look: a face standing on its side. */
export function twinKey(tag: string, label: string, withHint = false): HTMLElement {
  const key = element(tag, "twin-key");
  const side = element("span", "twin-key__side");
  side.setAttribute("aria-hidden", "true");
  const face = element("span", "twin-key__face");
  face.append(element("span", "twin-key__label", label));
  if (withHint) face.append(element("span", "twin-key__hint"));
  key.append(side, face);
  return key;
}

/** The game's logo, or its name set in type until the logo loads (and for good if it never does). */
function buildBrand(): HTMLElement {
  const shown = brand ?? { name: EngineVersion.getInstance().getEngineName() };
  const node = element("div", "twin__brand");
  const fallback = element("span", "", shown.name);
  if (!shown.logo) {
    node.append(fallback);
    return node;
  }
  const logo = document.createElement("img");
  logo.src = shown.logo;
  logo.alt = shown.name;
  logo.hidden = true;
  logo.addEventListener("load", () => {
    logo.hidden = false;
    fallback.hidden = true;
  });
  logo.addEventListener("error", () => {
    logo.hidden = true;
    fallback.hidden = false;
  });
  // Already in the cache: no load event comes
  if (logo.complete && logo.naturalWidth > 0) {
    logo.hidden = false;
    fallback.hidden = true;
  }
  node.append(logo, fallback);
  return node;
}

function element(tag: string, className: string, text?: string): HTMLElement {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
