import { FreeCamera } from "@babylonjs/core/Cameras/freeCamera";
import type { AbstractEngine } from "@babylonjs/core/Engines/abstractEngine";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight";
import { ImportMeshAsync } from "@babylonjs/core/Loading/sceneLoader";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3, Color4 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Viewport } from "@babylonjs/core/Maths/math.viewport";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { Scene } from "@babylonjs/core/scene";
import "@babylonjs/loaders/glTF";
// Registers AbstractMesh.enableEdgesRendering for editor brush outlines.
import "@babylonjs/core/Rendering/edgesRenderer";
// Registers Scene.pick for perspective selection.
import "@babylonjs/core/Culling/ray";
import { pickResizeEdge, type ResizeEdge, resizeBox, resizeCursor } from "./EditorBoxTools";
import {
  type BoxBrush,
  EditorDocument,
  type EditorDocumentData,
  FACE_KEYS,
  type FaceKey,
  ownerOf,
  type PatchSurface,
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
  EDITOR_POINT_CLASSES,
  type EntityClassDef,
  entityClass,
  missingRequiredKeys,
} from "./EntityCatalog";
import { type FaceUpdate, renderFaceAlignment } from "./FaceAlignmentPanel";
import { faceKeyFromNormal, naturalFace } from "./FaceUv";
import { DEFAULT_POSE, FlyCameraController, type FlyPose, forwardOf, framePose, poseFromOrbit } from "./FlyCamera";
import { inspectMapHealth, type MapHealthIssue } from "./MapHealth";
import { MapHealthTray } from "./MapHealthTray";
import { writeMap } from "./MapWriter";
import { indexedModelPaths, modelReferenceIssue } from "./ModelReference";
import { flatPatch } from "./PatchGeometry";
import { archPatch, bevelPatch } from "./PatchPresets";
import { createPatchPreview, drawPatchLattice, patchBounds, patchLatticeHit } from "./PatchPreview";
import { browserPreviewDeps, PreviewTextures } from "./PreviewTextures";
import { createRoomTemplate } from "./RoomTemplate";
import { inspectServerMap, serverMapName } from "./ServerMapOpen";
import type { EditorCompileJob, EditorServerStatus, ShaggedApi } from "./ShaggedApi";
import { TextureBrowser } from "./TextureBrowser";
import type { TextureEntry } from "./TextureCatalog";
import { loadTextureCatalog } from "./TextureCatalogLoader";
import { shaderBatches } from "./TexturedPreview";
import type { TextureThumbnails } from "./TextureThumbnails";
import { createBrowserThumbnails } from "./TextureThumbnailsBrowser";
import "./editor.css";

type ViewMode = "brush" | "textured" | "wireframe";
const VIEW_MODES: ReadonlyArray<[ViewMode, string, string]> = [
  ["brush", "Brush", "Solid boxes, coloured by owner"],
  ["textured", "Textured", "Each face's image with its alignment"],
  ["wireframe", "Wireframe", "Brush edges only, to see through walls"],
];

type Gesture = {
  plane: Plane;
  mode: "draw" | "move" | "resize";
  drawKind?: "brush" | "patch";
  patchShape?: PatchShape;
  patchDepth?: number;
  patchReverse?: boolean;
  start: [number, number];
  current: [number, number];
  brush?: BoxBrush;
  entity?: PointEntity;
  edge?: ResizeEdge;
  workPlane: number;
  grid: number;
};

