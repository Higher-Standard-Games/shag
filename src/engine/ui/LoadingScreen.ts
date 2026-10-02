/**
 * LoadingScreen - Engine-level loading and ready screen
 *
 * Handles:
 * 1. Boot progress: the renderer, the packages, the engine, the lobby
 * 2. "Click to start" once the engine can take the click (unlocks browser audio)
 *
 * It wears the match handoff's look (ConnectingOverlay.css): a gold rail with
 * the boot's steps, and a stage whose ring holds the engine's logo. The ring
 * turns while the engine boots, and pulses once it can take the click that
 * starts the game, so the first screen a player sees is the same family as
 * every screen after it.
 *
 * This is an engine component - game-agnostic.
 */

import type { LoadProgress } from "../AssetLoader";
import { AudioManager } from "../AudioManager";
import { EngineVersion } from "../core/EngineVersion";
import { LoadingAnimation } from "./LoadingAnimation";
import { SHAG_PALETTE } from "./LoadingPalettes";
import { UIStyles } from "./UIStyles";

import "./components/styles/ConnectingOverlay.css";

/** The boot's steps in the order main runs them */
export const BOOT_STEPS = ["renderer", "packages", "engine", "lobby"] as const;
export type BootStep = (typeof BOOT_STEPS)[number];

const STEP_LABELS: Record<BootStep, string> = {
  renderer: "RENDERER",
  packages: "PACKAGES",
  engine: "ENGINE",
  lobby: "LOBBY",
};

export class LoadingScreen {
  private static instance: LoadingScreen | null = null;

  private container: HTMLDivElement;
  private kickerEl: HTMLElement;
  private statusEl: HTMLElement;
  private detailEl: HTMLElement;
  private nowEl: HTMLElement;
  private barEl: HTMLElement;
  private ringEl: HTMLButtonElement;
  private captionEl: HTMLElement;
  private stepEls: HTMLElement[] = [];
  private stepIndex = 0;

  // For force-dismiss from console
  private readyResolver: (() => void) | null = null;

  // Smoke animation (shared component)
  private smokeAnimation: LoadingAnimation | null = null;

