/**
 * SHAGGED MCP server (stdio): lets AI clients build Washoi maps through the
 * same typed operations, compile pipeline and report as the `shagged` CLI.
 *
 *   npm run shagged:mcp
 *
 * Maps are documents under server-data/shagged/agent/<mapName>.json, and open
 * in the in-engine editor once compiled (Server Open). See
 * docs/manual/guides/shagged-api.md and docs/research/SHAGGED_API.md.
 */

// stdout carries the protocol. Everything else that logs (map, bot and
// compiler code) goes to stderr, before any of it is imported.
console.log = console.error;
console.info = console.error;
console.debug = console.error;

import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { applyOperations, type EditOp, emptyDocument, OperationError } from "../engine/editor/api/Operations";
import { type EditorDocumentData, migrateDocument, validateDocument } from "../engine/editor/EditorDocument";
import { BRUSH_ENTITY_CLASSES, EDITOR_POINT_CLASSES } from "../engine/editor/EntityCatalog";
import { createRoomTemplate } from "../engine/editor/RoomTemplate";
import {
  compileDocument,
  describeDocument,
  healthOf,
  mapReport,
  PipelineError,
} from "../engine/editor/server/AgentPipeline";

const ROOT = path.resolve("server-data/shagged/agent");
const GUIDE = path.resolve("docs/manual/guides/shagged-api.md");
const MAP_NAME = z
  .string()
  .regex(/^[a-z][a-z0-9_]{0,47}$/, "1–48 lowercase letters, digits or underscores, starting with a letter")
  .describe("Map ID, e.g. arena1. Also the name to play it with: map <mapName>.");
const QUALITY = z.enum(["fast", "default", "release"]).optional().describe("Compile quality. Default fast.");

const docPath = (mapName: string) => path.join(ROOT, `${mapName}.json`);

function load(mapName: string): EditorDocumentData {
  const file = docPath(mapName);
  if (!existsSync(file)) throw new PipelineError(`no map "${mapName}"; create it with shagged_new_map`);
  const doc = migrateDocument(JSON.parse(readFileSync(file, "utf8")));
  validateDocument(doc);
  return doc;
}

/** Write via a temporary file, so a crash never leaves half a document. */
function save(doc: EditorDocumentData): void {
  mkdirSync(ROOT, { recursive: true });
  const file = docPath(doc.mapName!);
  writeFileSync(`${file}.tmp`, `${JSON.stringify(doc, null, 2)}\n`);
  renameSync(`${file}.tmp`, file);
}

/** One edit at a time per map, so parallel tool calls cannot interleave read-modify-write. */
const locks = new Map<string, Promise<unknown>>();
function exclusive<T>(mapName: string, work: () => Promise<T> | T): Promise<T> {
  const previous = locks.get(mapName) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(work);
  locks.set(mapName, next);
  return next;
}

type ToolResult = { content: Array<{ type: "text"; text: string }>; isError?: boolean };

/** Run a tool body; results and errors both come back as JSON text the model can read. */
async function run(work: () => Promise<unknown> | unknown): Promise<ToolResult> {
  try {
    return { content: [{ type: "text", text: JSON.stringify(await work(), null, 2) }] };
  } catch (error) {
    const body =
      error instanceof OperationError
        ? { ok: false, error: error.message, index: error.index, operation: error.operation }
        : error instanceof PipelineError
          ? { ok: false, error: error.message, ...error.details }
          : { ok: false, error: error instanceof Error ? error.message : String(error) };
    return { content: [{ type: "text", text: JSON.stringify(body, null, 2) }], isError: true };
  }
}

const server = new McpServer({ name: "shagged", version: "0.1.0" });

server.registerResource(
  "guide",
  "shagged://guide",
  {
    title: "SHAGGED scripting guide",
    description:
      "Coordinates, every operation with its fields, a worked example, mapping rules and how to read the report.",
    mimeType: "text/markdown",
  },
  async (uri) => ({ contents: [{ uri: uri.href, mimeType: "text/markdown", text: readFileSync(GUIDE, "utf8") }] }),
);

server.registerTool(
  "shagged_guide",
  {
    title: "Read the mapping guide",
    description:
      "Returns the SHAGGED scripting guide: Quake coordinates (Z up), every operation and its fields, a worked two-room example, the mapping rules (player size, step and jump height, sealing, lights, spawns) and how to read the report. Read it before building a map.",
    annotations: { readOnlyHint: true },
  },
  async () => run(() => readFileSync(GUIDE, "utf8")),
);

server.registerTool(
  "shagged_new_map",
  {
    title: "Create a map",
    description:
      'Creates an empty map document, or the sealed 512×512×256 test room with a spawn and a light (template "room").',
    inputSchema: {
      mapName: MAP_NAME,
      template: z.enum(["empty", "room"]).optional().describe("Default empty."),
      replace: z.boolean().optional().describe("Replace an existing map of this name. Default false."),
    },
  },
  async ({ mapName, template, replace }) =>
    run(() =>
      exclusive(mapName, () => {
        if (existsSync(docPath(mapName)) && !replace)
          throw new PipelineError(`map "${mapName}" exists; pass replace: true to start over`);
        const doc = template === "room" ? createRoomTemplate() : emptyDocument();
        doc.mapName = mapName;
        validateDocument(doc);
        save(doc);
        return describeDocument(doc);
      }),
    ),
);

