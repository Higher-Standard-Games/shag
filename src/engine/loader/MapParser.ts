export interface Entity {
  classname: string;
  properties: Record<string, string>;
  brushes: Brush[];
  patches: Patch[];
}

export interface Brush {
  planes: PlaneDefinition[];
}

export interface PlaneDefinition {
  p1: number[];
  p2: number[];
  p3: number[];
  texture: string;
  u_offset: number;
  v_offset: number;
  rotation: number;
  u_scale: number;
  v_scale: number;
}

export interface Patch {
  texture: string;
  width: number;
  height: number;
  controlPoints: PatchControlPoint[][];
}

export interface PatchControlPoint {
  x: number;
  y: number;
  z: number;
  u: number;
  v: number;
}

export class MapParser {
  /**
   * Preprocess .map content to normalize NetRadiant format to simpler format.
   * - Removes comments and layer definitions
   * - Converts brushDef { ... } to simple brush format
   * - Removes wrapper braces around brushDef/patchDef2
   */
  private static preprocess(content: string): string {
    const lines = content.split("\n");
    const output: string[] = [];
    let inBrushDef = false;
    let inPatchDef = false;
    let brushDefBraceDepth = 0;
    let skipNextCloseBrace = false;

    for (const rawLine of lines) {
      let line = rawLine.trim();
      
      // Skip empty lines, comments, and layer definitions
      if (!line || line.startsWith("//") || line.startsWith("//@$&")) continue;
      
      // Remove inline comments
      const commentIdx = line.indexOf("//");
      if (commentIdx !== -1) {
        line = line.substring(0, commentIdx).trim();
        if (!line) continue;
      }

      // Handle brushDef start
      if (line === "brushDef") {
        inBrushDef = true;
        brushDefBraceDepth = 0;
        continue; // Skip the brushDef keyword itself
      }

      // Handle patchDef2 start
      if (line === "patchDef2") {
        inPatchDef = true;
        output.push("patchDef2");
        continue;
      }

      // Inside brushDef - convert to simple plane format
      if (inBrushDef) {
        if (line === "{") {
          brushDefBraceDepth++;
          if (brushDefBraceDepth === 1) {
            // This is the brushDef's opening brace, output as brush start
            output.push("{");
          }
          continue;
        }
        if (line === "}") {
          brushDefBraceDepth--;
          if (brushDefBraceDepth === 0) {
            // End of brushDef
            output.push("}");
            inBrushDef = false;
            skipNextCloseBrace = true; // Skip the wrapper close brace
          }
          continue;
        }
        
        // Convert brushDef plane format to simple format:
        // FROM: ( p1 ) ( p2 ) ( p3 ) ( ( uv ) ( uv ) ) texture flags
        // TO:   ( p1 ) ( p2 ) ( p3 ) texture 0 0 0 1 1
        const brushDefMatch = line.match(
          /\(\s*([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s*\)\s*\(\s*([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s*\)\s*\(\s*([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s*\)\s*\(\s*\([^)]+\)\s*\([^)]+\)\s*\)\s+(\S+)/
        );
        if (brushDefMatch) {
          const [, x1, y1, z1, x2, y2, z2, x3, y3, z3, texture] = brushDefMatch;
          output.push(`( ${x1} ${y1} ${z1} ) ( ${x2} ${y2} ${z2} ) ( ${x3} ${y3} ${z3} ) ${texture} 0 0 0 1 1`);
        }
        continue;
      }

      // Inside patchDef2 - pass through
      if (inPatchDef) {
        output.push(line);
        if (line === "}") {
          // Count braces to detect end
          const openCount = output.filter(l => l === "{").length;
          const closeCount = output.filter(l => l === "}").length;
          if (closeCount >= openCount) {
            inPatchDef = false;
          }
        }
        continue;
      }

      // Skip wrapper close braces
      if (skipNextCloseBrace && line === "}") {
        skipNextCloseBrace = false;
        continue;
      }

      // Pass through everything else
      output.push(line);
    }

    return output.join("\n");
  }

  static parse(content: string): Entity[] {
    // Preprocess to normalize format (handles brushDef conversion, removes comments)
    const normalizedContent = MapParser.preprocess(content);
    
    const entities: Entity[] = [];
    let currentEntity: Entity | null = null;
    let currentBrush: Brush | null = null;
    let inPatchDef = false;
    let patchLines: string[] = [];

    const lines = normalizedContent.split("\n");

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      // Check for patchDef2 start
      if (line === "patchDef2") {
        inPatchDef = true;
        patchLines = [];
        continue;
      }

      // Collect patch lines
      if (inPatchDef) {
        patchLines.push(line);

        // Count braces - patch ends when we see the closing } for the patchDef2 block
        let braceDepth = 0;
        for (const pl of patchLines) {
          if (pl === "{") braceDepth++;
          if (pl === "}") braceDepth--;
        }

        // When brace depth returns to 0, patch is complete
        if (braceDepth === 0 && patchLines.length > 1) {
          const patch = MapParser.parsePatchDef2(patchLines);
          if (patch && currentEntity) {
            currentEntity.patches.push(patch);
          }
          inPatchDef = false;
          patchLines = [];
        }
        continue;
      }

      if (line === "{") {
        if (!currentEntity) {
          currentEntity = { classname: "", properties: {}, brushes: [], patches: [] };
        } else if (!currentBrush) {
          // Nested brace means a brush
          currentBrush = { planes: [] };
        }
      } else if (line === "}") {
        if (currentBrush) {
          if (currentEntity && currentBrush.planes.length > 0) {
            currentEntity.brushes.push(currentBrush);
          }
          currentBrush = null;
        } else if (currentEntity) {
          entities.push(currentEntity);
          currentEntity = null;
        }
      } else {
        // Property or Plane
        if (currentBrush) {
          // Parse Plane: ( x y z ) ( x y z ) ( x y z ) texture ...
          const planeMatch = line.match(
            /\(\s*([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s*\)\s*\(\s*([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s*\)\s*\(\s*([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s*\)\s+(\S+)\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)/,
          );

          if (planeMatch) {
            const p1 = [parseFloat(planeMatch[1]), parseFloat(planeMatch[2]), parseFloat(planeMatch[3])];
            const p2 = [parseFloat(planeMatch[4]), parseFloat(planeMatch[5]), parseFloat(planeMatch[6])];
            const p3 = [parseFloat(planeMatch[7]), parseFloat(planeMatch[8]), parseFloat(planeMatch[9])];

            currentBrush.planes.push({
              p1,
              p2,
              p3,
              texture: planeMatch[10],
              u_offset: parseFloat(planeMatch[11]),
              v_offset: parseFloat(planeMatch[12]),
              rotation: parseFloat(planeMatch[13]),
              u_scale: parseFloat(planeMatch[14]),
              v_scale: parseFloat(planeMatch[15]),
            });
          }
        } else if (currentEntity) {
          // Parse Property: "key" "value"
          const propMatch = line.match(/"([^"]+)"\s+"([^"]*)"/);
          if (propMatch) {
            const key = propMatch[1];
            const value = propMatch[2];
            currentEntity.properties[key] = value;
            if (key === "classname") {
              currentEntity.classname = value;
            }
          }
        }
      }
    }

    return entities;
  }

  /**
   * Parse a patchDef2 block
   *
   * Format:
   * patchDef2
   * {
   *   textures/path/texture
   *   ( width height reserved reserved reserved )
   *   (
   *     ( ( x y z u v ) ( x y z u v ) ... )
   *     ( ( x y z u v ) ( x y z u v ) ... )
   *     ...
   *   )
   * }
   */
  private static parsePatchDef2(lines: string[]): Patch | null {
    try {
      // Find texture (first non-brace line after opening brace)
      let texture = "";
      let width = 0;
      let height = 0;
      const controlPoints: PatchControlPoint[][] = [];

      let state: "texture" | "dimensions" | "points" | "done" = "texture";

      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed === "{" || trimmed === "}" || trimmed === "(" || trimmed === ")") {
          continue;
        }

        if (state === "texture" && !trimmed.startsWith("(")) {
          texture = trimmed;
          state = "dimensions";
          continue;
        }

        if (state === "dimensions") {
          // Parse ( width height 0 0 0 )
          const dimMatch = trimmed.match(/\(\s*(\d+)\s+(\d+)\s+\d+\s+\d+\s+\d+\s*\)/);
          if (dimMatch) {
            width = parseInt(dimMatch[1]);
            height = parseInt(dimMatch[2]);
            state = "points";
          }
          continue;
        }

        if (state === "points") {
          // Parse control points: ( ( x y z u v ) ( x y z u v ) ... )
          // Each line that contains control points is a row
          const pointMatches = [
            ...trimmed.matchAll(/\(\s*([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s*\)/g),
          ];

          if (pointMatches.length > 0) {
            // This line contains control points - it's a complete row
            const row: PatchControlPoint[] = [];
            for (const match of pointMatches) {
              row.push({
                x: parseFloat(match[1]),
                y: parseFloat(match[2]),
                z: parseFloat(match[3]),
                u: parseFloat(match[4]),
                v: parseFloat(match[5]),
              });
            }
            controlPoints.push(row);
          }
        }
      }

      if (!texture || width === 0 || height === 0 || controlPoints.length === 0) {
        console.warn("Invalid patch definition");
        return null;
      }

      return { texture, width, height, controlPoints };
    } catch (e) {
      console.error("Failed to parse patchDef2:", e);
      return null;
    }
  }

}
