import { EventBus } from "./EventBus";

export const PREFERENCE_STORAGE_EVENT = "preferences:storage_changed";
const results = new Map<string, boolean>();

/** Only preference keys/status are published, never their contents or account keys. */
export function writePreference(key: string, value: string): boolean {
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
