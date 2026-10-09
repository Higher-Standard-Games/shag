/**
 * ConnectingOverlay — Full-screen "GAME STARTING" overlay.
 *
 * Shown when all players are ready and the match server is starting.
 * Displays a connecting animation, then triggers the actual server connection
 * via the registered `NetworkConnector` (game modules register one at boot).
 * When the server's map starts loading, the map loading screen takes over.
 *
 * Built as the lobby's twin (LobbyTwin): the lobby's rail with the handoff's
 * steps and the server, and the lobby's stage with the match's title, its
 * status and bar. The lobby is what it comes up over, so only the content
 * changes.
 */
import { EventBus } from "../../core/EventBus";
import { LOADING_EVENTS, type LoadingStartEvent } from "../../core/LoadingEvents";
import { buildTwinLight, buildTwinRail, TWIN_ROOT_CLASS, type TwinRail } from "./LobbyTwin";
import { getNetworkConnector } from "./NetworkConnector";

// Import CSS
import "./styles/ConnectingOverlay.css";

export class ConnectingOverlay {
  private el: HTMLElement | null = null;
  private statusEl: HTMLElement | null = null;
  private dotsEl: HTMLElement | null = null;
  private noticeEl: HTMLElement | null = null;
  private rail: TwinRail | null = null;

  private dotInterval: number | null = null;
  private unsubscribeLoading: (() => void) | null = null;

  /**
   * Show the overlay and begin connecting to the given server URL.
   * The overlay stays visible until the map starts loading (lobby hides it),
   * or an error occurs.
   *
   * @param serverUrl - WebSocket URL of the game server
   * @param asSpectator - If true, connect as spectator (autoJoin=false)
   * @param requestSeat - For a spectator of a lobby match: how Join asks the lobby for a seat
   */
  async show(
    serverUrl: string = "ws://localhost:7777",
    asSpectator: boolean = false,
    admissionTicket?: string,
    recoverTicket?: () => Promise<string>,
    requestSeat?: () => Promise<void>,
  ): Promise<void> {
    // Don't double-show
    if (this.el) return;

    // Already watching this match: take the seat on the connection we have,
    // rather than dropping it and loading the map again behind this screen.
    if (!asSpectator && admissionTicket && getNetworkConnector()?.claimSeat?.(serverUrl, admissionTicket)) return;

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

      const options = { autoJoin: !asSpectator, watchOnly: asSpectator, admissionTicket, requestSeat };
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
      this.rail = null;
    }
  }

  /**
   * Build the overlay DOM.
   */
  private build(serverUrl: string, asSpectator: boolean = false): HTMLElement {
    const overlay = document.createElement("div");
    overlay.className = `connecting-overlay connecting-overlay--handoff ${TWIN_ROOT_CLASS}`;
    overlay.dataset.state = "preparing";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.setAttribute("aria-busy", "true");
    overlay.setAttribute("aria-label", asSpectator ? "Joining live match" : "Game starting");
    overlay.tabIndex = -1;

    const rail = buildTwinRail({
      label: asSpectator ? "Joining live match" : "Match handoff",
      steps: ["Server", "Handshake", "Map load"],
      context: asSpectator ? "Live channel" : "Match handoff",
    });
    rail.setFact("server", "Server", serverUrl);
    rail.setSteps(["done", "active", "pending"]);
    this.rail = rail;

    const stage = document.createElement("main");
    stage.className = "twin__stage connecting-overlay__stage";

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
    const wait = document.createElement("span");
    wait.textContent = "KEEP THIS WINDOW OPEN";
    transferFooter.appendChild(wait);

    const notices = document.createElement("div");
    notices.className = "connecting-overlay__notices";
    notices.setAttribute("aria-live", "assertive");
    this.noticeEl = notices;

    transfer.append(statusHeader, bar, transferFooter, notices);
    stage.append(hero, transfer);

    overlay.append(buildTwinLight(), rail.rail, stage);
    rail.log("Preparing");
    return overlay;
  }

  private setStatus(text: string): void {
    if (!this.statusEl) return;

    this.statusEl.textContent = text;
    if (this.dotsEl) this.statusEl.appendChild(this.dotsEl);
    this.rail?.log(text.charAt(0) + text.slice(1).toLowerCase());

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
    this.rail?.log(message);
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

  private isCompleteStatus(status: string): boolean {
    return ["CONNECTED", "SPECTATING", "ALREADY CONNECTED", "CONNECTION FAILED", "NO NETWORK ADAPTER"].includes(status);
  }

  private updateSteps(status: string): void {
    if (!this.rail) return;

    const success = ["CONNECTED", "SPECTATING", "ALREADY CONNECTED"].includes(status);
    const failure = ["CONNECTION FAILED", "NO NETWORK ADAPTER"].includes(status);
    this.rail.setSteps(
      success ? ["done", "done", "active"] : failure ? ["done", "error", "pending"] : ["done", "active", "pending"],
    );
  }
}
