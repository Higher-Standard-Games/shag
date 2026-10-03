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
import {
  type BoxBrush,
  EditorDocument,
  type EditorDocumentData,
  ownerOf,
  type PointEntity,
  pruneBrushEntities,
  type Vec3q,
} from "./EditorDocument";
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
import {
  BRUSH_ENTITY_CLASSES,
  brushEntityShader,
  type EntityClassDef,
  entityClass,
  missingRequiredKeys,
  POINT_ENTITY_CLASSES,
} from "./EntityCatalog";
import { writeMap } from "./MapWriter";
import { createRoomTemplate } from "./RoomTemplate";
import type { EditorCompileJob, EditorServerStatus, ShaggedApi } from "./ShaggedApi";
import "./editor.css";

type Gesture = {
  plane: Plane;
  mode: "draw" | "move" | "resize";
  start: [number, number];
  current: [number, number];
  brush?: BoxBrush;
  entity?: PointEntity;
  edge?: ResizeEdge;
  workPlane: number;
  grid: number;
};

type Tool = "brush" | "select" | "entity";

/** An entity's box in world space: its class's mins/maxs around the origin. */
function entityBox(entity: PointEntity): { min: Vec3q; max: Vec3q } {
  const def = entityClass(entity.classname);
  const at = (offset: Vec3q): Vec3q => ({
    x: entity.origin.x + offset.x,
    y: entity.origin.y + offset.y,
    z: entity.origin.z + offset.z,
  });
  return { min: at(def.mins), max: at(def.maxs) };
}

function cssColor([r, g, b]: EntityClassDef["color"], alpha = 1): string {
  return `rgba(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)}, ${alpha})`;
}

/** Catalog classes grouped by their entities.def section; a classname outside the catalog is kept as its own option. */
function fillClassOptions(
  select: HTMLSelectElement,
  selected: string,
  catalog: readonly EntityClassDef[] = POINT_ENTITY_CLASSES,
): void {
  select.replaceChildren();
  const groups = new Map<string, HTMLOptGroupElement>();
  const classes = catalog.some((def) => def.classname === selected) ? catalog : [...catalog, entityClass(selected)];
  for (const def of classes) {
    let group = groups.get(def.section);
    if (!group) {
      group = document.createElement("optgroup");
      group.label = def.section;
      groups.set(def.section, group);
      select.appendChild(group);
    }
    const option = document.createElement("option");
    option.value = def.classname;
    option.textContent = def.classname;
    group.appendChild(option);
  }
  select.value = selected;
}

/**
 * One field per key: the class's documented keys (required ones marked) plus
 * any other key the entity already carries, so nothing the catalog doesn't
 * know is dropped on Apply. Values go through DOM properties, never markup.
 */
function appendKeyRows(rows: HTMLElement, def: EntityClassDef, keys: Record<string, string>): void {
  const documented = new Set(def.keys.map((key) => key.name));
  const fields = [
    ...def.keys,
    ...Object.keys(keys)
      .filter((name) => !documented.has(name))
      .sort()
      .map((name) => ({ name, label: "Not in the class list", defaultValue: undefined, required: undefined })),
  ];
  for (const field of fields) {
    const label = document.createElement("label");
    label.className = field.required ? "shagged__key shagged__key--required" : "shagged__key";
    const name = document.createElement("span");
    name.textContent = field.required ? `${field.name} *` : field.name;
    name.title = field.required ? `${field.label} (required)` : field.label;
    const input = document.createElement("input");
    input.type = "text";
    input.spellcheck = false;
    input.name = `key:${field.name}`;
    input.value = keys[field.name] ?? "";
    if (field.defaultValue) input.placeholder = field.defaultValue;
    label.append(name, input);
    rows.appendChild(label);
  }
}

/** The key fields of a submitted form, plus the new-key pair; an empty value removes a key. */
function readKeys(values: FormData): Record<string, string> {
  const keys: Record<string, string> = {};
  for (const [name, value] of values) {
    if (!name.startsWith("key:")) continue;
    const text = String(value).trim();
    if (text) keys[name.slice(4)] = text;
  }
  const newKey = String(values.get("new-key") ?? "").trim();
  const newValue = String(values.get("new-value") ?? "").trim();
  if (newKey && newValue) keys[newKey] = newValue;
  return keys;
}

