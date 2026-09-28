/**
 * ConnectingOverlay — Full-screen "GAME STARTING" overlay.
 *
 * Shown when all players are ready and the match server is starting.
 * Displays a connecting animation, then triggers the actual server connection
 * via the registered `NetworkConnector` (game modules register one at boot).
 * When the server's map starts loading, the map loading screen takes over.
 */
import { EventBus } from "../../core/EventBus";
import { LOADING_EVENTS, type LoadingStartEvent } from "../../core/LoadingEvents";
import { getNetworkConnector } from "./NetworkConnector";

// Import CSS
import "./styles/ConnectingOverlay.css";

export class ConnectingOverlay {
  private el: HTMLElement | null = null;
  private statusEl: HTMLElement | null = null;
  private dotsEl: HTMLElement | null = null;
  private noticeEl: HTMLElement | null = null;
  private stepEls: HTMLElement[] = [];

  private dotInterval: number | null = null;
  private unsubscribeLoading: (() => void) | null = null;

  /**
   * Show the overlay and begin connecting to the given server URL.
   * The overlay stays visible until the map starts loading (lobby hides it),
   * or an error occurs.
   *
   * @param serverUrl - WebSocket URL of the game server
   * @param asSpectator - If true, connect as spectator (autoJoin=false)
   */
  async show(
    serverUrl: string = "ws://localhost:7777",
    asSpectator: boolean = false,
    admissionTicket?: string,
    recoverTicket?: () => Promise<string>,
  ): Promise<void> {
    // Don't double-show
    if (this.el) return;

    this.el = this.build(serverUrl, asSpectator);

    // Wait for fonts (Orbitron) to load before showing overlay
    // to prevent flash of unstyled text (FOUT)
    await document.fonts.ready;

    document.body.appendChild(this.el);
    this.el.focus({ preventScroll: true });

    // The map loading screen takes over the moment the map starts loading. It
    // listens first (lower priority runs later), so it still finds this screen
    // up and appears in its place rather than fading in over the lobby.
    this.unsubscribeLoading = EventBus.on(
      LOADING_EVENTS.START,
      (event: LoadingStartEvent) => {
        if (event.type === "map" && event.id !== "ui") this.hide();
      },
      -1,
    );

    // Start animated dots
    this.startDots();

    // Small delay for dramatic effect, then connect
    await this.delay(1200);
    this.setStatus("CONNECTING");

    await this.delay(600);

    try {
      const connector = getNetworkConnector();
      if (!connector) {
        // No game module has registered a connector — engine alone can't connect.
        this.setStatus("NO NETWORK ADAPTER");
        this.showError("No NetworkConnector registered. Did the game module load?");
        await this.delay(3000);
        this.hide();
        return;
      }

      // Check if already connected
      if (connector.isConnected()) {
        this.setStatus("ALREADY CONNECTED");
        await this.delay(1000);
        this.hide();
        return;
      }

      const options = { autoJoin: !asSpectator, watchOnly: asSpectator, admissionTicket };
      try {
        await connector.connect(serverUrl, options);
      } catch (error) {
        // A dropped pre-game socket releases its claim at the game server. The
        // same ticket can make one more attempt while it is still valid.
        if (admissionTicket && recoverTicket && String(error).includes("invalid match ticket")) {
          this.setStatus("RECOVERING SEAT");
          const replacement = await recoverTicket();
          await connector.connect(serverUrl, { ...options, admissionTicket: replacement });
        } else {
          if (!admissionTicket || connector.isConnected() || String(error).includes("invalid match ticket"))
            throw error;
          this.setStatus("RETRYING");
          await this.delay(1000);
          await connector.connect(serverUrl, options);
        }
      }
      this.setStatus(asSpectator ? "SPECTATING" : "CONNECTED");

      // Normally the map loading has taken over by now. A server already on the
      // map this client has loaded starts no load, so come down on our own.
      await this.delay(1500);
      this.hide();
    } catch (error) {
      this.setStatus("CONNECTION FAILED");
      this.showError(String(error));

      // Auto-hide after showing error
      await this.delay(3000);
      this.hide();
    }
  }

  /**
   * Remove the overlay from DOM.
   */
  hide(): void {
    this.stopDots();
    this.unsubscribeLoading?.();
    this.unsubscribeLoading = null;
    if (this.el) {
      this.el.remove();
      this.el = null;
      this.statusEl = null;
      this.dotsEl = null;
      this.noticeEl = null;
      this.stepEls = [];
    }
  }

