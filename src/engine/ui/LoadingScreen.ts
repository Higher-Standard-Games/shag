/**
 * LoadingScreen - Engine-level loading and ready screen
 *
 * Handles:
 * 1. Boot progress: the renderer, the packages, the engine, the lobby
 * 2. "Click to start" once the engine can take the click (unlocks browser audio)
 *
 * It is built as the lobby's twin (LobbyTwin), because the lobby takes
 * over from it: the gold rail at the lobby's width with the game's logo where
 * the lobby has it, the boot's steps as the rail's keys (the current one
 * latched in ink, as the lobby marks the page you are on), a log where the
 * lobby lists rooms, the engine in the player card's place and the utility
 * keys below; the stage is the lobby's blue, with a ring holding the engine's
 * logo that turns while the engine boots and pulses once it can take the click
 * that starts the game. When the lobby comes up, the rail stays where it is.
 *
 * This is an engine component - game-agnostic. The game names its brand with
 * `configureLobbyTwin`.
 */

import type { LoadProgress } from "../AssetLoader";
import { AudioManager } from "../AudioManager";
import { EngineVersion } from "../core/EngineVersion";
import { buildTwinLight, buildTwinRail, TWIN_ROOT_CLASS, type TwinRail } from "./components/LobbyTwin";
import { LoadingAnimation } from "./LoadingAnimation";
import { SHAG_PALETTE } from "./LoadingPalettes";
import { UIStyles } from "./UIStyles";

import "./components/styles/BootScreen.css";

/** The boot's steps in the order main runs them */
export const BOOT_STEPS = ["renderer", "packages", "engine", "lobby"] as const;
export type BootStep = (typeof BOOT_STEPS)[number];

const STEP_LABELS: Record<BootStep, string> = {
  renderer: "Renderer",
  packages: "Packages",
  engine: "Engine",
  lobby: "Lobby",
};

export class LoadingScreen {
  private static instance: LoadingScreen | null = null;

  private container: HTMLDivElement;
  private kickerEl: HTMLElement;
  private statusEl: HTMLElement;
  private rail: TwinRail;
  private barEl: HTMLElement;
  private ringEl: HTMLButtonElement;
  private captionEl: HTMLElement;
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
    this.container.className = `ui-loading-screen ${TWIN_ROOT_CLASS} boot`;
    this.container.setAttribute("role", "dialog");
    this.container.setAttribute("aria-label", `${version.getEngineName()} is starting`);
    this.container.setAttribute("aria-busy", "true");

    // ── Rail: the lobby's, with the boot in it ──
    this.rail = buildTwinRail({
      label: "Start-up",
      steps: BOOT_STEPS.map((step) => STEP_LABELS[step]),
      context: "Boot log",
    });

    // ── Stage: the ring with the engine's logo, which starts the game ──
    const stage = element("main", "twin__stage boot__stage");

    const hero = element("div", "boot__hero");
    this.kickerEl = element("div", "boot__kicker", "Starting up");

    this.ringEl = document.createElement("button");
    this.ringEl.type = "button";
    this.ringEl.className = "boot__ring";
    this.ringEl.disabled = true;
    this.ringEl.setAttribute("aria-label", "Start");
    const sweep = element("span", "boot__ring-sweep");
    const pulses = [element("span", "boot__ring-pulse"), element("span", "boot__ring-pulse")];
    const logo = document.createElement("img");
    logo.src = "engine.png";
    logo.alt = "";
    logo.width = 512;
    logo.height = 512;
    logo.className = "boot__logo ui-loading-logo";
    this.ringEl.append(sweep, ...pulses, logo);

    // A touch screen is tapped, and has no Enter to press
    const touch = window.matchMedia?.("(pointer: coarse)").matches === true;
    this.captionEl = element("div", "boot__caption");
    this.captionEl.append(element("span", "", touch ? "Tap to start" : "Click to start"));
    if (!touch) this.captionEl.append(element("small", "", "or press Enter"));
    this.captionEl.hidden = true;

    const lead = element("p", "boot__lead", version.getEngineTagline());
    hero.append(this.kickerEl, this.ringEl, this.captionEl, lead);

    const progress = element("section", "boot__progress");
    progress.setAttribute("aria-label", "Start-up progress");
    const progressHead = element("div", "boot__progress-head");
    this.statusEl = element("div", "boot__status", "RENDERER");
    progressHead.append(element("span", "boot__progress-label", "Boot status"), this.statusEl);
    this.barEl = element("div", "boot__bar");
    this.barEl.setAttribute("role", "progressbar");
    this.barEl.setAttribute("aria-label", "Starting up");
    this.barEl.setAttribute("aria-valuemin", "0");
    this.barEl.setAttribute("aria-valuemax", "100");
    this.barEl.appendChild(element("div", "boot__bar-fill"));
    progress.append(progressHead, this.barEl);

    stage.append(hero, progress);
    this.container.append(buildTwinLight(), this.rail.rail, stage);
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
    this.rail.setSteps(
      BOOT_STEPS.map((_, index) => (index < this.stepIndex ? "done" : index === this.stepIndex ? "active" : "pending")),
    );
    this.statusEl.textContent = STEP_LABELS[BOOT_STEPS[this.stepIndex]].toUpperCase();
    this.setBar(this.stepIndex / BOOT_STEPS.length);
  }

  public updateProgress(progress: LoadProgress): void {
    const within = progress.total > 0 ? progress.current / progress.total : 0;
    this.setBar((this.stepIndex + within) / BOOT_STEPS.length);
    this.setStatus(progress.currentAsset || "Initializing...");
  }

  /**
   * Add a line to the boot log: what the engine is doing now.
   * @param status - Status message to display (e.g., "Indexing packages...", "Loading textures...")
   */
  public setStatus(status: string): void {
    this.rail.log(status);
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
      this.kickerEl.textContent = "Ready";
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

    this.kickerEl.textContent = "Starting";
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

    this.rail.setSteps(BOOT_STEPS.map(() => "done"));
    this.setBar(1);
    this.container.setAttribute("aria-busy", "false");
    this.container.classList.add("ui-loading-screen--hiding");
    setTimeout(() => {
      this.container.remove();
    }, 500);
  }

  private setBar(share: number): void {
    const clamped = Math.max(0, Math.min(1, share));
    this.container.style.setProperty("--boot-progress", clamped.toFixed(3));
    this.barEl.setAttribute("aria-valuenow", String(Math.round(clamped * 100)));
  }
}

function element(tag: string, className: string, text?: string): HTMLElement {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
