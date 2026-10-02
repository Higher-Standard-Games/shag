/**
 * Key bindings for console commands.
 *
 * `bind f "give all"` and the key runs the command. This is separate from the
 * action map in the game's settings: an action binding answers "what does the
 * player mean by this key" every frame, while a command binding fires a console
 * command once, on the press. A key can carry both; binding `space` to a
 * command does not stop it being Jump.
 *
 * Bindings persist per browser, alongside the other console state.
 */

const STORAGE_KEY = "engine_binds";

/** Friendly spellings a player is likely to type, mapped to KeyboardEvent codes. */
const ALIASES: Record<string, string> = {
  esc: "Escape",
  escape: "Escape",
  space: "Space",
  spacebar: "Space",
  enter: "Enter",
  return: "Enter",
  tab: "Tab",
  backspace: "Backspace",
  ins: "Insert",
  insert: "Insert",
  del: "Delete",
  delete: "Delete",
  home: "Home",
  end: "End",
  pgup: "PageUp",
  pageup: "PageUp",
  pgdn: "PageDown",
  pagedown: "PageDown",
  up: "ArrowUp",
  down: "ArrowDown",
  left: "ArrowLeft",
  right: "ArrowRight",
  shift: "ShiftLeft",
  ctrl: "ControlLeft",
  control: "ControlLeft",
  alt: "AltLeft",
  tilde: "Backquote",
  "`": "Backquote",
  "~": "Backquote",
  "-": "Minus",
  "=": "Equal",
  "[": "BracketLeft",
  "]": "BracketRight",
  ";": "Semicolon",
  "'": "Quote",
  ",": "Comma",
  ".": "Period",
  "/": "Slash",
  "\\": "Backslash",
};

/** A KeyboardEvent code, or null when the key is not one this browser reports. */
export function normalizeKey(input: string): string | null {
  const raw = input.trim();
  if (!raw) return null;

  const lower = raw.toLowerCase();
  if (ALIASES[lower]) return ALIASES[lower];
  if (/^[a-z]$/.test(lower)) return `Key${lower.toUpperCase()}`;
  if (/^[0-9]$/.test(lower)) return `Digit${lower}`;
  if (/^f([1-9]|1[0-9]|2[0-4])$/.test(lower)) return `F${lower.slice(1)}`;
  if (/^numpad[0-9]$/.test(lower)) return `Numpad${lower.slice(6)}`;

  // Already a code: Key*, Digit*, Arrow*, Numpad*, F<n>, or a named key
  if (/^[A-Za-z][A-Za-z0-9]*$/.test(raw)) {
    const canonical = Object.values(ALIASES).find((code) => code.toLowerCase() === lower);
    if (canonical) return canonical;
    if (/^(key|digit|numpad|arrow)[a-z0-9]+$/.test(lower)) {
      const prefix = lower.startsWith("numpad") ? 6 : lower.startsWith("digit") ? 5 : lower.startsWith("arrow") ? 5 : 3;
      const head = lower.slice(0, prefix);
      const tail = raw.slice(prefix);
      const cased = head.charAt(0).toUpperCase() + head.slice(1);
      return `${cased}${tail.charAt(0).toUpperCase()}${tail.slice(1)}`;
    }
    return raw;
  }
  return null;
}

/** How a bound key is written back to the player. */
export function displayKey(code: string): string {
  if (code.startsWith("Key")) return code.slice(3).toLowerCase();
  if (code.startsWith("Digit")) return code.slice(5);
  if (code === "Backquote") return "`";
  return code;
}

export interface CommandBindingsOptions {
  /** How a bound command is executed. */
  run: (command: string) => void;
  /** True while something else owns the keyboard — an open console, say. */
  isBlocked?: () => boolean;
}

class CommandBindingsStore {
  private bindings = new Map<string, string>();
  private options: CommandBindingsOptions | null = null;
  private listener: ((event: KeyboardEvent) => void) | null = null;
  private loaded = false;

  /** Bind a key. Returns the normalized key, or null when it is not a key. */
  bind(key: string, command: string): string | null {
    const code = normalizeKey(key);
    const trimmed = command.trim();
    if (!code || !trimmed) return null;
    this.load();
    this.bindings.set(code, trimmed);
    this.save();
    return code;
  }

  /** Remove one binding. Returns the command it held, if any. */
  unbind(key: string): string | undefined {
    const code = normalizeKey(key);
    if (!code) return undefined;
    this.load();
    const had = this.bindings.get(code);
    if (had !== undefined) {
      this.bindings.delete(code);
      this.save();
    }
    return had;
  }

  /** Remove every binding. Returns how many there were. */
  unbindAll(): number {
    this.load();
    const count = this.bindings.size;
    this.bindings.clear();
    this.save();
    return count;
  }

  get(key: string): string | undefined {
    const code = normalizeKey(key);
    if (!code) return undefined;
    this.load();
    return this.bindings.get(code);
  }

  /** Every binding, by key code. */
  all(): ReadonlyMap<string, string> {
    this.load();
    return new Map(this.bindings);
  }

  /** Start listening. Safe to call twice; the second call replaces the first. */
  attach(options: CommandBindingsOptions): void {
    this.detach();
    this.options = options;
    this.load();
    if (typeof window === "undefined") return;

    this.listener = (event: KeyboardEvent) => this.handleKeyDown(event);
    window.addEventListener("keydown", this.listener);
  }

  detach(): void {
    if (this.listener && typeof window !== "undefined") {
      window.removeEventListener("keydown", this.listener);
    }
    this.listener = null;
    this.options = null;
  }

  /** Exposed for tests and for a host that routes its own key events. */
  handleKeyDown(event: KeyboardEvent): void {
    if (!this.options || event.repeat) return;
    // Ctrl/Alt/Meta combinations belong to the browser and the OS
    if (event.ctrlKey || event.altKey || event.metaKey) return;
    if (isTextInputFocused() || this.options.isBlocked?.()) return;

    const command = this.bindings.get(event.code);
    if (!command) return;
    this.options.run(command);
  }

  private load(): void {
    if (this.loaded) return;
    this.loaded = true;
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (!stored) return;
      const data = JSON.parse(stored) as Record<string, string>;
      for (const [code, command] of Object.entries(data)) {
        if (typeof command === "string" && command.trim()) this.bindings.set(code, command);
      }
    } catch {
      // A browser that will not hand over its storage still gets working binds
      // for this session.
    }
  }

  private save(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(Object.fromEntries(this.bindings)));
    } catch {
      // As above: the binding still works, it just will not outlive the tab.
    }
  }

  /** Test seam: forget everything, including what storage held. */
  resetForTests(): void {
    this.detach();
    this.bindings.clear();
    this.loaded = false;
  }
}

function isTextInputFocused(): boolean {
  if (typeof document === "undefined") return false;
  const el = document.activeElement;
  if (!el) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || (el as HTMLElement).isContentEditable === true;
}

export const CommandBindings = new CommandBindingsStore();
