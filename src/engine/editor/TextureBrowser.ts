/**
 * The SHAGGED texture browser: a drawer over the inspector with search, a
 * group sidebar (Recent, In this map, tags, folders) and a grid of tiles.
 * Tiles render in pages as the grid scrolls; each tile's thumbnail loads only
 * while it is on screen and is cancelled when it scrolls away first. Picking a
 * tile hands the entry and its image size to the editor, which applies it.
 */

import "./texture-browser.css";
import { background } from "../core/AsyncErrors";
import { catalogFolders, searchCatalog, type TextureEntry } from "./TextureCatalog";
import type { TextureThumbnails } from "./TextureThumbnails";

export interface TextureBrowserOptions {
  catalog: () => Promise<TextureEntry[]>;
  thumbnails: TextureThumbnails;
  /** Texture names the open map already uses, for the "In this map" group. */
  inMap: () => string[];
  /** Apply a texture; size is the drawn image's size, null when it has no preview. */
  onApply: (entry: TextureEntry, size: [number, number] | null, close: boolean) => void;
  onClose?: () => void;
  /** Tiles appended per page as the grid scrolls. */
  pageSize?: number;
}

type Group =
  | { kind: "all" }
  | { kind: "recent" }
  | { kind: "inMap" }
  | { kind: "tag"; tag: string }
  | { kind: "folder"; folder: string };

const RECENT_KEY = "shagged:recent-textures:v1";
const RECENT_LIMIT = 24;

export class TextureBrowser {
  readonly element: HTMLElement;
  private entries: TextureEntry[] = [];
  private shown: TextureEntry[] = [];
  private rendered = 0;
  private group: Group = { kind: "all" };
  private query = "";
  private readonly sizes = new Map<string, [number, number] | null>();
  private readonly search: HTMLInputElement;
  private readonly groups: HTMLElement;
  private readonly grid: HTMLElement;
  private readonly footer: HTMLElement;
  private readonly sentinel: HTMLElement;
  private readonly tileObserver: IntersectionObserver | null;
  private readonly pageObserver: IntersectionObserver | null;
  private loaded: Promise<void> | null = null;

  constructor(private readonly options: TextureBrowserOptions) {
    this.element = document.createElement("section");
    this.element.className = "shagged-tex";
    this.element.hidden = true;
    this.element.setAttribute("aria-label", "Texture browser");
    this.element.innerHTML = `
      <header class="shagged-tex__head">
        <input type="search" class="shagged-tex__search" placeholder="Search name, folder or tag" spellcheck="false" aria-label="Search textures">
        <button type="button" class="shagged-tex__close" aria-label="Close texture browser" title="Close (Esc)">✕</button>
      </header>
      <nav class="shagged-tex__groups" aria-label="Texture groups"></nav>
      <div class="shagged-tex__grid" role="listbox" aria-label="Textures" tabindex="0"></div>
      <footer class="shagged-tex__foot"></footer>`;
    this.search = this.element.querySelector(".shagged-tex__search")!;
    this.groups = this.element.querySelector(".shagged-tex__groups")!;
    this.grid = this.element.querySelector(".shagged-tex__grid")!;
    this.footer = this.element.querySelector(".shagged-tex__foot")!;
    this.sentinel = document.createElement("div");
    this.sentinel.className = "shagged-tex__more";

    const observers = typeof IntersectionObserver !== "undefined";
    this.tileObserver = observers
      ? new IntersectionObserver((records) => this.tilesSeen(records), { root: this.grid, rootMargin: "120px" })
      : null;
    this.pageObserver = observers
      ? new IntersectionObserver((records) => records.some((r) => r.isIntersecting) && this.renderPage(), {
          root: this.grid,
          rootMargin: "300px",
        })
      : null;

    this.search.addEventListener("input", () => {
      this.query = this.search.value;
      this.refresh();
    });
    this.element.querySelector(".shagged-tex__close")!.addEventListener("click", () => this.close());
    this.groups.addEventListener("click", (event) => {
      const button = (event.target as HTMLElement).closest<HTMLButtonElement>("button[data-group]");
      if (!button) return;
      this.group = JSON.parse(button.dataset.group!) as Group;
      this.refresh();
    });
    this.grid.addEventListener("click", (event) => {
      const tile = (event.target as HTMLElement).closest<HTMLElement>(".shagged-tex__tile");
      if (tile) background(this.apply(Number(tile.dataset.index), event.detail >= 2), "TextureBrowser");
    });
    this.grid.addEventListener("keydown", (event) => this.gridKey(event));
    // The drawer owns its keys: typing to search from the grid must not reach the editor's shortcuts.
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

  /** Opens the drawer; the catalog loads on first open. Resolves once tiles are shown. */
  async open(): Promise<void> {
    this.element.hidden = false;
    this.search.focus();
    this.loaded ??= this.options
      .catalog()
      .then((entries) => {
        this.entries = entries;
      })
      .catch((error) => {
        this.loaded = null;
        this.footer.textContent = `Textures unavailable: ${error instanceof Error ? error.message : String(error)}`;
      });
    this.footer.textContent ||= "Loading textures…";
    await this.loaded;
    this.renderGroups();
    this.refresh();
  }

  close(): void {
    if (this.element.hidden) return;
    this.element.hidden = true;
    this.options.onClose?.();
  }

  toggle(): Promise<void> | void {
    return this.isOpen ? this.close() : this.open();
  }

  dispose(): void {
    this.tileObserver?.disconnect();
    this.pageObserver?.disconnect();
    this.element.remove();
  }

  /** Names used recently, newest first. */
  recent(): string[] {
    try {
      const value = JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]");
      return Array.isArray(value) ? value.filter((name) => typeof name === "string") : [];
    } catch {
      return [];
    }
  }