/** World, the map's existing brush entities, then every brush class as a new entity. */
function fillOwnerOptions(select: HTMLSelectElement, data: EditorDocumentData, ownerId: string | undefined): void {
  select.replaceChildren();
  const option = (value: string, text: string) => {
    const element = document.createElement("option");
    element.value = value;
    element.textContent = text;
    return element;
  };
  select.appendChild(option("world", "World (worldspawn)"));
  const existing = data.brushEntities ?? [];
  if (existing.length) {
    const group = document.createElement("optgroup");
    group.label = "In this map";
    for (const entity of existing) {
      group.appendChild(option(`entity:${entity.id}`, `${entity.classname} ${entity.id.slice(0, 8)}`));
    }
    select.appendChild(group);
  }
  const fresh = document.createElement("optgroup");
  fresh.label = "New brush entity";
  for (const def of BRUSH_ENTITY_CLASSES) fresh.appendChild(option(`new:${def.classname}`, def.classname));
  select.appendChild(fresh);
  select.value = ownerId ? `entity:${ownerId}` : "world";
}

/** Brushes owned by a brush entity, coloured by that entity's class. */
function brushOwnerColors(data: EditorDocumentData): Map<string, EntityClassDef["color"]> {
  const colors = new Map<string, EntityClassDef["color"]>();
  for (const entity of data.brushEntities ?? []) {
    const color = entityClass(entity.classname).color;
    for (const id of entity.brushIds) colors.set(id, color);
  }
  return colors;
}

const NEW_KEY_ROW = `<div class="shagged__key shagged__key--new">
  <input name="new-key" type="text" spellcheck="false" placeholder="new key" aria-label="New key name">
  <input name="new-value" type="text" spellcheck="false" placeholder="value" aria-label="New key value">
</div>`;

function moveEntity(entity: PointEntity, axes: (typeof AXES)[Plane], du: number, dv: number): PointEntity {
  const result = structuredClone(entity);
  result.origin[axes.u] += du;
  result.origin[axes.v] += dv;
  return result;
}

