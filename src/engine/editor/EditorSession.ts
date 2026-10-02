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
import { type BoxBrush, EditorDocument, type EditorDocumentData, type Vec3q } from "./EditorDocument";
import { writeMap } from "./MapWriter";
import "./editor.css";

const ACTIVE_KEY = "shagged:active-draft:v1";
const draftKey = (id: string): string => `shagged:draft:v1:${id}`;
type Plane = "xy" | "xz" | "yz";
const AXES: Record<Plane, { u: keyof Vec3q; v: keyof Vec3q; hidden: keyof Vec3q }> = {
  xy: { u: "x", v: "y", hidden: "z" },
  xz: { u: "x", v: "z", hidden: "y" },
  yz: { u: "y", v: "z", hidden: "x" },
};
type Gesture = {
  plane: Plane;
  mode: "draw" | "move";
  start: [number, number];
  current: [number, number];
  brush?: BoxBrush;
};

function snap(n: number, grid: number): number {
  return Math.round(n / grid) * grid;
}
function inRect(u: number, v: number, b: BoxBrush, plane: Plane): boolean {
  const axes = AXES[plane];
  return u >= b.min[axes.u] && u <= b.max[axes.u] && v >= b.min[axes.v] && v <= b.max[axes.v];
}
function savedDocument(): EditorDocument {
  const id = localStorage.getItem(ACTIVE_KEY);
  const raw = id ? localStorage.getItem(draftKey(id)) : null;
  if (id && !raw) throw new Error("Active draft is missing from local storage");
  if (!raw) return new EditorDocument();
  return new EditorDocument(JSON.parse(raw) as EditorDocumentData);
}

export class EditorSession {
  document: EditorDocument;
  readonly root: HTMLDivElement;
  private readonly scene: Scene;
  private readonly camera: ArcRotateCamera;
  private readonly panes = new Map<Plane, HTMLCanvasElement>();
  private readonly meshes = new Map<string, Mesh>();
  private readonly listeners = new AbortController();
  private readonly statusEl: HTMLElement;
  private readonly inspector: HTMLElement;
  private selectedId: string | null = null;
  private tool: "brush" | "select" = "brush";
  private grid = 16;
  private zoom = 1;
  private gesture: Gesture | null = null;

