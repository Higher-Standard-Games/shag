/**
 * The SHAGGED model browser: a drawer over the inspector with search, a group
 * sidebar (Recent, In this map, folders), a turning preview of the highlighted
 * model with its size, and the model list. Clicking a row previews it; Enter,
 * Use or a double-click picks it, and the editor drops it as a misc_model.
 */

import "./model-browser.css";
import { formatBounds, type ModelBounds } from "./EditorModelAsset";
import type { ModelPreview } from "./ModelTurntable";

export interface ModelBrowserOptions {
  /** Every model path the packages offer. */
  paths: () => string[];
  /** Model paths the open map already uses, for the "In this map" group. */
  inMap: () => string[];
  /** Builds the preview on the drawer's canvas, on first open. */
  preview: (canvas: HTMLCanvasElement) => ModelPreview;
  /** Pick a model; bounds are null when its preview did not load. */
  onPick: (path: string, bounds: ModelBounds | null, close: boolean) => void;
  onClose?: () => void;
}

type Group = { kind: "all" } | { kind: "recent" } | { kind: "inMap" } | { kind: "folder"; folder: string };

const RECENT_KEY = "shagged:recent-models:v1";
const RECENT_LIMIT = 24;

/** The folder a model is grouped under: its path between models/ and the file. */
export function modelFolder(path: string): string {
  return path.split("/").slice(1, -1).join("/") || "models";
}

/** Paths matching every whitespace-separated term, in order of the list. */
export function searchModels(paths: readonly string[], query: string): string[] {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  return paths.filter((path) => terms.every((term) => path.toLowerCase().includes(term)));
}

export class ModelBrowser {
  readonly element: HTMLElement;
  private paths: string[] = [];
  private shown: string[] = [];
  private group: Group = { kind: "all" };
  private query = "";
  private highlighted: string | null = null;
  /** Each previewed path's bounds, null once its preview failed. */
  private readonly bounds = new Map<string, Promise<ModelBounds | null>>();
  private readonly search: HTMLInputElement;
  private readonly groups: HTMLElement;
  private readonly list: HTMLElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly caption: HTMLElement;
  private readonly useButton: HTMLButtonElement;
  private readonly footer: HTMLElement;
  private preview: ModelPreview | null = null;

  constructor(private readonly options: ModelBrowserOptions) {
    this.element = document.createElement("section");
    this.element.className = "shagged-models";
    this.element.hidden = true;
    this.element.setAttribute("aria-label", "Model browser");
    this.element.innerHTML = `
      <header class="shagged-models__head">
        <input type="search" class="shagged-models__search" placeholder="Search models" spellcheck="false" aria-label="Search models">
        <button type="button" class="shagged-models__close" aria-label="Close model browser" title="Close (Esc)">✕</button>
      </header>
      <nav class="shagged-models__groups" aria-label="Model groups"></nav>
      <figure class="shagged-models__stage">
        <canvas class="shagged-models__canvas" aria-label="Model preview" title="Drag to orbit, wheel to zoom"></canvas>
        <figcaption class="shagged-models__caption">Pick a model to preview it</figcaption>
        <button type="button" class="shagged-models__use" disabled title="Place this model (Enter or double-click)">Use</button>
      </figure>
      <div class="shagged-models__list" role="listbox" aria-label="Models" tabindex="0"></div>
      <footer class="shagged-models__foot"></footer>`;
    this.search = this.element.querySelector(".shagged-models__search")!;
    this.groups = this.element.querySelector(".shagged-models__groups")!;
    this.list = this.element.querySelector(".shagged-models__list")!;
    this.canvas = this.element.querySelector(".shagged-models__canvas")!;
    this.caption = this.element.querySelector(".shagged-models__caption")!;
    this.useButton = this.element.querySelector(".shagged-models__use")!;
    this.footer = this.element.querySelector(".shagged-models__foot")!;

    this.search.addEventListener("input", () => {
      this.query = this.search.value;
      this.refresh();
    });
    this.element.querySelector(".shagged-models__close")!.addEventListener("click", () => this.close());
    this.useButton.addEventListener("click", () => this.highlighted && void this.pick(this.highlighted, false));
    this.groups.addEventListener("click", (event) => {
      const button = (event.target as HTMLElement).closest<HTMLButtonElement>("button[data-group]");
      if (!button) return;
      this.group = JSON.parse(button.dataset.group!) as Group;
      this.refresh();
    });
    this.list.addEventListener("click", (event) => {
      const row = (event.target as HTMLElement).closest<HTMLElement>(".shagged-models__row");
      if (!row) return;
      const path = row.dataset.path!;
      if (event.detail >= 2) void this.pick(path, true);
      else this.highlight(path);
    });
    this.list.addEventListener("keydown", (event) => this.listKey(event));
    // The drawer owns its keys: typing to search from the list must not reach the editor's shortcuts.
    this.element.addEventListener("keydown", (event) => {
      event.stopPropagation();
      if (event.key === "Escape") {
        event.preventDefault();
        this.close();
      }
    });
  }

  get isOpen(): boolean {
    return !this.element.hidden;
  }

  open(): void {
    this.element.hidden = false;
    this.paths = this.options.paths();
    try {
      this.preview ??= this.options.preview(this.canvas);
      this.preview.start();
    } catch (error) {
      this.caption.textContent = `Preview unavailable: ${error instanceof Error ? error.message : String(error)}`;
    }
    this.renderGroups();
    this.refresh();
    this.search.focus();
  }

