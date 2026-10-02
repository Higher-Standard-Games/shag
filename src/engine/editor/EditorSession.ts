import { ArcRotateCamera } from "@babylonjs/core/Cameras/arcRotateCamera";
import type { AbstractEngine } from "@babylonjs/core/Engines/abstractEngine";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3, Color4 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Viewport } from "@babylonjs/core/Maths/math.viewport";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { Scene } from "@babylonjs/core/scene";
// Registers AbstractMesh.enableEdgesRendering for editor brush outlines.
import "@babylonjs/core/Rendering/edgesRenderer";
// Registers Scene.pick for perspective selection.
import "@babylonjs/core/Culling/ray";
import { pickResizeEdge, type ResizeEdge, resizeBox } from "./EditorBoxTools";
import { type BoxBrush, EditorDocument, type EditorDocumentData, type Vec3q } from "./EditorDocument";
import { EditorDraftStore, type EditorViewState } from "./EditorDraftStore";
import { drawBounds, moveBox } from "./EditorGesture";
import {
  PLANE_AXES as AXES,
  brushBounds,
  type EditorPlane as Plane,
  panCenter,
  paneToWorld,
  zoomCenter,
} from "./EditorViewTools";
import { writeMap } from "./MapWriter";
import { createRoomTemplate } from "./RoomTemplate";
import "./editor.css";

type Gesture = {
  plane: Plane;
  mode: "draw" | "move" | "resize";
  start: [number, number];
  current: [number, number];
  brush?: BoxBrush;
  edge?: ResizeEdge;
  workPlane: number;
  grid: number;
};

function snap(n: number, grid: number): number {
  return Math.round(n / grid) * grid;
}
function inRect(u: number, v: number, b: BoxBrush, plane: Plane): boolean {
  const axes = AXES[plane];
  return u >= b.min[axes.u] && u <= b.max[axes.u] && v >= b.min[axes.v] && v <= b.max[axes.v];
}
export class EditorSession {
  document: EditorDocument;
  readonly root: HTMLDivElement;
  private readonly scene: Scene;
  private readonly camera: ArcRotateCamera;
  private readonly panes = new Map<Plane, HTMLCanvasElement>();
  private readonly meshes = new Map<string, Mesh>();
  private ghost: Mesh | null = null;
  private readonly listeners = new AbortController();
  private readonly draftStore = new EditorDraftStore(localStorage);
  private readonly statusEl: HTMLElement;
  private readonly inspector: HTMLElement;
  private selectedId: string | null = null;
  private draftName = "Untitled";
  private tool: "brush" | "select" = "brush";
  private grid = 16;
  private zoom = 1;
  private viewCenter: Vec3q = { x: 0, y: 0, z: 0 };
  private pan: { plane: Plane; x: number; y: number; center: Vec3q } | null = null;
  private workPlanes: Vec3q = { x: 0, y: 0, z: 0 };
  private activePlane: Plane = "xy";
  private gesture: Gesture | null = null;
  private perspectiveStart: [number, number] | null = null;
  private viewSaveTimer: ReturnType<typeof setTimeout> | null = null;
  private hoverPlane: Plane | null = null;
  private hoverCoord: Vec3q | null = null;
  private lastMessage = "Local draft";
  private inspectorKey = "";

