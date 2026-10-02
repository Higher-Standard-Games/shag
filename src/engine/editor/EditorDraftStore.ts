import { EditorDocument, type EditorDocumentData, type Vec3q } from "./EditorDocument";

const ACTIVE_KEY = "shagged:active-draft:v1";
const draftKey = (id: string): string => `shagged:draft:v1:${id}`;
const viewKey = (id: string): string => `shagged:view:v1:${id}`;

export interface EditorViewState {
  schemaVersion: 1;
  grid: 8 | 16 | 32 | 64;
  zoom: number;
  tool: "brush" | "select";
  selectedId: string | null;
  activePlane?: "xy" | "xz" | "yz";
  workPlanes?: Vec3q;
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
    ["brush", "select"].includes(state.tool) &&
    (state.selectedId === null || typeof state.selectedId === "string") &&
    (state.activePlane === undefined || ["xy", "xz", "yz"].includes(state.activePlane)) &&
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

/** Versioned local recovery; the document stays independent from view state. */
export class EditorDraftStore {
  constructor(private readonly storage: Pick<Storage, "getItem" | "setItem">) {}

  load(): { document: EditorDocument; view: EditorViewState | null } {
    const id = this.storage.getItem(ACTIVE_KEY);
    if (!id) return { document: new EditorDocument(), view: null };
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

  save(data: EditorDocumentData, view: EditorViewState): void {
    new EditorDocument(data);
    if (!validView(view)) throw new Error("Invalid editor view state");
    this.storage.setItem(draftKey(data.draftId), JSON.stringify(data));
    this.storage.setItem(viewKey(data.draftId), JSON.stringify(view));
    this.storage.setItem(ACTIVE_KEY, data.draftId);
  }
}
