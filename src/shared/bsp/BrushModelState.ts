import type { Vec3 } from "../server/simulation/types";

export interface BrushModelDefinition {
  modelIndex: number;
  targetname: string;
  delay: number;
  initiallyEnabled: boolean;
  origin: Vec3;
  min: Vec3;
  max: Vec3;
  debris: string[];
}

/** Targetable inline geometry; coordinates cross from Q3 to game space here. */
export function extractBrushModels(
  entities: readonly { classname: string; properties: Record<string, string> }[],
  models: readonly { mins: number[]; maxs: number[] }[],
): BrushModelDefinition[] {
  const definitions: BrushModelDefinition[] = [];
  for (const entity of entities) {
    if (entity.classname !== "func_explosive") continue;
    const p = entity.properties;
    if (!/^\*[1-9]\d*$/.test(p.model ?? "")) continue;
    const modelIndex = Number(p.model.slice(1));
    const model = models[modelIndex];
    if (!model) continue;
    const origin = (p.origin ?? "0 0 0").trim().split(/\s+/).map(Number);
    if (origin.length !== 3 || !origin.every(Number.isFinite)) continue;
    const delay = Number(p.delay ?? 0);
    definitions.push({
      modelIndex,
      targetname: p.targetname ?? "",
      delay: Number.isFinite(delay) ? Math.max(0, delay) : 0,
      initiallyEnabled: !(Number(p.spawnflags ?? 0) & 1),
      origin: { x: origin[0], y: origin[2], z: origin[1] },
      min: { x: model.mins[0] + origin[0], y: model.mins[2] + origin[2], z: model.mins[1] + origin[1] },
      max: { x: model.maxs[0] + origin[0], y: model.maxs[2] + origin[2], z: model.maxs[1] + origin[1] },
      debris: [p.debris1, p.debris2].filter((path): path is string => !!path),
    });
  }
  return definitions;
}

/** Shared by rendering and collision; ownership of activation belongs to the game. */
export class BrushModelState {
  private readonly disabled = new Set<number>();
  private readonly known: Set<number>;

  constructor(public readonly definitions: readonly BrushModelDefinition[]) {
    this.known = new Set(definitions.map((definition) => definition.modelIndex));
    this.reset();
  }

  reset(): void {
    this.disabled.clear();
    for (const definition of this.definitions) {
      if (!definition.initiallyEnabled) this.disabled.add(definition.modelIndex);
    }
  }

  isEnabled(modelIndex: number): boolean {
    return this.known.has(modelIndex) && !this.disabled.has(modelIndex);
  }

  setEnabled(modelIndex: number, enabled: boolean): void {
    if (!this.known.has(modelIndex)) return;
    if (enabled) this.disabled.delete(modelIndex);
    else this.disabled.add(modelIndex);
  }

  snapshot(): number[] {
    return [...this.disabled].sort((a, b) => a - b);
  }

  restore(disabled: readonly number[]): void {
    this.reset();
    for (const modelIndex of disabled) this.setEnabled(modelIndex, false);
  }
}
