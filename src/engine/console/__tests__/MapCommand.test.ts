import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Cvar } from "../../core/Cvar";
import { clearGameplayMapLauncher, registerGameplayMapLauncher } from "../GameplayMapLauncher";
import { CommandRegistry } from "../CommandRegistry";
import MapCommand from "../commands/MapCommand";

describe("MapCommand", () => {
  beforeEach(() => {
    clearGameplayMapLauncher();
    Cvar.register("developer", 0, { type: "int", persist: false });
  });

  afterEach(() => {
    clearGameplayMapLauncher();
    CommandRegistry.getInstance().unregister("map");
    Cvar.set("developer", 0);
  });

  it("is developer-only and is gated by CommandRegistry", async () => {
    const registry = CommandRegistry.getInstance();
    registry.register(new MapCommand());

    await expect(registry.execute("map wdm2")).resolves.toBe("Command 'map' requires developer mode");
  });

  it("returns a clear error when no gameplay launcher is registered", async () => {
    const command = new MapCommand();

    await expect(command.execute(["wdm2"])).resolves.toBe(
      "No gameplay map launcher registered. Use bsp commands for map inspection.",
    );
  });

  it("launches with duel as the default gametype and can reload", async () => {
    const launch = vi.fn().mockResolvedValue({
      serverUrl: "ws://localhost:7777",
      map: "wdm2",
      gametype: "duel",
      matchId: "m_1",
    });
    registerGameplayMapLauncher({ launch, unload: vi.fn() });
    const command = new MapCommand();

    await expect(command.execute(["wdm2"])).resolves.toBe("Launched wdm2 (duel) on ws://localhost:7777");
    await command.execute(["reload"]);

    expect(launch).toHaveBeenNthCalledWith(1, "wdm2", "duel");
    expect(launch).toHaveBeenNthCalledWith(2, "wdm2", "duel");
  });

  it("unloads through the registered launcher", async () => {
    const unload = vi.fn();
    registerGameplayMapLauncher({
      launch: vi.fn().mockResolvedValue({ serverUrl: "ws://localhost:7777", map: "wdm2", gametype: "tdm" }),
      unload,
    });
    const command = new MapCommand();

    await command.execute(["unload"]);

    expect(unload).toHaveBeenCalledTimes(1);
  });
});
