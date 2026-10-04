import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { EditorDocumentData } from "../EditorDocument";
import { BUILD_QUALITIES, isBuildQuality } from "./BuildRecipe";
import type { CompileJobs } from "./CompileJobs";
import { MapConflictError, MapInputError, type MapStore } from "./MapStore";
import type { ShaggedServerConfig } from "./ServerConfig";

const MAX_BODY_BYTES = 8 * 1024 * 1024;

function json(response: ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  response.end(JSON.stringify(value));
}

async function body(request: IncomingMessage): Promise<unknown> {
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  let size = 0;
  for await (const part of request) {
    const chunk = Buffer.isBuffer(part) ? part : Buffer.from(part);
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new MapInputError("Request body exceeds 8 MiB");
    chunks.push(Uint8Array.from(chunk));
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  } catch {
    throw new MapInputError("Request body must be JSON");
  }
}

export function createShaggedHttpServer(store: MapStore, config: ShaggedServerConfig, jobs?: CompileJobs): Server {
  return createServer((request, response) => {
    void (async () => {
      const origin = request.headers.origin;
      if (origin && !config.uiOrigins.includes(origin)) {
        json(response, 403, { error: "UI origin is not allowed" });
        return;
      }
      if (origin) {
        response.setHeader("access-control-allow-origin", origin);
        response.setHeader("vary", "Origin");
        response.setHeader("access-control-allow-methods", "GET, PUT, POST, OPTIONS");
        response.setHeader("access-control-allow-headers", "Content-Type");
      }
      if (request.method === "OPTIONS") {
        response.writeHead(204);
        response.end();
        return;
      }
      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      if (url.pathname === "/api/status" && request.method === "GET") {
        json(response, 200, {
          saveAvailable: true,
          compilerAvailable: jobs?.available ?? false,
          playableAvailable: jobs?.playableAvailable ?? false,
          supportedQualities: jobs?.available ? BUILD_QUALITIES : [],
          reason: jobs?.available ? null : (jobs?.unavailableReason ?? "Compile jobs are not connected yet"),
        });
        return;
      }
      if (url.pathname === "/api/maps" && request.method === "GET") {
        json(response, 200, { maps: await store.list() });
        return;
      }
      const match = /^\/api\/maps\/([^/]+)$/.exec(url.pathname);
      if (match && request.method === "GET") {
        const map = await store.load(match[1]);
        json(response, map ? 200 : 404, map ?? { error: "Map not found" });
        return;
      }
      if (match && request.method === "PUT") {
        const value = await body(request);
        if (!value || typeof value !== "object") throw new MapInputError("Expected a map save object");
        const input = value as { source?: unknown; expectedRevision?: unknown; sidecar?: unknown };
        if (typeof input.source !== "string" || typeof input.expectedRevision !== "number") {
          throw new MapInputError("Expected source text and numeric expectedRevision");
        }
        const sidecar =
          input.sidecar === undefined || input.sidecar === null ? null : (input.sidecar as EditorDocumentData);
        const saved = await store.save(match[1], input.source, input.expectedRevision, sidecar);
        json(response, 200, { name: saved.name, revision: saved.revision, sourceHash: saved.sourceHash });
        return;
      }
      const compile = /^\/api\/maps\/([^/]+)\/compile$/.exec(url.pathname);
      if (compile && request.method === "POST") {
        if (!jobs?.available) {
          json(response, 503, { error: jobs?.unavailableReason ?? "Compiler is unavailable" });
          return;
        }
        const value = await body(request);
        if (!value || typeof value !== "object") throw new MapInputError("Expected a compile request object");
        const input = value as { revision?: unknown; quality?: unknown };
        const quality = input.quality ?? jobs.defaultQuality;
        if (!Number.isSafeInteger(input.revision) || !isBuildQuality(quality)) {
          throw new MapInputError("Expected a saved revision and supported quality");
        }
        const job = await jobs.request(compile[1], input.revision as number, quality);
        json(response, 202, { jobId: job.id, state: job.state, revision: job.revision });
        return;
      }
      const jobMatch = /^\/api\/compiles\/([a-f0-9-]{36})$/.exec(url.pathname);
      if (jobMatch && request.method === "GET") {
        const job = jobs?.get(jobMatch[1]);
        json(response, job ? 200 : 404, job ?? { error: "Compile job not found" });
        return;
      }
      json(response, 404, { error: "Unknown SHAGGED endpoint" });
    })().catch((error: unknown) => {
      if (response.headersSent) {
        response.destroy();
        return;
      }
      const status = error instanceof MapConflictError ? 409 : error instanceof MapInputError ? 400 : 500;
      json(response, status, { error: status === 500 ? "SHAGGED server error" : String((error as Error).message) });
    });
  });
}
