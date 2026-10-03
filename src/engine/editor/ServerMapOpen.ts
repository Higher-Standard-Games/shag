import { EditorDocument, type EditorDocumentData } from "./EditorDocument";
import { writeMap } from "./MapWriter";
import type { ServerMapSnapshot } from "./ShaggedApi";

const MAP_NAME = /^[a-z][a-z0-9_]{0,47}$/;

/** A draft's server name is independent of its editable display name. */
export function serverMapName(draftId: string): string {
  const name = `draft_${draftId.replace(/-/g, "")}`;
  if (!MAP_NAME.test(name)) throw new Error("This draft ID cannot be used as a server map name");
  return name;
}

export type ServerOpenDecision =
  | { kind: "ready"; document: EditorDocument; revision: number }
  | { kind: "already-local"; document: EditorDocument; revision: number }
  | { kind: "local-conflict"; document: EditorDocument; revision: number };

/** Inspect a server revision without touching localStorage or the active editor. */
export function inspectServerMap(map: ServerMapSnapshot, local?: EditorDocumentData): ServerOpenDecision {
  if (!Number.isSafeInteger(map.revision) || map.revision < 1) throw new Error("Invalid server map revision");
  if (!map.sidecar) throw new Error("This map has no editable SHAGGED sidecar");
  const document = new EditorDocument(map.sidecar);
  const data = document.snapshot();
  if (serverMapName(data.draftId) !== map.name) throw new Error("Server map name does not match its draft ID");
  if (writeMap(data) !== map.source) throw new Error("Server map source does not match its editable sidecar");
  if (!local) return { kind: "ready", document, revision: map.revision };
  const localData = new EditorDocument(local).snapshot();
  if (localData.draftId !== data.draftId) throw new Error("Local and server draft IDs differ");
  return {
    kind: JSON.stringify(localData) === JSON.stringify(data) ? "already-local" : "local-conflict",
    document,
    revision: map.revision,
  };
}