function snap(n: number, grid: number): number {
  return Math.round(n / grid) * grid;
}
function inRect(u: number, v: number, b: { min: Vec3q; max: Vec3q }, plane: Plane): boolean {
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
  private tool: Tool = "brush";
  private entityClassname = "info_player_deathmatch";
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
  private serverSave: EditorViewState["serverSave"];
  private serverStatus: EditorServerStatus | null = null;
  private serverBusy = false;
  private compileJob: EditorCompileJob | null = null;
  private pollTimer: ReturnType<typeof setTimeout> | null = null;
  private serverGeneration = 0;

  constructor(
    engine: AbstractEngine,
    private readonly canvas: HTMLCanvasElement,
    private readonly onExit: () => void,
    private readonly api: ShaggedApi | null = null,
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
        <button data-action="entity">Entity (E)</button><select data-entity-class aria-label="Entity class" title="Class placed by the Entity tool"></select>
        <button data-action="delete" title="Delete">Delete</button>
        <button data-action="frame-selection">Frame (F)</button><button data-action="frame-all">Frame All (Shift+F)</button>
        <label>Grid <select data-grid title="[ / ] to step"><option>8</option><option selected>16</option><option>32</option><option>64</option></select></label>
        <label>Work <span data-work-axis>Z</span> <input data-workplane type="number" step="1" value="0"></label>
        <span class="shagged__separator"></span>
        <button data-action="server-save" disabled title="Connecting to SHAGGED server">Server Save</button>
        <button data-action="compile" disabled title="Connecting to SHAGGED server">Compile</button>
        <button data-action="compile-status" title="Check server and compile status">Status: offline</button>
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
      <section class="shagged__build" aria-label="Compile status" hidden>
        <div class="shagged__drafts-head"><h2>Compile status</h2><button data-action="close-build">Close</button></div>
        <pre data-build-log></pre>
      </section>
      <aside class="shagged__inspector"></aside>
      <footer class="shagged__status"></footer>`;
    document.body.appendChild(this.root);
    this.statusEl = this.root.querySelector(".shagged__status")!;
    this.inspector = this.root.querySelector(".shagged__inspector")!;
    this.root.querySelector<HTMLSelectElement>("[data-grid]")!.value = String(this.grid);
    this.root.querySelector<HTMLInputElement>("[data-draft-name]")!.value = this.draftName;
    this.updateWorkPlaneControl();
    const classPicker = this.root.querySelector<HTMLSelectElement>("[data-entity-class]")!;
    fillClassOptions(classPicker, this.entityClassname);
    classPicker.addEventListener(
      "change",
      () => {
        this.entityClassname = classPicker.value;
        this.action("entity");
      },
      { signal: this.listeners.signal },
    );

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
    if (this.api) void this.refreshServerStatus();
  }

  get draftId(): string {
    return this.document.snapshot().draftId;
  }
  private exists(id: string | null | undefined): boolean {
    if (!id) return false;
    const data = this.document.snapshot();
    return data.brushes.some((brush) => brush.id === id) || data.entities.some((entity) => entity.id === id);
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
      serverSave: this.serverSave,
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
    this.serverGeneration++;
    if (this.pollTimer) clearTimeout(this.pollTimer);
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
    const data = this.document.snapshot();
    const saved =
      this.serverSave?.documentRevision === this.revision ? `server r${this.serverSave.revision}` : "server unsaved";
    this.statusEl.textContent = `${this.lastMessage} · ${data.brushes.length} brushes · ${data.entities.length + (data.brushEntities?.length ?? 0)} entities · revision ${this.revision} · ${this.activePlane.toUpperCase()} work ${hidden.toUpperCase()}=${this.workPlanes[hidden]} · grid ${this.grid}${dimensions}${cursor} · ${saved}`;
  }

  private updateServerButtons(): void {
    const save = this.root.querySelector<HTMLButtonElement>('[data-action="server-save"]')!;
    const compile = this.root.querySelector<HTMLButtonElement>('[data-action="compile"]')!;
    const status = this.root.querySelector<HTMLButtonElement>('[data-action="compile-status"]')!;
    save.disabled = !this.serverStatus?.saveAvailable || this.serverBusy;
    compile.disabled = !this.serverStatus?.compilerAvailable || this.serverBusy;
    save.title = this.serverStatus?.saveAvailable
      ? "Save an immutable .map revision on the editor server"
      : "Start npm run shagged:server";
    compile.title = this.serverStatus?.compilerAvailable
      ? "Save this draft, then compile with MakeBSP"
      : (this.serverStatus?.reason ?? "Start npm run shagged:server");
    status.textContent = this.compileJob
      ? `Status: ${this.compileJob.state}`
      : this.serverStatus?.compilerAvailable
        ? "Status: ready"
        : this.serverStatus
          ? "Status: no compiler"
          : "Status: offline";
    const lines = this.compileJob
      ? [
          `${this.compileJob.mapName} · revision ${this.compileJob.revision} · ${this.compileJob.state} · ${this.compileJob.stage}`,
          ...this.compileJob.logs,
        ]
      : [this.serverStatus?.reason ?? "No compile job. Start the editor server to save and compile maps."];
    this.root.querySelector<HTMLElement>("[data-build-log]")!.textContent = lines.join("\n");
  }

  private async refreshServerStatus(): Promise<void> {
    const generation = this.serverGeneration;
    try {
      const status = await this.api?.status();
      if (generation !== this.serverGeneration) return;
      this.serverStatus = status ?? null;
      if (status) this.status(status.compilerAvailable ? "Editor server connected" : `Editor server: ${status.reason}`);
    } catch (error) {
      if (generation !== this.serverGeneration) return;
      this.serverStatus = null;
      this.serverError(error);
    }
    this.updateServerButtons();
  }

  private serverError(error: unknown): void {
    this.status(error instanceof Error ? error.message : String(error));
    this.updateServerButtons();
  }

  private resetCompileJob(): void {
    this.serverGeneration++;
    if (this.pollTimer) clearTimeout(this.pollTimer);
    this.pollTimer = null;
    this.compileJob = null;
    this.root.querySelector<HTMLElement>(".shagged__build")!.hidden = true;
    this.updateServerButtons();
    if (!this.serverStatus && this.api) void this.refreshServerStatus();
  }

  private async saveCurrentToServer(): Promise<number> {
    if (!this.api || !this.serverStatus?.saveAvailable) throw new Error("Editor server is unavailable");
    const data = this.document.snapshot();
    this.save();
    const name = `draft_${data.draftId.replace(/-/g, "")}`;
    const actualRevision = await this.api.mapRevision(name);
    if (actualRevision !== (this.serverSave?.revision ?? 0)) {
      throw new Error(
        `Server map is at revision ${actualRevision}; this draft expects ${this.serverSave?.revision ?? 0}. Resolve the conflict before saving.`,
      );
    }
    if (this.serverSave?.documentRevision === data.revision) return this.serverSave.revision;
    const saved = await this.api.save(name, writeMap(data), this.serverSave?.revision ?? 0, data);
    this.serverSave = { revision: saved.revision, documentRevision: data.revision };
    this.save();
    this.status(`Saved ${name}.map on server at revision ${saved.revision}`);
    return saved.revision;
  }

  private async saveServer(): Promise<void> {
    if (this.serverBusy) return;
    this.serverBusy = true;
    this.updateServerButtons();
    try {
      await this.saveCurrentToServer();
    } finally {
      this.serverBusy = false;
      this.updateServerButtons();
    }
  }

  private async startCompile(): Promise<void> {
    if (this.serverBusy || !this.api || !this.serverStatus?.compilerAvailable) return;
    this.serverBusy = true;
    this.updateServerButtons();
    try {
      const revision = await this.saveCurrentToServer();
      const name = `draft_${this.draftId.replace(/-/g, "")}`;
      const started = await this.api.compile(name, revision);
      this.resetCompileJob();
      const generation = this.serverGeneration;
      this.compileJob = {
        id: started.jobId,
        mapName: name,
        revision,
        state: "queued",
        stage: "queued",
        logs: [],
        runtimeMapName: null,
      };
      this.status(`Compile queued for ${name}.map revision ${revision}`);
      this.updateServerButtons();
      void this.refreshJob(generation);
    } finally {
      this.serverBusy = false;
      this.updateServerButtons();
    }
  }

  private async refreshJob(generation: number): Promise<void> {
    const id = this.compileJob?.id;
    if (!id || !this.api) return;
    try {
      const job = await this.api.job(id);
      if (generation !== this.serverGeneration || id !== this.compileJob?.id) return;
      this.compileJob = job;
      this.updateServerButtons();
      this.status(`Compile ${job.state}: ${job.stage}`);
      if (job.state === "queued" || job.state === "running") {
        this.pollTimer = setTimeout(() => void this.refreshJob(generation), 1500);
      }
    } catch (error) {
      if (generation === this.serverGeneration) this.serverError(error);
    }
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
    this.serverSave = view?.serverSave;
    this.workPlanes = { ...(view?.workPlanes ?? { x: 0, y: 0, z: 0 }) };
    this.activePlane = view?.activePlane ?? "xy";
    this.selectedId = this.exists(view?.selectedId) ? (view?.selectedId ?? null) : null;
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
      button.textContent = `${draft.name} · ${draft.brushCount} brushes · ${draft.entityCount} entities · r${draft.revision}${draft.active ? " · current" : ""}`;
      list.appendChild(button);
    }
    if (!list.childElementCount) list.textContent = "No saved drafts yet.";
    this.root.querySelector<HTMLElement>(".shagged__drafts")!.hidden = false;
  }

  private openDraft(id: string): void {
    if (id === this.draftId) return;
    this.resetCompileJob();
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
          if (this.serverBusy) throw new Error("Wait for the server request to finish");
          this.save();
          this.resetCompileJob();
          this.cancelGesture();
          this.document = new EditorDocument();
          this.serverSave = undefined;
          this.selectedId = null;
          this.draftName = "Untitled";
          this.root.querySelector<HTMLInputElement>("[data-draft-name]")!.value = this.draftName;
          this.changed();
          break;
        case "room":
          if (this.serverBusy) throw new Error("Wait for the server request to finish");
          this.save();
          this.resetCompileJob();
          this.cancelGesture();
          this.document = new EditorDocument(createRoomTemplate());
          this.serverSave = undefined;
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
          if (this.serverBusy) throw new Error("Wait for the server request to finish");
          if (draftId) this.openDraft(draftId);
          break;
        case "save":
          this.save();
          break;
        case "server-save":
          void this.saveServer().catch((error: unknown) => this.serverError(error));
          break;
        case "compile":
          void this.startCompile().catch((error: unknown) => this.serverError(error));
          break;
        case "compile-status":
          this.root.querySelector<HTMLElement>(".shagged__build")!.hidden = false;
          if (this.compileJob) void this.refreshJob(this.serverGeneration);
          else void this.refreshServerStatus();
          break;
        case "close-build":
          this.root.querySelector<HTMLElement>(".shagged__build")!.hidden = true;
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
        case "entity":
          this.cancelGesture();
          this.tool = action;
          this.draw();
          this.trySaveView();
          break;
        case "duplicate":
          this.duplicateSelection();
          break;
        case "delete":
          if (this.selectedId) {
            const id = this.selectedId;
            this.document.transact((data) => {
              data.brushes = data.brushes.filter((brush) => brush.id !== id);
              data.entities = data.entities.filter((entity) => entity.id !== id);
              pruneBrushEntities(data);
            });
            this.selectedId = null;
            this.changed();
          }
          break;
        case "exit":
          if (this.serverBusy) throw new Error("Wait for the server request to finish");
          this.save();
          this.onExit();
          break;
      }
    } catch (error) {
      this.status(error instanceof Error ? error.message : String(error));
    }
  }

  /** A copy one grid step along +X, keys and all, as one undo step. A brush copy joins its original's entity. */
  private duplicateSelection(): void {
    const data = this.document.snapshot();
    const brush = data.brushes.find((item) => item.id === this.selectedId);
    const entity = data.entities.find((item) => item.id === this.selectedId);
    const id = crypto.randomUUID();
    if (brush) {
      const copy = structuredClone(brush);
      copy.id = id;
      copy.min.x += this.grid;
      copy.max.x += this.grid;
      this.document.transact((draft) => {
        draft.brushes.push(copy);
        ownerOf(draft, brush.id)?.brushIds.push(id);
      });
    } else if (entity) {
      const copy = structuredClone(entity);
      copy.id = id;
      copy.origin.x += this.grid;
      this.document.transact((draft) => draft.entities.push(copy));
    } else return;
    this.selectedId = id;
    this.changed();
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
    else if (key === "e") this.action("entity");
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
    const data = this.document.snapshot();
    const boxes = [
      ...data.brushes.map((brush) => ({ id: brush.id, min: brush.min, max: brush.max })),
      ...data.entities.map((entity) => ({ id: entity.id, ...entityBox(entity) })),
    ].filter((box) => all || !this.selectedId || box.id === this.selectedId);
    const bounds = brushBounds(boxes);
    if (!bounds) {
      this.status("Nothing to frame");
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
    const axes = AXES[plane];
    if (this.tool === "entity") {
      this.placeEntity(plane, start);
      return;
    }
    const data = this.document.snapshot();
    // Entities are small and drawn on top of brushes, so they win a shared click.
    const entityHit = [...data.entities].reverse().find((entity) => inRect(u, v, entityBox(entity), plane));
    const hit = entityHit ? undefined : [...data.brushes].reverse().find((brush) => inRect(u, v, brush, plane));
    if (this.tool === "select") {
      this.selectedId = entityHit?.id ?? hit?.id ?? null;
      const edge = hit ? pickResizeEdge(hit, axes.u, axes.v, u, v, 8 / this.zoom) : null;
      this.gesture =
        entityHit || hit
          ? {
              plane,
              mode: edge ? "resize" : "move",
              start,
              current: start,
              brush: hit,
              entity: entityHit,
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

  /**
   * One click, one entity of the picked class at the snapped point. Seen from
   * above, the hidden axis is height, so the entity stands on the work plane
   * (its box's bottom on it) rather than sinking half into the floor.
   */
  private placeEntity(plane: Plane, [u, v]: [number, number]): void {
    const axes = AXES[plane];
    const def = entityClass(this.entityClassname);
    const origin: Vec3q = { x: 0, y: 0, z: 0 };
    origin[axes.u] = u;
    origin[axes.v] = v;
    const work = this.workPlanes[axes.hidden];
    origin[axes.hidden] = axes.hidden === "z" ? work - def.mins.z : work;
    const entity: PointEntity = { id: crypto.randomUUID(), classname: def.classname, origin, keys: {} };
    this.document.transact((data) => data.entities.push(entity));
    this.selectedId = entity.id;
    this.changed();
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
    } else if (gesture.entity) {
      const moved = moveEntity(gesture.entity, axes, u1 - u0, v1 - v0);
      this.document.transact((data) => {
        const index = data.entities.findIndex((item) => item.id === moved.id);
        data.entities[index] = moved;
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
    if (this.selectedId && !this.exists(this.selectedId)) this.selectedId = null;
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
    if (form.matches("[data-entity-form]") && this.selectedId) {
      this.submitEntity(form, this.selectedId);
      return;
    }
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
        this.applyOwner(data, brush, values);
      });
      this.changed();
    } catch (error) {
      this.status(`Brush edit rejected: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * The brush form's Entity choice, inside its transaction: keep the current
   * entity (and apply its class and keys), move to another, return to
   * worldspawn, or start a new entity of a brush class. Empty entities are
   * pruned, so leaving the last brush removes the entity.
   */
  private applyOwner(data: EditorDocumentData, brush: BoxBrush, values: FormData): void {
    data.brushEntities ??= [];
    const choice = String(values.get("owner") ?? "world");
    const current = ownerOf(data, brush.id);
    if (current && choice === `entity:${current.id}`) {
      current.classname = String(values.get("owner-classname") ?? current.classname).trim();
      current.keys = readKeys(values);
    } else {
      if (current) current.brushIds = current.brushIds.filter((id) => id !== brush.id);
      if (choice.startsWith("entity:")) {
        const target = data.brushEntities.find((entity) => entity.id === choice.slice(7));
        if (!target) throw new Error("That brush entity no longer exists");
        target.brushIds.push(brush.id);
      } else if (choice.startsWith("new:")) {
        const classname = choice.slice(4);
        data.brushEntities.push({ id: crypto.randomUUID(), classname, keys: {}, brushIds: [brush.id] });
        brush.shader = brushEntityShader(classname) ?? brush.shader;
      }
    }
    pruneBrushEntities(data);
  }

  private submitEntity(form: HTMLFormElement, id: string): void {
    const values = new FormData(form);
    const keys = readKeys(values);
    try {
      this.document.transact((data) => {
        const entity = data.entities.find((item) => item.id === id);
        if (!entity) throw new Error("Selected entity no longer exists");
        entity.classname = String(values.get("classname") ?? "").trim();
        for (const axis of ["x", "y", "z"] as const) entity.origin[axis] = Number(values.get(`origin-${axis}`));
        entity.keys = keys;
      });
      this.changed();
    } catch (error) {
      this.status(`Entity edit rejected: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private rebuildMeshes(): void {
    for (const mesh of this.meshes.values()) {
      mesh.material?.dispose();
      mesh.dispose();
    }
    this.meshes.clear();
    const data = this.document.snapshot();
    const ownerColors = brushOwnerColors(data);
    for (const brush of data.brushes) {
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
      const owned = ownerColors.get(brush.id);
      material.diffuseColor =
        brush.id === this.selectedId
          ? new Color3(1, 0.75, 0.2)
          : owned
            ? new Color3(...owned)
            : new Color3(0.1, 0.8, 0.9);
      material.alpha = 0.82;
      mesh.material = material;
      mesh.enableEdgesRendering();
      mesh.edgesWidth = 2;
      mesh.edgesColor = new Color4(0.02, 0.02, 0.05, 1);
      this.meshes.set(brush.id, mesh);
    }
    for (const entity of data.entities) {
      const { min, max } = entityBox(entity);
      const mesh = MeshBuilder.CreateBox(
        entity.id,
        { width: max.x - min.x, height: max.z - min.z, depth: max.y - min.y },
        this.scene,
      );
      mesh.position = new Vector3((min.x + max.x) / 2, (min.z + max.z) / 2, (min.y + max.y) / 2);
      const material = new StandardMaterial(`editor-${entity.id}`, this.scene);
      const [r, g, b] = entityClass(entity.classname).color;
      material.diffuseColor = entity.id === this.selectedId ? new Color3(1, 0.75, 0.2) : new Color3(r, g, b);
      material.emissiveColor = new Color3(r * 0.35, g * 0.35, b * 0.35);
      mesh.material = material;
      mesh.enableEdgesRendering();
      mesh.edgesWidth = 2;
      mesh.edgesColor = new Color4(0.02, 0.02, 0.05, 1);
      this.meshes.set(entity.id, mesh);
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
    const ownerColors = brushOwnerColors(data);
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
      const paint = (min: Vec3q, max: Vec3q, selected: boolean, color?: EntityClassDef["color"]) => {
        const x = originX + min[axes.u] * this.zoom;
        const y = originY - max[axes.v] * this.zoom;
        const rw = (max[axes.u] - min[axes.u]) * this.zoom;
        const rh = (max[axes.v] - min[axes.v]) * this.zoom;
        ctx.fillStyle = selected ? "rgba(255,198,26,.36)" : color ? cssColor(color, 0.3) : "rgba(0,225,240,.25)";
        ctx.strokeStyle = selected ? "#ffc61a" : color ? cssColor(color) : "#41deeb";
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
          ownerColors.get(brush.id),
        );
      }
      if (this.gesture?.mode === "draw" && preview) paint(preview.min, preview.max, true);
      const dragged = this.gesture?.entity;
      for (const original of data.entities) {
        const moving = dragged?.id === original.id && this.gesture;
        const entity = moving
          ? moveEntity(original, axes, moving.current[0] - moving.start[0], moving.current[1] - moving.start[1])
          : original;
        const { min, max } = entityBox(entity);
        const selected = entity.id === this.selectedId || !!moving;
        const color = entityClass(entity.classname).color;
        const x = originX + min[axes.u] * this.zoom;
        const y = originY - max[axes.v] * this.zoom;
        const rw = (max[axes.u] - min[axes.u]) * this.zoom;
        const rh = (max[axes.v] - min[axes.v]) * this.zoom;
        ctx.fillStyle = cssColor(color, selected ? 0.45 : 0.28);
        ctx.strokeStyle = selected ? "#ffc61a" : cssColor(color);
        ctx.lineWidth = selected ? 2 : 1;
        ctx.fillRect(x, y, rw, rh);
        ctx.strokeRect(x, y, rw, rh);
        const cx = originX + entity.origin[axes.u] * this.zoom;
        const cy = originY - entity.origin[axes.v] * this.zoom;
        ctx.beginPath();
        ctx.moveTo(cx - 4, cy);
        ctx.lineTo(cx + 4, cy);
        ctx.moveTo(cx, cy - 4);
        ctx.lineTo(cx, cy + 4);
        ctx.stroke();
      }
    }
    this.syncGhost(preview);
    this.renderInspector(data);
    for (const name of ["brush", "select", "entity"] as const)
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
          <label class="shagged__shader">Entity <select name="owner"></select></label>
          <div data-owner-section></div>
          <button type="submit">Apply Brush</button>
        </form><p>Values use Quake units; Z is up. One Apply is one undo step. A brush in an entity leaves worldspawn; MakeBSP gives the entity its model.</p>`;
      const owner = ownerOf(data, selected.id);
      this.inspector.querySelector("[data-brush-id]")!.textContent = owner
        ? `${selected.id.slice(0, 8)} · ${owner.classname}`
        : selected.id.slice(0, 8);
      const form = this.inspector.querySelector<HTMLFormElement>("[data-brush-form]")!;
      for (const axis of ["x", "y", "z"] as const) {
        form.querySelector<HTMLInputElement>(`[name="min-${axis}"]`)!.value = String(selected.min[axis]);
        form.querySelector<HTMLInputElement>(`[name="max-${axis}"]`)!.value = String(selected.max[axis]);
      }
      form.querySelector<HTMLInputElement>('[name="shader"]')!.value = selected.shader;
      fillOwnerOptions(form.querySelector<HTMLSelectElement>('[name="owner"]')!, data, owner?.id);
      if (owner) {
        const section = form.querySelector<HTMLElement>("[data-owner-section]")!;
        section.innerHTML = `<label class="shagged__shader">Entity class <select name="owner-classname"></select></label>
          <p class="shagged__warning" data-missing hidden></p>
          <div class="shagged__keys" data-entity-keys></div>${NEW_KEY_ROW}`;
        fillClassOptions(
          section.querySelector<HTMLSelectElement>('[name="owner-classname"]')!,
          owner.classname,
          BRUSH_ENTITY_CLASSES,
        );
        appendKeyRows(
          section.querySelector<HTMLElement>("[data-entity-keys]")!,
          entityClass(owner.classname),
          owner.keys,
        );
        const missing = missingRequiredKeys(owner.classname, owner.keys);
        const warning = section.querySelector<HTMLElement>("[data-missing]")!;
        warning.hidden = missing.length === 0;
        warning.textContent = `Missing required ${missing.join(", ")}: the game drops this ${owner.classname} without it.`;
      }
      return;
    }
    const entity = data.entities.find((item) => item.id === this.selectedId);
    if (entity) {
      this.renderEntityInspector(entity);
      return;
    }
    this.inspector.textContent =
      "Drag in an orthographic pane to draw a brush. Entity (E) places the class picked in the toolbar. Select (V) moves either.";
  }

  /**
   * Class, origin, and one field per key: the class's documented keys plus any
   * other key the entity already carries, so nothing the catalog doesn't know
   * is dropped on Apply. Values are set through DOM properties, never markup.
   */
  private renderEntityInspector(entity: PointEntity): void {
    const def = entityClass(entity.classname);
    this.inspector.innerHTML = `<h2>Entity <code data-entity-id></code></h2>
      <form data-entity-form>
        <label class="shagged__shader">Class <select name="classname"></select></label>
        <div class="shagged__bounds-head"><span>Axis</span><span>Origin</span></div>
        ${(["x", "y", "z"] as const)
          .map(
            (axis) => `<label class="shagged__origin"><span>${axis.toUpperCase()}</span>
              <input name="origin-${axis}" type="number" step="1" required></label>`,
          )
          .join("")}
        <div class="shagged__keys" data-entity-keys></div>
        ${NEW_KEY_ROW}
        <button type="submit">Apply Entity</button>
      </form><p>An empty value removes that key. Keys the class list doesn't document are kept as they are.</p>`;
    this.inspector.querySelector("[data-entity-id]")!.textContent = `${entity.classname} ${entity.id.slice(0, 8)}`;
    const form = this.inspector.querySelector<HTMLFormElement>("[data-entity-form]")!;
    fillClassOptions(form.querySelector<HTMLSelectElement>('[name="classname"]')!, entity.classname);
    for (const axis of ["x", "y", "z"] as const) {
      form.querySelector<HTMLInputElement>(`[name="origin-${axis}"]`)!.value = String(entity.origin[axis]);
    }
    appendKeyRows(form.querySelector<HTMLElement>("[data-entity-keys]")!, def, entity.keys);
  }
}
