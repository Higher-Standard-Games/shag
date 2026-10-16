interface KeyboardLockApi {
  lock(keys: string[]): Promise<void>;
  unlock(): void;
}

/** Serializes optional browser keyboard capture and cancels stale acquisitions. */
export class FullscreenKeyboardLock {
  private keys: string[] = [];
  private signature = "";
  private attempted = "";
  private generation = 0;
  private pending = false;
  private api: KeyboardLockApi | null = null;
  private captured = new Set<string>();

  constructor(
    private readonly failed: (message: string) => void,
    private readonly acquired: () => void = () => {},
  ) {}

  update(keys: string[]): void {
    const next = [...new Set(keys.filter((key) => key !== "Escape"))].sort();
    const signature = next.join(",");
    if (signature === this.signature) return;
    this.keys = next;
    this.signature = signature;
    this.attempted = "";
    this.generation++;
    this.release();
    this.acquire();
  }

  captures(code: string): boolean {
    return this.captured.has(code);
  }

  private release(): void {
    this.api?.unlock();
    this.api = null;
    this.captured.clear();
  }

  private acquire(): void {
    if (this.pending || !this.keys.length || this.attempted === this.signature) return;
    const keyboard = (navigator as Navigator & { keyboard?: KeyboardLockApi }).keyboard;
    if (typeof keyboard?.lock !== "function" || typeof keyboard.unlock !== "function") return;
    const generation = this.generation;
    const keys = this.keys.slice();
    this.attempted = this.signature;
    this.pending = true;
    this.api = keyboard;
    void (async () => {
      try {
        await keyboard.lock(keys);
        if (generation === this.generation) {
          this.captured = new Set(keys);
          this.acquired();
        }
      } catch (error) {
        if (generation === this.generation && (error as { name?: string })?.name !== "AbortError") {
          this.failed("Keyboard shortcut protection was not allowed. Ctrl+W can still close this tab.");
        }
      } finally {
        if (generation !== this.generation) {
          keyboard.unlock();
          this.api = null;
          this.captured.clear();
        }
        this.pending = false;
        this.acquire();
      }
    })();
  }

  dispose(): void {
    this.update([]);
    this.release();
  }
}