  private remember(name: string): void {
    const names = [name, ...this.recent().filter((other) => other.toLowerCase() !== name.toLowerCase())];
    try {
      localStorage.setItem(RECENT_KEY, JSON.stringify(names.slice(0, RECENT_LIMIT)));
    } catch {
      // Recent textures are a convenience; a full storage must not block applying one.
    }
  }

  private renderGroups(): void {
    const tags = new Map<string, number>();
    for (const entry of this.entries) for (const tag of entry.tags) tags.set(tag, (tags.get(tag) ?? 0) + 1);
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
    const heading = (text: string) => {
      const element = document.createElement("h3");
      element.textContent = text;
      return element;
    };
    this.groups.replaceChildren(
      button({ kind: "all" }, "All", this.entries.length),
      button({ kind: "recent" }, "Recent"),
      button({ kind: "inMap" }, "In this map"),
      ...(tags.size
        ? [heading("Tags"), ...[...tags].sort().map(([tag, n]) => button({ kind: "tag", tag }, tag, n))]
        : []),
      heading("Folders"),
      ...catalogFolders(this.entries).map(({ folder, count }) => button({ kind: "folder", folder }, folder, count)),
    );
  }

  private inGroup(): TextureEntry[] {
    const group = this.group;
    const byName = (names: string[]) => {
      const lookup = new Map(this.entries.map((entry) => [entry.name.toLowerCase(), entry]));
      return names
        .map((name) => lookup.get(name.toLowerCase()))
        .filter((entry): entry is TextureEntry => Boolean(entry));
    };
    switch (group.kind) {
      case "recent":
        return byName(this.recent());
      case "inMap":
        return byName([...new Set(this.options.inMap())].sort());
      case "tag":
        return this.entries.filter((entry) => entry.tags.includes(group.tag));
      case "folder":
        return this.entries.filter((entry) => entry.folder.toLowerCase() === group.folder.toLowerCase());
      default:
        return this.entries;
    }
  }

  /** Re-filters and restarts the grid at its first page. */
  private refresh(): void {
    for (const button of this.groups.querySelectorAll<HTMLButtonElement>("button[data-group]")) {
      button.classList.toggle("active", button.dataset.group === JSON.stringify(this.group));
    }
    this.shown = this.query.trim() ? searchCatalog(this.inGroup(), this.query) : this.inGroup();
    this.tileObserver?.disconnect();
    this.pageObserver?.disconnect();
    this.grid.replaceChildren();
    this.grid.scrollTop = 0;
    this.rendered = 0;
    this.footer.textContent = this.shown.length ? `${this.shown.length} textures` : "No textures match.";
    this.renderPage();
  }

  private renderPage(): void {
    const end = Math.min(this.shown.length, this.rendered + (this.options.pageSize ?? 120));
    this.sentinel.remove();
    for (let index = this.rendered; index < end; index++) this.grid.appendChild(this.tile(this.shown[index], index));
    this.rendered = end;
    if (this.rendered < this.shown.length) {
      this.grid.appendChild(this.sentinel);
      this.pageObserver?.observe(this.sentinel);
    }
  }