  /**
   * Build the overlay DOM.
   */
  private build(serverUrl: string, asSpectator: boolean = false): HTMLElement {
    const overlay = document.createElement("div");
    overlay.className = "connecting-overlay";
    overlay.dataset.state = "preparing";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.setAttribute("aria-busy", "true");
    overlay.setAttribute("aria-label", asSpectator ? "Joining live match" : "Game starting");
    overlay.tabIndex = -1;

    const ambientWord = document.createElement("div");
    ambientWord.className = "connecting-overlay__ambient-word";
    ambientWord.setAttribute("aria-hidden", "true");
    ambientWord.textContent = asSpectator ? "WATCH" : "READY";

    const rail = document.createElement("aside");
    rail.className = "connecting-overlay__rail";

    const railHeader = document.createElement("div");
    railHeader.className = "connecting-overlay__rail-header";

    const brand = document.createElement("div");
    brand.className = "connecting-overlay__brand";
    brand.textContent = "WASHIKI // WASHOI";

    const railKicker = document.createElement("div");
    railKicker.className = "connecting-overlay__rail-kicker";
    railKicker.textContent = asSpectator ? "LIVE CHANNEL" : "MATCH HANDOFF";

    const railTitle = document.createElement("div");
    railTitle.className = "connecting-overlay__rail-title";
    railTitle.append(this.makeTitleLine(asSpectator ? "VIEW" : "SEAT"), this.makeTitleLine("SECURED"));

    railHeader.append(brand, railKicker, railTitle);

    const steps = document.createElement("ol");
    steps.className = "connecting-overlay__steps";
    ["SERVER", "HANDSHAKE", "MAP LOAD"].forEach((label, index) => {
      const step = document.createElement("li");
      step.className = `connecting-overlay__step ${index === 0 ? "is-done" : index === 1 ? "is-active" : "is-pending"}`;

      const number = document.createElement("span");
      number.className = "connecting-overlay__step-number";
      number.textContent = `0${index + 1}`;

      const text = document.createElement("span");
      text.className = "connecting-overlay__step-label";
      text.textContent = label;

      const mark = document.createElement("span");
      mark.className = "connecting-overlay__step-mark";
      mark.setAttribute("aria-hidden", "true");

      step.append(number, text, mark);
      steps.appendChild(step);
      this.stepEls.push(step);
    });

    const endpoint = document.createElement("div");
    endpoint.className = "connecting-overlay__endpoint";

    const endpointLabel = document.createElement("span");
    endpointLabel.className = "connecting-overlay__endpoint-label";
    endpointLabel.textContent = "MATCH SERVER";

    const endpointValue = document.createElement("span");
    endpointValue.className = "connecting-overlay__server";
    endpointValue.textContent = serverUrl;

    endpoint.append(endpointLabel, endpointValue);

    const railFooter = document.createElement("div");
    railFooter.className = "connecting-overlay__rail-footer";
    railFooter.textContent = "ONLINE // TRANSFER 01";

    rail.append(railHeader, steps, endpoint, railFooter);

    const stage = document.createElement("main");
    stage.className = "connecting-overlay__stage";

    const stageHeader = document.createElement("div");
    stageHeader.className = "connecting-overlay__stage-header";

    const sequence = document.createElement("div");
    sequence.className = "connecting-overlay__sequence";
    sequence.textContent = asSpectator ? "LIVE MATCH // SPECTATOR LINK" : "READY CHECK // MATCH TRANSFER";
    stageHeader.append(sequence, this.makeDeco());

    const hero = document.createElement("div");
    hero.className = "connecting-overlay__hero";

    const kicker = document.createElement("div");
    kicker.className = "connecting-overlay__kicker";
    kicker.textContent = asSpectator ? "LIVE MATCH AVAILABLE" : "MATCH SERVER ONLINE";

    const title = document.createElement("h1");
    title.className = "connecting-overlay__title";
    title.append(
      this.makeTitleLine(asSpectator ? "SPECTATING" : "GAME"),
      this.makeTitleLine(asSpectator ? "MATCH" : "STARTING"),
    );

    const lead = document.createElement("p");
    lead.className = "connecting-overlay__lead";
    lead.textContent = asSpectator
      ? "Opening a read-only seat on the live match server."
      : "Your match seat is reserved. Establishing the game connection now.";

    hero.append(kicker, title, lead);

    const transfer = document.createElement("section");
    transfer.className = "connecting-overlay__transfer";
    transfer.setAttribute("aria-label", "Connection progress");

    const statusHeader = document.createElement("div");
    statusHeader.className = "connecting-overlay__status-header";

    const statusLabel = document.createElement("span");
    statusLabel.className = "connecting-overlay__status-label";
    statusLabel.textContent = "TRANSFER STATUS";

    const status = document.createElement("div");
    status.className = "connecting-overlay__status";
    status.setAttribute("aria-live", "polite");
    status.setAttribute("aria-atomic", "true");
    this.statusEl = status;
    status.textContent = "PREPARING";

    const dots = document.createElement("span");
    dots.className = "connecting-overlay__dots";
    dots.setAttribute("aria-hidden", "true");
    this.dotsEl = dots;
    status.appendChild(dots);

    statusHeader.append(statusLabel, status);

    const bar = document.createElement("div");
    bar.className = "connecting-overlay__bar";
    bar.setAttribute("role", "progressbar");
    bar.setAttribute("aria-label", "Connecting to match server");
    const barFill = document.createElement("div");
    barFill.className = "connecting-overlay__bar-fill";
    bar.appendChild(barFill);

    const transferFooter = document.createElement("div");
    transferFooter.className = "connecting-overlay__transfer-footer";
    transferFooter.append(this.makeDeco());

    const wait = document.createElement("span");
    wait.textContent = "KEEP THIS WINDOW OPEN";
    transferFooter.appendChild(wait);

    const notices = document.createElement("div");
    notices.className = "connecting-overlay__notices";
    notices.setAttribute("aria-live", "assertive");
    this.noticeEl = notices;

    transfer.append(statusHeader, bar, transferFooter, notices);
    stage.append(stageHeader, hero, transfer);

    overlay.append(ambientWord, rail, stage);
    return overlay;
  }

