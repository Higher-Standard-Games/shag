/**
 * DebugConsole - Quake-style dropdown debug console
 *
 * Engine-level debugging console that opens with tilde key.
 * Features:
 * - Command history with up/down arrows
 * - Tab autocomplete
 * - Captures console.log output
 * - Persists history to localStorage
 */

import { CommandRegistry } from "../console/CommandRegistry";
import { Cvar } from "../core/Cvar";
import { EngineVersion } from "../core/EngineVersion";
import { createRaisedKey } from "../ui/components/RaisedKey";
import { DeveloperBar } from "./DeveloperBar";
import "./debug-console.css";
import { background, logRejection } from "../core/AsyncErrors";

const HISTORY_KEY = "debug_console_history";
const CONSOLE_SIZE_KEY = "debug_console_size";
const LOG_HISTORY_SIZE_KEY = "debug_console_log_history_size";
const MAX_HISTORY = 100;
const MAX_OUTPUT_LINES = 500;
const DEFAULT_CONSOLE_SIZE = 0.5; // 0.5 = half screen, 1.0 = full screen
const DEFAULT_LOG_HISTORY_SIZE = 5000; // Number of log lines to keep in memory

export class DebugConsole {
  private static instance: DebugConsole;

  private enabled: boolean = false;
  private isOpen: boolean = false;
  private consoleSize: number = DEFAULT_CONSOLE_SIZE;

  // DOM elements
  private container: HTMLDivElement | null = null;
  private outputEl: HTMLDivElement | null = null;
  private inputEl: HTMLInputElement | null = null;
  private autocompleteEl: HTMLDivElement | null = null;
  private helpPopoverEl: HTMLDivElement | null = null;

  // State
  private commandHistory: string[] = [];
  private historyIndex: number = -1;
  private currentInput: string = "";
  private logHistory: string[] = []; // Full log history for searching
  private logHistorySize: number = DEFAULT_LOG_HISTORY_SIZE;
  private autocompleteItems: string[] = [];
  private autocompleteIndex: number = -1;

  // Tab completion state
  private lastTabTime: number = 0;
  private lastTabInput: string = "";
  private lastTabMatches: string[] = [];

  // Original console methods
  private originalLog: typeof console.log;
  private originalWarn: typeof console.warn;
  private originalError: typeof console.error;
  private originalInfo: typeof console.info;

  private keyHandler: ((e: KeyboardEvent) => void) | null = null;

  private constructor() {
    // Store original console methods
    this.originalLog = console.log.bind(console);
    this.originalWarn = console.warn.bind(console);
    this.originalError = console.error.bind(console);
    this.originalInfo = console.info.bind(console);

    this.loadHistory();
    this.loadConsoleSize();
    this.loadLogHistorySize();
  }

  static getInstance(): DebugConsole {
    if (!DebugConsole.instance) {
      DebugConsole.instance = new DebugConsole();
    }
    return DebugConsole.instance;
  }

  /**
   * Enable the debug console (call once at startup)
   */
  enable(): void {
    if (this.enabled) return;

    // Only enable on desktop (check for touch)
    if (this.isMobileDevice()) {
      this.originalLog("[DebugConsole] Disabled on mobile devices");
      return;
    }

    this.enabled = true;
    this.createDOM();
    this.setupKeyboardHandler();
    this.interceptConsoleLogs();
    this.registerBuiltinCommands();

    this.log("system", "Debug console enabled. Press ~ to toggle.");
  }

  /**
   * Disable the debug console
   */
  disable(): void {
    if (!this.enabled) return;

    this.enabled = false;
    this.restoreConsoleLogs();
    this.removeKeyboardHandler();
    this.destroyDOM();
  }

