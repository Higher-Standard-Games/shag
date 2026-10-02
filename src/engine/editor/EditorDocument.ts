/** Pure Quake-space authoring state. Babylon meshes and pane state are derived. */
export interface Vec3q {
  x: number;
  y: number;
  z: number;
}
export interface BoxBrush {
  id: string;
  min: Vec3q;
  max: Vec3q;
  shader: string;
}
export interface EditorDocumentData {
  schemaVersion: 1;
  draftId: string;
  revision: number;
  brushes: BoxBrush[];
}

const SHADER = /^[a-zA-Z0-9_./-]+$/;

export function validateDocument(data: EditorDocumentData): void {
  if (data.schemaVersion !== 1 || !data.draftId || !Number.isSafeInteger(data.revision) || data.revision < 0) {
    throw new Error("Invalid editor document header");
  }
  if (!Array.isArray(data.brushes) || data.brushes.length > 20_000) throw new Error("Invalid brush list");
  const ids = new Set<string>();
  for (const brush of data.brushes) {
    if (!brush.id || ids.has(brush.id)) throw new Error("Duplicate or missing brush ID");
    ids.add(brush.id);
    if (!SHADER.test(brush.shader) || brush.shader.startsWith("/") || brush.shader.includes("..")) {
      throw new Error(`Invalid shader on brush ${brush.id}`);
    }
    for (const axis of ["x", "y", "z"] as const) {
      const lo = brush.min[axis];
      const hi = brush.max[axis];
      if (
        !Number.isFinite(lo) ||
        !Number.isFinite(hi) ||
        lo >= hi ||
        Math.abs(lo) > 1_000_000 ||
        Math.abs(hi) > 1_000_000
      ) {
        throw new Error(`Invalid ${axis} bounds on brush ${brush.id}`);
      }
    }
  }
}

function copy(data: EditorDocumentData): EditorDocumentData {
  return structuredClone(data);
}

export class EditorDocument {
  private data: EditorDocumentData;
  private undoStack: EditorDocumentData[] = [];
  private redoStack: EditorDocumentData[] = [];

  constructor(data?: EditorDocumentData) {
    this.data = data ? copy(data) : { schemaVersion: 1, draftId: crypto.randomUUID(), revision: 0, brushes: [] };
    validateDocument(this.data);
  }

  snapshot(): EditorDocumentData {
    return copy(this.data);
  }
  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }
  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  transact(change: (draft: EditorDocumentData) => void): void {
    const next = copy(this.data);
    change(next);
    validateDocument(next);
    this.undoStack.push(this.data);
    if (this.undoStack.length > 100) this.undoStack.shift();
    this.redoStack = [];
    next.revision = this.data.revision + 1;
    this.data = next;
  }

  undo(): void {
    const previous = this.undoStack.pop();
    if (!previous) return;
    this.redoStack.push(this.data);
    this.data = { ...previous, revision: this.data.revision + 1 };
  }

  redo(): void {
    const next = this.redoStack.pop();
    if (!next) return;
    this.undoStack.push(this.data);
    this.data = { ...next, revision: this.data.revision + 1 };
  }
}
