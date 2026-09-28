/**
 * TransferLoadingView — a map loading screen in the match handoff's look.
 *
 * The gold rail keeps the handoff's steps, the dark stage carries the map's
 * name over its levelshot, and the bar fills phase by phase. When the handoff
 * screen is still up as the map starts loading, this screen appears in its
 * place without a fade, so joining a match reads as one sequence from the
 * ready check to the arena.
 *
 * Usage:
 *   MapLoadingOverlay.configure({ view: () => new TransferLoadingView() });
 */
import { EngineVersion } from "../core/EngineVersion";
import type { LoadingCompleteEvent, LoadingProgressEvent, LoadingStartEvent } from "../core/LoadingEvents";
import { getNetworkConnector } from "./components/NetworkConnector";
import type { MapLoadingView } from "./MapLoadingOverlay";
import { mapTitle } from "./MapTitles";

import "./components/styles/ConnectingOverlay.css";

/** The map loader's phases in the order it runs them, with what the status says. */
const PHASES: ReadonlyArray<readonly [phase: string, label: string]> = [
  ["cleanup", "Clearing"],
  ["Loading", "Map data"],
  ["Dependencies", "Packages"],
  ["Shaders", "Shaders"],
  ["Geometry", "Geometry"],
  ["Textures", "Textures"],
  ["Skybox", "Sky"],
  ["Lighting", "Lightmaps"],
  ["Autosprites", "Sprites"],
  ["Collision", "Collision"],
  ["Assets", "Models"],
  ["Finalizing", "Warming up"],
  ["Recovery", "Recovering"],
  ["Entities", "Entities"],
  ["Complete", "Map loaded"],
];

/** How far the bar gets on the map's own phases; the rest is the game setting up. */
const MAP_SHARE = 0.9;

/** A local load's steps, by the index of the first phase each covers. */
const LOCAL_STEPS: ReadonlyArray<readonly [label: string, firstPhase: number]> = [
  ["MAP DATA", 0],
  ["WORLD", 4],
  ["GAME", 10],
];

/** A name on two lines where it has two words or more, split where the lines come out most even. */
export function titleLines(name: string): string[] {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length < 2) return words;
  let best: string[] = [];
  let longest = Number.POSITIVE_INFINITY;
  for (let split = 1; split < words.length; split++) {
    const lines = [words.slice(0, split).join(" "), words.slice(split).join(" ")];
    const length = Math.max(lines[0].length, lines[1].length);
    if (length < longest) {
      longest = length;
      best = lines;
    }
  }
  return best;
}

/**
 * The share of the map's load a progress event stands for: its phase's place
 * in the order, plus how far into the phase the event says it is.
 */
export function phaseProgress(event: LoadingProgressEvent): number | null {
  const index = PHASES.findIndex(([phase]) => phase === event.phase);
  if (index < 0) return null;
  // Some phases report 0..1, the event type says 0..100
  const within = event.percent === undefined ? 0 : event.percent > 1 ? event.percent / 100 : event.percent;
  const next = Math.min(index + Math.max(0, Math.min(1, within)), PHASES.length - 1);
  return (next / (PHASES.length - 1)) * MAP_SHARE;
}

export class TransferLoadingView implements MapLoadingView {
  private root: HTMLElement | null = null;
  private stepEls: HTMLElement[] = [];
  private statusEl: HTMLElement | null = null;
  private dotsEl: HTMLElement | null = null;
  private detailEl: HTMLElement | null = null;
  private noticeEl: HTMLElement | null = null;
  private titleEl: HTMLElement | null = null;
  private kickerEl: HTMLElement | null = null;
  private leadEl: HTMLElement | null = null;
  private ambientEl: HTMLElement | null = null;
  private shotEl: HTMLElement | null = null;
  private mapEl: HTMLElement | null = null;
  private dotTimer: ReturnType<typeof setInterval> | null = null;
  private networked = false;
  private progressShare = 0;
  private phaseIndex = 0;
  private failed = false;

  mount(container: HTMLElement, map: LoadingStartEvent): void {
    this.networked = getNetworkConnector()?.isConnected() === true;

    const root = element("div", "connecting-overlay connecting-overlay--loading");
    root.setAttribute("role", "dialog");
    root.setAttribute("aria-modal", "true");
    root.setAttribute("aria-busy", "true");
    this.root = root;

    // Taking over from the handoff: it is the same screen moving on, not a new one
    if (document.querySelector(".connecting-overlay--handoff")) {
      container.classList.add("ui-map-loading-overlay--instant");
      root.classList.add("connecting-overlay--continued");
    }

    this.ambientEl = element("div", "connecting-overlay__ambient-word");
    this.ambientEl.setAttribute("aria-hidden", "true");

    root.append(this.ambientEl, this.buildRail(), this.buildStage());
    container.appendChild(root);

    this.dotTimer = setInterval(() => {
      if (!this.dotsEl) return;
      this.dotsEl.textContent = ".".repeat(((this.dotsEl.textContent ?? "").length + 1) % 4);
    }, 500);

    this.restart(map);
  }