  /** Enter or Space starts, as a click does, while the ring is offered */
  private readonly onKey = (event: KeyboardEvent): void => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    this.start();
  };

  constructor() {
    // Ensure styles are injected
    UIStyles.injectBase();

    const version = EngineVersion.getInstance();

    this.container = document.createElement("div");
    this.container.id = "loading-screen";
    this.container.className =
      "ui-loading-screen connecting-overlay connecting-overlay--loading connecting-overlay--boot";
    this.container.setAttribute("role", "dialog");
    this.container.setAttribute("aria-label", `${version.getEngineName()} is starting`);
    this.container.setAttribute("aria-busy", "true");

    const ambient = element("div", "connecting-overlay__ambient-word", "SHAG");
    ambient.setAttribute("aria-hidden", "true");

    // ── Rail: the boot's steps ──
    const rail = element("aside", "connecting-overlay__rail");
    const header = element("div", "connecting-overlay__rail-header");
    const railTitle = element("div", "connecting-overlay__rail-title");
    railTitle.append(element("span", "", "POWER"), element("span", "", "UP"));
    header.append(
      element("div", "connecting-overlay__brand", version.getEngineName()),
      element("div", "connecting-overlay__rail-kicker", "BOOT SEQUENCE"),
      railTitle,
    );

    const steps = element("ol", "connecting-overlay__steps");
    this.stepEls = BOOT_STEPS.map((step, index) => {
      const item = element("li", "connecting-overlay__step");
      const mark = element("span", "connecting-overlay__step-mark");
      mark.setAttribute("aria-hidden", "true");
      item.append(
        element("span", "connecting-overlay__step-number", `0${index + 1}`),
        element("span", "connecting-overlay__step-label", STEP_LABELS[step]),
        mark,
      );
      steps.appendChild(item);
      return item;
    });

    const endpoint = element("div", "connecting-overlay__endpoint");
    this.nowEl = element("span", "connecting-overlay__server", "Initializing...");
    endpoint.append(element("span", "connecting-overlay__endpoint-label", "NOW"), this.nowEl);

    const railFooter = element(
      "div",
      "connecting-overlay__rail-footer",
      `${version.getEngineName()} // ${version.getVersionString()}`,
    );
    rail.append(header, steps, endpoint, railFooter);

    // ── Stage: the ring with the logo, which starts the game ──
    const stage = element("main", "connecting-overlay__stage");
    const stageHeader = element("div", "connecting-overlay__stage-header");
    stageHeader.append(element("div", "connecting-overlay__sequence", "HIGHER STANDARD GAMES // BOOT"), deco());

    const hero = element("div", "connecting-overlay__hero");
    this.kickerEl = element("div", "connecting-overlay__kicker", "STARTING UP");

    this.ringEl = document.createElement("button");
    this.ringEl.type = "button";
    this.ringEl.className = "connecting-overlay__ring";
    this.ringEl.disabled = true;
    this.ringEl.setAttribute("aria-label", "Start");
    const sweep = element("span", "connecting-overlay__ring-sweep");
    const pulses = [
      element("span", "connecting-overlay__ring-pulse"),
      element("span", "connecting-overlay__ring-pulse"),
    ];
    const logo = document.createElement("img");
    logo.src = "engine.png";
    logo.alt = "";
    logo.width = 512;
    logo.height = 512;
    logo.className = "connecting-overlay__logo ui-loading-logo";
    this.ringEl.append(sweep, ...pulses, logo);

    // A touch screen is tapped, and has no Enter to press
    const touch = window.matchMedia?.("(pointer: coarse)").matches === true;
    this.captionEl = element("div", "connecting-overlay__ring-caption");
    this.captionEl.append(element("span", "", touch ? "Tap to start" : "Click to start"));
    if (!touch) this.captionEl.append(element("small", "", "or press Enter"));
    this.captionEl.hidden = true;

    const lead = element("p", "connecting-overlay__lead", version.getEngineTagline());
    hero.append(this.kickerEl, this.ringEl, this.captionEl, lead);

    const transfer = element("section", "connecting-overlay__transfer");
    transfer.setAttribute("aria-label", "Start-up progress");
    const statusHeader = element("div", "connecting-overlay__status-header");
    this.statusEl = element("div", "connecting-overlay__status", "RENDERER");
    this.statusEl.setAttribute("aria-live", "polite");
    statusHeader.append(element("span", "connecting-overlay__status-label", "BOOT STATUS"), this.statusEl);
    this.barEl = element("div", "connecting-overlay__bar");
    this.barEl.setAttribute("role", "progressbar");
    this.barEl.setAttribute("aria-label", "Starting up");
    this.barEl.setAttribute("aria-valuemin", "0");
    this.barEl.setAttribute("aria-valuemax", "100");
    this.barEl.appendChild(element("div", "connecting-overlay__bar-fill"));
    const transferFooter = element("div", "connecting-overlay__transfer-footer");
    this.detailEl = element("span", "connecting-overlay__detail");
    transferFooter.append(deco(), this.detailEl);
    transfer.append(statusHeader, this.barEl, transferFooter);

    stage.append(stageHeader, hero, transfer);
    this.container.append(ambient, rail, stage);
    this.setStep("renderer");
  }

  public show(): void {
    LoadingScreen.instance = this;
    document.body.appendChild(this.container);
  }

  /**
   * Check if loading screen is currently waiting for ready
   */
  public static isWaitingForReady(): boolean {
    return LoadingScreen.instance?.readyResolver !== null;
  }

  /**
   * Force dismiss the loading screen (e.g., when console opens)
   * This unlocks audio and resolves the waitForReady promise
   */
  public static forceDismiss(): void {
    const instance = LoadingScreen.instance;
    if (!instance || !instance.readyResolver) return;
    instance.start();
    console.log("[LoadingScreen] Force dismissed by console");
  }

  /** Move the rail to a boot step; the ones before it are done */
  public setStep(step: BootStep): void {
    this.stepIndex = Math.max(this.stepIndex, BOOT_STEPS.indexOf(step));
    this.stepEls.forEach((item, index) => {
      const state = index < this.stepIndex ? "done" : index === this.stepIndex ? "active" : "pending";
      item.classList.remove("is-done", "is-active", "is-pending");
      item.classList.add(`is-${state}`);
    });
    this.statusEl.textContent = STEP_LABELS[BOOT_STEPS[this.stepIndex]];
    this.setBar(this.stepIndex / BOOT_STEPS.length);
  }

  public updateProgress(progress: LoadProgress): void {
    const within = progress.total > 0 ? progress.current / progress.total : 0;
    this.setBar((this.stepIndex + within) / BOOT_STEPS.length);
    this.setStatus(progress.currentAsset || "Initializing...");
  }

  /**
   * Update the status text shown on the loading screen
   * @param status - Status message to display (e.g., "Indexing packages...", "Loading textures...")
   */
  public setStatus(status: string): void {
    this.nowEl.textContent = status;
    this.nowEl.title = status;
    this.detailEl.textContent = status;
  }

  /**
   * Static method to update status from anywhere
   */
  public static setStatus(status: string): void {
    if (LoadingScreen.instance) {
      LoadingScreen.instance.setStatus(status);
    }
  }

  /**
   * Offer the ring and wait for the player's click, which unlocks the
   * browser's audio. Boot carries on behind it.
   */
  public waitForReady(): Promise<void> {
    return new Promise((resolve) => {
      // Store resolver for force-dismiss capability
      this.readyResolver = resolve;

      this.container.classList.add("ui-loading-screen--ready");
      this.kickerEl.textContent = "READY";
      this.ringEl.disabled = false;
      this.captionEl.hidden = false;
      window.addEventListener("keydown", this.onKey);

      // Smoke effect - colored puffs rising and fading (using shared component)
      this.smokeAnimation = new LoadingAnimation();
      this.smokeAnimation.create(this.container, {
        colors: SHAG_PALETTE,
        puffCount: 30,
      });

      // Anywhere on the screen starts, not only the ring
      this.container.addEventListener("click", () => this.start(), { once: true });
    });
  }

  /** The player's click: sound on, and the game follows as soon as boot is done */
  private start(): void {
    const resolve = this.readyResolver;
    if (!resolve) return;
    this.readyResolver = null;
    window.removeEventListener("keydown", this.onKey);

    // Unlock browser audio context
    AudioManager.getInstance().unlockAudio();
    AudioManager.getInstance().loadPlaylist("data/menu.playlist.json");

    this.kickerEl.textContent = "STARTING";
    this.container.classList.add("ui-loading-screen--started");
    this.ringEl.disabled = true;
    this.captionEl.replaceChildren(element("span", "", "Starting"));
    resolve();
  }

  public hide(): void {
    window.removeEventListener("keydown", this.onKey);

    // Clean up animation
    if (this.smokeAnimation) {
      this.smokeAnimation.destroy();
      this.smokeAnimation = null;
    }

    this.stepEls.forEach((item) => {
      item.classList.remove("is-active", "is-pending");
      item.classList.add("is-done");
    });
    this.setBar(1);
    this.container.setAttribute("aria-busy", "false");
    this.container.classList.add("ui-loading-screen--hiding");
    setTimeout(() => {
      this.container.remove();
    }, 500);
  }

  private setBar(share: number): void {
    const clamped = Math.max(0, Math.min(1, share));
    this.container.style.setProperty("--co-progress", clamped.toFixed(3));
    this.barEl.setAttribute("aria-valuenow", String(Math.round(clamped * 100)));
  }
}

function element(tag: string, className: string, text?: string): HTMLElement {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** The handoff's diamond-and-dash ornament */
function deco(): HTMLElement {
  const node = element("div", "connecting-overlay__deco");
  node.setAttribute("aria-hidden", "true");
  for (let index = 0; index < 5; index++) node.appendChild(document.createElement("span"));
  return node;
}
