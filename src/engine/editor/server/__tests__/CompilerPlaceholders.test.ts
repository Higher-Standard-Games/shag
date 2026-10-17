import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { CompileTranscript, emptyDiagnostics } from "../CompileDiagnostics";
import { assertNoVisiblePlaceholder } from "../CompilerPlaceholders";

it("retains the collision placeholder warning while still rejecting missing assets and visible placeholders", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "shagged-placeholder-"));
  try {
    const diagnostics = emptyDiagnostics();
    const transcript = new CompileTranscript(path.join(root, "compile.log"), diagnostics, []);
    transcript.append("WARNING: Missing image for material: noshader\n");
    expect(diagnostics).toMatchObject({ warnings: 1, missingAssets: 0, compilerPlaceholders: 1 });
    transcript.append(
      "WARNING: Missing image for material: textures/noshader\nWARNING: Missing image for material: textures/missing\n",
    );
    transcript.flush();
    expect(diagnostics.missingAssets).toBe(2);
    const textures = [{ name: "noshader", contentFlags: 1, surfaceFlags: 0 }];
    expect(() => assertNoVisiblePlaceholder({ textures, faces: [] })).not.toThrow();
    expect(() => assertNoVisiblePlaceholder({ textures, faces: [{ textureIndex: 0 } as never] })).toThrow(
      /publication blocked/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