  restart(map: LoadingStartEvent): void {
    const name = mapTitle(map.id) ?? map.meta?.displayName ?? map.id;
    const lines = titleLines(name.toUpperCase());
    this.root?.setAttribute("aria-label", `Loading ${name}`);
    this.titleEl?.replaceChildren(...lines.map((line) => element("span", "", line)));
    this.titleEl?.style.setProperty("--co-title-chars", String(Math.max(6, ...lines.map((line) => line.length))));
    if (this.ambientEl) this.ambientEl.textContent = map.id.toUpperCase();
    if (this.mapEl) this.mapEl.textContent = map.id;
    // A map with no levelshot installed keeps the stage's own gradient
    this.shotEl?.style.setProperty("--co-shot", `url("/data/levelshots/${encodeURIComponent(map.id)}.jpg")`);
    if (this.kickerEl) this.kickerEl.textContent = "NOW LOADING";
    if (this.leadEl) {
      this.leadEl.textContent = this.networked
        ? "Connected to the match server. Loading the arena it is running."
        : "Loading the arena from its files.";
    }
    this.noticeEl?.replaceChildren();
    this.failed = false;
    this.progressShare = 0;
    this.phaseIndex = 0;
    this.setBar(0);
    this.setStatus("loading", "PREPARING");
    this.setDetail("");
    this.refreshSteps("active");
  }

  progress(event: LoadingProgressEvent): void {
    const index = PHASES.findIndex(([phase]) => phase === event.phase);
    if (index >= 0) this.phaseIndex = Math.max(this.phaseIndex, index);
    const label = index >= 0 ? PHASES[index][1] : event.phase;
    this.setStatus("loading", label.toUpperCase());
    this.setDetail(event.detail ?? "");
    const share = phaseProgress(event);
    if (share !== null) this.setBar(share);
    this.refreshSteps("active");
  }

  complete(event: LoadingCompleteEvent, waitingFor: string[]): void {
    if (!event.success) {
      this.failed = true;
      if (this.kickerEl) this.kickerEl.textContent = "MAP ERROR";
      if (this.leadEl) this.leadEl.textContent = "The arena could not be loaded.";
      this.setStatus("load-failed", "LOAD FAILED");
      this.setDetail("");
      const error = element("div", "connecting-overlay__error", event.error || "The map could not be loaded.");
      error.setAttribute("role", "alert");
      this.noticeEl?.replaceChildren(error);
      this.root?.setAttribute("aria-busy", "false");
      this.refreshSteps("error");
      return;
    }
    this.phaseIndex = PHASES.length - 1;
    this.setBar(MAP_SHARE);
    this.setDetail(`Map loaded in ${(event.duration / 1000).toFixed(1)} s`);
    if (waitingFor.length > 0) this.setStatus("setting-up", "SETTING UP");
    this.refreshSteps("active");
  }

  ready(): void {
    if (this.failed) return;
    if (this.kickerEl) this.kickerEl.textContent = "ARENA READY";
    if (this.leadEl) this.leadEl.textContent = "The arena is loaded. Dropping you in.";
    this.setBar(1);
    this.setStatus("ready", "READY");
    this.root?.setAttribute("aria-busy", "false");
    this.refreshSteps("done");
  }

  destroy(): void {
    if (this.dotTimer !== null) clearInterval(this.dotTimer);
    this.dotTimer = null;
    this.root?.remove();
    this.root = null;
    this.stepEls = [];
  }

  private buildRail(): HTMLElement {
    const rail = element("aside", "connecting-overlay__rail");

    const header = element("div", "connecting-overlay__rail-header");
    const title = element("div", "connecting-overlay__rail-title");
    title.append(element("span", "", "ARENA"), element("span", "", "INBOUND"));
    header.append(
      element("div", "connecting-overlay__brand", "WASHIKI // WASHOI"),
      element("div", "connecting-overlay__rail-kicker", this.networked ? "MATCH HANDOFF" : "LOCAL MAP"),
      title,
    );

    const steps = element("ol", "connecting-overlay__steps");
    const labels = this.networked ? ["SERVER", "HANDSHAKE", "MAP LOAD"] : LOCAL_STEPS.map(([label]) => label);
    this.stepEls = labels.map((label, index) => {
      const step = element("li", "connecting-overlay__step");
      const mark = element("span", "connecting-overlay__step-mark");
      mark.setAttribute("aria-hidden", "true");
      step.append(
        element("span", "connecting-overlay__step-number", `0${index + 1}`),
        element("span", "connecting-overlay__step-label", label),
        mark,
      );
      steps.appendChild(step);
      return step;
    });

    const endpoint = element("div", "connecting-overlay__endpoint");
    this.mapEl = element("span", "connecting-overlay__server");
    endpoint.append(element("span", "connecting-overlay__endpoint-label", "MAP"), this.mapEl);

    const version = EngineVersion.getInstance();
    const footer = element(
      "div",
      "connecting-overlay__rail-footer",
      `${version.getEngineName()} // ${version.getVersionString()}`,
    );

    rail.append(header, steps, endpoint, footer);
    return rail;
  }