  private setStatus(text: string): void {
    if (!this.statusEl) return;

    this.statusEl.textContent = text;
    if (this.dotsEl) this.statusEl.appendChild(this.dotsEl);

    const state = text.toLowerCase().replace(/ /g, "-");
    if (this.el) {
      this.el.dataset.state = state;
      this.el.setAttribute("aria-busy", this.isCompleteStatus(text) ? "false" : "true");
    }
    this.updateSteps(text);
  }

  private showError(message: string): void {
    if (!this.noticeEl) return;
    this.noticeEl.replaceChildren();

    const errorEl = document.createElement("div");
    errorEl.className = "connecting-overlay__error";
    errorEl.setAttribute("role", "alert");
    errorEl.textContent = message;
    this.noticeEl.appendChild(errorEl);
  }

  private startDots(): void {
    let count = 0;
    const dotsEl = this.dotsEl;
    if (!dotsEl) return;

    this.dotInterval = window.setInterval(() => {
      count = (count + 1) % 4;
      dotsEl.textContent = ".".repeat(count);
    }, 500);
  }

  private stopDots(): void {
    if (this.dotInterval !== null) {
      clearInterval(this.dotInterval);
      this.dotInterval = null;
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private makeTitleLine(text: string): HTMLElement {
    const line = document.createElement("span");
    line.textContent = text;
    return line;
  }

  private makeDeco(): HTMLElement {
    const deco = document.createElement("div");
    deco.className = "connecting-overlay__deco";
    deco.setAttribute("aria-hidden", "true");
    for (let index = 0; index < 5; index++) deco.appendChild(document.createElement("span"));
    return deco;
  }

  private isCompleteStatus(status: string): boolean {
    return ["CONNECTED", "SPECTATING", "ALREADY CONNECTED", "CONNECTION FAILED", "NO NETWORK ADAPTER"].includes(status);
  }

  private updateSteps(status: string): void {
    if (this.stepEls.length !== 3) return;

    const success = ["CONNECTED", "SPECTATING", "ALREADY CONNECTED"].includes(status);
    const failure = ["CONNECTION FAILED", "NO NETWORK ADAPTER"].includes(status);
    const states = success
      ? ["done", "done", "active"]
      : failure
        ? ["done", "error", "pending"]
        : ["done", "active", "pending"];

    this.stepEls.forEach((step, index) => {
      step.classList.remove("is-done", "is-active", "is-pending", "is-error");
      step.classList.add(`is-${states[index]}`);
    });
  }
}