  constructor(
    engine: AbstractEngine,
    private readonly canvas: HTMLCanvasElement,
    private readonly onExit: () => void,
  ) {
    this.document = savedDocument();
    this.scene = new Scene(engine);
    this.scene.clearColor = new Color4(0.035, 0.045, 0.075, 1);
    this.camera = new ArcRotateCamera("shagged-perspective", Math.PI / 4, Math.PI / 3, 650, Vector3.Zero(), this.scene);
    this.camera.lowerRadiusLimit = 32;
    this.camera.upperRadiusLimit = 5000;
    this.camera.attachControl(canvas, true);
    this.scene.activeCamera = this.camera;
    const light = new HemisphericLight("shagged-light", new Vector3(0, 1, 0), this.scene);
    light.intensity = 1.1;

    this.root = document.createElement("div");
    this.root.className = "shagged";
    this.root.tabIndex = -1;
    this.root.innerHTML = `
      <header class="shagged__toolbar">
        <strong>SHAGGED <small>GENERAL EDITOR</small></strong>
        <button data-action="new">New</button><button data-action="save">Save Draft</button>
        <button data-action="export">Export .map</button>
        <span class="shagged__separator"></span>
        <button data-action="undo">Undo</button><button data-action="redo">Redo</button>
        <button data-action="brush">Brush (B)</button><button data-action="select">Select (V)</button>
        <button data-action="delete">Delete</button>
        <label>Grid <select data-grid><option>8</option><option selected>16</option><option>32</option><option>64</option></select></label>
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
      <aside class="shagged__inspector"></aside>
      <footer class="shagged__status"></footer>`;
    document.body.appendChild(this.root);
    this.statusEl = this.root.querySelector(".shagged__status")!;
    this.inspector = this.root.querySelector(".shagged__inspector")!;

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
        "wheel",
        (event) => {
          event.preventDefault();
          this.zoom = Math.max(0.25, Math.min(4, this.zoom * (event.deltaY > 0 ? 0.9 : 1.1)));
          this.draw();
        },
        { passive: false, signal: this.listeners.signal },
      );
    }
    this.root.addEventListener(
      "click",
      (event) => {
        const action = (event.target as HTMLElement).closest<HTMLButtonElement>("button[data-action]")?.dataset.action;
        if (action) this.action(action);
      },
      { signal: this.listeners.signal },
    );
    this.root.querySelector("[data-grid]")?.addEventListener(
      "change",
      (event) => {
        this.grid = Number((event.target as HTMLSelectElement).value);
        this.draw();
      },
      { signal: this.listeners.signal },
    );
    this.root.addEventListener("keydown", (event) => this.keyDown(event), { signal: this.listeners.signal });
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
    localStorage.setItem(draftKey(data.draftId), JSON.stringify(data));
    localStorage.setItem(ACTIVE_KEY, data.draftId);
    this.status("Draft saved locally");
  }
  showError(message: string): void {
    this.status(message);
  }
  dispose(): void {
    this.listeners.abort();
    this.camera.detachControl();
    this.scene.dispose();
    this.root.remove();
  }

  private status(message: string): void {
    this.statusEl.textContent = `${message} · ${this.document.snapshot().brushes.length} brushes · revision ${this.revision} · grid ${this.grid} · MakeBSP unavailable`;
  }

  private action(action: string): void {
    try {
      switch (action) {
        case "new":
          this.save();
          this.document = new EditorDocument();
          this.selectedId = null;
          this.changed();
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
          this.tool = action;
          this.draw();
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
        this.action("save");
      }
      return;
    }
    if (key === "b") this.action("brush");
    else if (key === "v") this.action("select");
    else if (key === "delete") this.action("delete");
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

  private coordinates(canvas: HTMLCanvasElement, event: PointerEvent): [number, number] {
    const rect = canvas.getBoundingClientRect();
    return [
      snap((event.clientX - rect.left - rect.width / 2) / this.zoom, this.grid),
      snap((rect.height / 2 - (event.clientY - rect.top)) / this.zoom, this.grid),
    ];
  }

  private pointerDown(plane: Plane, event: PointerEvent): void {
    if (event.button !== 0) return;
    const pane = this.panes.get(plane)!;
    pane.setPointerCapture(event.pointerId);
    const start = this.coordinates(pane, event);
    const hit = [...this.document.snapshot().brushes]
      .reverse()
      .find((brush) => inRect(start[0], start[1], brush, plane));
    if (this.tool === "select") {
      this.selectedId = hit?.id ?? null;
      this.gesture = hit ? { plane, mode: "move", start, current: start, brush: hit } : null;
      this.rebuildMeshes();
    } else this.gesture = { plane, mode: "draw", start, current: start };
    this.draw();
  }

  private pointerMove(plane: Plane, event: PointerEvent): void {
    if (!this.gesture || this.gesture.plane !== plane) return;
    this.gesture.current = this.coordinates(this.panes.get(plane)!, event);
    this.draw();
  }

  private pointerUp(plane: Plane, event: PointerEvent): void {
    const gesture = this.gesture;
    if (!gesture || gesture.plane !== plane) return;
    gesture.current = this.coordinates(this.panes.get(plane)!, event);
    this.gesture = null;
    const [u0, v0] = gesture.start;
    const [u1, v1] = gesture.current;
    if (u0 === u1 && v0 === v1) {
      this.draw();
      return;
    }
    const axes = AXES[plane];
    if (gesture.mode === "draw") {
      if (u0 === u1 || v0 === v1) {
        this.status("Drag at least one grid cell in both axes");
        this.draw();
        return;
      }
      const min: Vec3q = { x: 0, y: 0, z: 0 };
      const max: Vec3q = { x: 0, y: 0, z: 0 };
      min[axes.u] = Math.min(u0, u1);
      max[axes.u] = Math.max(u0, u1);
      min[axes.v] = Math.min(v0, v1);
      max[axes.v] = Math.max(v0, v1);
      min[axes.hidden] = 0;
      max[axes.hidden] = 64;
      const brush: BoxBrush = { id: crypto.randomUUID(), min, max, shader: "blx/blx_grid" };
      this.document.transact((data) => {
        data.brushes.push(brush);
      });
      this.selectedId = brush.id;
    } else if (gesture.brush) {
      const du = u1 - u0;
      const dv = v1 - v0;
      const id = gesture.brush.id;
      this.document.transact((data) => {
        const brush = data.brushes.find((item) => item.id === id)!;
        brush.min[axes.u] += du;
        brush.max[axes.u] += du;
        brush.min[axes.v] += dv;
        brush.max[axes.v] += dv;
      });
    }
    this.changed();
  }

  private cancelGesture(): void {
    this.gesture = null;
    this.draw();
  }

  private changed(): void {
    this.rebuildMeshes();
    this.draw();
    try {
      this.save();
    } catch (error) {
      this.status(`Autosave failed: ${String(error)}`);
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

  private draw(): void {
    const data = this.document.snapshot();
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
      ctx.fillStyle = "#101b31";
      ctx.fillRect(0, 0, w, h);
      const cell = this.grid * this.zoom;
      ctx.strokeStyle = "rgba(70, 150, 180, .17)";
      ctx.lineWidth = 1;
      for (let x = (w / 2) % cell; x < w; x += cell) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, h);
        ctx.stroke();
      }
      for (let y = (h / 2) % cell; y < h; y += cell) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(w, y);
        ctx.stroke();
      }
      ctx.strokeStyle = "rgba(0, 255, 255, .55)";
      ctx.beginPath();
      ctx.moveTo(w / 2, 0);
      ctx.lineTo(w / 2, h);
      ctx.moveTo(0, h / 2);
      ctx.lineTo(w, h / 2);
      ctx.stroke();
      const axes = AXES[plane];
      const paint = (min: Vec3q, max: Vec3q, selected: boolean) => {
        const x = w / 2 + min[axes.u] * this.zoom;
        const y = h / 2 - max[axes.v] * this.zoom;
        const rw = (max[axes.u] - min[axes.u]) * this.zoom;
        const rh = (max[axes.v] - min[axes.v]) * this.zoom;
        ctx.fillStyle = selected ? "rgba(255,198,26,.36)" : "rgba(0,225,240,.25)";
        ctx.strokeStyle = selected ? "#ffc61a" : "#41deeb";
        ctx.lineWidth = selected ? 2 : 1;
        ctx.fillRect(x, y, rw, rh);
        ctx.strokeRect(x, y, rw, rh);
      };
      for (const brush of data.brushes) {
        if (this.gesture?.mode === "move" && this.gesture.brush?.id === brush.id) {
          const moveAxes = AXES[this.gesture.plane];
          const du = this.gesture.current[0] - this.gesture.start[0];
          const dv = this.gesture.current[1] - this.gesture.start[1];
          const min = {
            ...brush.min,
            [moveAxes.u]: brush.min[moveAxes.u] + du,
            [moveAxes.v]: brush.min[moveAxes.v] + dv,
          };
          const max = {
            ...brush.max,
            [moveAxes.u]: brush.max[moveAxes.u] + du,
            [moveAxes.v]: brush.max[moveAxes.v] + dv,
          };
          paint(min, max, true);
        } else paint(brush.min, brush.max, brush.id === this.selectedId);
      }
      if (this.gesture?.plane === plane && this.gesture.mode === "draw") {
        const [u0, v0] = this.gesture.start;
        const [u1, v1] = this.gesture.current;
        const min: Vec3q = { x: 0, y: 0, z: 0 };
        const max: Vec3q = { x: 64, y: 64, z: 64 };
        min[axes.u] = Math.min(u0, u1);
        max[axes.u] = Math.max(u0, u1);
        min[axes.v] = Math.min(v0, v1);
        max[axes.v] = Math.max(v0, v1);
        paint(min, max, true);
      }
    }
    this.inspector.textContent = this.selectedId
      ? `Selected ${this.selectedId.slice(0, 8)} · ${data.brushes.find((brush) => brush.id === this.selectedId)?.shader ?? ""}`
      : "Drag in an orthographic pane to draw a brush. Select (V) to move one.";
    for (const name of ["brush", "select"] as const)
      this.root.querySelector(`[data-action="${name}"]`)?.classList.toggle("active", this.tool === name);
    this.root.querySelector<HTMLButtonElement>('[data-action="undo"]')!.disabled = !this.document.canUndo;
    this.root.querySelector<HTMLButtonElement>('[data-action="redo"]')!.disabled = !this.document.canRedo;
    this.status("Local draft");
  }
}
