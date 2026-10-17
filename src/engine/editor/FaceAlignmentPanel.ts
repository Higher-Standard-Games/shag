/**
 * Alignment fields, nudges and operations for the selected faces of one
 * brush, shown under the inspector's face net. The panel only builds edits;
 * the caller applies each one to every selected face as one undo step.
 */

import { type BrushFace, brushFaceMaterial, fitBrushFace, wrapBrushFaces } from "./BrushFaces";
import type { BoxBrush, FaceMaterial } from "./EditorDocument";
import { naturalFace } from "./FaceUv";
import "./face-alignment.css";

/** A change to one selected face; `brush` is the brush as it is inside the transaction. */
export type FaceUpdate = (face: FaceMaterial, key: BrushFace, brush: BoxBrush) => FaceMaterial;

/** Applies `update` to every selected face as one step and reports `describe`. */
export type AlignFaces = (describe: string, update: FaceUpdate) => void;

interface Field {
  name: string;
  label: string;
  step: number;
  get: (face: FaceMaterial) => number;
  set: (face: FaceMaterial, value: number) => FaceMaterial;
}

const FIELDS: readonly Field[] = [
  {
    name: "shift-u",
    label: "Shift U",
    step: 8,
    get: (f) => f.shift[0],
    set: (f, v) => ({ ...f, shift: [v, f.shift[1]] }),
  },
  {
    name: "shift-v",
    label: "Shift V",
    step: 8,
    get: (f) => f.shift[1],
    set: (f, v) => ({ ...f, shift: [f.shift[0], v] }),
  },
  {
    name: "scale-u",
    label: "Scale U",
    step: 0.05,
    get: (f) => f.scale[0],
    set: (f, v) => ({ ...f, scale: [v, f.scale[1]] }),
  },
  {
    name: "scale-v",
    label: "Scale V",
    step: 0.05,
    get: (f) => f.scale[1],
    set: (f, v) => ({ ...f, scale: [f.scale[0], v] }),
  },
  { name: "rotation", label: "Rotation", step: 15, get: (f) => f.rotation, set: (f, v) => ({ ...f, rotation: v }) },
  { name: "skew", label: "Skew", step: 5, get: (f) => f.skew ?? 0, set: (f, v) => ({ ...f, skew: v }) },
];

const tidy = (value: number): number => Math.round(value * 1e6) / 1e6;

/**
 * Fills `host` for the faces `keys` (in selection order) of `brush`. A field
 * all faces agree on shows its value; otherwise it is blank, and typing a
 * value sets it on every face. A nudge adds its step to each face's own
 * value. Wrap continues the first selected face's texture onto the others.
 */
export function renderFaceAlignment(
  host: HTMLElement,
  brush: BoxBrush,
  keys: readonly BrushFace[],
  align: AlignFaces,
): void {
  host.replaceChildren();
  if (!keys.length) {
    const hint = document.createElement("p");
    hint.textContent = "Ctrl+Shift+click a face in 3D, or one above, to texture or align faces on their own.";
    host.appendChild(hint);
    return;
  }
  const form = document.createElement("form");
  form.className = "shagged-uv";
  form.dataset.uvForm = "";
  const inputs = new Map<Field, HTMLInputElement>();
  const faces = keys.flatMap((key) => brushFaceMaterial(brush, key) ?? []);
  for (const field of FIELDS) {
    const row = document.createElement("div");
    row.className = "shagged-uv__row";
    const label = document.createElement("label");
    label.textContent = field.label;
    label.htmlFor = `shagged-uv-${field.name}`;
    const input = document.createElement("input");
    input.id = `shagged-uv-${field.name}`;
    input.name = field.name;
    input.type = "number";
    input.step = "any";
    const values = new Set(faces.map(field.get));
    if (values.size === 1) input.defaultValue = String([...values][0]);
    else input.placeholder = "mixed";
    inputs.set(field, input);
    const nudge = (sign: 1 | -1) => {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = sign > 0 ? "+" : "−";
      button.title = `${sign > 0 ? "+" : "−"}${field.step}`;
      button.dataset.uvNudge = `${field.name}:${sign}`;
      button.addEventListener("click", () =>
        align(`${field.label} ${button.title}`, (face) => field.set(face, tidy(field.get(face) + sign * field.step))),
      );
      return button;
    };
    row.append(label, nudge(-1), input, nudge(1));
    form.appendChild(row);
  }

  const ops = document.createElement("div");
  ops.className = "shagged-uv__ops";
  const op = (name: string, text: string, title: string, run: () => void) => {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.uvOp = name;
    button.textContent = text;
    button.title = title;
    button.addEventListener("click", run);
    ops.appendChild(button);
    return button;
  };
  op("fit", "Fit", "One repeat of the texture across each face", () =>
    align("Fitted", (face, key, box) => fitBrushFace(face, box, key)),
  );
  op("natural", "Natural", "0.5 units per texel, no shift or rotation", () =>
    align("Natural alignment", (face) => naturalFace(face.shader, face.size)),
  );
  const [first, ...rest] = keys;
  const wrap = op(
    "wrap",
    `Wrap from ${first}`,
    "The first selected face's texture continues around the corners onto the others",
    () => {
      let wrapped: Map<BrushFace, FaceMaterial> | undefined;
      align(`Wrapped ${first} around`, (face, key, box) => {
        if (key === first) return face;
        wrapped ??= wrapBrushFaces(box, first, rest);
        return wrapped.get(key)!;
      });
    },
  );
  wrap.disabled = rest.length === 0;
  form.appendChild(ops);

  // Enter or leaving a field: every field changed from what was shown is set on every face.
  const applyTyped = () => {
    const edits = FIELDS.flatMap((field) => {
      const input = inputs.get(field)!;
      if (input.value === "" || input.value === input.defaultValue) return [];
      const value = Number(input.value);
      return Number.isFinite(value) ? [{ field, value }] : [];
    });
    if (!edits.length) return;
    for (const { field, value } of edits) inputs.get(field)!.defaultValue = String(value);
    align(`Set ${edits.map(({ field }) => field.label.toLowerCase()).join(", ")}`, (face) =>
      edits.reduce((item, { field, value }) => field.set(item, value), face),
    );
  };
  form.addEventListener("change", applyTyped);
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    event.stopPropagation();
    applyTyped();
  });

  const fixed = keys.filter((key) => {
    const material = brushFaceMaterial(brush, key);
    return !material || material.sizeKnown === false;
  });
  if (fixed.length) {
    const warning = document.createElement("p");
    warning.className = "shagged-uv__warning";
    warning.textContent = `Face ${fixed.join(", ")} has no known image size. Pick a texture (T) for it first.`;
    form.appendChild(warning);
    for (const control of form.querySelectorAll<HTMLInputElement | HTMLButtonElement>("input, button")) {
      control.disabled = true;
    }
  }
  host.appendChild(form);
}