  private tile(entry: TextureEntry, index: number): HTMLElement {
    const tile = document.createElement("div");
    tile.className = "shagged-tex__tile";
    tile.dataset.index = String(index);
    tile.setAttribute("role", "option");
    tile.tabIndex = -1;
    tile.title = entry.name;
    const art = document.createElement("div");
    art.className = "shagged-tex__art";
    const label = document.createElement("span");
    label.className = "shagged-tex__name";
    label.textContent = entry.name.split("/").slice(1).join("/") || entry.name;
    const badges = document.createElement("span");
    badges.className = "shagged-tex__badges";
    for (const [flag, text] of [
      [entry.compiler, "tool"],
      [entry.sky, "sky"],
      [entry.fog, "fog"],
      [entry.transparent, "alpha"],
      [entry.hasShader, "shader"],
    ] as const) {
      if (!flag) continue;
      const badge = document.createElement("i");
      badge.textContent = text;
      badges.appendChild(badge);
    }
    tile.append(art, label, badges);
    if (entry.missing) {
      tile.classList.add("shagged-tex__tile--missing");
      art.textContent = "missing";
      this.sizes.set(entry.name, null);
    } else if (!entry.image) {
      art.textContent = entry.solidColor ? "colour" : "no preview";
      this.sizes.set(entry.name, null);
    } else if (this.tileObserver) this.tileObserver.observe(tile);
    else void this.loadThumb(tile, entry);
    return tile;
  }

  private tilesSeen(records: IntersectionObserverEntry[]): void {
    for (const record of records) {
      const tile = record.target as HTMLElement;
      const entry = this.shown[Number(tile.dataset.index)];
      if (!entry?.image) continue;
      if (record.isIntersecting) void this.loadThumb(tile, entry);
      else if (!tile.dataset.loaded) this.options.thumbnails.cancel(entry.image);
    }
  }

  private async loadThumb(tile: HTMLElement, entry: TextureEntry): Promise<void> {
    if (tile.dataset.loaded || !entry.image) return;
    const thumb = await this.options.thumbnails.request(entry.image);
    if (!thumb) {
      this.sizes.set(entry.name, null);
      tile.querySelector(".shagged-tex__art")!.textContent = "no preview";
      return;
    }
    tile.dataset.loaded = "1";
    this.sizes.set(entry.name, [thumb.width, thumb.height]);
    const art = tile.querySelector<HTMLElement>(".shagged-tex__art")!;
    art.style.backgroundImage = `url("${thumb.url}")`;
    tile.title = `${entry.name} · ${thumb.width}×${thumb.height}`;
    if (tile.isConnected) this.tileObserver?.unobserve(tile);
  }

  /** Hands the entry to the editor with its image size, fetching the size first if no thumbnail ran yet. */
  private async apply(index: number, close: boolean): Promise<void> {
    const entry = this.shown[index];
    if (!entry) return;
    let size = this.sizes.get(entry.name);
    if (size === undefined && entry.image) {
      const thumb = await this.options.thumbnails.request(entry.image);
      size = thumb ? [thumb.width, thumb.height] : null;
      this.sizes.set(entry.name, size);
    }
    this.remember(entry.name);
    for (const tile of this.grid.querySelectorAll(".shagged-tex__tile.selected")) tile.classList.remove("selected");
    this.grid.querySelector(`.shagged-tex__tile[data-index="${index}"]`)?.classList.add("selected");
    this.footer.textContent = size ? `${entry.name} · ${size[0]}×${size[1]}` : `${entry.name} · size unknown`;
    this.options.onApply(entry, size ?? null, close);
    if (close) this.close();
  }

  private gridKey(event: KeyboardEvent): void {
    const tiles = [...this.grid.querySelectorAll<HTMLElement>(".shagged-tex__tile")];
    if (!tiles.length) return;
    const current = tiles.indexOf(document.activeElement as HTMLElement);
    const first = tiles[0].offsetTop;
    const columns = Math.max(1, tiles.filter((tile) => tile.offsetTop === first).length);
    const move: Record<string, number> = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: columns, ArrowUp: -columns };
    if (event.key in move) {
      event.preventDefault();
      const next = Math.max(0, Math.min(tiles.length - 1, (current < 0 ? -1 : current) + move[event.key]));
      if (next >= this.rendered - 1) this.renderPage();
      tiles[next]?.focus();
      tiles[next]?.scrollIntoView?.({ block: "nearest" });
    } else if (event.key === "Enter" && current >= 0) {
      event.preventDefault();
      void this.apply(current, false);
    } else if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
      // Typing anywhere in the grid goes to search.
      this.search.focus();
    }
  }
}