  constructor(
    engine: AbstractEngine,
    private readonly canvas: HTMLCanvasElement,
    private readonly onExit: () => void,
  ) {
    const restored = this.draftStore.load();
    this.document = restored.document;
    this.scene = new Scene(engine);
    this.scene.clearColor = new Color4(0.035, 0.045, 0.075, 1);
    this.camera = new ArcRotateCamera("shagged-perspective", Math.PI / 4, Math.PI / 3, 650, Vector3.Zero(), this.scene);
    this.camera.lowerRadiusLimit = 32;
    this.camera.upperRadiusLimit = 5000;
    // Reserve left click for selection; right drag orbits and middle drag pans.
    const rotate = this.camera.movement.input.getEntry("pointer", "rotate", { button: 0 });
    const pan = this.camera.movement.input.getEntry("pointer", "pan", { button: 2 });
    if (rotate) rotate.button = 2;
    if (pan) pan.button = 1;
    this.restoreView(restored.view);
    this.camera.attachControl(canvas, true);
    this.camera.onViewMatrixChangedObservable.add(() => {
      if (this.viewSaveTimer) clearTimeout(this.viewSaveTimer);
      this.viewSaveTimer = setTimeout(() => this.trySaveView(), 400);
    });
    this.scene.activeCamera = this.camera;
    const light = new HemisphericLight("shagged-light", new Vector3(0, 1, 0), this.scene);
    light.intensity = 1.1;

    this.root = document.createElement("div");
    this.root.className = "shagged";
    this.root.tabIndex = -1;
    this.root.innerHTML = `
      <header class="shagged__toolbar">
        <strong>SHAGGED <small>GENERAL EDITOR</small></strong>
        <label>Draft <input data-draft-name type="text" maxlength="64" aria-label="Draft name"></label>
        <button data-action="drafts">Drafts</button><button data-action="new">New</button><button data-action="room">Room Template</button><button data-action="save" title="Ctrl/Cmd+S">Save Draft</button>
        <button data-action="export" title="Ctrl/Cmd+Shift+S">Export .map</button>
        <button data-action="duplicate" title="Ctrl/Cmd+D">Duplicate</button>
        <span class="shagged__separator"></span>
        <button data-action="undo" title="Ctrl/Cmd+Z">Undo</button><button data-action="redo" title="Ctrl/Cmd+Shift+Z">Redo</button>
        <button data-action="brush">Brush (B)</button><button data-action="select">Select (V)</button>
        <button data-action="delete" title="Delete">Delete</button>
        <button data-action="frame-selection">Frame (F)</button><button data-action="frame-all">Frame All (Shift+F)</button>
        <label>Grid <select data-grid title="[ / ] to step"><option>8</option><option selected>16</option><option>32</option><option>64</option></select></label>
        <label>Work <span data-work-axis>Z</span> <input data-workplane type="number" step="1" value="0"></label>
        <span class="shagged__separator"></span>
        <button disabled title="MakeBSP service is not configured">Compile</button>
        <button disabled title="No compile job yet">Status: unavailable</button>
        <button disabled title="A compiled, playable build is required">Playtest</button>
        <button data-action="exit">Exit</button>
      </header>
      <main class="shagged__workspace">
        <section class="shagged__pane shagged__pane--perspective"><span>3D PERSPECTIVE</span></section>
        <section class="shagged__pane"><span>XY TOP</span><canvas data-plane="xy"></canvas></section>
        <section class="shagged__pane"><span>XZ FRONT</span><canvas data-plane="xz"></canvas></section>
        <section class="shagged__pane"><span>YZ SIDE</span><canvas data-plane="yz"></canvas></section>
      </main>
      <section class="shagged__drafts" aria-label="Saved drafts" hidden>
        <div class="shagged__drafts-head"><h2>Local drafts</h2><button data-action="close-drafts">Close</button></div>
        <div data-draft-list></div>
      </section>
      <aside class="shagged__inspector"></aside>
      <footer class="shagged__status"></footer>`;
    document.body.appendChild(this.root);
    this.statusEl = this.root.querySelector(".shagged__status")!;
    this.inspector = this.root.querySelector(".shagged__inspector")!;
    this.root.querySelector<HTMLSelectElement>("[data-grid]")!.value = String(this.grid);
    this.root.querySelector<HTMLInputElement>("[data-draft-name]")!.value = this.draftName;
    this.updateWorkPlaneControl();

    for (const plane of ["xy", "xz", "yz"] as const) {
      const pane = this.root.querySelector<HTMLCanvasElement>(`canvas[data-plane="${plane}"]`)!;
      this.panes.set(plane, pane);
      pane.addEventListener("pointerdown", (event) => this.pointerDown(plane, event), {
        signal: this.listeners.signal,
      });
      pane.addEventListener("pointermove", (event) => this.pointerMove(plane, event), {
        signal: this.listeners.signal,
      });
      pane.addEventListener("pointerup", (event) => this.pointerUp(plane, event), { signal: this.listeners.signal });
      pane.addEventListener("pointercancel", () => this.cancelGesture(), { signal: this.listeners.signal });
      pane.addEventListener("lostpointercapture", () => this.cancelGesture(), { signal: this.listeners.signal });
      pane.addEventListener(
        "pointerleave",
        () => {
          if (this.hoverPlane !== plane) return;
          this.hoverPlane = null;
          this.hoverCoord = null;
          this.renderStatus();
        },
        { signal: this.listeners.signal },
      );
      pane.addEventListener(
        "wheel",
        (event) => {
          event.preventDefault();
          if (this.gesture || this.pan) return;
          const rect = pane.getBoundingClientRect();
          const zoom = Math.max(0.25, Math.min(4, this.zoom * (event.deltaY > 0 ? 0.9 : 1.1)));
          this.viewCenter = zoomCenter(
            plane,
            this.viewCenter,
            this.zoom,
            zoom,
            event.clientX - rect.left - rect.width / 2,
            event.clientY - rect.top - rect.height / 2,
          );
          this.zoom = zoom;
          this.draw();
          this.trySaveView();
        },
        { passive: false, signal: this.listeners.signal },
      );
    }
    this.root.addEventListener(
      "click",
      (event) => {
        const button = (event.target as HTMLElement).closest<HTMLButtonElement>("button[data-action]");
        if (button?.dataset.action) this.action(button.dataset.action, button.dataset.draftId);
      },
      { signal: this.listeners.signal },
    );
    this.root
      .querySelector("[data-grid]")
      ?.addEventListener("change", (event) => this.setGrid(Number((event.target as HTMLSelectElement).value)), {
        signal: this.listeners.signal,
      });
    this.root.querySelector<HTMLInputElement>("[data-draft-name]")!.addEventListener(
      "change",
      (event) => {
        const input = event.target as HTMLInputElement;
        this.draftName = input.value.trim() || "Untitled";
        input.value = this.draftName;
        this.trySaveView();
      },
      { signal: this.listeners.signal },
    );
    this.root.querySelector<HTMLInputElement>("[data-workplane]")!.addEventListener(
      "change",
      (event) => {
        const value = Number((event.target as HTMLInputElement).value);
        if (!Number.isFinite(value) || Math.abs(value) > 1_000_000) {
          this.status("Work plane must be a finite coordinate within one million units");
          this.updateWorkPlaneControl();
          return;
        }
        this.workPlanes[AXES[this.activePlane].hidden] = snap(value, this.grid);
        this.updateWorkPlaneControl();
        this.draw();
        this.trySaveView();
      },
      { signal: this.listeners.signal },
    );
    this.root.addEventListener("keydown", (event) => this.keyDown(event), { signal: this.listeners.signal });
    this.canvas.addEventListener("pointerdown", (event) => this.perspectiveDown(event), {
      signal: this.listeners.signal,
    });
    this.canvas.addEventListener("pointerup", (event) => this.perspectiveUp(event), { signal: this.listeners.signal });
    this.canvas.addEventListener(
      "contextmenu",
      (event) => {
        if (this.inPerspective(event)) event.preventDefault();
      },
      { signal: this.listeners.signal },
    );
    this.inspector.addEventListener("submit", (event) => this.submitInspector(event), {
      signal: this.listeners.signal,
    });
    window.addEventListener("resize", () => this.draw(), { signal: this.listeners.signal });
    this.rebuildMeshes();
    this.draw();
    this.root.focus();
  }

