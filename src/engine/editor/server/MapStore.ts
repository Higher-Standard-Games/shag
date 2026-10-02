import { createHash, randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { type EditorDocumentData, validateDocument } from "../EditorDocument";
import { writeMap } from "../MapWriter";

const MAP_NAME = /^[a-z][a-z0-9_]{0,47}$/;
const MAX_SOURCE_BYTES = 4 * 1024 * 1024;

export class MapInputError extends Error {}
export class MapConflictError extends Error {}

export interface SavedMap {
  name: string;
  revision: number;
  source: string;
  sidecar: EditorDocumentData | null;
  sourceHash: string;
}

interface CurrentPointer {
  revision: number;
  snapshot: string;
  sourceHash: string;
}

export function validateMapName(name: string): void {
  if (!MAP_NAME.test(name))
    throw new MapInputError("Map name must be 1–48 lowercase letters, digits, or underscores, starting with a letter");
}

/** Immutable revisions behind one atomically replaced current pointer. */
export class MapStore {
  private readonly pending = new Map<string, Promise<unknown>>();

  constructor(readonly root: string) {}

  async init(): Promise<void> {
    await mkdir(this.root, { recursive: true });
  }

  private mapRoot(name: string): string {
    validateMapName(name);
    return path.join(this.root, name);
  }

  private async pointer(name: string): Promise<CurrentPointer | null> {
    try {
      const parsed = JSON.parse(
        await readFile(path.join(this.mapRoot(name), "current.json"), "utf8"),
      ) as CurrentPointer;
      if (
        !Number.isSafeInteger(parsed.revision) ||
        parsed.revision < 1 ||
        !/^[a-f0-9-]{36}$/.test(parsed.snapshot) ||
        !/^[a-f0-9]{64}$/.test(parsed.sourceHash)
      )
        throw new Error("Invalid saved map pointer");
      return parsed;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }

  async list(): Promise<Array<Pick<SavedMap, "name" | "revision" | "sourceHash">>> {
    const entries = await readdir(this.root, { withFileTypes: true });
    const maps: Array<Pick<SavedMap, "name" | "revision" | "sourceHash">> = [];
    for (const entry of entries) {
      if (!entry.isDirectory() || !MAP_NAME.test(entry.name)) continue;
      const pointer = await this.pointer(entry.name);
      if (pointer) maps.push({ name: entry.name, revision: pointer.revision, sourceHash: pointer.sourceHash });
    }
    return maps.sort((a, b) => a.name.localeCompare(b.name));
  }

  async load(name: string): Promise<SavedMap | null> {
    const pointer = await this.pointer(name);
    if (!pointer) return null;
    const snapshotRoot = path.join(this.mapRoot(name), "revisions", pointer.snapshot);
    const source = await readFile(path.join(snapshotRoot, "source.map"), "utf8");
    const sourceHash = createHash("sha256").update(source).digest("hex");
    if (sourceHash !== pointer.sourceHash) throw new Error("Saved map source hash does not match its pointer");
    let sidecar: EditorDocumentData | null = null;
    try {
      sidecar = JSON.parse(await readFile(path.join(snapshotRoot, "editor.json"), "utf8")) as EditorDocumentData;
      validateDocument(sidecar);
      if (writeMap(sidecar) !== source) throw new Error("Saved editor sidecar does not match source");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    return { name, revision: pointer.revision, source, sidecar, sourceHash };
  }

  async save(
    name: string,
    source: string,
    expectedRevision: number,
    sidecar: EditorDocumentData | null = null,
  ): Promise<SavedMap> {
    validateMapName(name);
    if (typeof source !== "string" || !source.trim() || Buffer.byteLength(source, "utf8") > MAX_SOURCE_BYTES) {
      throw new MapInputError("Map source must contain 1–4194304 UTF-8 bytes");
    }
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0)
      throw new MapInputError("Invalid expected revision");
    const snapshotSidecar = sidecar === null ? null : structuredClone(sidecar);
    if (snapshotSidecar !== null) {
      try {
        validateDocument(snapshotSidecar);
        if (writeMap(snapshotSidecar) !== source) throw new Error("Editor sidecar does not match source");
      } catch (error) {
        throw new MapInputError(error instanceof Error ? error.message : String(error));
      }
    }
    const previous = this.pending.get(name) ?? Promise.resolve();
    const operation = previous
      .catch(() => undefined)
      .then(() => this.saveLocked(name, source, expectedRevision, snapshotSidecar));
    this.pending.set(name, operation);
    try {
      return await operation;
    } finally {
      if (this.pending.get(name) === operation) this.pending.delete(name);
    }
  }

  private async saveLocked(
    name: string,
    source: string,
    expectedRevision: number,
    sidecar: EditorDocumentData | null,
  ): Promise<SavedMap> {
    const mapRoot = this.mapRoot(name);
    const current = await this.pointer(name);
    if ((current?.revision ?? 0) !== expectedRevision)
      throw new MapConflictError(`Map revision is ${current?.revision ?? 0}; expected ${expectedRevision}`);
    const revision = expectedRevision + 1;
    const snapshot = randomUUID();
    const sourceHash = createHash("sha256").update(source).digest("hex");
    const revisionsRoot = path.join(mapRoot, "revisions");
    const staging = path.join(mapRoot, `.staging-${snapshot}`);
    const snapshotRoot = path.join(revisionsRoot, snapshot);
    const pointerTemp = path.join(mapRoot, `.current-${snapshot}.tmp`);
    await mkdir(revisionsRoot, { recursive: true });
    try {
      await mkdir(staging);
      await writeFile(path.join(staging, "source.map"), source, "utf8");
      if (sidecar) await writeFile(path.join(staging, "editor.json"), JSON.stringify(sidecar), "utf8");
      await rename(staging, snapshotRoot);
      await writeFile(pointerTemp, JSON.stringify({ revision, snapshot, sourceHash } satisfies CurrentPointer), "utf8");
      await rename(pointerTemp, path.join(mapRoot, "current.json"));
    } finally {
      await rm(staging, { recursive: true, force: true });
      await rm(pointerTemp, { force: true });
    }
    return { name, revision, source, sidecar, sourceHash };
  }
}