  /**
   * Check if running on mobile
   */
  private isMobileDevice(): boolean {
    return (
      /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) ||
      ("ontouchstart" in window && navigator.maxTouchPoints > 0)
    );
  }

  /**
   * Toggle console visibility
   */
  toggle(): void {
    if (!this.enabled) return;

    this.isOpen = !this.isOpen;

    if (this.container) {
      this.container.classList.toggle("open", this.isOpen);
      // Closed, it sits above the screen: out of Tab's reach and the reading order
      this.container.toggleAttribute("inert", !this.isOpen);
    }

    if (this.isOpen) {
      // Opening console - release input grabs and dismiss loading screen
      const wasLocked = !!document.pointerLockElement;
      this.onConsoleOpen();
      this.focusInputAfterOpen(wasLocked);
    } else {
      this.inputEl?.blur();
      this.hideAutocomplete();
    }
  }

  /**
   * Put the cursor in the input line, and keep it there through what opening
   * sets off: releasing pointer lock makes the game show its pause menu, which
   * takes focus once the release lands, after this call.
   */
  private focusInputAfterOpen(releasingPointerLock: boolean): void {
    const refocus = () => {
      if (this.isOpen && this.inputEl && document.activeElement !== this.inputEl) this.inputEl.focus();
    };
    refocus();
    requestAnimationFrame(refocus);
    if (releasingPointerLock) {
      document.addEventListener("pointerlockchange", () => setTimeout(refocus, 0), { once: true });
    }
  }

  /**
   * Called when console opens - handles input release and loading screen dismiss
   */
  private onConsoleOpen(): void {
    // Release pointer lock so user can type freely
    if (document.pointerLockElement) {
      document.exitPointerLock();
    }

    // Dismiss loading screen if waiting for ready
    // Use dynamic import to avoid circular dependency
    import("../ui/LoadingScreen")
      .then(({ LoadingScreen }) => {
        if (LoadingScreen.isWaitingForReady()) {
          LoadingScreen.forceDismiss();
        }
      })
      .catch(() => {
        // Ignore import errors (loading screen may not be available)
      });
  }

  /**
   * Open the console
   */
  open(): void {
    if (!this.enabled || this.isOpen) return;
    this.toggle();
  }

  /**
   * Close the console
   */
  close(): void {
    if (!this.enabled || !this.isOpen) return;
    this.toggle();
  }

  /**
   * Check if console is currently open
   */
  getIsOpen(): boolean {
    return this.isOpen;
  }

  // ============================================================================
  // DOM Creation
  // ============================================================================

  private createDOM(): void {
    // Main container
    this.container = document.createElement("div");
    this.container.className = "debug-console";
    this.container.innerHTML = `
      <div class="debug-console-header">
        <div class="debug-console-header-top">
          <span class="debug-console-title">${EngineVersion.getInstance().getEngineName()} Console</span>
          <span class="debug-console-version">${EngineVersion.getInstance().getVersionString()} "${EngineVersion.getInstance().getRandomQuote()}"</span>
          <span class="debug-console-close" title="Close console">✕</span>
        </div>
        <div class="debug-console-actions"></div>
      </div>
      <div class="debug-console-output"></div>
      <div class="debug-console-input-container">
        <span class="debug-console-prompt">></span>
        <input type="text" class="debug-console-input" placeholder="Type a command... (Tab for autocomplete)" spellcheck="false" autocomplete="off">
        <div class="debug-console-autocomplete"></div>
      </div>
    `;

    this.container.toggleAttribute("inert", !this.isOpen);
    document.body.appendChild(this.container);

    // Get references
    this.outputEl = this.container.querySelector(".debug-console-output");
    this.inputEl = this.container.querySelector(".debug-console-input");
    this.autocompleteEl = this.container.querySelector(".debug-console-autocomplete");

    // Setup input handlers
    this.inputEl?.addEventListener("keydown", (e) => this.handleInputKeydown(e));
    this.inputEl?.addEventListener("input", () => this.handleInputChange());

    // Click delegation for clickable commands in output
    this.outputEl?.addEventListener("click", (e) => {
      const target = e.target as HTMLElement;
      const cmd = target.getAttribute("data-cmd");
      if (cmd) {
        e.preventDefault();
        background(this.executeCommand(cmd), "DebugConsole");
      }
    });

    this.setupHelpHover();

    // Apply saved console size
    this.applyConsoleSize();

    // Close button handler
    const closeBtn = this.container.querySelector(".debug-console-close");
    closeBtn?.addEventListener("click", () => this.toggle());

    this.createActionButtons();
  }

  /**
   * Action row: the same raised-key widget the main menu's own buttons use
   * (`src/engine/ui/components/RaisedKey.ts`), so the console's buttons read
   * as the same product instead of a themed `<button>` of their own. The
   * "ink" variant is the dark, gold-lettered face — the one meant to sit on
   * a dark background, which the console always is.
   */
  private createActionButtons(): void {
    const row = this.container?.querySelector<HTMLDivElement>(".debug-console-actions");
    if (!row) return;

    const inspectBtn = createRaisedKey({ label: "Inspect", variants: ["sm", "inline", "ink"] });
    inspectBtn.title = "Run: inspect";
    inspectBtn.addEventListener("click", () => {
      this.log("command", "inspect");
      CommandRegistry.getInstance()
        .execute("inspect")
        .then((result) => {
          if (result) this.log("result", result);
        })
        .catch(logRejection("DebugConsole"));
    });

    const helpBtn = createRaisedKey({ label: "Help", variants: ["sm", "inline", "ink"] });
    helpBtn.classList.add("console-help-btn");
    helpBtn.title = "Run: help";
    helpBtn.addEventListener("click", () => this.executeCommand("help"));

    const sizeBtn = createRaisedKey({ label: "Size", variants: ["sm", "inline", "ink"] });
    sizeBtn.title = "Cycle console size";
    sizeBtn.addEventListener("click", () => {
      const sizes = [0.5, 0.75, 1.0];
      const current = sizes.findIndex((s) => Math.abs(s - this.consoleSize) < 0.01);
      const next = sizes[(current + 1) % sizes.length];
      this.log("command", `con_size ${next}`);
      this.log("result", this.setSize(next));
    });

    const clearBtn = createRaisedKey({ label: "Clear", variants: ["sm", "inline", "ink"] });
    clearBtn.addEventListener("click", () => this.executeCommand("clear"));

    inspectBtn.classList.add("console-inspect-btn");
    sizeBtn.classList.add("console-size-btn");
    clearBtn.classList.add("console-clear-btn");
    row.append(inspectBtn, helpBtn, sizeBtn, clearBtn);
  }

  /**
   * Delegated hover help: a `.console-help-term[data-help-cmd]` element in
   * the output or autocomplete dropdown shows that command's full
   * `help <command>` text in a floating popover. One listener pair handles
   * every such element, present or future, instead of attaching one per
   * span — `mouseover`/`mouseout` are used (not `mouseenter`/`mouseleave`,
   * which don't bubble) so delegation on a static container works.
   */
  private setupHelpHover(): void {
    if (!this.container) return;

    this.helpPopoverEl = document.createElement("div");
    this.helpPopoverEl.className = "console-help-popover";
    document.body.appendChild(this.helpPopoverEl);

    this.container.addEventListener("mouseover", (e) => {
      const target = (e.target as HTMLElement).closest<HTMLElement>(".console-help-term");
      if (!target) return;
      this.showHelpPopover(target);
    });

    this.container.addEventListener("mouseout", (e) => {
      const target = (e.target as HTMLElement).closest<HTMLElement>(".console-help-term");
      const related = (e.relatedTarget as HTMLElement | null)?.closest<HTMLElement>(".console-help-term");
      if (target && target !== related) {
        this.hideHelpPopover();
      }
    });
  }

  private showHelpPopover(term: HTMLElement): void {
    const cmd = term.getAttribute("data-help-cmd");
    if (!cmd || !this.helpPopoverEl) return;

    const text = CommandRegistry.getInstance().getHelp(cmd);
    if (!text) return;

    this.helpPopoverEl.textContent = text;
    this.helpPopoverEl.classList.add("visible");

    const rect = term.getBoundingClientRect();
    const popover = this.helpPopoverEl;
    // Measure after making it visible so offsetWidth/Height are real.
    const maxLeft = window.innerWidth - popover.offsetWidth - 8;
    popover.style.left = `${Math.max(8, Math.min(rect.left, maxLeft))}px`;
    popover.style.top = `${rect.bottom + 6}px`;
  }

  private hideHelpPopover(): void {
    this.helpPopoverEl?.classList.remove("visible");
  }

  private destroyDOM(): void {
    this.container?.remove();
    this.container = null;
    this.helpPopoverEl?.remove();
    this.helpPopoverEl = null;
    this.outputEl = null;
    this.inputEl = null;
    this.autocompleteEl = null;
  }

  // ============================================================================
  // Keyboard Handling
  // ============================================================================

  private setupKeyboardHandler(): void {
    this.keyHandler = (e: KeyboardEvent) => {
      // Tilde key (` or ~) - toggle console
      if (e.key === "`" || e.key === "~" || e.code === "Backquote") {
        // Don't toggle if typing in an input (unless it's our console input)
        const target = e.target as HTMLElement;
        if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") {
          if (target !== this.inputEl) return;
        }

        e.preventDefault();
        e.stopPropagation();
        this.toggle();
      }

      // Escape - close console
      if (e.key === "Escape" && this.isOpen) {
        e.preventDefault();
        this.close();
      }
    };

    document.addEventListener("keydown", this.keyHandler, true);
  }

  private removeKeyboardHandler(): void {
    if (this.keyHandler) {
      document.removeEventListener("keydown", this.keyHandler, true);
      this.keyHandler = null;
    }
  }

  private handleInputKeydown(e: KeyboardEvent): void {
    switch (e.key) {
      case "Enter":
        e.preventDefault();
        background(this.executeCurrentInput(), "DebugConsole");
        break;

      case "ArrowUp":
        e.preventDefault();
        this.navigateHistory(1); // Go to older commands
        break;

      case "ArrowDown":
        e.preventDefault();
        this.navigateHistory(-1); // Go to newer commands
        break;

      case "Tab":
        e.preventDefault();
        this.handleTabComplete();
        break;

      case "Escape":
        if (this.autocompleteItems.length > 0) {
          e.preventDefault();
          this.hideAutocomplete();
        }
        break;
    }
  }

  private handleInputChange(): void {
    const value = this.inputEl?.value || "";
    this.currentInput = value;
    this.updateAutocomplete(value);
  }

  // ============================================================================
  // Command Execution
  // ============================================================================

  private async executeCurrentInput(): Promise<void> {
    const input = this.inputEl?.value.trim() || "";
    if (!input) return;

    // Add to history
    this.addToHistory(input);

    // Clear input
    if (this.inputEl) {
      this.inputEl.value = "";
    }
    this.historyIndex = -1;
    this.currentInput = "";
    this.hideAutocomplete();

    // Log the command
    this.log("command", input);

    // Execute
    const registry = CommandRegistry.getInstance();
    const result = await registry.execute(input);

    if (result) {
      this.log("result", result);
    }
  }

  // ============================================================================
  // History
  // ============================================================================

  private addToHistory(command: string): void {
    // Don't add duplicates of the last command
    if (this.commandHistory[0] === command) return;

    this.commandHistory.unshift(command);

    // Limit history size
    if (this.commandHistory.length > MAX_HISTORY) {
      this.commandHistory.pop();
    }

    this.saveHistory();
  }

  private navigateHistory(direction: number): void {
    if (this.commandHistory.length === 0) return;

    // Save current input if starting to navigate (going up from fresh input)
    if (this.historyIndex === -1 && direction === 1) {
      this.currentInput = this.inputEl?.value || "";
    }

    // direction: 1 = up (older), -1 = down (newer)
    this.historyIndex += direction;

    // Clamp: -1 means current input, 0+ means history
    if (this.historyIndex < -1) {
      this.historyIndex = -1;
    } else if (this.historyIndex >= this.commandHistory.length) {
      this.historyIndex = this.commandHistory.length - 1;
    }

    // Set input value
    if (this.inputEl) {
      if (this.historyIndex === -1) {
        this.inputEl.value = this.currentInput;
      } else {
        this.inputEl.value = this.commandHistory[this.historyIndex];
      }
      // Move cursor to end
      this.inputEl.selectionStart = this.inputEl.selectionEnd = this.inputEl.value.length;
    }
  }

  private loadHistory(): void {
    try {
      const saved = localStorage.getItem(HISTORY_KEY);
      if (saved) {
        this.commandHistory = JSON.parse(saved);
      }
    } catch {
      this.commandHistory = [];
    }
  }

  private saveHistory(): void {
    try {
      localStorage.setItem(HISTORY_KEY, JSON.stringify(this.commandHistory));
    } catch {
      // Ignore storage errors
    }
  }

  // ============================================================================
  // Console Size (con_size)
  // ============================================================================

  private loadConsoleSize(): void {
    try {
      const saved = localStorage.getItem(CONSOLE_SIZE_KEY);
      if (saved) {
        const size = parseFloat(saved);
        if (!Number.isNaN(size) && size >= 0.1 && size <= 1.0) {
          this.consoleSize = size;
        }
      }
    } catch {
      this.consoleSize = DEFAULT_CONSOLE_SIZE;
    }
  }

  private saveConsoleSize(): void {
    try {
      localStorage.setItem(CONSOLE_SIZE_KEY, this.consoleSize.toString());
    } catch {
      // Ignore storage errors
    }
  }

  private loadLogHistorySize(): void {
    try {
      const saved = localStorage.getItem(LOG_HISTORY_SIZE_KEY);
      if (saved) {
        const size = parseInt(saved, 10);
        if (!Number.isNaN(size) && size >= 100 && size <= 50000) {
          this.logHistorySize = size;
        }
      }
    } catch {
      this.logHistorySize = DEFAULT_LOG_HISTORY_SIZE;
    }
  }

  private saveLogHistorySize(): void {
    try {
      localStorage.setItem(LOG_HISTORY_SIZE_KEY, this.logHistorySize.toString());
    } catch {
      // Ignore storage errors
    }
  }

  /**
   * Set log history size (100 to 50000)
   */
  setLogHistorySize(size: number): string {
    if (size < 100 || size > 50000) {
      return `Invalid size: ${size}. Must be between 100 and 50000`;
    }

    this.logHistorySize = size;
    this.saveLogHistorySize();

    // Trim existing history if needed
    while (this.logHistory.length > this.logHistorySize) {
      this.logHistory.shift();
    }

    return `Log history size set to ${size} lines`;
  }

  /**
   * Get current log history size
   */
  getLogHistorySize(): number {
    return this.logHistorySize;
  }

  /**
   * Search log history with wildcard pattern
   */
  findInLog(pattern: string, maxResults: number = 50): string[] {
    if (!pattern) return [];

    // Convert wildcard pattern to regex (case-insensitive)
    // * matches any characters, ? matches single character
    const regexPattern = pattern
      .replace(/[.+^${}()|[\]\\]/g, "\\$&") // Escape special regex chars
      .replace(/\*/g, ".*")
      .replace(/\?/g, ".");

    const regex = new RegExp(regexPattern, "i");
    const results: string[] = [];

    for (let i = this.logHistory.length - 1; i >= 0 && results.length < maxResults; i--) {
      if (regex.test(this.logHistory[i])) {
        results.unshift(this.logHistory[i]);
      }
    }

    return results;
  }

  /**
   * Set console size (0.1 to 1.0, where 1.0 = full screen height)
   */
  setSize(size: number): string {
    if (size < 0.1 || size > 1.0) {
      return `Invalid size: ${size}. Must be between 0.1 and 1.0`;
    }

    this.consoleSize = size;
    this.saveConsoleSize();
    this.applyConsoleSize();

    return `Console size set to ${(size * 100).toFixed(0)}%`;
  }

  /**
   * Get current console size
   */
  getSize(): number {
    return this.consoleSize;
  }

  /**
   * Apply console size to DOM
   */
  private applyConsoleSize(): void {
    if (!this.container) return;

    const heightPercent = this.consoleSize * 100;
    this.container.style.height = `${heightPercent}%`;
    this.container.style.maxHeight = this.consoleSize >= 1.0 ? "100%" : `${heightPercent}vh`;
  }

  // ============================================================================
  // Autocomplete
  // ============================================================================

  private updateAutocomplete(input: string): void {
    if (!input) {
      this.hideAutocomplete();
      return;
    }

    const registry = CommandRegistry.getInstance();
    this.autocompleteItems = registry.getAutocompleteSuggestions(input);
    this.autocompleteIndex = -1;

    if (this.autocompleteItems.length === 0) {
      this.hideAutocomplete();
      return;
    }

    this.showAutocomplete();
  }

  private showAutocomplete(): void {
    if (!this.autocompleteEl) return;

    const registry = CommandRegistry.getInstance();

    this.autocompleteEl.innerHTML = this.autocompleteItems
      .map((item, i) => {
        const parts = item.split(" ");
        const cmdName = parts[0];
        const def = registry.getDefinition(cmdName);
        const desc =
          parts.length > 1
            ? def?.subcommands?.find((s) => s.name === parts[1])?.description || ""
            : def?.description || "";

        const hasHelp = Boolean(def) || registry.isCvar(cmdName);
        const nameClass = hasHelp ? "autocomplete-item-name console-help-term" : "autocomplete-item-name";
        const helpAttr = hasHelp ? ` data-help-cmd="${cmdName}"` : "";

        return `
        <div class="autocomplete-item${i === this.autocompleteIndex ? " selected" : ""}" data-index="${i}">
          <span class="${nameClass}"${helpAttr}>${item}</span>
          <span class="autocomplete-item-desc">${desc}</span>
        </div>
      `;
      })
      .join("");

    this.autocompleteEl.classList.add("visible");

    // Add click handlers
    this.autocompleteEl.querySelectorAll(".autocomplete-item").forEach((el) => {
      el.addEventListener("click", () => {
        const index = parseInt(el.getAttribute("data-index") || "0", 10);
        this.selectAutocomplete(index);
      });
    });
  }

  private hideAutocomplete(): void {
    this.autocompleteItems = [];
    this.autocompleteIndex = -1;
    this.autocompleteEl?.classList.remove("visible");
  }

  private handleTabComplete(): void {
    const input = this.inputEl?.value || "";
    if (!input) return;

    // Ensure suggestions for current input
    if (this.autocompleteItems.length === 0) {
      this.updateAutocomplete(input);
      if (this.autocompleteItems.length === 0) return;
    }

    if (this.autocompleteItems.length === 1) {
      this.selectAutocomplete(0);
      return;
    }

    const now = Date.now();
    const trimmedInput = input.trimEnd();

    // Try completing to common prefix first
    const commonPrefix = this.getLongestCommonPrefix(this.autocompleteItems);
    if (commonPrefix && commonPrefix.length > trimmedInput.length) {
      if (this.inputEl) {
        this.inputEl.value = commonPrefix;
        this.inputEl.focus();
      }
      this.updateAutocomplete(commonPrefix);
      this.lastTabTime = 0;
      this.lastTabInput = "";
      this.lastTabMatches = [];
      return;
    }

    // No further completion possible: double-tab prints matches, otherwise cycle
    const isSameInput = this.lastTabInput === input;
    const isSameMatches =
      this.lastTabMatches.length === this.autocompleteItems.length &&
      this.lastTabMatches.every((v, i) => v === this.autocompleteItems[i]);
    const isDoubleTap = isSameInput && isSameMatches && now - this.lastTabTime < 600;

    if (isDoubleTap) {
      const lines = ["Matches:", ...this.autocompleteItems.map((s) => `  ${s}`)];
      this.log("system", lines.join("\n"));
      this.lastTabTime = 0;
      this.lastTabInput = "";
      this.lastTabMatches = [];
      return;
    }

    // Single tab: cycle selection for convenience
    this.lastTabTime = now;
    this.lastTabInput = input;
    this.lastTabMatches = [...this.autocompleteItems];
    this.autocompleteIndex = (this.autocompleteIndex + 1) % this.autocompleteItems.length;
    this.showAutocomplete();
  }

  private getLongestCommonPrefix(items: string[]): string {
    if (items.length === 0) return "";
    if (items.length === 1) return items[0];

    let prefix = items[0];
    for (let i = 1; i < items.length; i++) {
      const s = items[i];
      let j = 0;
      while (j < prefix.length && j < s.length && prefix[j] === s[j]) {
        j++;
      }
      prefix = prefix.slice(0, j);
      if (!prefix) return "";
    }
    return prefix;
  }

  private selectAutocomplete(index: number): void {
    if (index < 0 || index >= this.autocompleteItems.length) return;

    if (this.inputEl) {
      this.inputEl.value = `${this.autocompleteItems[index]} `;
      this.inputEl.focus();
    }

    this.hideAutocomplete();
  }

  // ============================================================================
  // Logging
  // ============================================================================

  log(type: "command" | "result" | "error" | "warn" | "info" | "log" | "system", message: string): void {
    // Store in log history (before any DOM operations)
    this.logHistory.push(message);
    while (this.logHistory.length > this.logHistorySize) {
      this.logHistory.shift();
    }

    // Forward to DeveloperBar live log
    const devBar = DeveloperBar.getInstance();
    if (devBar.isVisible()) {
      devBar.setLastLog(message);
    }

    if (!this.outputEl) return;

    const line = document.createElement("div");
    line.className = `console-line ${type}`;
    line.innerHTML = this.formatMessage(message);

    this.outputEl.appendChild(line);

    // Limit output lines
    while (this.outputEl.children.length > MAX_OUTPUT_LINES) {
      this.outputEl.removeChild(this.outputEl.firstChild!);
    }

    // Scroll to bottom
    this.outputEl.scrollTop = this.outputEl.scrollHeight;
  }

  private interceptConsoleLogs(): void {
    console.log = (...args: unknown[]) => {
      this.originalLog.apply(console, args);
      this.log("log", args.map((a) => String(a)).join(" "));
    };

    console.warn = (...args: unknown[]) => {
      this.originalWarn.apply(console, args);
      this.log("warn", args.map((a) => String(a)).join(" "));
    };

    console.error = (...args: unknown[]) => {
      this.originalError.apply(console, args);
      this.log("error", args.map((a) => String(a)).join(" "));
    };

    console.info = (...args: unknown[]) => {
      this.originalInfo.apply(console, args);
      this.log("info", args.map((a) => String(a)).join(" "));
    };
  }

  private restoreConsoleLogs(): void {
    console.log = this.originalLog;
    console.warn = this.originalWarn;
    console.error = this.originalError;
    console.info = this.originalInfo;
  }

  /**
   * Format message with syntax highlighting
   * - [text] becomes highlighted in cyan
   * - label: value becomes label highlighted
   * - Numbers are highlighted
   */
  private formatMessage(message: string): string {
    // Check if message already contains HTML (from help command etc.)
    // If so, skip escaping to preserve the formatting
    const containsHtml = /<span\s+class=/.test(message);

    // Escape HTML entities first (unless message already has HTML)
    const escapeHtml = (str: string) =>
      str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

    const escaped = containsHtml ? message : escapeHtml(message);

    // Convert newlines to <br> tags
    let result = escaped.replace(/\n/g, "<br>");

    // Build result by finding patterns and wrapping them
    // Process in order of priority to avoid nested replacements

    // 1. Highlight [bracketed text] in cyan - most specific
    result = result.replace(/\[([^\]]+)\]/g, (_, content) => `<span class="hl-bracket">[${content}]</span>`);

    // 2. Highlight "quoted strings"
    result = result.replace(/&quot;([^&]+)&quot;/g, (_, content) => `<span class="hl-string">"${content}"</span>`);

    // 3. Highlight label: patterns (but not inside already highlighted spans)
    result = result.replace(/(\b[A-Za-z_]\w*):/g, (match, label) => {
      // Don't highlight if it's part of a class attribute
      if (label === "class" || label === "span") return match;
      return `<span class="hl-label">${label}:</span>`;
    });

    // 4. Highlight standalone numbers (not inside spans)
    result = result.replace(/\b(\d+\.?\d*)\b(?![^<]*>)/g, '<span class="hl-number">$1</span>');

    return result;
  }

  // ============================================================================
  // Built-in Commands
  // ============================================================================

  private registerBuiltinCommands(): void {
    const registry = CommandRegistry.getInstance();

    // "help" is HelpCommand.ts (commands/ auto-discovery), not registered
    // here — see that file's header for why a second one here would be a
    // silent no-op (CommandRegistry keeps one entry per name, and
    // registerEngineCommands() runs after this method).

    // Clear command
    registry.register("clear", () => {
      if (this.outputEl) {
        this.outputEl.innerHTML = "";
      }
      return undefined;
    });

    // Version command
    registry.register("version", () => {
      return EngineVersion.getInstance().getFullVersionString();
    });

    // Console size command (con_size)
    registry.register("con_size", (args) => {
      if (args.length === 0) {
        const current = this.getSize();
        return `Console size: ${(current * 100).toFixed(0)}% (${current.toFixed(2)})\nUsage: con_size <0.1-1.0>`;
      }

      const size = parseFloat(args[0]);
      if (Number.isNaN(size)) {
        return `Invalid size: ${args[0]}. Must be a number between 0.1 and 1.0`;
      }

      return this.setSize(size);
    });

    // Find command - search log history
    registry.register("find", (args) => {
      if (args.length === 0) {
        return `Usage: find <pattern> [maxResults]\nSearches log history. Use * as wildcard.\nExamples:\n  find BspMeshBuilder\n  find *Sprite*\n  find *error* 100`;
      }

      const pattern = args[0];
      const maxResults = args.length > 1 ? parseInt(args[1], 10) : 50;

      if (Number.isNaN(maxResults) || maxResults < 1) {
        return `Invalid maxResults: ${args[1]}. Must be a positive number.`;
      }

      const results = this.findInLog(pattern, maxResults);

      if (results.length === 0) {
        return `No matches found for "${pattern}"`;
      }

      let output = `Found ${results.length} match${results.length === 1 ? "" : "es"} for "${pattern}":\n`;
      output += '<span class="hl-label">───────────────────────────────────────</span>\n';
      for (const line of results) {
        output += `${line}\n`;
      }
      return output.trim();
    });

    // Log history size command
    registry.register("log_history", (args) => {
      if (args.length === 0) {
        const current = this.getLogHistorySize();
        const used = this.logHistory.length;
        return `Log history: ${used}/${current} lines\nUsage: log_history <100-50000>`;
      }

      const size = parseInt(args[0], 10);
      if (Number.isNaN(size)) {
        return `Invalid size: ${args[0]}. Must be a number between 100 and 50000`;
      }

      return this.setLogHistorySize(size);
    });

    // Developer mode cvar
    Cvar.register("developer", 0, {
      description: "Enable developer mode (shows dev bar with FPS/ping/speed)",
      type: "int",
      min: 0,
      max: 1,
      persist: true,
      onChange: (val) => {
        const bar = DeveloperBar.getInstance();
        if (Number(val) >= 1) {
          bar.show();
        } else {
          bar.hide();
        }
      },
    });
  }

  /**
   * Execute a command string programmatically (used by clickable help)
   */
  private async executeCommand(cmd: string): Promise<void> {
    const registry = CommandRegistry.getInstance();
    const def = registry.getDefinition(cmd);

    // If command has required args (usage contains < ) or subcommands → show help
    const needsArgs = def && (def.usage?.includes("<") || (def.subcommands && def.subcommands.length > 0));

    const commandStr = needsArgs ? `help ${cmd}` : cmd;
    this.log("command", commandStr);
    const result = await registry.execute(commandStr);
    if (result) {
      this.log("result", result);
    }
  }
}