  get draftId(): string {
    return this.document.snapshot().draftId;
  }
  get revision(): number {
    return this.document.snapshot().revision;
  }
  render(): void {
    const pane = this.root.querySelector<HTMLElement>(".shagged__pane--perspective")!;
    const rect = pane.getBoundingClientRect();
    const canvasRect = this.canvas.getBoundingClientRect();
    this.camera.viewport = new Viewport(
      (rect.left - canvasRect.left) / canvasRect.width,
      (canvasRect.bottom - rect.bottom) / canvasRect.height,
      rect.width / canvasRect.width,
      rect.height / canvasRect.height,
    );
    this.scene.render();
  }

  save(): void {
    const data = this.document.snapshot();
    this.draftStore.save(data, this.viewState());
    this.status("Draft saved locally");
  }
  private viewState(): EditorViewState {
    return {
      schemaVersion: 1,
      grid: this.grid as EditorViewState["grid"],
      zoom: this.zoom,
      tool: this.tool,
      selectedId: this.selectedId,
      draftName: this.draftName,
      activePlane: this.activePlane,
      workPlanes: { ...this.workPlanes },
      viewCenter: { ...this.viewCenter },
      camera: {
        alpha: this.camera.alpha,
        beta: this.camera.beta,
        radius: this.camera.radius,
        target: { x: this.camera.target.x, y: this.camera.target.z, z: this.camera.target.y },
      },
    };
  }
  private trySaveView(): void {
    try {
      this.save();
    } catch (error) {
      this.status(`View save failed: ${String(error)}`);
    }
  }
  showError(message: string): void {
    this.status(message);
  }
  dispose(): void {
    this.listeners.abort();
    if (this.viewSaveTimer) clearTimeout(this.viewSaveTimer);
    this.disposeGhost();
    this.camera.detachControl();
    this.scene.dispose();
    this.root.remove();
  }

  private status(message: string): void {
    this.lastMessage = message;
    this.renderStatus();
  }

  /** Redraws the status bar from the last message plus whatever else changed
   * (hover coordinates, a drag's preview size) without replacing that message —
   * a plain mouse hover has something to show, but it isn't a new event. */
  private renderStatus(): void {
    const hidden = AXES[this.activePlane].hidden;
    const preview = this.previewBrush();
    const dimensions = preview
      ? ` · preview ${preview.max.x - preview.min.x}×${preview.max.y - preview.min.y}×${preview.max.z - preview.min.z}`
      : "";
    const cursor = this.hoverCoord
      ? ` · cursor (${this.hoverCoord.x}, ${this.hoverCoord.y}, ${this.hoverCoord.z})`
      : "";
    this.statusEl.textContent = `${this.lastMessage} · ${this.document.snapshot().brushes.length} brushes · revision ${this.revision} · ${this.activePlane.toUpperCase()} work ${hidden.toUpperCase()}=${this.workPlanes[hidden]} · grid ${this.grid}${dimensions}${cursor} · MakeBSP unavailable`;
  }

  private updateWorkPlaneControl(): void {
    const hidden = AXES[this.activePlane].hidden;
    this.root.querySelector("[data-work-axis]")!.textContent = hidden.toUpperCase();
    this.root.querySelector<HTMLInputElement>("[data-workplane]")!.value = String(this.workPlanes[hidden]);
  }