type Tool = "brush" | "patch" | "select" | "entity";
type PatchShape = NonNullable<EditorViewState["patchShape"]>;

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
  catalog: readonly EntityClassDef[] = EDITOR_POINT_CLASSES,
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
    if (def.classname === "misc_model" && field.name === "model") input.setAttribute("list", "shagged-model-paths");
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
  private readonly camera: FreeCamera;
  private pose: FlyPose = DEFAULT_POSE;
  private flyCamera!: FlyCameraController;
  private readonly engine: AbstractEngine;
  private readonly panes = new Map<Plane, HTMLCanvasElement>();
  private readonly meshes = new Map<string, Mesh>();
  private readonly modelPreviews = new Map<string, TransformNode>();
  private readonly modelPreviewRequests = new Map<string, string>();
  private readonly modelPreviewFailures = new Map<string, string>();
  private ghost: Mesh | null = null;
  private patchGhost: Mesh | null = null;
  private readonly listeners = new AbortController();
  private readonly draftStore = new EditorDraftStore(localStorage);
  private readonly statusEl: HTMLElement;
  private readonly inspector: HTMLElement;
  private selectedId: string | null = null;
  private patchPoint = 4;
  private patchShape: PatchShape = "flat";
  private patchDepth = 32;
  private patchReverse = false;
  private draftName = "Untitled";
  private tool: Tool = "brush";
  private entityClassname = "info_player_deathmatch";
  /** Texture new brushes get; size is null until one is picked from the browser (fixed legacy alignment). */
  private currentTexture: { name: string; size: [number, number] | null } = { name: "blx/blx_grid", size: null };
  private textureBrowser: TextureBrowser | null = null;
  private healthTray: MapHealthTray | null = null;
  /** Textured draws each face's image with its alignment; Brush colours boxes by owner; Wireframe shows edges only. */
  private viewMode: ViewMode = "textured";
  private previewLoading: Promise<void> | null = null;
  private previewTextures: PreviewTextures | null = null;
  private catalogEntries = new Map<string, TextureEntry>();
  private texturedMeshes: Mesh[] = [];
  private wireframe: Mesh | null = null;
  private thumbnails: TextureThumbnails | null = null;
  /** Faces of the selected brush picked with Ctrl+Shift+click or the face net; UI state only. */
  private readonly selectedFaces = new Set<FaceKey>();
  private faceOverlays: Mesh[] = [];
  private faceOverlayKey = "";
  private grid = 16;
  private zoom = 1;
  private viewCenter: Vec3q = { x: 0, y: 0, z: 0 };
  /** A middle or right drag in an orthographic pane; a right press that never moves is a deselect click. */
  private pan: { plane: Plane; button: number; x: number; y: number; center: Vec3q; travel: number } | null = null;
  private workPlanes: Vec3q = { x: 0, y: 0, z: 0 };
  private activePlane: Plane = "xy";
  private gesture: Gesture | null = null;
  /** A typed exact size overriding the mouse, for a single-edge resize; see keyDown and commitNumericResize. */
  private numericEntry: { buffer: string } | null = null;
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
    this.engine = engine;
    const restored = this.draftStore.load();
    this.document = restored.document;
    this.scene = new Scene(engine);
    this.scene.clearColor = new Color4(0.035, 0.045, 0.075, 1);
    // A flycam driven by FlyCameraController; Babylon's own camera inputs stay detached.
    this.camera = new FreeCamera("shagged-perspective", Vector3.Zero(), this.scene);
    this.camera.minZ = 1;
    this.camera.maxZ = 40_000;
    this.restoreView(restored.view);
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
        <strong>SHAGGED</strong>
        <div class="shagged__toolgroup" aria-label="Map actions">
          <span class="shagged__group-label">MAP</span>
          <details class="shagged__menu shagged__menu--map"><summary title="Current map and map actions"><span data-map-title></span></summary><div class="shagged__menu-panel">
            <label>Map name <input data-draft-name type="text" maxlength="64" aria-label="Map name"></label>
            <button data-action="new">New Map</button><button data-action="room">Room Template</button>
            <button data-action="drafts">Local Drafts</button>
            <span class="shagged__menu-rule" aria-hidden="true"></span>
            <button data-action="save" title="Ctrl/Cmd+S">Save Draft</button>
            <button data-action="export" title="Ctrl/Cmd+Shift+S">Export .map</button>
            <button data-action="server-maps" disabled title="Open a server-saved SHAGGED map">Server Maps</button>
            <button data-action="server-save" disabled title="Connecting to SHAGGED server">Server Save</button>
          </div></details>
        </div>
        <div class="shagged__toolgroup" aria-label="Edit actions">
          <span class="shagged__group-label">EDIT</span>
          <button data-action="undo" title="Ctrl/Cmd+Z">Undo</button><button data-action="redo" title="Ctrl/Cmd+Shift+Z">Redo</button>
          <details class="shagged__menu"><summary>More</summary><div class="shagged__menu-panel">
            <button data-action="duplicate" title="Ctrl/Cmd+D">Duplicate</button><button data-action="delete" title="Delete">Delete</button>
          </div></details>
        </div>
        <div class="shagged__toolgroup" aria-label="Placement tools">
          <span class="shagged__group-label">TOOLS</span>
          <button data-action="select" title="V">Select</button><button data-action="brush" title="B">Brush</button><button data-action="patch" title="P">Patch</button>
          <details class="shagged__menu shagged__menu--curves"><summary title="Curved patch surfaces">Curves</summary><div class="shagged__menu-panel">
            <button data-action="patch">Free Patch</button><button data-action="curve-bevel">Bevel</button>
            <button data-action="curve-inverted-bevel">Inverted Bevel</button><button data-action="curve-arch">Arch</button>
            <span class="shagged__menu-rule" aria-hidden="true"></span>
            <label>Depth <input data-patch-depth type="number" min="-4096" max="4096" step="1" value="32" title="Extrusion along the hidden work-plane axis"></label>
            <label>Reverse winding <input data-patch-reverse type="checkbox" title="Face the other side of the surface"></label>
          </div></details>
          <button data-action="entity" title="E">Entity</button><select data-entity-class aria-label="Entity class" title="Class placed by the Entity tool"></select>
          <button data-action="textures" title="Texture browser (T)">Textures</button><span class="shagged__current-texture" data-current-texture title="Texture new brushes get"></span>
          <button data-action="health" title="Map Health (H)">Health</button>
        </div>
        <div class="shagged__toolgroup" aria-label="View actions">
          <span class="shagged__group-label">VIEW</span>
          <details class="shagged__menu"><summary>View</summary><div class="shagged__menu-panel">
            <button data-action="frame-selection" title="F">Frame Selection</button><button data-action="frame-all" title="Shift+F">Frame All</button>
            <label>Grid <select data-grid title="[ / ] to step"><option>8</option><option selected>16</option><option>32</option><option>64</option></select></label>
            <label>Work <span data-work-axis>Z</span> <input data-workplane type="number" step="1" value="0"></label>
          </div></details>
        </div>
        <div class="shagged__toolgroup" aria-label="Build actions">
          <span class="shagged__group-label">BUILD</span>
          <button data-action="compile" disabled title="Connecting to SHAGGED server">Compile</button>
          <button data-action="compile-status" title="Check server and compile status">Status: offline</button>
          <button disabled title="A compiled, playable build is required">Playtest</button>
        </div>
        <button class="shagged__exit" data-action="exit">Exit</button>
      </header>
      <main class="shagged__workspace">
        <section class="shagged__pane shagged__pane--perspective"><span>3D PERSPECTIVE</span><div class="shagged__view-modes" role="group" aria-label="3D view mode">${VIEW_MODES.map(([mode, label, title]) => `<button type="button" data-view-mode="${mode}" title="${title}">${label}</button>`).join("")}</div><div class="shagged__free-look-hint" aria-hidden="true">Press ESC to release mouse</div></section>
        <section class="shagged__pane"><span>XY TOP</span><canvas data-plane="xy"></canvas></section>
        <section class="shagged__pane"><span>XZ FRONT</span><canvas data-plane="xz"></canvas></section>
        <section class="shagged__pane"><span>YZ SIDE</span><canvas data-plane="yz"></canvas></section>
      </main>
      <section class="shagged__drafts" aria-label="Saved drafts" hidden>
        <div class="shagged__drafts-head"><h2>Local drafts</h2><button data-action="close-drafts">Close</button></div>
        <div data-draft-list></div>
      </section>
      <section class="shagged__server-maps" aria-label="Server maps" hidden>
        <div class="shagged__drafts-head"><h2>Server maps</h2><button data-action="close-server-maps">Close</button></div>
        <div data-server-map-list></div>
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
    this.root.querySelector<HTMLInputElement>("[data-patch-depth]")!.value = String(this.patchDepth);
    this.root.querySelector<HTMLInputElement>("[data-patch-reverse]")!.checked = this.patchReverse;
    this.updateDraftNameControl();
    this.updateWorkPlaneControl();
    this.renderCurrentTexture();
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
      pane.addEventListener("contextmenu", (event) => event.preventDefault(), { signal: this.listeners.signal });
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
        if (button?.dataset.action) {
          const menu = button.closest<HTMLDetailsElement>("details.shagged__menu");
          if (menu) {
            menu.open = false;
            menu.querySelector("summary")?.focus();
          }
          this.action(button.dataset.action, button.dataset.draftId ?? button.dataset.mapName);
        }
      },
      { signal: this.listeners.signal },
    );
    this.root.addEventListener(
      "pointerdown",
      (event) => {
        if ((event.target as HTMLElement).closest(".shagged__menu")) return;
        for (const menu of this.root.querySelectorAll<HTMLDetailsElement>(".shagged__menu[open]")) menu.open = false;
      },
      { signal: this.listeners.signal },
    );
    for (const menu of this.root.querySelectorAll<HTMLDetailsElement>(".shagged__menu")) {
      menu.addEventListener(
        "toggle",
        () => {
          if (!menu.open) return;
          for (const other of this.root.querySelectorAll<HTMLDetailsElement>(".shagged__menu[open]")) {
            if (other !== menu) other.open = false;
          }
        },
        { signal: this.listeners.signal },
      );
    }
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
        this.updateDraftNameControl();
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
    this.root.querySelector<HTMLInputElement>("[data-patch-depth]")!.addEventListener(
      "change",
      (event) => {
        const input = event.target as HTMLInputElement;
        const value = Number(input.value);
        if (!Number.isFinite(value) || Math.abs(value) < 1 || Math.abs(value) > 4096) {
          this.status("Curve depth must be between -4096 and 4096, excluding zero");
          input.value = String(this.patchDepth);
          return;
        }
        this.patchDepth = value;
        this.trySaveView();
      },
      { signal: this.listeners.signal },
    );
    this.root.querySelector<HTMLInputElement>("[data-patch-reverse]")!.addEventListener(
      "change",
      (event) => {
        this.patchReverse = (event.target as HTMLInputElement).checked;
        this.trySaveView();
      },
      { signal: this.listeners.signal },
    );
    this.root.addEventListener("keydown", (event) => this.keyDown(event), { signal: this.listeners.signal });
    this.root.addEventListener("keyup", (event) => this.flyCamera.keyUp(event), { signal: this.listeners.signal });
    this.root.addEventListener(
      "click",
      (event) => {
        const mode = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-view-mode]")?.dataset.viewMode;
        if (mode) this.setViewMode(mode as ViewMode);
      },
      { signal: this.listeners.signal },
    );
    this.renderViewModes();
    if (this.viewMode === "textured") void this.ensurePreview();
    this.flyCamera = new FlyCameraController({
      element: this.canvas,
      isOver: (event) => this.inPerspective(event),
      getPose: () => this.pose,
      setPose: (pose) => this.setPose(pose),
      onRightClick: () => this.deselect(),
      onFreeLookChange: (active) => {
        this.root.querySelector(".shagged__pane--perspective")!.classList.toggle("shagged__pane--freelook", active);
      },
      signal: this.listeners.signal,
    });
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
    this.inspector.addEventListener(
      "click",
      (event) => {
        const face = (event.target as HTMLElement).closest<HTMLButtonElement>("button[data-face]")?.dataset.face;
        if (face && this.selectedId) this.toggleFace(this.selectedId, face as FaceKey);
      },
      { signal: this.listeners.signal },
    );
    this.inspector.addEventListener("submit", (event) => this.submitInspector(event), {
      signal: this.listeners.signal,
    });
    this.inspector.addEventListener(
      "change",
      (event) => {
        if ((event.target as HTMLElement).matches("[data-patch-point]")) this.loadPatchPointFields();
      },
      { signal: this.listeners.signal },
    );
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
    return (
      data.brushes.some((brush) => brush.id === id) ||
      data.entities.some((entity) => entity.id === id) ||
      (data.patches ?? []).some((patch) => patch.id === id)
    );
  }
  get revision(): number {
    return this.document.snapshot().revision;
  }
  render(): void {
    this.flyCamera.step(this.engine.getDeltaTime() / 1000);
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
      patchShape: this.patchShape,
      patchDepth: this.patchDepth,
      patchReverse: this.patchReverse,
      selectedId: this.selectedId,
      draftName: this.draftName,
      serverSave: this.serverSave,
      activePlane: this.activePlane,
      workPlanes: { ...this.workPlanes },
      viewCenter: { ...this.viewCenter },
      camera: { position: { ...this.pose.position }, yaw: this.pose.yaw, pitch: this.pose.pitch },
      viewMode: this.viewMode,
    };
  }
  private trySaveView(): void {
    try {
      this.save();
    } catch (error) {
      this.status(`View save failed: ${String(error)}`);
    }
  }
  private setViewMode(mode: ViewMode): void {
    this.viewMode = mode;
    this.renderViewModes();
    if (mode === "textured") void this.ensurePreview();
    this.rebuildMeshes();
    this.draw();
    this.trySaveView();
    this.status(`${VIEW_MODES.find(([item]) => item === mode)![1]} view`);
  }

  private renderViewModes(): void {
    for (const button of this.root.querySelectorAll<HTMLButtonElement>("[data-view-mode]")) {
      const active = button.dataset.viewMode === this.viewMode;
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", String(active));
    }
  }

  /**
   * Loads the catalog and preview materials once. Until they land, Textured
   * shows the brush colours, so opening the editor never waits on them.
   */
  private ensurePreview(): Promise<void> {
    this.previewLoading ??= (async () => {
      try {
        const [entries, deps] = await Promise.all([loadTextureCatalog(), browserPreviewDeps()]);
        if (this.listeners.signal.aborted) return;
        this.catalogEntries = new Map(entries.map((entry) => [entry.name.toLowerCase(), entry]));
        this.previewTextures = new PreviewTextures(this.scene, deps);
        if (this.viewMode === "textured") {
          this.rebuildMeshes();
          this.draw();
        }
      } catch (error) {
        this.previewLoading = null; // a later switch to Textured retries
        this.status(`Textured preview unavailable: ${error instanceof Error ? error.message : String(error)}`);
      }
    })();
    return this.previewLoading;
  }

  private get texturedReady(): boolean {
    return this.viewMode === "textured" && this.previewTextures !== null;
  }

  /** Wireframe mode: every brush's twelve edges as one line mesh, in the selection and owner colours. */
  private syncWireframe(data: EditorDocumentData, ownerColors: Map<string, EntityClassDef["color"]>): void {
    this.wireframe?.dispose();
    this.wireframe = null;
    if (this.viewMode !== "wireframe" || !data.brushes.length) return;
    const lines: Vector3[][] = [];
    const colors: Color4[][] = [];
    for (const brush of data.brushes) {
      const owned = ownerColors.get(brush.id);
      const [r, g, b] = brush.id === this.selectedId ? [1, 0.75, 0.2] : (owned ?? [0.1, 0.8, 0.9]);
      const color = new Color4(r, g, b, 1);
      const corner = (x: number, y: number, z: number) => new Vector3(x, z, y);
      const { min, max } = brush;
      const c = [
        corner(min.x, min.y, min.z),
        corner(max.x, min.y, min.z),
        corner(max.x, max.y, min.z),
        corner(min.x, max.y, min.z),
        corner(min.x, min.y, max.z),
        corner(max.x, min.y, max.z),
        corner(max.x, max.y, max.z),
        corner(min.x, max.y, max.z),
      ];
      for (const [a, z] of [
        [0, 1],
        [1, 2],
        [2, 3],
        [3, 0],
        [4, 5],
        [5, 6],
        [6, 7],
        [7, 4],
        [0, 4],
        [1, 5],
        [2, 6],
        [3, 7],
      ]) {
        lines.push([c[a], c[z]]);
        colors.push([color, color]);
      }
    }
    this.wireframe = MeshBuilder.CreateLineSystem("shagged-wireframe", { lines, colors }, this.scene);
    this.wireframe.isPickable = false;
  }

  /** One mesh per shader in Textured mode; the brush boxes stay as the pick, edge and selection layer. */
  private syncTexturedMeshes(data: EditorDocumentData): void {
    for (const mesh of this.texturedMeshes) mesh.dispose();
    this.texturedMeshes = [];
    const preview = this.previewTextures;
    if (this.viewMode !== "textured" || !preview) return;
    for (const batch of shaderBatches(data.brushes)) {
      const mesh = new Mesh(`shagged-textured-${batch.shader}`, this.scene);
      const vertexData = new VertexData();
      vertexData.positions = batch.positions;
      vertexData.normals = batch.normals;
      vertexData.uvs = batch.uvs;
      vertexData.indices = batch.indices;
      vertexData.applyToMesh(mesh);
      mesh.isPickable = false;
      mesh.material = preview.material(batch.shader, this.catalogEntries.get(batch.shader.toLowerCase()));
      this.texturedMeshes.push(mesh);
    }
  }

  /**
   * One alignment change on every selected face, as one undo step. A face on
   * the brush's fixed alignment has no image size to align against, so the
   * panel locks for it; the check here covers a stale panel.
   */
  private alignFaces(describe: string, update: FaceUpdate): void {
    const brushId = this.selectedId;
    const keys = [...this.selectedFaces];
    if (!brushId || !keys.length) return;
    try {
      this.document.transact((data) => {
        const brush = data.brushes.find((item) => item.id === brushId);
        if (!brush) throw new Error("Selected brush no longer exists");
        const fixed = keys.filter((key) => !brush.faces?.[key]);
        if (fixed.length) throw new Error(`pick a texture (T) for face ${fixed.join(", ")} first`);
        const faces = brush.faces!;
        // every update reads the faces as they were, so a wrap's source isn't changed under it
        const next = keys.map((key) => update(faces[key]!, key, brush));
        keys.forEach((key, index) => {
          faces[key] = next[index];
        });
      });
      this.changed();
      this.status(`${describe} on ${keys.length} face${keys.length === 1 ? "" : "s"}`);
    } catch (error) {
      this.status(`Alignment rejected: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /** Pure analysis over the live document; texture checks are skipped until Textured mode has loaded the catalog. */
  private healthIssues(): MapHealthIssue[] {
    const textures = this.catalogEntries.size ? [...this.catalogEntries.values()] : undefined;
    return inspectMapHealth(this.document.snapshot(), textures);
  }

  /** The tray is built on first use. Opening it also starts loading the catalog, for the shader checks, if idle. */
  private toggleHealth(): void {
    if (!this.healthTray) {
      this.healthTray = new MapHealthTray({
        issues: () => this.healthIssues(),
        onSelect: (objectId, face) => this.selectHealthIssue(objectId, face),
        onClose: () => this.root.focus(),
      });
      this.root.appendChild(this.healthTray.element);
    }
    this.healthTray.toggle();
    if (this.healthTray.isOpen) void this.ensurePreview().then(() => this.healthTray?.refresh());
  }

  /**
   * Selects whatever a health issue points to, so Frame then centers it: a
   * point entity, brush or patch by its own ID, or a brush-entity issue's
   * first owned brush (brush entities have no box of their own to select).
   */
  private selectHealthIssue(objectId: string, face?: MapHealthIssue["face"]): void {
    const data = this.document.snapshot();
    const isBrush = data.brushes.some((brush) => brush.id === objectId);
    const isEntity = data.entities.some((entity) => entity.id === objectId);
    const isPatch = (data.patches ?? []).some((patch) => patch.id === objectId);
    const id =
      isBrush || isEntity || isPatch
        ? objectId
        : (data.brushEntities?.find((entity) => entity.id === objectId)?.brushIds[0] ?? null);
    if (!id) {
      this.status("That object is no longer in the map");
      return;
    }
    this.selectedId = id;
    this.selectedFaces.clear();
    if (face && isBrush) this.selectedFaces.add(face);
    this.rebuildMeshes();
    this.action("frame-selection");
  }

  /** The drawer is built on first use, so opening the editor never loads the texture catalog. */
  private async toggleTextures(): Promise<void> {
    if (!this.textureBrowser) {
      this.thumbnails = createBrowserThumbnails();
      this.textureBrowser = new TextureBrowser({
        catalog: loadTextureCatalog,
        thumbnails: this.thumbnails,
        inMap: () => this.texturesInMap(),
        onApply: (entry, size) => this.applyTexture(entry, size),
        onClose: () => this.root.focus(),
      });
      this.root.appendChild(this.textureBrowser.element);
    }
    await this.textureBrowser.toggle();
  }

  private texturesInMap(): string[] {
    return this.document
      .snapshot()
      .brushes.flatMap((brush) => [brush.shader, ...Object.values(brush.faces ?? {}).map((face) => face.shader)]);
  }

  /** shader plus, when the image size is known, natural alignment on all six faces. */
  private currentMaterial(): Pick<BoxBrush, "shader" | "faces"> {
    const { name, size } = this.currentTexture;
    if (!size) return { shader: name };
    return { shader: name, faces: Object.fromEntries(FACE_KEYS.map((key) => [key, naturalFace(name, size)])) };
  }

  /**
   * A picked texture becomes the current texture, and covers the selected
   * brush's six faces as one undo step. Without a known image size the brush
   * keeps the fixed legacy alignment, and the status says so.
   */
  private applyTexture(entry: TextureEntry, size: [number, number] | null): void {
    this.currentTexture = { name: entry.name, size };
    this.renderCurrentTexture();
    const brushId = this.document.snapshot().brushes.some((brush) => brush.id === this.selectedId)
      ? this.selectedId
      : null;
    const sized = size ? `${size[0]}×${size[1]}` : "size unknown, fixed alignment";
    if (!brushId) {
      this.status(`Current texture ${entry.name} (${sized}); select a brush to apply it`);
      return;
    }
    if (this.selectedFaces.size) {
      this.applyToFaces(brushId, entry, size);
      return;
    }
    try {
      this.document.transact((data) => {
        const brush = data.brushes.find((item) => item.id === brushId)!;
        const material = this.currentMaterial();
        brush.shader = material.shader;
        if (material.faces) brush.faces = material.faces;
        else delete brush.faces;
      });
      this.changed();
      this.status(`Applied ${entry.name} (${sized})`);
    } catch (error) {
      this.status(`Texture rejected: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Texture on just the selected faces, as one undo step. A face that already
   * has an alignment keeps it (only the texture changes, as in Radiant); a new
   * face override starts at natural alignment, which needs the image size.
   */
  private applyToFaces(brushId: string, entry: TextureEntry, size: [number, number] | null): void {
    if (!size) {
      this.status(`${entry.name} has no known image size; a face texture needs one`);
      return;
    }
    const keys = [...this.selectedFaces];
    try {
      this.document.transact((data) => {
        const brush = data.brushes.find((item) => item.id === brushId)!;
        brush.faces ??= {};
        for (const key of keys) {
          const existing = brush.faces[key];
          brush.faces[key] = existing ? { ...existing, shader: entry.name, size } : naturalFace(entry.name, size);
        }
      });
      this.changed();
      this.status(
        `Applied ${entry.name} (${size[0]}×${size[1]}) to ${keys.length} face${keys.length === 1 ? "" : "s"}`,
      );
    } catch (error) {
      this.status(`Texture rejected: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /** Ctrl+Shift+click or the face net: a face of the selected brush joins or leaves the face selection. */
  private toggleFace(brushId: string, key: FaceKey): void {
    if (this.selectedId !== brushId) {
      this.selectedFaces.clear();
      this.selectedId = brushId;
    }
    if (this.selectedFaces.has(key)) this.selectedFaces.delete(key);
    else this.selectedFaces.add(key);
    this.rebuildMeshes();
    this.draw();
    this.trySaveView();
    // After the save, whose own status message would otherwise replace this one.
    const faces = [...this.selectedFaces].join(", ");
    this.status(faces ? `Faces ${faces} selected; pick a texture (T) to apply it to them` : "No faces selected");
  }

  /** Alt+click: a face's texture becomes the current texture (eyedropper). */
  private sampleFace(brush: BoxBrush, key: FaceKey): void {
    const face = brush.faces?.[key];
    this.currentTexture = face ? { name: face.shader, size: face.size } : { name: brush.shader, size: null };
    this.renderCurrentTexture();
    this.status(`Sampled ${this.currentTexture.name} from face ${key}`);
  }

  /** Orange slabs on the selected faces in 3D, rebuilt only when the selection, the document or the view mode changes. */
  private syncFaceOverlays(data: EditorDocumentData): void {
    const key = `${this.selectedId ?? ""}|${[...this.selectedFaces].sort().join(",")}|${data.revision}|${this.viewMode}`;
    if (key === this.faceOverlayKey) return;
    this.faceOverlayKey = key;
    for (const mesh of this.faceOverlays) {
      mesh.material?.dispose();
      mesh.dispose();
    }
    this.faceOverlays = [];
    const brush = data.brushes.find((item) => item.id === this.selectedId);
    if (!brush) return;
    for (const face of this.selectedFaces) {
      const axis = face[1].toLowerCase() as keyof Vec3q;
      const outward = face[0] === "+";
      const min = { ...brush.min };
      const max = { ...brush.max };
      const plane = outward ? brush.max[axis] : brush.min[axis];
      min[axis] = outward ? plane : plane - 0.75;
      max[axis] = outward ? plane + 0.75 : plane;
      const mesh = MeshBuilder.CreateBox(
        `shagged-face-${face}`,
        { width: max.x - min.x, height: max.z - min.z, depth: max.y - min.y },
        this.scene,
      );
      mesh.position = new Vector3((min.x + max.x) / 2, (min.z + max.z) / 2, (min.y + max.y) / 2);
      mesh.isPickable = false;
      const material = new StandardMaterial(`shagged-face-material-${face}`, this.scene);
      material.diffuseColor = new Color3(1, 0.55, 0.05);
      // light enough in Textured mode to see the alignment being edited
      const light = this.viewMode !== "brush";
      material.emissiveColor = light ? new Color3(0.25, 0.12, 0) : new Color3(0.7, 0.35, 0);
      material.alpha = light ? 0.18 : 0.6;
      mesh.material = material;
      this.faceOverlays.push(mesh);
    }
  }

  /** The selected brush's six faces as a net: click one to add it to or remove it from the face selection. */
  private renderFaceNet(net: HTMLElement, brush: BoxBrush): void {
    const layout: Array<[FaceKey, number, number]> = [
      ["+Z", 2, 1],
      ["-X", 1, 2],
      ["-Y", 2, 2],
      ["+X", 3, 2],
      ["+Y", 4, 2],
      ["-Z", 2, 3],
    ];
    for (const [key, column, row] of layout) {
      const face = brush.faces?.[key];
      const shader = face?.shader ?? brush.shader;
      const button = document.createElement("button");
      button.type = "button";
      button.dataset.face = key;
      button.style.gridColumn = String(column);
      button.style.gridRow = String(row);
      button.classList.toggle("active", this.selectedFaces.has(key));
      const label = document.createElement("b");
      label.textContent = key;
      const name = document.createElement("span");
      name.textContent = shader.split("/").pop() ?? shader;
      button.append(label, name);
      button.title = face ? `${shader} · ${face.size[0]}×${face.size[1]}` : `${shader} · fixed alignment`;
      net.appendChild(button);
    }
  }

  private renderCurrentTexture(): void {
    const label = this.root.querySelector<HTMLElement>("[data-current-texture]");
    if (label) label.textContent = this.currentTexture.name;
  }

  showError(message: string): void {
    this.status(message);
  }
  dispose(): void {
    this.textureBrowser?.dispose();
    this.healthTray?.dispose();
    this.previewTextures?.dispose();
    this.thumbnails?.dispose();
    this.modelPreviewRequests.clear();
    this.serverGeneration++;
    if (this.pollTimer) clearTimeout(this.pollTimer);
    this.listeners.abort();
    if (this.viewSaveTimer) clearTimeout(this.viewSaveTimer);
    this.disposeGhost();
    this.disposePatchGhost();
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
    const maps = this.root.querySelector<HTMLButtonElement>('[data-action="server-maps"]')!;
    const save = this.root.querySelector<HTMLButtonElement>('[data-action="server-save"]')!;
    const compile = this.root.querySelector<HTMLButtonElement>('[data-action="compile"]')!;
    const status = this.root.querySelector<HTMLButtonElement>('[data-action="compile-status"]')!;
    maps.disabled = !this.serverStatus?.saveAvailable || this.serverBusy;
    save.disabled = !this.serverStatus?.saveAvailable || this.serverBusy;
    compile.disabled = !this.serverStatus?.compilerAvailable || this.serverBusy;
    maps.title = this.serverStatus?.saveAvailable ? "Open a server-saved SHAGGED map" : "Start npm run shagged:server";
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
    const name = serverMapName(data.draftId);
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
      const name = serverMapName(this.draftId);
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

  private updateDraftNameControl(): void {
    this.root.querySelector<HTMLInputElement>("[data-draft-name]")!.value = this.draftName;
    const title = this.root.querySelector<HTMLElement>("[data-map-title]")!;
    title.textContent = this.draftName;
    title.parentElement!.title = `Current map: ${this.draftName}. Open map actions`;
  }

  private updateWorkPlaneControl(): void {
    const hidden = AXES[this.activePlane].hidden;
    this.root.querySelector("[data-work-axis]")!.textContent = hidden.toUpperCase();
    this.root.querySelector<HTMLInputElement>("[data-workplane]")!.value = String(this.workPlanes[hidden]);
  }

  private updatePatchControls(): void {
    this.root.querySelector<HTMLInputElement>("[data-patch-depth]")!.value = String(this.patchDepth);
    this.root.querySelector<HTMLInputElement>("[data-patch-reverse]")!.checked = this.patchReverse;
  }

  private restoreView(view: EditorViewState | null): void {
    this.grid = view?.grid ?? 16;
    this.zoom = view?.zoom ?? 1;
    this.viewCenter = { ...(view?.viewCenter ?? { x: 0, y: 0, z: 0 }) };
    this.tool = view?.tool ?? "brush";
    this.patchShape = view?.patchShape ?? "flat";
    this.patchDepth = view?.patchDepth ?? 32;
    this.patchReverse = view?.patchReverse ?? false;
    this.draftName = view?.draftName ?? "Untitled";
    this.serverSave = view?.serverSave;
    this.workPlanes = { ...(view?.workPlanes ?? { x: 0, y: 0, z: 0 }) };
    this.activePlane = view?.activePlane ?? "xy";
    this.selectedId = this.exists(view?.selectedId) ? (view?.selectedId ?? null) : null;
    this.viewMode = view?.viewMode ?? "textured";
    const camera = view?.camera;
    this.setPose(
      !camera
        ? DEFAULT_POSE
        : "position" in camera
          ? { position: { ...camera.position }, yaw: camera.yaw, pitch: camera.pitch }
          : poseFromOrbit(camera.alpha, camera.beta, camera.radius, camera.target),
    );
  }

  /** The flycam pose onto the Babylon camera: Quake Z-up becomes Babylon Y-up. */
  private setPose(pose: FlyPose): void {
    this.pose = pose;
    const { x, y, z } = pose.position;
    const f = forwardOf(pose);
    this.camera.position = new Vector3(x, z, y);
    this.camera.setTarget(new Vector3(x + f.x, z + f.z, y + f.y));
  }

  /** Right click, a plain click on nothing, or Escape with nothing else open: drop the selection. */
  private deselect(): void {
    if (!this.selectedId && !this.selectedFaces.size) return;
    this.selectedFaces.clear();
    this.selectedId = null;
    this.rebuildMeshes();
    this.draw();
    this.trySaveView();
    this.status("Selection cleared");
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
    this.updatePatchControls();
    this.updateDraftNameControl();
    this.updateWorkPlaneControl();
    this.rebuildMeshes();
    this.draw();
    this.root.querySelector<HTMLElement>(".shagged__drafts")!.hidden = true;
    this.root.focus();
  }

  private async showServerMaps(): Promise<void> {
    if (this.serverBusy || !this.api) return;
    this.serverBusy = true;
    this.updateServerButtons();
    const generation = this.serverGeneration;
    const panel = this.root.querySelector<HTMLElement>(".shagged__server-maps")!;
    const list = this.root.querySelector<HTMLElement>("[data-server-map-list]")!;
    list.textContent = "Loading server maps...";
    panel.hidden = false;
    try {
      const maps = await this.api.maps();
      if (generation !== this.serverGeneration) return;
      list.replaceChildren();
      for (const map of maps) {
        const button = document.createElement("button");
        button.type = "button";
        button.dataset.action = "open-server-map";
        button.dataset.mapName = map.name;
        button.textContent = `${map.name} · server r${map.revision}`;
        list.appendChild(button);
      }
      if (!maps.length) list.textContent = "No saved maps on this server.";
    } finally {
      this.serverBusy = false;
      this.updateServerButtons();
    }
  }

  private async openServerMap(name: string, asCopy = false): Promise<void> {
    if (this.serverBusy || !this.api) return;
    this.serverBusy = true;
    this.updateServerButtons();
    const generation = this.serverGeneration;
    try {
      this.save();
      const map = await this.api.map(name);
      if (generation !== this.serverGeneration) return;
      const local = this.draftStore.get(map.sidecar?.draftId ?? "");
      const decision = inspectServerMap(map, local?.document.snapshot());
      const list = this.root.querySelector<HTMLElement>("[data-server-map-list]")!;
      list.querySelector("[data-server-conflict]")?.remove();
      if (decision.kind === "local-conflict" && !asCopy) {
        const notice = document.createElement("div");
        notice.dataset.serverConflict = "";
        const message = document.createElement("p");
        message.textContent = `${name} has a different local draft. The local version was kept. Open the server version as a separate copy?`;
        const button = document.createElement("button");
        button.type = "button";
        button.dataset.action = "server-copy";
        button.dataset.mapName = name;
        button.textContent = "Open server as copy";
        notice.append(message, button);
        list.prepend(notice);
        this.status("Server map differs from local draft; local work was kept");
        return;
      }
      if (decision.kind === "already-local" && !asCopy) {
        if (this.draftId !== decision.document.snapshot().draftId) this.openDraft(decision.document.snapshot().draftId);
        this.serverSave = { revision: decision.revision, documentRevision: this.revision };
        this.save();
      } else {
        const data = decision.document.snapshot();
        if (asCopy) {
          data.draftId = crypto.randomUUID();
          data.revision = 0;
        }
        this.resetCompileJob();
        this.cancelGesture();
        this.document = new EditorDocument(data);
        this.restoreView(null);
        this.serverSave = asCopy ? undefined : { revision: decision.revision, documentRevision: data.revision };
        this.draftName = asCopy ? `${name} copy` : name;
        this.updateDraftNameControl();
        this.root.querySelector<HTMLSelectElement>("[data-grid]")!.value = String(this.grid);
        this.updatePatchControls();
        this.updateWorkPlaneControl();
        this.rebuildMeshes();
        this.draw();
        this.save();
      }
      this.root.querySelector<HTMLElement>(".shagged__server-maps")!.hidden = true;
      this.status(
        asCopy
          ? `Opened ${name} as a separate local draft`
          : `Opened ${name}.map at server revision ${decision.revision}`,
      );
      this.root.focus();
    } finally {
      this.serverBusy = false;
      this.updateServerButtons();
    }
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
          this.updateDraftNameControl();
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
          this.updateDraftNameControl();
          this.changed();
          break;
        case "drafts":
          this.showDrafts();
          break;
        case "server-maps":
          void this.showServerMaps().catch((error: unknown) => this.serverError(error));
          break;
        case "close-server-maps":
          this.root.querySelector<HTMLElement>(".shagged__server-maps")!.hidden = true;
          this.root.focus();
          break;
        case "open-server-map":
        case "server-copy":
          if (draftId)
            void this.openServerMap(draftId, action === "server-copy").catch((error: unknown) =>
              this.serverError(error),
            );
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
        case "textures":
          void this.toggleTextures();
          break;
        case "health":
          this.toggleHealth();
          break;
        case "brush":
        case "select":
        case "entity":
          this.cancelGesture();
          this.tool = action;
          this.draw();
          this.trySaveView();
          break;
        case "patch":
        case "curve-bevel":
        case "curve-inverted-bevel":
        case "curve-arch":
          this.cancelGesture();
          this.tool = "patch";
          this.patchShape = action === "patch" ? "flat" : (action.slice("curve-".length) as PatchShape);
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
              data.patches = (data.patches ?? []).filter((patch) => patch.id !== id);
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
    const patch = (data.patches ?? []).find((item) => item.id === this.selectedId);
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
    } else if (patch) {
      const copy = structuredClone(patch);
      copy.id = id;
      for (const row of copy.controlPoints) for (const control of row) control.x += this.grid;
      this.document.transact((draft) => {
        draft.patches ??= [];
        draft.patches.push(copy);
      });
    } else return;
    this.selectedId = id;
    this.changed();
  }

  private keyDown(event: KeyboardEvent): void {
    const key = event.key.toLowerCase();
    const menu =
      event.target instanceof HTMLElement ? event.target.closest<HTMLDetailsElement>(".shagged__menu") : null;
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement) {
      if (key === "escape" && menu) menu.open = false;
      return;
    }
    if (menu && key !== "escape") return;
    if (this.numericEntryKey(event)) return;
    if (this.flyCamera.keyDown(event)) return;
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
    else if (key === "p") this.action("patch");
    else if (key === "v") this.action("select");
    else if (key === "e") this.action("entity");
    else if (key === "t") {
      // the drawer focuses its search box during this keydown; without this the "t" is typed into it
      event.preventDefault();
      this.action("textures");
    } else if (key === "delete") this.action("delete");
    else if (key === "h") this.action("health");
    else if (key === "f") {
      event.preventDefault();
      event.stopPropagation();
      this.action(event.shiftKey ? "frame-all" : "frame-selection");
    } else if (key === "[" || key === "]") {
      this.stepGrid(key === "[" ? -1 : 1);
    } else if (key === "escape") {
      // Cancel an in-progress drag first; then close the focused menu or popover.
      event.preventDefault();
      if (this.gesture) {
        this.cancelGesture();
        return;
      }
      if (menu?.open) {
        menu.open = false;
        menu.querySelector("summary")?.focus();
        return;
      }
      const drafts = this.root.querySelector<HTMLElement>(".shagged__drafts");
      if (drafts && !drafts.hidden) {
        drafts.hidden = true;
        this.root.focus();
        return;
      }
      this.deselect();
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
      ...(data.patches ?? []).map((patch) => ({ id: patch.id, ...patchBounds(patch) })),
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
    const rect = this.root.querySelector<HTMLElement>(".shagged__pane--perspective")!.getBoundingClientRect();
    const aspect = rect.width / Math.max(1, rect.height);
    const halfFov = Math.min(this.camera.fov / 2, Math.atan(Math.tan(this.camera.fov / 2) * Math.max(0.1, aspect)));
    this.setPose(framePose(this.pose, bounds.center, bounds.size, halfFov));
    this.draw();
    this.trySaveView();
  }

  private exportMap(): void {
    let source: string;
    try {
      source = writeMap(this.document.snapshot());
    } catch (error) {
      this.status(`Export rejected: ${error instanceof Error ? error.message : String(error)}`);
      return;
    }
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
      (mesh) => this.meshes.has(mesh.name) || typeof mesh.metadata?.editorEntityId === "string",
      false,
      this.camera,
    );
    this.root.focus();
    const hitId: string | null = pick?.hit
      ? (pick.pickedMesh?.metadata?.editorEntityId ?? pick.pickedMesh?.name ?? null)
      : null;
    const brush = hitId ? this.document.snapshot().brushes.find((item) => item.id === hitId) : undefined;
    const normal = brush && (event.altKey || (event.ctrlKey && event.shiftKey)) ? pick?.getNormal(true, true) : null;
    if (brush && normal) {
      // Babylon is Y-up; the document is Quake Z-up.
      const key = faceKeyFromNormal({ x: normal.x, y: normal.z, z: normal.y });
      if (event.altKey) this.sampleFace(brush, key);
      else this.toggleFace(brush.id, key);
      return;
    }
    this.selectedFaces.clear();
    this.selectedId = hitId;
    this.rebuildMeshes();
    this.draw();
    this.trySaveView();
  }

  private pointerDown(plane: Plane, event: PointerEvent): void {
    if (event.button > 2) return;
    if (this.gesture || this.pan) return;
    event.preventDefault();
    this.root.focus();
    this.activePlane = plane;
    this.updateWorkPlaneControl();
    const pane = this.panes.get(plane)!;
    pane.setPointerCapture(event.pointerId);
    if (event.button !== 0) {
      this.pan = {
        plane,
        button: event.button,
        x: event.clientX,
        y: event.clientY,
        center: { ...this.viewCenter },
        travel: 0,
      };
      pane.style.cursor = "grabbing";
      return;
    }
    const start = this.coordinates(plane, pane, event);
    const [u, v] = this.worldAt(plane, pane, event);
    const axes = AXES[plane];
    if (this.tool === "entity") {
      this.placeEntity(plane, start);
      return;
    }
    const { entityHit, hit, patchHit, onSelection, edge } = this.pressTarget(plane, u, v);
    if (this.tool === "select" || (this.tool === "brush" && onSelection) || patchHit) {
      if (!onSelection) this.selectedFaces.clear();
      this.selectedId = entityHit?.id ?? patchHit?.id ?? hit?.id ?? null;
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
      if (this.gesture?.mode === "move") pane.style.cursor = "grabbing";
      this.rebuildMeshes();
      this.trySaveView();
    } else
      this.gesture = {
        plane,
        mode: "draw",
        drawKind: this.tool === "patch" ? "patch" : "brush",
        patchShape: this.patchShape,
        patchDepth: this.patchDepth,
        patchReverse: this.patchReverse,
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
    const entity: PointEntity = {
      id: crypto.randomUUID(),
      classname: def.classname,
      origin,
      keys: def.classname === "misc_model" ? { model: "", modelscale: "1" } : {},
    };
    this.document.transact((data) => data.entities.push(entity));
    this.selectedId = entity.id;
    this.changed();
  }

  private pointerMove(plane: Plane, event: PointerEvent): void {
    if (this.pan?.plane === plane) {
      this.pan.travel = Math.max(this.pan.travel, Math.hypot(event.clientX - this.pan.x, event.clientY - this.pan.y));
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
      this.updateCursor(plane, event);
      this.renderStatus();
      return;
    }
    this.hoverPlane = null;
    this.hoverCoord = null;
    this.gesture.current = this.coordinates(plane, this.panes.get(plane)!, event, this.gesture.grid);
    this.draw();
  }

  private pointerUp(plane: Plane, event: PointerEvent): void {
    if (this.pan?.plane === plane && event.button === this.pan.button) {
      this.pointerMove(plane, event);
      const click = this.pan.button === 2 && this.pan.travel <= 4;
      this.pan = null;
      this.updateCursor(plane, event);
      if (click) this.deselect();
      else this.trySaveView();
      return;
    }
    if (event.button !== 0) return;
    const gesture = this.gesture;
    if (!gesture || gesture.plane !== plane) return;
    gesture.current = this.coordinates(plane, this.panes.get(plane)!, event, gesture.grid);
    this.gesture = null;
    // after the edit below lands, the cursor shows what is under it now
    queueMicrotask(() => this.updateCursor(plane, event));
    const [u0, v0] = gesture.start;
    const [u1, v1] = gesture.current;
    if (u0 === u1 && v0 === v1) {
      // A Brush-tool click that drew nothing selects what is under it, or clears the selection.
      if (gesture.mode === "draw") this.clickSelect(plane, event);
      else this.draw();
      return;
    }
    const axes = AXES[plane];
    if (gesture.mode === "draw") {
      if (gesture.drawKind === "patch") {
        const patch = this.patchFromGesture(crypto.randomUUID(), gesture);
        if (!patch) {
          this.status("Draw a nonzero curve footprint and depth inside map bounds");
          return;
        }
        this.document.transact((data) => {
          data.patches ??= [];
          data.patches.push(patch);
        });
        this.selectedId = patch.id;
        this.changed();
        return;
      }
      const bounds = drawBounds(axes, gesture.start, gesture.current, gesture.workPlane, gesture.grid);
      if (!bounds) {
        this.status("Drag at least one grid cell in both axes");
        this.draw();
        return;
      }
      const brush: BoxBrush = { id: crypto.randomUUID(), ...bounds, ...this.currentMaterial() };
      this.document.transact((data) => {
        data.brushes.push(brush);
      });
      this.selectedId = brush.id;
    } else if (gesture.mode === "resize" && gesture.brush && gesture.edge) {
      const edge = gesture.edge;
      const candidate = resizeBox(gesture.brush, edge, { [axes.u]: u1, [axes.v]: v1 }, this.grid);
      if (
        edge.faces.every(
          ({ axis }) =>
            candidate.min[axis] === gesture.brush?.min[axis] && candidate.max[axis] === gesture.brush?.max[axis],
        )
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

  /**
   * What a left press at (u, v) would take hold of. Entities are small and
   * drawn on top of brushes, so they win a shared point. The Select tool
   * grabs whatever is there; the Brush tool grabs only the selection (a drag
   * elsewhere draws), as in Radiant.
   */
  private pressTarget(
    plane: Plane,
    u: number,
    v: number,
  ): {
    entityHit?: PointEntity;
    hit?: BoxBrush;
    patchHit?: PatchSurface;
    onSelection: boolean;
    grabs: boolean;
    edge: ResizeEdge | null;
  } {
    const data = this.document.snapshot();
    const axes = AXES[plane];
    const entityHit = [...data.entities].reverse().find((entity) => inRect(u, v, entityBox(entity), plane));
    const patchHit = entityHit
      ? undefined
      : [...(data.patches ?? [])].reverse().find((patch) => patchLatticeHit(patch, plane, u, v, 8 / this.zoom));
    const hit =
      entityHit || patchHit ? undefined : [...data.brushes].reverse().find((brush) => inRect(u, v, brush, plane));
    const target = entityHit ?? patchHit ?? hit;
    const onSelection = target !== undefined && target.id === this.selectedId;
    const grabs =
      !patchHit && target !== undefined && (this.tool === "select" || (this.tool === "brush" && onSelection));
    const edge = grabs && hit ? pickResizeEdge(hit, axes.u, axes.v, u, v, 8 / this.zoom) : null;
    return { entityHit, hit, patchHit, onSelection, grabs, edge };
  }

  /** The hover cursor says what a press would do: resize along an edge, move (hand), or the tool's crosshair. */
  private updateCursor(plane: Plane, event: PointerEvent): void {
    const pane = this.panes.get(plane);
    if (!pane || this.gesture || this.pan) return;
    if (this.tool === "entity") {
      pane.style.cursor = "";
      return;
    }
    const [u, v] = this.worldAt(plane, pane, event);
    const { grabs, edge } = this.pressTarget(plane, u, v);
    pane.style.cursor = edge ? resizeCursor(edge, AXES[plane].u) : grabs ? "grab" : "";
  }

  private clickSelect(plane: Plane, event: PointerEvent): void {
    const [u, v] = this.worldAt(plane, this.panes.get(plane)!, event);
    const data = this.document.snapshot();
    const entityHit = [...data.entities].reverse().find((entity) => inRect(u, v, entityBox(entity), plane));
    const patchHit = entityHit
      ? undefined
      : [...(data.patches ?? [])].reverse().find((patch) => patchLatticeHit(patch, plane, u, v, 8 / this.zoom));
    const hit = entityHit ?? patchHit ?? [...data.brushes].reverse().find((brush) => inRect(u, v, brush, plane));
    if (!hit) {
      this.deselect();
      this.draw();
      return;
    }
    if (hit.id !== this.selectedId) this.selectedFaces.clear();
    this.selectedId = hit.id;
    this.rebuildMeshes();
    this.draw();
    this.trySaveView();
  }

  private cancelGesture(): void {
    this.gesture = null;
    this.numericEntry = null;
    for (const pane of this.panes.values()) pane.style.cursor = "";
    if (this.pan) this.viewCenter = this.pan.center;
    this.pan = null;
    this.draw();
  }

  /**
   * While resizing a single edge, digits/period type an exact size, Backspace
   * edits it, Enter commits it in place of wherever the mouse is (ending the
   * gesture as pointerUp would), and Escape clears the typed buffer without
   * cancelling the drag. Returns whether the key was consumed.
   */
  private numericEntryKey(event: KeyboardEvent): boolean {
    const gesture = this.gesture;
    const singleEdge = gesture?.mode === "resize" && gesture.brush && gesture.edge?.faces.length === 1;
    if (!singleEdge) {
      if (this.numericEntry) this.numericEntry = null;
      return false;
    }
    if (/^[0-9.]$/.test(event.key)) {
      event.preventDefault();
      this.numericEntry = { buffer: (this.numericEntry?.buffer ?? "") + event.key };
      this.draw();
      return true;
    }
    if (event.key === "Backspace" && this.numericEntry) {
      event.preventDefault();
      const buffer = this.numericEntry.buffer.slice(0, -1);
      this.numericEntry = buffer ? { buffer } : null;
      this.draw();
      return true;
    }
    if (event.key === "Escape" && this.numericEntry) {
      event.preventDefault();
      event.stopPropagation(); // keep the resize itself alive; don't let the outer Escape cancel it too
      this.numericEntry = null;
      this.draw();
      return true;
    }
    if (event.key === "Enter" && this.numericEntry?.buffer) {
      event.preventDefault();
      this.commitNumericResize(gesture, Number(this.numericEntry.buffer));
      this.numericEntry = null;
      return true;
    }
    return false;
  }

  /** Resizes the dragged edge to exactly `size`, keeping the opposite face anchored, as pointerUp would commit it. */
  private commitNumericResize(gesture: Gesture, size: number): void {
    const brush = gesture.brush;
    const face = gesture.edge?.faces[0];
    if (!brush || !face || !Number.isFinite(size) || size <= 0) {
      this.status("Enter a positive size");
      return;
    }
    const value = face.side === "min" ? brush.max[face.axis] - size : brush.min[face.axis] + size;
    const candidate = resizeBox(brush, gesture.edge!, { [face.axis]: value }, this.grid);
    this.gesture = null;
    this.document.transact((data) => {
      const index = data.brushes.findIndex((item) => item.id === brush.id);
      data.brushes[index] = candidate;
    });
    this.changed();
    this.status(`Set ${face.axis.toUpperCase()} to exactly ${size}`);
  }

  private changed(): void {
    if (this.selectedId && !this.exists(this.selectedId)) this.selectedId = null;
    if (!this.selectedId) this.selectedFaces.clear();
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
    if (form.matches("[data-patch-form]") && this.selectedId) {
      this.submitPatch(form, this.selectedId);
      return;
    }
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

  private submitPatch(form: HTMLFormElement, id: string): void {
    const values = new FormData(form);
    const index = Number(values.get("point"));
    try {
      this.document.transact((data) => {
        const patch = data.patches?.find((item) => item.id === id);
        if (!patch || !Number.isSafeInteger(index) || index < 0 || index >= patch.width * patch.height) {
          throw new Error("Selected patch control no longer exists");
        }
        const control = patch.controlPoints[Math.floor(index / patch.width)][index % patch.width];
        for (const axis of ["x", "y", "z", "u", "v"] as const) control[axis] = Number(values.get(axis));
        patch.shader = String(values.get("shader") ?? "").trim();
      });
      this.patchPoint = index;
      this.changed();
    } catch (error) {
      this.status(`Patch edit rejected: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private loadPatchPointFields(): void {
    const form = this.inspector.querySelector<HTMLFormElement>("[data-patch-form]");
    const patch = this.document.snapshot().patches?.find((item) => item.id === this.selectedId);
    if (!form || !patch) return;
    const index = Number(form.querySelector<HTMLSelectElement>("[data-patch-point]")!.value);
    if (!Number.isSafeInteger(index) || index < 0 || index >= patch.width * patch.height) return;
    this.patchPoint = index;
    const control = patch.controlPoints[Math.floor(index / patch.width)][index % patch.width];
    for (const axis of ["x", "y", "z", "u", "v"] as const) {
      form.querySelector<HTMLInputElement>(`[name="${axis}"]`)!.value = String(control[axis]);
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
    const next: PointEntity = {
      id,
      classname: String(values.get("classname") ?? "").trim(),
      origin: {
        x: Number(values.get("origin-x")),
        y: Number(values.get("origin-y")),
        z: Number(values.get("origin-z")),
      },
      keys,
    };
    const modelIssue = modelReferenceIssue(next);
    if (modelIssue) {
      this.status(`Model edit rejected: ${modelIssue}`);
      return;
    }
    try {
      this.document.transact((data) => {
        const entity = data.entities.find((item) => item.id === id);
        if (!entity) throw new Error("Selected entity no longer exists");
        Object.assign(entity, next);
      });
      this.changed();
    } catch (error) {
      this.status(`Entity edit rejected: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private rebuildMeshes(): void {
    const data = this.document.snapshot();
    const wanted = new Map(
      data.entities
        .filter(
          (entity) =>
            entity.classname === "misc_model" &&
            !modelReferenceIssue(entity) &&
            entity.keys.model.toLowerCase().endsWith(".glb"),
        )
        .map((entity) => [entity.id, entity.keys.model]),
    );
    for (const [id, root] of this.modelPreviews) {
      if (wanted.get(id) === root.metadata?.editorModelPath) continue;
      root.dispose(false, true);
      this.modelPreviews.delete(id);
    }
    for (const [id, path] of this.modelPreviewRequests)
      if (wanted.get(id) !== path) this.modelPreviewRequests.delete(id);
    for (const [id, path] of this.modelPreviewFailures)
      if (wanted.get(id) !== path) this.modelPreviewFailures.delete(id);
    for (const mesh of this.meshes.values()) {
      mesh.material?.dispose();
      mesh.dispose();
    }
    this.meshes.clear();
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
      const selected = brush.id === this.selectedId;
      if (this.texturedReady) {
        // a tint over the textured faces for the selection and brush entities, pulled forward so it doesn't
        // z-fight; selected faces have their own overlay, so the brush tint steps aside for them
        material.alpha = selected && this.selectedFaces.size === 0 ? 0.15 : owned ? 0.3 : 0;
        material.zOffset = -1;
      } else {
        material.alpha = 0.82;
      }
      mesh.material = material;
      if (this.viewMode === "wireframe") {
        // drawn by the line mesh below; the box stays for picking, which goes by predicate, not visibility
        mesh.isVisible = false;
      } else {
        mesh.enableEdgesRendering();
        mesh.edgesWidth = 2;
        mesh.edgesColor = new Color4(0.02, 0.02, 0.05, 1);
      }
      this.meshes.set(brush.id, mesh);
    }
    for (const patch of data.patches ?? []) {
      this.meshes.set(
        patch.id,
        createPatchPreview(patch, this.scene, patch.id === this.selectedId, this.viewMode === "wireframe"),
      );
    }
    this.syncTexturedMeshes(data);
    this.syncWireframe(data, ownerColors);
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
      const path = wanted.get(entity.id);
      if (path) {
        const preview = this.modelPreviews.get(entity.id);
        if (preview) this.positionModelPreview(preview, entity);
        else if (
          this.modelPreviewRequests.get(entity.id) !== path &&
          this.modelPreviewFailures.get(entity.id) !== path
        ) {
          this.modelPreviewRequests.set(entity.id, path);
          void this.loadModelPreview(entity.id, path);
        }
      }
    }
  }

  private positionModelPreview(root: TransformNode, entity: PointEntity): void {
    root.position.set(entity.origin.x, entity.origin.z, entity.origin.y);
    root.rotation.y = (Number(entity.keys.angle ?? 0) * Math.PI) / 180;
    root.scaling.setAll(Number(entity.keys.modelscale ?? 1));
  }

  /** Loose GLB preview. The marker remains pickable when the browser cannot load the asset. */
  private async loadModelPreview(id: string, path: string): Promise<void> {
    let root: TransformNode | null = null;
    try {
      const slash = path.lastIndexOf("/");
      const result = await ImportMeshAsync(path.slice(slash + 1), this.scene, {
        rootUrl: `/data/${path.slice(0, slash + 1)}`,
      });
      if (this.modelPreviewRequests.get(id) !== path || this.scene.isDisposed) {
        for (const mesh of result.meshes) mesh.dispose(false, true);
        for (const node of result.transformNodes) node.dispose(false, true);
        return;
      }
      root = new TransformNode(`preview-${id}`, this.scene);
      root.metadata = { editorModelPath: path };
      for (const node of result.transformNodes) if (!node.parent) node.parent = root;
      for (const mesh of result.meshes) {
        if (!mesh.parent) mesh.parent = root;
        mesh.metadata = { ...mesh.metadata, editorEntityId: id };
        mesh.isPickable = true;
      }
      const current = this.document.snapshot().entities.find((entity) => entity.id === id);
      if (this.modelPreviewRequests.get(id) !== path || current?.keys.model !== path || this.scene.isDisposed) {
        root.dispose(false, true);
        return;
      }
      this.positionModelPreview(root, current);
      this.modelPreviewRequests.delete(id);
      this.modelPreviews.set(id, root);
    } catch (error) {
      root?.dispose(false, true);
      if (this.modelPreviewRequests.get(id) === path) {
        this.modelPreviewRequests.delete(id);
        this.modelPreviewFailures.set(id, path);
        this.status(`Model preview unavailable for ${path}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  private previewBrush(): BoxBrush | null {
    const gesture = this.gesture;
    if (!gesture) return null;
    const axes = AXES[gesture.plane];
    if (gesture.mode === "draw") {
      if (gesture.drawKind === "patch") return null;
      const bounds = drawBounds(axes, gesture.start, gesture.current, gesture.workPlane, gesture.grid);
      return bounds ? { id: "gesture-preview", ...bounds, shader: "blx/blx_grid" } : null;
    }
    if (!gesture.brush) return null;
    if (gesture.mode === "resize" && gesture.edge) {
      return resizeBox(
        gesture.brush,
        gesture.edge,
        { [axes.u]: gesture.current[0], [axes.v]: gesture.current[1] },
        gesture.grid,
      );
    }
    return moveBox(gesture.brush, axes, gesture.current[0] - gesture.start[0], gesture.current[1] - gesture.start[1]);
  }

  private disposeGhost(): void {
    if (!this.ghost) return;
    this.ghost.material?.dispose();
    this.ghost.dispose();
    this.ghost = null;
  }

  private disposePatchGhost(): void {
    if (!this.patchGhost) return;
    this.patchGhost.material?.dispose();
    this.patchGhost.dispose();
    this.patchGhost = null;
  }

  private previewPatch(): PatchSurface | null {
    const gesture = this.gesture;
    return gesture?.mode === "draw" && gesture.drawKind === "patch"
      ? this.patchFromGesture("gesture-patch", gesture)
      : null;
  }

  private patchFromGesture(id: string, gesture: Gesture): PatchSurface | null {
    const axes = AXES[gesture.plane];
    const shader = this.currentTexture.name;
    if (!gesture.patchShape || gesture.patchShape === "flat") {
      return flatPatch(id, axes, gesture.start, gesture.current, gesture.workPlane, shader);
    }
    const sweep = {
      axes,
      start: gesture.start,
      end: gesture.current,
      depth: [gesture.workPlane, gesture.workPlane + (gesture.patchDepth ?? 32)] as const,
      reverse: gesture.patchReverse,
    };
    return gesture.patchShape === "arch"
      ? archPatch(id, shader, sweep)
      : bevelPatch(id, shader, sweep, gesture.patchShape === "bevel" ? "outer" : "inner");
  }

  private syncPatchGhost(preview: PatchSurface | null): void {
    this.disposePatchGhost();
    if (!preview) return;
    this.patchGhost = createPatchPreview(preview, this.scene, true, this.viewMode === "wireframe");
    this.patchGhost.isPickable = false;
    if (this.patchGhost.material) this.patchGhost.material.alpha = 0.4;
  }

  private syncGhost(preview: BoxBrush | null): void {
    // Wireframe draws brushes as lines, so their boxes stay hidden (entities keep theirs);
    // otherwise the moving brush hides behind its ghost
    const lines = this.viewMode === "wireframe" ? new Set(this.document.snapshot().brushes.map((b) => b.id)) : null;
    for (const [id, mesh] of this.meshes) {
      mesh.isVisible = !lines?.has(id) && !(this.gesture?.mode !== "draw" && this.gesture?.brush?.id === id && preview);
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
    const patchPreview = this.previewPatch();
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
            // edge midpoints: drag one axis
            [x + rw / 2, y],
            [x + rw / 2, y + rh],
            [x, y + rh / 2],
            [x + rw, y + rh / 2],
            // corners: drag both axes at once
            [x, y],
            [x + rw, y],
            [x, y + rh],
            [x + rw, y + rh],
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
      for (const patch of data.patches ?? []) {
        drawPatchLattice(ctx, patch, plane, originX, originY, this.zoom, patch.id === this.selectedId);
      }
      if (patchPreview) drawPatchLattice(ctx, patchPreview, plane, originX, originY, this.zoom, true);
      if (this.gesture?.mode === "draw" && preview) paint(preview.min, preview.max, true);
      if (this.gesture?.plane === plane) {
        // The gesture's current point is already grid-snapped (coordinates() does that); marking it
        // here, not just wherever the raw pointer sits, confirms exactly where the edit will land.
        const cx = originX + this.gesture.current[0] * this.zoom;
        const cy = originY - this.gesture.current[1] * this.zoom;
        ctx.strokeStyle = "#baff39";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(cx, cy, 5, 0, Math.PI * 2);
        ctx.moveTo(cx - 9, cy);
        ctx.lineTo(cx - 5, cy);
        ctx.moveTo(cx + 5, cy);
        ctx.lineTo(cx + 9, cy);
        ctx.moveTo(cx, cy - 9);
        ctx.lineTo(cx, cy - 5);
        ctx.moveTo(cx, cy + 5);
        ctx.lineTo(cx, cy + 9);
        ctx.stroke();
        // A live width×depth×height readout follows the same point while drawing or resizing, so the
        // mapper doesn't have to find it in the status bar's much longer line. While typing an exact
        // size (resize only, see numericEntryKey), it replaces the measured number, styled in lime to
        // match the snap marker, so it reads as "this will commit", not "this is what the mouse says".
        if ((this.gesture.mode === "draw" || this.gesture.mode === "resize") && preview) {
          const typing = this.gesture.mode === "resize" ? this.numericEntry : null;
          const label = typing
            ? `${typing.buffer}_`
            : [axes.u, axes.v, axes.hidden]
                .map((axis) => Math.round(preview.max[axis] - preview.min[axis]))
                .join(" × ");
          const accent = typing ? "#baff39" : "#ffc61a";
          ctx.font = "bold 13px Rajdhani, sans-serif";
          ctx.textBaseline = "top";
          const padX = 7;
          const padY = 4;
          const textWidth = ctx.measureText(label).width;
          const bx = cx + 14;
          const by = cy - 14 - 13 - padY * 2;
          ctx.fillStyle = "rgba(10,16,30,.92)";
          ctx.fillRect(bx, by, textWidth + padX * 2, 13 + padY * 2);
          ctx.strokeStyle = accent;
          ctx.lineWidth = 1;
          ctx.strokeRect(bx + 0.5, by + 0.5, textWidth + padX * 2 - 1, 13 + padY * 2 - 1);
          ctx.fillStyle = accent;
          ctx.fillText(label, bx + padX, by + padY);
        }
      }
      // A selected face pointing at this pane's viewer is outlined, dashed, inside its brush.
      const faced = data.brushes.find((brush) => brush.id === this.selectedId);
      const facing = axes.hidden.toUpperCase();
      if (
        faced &&
        (this.selectedFaces.has(`+${facing}` as FaceKey) || this.selectedFaces.has(`-${facing}` as FaceKey))
      ) {
        ctx.setLineDash?.([6, 4]);
        ctx.strokeStyle = "#ff8a00";
        ctx.lineWidth = 3;
        ctx.strokeRect(
          originX + faced.min[axes.u] * this.zoom + 3,
          originY - faced.max[axes.v] * this.zoom + 3,
          (faced.max[axes.u] - faced.min[axes.u]) * this.zoom - 6,
          (faced.max[axes.v] - faced.min[axes.v]) * this.zoom - 6,
        );
        ctx.setLineDash?.([]);
      }
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
    this.syncPatchGhost(patchPreview);
    this.syncFaceOverlays(data);
    this.renderInspector(data);
    for (const name of ["brush", "patch", "select", "entity"] as const)
      this.root
        .querySelector(`[data-action="${name}"]`)
        ?.classList.toggle("active", this.tool === name && (name !== "patch" || this.patchShape === "flat"));
    const curves = this.root.querySelector<HTMLDetailsElement>(".shagged__menu--curves")!;
    curves.querySelector("summary")!.classList.toggle("active", this.tool === "patch" && this.patchShape !== "flat");
    for (const [action, shape] of [
      ["patch", "flat"],
      ["curve-bevel", "bevel"],
      ["curve-inverted-bevel", "inverted-bevel"],
      ["curve-arch", "arch"],
    ] as const) {
      const button = curves.querySelector<HTMLButtonElement>(`[data-action="${action}"]`)!;
      const active = this.tool === "patch" && this.patchShape === shape;
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", String(active));
    }
    this.root.querySelector<HTMLButtonElement>('[data-action="undo"]')!.disabled = !this.document.canUndo;
    this.root.querySelector<HTMLButtonElement>('[data-action="redo"]')!.disabled = !this.document.canRedo;
    this.renderStatus();
  }

  /** Rebuilt only when the selection or the document changes, so a pan or zoom keeps a half-typed value. */
  private renderInspector(data: EditorDocumentData): void {
    const key = `${data.draftId}|${this.selectedId ?? ""}|${data.revision}|${[...this.selectedFaces].sort().join(",")}`;
    if (key === this.inspectorKey) return;
    this.inspectorKey = key;
    const selected = data.brushes.find((brush) => brush.id === this.selectedId);
    const patch = (data.patches ?? []).find((item) => item.id === this.selectedId);
    if (patch) {
      this.inspector.innerHTML = `<h2>Patch <code data-patch-id></code></h2>
        <form data-patch-form>
          <label class="shagged__shader">Control point <select name="point" data-patch-point></select></label>
          ${(["x", "y", "z", "u", "v"] as const)
            .map(
              (axis) =>
                `<label class="shagged__shader">${axis.toUpperCase()} <input name="${axis}" type="number" step="any" required></label>`,
            )
            .join("")}
          <label class="shagged__shader">Shader <input name="shader" type="text" spellcheck="false" required></label>
          <button type="submit">Apply Patch</button>
        </form><p>Controls use Quake XYZ and texture UV. One Apply is one undo step.</p>`;
      this.inspector.querySelector("[data-patch-id]")!.textContent =
        `${patch.id.slice(0, 8)} · ${patch.width}×${patch.height}`;
      const select = this.inspector.querySelector<HTMLSelectElement>("[data-patch-point]")!;
      for (let row = 0; row < patch.height; row++) {
        for (let col = 0; col < patch.width; col++) {
          const option = document.createElement("option");
          option.value = String(row * patch.width + col);
          option.textContent = `Row ${row + 1}, column ${col + 1}`;
          select.append(option);
        }
      }
      select.value = String(Math.min(this.patchPoint, patch.width * patch.height - 1));
      this.inspector.querySelector<HTMLInputElement>('[name="shader"]')!.value = patch.shader;
      this.loadPatchPointFields();
      return;
    }
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
        </form><p>Values use Quake units; Z is up. One Apply is one undo step. A brush in an entity leaves worldspawn; MakeBSP gives the entity its model.</p>
        <h3 class="shagged__faces-head">Faces</h3>
        <div class="shagged__faces" data-face-net aria-label="Faces (Ctrl+Shift+click in 3D)"></div>
        <div data-face-alignment></div>`;
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
      this.renderFaceNet(this.inspector.querySelector<HTMLElement>("[data-face-net]")!, selected);
      renderFaceAlignment(
        this.inspector.querySelector<HTMLElement>("[data-face-alignment]")!,
        selected,
        [...this.selectedFaces],
        (describe, update) => this.alignFaces(describe, update),
      );
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
    if (entity.classname === "misc_model") {
      const paths = document.createElement("datalist");
      paths.id = "shagged-model-paths";
      for (const path of indexedModelPaths()) {
        const option = document.createElement("option");
        option.value = path;
        paths.appendChild(option);
      }
      form.appendChild(paths);
      const note = document.createElement("p");
      note.className = "shagged__warning";
      const issue = modelReferenceIssue(entity);
      note.textContent = issue
        ? issue
        : entity.keys.model.toLowerCase().endsWith(".glb")
          ? "Loose GLB preview is attempted; MakeBSP decides the compiled result."
          : "This model exports to MakeBSP; a 3D preview for this format is not available yet.";
      form.after(note);
    }
  }
}
