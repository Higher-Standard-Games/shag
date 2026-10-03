/**
 * The SHAGGED Map Health tray: a drawer that lists `inspectMapHealth`'s
 * issues, warnings first, and selects (and lets the caller frame) the
 * affected brush, entity or face when a row is clicked. Built apart from
 * EditorSession.ts; see MapHealth.ts for the pure analysis.
 */

import "./map-health.css";
import type { MapHealthIssue } from "./MapHealth";

export interface MapHealthTrayOptions {
  /** Recomputed fresh each time the tray opens or refreshes, over the live document. */
  issues: () => MapHealthIssue[];
  /** Selects (and ideally frames) the object an issue points to; not called for a null objectId. */
  onSelect: (objectId: string, face?: MapHealthIssue["face"]) => void;
  onClose?: () => void;
}

const CODE_LABEL: Record<MapHealthIssue["code"], string> = {
  "no-spawn": "No spawn",
  "required-key": "Missing key",
  "invalid-model": "Bad model",
  "unresolved-target": "Broken link",
  "duplicate-targetname": "Duplicate name",
  "unknown-class": "Unknown class",
  "unknown-shader": "Unknown shader",
  "missing-shader-image": "Missing image",
};

export class MapHealthTray {
  readonly element: HTMLElement;
  private readonly list: HTMLElement;
  private readonly countEl: HTMLElement;
  private issues: MapHealthIssue[] = [];

  constructor(private readonly options: MapHealthTrayOptions) {
    this.element = document.createElement("section");
    this.element.className = "shagged-health";
    this.element.hidden = true;
    this.element.setAttribute("aria-label", "Map health");
    this.element.innerHTML = `
      <header class="shagged-health__head">
        <strong>Map Health</strong>
        <span class="shagged-health__count" data-count></span>
        <button type="button" class="shagged-health__refresh" title="Re-check the map">↻</button>
        <button type="button" class="shagged-health__close" aria-label="Close map health" title="Close (Esc)">✕</button>
      </header>
      <div class="shagged-health__list" role="list"></div>`;
    this.countEl = this.element.querySelector("[data-count]")!;
    this.list = this.element.querySelector(".shagged-health__list")!;

    this.element.querySelector(".shagged-health__close")!.addEventListener("click", () => this.close());
    this.element.querySelector(".shagged-health__refresh")!.addEventListener("click", () => this.refresh());
    this.list.addEventListener("click", (event) => {
      const row = (event.target as HTMLElement).closest<HTMLElement>(".shagged-health__row[data-object-id]");
      if (!row) return;
      const face = row.dataset.face as MapHealthIssue["face"] | undefined;
      this.options.onSelect(row.dataset.objectId!, face);
    });
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
    this.refresh();
  }

  close(): void {
    this.element.hidden = true;
    this.options.onClose?.();
  }

  toggle(): void {
    if (this.isOpen) this.close();
    else this.open();
  }

  /** Recomputes and redraws; safe to call whether or not the tray is open (a closed tray stays cheap to reopen). */
  refresh(): void {
    this.issues = this.options.issues();
    this.render();
  }

  private render(): void {
    const warnings = this.issues.filter((issue) => issue.severity === "warning");
    const info = this.issues.filter((issue) => issue.severity === "info");
    this.countEl.textContent = this.issues.length
      ? `${warnings.length} warning${warnings.length === 1 ? "" : "s"}, ${info.length} info`
      : "All clear";
    this.list.replaceChildren();
    if (!this.issues.length) {
      const empty = document.createElement("p");
      empty.className = "shagged-health__empty";
      empty.textContent = "No issues found.";
      this.list.appendChild(empty);
      return;
    }
    for (const group of [warnings, info]) {
      for (const issue of group) this.list.appendChild(this.renderRow(issue));
    }
  }

  private renderRow(issue: MapHealthIssue): HTMLElement {
    const row = document.createElement(issue.objectId ? "button" : "div");
    row.className = `shagged-health__row shagged-health__row--${issue.severity}`;
    row.setAttribute("role", "listitem");
    if (issue.objectId) {
      row.setAttribute("type", "button");
      (row as HTMLElement).dataset.objectId = issue.objectId;
      if (issue.face) (row as HTMLElement).dataset.face = issue.face;
      row.title = "Select and frame";
    }
    const badge = document.createElement("span");
    badge.className = "shagged-health__badge";
    badge.textContent = CODE_LABEL[issue.code];
    const message = document.createElement("span");
    message.className = "shagged-health__message";
    message.textContent = issue.message + (issue.face ? ` (face ${issue.face})` : "");
    row.append(badge, message);
    return row;
  }

  dispose(): void {
    this.element.remove();
  }
}
