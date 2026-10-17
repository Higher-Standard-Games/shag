import type { EditorDocumentData } from "./EditorDocument";

export interface EditorServerStatus {
  saveAvailable: boolean;
  compilerAvailable: boolean;
  playableAvailable: boolean;
  supportedQualities: Array<"fast" | "default" | "release">;
  reason: string | null;
}

export interface EditorCompileJob {
  id: string;
  mapName: string;
  revision: number;
  state: "queued" | "running" | "compiled" | "playable" | "failed";
  stage: string;
  logs: string[];
  runtimeMapName: string | null;
  packageName: string | null;
  bspHash: string | null;
}

export interface ServerMapSummary {
  name: string;
  revision: number;
  sourceHash: string;
}

export interface ServerMapSnapshot extends ServerMapSummary {
  source: string;
  sidecar: EditorDocumentData | null;
}

export class ShaggedApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/** Browser transport only. The server owns map files, revisions and MakeBSP. */
export class ShaggedApi {
  constructor(
    private readonly baseUrl = import.meta.env.VITE_SHAGGED_API_URL ?? "http://127.0.0.1:9010",
    // A wrapper, not window.fetch itself: called as this.fetcher(...) the
    // browser rejects the unbound function with "Illegal invocation".
    private readonly fetcher: typeof fetch = (input, init) => fetch(input, init),
  ) {}

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    let response: Response;
    try {
      response = await this.fetcher(`${this.baseUrl}${path}`, init);
    } catch {
      throw new Error("SHAGGED server is unreachable. Start npm run shagged:server.");
    }
    const body = (await response.json()) as T & { error?: string };
    if (!response.ok)
      throw new ShaggedApiError(body.error ?? `SHAGGED server returned ${response.status}`, response.status);
    return body;
  }

  status(): Promise<EditorServerStatus> {
    return this.request("/api/status");
  }

  async maps(): Promise<ServerMapSummary[]> {
    const result = await this.request<{ maps: ServerMapSummary[] }>("/api/maps");
    return result.maps;
  }

  map(name: string): Promise<ServerMapSnapshot> {
    return this.request(`/api/maps/${encodeURIComponent(name)}`);
  }

  async mapRevision(name: string): Promise<number> {
    try {
      const map = await this.map(name);
      return map.revision;
    } catch (error) {
      if (error instanceof ShaggedApiError && error.status === 404) return 0;
      throw error;
    }
  }

  save(
    name: string,
    source: string,
    expectedRevision: number,
    sidecar: EditorDocumentData,
  ): Promise<{ revision: number }> {
    return this.request(`/api/maps/${encodeURIComponent(name)}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ source, expectedRevision, sidecar }),
    });
  }

  compile(
    name: string,
    revision: number,
    quality: "fast" | "default" | "release" = "default",
    force = false,
  ): Promise<{ jobId: string }> {
    return this.request(`/api/maps/${encodeURIComponent(name)}/compile`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ revision, quality, force }),
    });
  }

  job(id: string): Promise<EditorCompileJob> {
    return this.request(`/api/compiles/${encodeURIComponent(id)}`);
  }
}
