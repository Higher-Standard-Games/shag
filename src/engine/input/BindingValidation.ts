import type { InputBinding } from "./InputTypes";

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function binding(value: unknown): InputBinding | null {
  if (!record(value)) return null;
  const result: InputBinding = {};
  if (value.key !== undefined) {
    if (typeof value.key !== "string" || !value.key.trim()) return null;
    result.key = value.key;
  }
  if (value.mouseButton !== undefined) {
    if (value.mouseButton !== "left" && value.mouseButton !== "middle" && value.mouseButton !== "right") return null;
    result.mouseButton = value.mouseButton;
  }
  if (value.scrollDirection !== undefined) {
    if (value.scrollDirection !== "up" && value.scrollDirection !== "down") return null;
    result.scrollDirection = value.scrollDirection;
  }
  if (value.gesture !== undefined) {
    if (typeof value.gesture !== "string" || !value.gesture.trim()) return null;
    result.gesture = value.gesture;
  }
  if (value.gamepadButton !== undefined) {
    if (typeof value.gamepadButton !== "number" || !Number.isInteger(value.gamepadButton) || value.gamepadButton < 0)
      return null;
    result.gamepadButton = value.gamepadButton;
  }
  if (Object.keys(result).length === 0) return null;
  if (value.modifiers !== undefined) {
    if (!record(value.modifiers)) return null;
    const modifiers: NonNullable<InputBinding["modifiers"]> = {};
    for (const [key, required] of Object.entries(value.modifiers)) {
      if ((key !== "ctrl" && key !== "shift" && key !== "alt") || typeof required !== "boolean") return null;
      modifiers[key] = required;
    }
    result.modifiers = modifiers;
  }
  return result;
}

/** Invalid overrides fall back to defaults; explicit empty arrays remain unbound. */
export function validatedBindingOverrides(value: unknown): Map<string, InputBinding[]> {
  const overrides = new Map<string, InputBinding[]>();
  if (!record(value)) return overrides;
  for (const [id, bindings] of Object.entries(value)) {
    if (!id || !Array.isArray(bindings)) continue;
    const valid = bindings.map(binding).filter((entry): entry is InputBinding => entry !== null);
    if (bindings.length === 0 || valid.length > 0) overrides.set(id, valid);
  }
  return overrides;
}
