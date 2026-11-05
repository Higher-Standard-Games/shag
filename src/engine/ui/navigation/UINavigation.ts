import { UIStyles } from "../UIStyles";

export type UIIntent = "up" | "down" | "left" | "right" | "confirm" | "back";
export interface NavigationScope {
  root: HTMLElement;
  initialFocus?: () => HTMLElement | null;
  navigation?: "spatial" | "vertical";
  back?: () => void;
  intent?: (intent: UIIntent) => boolean;
}
const TARGETS = 'button, a[href], input, select, textarea, [tabindex="0"], [role="button"]';

function visible(element: HTMLElement): boolean {
  if (!element.isConnected) return false;
  for (let node: HTMLElement | null = element; node; node = node.parentElement) {
    if (node.hidden || node.inert || node.getAttribute("aria-hidden") === "true") return false;
    const style = getComputedStyle(node);
    if (style.display === "none" || style.visibility === "hidden" || style.visibility === "collapse") return false;
  }
  return true;
}

export function navigable(element: HTMLElement): boolean {
  if (element.matches(":disabled, [aria-disabled=true]")) return false;
  if (element.tabIndex < 0 && !element.matches("button, a[href], input, select, textarea")) return false;
  return visible(element) && element.getClientRects().length > 0;
}

function identity(element: HTMLElement): string {
  return (
    element.id ||
    element.dataset.navId ||
    element.dataset.action ||
    element.dataset.code ||
    element.dataset.settingsPage ||
    element.getAttribute("aria-label") ||
    element.textContent?.trim() ||
    ""
  );
}

/** Focus navigation over the live DOM. Scopes own Back and compound field behavior. */
export class UINavigation {
  private static instance: UINavigation;
  static getInstance(): UINavigation {
    if (!UINavigation.instance) UINavigation.instance = new UINavigation();
    return UINavigation.instance;
  }
  private scopes: NavigationScope[] = [];
  private selected: HTMLElement | null = null;
  private selectedKey = "";
  private selectedIndex = 0;
  private activeScope: NavigationScope | undefined;
  private pendingOpener: HTMLElement | null = null;
  private viewport = "";
  enabled = false;
  revision = 0;

  push(scope: NavigationScope): () => void {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    this.scopes.push(scope);
    this.revision++;
    return () => {
      const index = this.scopes.indexOf(scope);
      if (index < 0) return;
      const covered = this.scopes.slice(index + 1).some((entry) => visible(entry.root));
      this.scopes.splice(index, 1);
      this.revision++;
      if (covered) return;
      this.activeScope = this.current();
      this.selected?.classList.remove("controller-focus");
      this.selected = null;
      this.selectedKey = opener ? identity(opener) : "";
      this.pendingOpener = opener;
      if (opener && this.activeScope?.root.contains(opener) && navigable(opener)) {
        this.focus(opener);
        this.pendingOpener = null;
      }
    };
  }

  get active(): boolean {
    return this.current() !== undefined;
  }

  /** Start at the owning screen's entry point without moving focus behind a modal. */
  focusDefault(root: HTMLElement): void {
    if (!this.enabled || this.current()?.root !== root) return;
    this.selected?.classList.remove("controller-focus");
    this.selected = null;
    this.selectedKey = "";
    this.selectedIndex = 0;
    this.pendingOpener = null;
    this.refresh();
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (typeof document === "undefined") return;
    document.body.classList.toggle("controller-ui", enabled);
    if (!enabled) this.selected?.classList.remove("controller-focus");
    UIStyles.injectCSS(
      "controller-navigation",
      `
      .controller-ui .controller-focus { outline: 3px solid #ffdc59 !important; outline-offset: 4px; }
      .controller-ui .controller-focus::after { pointer-events: none; }
      .controller-ui input.controller-focus { outline-offset: 6px; }
    `,
    );
  }