  private buildStage(): HTMLElement {
    const stage = element("main", "connecting-overlay__stage");

    this.shotEl = element("div", "connecting-overlay__shot");
    this.shotEl.setAttribute("aria-hidden", "true");

    const header = element("div", "connecting-overlay__stage-header");
    header.append(
      element(
        "div",
        "connecting-overlay__sequence",
        this.networked ? "MATCH TRANSFER // MAP LOAD" : "LOCAL SESSION // MAP LOAD",
      ),
      deco(),
    );

    const hero = element("div", "connecting-overlay__hero");
    this.kickerEl = element("div", "connecting-overlay__kicker");
    this.titleEl = element("h1", "connecting-overlay__title");
    this.leadEl = element("p", "connecting-overlay__lead");
    hero.append(this.kickerEl, this.titleEl, this.leadEl);

    const transfer = element("section", "connecting-overlay__transfer");
    transfer.setAttribute("aria-label", "Loading progress");

    const statusHeader = element("div", "connecting-overlay__status-header");
    this.statusEl = element("div", "connecting-overlay__status");
    this.statusEl.setAttribute("aria-live", "polite");
    this.statusEl.setAttribute("aria-atomic", "true");
    this.dotsEl = element("span", "connecting-overlay__dots");
    this.dotsEl.setAttribute("aria-hidden", "true");
    statusHeader.append(element("span", "connecting-overlay__status-label", "LOAD STATUS"), this.statusEl);

    const bar = element("div", "connecting-overlay__bar");
    bar.setAttribute("role", "progressbar");
    bar.setAttribute("aria-label", "Loading the map");
    bar.setAttribute("aria-valuemin", "0");
    bar.setAttribute("aria-valuemax", "100");
    bar.appendChild(element("div", "connecting-overlay__bar-fill"));

    const footer = element("div", "connecting-overlay__transfer-footer");
    this.detailEl = element("span", "connecting-overlay__detail");
    footer.append(deco(), this.detailEl);

    this.noticeEl = element("div", "connecting-overlay__notices");
    this.noticeEl.setAttribute("aria-live", "assertive");

    transfer.append(statusHeader, bar, footer, this.noticeEl);
    stage.append(this.shotEl, header, hero, transfer);
    return stage;
  }

  private setStatus(state: string, text: string): void {
    if (this.root) this.root.dataset.state = state;
    if (!this.statusEl) return;
    this.statusEl.textContent = text;
    if (this.dotsEl && state !== "ready" && state !== "load-failed") this.statusEl.appendChild(this.dotsEl);
  }

  private setDetail(text: string): void {
    if (!this.detailEl) return;
    this.detailEl.textContent = text;
    this.detailEl.title = text;
  }

  /** The bar only ever moves forward, whatever order the phases report in. */
  private setBar(share: number): void {
    this.progressShare = Math.max(this.progressShare, share);
    this.root?.style.setProperty("--co-progress", this.progressShare.toFixed(3));
    this.root
      ?.querySelector(".connecting-overlay__bar")
      ?.setAttribute("aria-valuenow", String(Math.round(this.progressShare * 100)));
  }

  /** `current` is the state of the step the load is on; the ones before it are done. */
  private refreshSteps(current: "active" | "done" | "error"): void {
    let at = this.stepEls.length - 1;
    if (!this.networked) {
      at = LOCAL_STEPS.reduce((step, [, first], index) => (this.phaseIndex >= first ? index : step), 0);
      if (current === "done") at = this.stepEls.length - 1;
    }
    this.stepEls.forEach((step, index) => {
      const state = index < at ? "done" : index === at ? current : "pending";
      step.classList.remove("is-done", "is-active", "is-pending", "is-error");
      step.classList.add(`is-${state}`);
    });
  }
}

function element(tag: string, className: string, text?: string): HTMLElement {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function deco(): HTMLElement {
  const node = element("div", "connecting-overlay__deco");
  node.setAttribute("aria-hidden", "true");
  for (let index = 0; index < 5; index++) node.appendChild(document.createElement("span"));
  return node;
}
