import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LobbyServer } from "../LobbyServer";
import type { GametypeInfo } from "../types";

const temporaryDirs: string[] = [];
const servers: LobbyServer[] = [];

afterEach(() => {
  for (const server of servers) (server as unknown as { accounts: { close: () => void } }).accounts.close();
  const tempRoot = path.resolve(os.tmpdir());
  for (const dir of temporaryDirs) {
    const target = path.resolve(dir);
    if (!target.startsWith(`${tempRoot}${path.sep}`) || !path.basename(target).startsWith("shag-amphi-maps-")) {
      throw new Error(`Unsafe test cleanup target: ${target}`);
    }
    fs.rmSync(target, { recursive: true, force: true });
  }
  servers.length = 0;
  temporaryDirs.length = 0;
  vi.restoreAllMocks();
});

describe("Amphi lobby advertisement", () => {
  it("offers only installed Amphi maps and hides the mode when none are present", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "shag-amphi-maps-"));
    temporaryDirs.push(dir);
    const pk3Dir = path.join(dir, "pk3");
    fs.mkdirSync(pk3Dir);
    const manifestPath = path.join(dir, "maps.json");
    fs.writeFileSync(
      manifestPath,
      JSON.stringify({
        wamphi1: { displayName: "Amphitheatre", gametypes: ["amphi"] },
        wda1: { displayName: "Arena One", gametypes: ["amphi"] },
        solamphi1: { displayName: "Relay Yard", gametypes: ["amphi"] },
      }),
    );
    const server = new LobbyServer(0, { onServerExit: undefined, spawn: vi.fn(), shutdownAll: vi.fn() } as never);
    servers.push(server);
    const internal = server as unknown as {
      MAP_CONFIG_PATH: string;
      PK3_DIR: string;
      gametypes: GametypeInfo[];
      _loadMapsConfig: () => void;
    };
    internal.MAP_CONFIG_PATH = manifestPath;
    internal.PK3_DIR = pk3Dir;

    internal._loadMapsConfig();
    expect(internal.gametypes.some((mode) => mode.id === "amphi")).toBe(false);

    fs.writeFileSync(path.join(pk3Dir, "map_wamphi1.pk3"), "fixture name only");
    internal._loadMapsConfig();
    expect(internal.gametypes.find((mode) => mode.id === "amphi")?.mapPool).toEqual(["wamphi1"]);

    fs.writeFileSync(path.join(pk3Dir, "map_solamphi1_00008.pk3"), "fixture name only");
    internal._loadMapsConfig();
    expect(internal.gametypes.find((mode) => mode.id === "amphi")?.mapPool).toEqual(["wamphi1", "solamphi1"]);
  });
});
