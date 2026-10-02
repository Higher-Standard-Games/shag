import { EditorDocument, type EditorDocumentData, type Vec3q } from "./EditorDocument";

const ACTIVE_KEY = "shagged:active-draft:v1";
const DRAFT_PREFIX = "shagged:draft:v1:";
const draftKey = (id: string): string => `shagged:draft:v1:${id}`;
const viewKey = (id: string): string => `shagged:view:v1:${id}`;

export interface EditorViewState {
  schemaVersion: 1;
  grid: 8 | 16 | 32 | 64;
  zoom: number;
  tool: "brush" | "select" | "entity";
  selectedId: string | null;
  draftName?: string;
  activePlane?: "xy" | "xz" | "yz";
  workPlanes?: Vec3q;
  viewCenter?: Vec3q;
  camera: { alpha: number; beta: number; radius: number; target: Vec3q };
}

function validView(value: unknown): value is EditorViewState {
  if (!value || typeof value !== "object") return false;
  const state = value as EditorViewState;
  const camera = state.camera;
  return (
    state.schemaVersion === 1 &&
    [8, 16, 32, 64].includes(state.grid) &&
    Number.isFinite(state.zoom) &&
    state.zoom >= 0.25 &&
    state.zoom <= 4 &&
    ["brush", "select", "entity"].includes(state.tool) &&
    (state.selectedId === null || typeof state.selectedId === "string") &&
    (state.draftName === undefined ||
      (typeof state.draftName === "string" && state.draftName.trim().length > 0 && state.draftName.length <= 64)) &&
    (state.activePlane === undefined || ["xy", "xz", "yz"].includes(state.activePlane)) &&
    (state.viewCenter === undefined ||
      (!!state.viewCenter && (["x", "y", "z"] as const).every((axis) => Number.isFinite(state.viewCenter![axis])))) &&
    (state.workPlanes === undefined ||
      (!!state.workPlanes &&
        (["x", "y", "z"] as const).every(
          (axis) => Number.isFinite(state.workPlanes![axis]) && Math.abs(state.workPlanes![axis]) <= 1_000_000,
        ))) &&
    !!camera &&
    Number.isFinite(camera.alpha) &&
    Number.isFinite(camera.beta) &&
    camera.beta > 0 &&
    camera.beta < Math.PI &&
    Number.isFinite(camera.radius) &&
    camera.radius >= 32 &&
    camera.radius <= 5000 &&
    !!camera.target &&
    (["x", "y", "z"] as const).every((axis) => Number.isFinite(camera.target[axis]))
  );
}

export interface DraftSummary {
  id: string;
  name: string;
  brushCount: number;
  entityCount: number;
  revision: number;
  active: boolean;
}

/** Versioned local recovery; the document stays independent from view state. */
export class EditorDraftStore {
  constructor(private readonly storage: Pick<Storage, "getItem" | "setItem" | "key" | "length">) {}

  load(): { document: EditorDocument; view: EditorViewState | null } {
    const id = this.storage.getItem(ACTIVE_KEY);
    if (!id) return { document: new EditorDocument(), view: null };
    return this.read(id);
  }

  private read(id: string): { document: EditorDocument; view: EditorViewState | null } {
    const raw = this.storage.getItem(draftKey(id));
    if (!raw) throw new Error("Active draft is missing from local storage");
    const document = new EditorDocument(JSON.parse(raw) as EditorDocumentData);
    if (document.snapshot().draftId !== id) throw new Error("Active draft ID does not match saved document");
    const viewRaw = this.storage.getItem(viewKey(id));
    let parsed: unknown = null;
    if (viewRaw) {
      try {
        parsed = JSON.parse(viewRaw);
      } catch {
        // A damaged view must not make a valid map draft inaccessible.
      }
    }
    return { document, view: validView(parsed) ? parsed : null };
  }

  list(): DraftSummary[] {
    const activeId = this.storage.getItem(ACTIVE_KEY);
    const drafts: DraftSummary[] = [];
    for (let index = 0; index < this.storage.length; index++) {
      const key = this.storage.key(index);
      if (!key?.startsWith(DRAFT_PREFIX)) continue;
      const id = key.slice(DRAFT_PREFIX.length);
      try {
        const { document, view } = this.read(id);
        const data = document.snapshot();
        drafts.push({
          id,
          name: view?.draftName ?? `Untitled ${id.slice(0, 8)}`,
          brushCount: data.brushes.length,
          entityCount: data.entities.length,
          revision: data.revision,
          active: id === activeId,
        });
      } catch {
        // Keep damaged drafts untouched; they are excluded from the chooser.
      }
    }
    return drafts.sort(
      (a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name) || a.id.localeCompare(b.id),
    );
  }

  activate(id: string): { document: EditorDocument; view: EditorViewState | null } {
    const restored = this.read(id);
    this.storage.setItem(ACTIVE_KEY, id);
    return restored;
  }

  save(data: EditorDocumentData, view: EditorViewState): void {
    new EditorDocument(data);
    if (!validView(view)) throw new Error("Invalid editor view state");
    this.storage.setItem(draftKey(data.draftId), JSON.stringify(data));
    this.storage.setItem(viewKey(data.draftId), JSON.stringify(view));
    this.storage.setItem(ACTIVE_KEY, data.draftId);
  }
}
