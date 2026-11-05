import { logRejection } from "../core/AsyncErrors";

/** Browser pad sampling. Connection is availability; callers decide activation. */
export interface PadState {
  index: number;
  id: string;
  mapping: string;
  axes: readonly number[];
  buttons: readonly { value: number; pressed: boolean }[];
}

export const PAD_LABELS = [
  "A",
  "B",
  "X",
  "Y",
  "LB",
  "RB",
  "LT",
  "RT",
  "View",
  "Menu",
  "LS",
  "RS",
  "D-pad Up",
  "D-pad Down",
  "D-pad Left",
  "D-pad Right",
] as const;
export const padLabel = (button: number): string => PAD_LABELS[button] ?? `Button ${button}`;

/** Radial filtering preserves direction and smoothly remaps the remaining travel. */
export function padStick(x: number, y: number, deadZone: number, exponent = 1): { x: number; y: number } {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return { x: 0, y: 0 };
  const length = Math.hypot(x, y);
  const dead = Math.max(0, Math.min(0.9, deadZone));
  if (length <= dead) return { x: 0, y: 0 };
  const scaled = ((Math.min(1, length) - dead) / (1 - dead)) ** Math.max(0.1, exponent);
  return { x: (x / length) * scaled, y: (y / length) * scaled };
}

export class GamepadInput {
  private static instance: GamepadInput;
  static getInstance(): GamepadInput {
    if (!GamepadInput.instance) GamepadInput.instance = new GamepadInput();
    return GamepadInput.instance;
  }

  pads: readonly PadState[] = [];
  pad: PadState | null = null;
  down = new Set<number>();
  pressed = new Set<number>();
  released = new Set<number>();
  available = true;
  private preferred: number | null = null;
  private blocked = false;
  private frame = 0;
  private running = false;
  private lastTime = 0;
  private listeners = new Set<(seconds: number) => void>();
  private failedListeners = new Set<(seconds: number) => void>();
  private stickDeadZones = [0.12, 0.12];

  subscribe(listener: (seconds: number) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
      this.failedListeners.delete(listener);
    };
  }

  /** Use the same radial dead zones for handoff safety as for stick input. */
  setStickDeadZones(left: number, right: number): void {
    this.stickDeadZones = [left, right];
  }

  select(index: number): void {
    this.preferred = index;
    this.suppressUntilNeutral();
  }

  suppressUntilNeutral(): void {
    this.blocked = !this.pad || !this.neutral;
    this.down.clear();
    this.pressed.clear();
  }

  get neutral(): boolean {
    return (
      !this.pad ||
      (!this.pad.buttons.some((button) => button.pressed || button.value >= 0.35) &&
        this.stickDeadZones.every((dead, stick) => {
          const filtered = padStick(this.pad?.axes[stick * 2] ?? 0, this.pad?.axes[stick * 2 + 1] ?? 0, dead);
          return filtered.x === 0 && filtered.y === 0;
        }))
    );
  }

  /** Public for deterministic sampling tests and non-browser hosts. */
  sample(pads: readonly (PadState | null)[]): void {
    const before = new Set(this.down);
    this.pads = pads.filter((pad): pad is PadState => pad !== null);
    const previous = this.pad?.index;
    this.pad =
      this.pads.find((pad) => pad.index === this.preferred) ??
      this.pads.find((pad) => pad.index === previous) ??
      this.pads.find((pad) => pad.mapping === "standard") ??
      this.pads[0] ??
      null;
    if (previous !== undefined && this.pad?.index !== previous) this.suppressUntilNeutral();
    const next = new Set<number>();
    if (this.blocked && this.neutral) this.blocked = false;
    if (!this.blocked && this.pad?.mapping === "standard") {
      this.pad.buttons.forEach((button, index) => {
        const threshold = this.down.has(index) ? 0.35 : 0.55;
        if (button.pressed || button.value >= threshold) next.add(index);
      });
    }
    this.pressed = new Set([...next].filter((button) => !before.has(button)));
    this.released = new Set([...before].filter((button) => !next.has(button)));
    this.down = next;
  }

  axis(index: number): number {
    return this.blocked || this.pad?.mapping !== "standard" ? 0 : (this.pad.axes[index] ?? 0);
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    window.addEventListener("blur", this.onBlur);
    document.addEventListener("visibilitychange", this.onVisibility);
    this.frame = requestAnimationFrame(this.tick);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.frame);
    window.removeEventListener("blur", this.onBlur);
    document.removeEventListener("visibilitychange", this.onVisibility);
    this.sample([]);
    this.suppressUntilNeutral();
    this.lastTime = 0;
  }

  private readonly onBlur = () => this.suppressUntilNeutral();
  private readonly onVisibility = () => {
    if (document.visibilityState === "hidden") this.suppressUntilNeutral();
  };
  private readonly tick = (now: number) => {
    if (!this.running) return;
    const seconds = this.lastTime ? Math.min(0.05, Math.max(0, (now - this.lastTime) / 1000)) : 0;
    this.lastTime = now;
    try {
      this.available = typeof navigator.getGamepads === "function";
      this.sample(
        this.available && document.visibilityState !== "hidden" && document.hasFocus() ? navigator.getGamepads() : [],
      );
    } catch {
      this.available = false;
      this.sample([]);
    }
    for (const listener of [...this.listeners]) {
      if (!this.running) break;
      if (!this.listeners.has(listener)) continue;
      try {
        listener(seconds);
        this.failedListeners.delete(listener);
      } catch (error) {
        if (!this.failedListeners.has(listener)) logRejection("GamepadInput subscriber")(error);
        this.failedListeners.add(listener);
      }
    }
    if (this.running) this.frame = requestAnimationFrame(this.tick);
  };
}