  private restoreView(view: EditorViewState | null): void {
    this.grid = view?.grid ?? 16;
    this.zoom = view?.zoom ?? 1;
    this.viewCenter = { ...(view?.viewCenter ?? { x: 0, y: 0, z: 0 }) };
    this.tool = view?.tool ?? "brush";
    this.draftName = view?.draftName ?? "Untitled";
    this.workPlanes = { ...(view?.workPlanes ?? { x: 0, y: 0, z: 0 }) };
    this.activePlane = view?.activePlane ?? "xy";
    this.selectedId = this.document.snapshot().brushes.some((brush) => brush.id === view?.selectedId)
      ? (view?.selectedId ?? null)
      : null;
    this.camera.alpha = view?.camera.alpha ?? Math.PI / 4;
    this.camera.beta = view?.camera.beta ?? Math.PI / 3;
    this.camera.radius = view?.camera.radius ?? 650;
    const target = view?.camera.target ?? { x: 0, y: 0, z: 0 };
    this.camera.target = new Vector3(target.x, target.z, target.y);
  }

  private showDrafts(): void {
    const list = this.root.querySelector<HTMLElement>("[data-draft-list]")!;
    list.replaceChildren();
    for (const draft of this.draftStore.list()) {
      const button = document.createElement("button");
      button.type = "button";
      button.dataset.action = "open-draft";
      button.dataset.draftId = draft.id;
      button.disabled = draft.active;
      button.textContent = `${draft.name} · ${draft.brushCount} brushes · r${draft.revision}${draft.active ? " · current" : ""}`;
      list.appendChild(button);
    }
    if (!list.childElementCount) list.textContent = "No saved drafts yet.";
    this.root.querySelector<HTMLElement>(".shagged__drafts")!.hidden = false;
  }

  private openDraft(id: string): void {
    if (id === this.draftId) return;
    this.save();
    const restored = this.draftStore.activate(id);
    if (this.viewSaveTimer) clearTimeout(this.viewSaveTimer);
    this.viewSaveTimer = null;
    this.cancelGesture();
    this.document = restored.document;
    this.restoreView(restored.view);
    this.root.querySelector<HTMLSelectElement>("[data-grid]")!.value = String(this.grid);
    this.root.querySelector<HTMLInputElement>("[data-draft-name]")!.value = this.draftName;
    this.updateWorkPlaneControl();
    this.rebuildMeshes();
    this.draw();
    this.root.querySelector<HTMLElement>(".shagged__drafts")!.hidden = true;
    this.root.focus();
  }

  private action(action: string, draftId?: string): void {
    try {
      switch (action) {
        case "frame-selection":
        case "frame-all":
          this.frame(action === "frame-all");
          break;
        case "new":
          this.save();
          this.cancelGesture();
          this.document = new EditorDocument();
          this.selectedId = null;
          this.draftName = "Untitled";
          this.root.querySelector<HTMLInputElement>("[data-draft-name]")!.value = this.draftName;
          this.changed();
          break;
        case "room":
          this.save();
          this.cancelGesture();
          this.document = new EditorDocument(createRoomTemplate());
          this.selectedId = null;
          this.draftName = "Room Template";
          this.root.querySelector<HTMLInputElement>("[data-draft-name]")!.value = this.draftName;
          this.changed();
          break;
        case "drafts":
          this.showDrafts();
          break;
        case "close-drafts":
          this.root.querySelector<HTMLElement>(".shagged__drafts")!.hidden = true;
          this.root.focus();
          break;
        case "open-draft":
          if (draftId) this.openDraft(draftId);
          break;
        case "save":
          this.save();
          break;
        case "export":
          this.exportMap();
          break;
        case "undo":
          this.document.undo();
          this.changed();
          break;
        case "redo":
          this.document.redo();
          this.changed();
          break;
        case "brush":
        case "select":
          this.cancelGesture();
          this.tool = action;
          this.draw();
          this.trySaveView();
          break;
        case "duplicate":
          if (this.selectedId) {
            const original = this.document.snapshot().brushes.find((brush) => brush.id === this.selectedId);
            if (!original) break;
            const copy = structuredClone(original);
            copy.id = crypto.randomUUID();
            copy.min.x += this.grid;
            copy.max.x += this.grid;
            this.document.transact((data) => data.brushes.push(copy));
            this.selectedId = copy.id;
            this.changed();
          }
          break;
        case "delete":
          if (this.selectedId) {
            const id = this.selectedId;
            this.document.transact((data) => {
              data.brushes = data.brushes.filter((brush) => brush.id !== id);
            });
            this.selectedId = null;
            this.changed();
          }
          break;
        case "exit":
          this.save();
          this.onExit();
          break;
      }
    } catch (error) {
      this.status(error instanceof Error ? error.message : String(error));
    }
  }

