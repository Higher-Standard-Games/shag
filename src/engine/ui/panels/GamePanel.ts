/**
 * GamePanel — Immersive Full-Screen UI Panel
 *
 * A reusable full-viewport overlay with:
 * - Blurred gameplay edges (top/bottom strips with backdrop-filter)
 * - Angled neon divider lines (SVG gradient glow)
 * - Floating particles (CSS-only ambient sparkles)
 * - Kanji watermarks (faint background decoration)
 * - Scanline sweep (CRT holographic feel)
 *
 * Settings, server browser, and other full-screen UIs extend this class.
 *
 * Usage:
 *   class SettingsPanel extends GamePanel {
 *     constructor() {
 *       super('SETTINGS');
 *       // Add tabs, content, etc.
 *     }
 *   }
 */

import { LogoCanvas } from "../components/LogoCanvas";
import { UIStyles } from "../UIStyles";
import { clearParticles, spawnParticles } from "./effects/FloatingParticles";
import { createKanjiWatermarks } from "./effects/KanjiWatermark";
import { createNeonDivider } from "./effects/NeonDivider";
import gamePanelCSS from "./styles/GamePanel.css?raw";

export class GamePanel {
  protected root: HTMLElement;
  protected centerZone: HTMLElement;
  protected headerArea: HTMLElement;
  protected contentArea: HTMLElement;
  protected scrollInner: HTMLElement;
  protected footerArea: HTMLElement;
  protected titleEl: HTMLElement;
  protected titleDeco: HTMLElement;
  protected tabBar: HTMLElement;

  private visible: boolean = false;
  private particles: HTMLElement[] = [];
  private kanjiElements: HTMLElement[] = [];
  private onCloseCallback: (() => void) | null = null;
  private closingHandler: ((event: AnimationEvent) => void) | null = null;
  private escHandler: (e: KeyboardEvent) => void;
  private tabs: { id: string; label: string; content: HTMLElement; btn: HTMLElement }[] = [];

  private tabChangeCallback: ((tabId: string) => void) | null = null;

  /** If false, ESC key will not close this panel (e.g. main menu) */
  protected closable: boolean = true;
  protected logoCanvas: LogoCanvas | null = null;

