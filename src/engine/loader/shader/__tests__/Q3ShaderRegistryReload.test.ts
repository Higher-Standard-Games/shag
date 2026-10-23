import { afterEach, describe, expect, it, vi } from "vitest";
import { PK3Loader } from "../../pk3/PK3Loader";
import { Q3ShaderRegistry } from "../Q3ShaderRegistry";

const script = (name: string) =>
  new TextEncoder().encode(`${name}\n{\n  {\n    map ${name}.png\n    blendFunc add\n  }\n}\n`).buffer;

function fakeFilesystem(files: Record<string, ArrayBuffer>) {
  const fs = { revision: 1, files, gate: null as Promise<void> | null };
  vi.spyOn(PK3Loader, "getInstance").mockReturnValue({
    getFilesystemRevision: () => fs.revision,
    listFiles: () => Object.keys(fs.files),
    getFileOwner: () => "test.pk3",
    hasFile: () => false,
    getFile: async (path: string) => {
      if (fs.gate) await fs.gate;
      return fs.files[path] ?? null;
    },
  } as never);
  return fs;
}

afterEach(() => {
  Q3ShaderRegistry.getInstance().clear();
  vi.restoreAllMocks();
});

describe("Q3 shader script reloads", () => {
  it("keeps the old scripts visible until a reload after a package change completes", async () => {
    const fs = fakeFilesystem({ "scripts/a.shader": script("textures/a") });
    const registry = Q3ShaderRegistry.getInstance();
    await registry.loadShaders();
    expect(registry.hasShader("textures/a")).toBe(true);

    // A package mounts mid-map-build; the reload's reads are slow
    fs.revision = 2;
    fs.files["scripts/b.shader"] = script("textures/b");
    let open!: () => void;
    fs.gate = new Promise((resolve) => {
      open = resolve;
    });
    const reload = registry.loadShaders();
    await Promise.resolve();
    expect(registry.hasShader("textures/a")).toBe(true);

    open();
    await reload;
    expect(registry.hasShader("textures/a")).toBe(true);
    expect(registry.hasShader("textures/b")).toBe(true);
  });

  it("re-resolves a surface whose script arrived after it was first resolved", async () => {
    const fs = fakeFilesystem({});
    const registry = Q3ShaderRegistry.getInstance();
    await registry.loadShaders();
    expect(registry.resolveMaterialProps("textures/glow").blendFunc).toBeUndefined();

    fs.files["scripts/glow.shader"] = script("textures/glow");
    await registry.loadShaders();
    expect(registry.resolveMaterialProps("textures/glow").blendFunc).toBeDefined();
  });
});
