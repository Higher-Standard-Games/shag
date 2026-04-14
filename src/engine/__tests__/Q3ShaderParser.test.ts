/**
 * Q3ShaderParser Tests
 *
 * Tests the Quake 3 / Warsow shader file parser — the most critical
 * rendering subsystem. Shader parsing errors break all game visuals.
 */

import { describe, expect, it } from "vitest";
import { parseShaderFile } from "../loader/shader/Q3ShaderParser";

describe("Q3ShaderParser", () => {
  // ── Basic Parsing ─────────────────────────────────────────

  describe("basic parsing", () => {
    it("parses empty content", () => {
      expect(parseShaderFile("")).toEqual([]);
    });

    it("parses a minimal shader", () => {
      const content = `textures/base/floor
{
  {
    map textures/base/floor.tga
  }
}`;
      const shaders = parseShaderFile(content);
      expect(shaders).toHaveLength(1);
      expect(shaders[0].name).toBe("textures/base/floor");
      expect(shaders[0].stages).toHaveLength(1);
      expect(shaders[0].stages[0].map).toBe("textures/base/floor.tga");
    });

    it("lowercases shader names", () => {
      const content = `Textures/Base/FLOOR
{
  {
    map textures/base/floor.tga
  }
}`;
      const shaders = parseShaderFile(content);
      expect(shaders[0].name).toBe("textures/base/floor");
    });

    it("parses multiple shaders from one file", () => {
      const content = `textures/base/floor
{
  {
    map textures/base/floor.tga
  }
}
textures/base/wall
{
  {
    map textures/base/wall.tga
  }
}
textures/base/ceiling
{
  {
    map textures/base/ceiling.tga
  }
}`;
      const shaders = parseShaderFile(content);
      expect(shaders).toHaveLength(3);
      expect(shaders[0].name).toBe("textures/base/floor");
      expect(shaders[1].name).toBe("textures/base/wall");
      expect(shaders[2].name).toBe("textures/base/ceiling");
    });
  });

  // ── Comments ──────────────────────────────────────────────

  describe("comments", () => {
    it("skips line comments", () => {
      const content = `// This is a comment
textures/base/floor
{
  // Another comment
  {
    map textures/base/floor.tga // inline comment
  }
}`;
      const shaders = parseShaderFile(content);
      expect(shaders).toHaveLength(1);
      expect(shaders[0].stages[0].map).toBe("textures/base/floor.tga");
    });

    it("skips block comments", () => {
      const content = `/* Block comment */
textures/base/floor
{
  /* multi
     line
     comment */
  {
    map textures/base/floor.tga
  }
}`;
      const shaders = parseShaderFile(content);
      expect(shaders).toHaveLength(1);
    });
  });

  // ── Surface Parms ─────────────────────────────────────────

  describe("surfaceParms", () => {
    it("parses single surfaceparm", () => {
      const content = `textures/base/glass
{
  surfaceparm trans
  {
    map textures/base/glass.tga
  }
}`;
      const shaders = parseShaderFile(content);
      expect(shaders[0].surfaceParms.has("trans")).toBe(true);
    });

    it("parses multiple surfaceparms", () => {
      const content = `textures/base/glass
{
  surfaceparm trans
  surfaceparm nolightmap
  surfaceparm nonsolid
  {
    map textures/base/glass.tga
  }
}`;
      const shaders = parseShaderFile(content);
      expect(shaders[0].surfaceParms.size).toBe(3);
      expect(shaders[0].surfaceParms.has("trans")).toBe(true);
      expect(shaders[0].surfaceParms.has("nolightmap")).toBe(true);
      expect(shaders[0].surfaceParms.has("nonsolid")).toBe(true);
    });
  });

  // ── Cull Modes ────────────────────────────────────────────

  describe("cull modes", () => {
    it("defaults to back culling", () => {
      const content = `textures/base/floor
{
  {
    map textures/base/floor.tga
  }
}`;
      const shaders = parseShaderFile(content);
      expect(shaders[0].cull).toBe("back");
    });

    it("parses cull none", () => {
      const content = `textures/base/glass
{
  cull none
  {
    map textures/base/glass.tga
  }
}`;
      expect(parseShaderFile(content)[0].cull).toBe("none");
    });

    it("parses cull disable", () => {
      const content = `textures/base/glass
{
  cull disable
  {
    map textures/base/glass.tga
  }
}`;
      expect(parseShaderFile(content)[0].cull).toBe("none");
    });

    it("parses cull front", () => {
      const content = `textures/base/glass
{
  cull front
  {
    map textures/base/glass.tga
  }
}`;
      expect(parseShaderFile(content)[0].cull).toBe("front");
    });
  });

  // ── Shader Flags ──────────────────────────────────────────

  describe("shader flags", () => {
    it("parses nomipmaps", () => {
      const content = `textures/hud/crosshair
{
  nomipmaps
  {
    map textures/hud/crosshair.tga
  }
}`;
      expect(parseShaderFile(content)[0].nomipmaps).toBe(true);
    });

    it("parses nopicmip", () => {
      const content = `textures/hud/font
{
  nopicmip
  {
    map textures/hud/font.tga
  }
}`;
      expect(parseShaderFile(content)[0].nopicmip).toBe(true);
    });

    it("parses polygonOffset", () => {
      const content = `textures/base/decal
{
  polygonoffset
  {
    map textures/base/decal.tga
  }
}`;
      expect(parseShaderFile(content)[0].polygonOffset).toBe(true);
    });

    it("parses sort directive", () => {
      const content = `textures/base/glass
{
  sort 9
  {
    map textures/base/glass.tga
  }
}`;
      expect(parseShaderFile(content)[0].sort).toBe(9);
    });
  });

  // ── Blend Functions ───────────────────────────────────────

  describe("blendFunc", () => {
    it("parses add preset", () => {
      const content = `textures/effects/glow
{
  {
    map textures/effects/glow.tga
    blendFunc add
  }
}`;
      const stage = parseShaderFile(content)[0].stages[0];
      expect(stage.blendFunc).toEqual(["GL_ONE", "GL_ONE"]);
    });

    it("parses blend preset", () => {
      const content = `textures/effects/smoke
{
  {
    map textures/effects/smoke.tga
    blendFunc blend
  }
}`;
      const stage = parseShaderFile(content)[0].stages[0];
      expect(stage.blendFunc).toEqual(["GL_SRC_ALPHA", "GL_ONE_MINUS_SRC_ALPHA"]);
    });

    it("parses filter preset", () => {
      const content = `textures/effects/filter
{
  {
    map textures/effects/filter.tga
    blendFunc filter
  }
}`;
      const stage = parseShaderFile(content)[0].stages[0];
      expect(stage.blendFunc).toEqual(["GL_DST_COLOR", "GL_ZERO"]);
    });

    it("parses two-parameter blendFunc", () => {
      const content = `textures/effects/custom
{
  {
    map textures/effects/custom.tga
    blendFunc GL_SRC_ALPHA GL_ONE
  }
}`;
      const stage = parseShaderFile(content)[0].stages[0];
      expect(stage.blendFunc).toEqual(["GL_SRC_ALPHA", "GL_ONE"]);
    });
  });

  // ── Alpha Functions ───────────────────────────────────────

  describe("alphaFunc", () => {
    it("parses GT0", () => {
      const content = `textures/base/grate
{
  {
    map textures/base/grate.tga
    alphaFunc GT0
  }
}`;
      expect(parseShaderFile(content)[0].stages[0].alphaFunc).toBe("GT0");
    });

    it("parses GE128", () => {
      const content = `textures/base/fence
{
  {
    map textures/base/fence.tga
    alphaFunc GE128
  }
}`;
      expect(parseShaderFile(content)[0].stages[0].alphaFunc).toBe("GE128");
    });
  });

  // ── tcMod ─────────────────────────────────────────────────

  describe("tcMod", () => {
    it("parses scroll", () => {
      const content = `textures/base/water
{
  {
    map textures/base/water.tga
    tcMod scroll 0.5 0.2
  }
}`;
      const stage = parseShaderFile(content)[0].stages[0];
      expect(stage.tcMod).toHaveLength(1);
      expect(stage.tcMod![0].type).toBe("scroll");
      if (stage.tcMod![0].type === "scroll") {
        expect(stage.tcMod![0].sSpeed).toBe(0.5);
        expect(stage.tcMod![0].tSpeed).toBe(0.2);
      }
    });

    it("parses rotate", () => {
      const content = `textures/base/fan
{
  {
    map textures/base/fan.tga
    tcMod rotate 90
  }
}`;
      const stage = parseShaderFile(content)[0].stages[0];
      expect(stage.tcMod![0].type).toBe("rotate");
      if (stage.tcMod![0].type === "rotate") {
        expect(stage.tcMod![0].degreesPerSecond).toBe(90);
      }
    });

    it("parses scale", () => {
      const content = `textures/base/tile
{
  {
    map textures/base/tile.tga
    tcMod scale 2 2
  }
}`;
      const stage = parseShaderFile(content)[0].stages[0];
      expect(stage.tcMod![0].type).toBe("scale");
      if (stage.tcMod![0].type === "scale") {
        expect(stage.tcMod![0].sScale).toBe(2);
        expect(stage.tcMod![0].tScale).toBe(2);
      }
    });
  });

  // ── animMap ───────────────────────────────────────────────

  describe("animMap", () => {
    it("parses animated texture sequence", () => {
      const content = `textures/base/light_flicker
{
  {
    animMap 5 textures/base/light_on.tga textures/base/light_off.tga
  }
}`;
      const stage = parseShaderFile(content)[0].stages[0];
      expect(stage.animMap).toBeDefined();
      expect(stage.animMap!.frequency).toBe(5);
      expect(stage.animMap!.frames).toEqual(["textures/base/light_on.tga", "textures/base/light_off.tga"]);
      // First frame used as default map
      expect(stage.map).toBe("textures/base/light_on.tga");
    });
  });

  // ── rgbGen ────────────────────────────────────────────────

  describe("rgbGen", () => {
    it("parses identity", () => {
      const content = `textures/base/floor
{
  {
    map textures/base/floor.tga
    rgbGen identity
  }
}`;
      expect(parseShaderFile(content)[0].stages[0].rgbGen?.type).toBe("identity");
    });

    it("parses vertex", () => {
      const content = `textures/base/floor
{
  {
    map textures/base/floor.tga
    rgbGen vertex
  }
}`;
      expect(parseShaderFile(content)[0].stages[0].rgbGen?.type).toBe("vertex");
    });
  });

  // ── Depth ─────────────────────────────────────────────────

  describe("depth", () => {
    it("parses depthWrite", () => {
      const content = `textures/base/floor
{
  {
    map textures/base/floor.tga
    depthWrite
  }
}`;
      expect(parseShaderFile(content)[0].stages[0].depthWrite).toBe(true);
    });

    it("parses depthFunc equal", () => {
      const content = `textures/base/floor
{
  {
    map textures/base/floor.tga
    depthFunc equal
  }
}`;
      expect(parseShaderFile(content)[0].stages[0].depthFunc).toBe("equal");
    });
  });

  // ── Sky ───────────────────────────────────────────────────

  describe("skyParms", () => {
    it("parses skyParms with farbox", () => {
      const content = `textures/skies/blue
{
  surfaceparm sky
  skyparms env/bluesky 200 -
  {
    map $whiteimage
  }
}`;
      const shader = parseShaderFile(content)[0];
      expect(shader.surfaceParms.has("sky")).toBe(true);
      expect(shader.skyParms).toBeDefined();
      expect(shader.skyParms!.farbox).toBe("env/bluesky");
      expect(shader.skyParms!.cloudHeight).toBe(200);
      expect(shader.skyParms!.nearbox).toBe("");
    });
  });

  // ── Fog ───────────────────────────────────────────────────

  describe("fogParms", () => {
    it("parses fogParms with parenthesized color", () => {
      const content = `textures/fog/mist
{
  fogparms ( 0.5 0.5 0.5 ) 512
  {
    map $whiteimage
  }
}`;
      const shader = parseShaderFile(content)[0];
      expect(shader.fogParms).toBeDefined();
      expect(shader.fogParms!.color).toEqual([0.5, 0.5, 0.5]);
      expect(shader.fogParms!.depthForOpaque).toBe(512);
    });
  });

  // ── deformVertexes ────────────────────────────────────────

  describe("deformVertexes", () => {
    it("parses autosprite", () => {
      const content = `textures/effects/spark
{
  deformvertexes autosprite
  {
    map textures/effects/spark.tga
    blendFunc add
  }
}`;
      const shader = parseShaderFile(content)[0];
      expect(shader.deformVertexes).toBeDefined();
      expect(shader.deformVertexes![0].type).toBe("autosprite");
    });

    it("parses autosprite2", () => {
      const content = `textures/effects/beam
{
  deformvertexes autosprite2
  {
    map textures/effects/beam.tga
  }
}`;
      const shader = parseShaderFile(content)[0];
      expect(shader.deformVertexes![0].type).toBe("autosprite2");
    });
  });

  // ── Multiple Stages ───────────────────────────────────────

  describe("multiple stages", () => {
    it("parses shader with lightmap stage", () => {
      const content = `textures/base/brick
{
  {
    map textures/base/brick.tga
  }
  {
    map $lightmap
    blendFunc filter
  }
}`;
      const shader = parseShaderFile(content)[0];
      expect(shader.stages).toHaveLength(2);
      expect(shader.stages[0].map).toBe("textures/base/brick.tga");
      expect(shader.stages[1].map).toBe("$lightmap");
      expect(shader.stages[1].blendFunc).toEqual(["GL_DST_COLOR", "GL_ZERO"]);
    });
  });

  // ── clampMap ──────────────────────────────────────────────

  describe("clampMap", () => {
    it("sets clampMap flag", () => {
      const content = `textures/hud/icon
{
  {
    clampmap textures/hud/icon.tga
  }
}`;
      const stage = parseShaderFile(content)[0].stages[0];
      expect(stage.map).toBe("textures/hud/icon.tga");
      expect(stage.clampMap).toBe(true);
    });
  });

  // ── tcGen ─────────────────────────────────────────────────

  describe("tcGen", () => {
    it("parses environment mapping", () => {
      const content = `textures/base/chrome
{
  {
    map textures/base/chrome.tga
    tcGen environment
  }
}`;
      expect(parseShaderFile(content)[0].stages[0].tcGen?.mode).toBe("environment");
    });
  });
});