  constructor(title?: string) {
    // Inject CSS (once)
    UIStyles.injectCSS("game-panel", gamePanelCSS);

    // Root overlay
    this.root = document.createElement("div");
    this.root.className = "game-panel";
    this.root.style.display = "none";

    // ── Blur zone: top ──
    const blurTop = document.createElement("div");
    blurTop.className = "game-panel__blur-top";
    this.root.appendChild(blurTop);

    // ── Neon divider: top ──
    this.root.appendChild(createNeonDivider("top"));

    // ── Center zone ──
    this.centerZone = document.createElement("div");
    this.centerZone.className = "game-panel__center";

    // Kanji watermarks
    this.kanjiElements = createKanjiWatermarks(this.centerZone);

    // Particle container
    const particleContainer = document.createElement("div");
    particleContainer.className = "game-panel__particles";
    this.centerZone.appendChild(particleContainer);

    // Scanline
    const scan = document.createElement("div");
    scan.className = "game-panel__scan";
    this.centerZone.appendChild(scan);

    // Header (title + deco + tab bar)
    this.headerArea = document.createElement("div");
    this.headerArea.className = "game-panel__header";

    this.titleEl = document.createElement("h2");
    this.titleEl.className = "game-panel__title";
    if (title) this.titleEl.textContent = title;
    this.headerArea.appendChild(this.titleEl);

    // Decorative dots under title
    this.titleDeco = document.createElement("div");
    this.titleDeco.className = "game-panel__title-deco";
    for (let i = 0; i < 5; i++) {
      this.titleDeco.appendChild(document.createElement("span"));
    }
    this.headerArea.appendChild(this.titleDeco);

    // Tab bar (empty by default — subclasses populate via addTab)
    this.tabBar = document.createElement("div");
    this.tabBar.className = "game-panel__tabs";
    this.headerArea.appendChild(this.tabBar);

    this.centerZone.appendChild(this.headerArea);

    // Content area (scrollable)
    this.contentArea = document.createElement("div");
    this.contentArea.className = "game-panel__content";

    this.scrollInner = document.createElement("div");
    this.scrollInner.className = "game-panel__scroll";
    this.contentArea.appendChild(this.scrollInner);

    this.centerZone.appendChild(this.contentArea);

    // Footer
    this.footerArea = document.createElement("div");
    this.footerArea.className = "game-panel__footer";
    this.centerZone.appendChild(this.footerArea);

    this.root.appendChild(this.centerZone);

    // ── Neon divider: bottom ──
    this.root.appendChild(createNeonDivider("bottom"));

    // ── Blur zone: bottom ──
    const blurBot = document.createElement("div");
    blurBot.className = "game-panel__blur-bot";
    this.root.appendChild(blurBot);

    // Append to DOM
    document.body.appendChild(this.root);

    // Spawn particles (lazy — only when opened)
    this.particles = [];

    // ESC key handler
    this.escHandler = (e: KeyboardEvent) => {
      if (e.key === "Escape" && this.visible && this.closable) {
        this.close();
        e.preventDefault();
        e.stopPropagation();
      }
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Public API
  // ═══════════════════════════════════════════════════════════════════════════

  public open(): void {
    if (this.visible) return;
    this.cancelCloseAnimation();
    this.visible = true;

    // Spawn particles if not already present
    if (this.particles.length === 0) {
      const container = this.centerZone.querySelector(".game-panel__particles") as HTMLElement;
      if (container) {
        this.particles = spawnParticles(container, { count: 22 });
      }
    }

    this.root.classList.remove("game-panel--closing");
    this.root.style.display = "";
    document.addEventListener("keydown", this.escHandler, true);

    // Resume logo rendering
    this.logoCanvas?.start();
  }

  public close(): void {
    if (!this.visible) return;
    this.visible = false;
    document.removeEventListener("keydown", this.escHandler, true);

    // Exit animation then hide
    this.root.classList.add("game-panel--closing");
    const onEnd = (event: AnimationEvent) => {
      if (event.target !== this.root) return;
      this.cancelCloseAnimation();
      this.root.style.display = "none";
      this.root.classList.remove("game-panel--closing");

      // Cleanup particles
      clearParticles(this.particles);

      if (this.onCloseCallback) {
        this.onCloseCallback();
      }
    };
    this.closingHandler = onEnd;
    this.root.addEventListener("animationend", onEnd);

    // Pause logo rendering
    this.logoCanvas?.pause();
  }

  private cancelCloseAnimation(): void {
    if (this.closingHandler) this.root.removeEventListener("animationend", this.closingHandler);
    this.closingHandler = null;
  }

  public isOpen(): boolean {
    return this.visible;
  }

  public setTitle(title: string): void {
    this.titleEl.textContent = title;
  }

  public onClose(callback: () => void): void {
    this.onCloseCallback = callback;
  }

  public destroy(): void {
    this.cancelCloseAnimation();
    document.removeEventListener("keydown", this.escHandler, true);
    clearParticles(this.particles);
    for (const el of this.kanjiElements) el.remove();
    this.logoCanvas?.dispose();
    this.root.remove();
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Protected Helpers (for subclasses)
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Set content in the scrollable area. Clears existing content.
   */
  protected setContent(element: HTMLElement): void {
    this.scrollInner.innerHTML = "";
    this.scrollInner.appendChild(element);
  }

  /** Opt-in full-viewport rail shell for menus that provide their own navigation. */
  protected useRailLayout(rail: HTMLElement): void {
    this.root.classList.add("game-panel--rail");
    this.root.insertBefore(rail, this.centerZone);
  }

  /**
   * Get the scrollable inner container (for appending content directly).
   */
  protected getScrollContainer(): HTMLElement {
    return this.scrollInner;
  }

  /**
   * Enable the 3D logo floating OVER the panel top edge.
   * The logo is bigger and centered on the top border line,
   * overlapping outside the panel for dramatic effect.
   * Call from subclass constructor after super().
   */
  protected enableLogo(opts?: { width?: number; height?: number }): void {
    this.logoCanvas = new LogoCanvas({
      width: opts?.width ?? 600,
      height: opts?.height ?? 200,
      showGlow: true,
    });

    // Hide text title + decoration
    this.titleEl.style.display = "none";
    this.titleDeco.style.display = "none";

    // Add logo to ROOT (not header) so it can float above the panel
    const logoEl = this.logoCanvas.getElement();
    logoEl.classList.add("game-panel__logo-float");
    this.root.appendChild(logoEl);

    // Init after a tick (needs to be in DOM)
    requestAnimationFrame(() => {
      this.logoCanvas?.init();
    });
  }

  /**
   * Create a styled button for the footer.
   */
  protected createButton(text: string, variant: string = "", onClick?: () => void): HTMLButtonElement {
    const btn = document.createElement("button");
    btn.className = `fps-btn ${variant}`.trim();
    btn.textContent = text;
    if (onClick) btn.addEventListener("click", onClick);
    return btn;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Tab Management
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Add a tab to the tab bar.
   */
  protected addTab(id: string, label: string, content: HTMLElement): void {
    const btn = document.createElement("button");
    btn.className = "game-panel__tab";
    btn.textContent = label;
    btn.dataset.tabId = id;
    btn.addEventListener("click", () => this.switchTab(id));
    this.tabBar.appendChild(btn);

    this.tabs.push({ id, label, content, btn });
  }

  /**
   * Switch to a tab by ID.
   */
  protected switchTab(tabId: string): void {
    // Update tab button states
    for (const tab of this.tabs) {
      tab.btn.classList.toggle("game-panel__tab--active", tab.id === tabId);
    }

    // Swap content
    this.scrollInner.innerHTML = "";
    const tab = this.tabs.find((t) => t.id === tabId);
    if (tab) {
      this.scrollInner.appendChild(tab.content);
    }

    if (this.tabChangeCallback) {
      this.tabChangeCallback(tabId);
    }
  }

  /**
   * Register callback when tab changes.
   */
  protected onTabChange(callback: (tabId: string) => void): void {
    this.tabChangeCallback = callback;
  }
}