  refresh(): void {
    if (!this.enabled) return;
    const viewport = `${window.innerWidth}:${window.innerHeight}`;
    const resized = viewport !== this.viewport;
    this.viewport = viewport;
    const scope = this.current();
    if (
      this.pendingOpener &&
      (!this.pendingOpener.isConnected ||
        this.pendingOpener.matches(":disabled, [aria-disabled=true]") ||
        (scope && !scope.root.contains(this.pendingOpener)))
    )
      this.pendingOpener = null;
    if (scope !== this.activeScope) {
      this.activeScope = scope;
      this.selectedKey = this.pendingOpener ? identity(this.pendingOpener) : "";
      this.selectedIndex = 0;
      this.selected?.classList.remove("controller-focus");
      this.selected = null;
    }
    if (!scope) return;
    if (this.pendingOpener && scope.root.contains(this.pendingOpener) && navigable(this.pendingOpener)) {
      this.focus(this.pendingOpener);
      this.pendingOpener = null;
    }
    if (!this.selected && !this.selectedKey) {
      const initial = scope.initialFocus?.();
      if (initial && scope.root.contains(initial) && navigable(initial)) this.focus(initial);
    }
    const focused = document.activeElement;
    if (
      focused instanceof HTMLElement &&
      focused !== this.selected &&
      scope.root.contains(focused) &&
      focused.matches(TARGETS) &&
      navigable(focused)
    ) {
      this.focus(focused);
    }
    if (!this.selected || !scope.root.contains(this.selected) || !navigable(this.selected)) {
      const candidates = this.candidates(scope);
      if (!candidates.length) {
        this.selected?.classList.remove("controller-focus");
        this.selected = null;
        return;
      }
      const found = candidates.find((node) => identity(node) === this.selectedKey);
      this.focus(found ?? candidates[Math.min(this.selectedIndex, candidates.length - 1)]);
    } else {
      this.selected.classList.add("controller-focus");
      if (resized) this.selected.scrollIntoView?.({ block: "nearest", inline: "nearest" });
    }
  }

  handle(intent: UIIntent): boolean {
    const scope = this.current();
    if (!scope) return false;
    if (scope.intent?.(intent)) return true;
    this.refresh();
    if (intent === "back") {
      const active = document.activeElement;
      if (
        active instanceof HTMLElement &&
        (active.isContentEditable ||
          active instanceof HTMLTextAreaElement ||
          (active instanceof HTMLInputElement &&
            !["range", "checkbox", "radio", "button", "submit"].includes(active.type)))
      )
        active.blur();
      else scope.back?.();
      return true;
    }
    const candidates = this.candidates(scope);
    const current = this.selected;
    if (!current) return true;
    if (intent === "confirm") {
      if (current instanceof HTMLInputElement && !["checkbox", "radio", "button", "submit"].includes(current.type))
        current.focus();
      else current.click();
      return true;
    }
    if (current instanceof HTMLInputElement && current.type === "range" && (intent === "left" || intent === "right")) {
      const step = Number(current.step) || 1;
      current.value = String(
        Math.max(
          Number(current.min),
          Math.min(Number(current.max), Number(current.value) + (intent === "right" ? step : -step)),
        ),
      );
      current.dispatchEvent(new Event("input", { bubbles: true }));
      current.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    }
    if (scope.navigation === "vertical" && (intent === "up" || intent === "down")) {
      const index = candidates.indexOf(current);
      const next = Math.max(0, Math.min(candidates.length - 1, index + (intent === "down" ? 1 : -1)));
      if (candidates[next]) this.focus(candidates[next]);
      return true;
    }
    const rect = current.getBoundingClientRect();
    const horizontal = intent === "left" || intent === "right";
    const sign = intent === "right" || intent === "down" ? 1 : -1;
    let best: HTMLElement | undefined;
    let score = Infinity;
    for (const target of candidates) {
      if (target === current) continue;
      const other = target.getBoundingClientRect();
      const dx = (other.left + other.right - rect.left - rect.right) / 2;
      const dy = (other.top + other.bottom - rect.top - rect.bottom) / 2;
      const along = (horizontal ? dx : dy) * sign;
      if (along <= 1) continue;
      const across = Math.abs(horizontal ? dy : dx);
      const rank = along + across * 3 + (across * across) / along;
      if (rank < score) {
        score = rank;
        best = target;
      }
    }
    if (best) this.focus(best);
    return true;
  }

  scroll(amount: number): void {
    for (let node = this.selected?.parentElement; node; node = node.parentElement) {
      if (node.scrollHeight > node.clientHeight && /auto|scroll/.test(getComputedStyle(node).overflowY)) {
        node.scrollTop += amount;
        break;
      }
    }
  }

  private current(): NavigationScope | undefined {
    return [...this.scopes].reverse().find((scope) => visible(scope.root));
  }
  private candidates(scope: NavigationScope): HTMLElement[] {
    return [...scope.root.querySelectorAll<HTMLElement>(TARGETS)].filter(navigable);
  }
  private focus(element: HTMLElement): void {
    this.selected?.classList.remove("controller-focus");
    this.selected = element;
    this.selectedKey = identity(element);
    const scope = this.current();
    this.selectedIndex = scope ? this.candidates(scope).indexOf(element) : 0;
    if (this.enabled) {
      element.classList.add("controller-focus");
      element.focus({ preventScroll: true });
      element.scrollIntoView?.({ block: "nearest", inline: "nearest" });
    }
  }
}