  private keyDown(event: KeyboardEvent): void {
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement) return;
    const key = event.key.toLowerCase();
    if (event.ctrlKey || event.metaKey) {
      if (key === "z") {
        event.preventDefault();
        this.action(event.shiftKey ? "redo" : "undo");
      } else if (key === "y") {
        event.preventDefault();
        this.action("redo");
      } else if (key === "s") {
        event.preventDefault();
        this.action(event.shiftKey ? "export" : "save");
      } else if (key === "d") {
        event.preventDefault();
        this.action("duplicate");
      }
      return;
    }
    if (key === "b") this.action("brush");
    else if (key === "v") this.action("select");
    else if (key === "delete") this.action("delete");
    else if (key === "f") {
      event.preventDefault();
      event.stopPropagation();
      this.action(event.shiftKey ? "frame-all" : "frame-selection");
    } else if (key === "[" || key === "]") {
      this.stepGrid(key === "[" ? -1 : 1);
    } else if (key === "escape") {
      // Cancel an in-progress drag first; only once nothing is being
      // dragged does Escape close the one popover the editor has.
      event.preventDefault();
      if (this.gesture) {
        this.cancelGesture();
        return;
      }
      const drafts = this.root.querySelector<HTMLElement>(".shagged__drafts");
      if (drafts && !drafts.hidden) {
        drafts.hidden = true;
        this.root.focus();
      }
    }
  }

  /** Move the grid-size select by one step (`[` smaller, `]` larger), in lockstep with the toolbar control. */
  private stepGrid(direction: -1 | 1): void {
    const select = this.root.querySelector<HTMLSelectElement>("[data-grid]");
    if (!select) return;
    const sizes = [...select.options].map((option) => Number(option.value));
    const index = sizes.indexOf(this.grid);
    const next = Math.min(sizes.length - 1, Math.max(0, (index === -1 ? 0 : index) + direction));
    this.setGrid(sizes[next]);
  }

  private setGrid(size: number): void {
    this.grid = size;
    const select = this.root.querySelector<HTMLSelectElement>("[data-grid]");
    if (select) select.value = String(size);
    this.draw();
    this.trySaveView();
  }

  private frame(all: boolean): void {
    const brushes = this.document
      .snapshot()
      .brushes.filter((brush) => all || !this.selectedId || brush.id === this.selectedId);
    const bounds = brushBounds(brushes);
    if (!bounds) {
      this.status(all ? "No brushes to frame" : "Select a brush to frame");
      return;
    }
    this.cancelGesture();
    this.viewCenter = bounds.center;
    let zoom = 4;
    for (const [plane, pane] of this.panes) {
      const { width, height } = pane.getBoundingClientRect();
      const axes = AXES[plane];
      if (width > 0 && height > 0)
        zoom = Math.min(zoom, (width * 0.8) / bounds.size[axes.u], (height * 0.8) / bounds.size[axes.v]);
    }
    this.zoom = Math.max(0.25, zoom);
    this.camera.target = new Vector3(bounds.center.x, bounds.center.z, bounds.center.y);
    const rect = this.root.querySelector<HTMLElement>(".shagged__pane--perspective")!.getBoundingClientRect();
    const aspect = rect.width / Math.max(1, rect.height);
    const halfFov = Math.min(this.camera.fov / 2, Math.atan(Math.tan(this.camera.fov / 2) * Math.max(0.1, aspect)));
    this.camera.radius = Math.max(
      32,
      Math.min(5000, (Math.hypot(bounds.size.x, bounds.size.y, bounds.size.z) * 0.6) / Math.sin(halfFov)),
    );
    this.draw();
    this.trySaveView();
  }

  private exportMap(): void {
    const source = writeMap(this.document.snapshot());
    const url = URL.createObjectURL(new Blob([source], { type: "text/plain;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `shagged-${this.draftId.slice(0, 8)}.map`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    this.status("Exported source .map; compiler acceptance unverified");
  }

  /** The exact Quake point under the pointer; hit tests use this, not the snapped point. */
  private worldAt(plane: Plane, canvas: HTMLCanvasElement, event: PointerEvent): [number, number] {
    const rect = canvas.getBoundingClientRect();
    return paneToWorld(
      plane,
      this.viewCenter,
      this.zoom,
      event.clientX - rect.left - rect.width / 2,
      event.clientY - rect.top - rect.height / 2,
    );
  }

  private coordinates(
    plane: Plane,
    canvas: HTMLCanvasElement,
    event: PointerEvent,
    grid = this.grid,
  ): [number, number] {
    const [u, v] = this.worldAt(plane, canvas, event);
    return [snap(u, grid), snap(v, grid)];
  }

  private inPerspective(event: MouseEvent): boolean {
    const rect = this.root.querySelector<HTMLElement>(".shagged__pane--perspective")!.getBoundingClientRect();
    return (
      event.clientX >= rect.left &&
      event.clientX < rect.right &&
      event.clientY >= rect.top &&
      event.clientY < rect.bottom
    );
  }

  private perspectiveDown(event: PointerEvent): void {
    this.perspectiveStart = event.button === 0 && this.inPerspective(event) ? [event.clientX, event.clientY] : null;
  }

  private perspectiveUp(event: PointerEvent): void {
    const start = this.perspectiveStart;
    this.perspectiveStart = null;
    if (!start || event.button !== 0 || !this.inPerspective(event)) return;
    if (Math.hypot(event.clientX - start[0], event.clientY - start[1]) > 4) return;
    const rect = this.canvas.getBoundingClientRect();
    const pick = this.scene.pick(
      event.clientX - rect.left,
      event.clientY - rect.top,
      (mesh) => this.meshes.has(mesh.name),
      false,
      this.camera,
    );
    this.root.focus();
    this.selectedId = pick?.hit ? (pick.pickedMesh?.name ?? null) : null;
    this.rebuildMeshes();
    this.draw();
    this.trySaveView();
  }

  private pointerDown(plane: Plane, event: PointerEvent): void {
    if (event.button !== 0 && event.button !== 1) return;
    if (this.gesture || this.pan) return;
    event.preventDefault();
    this.root.focus();
    this.activePlane = plane;
    this.updateWorkPlaneControl();
    const pane = this.panes.get(plane)!;
    pane.setPointerCapture(event.pointerId);
    if (event.button === 1) {
      this.pan = { plane, x: event.clientX, y: event.clientY, center: { ...this.viewCenter } };
      return;
    }
    const start = this.coordinates(plane, pane, event);
    const [u, v] = this.worldAt(plane, pane, event);
    const hit = [...this.document.snapshot().brushes].reverse().find((brush) => inRect(u, v, brush, plane));
    if (this.tool === "select") {
      this.selectedId = hit?.id ?? null;
      const axes = AXES[plane];
      const edge = hit ? pickResizeEdge(hit, axes.u, axes.v, u, v, 8 / this.zoom) : null;
      this.gesture = hit
        ? {
            plane,
            mode: edge ? "resize" : "move",
            start,
            current: start,
            brush: hit,
            edge: edge ?? undefined,
            workPlane: this.workPlanes[axes.hidden],
            grid: this.grid,
          }
        : null;
      this.rebuildMeshes();
      this.trySaveView();
    } else
      this.gesture = {
        plane,
        mode: "draw",
        start,
        current: start,
        workPlane: this.workPlanes[AXES[plane].hidden],
        grid: this.grid,
      };
    this.draw();
    this.trySaveView();
  }

  private pointerMove(plane: Plane, event: PointerEvent): void {
    if (this.pan?.plane === plane) {
      this.viewCenter = panCenter(
        plane,
        this.pan.center,
        this.zoom,
        event.clientX - this.pan.x,
        event.clientY - this.pan.y,
      );
      this.draw();
      return;
    }
    if (!this.gesture || this.gesture.plane !== plane) {
      const pane = this.panes.get(plane);
      if (!pane) return;
      const [u, v] = this.coordinates(plane, pane, event, this.grid);
      const axes = AXES[plane];
      const coord = { x: 0, y: 0, z: 0 } as Vec3q;
      coord[axes.u] = u;
      coord[axes.v] = v;
      coord[axes.hidden] = this.workPlanes[axes.hidden];
      this.hoverPlane = plane;
      this.hoverCoord = coord;
      this.renderStatus();
      return;
    }
    this.hoverPlane = null;
    this.hoverCoord = null;
    this.gesture.current = this.coordinates(plane, this.panes.get(plane)!, event, this.gesture.grid);
    this.draw();
  }

  private pointerUp(plane: Plane, event: PointerEvent): void {
    if (this.pan?.plane === plane && event.button === 1) {
      this.pointerMove(plane, event);
      this.pan = null;
      this.trySaveView();
      return;
    }
    if (event.button !== 0) return;
    const gesture = this.gesture;
    if (!gesture || gesture.plane !== plane) return;
    gesture.current = this.coordinates(plane, this.panes.get(plane)!, event, gesture.grid);
    this.gesture = null;
    const [u0, v0] = gesture.start;
    const [u1, v1] = gesture.current;
    if (u0 === u1 && v0 === v1) {
      this.draw();
      return;
    }
    const axes = AXES[plane];
    if (gesture.mode === "draw") {
      const bounds = drawBounds(axes, gesture.start, gesture.current, gesture.workPlane, gesture.grid);
      if (!bounds) {
        this.status("Drag at least one grid cell in both axes");
        this.draw();
        return;
      }
      const brush: BoxBrush = { id: crypto.randomUUID(), ...bounds, shader: "blx/blx_grid" };
      this.document.transact((data) => {
        data.brushes.push(brush);
      });
      this.selectedId = brush.id;
    } else if (gesture.mode === "resize" && gesture.brush && gesture.edge) {
      const edge = gesture.edge;
      const value = edge.axis === axes.u ? u1 : v1;
      const candidate = resizeBox(gesture.brush, edge, value, this.grid);
      if (
        candidate.min[edge.axis] === gesture.brush.min[edge.axis] &&
        candidate.max[edge.axis] === gesture.brush.max[edge.axis]
      ) {
        this.draw();
        return;
      }
      const id = gesture.brush.id;
      this.document.transact((data) => {
        const index = data.brushes.findIndex((item) => item.id === id);
        data.brushes[index] = candidate;
      });
    } else if (gesture.brush) {
      const du = u1 - u0;
      const dv = v1 - v0;
      const id = gesture.brush.id;
      this.document.transact((data) => {
        const index = data.brushes.findIndex((item) => item.id === id);
        data.brushes[index] = moveBox(gesture.brush!, axes, du, dv);
      });
    }
    this.changed();
  }

  private cancelGesture(): void {
    this.gesture = null;
    if (this.pan) this.viewCenter = this.pan.center;
    this.pan = null;
    this.draw();
  }

  private changed(): void {
    if (this.selectedId && !this.document.snapshot().brushes.some((brush) => brush.id === this.selectedId)) {
      this.selectedId = null;
    }
    this.rebuildMeshes();
    this.draw();
    try {
      this.save();
    } catch (error) {
      this.status(`Autosave failed: ${String(error)}`);
    }
  }

  private submitInspector(event: Event): void {
    event.preventDefault();
    const form = event.target as HTMLFormElement;
    if (!form.matches("[data-brush-form]") || !this.selectedId) return;
    const values = new FormData(form);
    const id = this.selectedId;
    try {
      this.document.transact((data) => {
        const brush = data.brushes.find((item) => item.id === id);
        if (!brush) throw new Error("Selected brush no longer exists");
        for (const axis of ["x", "y", "z"] as const) {
          brush.min[axis] = Number(values.get(`min-${axis}`));
          brush.max[axis] = Number(values.get(`max-${axis}`));
        }
        brush.shader = String(values.get("shader") ?? "").trim();
      });
      this.changed();
    } catch (error) {
      this.status(`Brush edit rejected: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private rebuildMeshes(): void {
    for (const mesh of this.meshes.values()) {
      mesh.material?.dispose();
      mesh.dispose();
    }
    this.meshes.clear();
    for (const brush of this.document.snapshot().brushes) {
      const mesh = MeshBuilder.CreateBox(
        brush.id,
        {
          width: brush.max.x - brush.min.x,
          height: brush.max.z - brush.min.z,
          depth: brush.max.y - brush.min.y,
        },
        this.scene,
      );
      mesh.position = new Vector3(
        (brush.min.x + brush.max.x) / 2,
        (brush.min.z + brush.max.z) / 2,
        (brush.min.y + brush.max.y) / 2,
      );
      const material = new StandardMaterial(`editor-${brush.id}`, this.scene);
      material.diffuseColor = brush.id === this.selectedId ? new Color3(1, 0.75, 0.2) : new Color3(0.1, 0.8, 0.9);
      material.alpha = 0.82;
      mesh.material = material;
      mesh.enableEdgesRendering();
      mesh.edgesWidth = 2;
      mesh.edgesColor = new Color4(0.02, 0.02, 0.05, 1);
      this.meshes.set(brush.id, mesh);
    }
  }

  private previewBrush(): BoxBrush | null {
    const gesture = this.gesture;
    if (!gesture) return null;
    const axes = AXES[gesture.plane];
    if (gesture.mode === "draw") {
      const bounds = drawBounds(axes, gesture.start, gesture.current, gesture.workPlane, gesture.grid);
      return bounds ? { id: "gesture-preview", ...bounds, shader: "blx/blx_grid" } : null;
    }
    if (!gesture.brush) return null;
    if (gesture.mode === "resize" && gesture.edge) {
      const value = gesture.edge.axis === axes.u ? gesture.current[0] : gesture.current[1];
      return resizeBox(gesture.brush, gesture.edge, value, gesture.grid);
    }
    return moveBox(gesture.brush, axes, gesture.current[0] - gesture.start[0], gesture.current[1] - gesture.start[1]);
  }

  private disposeGhost(): void {
    if (!this.ghost) return;
    this.ghost.material?.dispose();
    this.ghost.dispose();
    this.ghost = null;
  }

  private syncGhost(preview: BoxBrush | null): void {
    for (const [id, mesh] of this.meshes) {
      mesh.isVisible = !(this.gesture?.mode !== "draw" && this.gesture?.brush?.id === id && preview);
    }
    if (!preview) {
      this.disposeGhost();
      return;
    }
    if (!this.ghost) {
      this.ghost = MeshBuilder.CreateBox("shagged-gesture-preview", { size: 1 }, this.scene);
      this.ghost.isPickable = false;
      const material = new StandardMaterial("shagged-gesture-material", this.scene);
      material.diffuseColor = new Color3(1, 0.78, 0.17);
      material.alpha = 0.35;
      this.ghost.material = material;
      this.ghost.enableEdgesRendering();
      this.ghost.edgesWidth = 3;
      this.ghost.edgesColor = new Color4(1, 0.85, 0.28, 1);
    }
    this.ghost.scaling.set(preview.max.x - preview.min.x, preview.max.z - preview.min.z, preview.max.y - preview.min.y);
    this.ghost.position.set(
      (preview.min.x + preview.max.x) / 2,
      (preview.min.z + preview.max.z) / 2,
      (preview.min.y + preview.max.y) / 2,
    );
  }

  private draw(): void {
    const data = this.document.snapshot();
    const preview = this.previewBrush();
    for (const [plane, canvas] of this.panes) {
      const rect = canvas.getBoundingClientRect();
      if (!rect.width || !rect.height) continue;
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.round(rect.width * dpr);
      canvas.height = Math.round(rect.height * dpr);
      const ctx = canvas.getContext("2d")!;
      ctx.scale(dpr, dpr);
      const w = rect.width;
      const h = rect.height;
      const axes = AXES[plane];
      const originX = w / 2 - this.viewCenter[axes.u] * this.zoom;
      const originY = h / 2 + this.viewCenter[axes.v] * this.zoom;
      ctx.fillStyle = "#101b31";
      ctx.fillRect(0, 0, w, h);
      const cell = this.grid * this.zoom;
      ctx.strokeStyle = "rgba(70, 150, 180, .17)";
      ctx.lineWidth = 1;
      for (let x = ((originX % cell) + cell) % cell; x < w; x += cell) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, h);
        ctx.stroke();
      }
      for (let y = ((originY % cell) + cell) % cell; y < h; y += cell) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(w, y);
        ctx.stroke();
      }
      ctx.strokeStyle = "rgba(0, 255, 255, .55)";
      ctx.beginPath();
      ctx.moveTo(originX, 0);
      ctx.lineTo(originX, h);
      ctx.moveTo(0, originY);
      ctx.lineTo(w, originY);
      ctx.stroke();
      const paint = (min: Vec3q, max: Vec3q, selected: boolean) => {
        const x = originX + min[axes.u] * this.zoom;
        const y = originY - max[axes.v] * this.zoom;
        const rw = (max[axes.u] - min[axes.u]) * this.zoom;
        const rh = (max[axes.v] - min[axes.v]) * this.zoom;
        ctx.fillStyle = selected ? "rgba(255,198,26,.36)" : "rgba(0,225,240,.25)";
        ctx.strokeStyle = selected ? "#ffc61a" : "#41deeb";
        ctx.lineWidth = selected ? 2 : 1;
        ctx.fillRect(x, y, rw, rh);
        ctx.strokeRect(x, y, rw, rh);
        if (selected) {
          ctx.fillStyle = "#fff3bd";
          for (const [hx, hy] of [
            [x + rw / 2, y],
            [x + rw / 2, y + rh],
            [x, y + rh / 2],
            [x + rw, y + rh / 2],
          ])
            ctx.fillRect(hx - 3, hy - 3, 6, 6);
        }
      };
      for (const brush of data.brushes) {
        const edited = this.gesture?.mode !== "draw" && this.gesture?.brush?.id === brush.id && preview;
        paint(
          edited ? preview.min : brush.min,
          edited ? preview.max : brush.max,
          !!edited || brush.id === this.selectedId,
        );
      }
      if (this.gesture?.mode === "draw" && preview) paint(preview.min, preview.max, true);
    }
    this.syncGhost(preview);
    this.renderInspector(data);
    for (const name of ["brush", "select"] as const)
      this.root.querySelector(`[data-action="${name}"]`)?.classList.toggle("active", this.tool === name);
    this.root.querySelector<HTMLButtonElement>('[data-action="undo"]')!.disabled = !this.document.canUndo;
    this.root.querySelector<HTMLButtonElement>('[data-action="redo"]')!.disabled = !this.document.canRedo;
    this.renderStatus();
  }

  /** Rebuilt only when the selection or the document changes, so a pan or zoom keeps a half-typed value. */
  private renderInspector(data: EditorDocumentData): void {
    const key = `${data.draftId}|${this.selectedId ?? ""}|${data.revision}`;
    if (key === this.inspectorKey) return;
    this.inspectorKey = key;
    const selected = data.brushes.find((brush) => brush.id === this.selectedId);
    if (selected) {
      this.inspector.innerHTML = `<h2>Brush <code data-brush-id></code></h2>
        <form data-brush-form>
          <div class="shagged__bounds-head"><span>Axis</span><span>Min</span><span>Max</span></div>
          ${(["x", "y", "z"] as const)
            .map(
              (axis) => `<label class="shagged__bounds"><span>${axis.toUpperCase()}</span>
                <input name="min-${axis}" type="number" step="1" required>
                <input name="max-${axis}" type="number" step="1" required></label>`,
            )
            .join("")}
          <label class="shagged__shader">Shader <input name="shader" type="text" spellcheck="false" required></label>
          <button type="submit">Apply Brush</button>
        </form><p>Values use Quake units; Z is up. One Apply is one undo step.</p>`;
      this.inspector.querySelector("[data-brush-id]")!.textContent = selected.id.slice(0, 8);
      const form = this.inspector.querySelector<HTMLFormElement>("[data-brush-form]")!;
      for (const axis of ["x", "y", "z"] as const) {
        form.querySelector<HTMLInputElement>(`[name="min-${axis}"]`)!.value = String(selected.min[axis]);
        form.querySelector<HTMLInputElement>(`[name="max-${axis}"]`)!.value = String(selected.max[axis]);
      }
      form.querySelector<HTMLInputElement>('[name="shader"]')!.value = selected.shader;
    } else this.inspector.textContent = "Drag in an orthographic pane to draw a brush. Select (V) to move one.";
  }
}
