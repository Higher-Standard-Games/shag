import { EventBus } from "./EventBus";

export const PREFERENCE_STORAGE_EVENT = "preferences:storage_changed";
const results = new Map<string, boolean>();
const pending = new Map<string, string>();
let deferredDepth = 0;
let flushTimer: ReturnType<typeof setTimeout> | undefined;

const onVisibility = () => {
  if (document.visibilityState === "hidden") flushPreferenceWrites();
};

/** Commit a slider's final preference values on release, blur, hide or a pause. */
export function flushPreferenceWrites(): void {
  clearTimeout(flushTimer);
  flushTimer = undefined;
  if (typeof window !== "undefined") {
    window.removeEventListener("pagehide", flushPreferenceWrites);
    window.removeEventListener("blur", flushPreferenceWrites);
    document.removeEventListener("visibilitychange", onVisibility);
  }
  const writes = [...pending];
  pending.clear();
  for (const [key, value] of writes) writePreference(key, value);
}

/** Runtime setters stay synchronous; only storage writes within this scope batch. */
export function deferPreferenceWrites(setValues: () => void): void {
  deferredDepth++;
  try {
    setValues();
  } finally {
    deferredDepth--;
    if (deferredDepth === 0 && pending.size > 0) {
      clearTimeout(flushTimer);
      flushTimer = setTimeout(flushPreferenceWrites, 200);
      if (typeof window !== "undefined") {
        window.addEventListener("pagehide", flushPreferenceWrites);
        window.addEventListener("blur", flushPreferenceWrites);
        document.addEventListener("visibilitychange", onVisibility);
      }
    }
  }
}

/** Only preference keys/status are published, never their contents or account keys. */
export function writePreference(key: string, value: string): boolean {
  if (deferredDepth > 0) {
    pending.set(key, value);
    return false; // Pending, not yet saved; publish success/failure only when written.
  }
  // A newer immediate write must never be overwritten by an older queued value.
  pending.delete(key);
  let saved = false;
  try {
    localStorage.setItem(key, value);
    saved = true;
  } catch {
    /* In-memory settings remain usable. */
  }
  const previous = results.get(key);
  results.set(key, saved);
  if (previous !== saved) EventBus.emit(PREFERENCE_STORAGE_EVENT, { key, saved });
  return saved;
}

export function failedPreferenceKeys(): string[] {
  return [...results].filter(([, saved]) => !saved).map(([key]) => key);
}