server.registerTool(
  "shagged_list_maps",
  {
    title: "List maps",
    description: "Lists the map documents this server manages.",
    annotations: { readOnlyHint: true },
  },
  async () =>
    run(() => ({
      maps: existsSync(ROOT)
        ? readdirSync(ROOT)
            .filter((f) => f.endsWith(".json"))
            .map((f) => f.slice(0, -5))
        : [],
    })),
);

server.registerTool(
  "shagged_map_info",
  {
    title: "Describe a map",
    description:
      "Counts, bounds and entity classes; with objects: true, every brush and entity with its ID, bounds or origin.",
    inputSchema: { mapName: MAP_NAME, objects: z.boolean().optional() },
    annotations: { readOnlyHint: true },
  },
  async ({ mapName, objects }) => run(() => describeDocument(load(mapName), objects ?? false)),
);

server.registerTool(
  "shagged_apply",
  {
    title: "Edit a map",
    description: [
      "Applies a batch of operations as one all-or-nothing transaction and saves the map. An error names the failing operation and changes nothing.",
      "Operations (fields in the guide): box.create, box.update, face.material, entity.place, entity.update, brushEntity.assign, object.move, object.duplicate, object.delete, gen.room, gen.corridor.",
      "Coordinates are Quake units with Z up. Returns created, changed and deleted IDs and Map Health issues.",
      "Use dryRun: true to preview without saving.",
    ].join(" "),
    inputSchema: {
      mapName: MAP_NAME,
      ops: z
        .array(z.object({ op: z.string().describe("Operation name, e.g. gen.room") }).passthrough())
        .min(1)
        .describe("Operations in order; each is an object with op and its fields."),
      dryRun: z.boolean().optional(),
    },
  },
  async ({ mapName, ops, dryRun }) =>
    run(() =>
      exclusive(mapName, () => {
        const result = applyOperations(load(mapName), ops as unknown as EditOp[]);
        if (!dryRun) save(result.doc);
        return {
          ok: true,
          dryRun: dryRun ?? false,
          revision: result.doc.revision,
          created: result.created,
          changed: result.changed,
          deleted: result.deleted,
          issues: result.issues,
        };
      }),
    ),
);

server.registerTool(
  "shagged_health",
  {
    title: "Check map health",
    description:
      "Map Health issues without compiling: missing spawns or required keys, broken target links, duplicate targetnames, unknown classes or shaders. Each names the object ID.",
    inputSchema: { mapName: MAP_NAME },
    annotations: { readOnlyHint: true },
  },
  async ({ mapName }) => run(() => healthOf(load(mapName))),
);

server.registerTool(
  "shagged_compile",
  {
    title: "Compile a map",
    description:
      "Compiles with MakeBSP and MakeLight and publishes a playable package (play it with: map <mapName>). Reports leaks. An unchanged map reuses its last build.",
    inputSchema: { mapName: MAP_NAME, quality: QUALITY },
  },
  async ({ mapName, quality }) => run(() => exclusive(mapName, () => compileDocument(load(mapName), quality))),
);

server.registerTool(
  "shagged_report",
  {
    title: "Check a map end to end",
    description:
      "Map Health, then compile, then reachability from the bots' navigation graph of the compiled map: items some spawn cannot reach and spawns cut off from others, in Quake coordinates with the editor object ID. ok: true means all three passed.",
    inputSchema: { mapName: MAP_NAME, quality: QUALITY },
  },
  async ({ mapName, quality }) => run(() => exclusive(mapName, () => mapReport(load(mapName), quality))),
);

server.registerTool(
  "shagged_entity_classes",
  {
    title: "Find entity classes",
    description:
      "Entity classes the game understands, with their documented keys (required ones marked). Point classes go in entity.place, brush classes in brushEntity.assign.",
    inputSchema: {
      search: z
        .string()
        .optional()
        .describe("Filter by text in the classname or section, e.g. weapon, spawn, trigger."),
    },
    annotations: { readOnlyHint: true },
  },
  async ({ search }) =>
    run(() => {
      const needle = search?.toLowerCase() ?? "";
      const describe = (kind: "point" | "brush") => (c: (typeof EDITOR_POINT_CLASSES)[number]) => ({
        classname: c.classname,
        kind,
        section: c.section,
        keys: c.keys.map((k) => ({
          name: k.name,
          label: k.label,
          default: k.defaultValue,
          required: k.required ?? false,
        })),
      });
      return [...EDITOR_POINT_CLASSES.map(describe("point")), ...BRUSH_ENTITY_CLASSES.map(describe("brush"))].filter(
        (c) => !needle || c.classname.toLowerCase().includes(needle) || c.section.toLowerCase().includes(needle),
      );
    }),
);

await server.connect(new StdioServerTransport());
console.error(`[shagged-mcp] ready; maps in ${ROOT}`);