  close(): void {
    if (this.element.hidden) return;
    this.element.hidden = true;
    this.preview?.stop();
    this.options.onClose?.();
  }

  toggle(): void {
    if (this.isOpen) this.close();
    else this.open();
  }

  dispose(): void {
    this.preview?.dispose();
    this.element.remove();
  }

  /** Paths used recently, newest first. */
  recent(): string[] {
    try {
      const value = JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]");
      return Array.isArray(value) ? value.filter((path) => typeof path === "string") : [];
    } catch {
      return [];
    }
  }

  private remember(path: string): void {
    const paths = [path, ...this.recent().filter((other) => other.toLowerCase() !== path.toLowerCase())];
    try {
      localStorage.setItem(RECENT_KEY, JSON.stringify(paths.slice(0, RECENT_LIMIT)));
    } catch {
      // Recent models are a convenience; a full storage must not block picking one.
    }
  }

  private renderGroups(): void {
    const folders = new Map<string, number>();
    for (const path of this.paths) folders.set(modelFolder(path), (folders.get(modelFolder(path)) ?? 0) + 1);
    const button = (group: Group, label: string, count?: number) => {
      const element = document.createElement("button");
      element.type = "button";
      element.dataset.group = JSON.stringify(group);
      element.textContent = label;
      if (count !== undefined) {
        const badge = document.createElement("span");
        badge.textContent = String(count);
        element.appendChild(badge);
      }
      return element;
    };
    const heading = document.createElement("h3");
    heading.textContent = "Folders";
    this.groups.replaceChildren(
      button({ kind: "all" }, "All", this.paths.length),
      button({ kind: "recent" }, "Recent"),
      button({ kind: "inMap" }, "In this map"),
      heading,
      ...[...folders]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([folder, n]) => button({ kind: "folder", folder }, folder, n)),
    );
  }

  private inGroup(): string[] {
    const group = this.group;
    switch (group.kind) {
      case "recent":
        return this.recent();
      case "inMap":
        return [...new Set(this.options.inMap())].sort();
      case "folder":
        return this.paths.filter((path) => modelFolder(path) === group.folder);
      default:
        return this.paths;
    }
  }

  private refresh(): void {
    for (const button of this.groups.querySelectorAll<HTMLButtonElement>("button[data-group]")) {
      button.classList.toggle("active", button.dataset.group === JSON.stringify(this.group));
    }
    this.shown = this.query.trim() ? searchModels(this.inGroup(), this.query) : this.inGroup();
    this.list.replaceChildren(...this.shown.map((path) => this.row(path)));
    this.list.scrollTop = 0;
    this.footer.textContent = this.shown.length
      ? `${this.shown.length} models`
      : this.paths.length
        ? "No models match."
        : "No packaged models found; type a loose models/... path in the inspector instead.";
  }

  private row(path: string): HTMLElement {
    const row = document.createElement("div");
    row.className = "shagged-models__row";
    row.dataset.path = path;
    row.setAttribute("role", "option");
    row.tabIndex = -1;
    row.title = path;
    row.classList.toggle("selected", path === this.highlighted);
    const name = document.createElement("span");
    name.className = "shagged-models__name";
    name.textContent = path.slice(path.lastIndexOf("/") + 1);
    const folder = document.createElement("small");
    folder.className = "shagged-models__folder";
    folder.textContent = modelFolder(path);
    row.append(name, folder);
    return row;
  }

  private highlight(path: string): void {
    this.highlighted = path;
    for (const row of this.list.querySelectorAll<HTMLElement>(".shagged-models__row")) {
      row.classList.toggle("selected", row.dataset.path === path);
    }
    this.useButton.disabled = false;
    this.caption.textContent = `${path} · loading…`;
    if (!this.preview) {
      this.caption.textContent = path;
      return;
    }
    const bounds = this.preview.show(path).then(
      (result) => {
        if (this.highlighted === path) this.caption.textContent = `${path} · ${formatBounds(result)}`;
        return result;
      },
      (error) => {
        if (this.highlighted === path) {
          this.caption.textContent = `${path} · no preview: ${error instanceof Error ? error.message : String(error)}`;
        }
        return null;
      },
    );
    this.bounds.set(path, bounds);
  }

  /** Waits for the model's preview so the editor gets its bounds. */
  private async pick(path: string, close: boolean): Promise<void> {
    if (this.highlighted !== path || !this.bounds.has(path)) this.highlight(path);
    this.remember(path);
    this.footer.textContent = `Picked ${path}`;
    if (close) this.close();
    this.options.onPick(path, (await this.bounds.get(path)) ?? null, close);
  }

  private listKey(event: KeyboardEvent): void {
    const rows = [...this.list.querySelectorAll<HTMLElement>(".shagged-models__row")];
    if (!rows.length) return;
    const current = rows.indexOf(document.activeElement as HTMLElement);
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const next = Math.max(0, Math.min(rows.length - 1, current + (event.key === "ArrowDown" ? 1 : -1)));
      rows[next].focus();
      rows[next].scrollIntoView?.({ block: "nearest" });
      this.highlight(rows[next].dataset.path!);
    } else if (event.key === "Enter" && this.highlighted) {
      event.preventDefault();
      void this.pick(this.highlighted, false);
    } else if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
      // Typing anywhere in the list goes to search.
      this.search.focus();
    }
  }
}
