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
    static parse(content: string): Entity[] {
        const entities: Entity[] = [];
        let currentEntity: Entity | null = null;
        let currentBrush: Brush | null = null;
        let inPatchDef = false;
        let patchLines: string[] = [];

        const lines = content.split('\n');

        for (let i = 0; i < lines.length; i++) {
            let line = lines[i].trim();
            if (!line || line.startsWith('//')) continue;

            // Remove comments at end of line
            const commentIdx = line.indexOf('//');
            if (commentIdx !== -1) {
                line = line.substring(0, commentIdx).trim();
            }

            // Check for patchDef2 start
            if (line === 'patchDef2') {
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
                    if (pl === '{') braceDepth++;
                    if (pl === '}') braceDepth--;
                }
                
                // When brace depth returns to 0, patch is complete
                if (braceDepth === 0 && patchLines.length > 1) {
                    // Parse the collected patch
                    const patch = this.parsePatchDef2(patchLines);
                    if (patch && currentEntity) {
                        currentEntity.patches.push(patch);
                        console.log(`Parsed patch: ${patch.width}x${patch.height}, texture: ${patch.texture}`);
                    } else {
                        console.warn("Failed to parse patch from lines:", patchLines);
                    }
                    inPatchDef = false;
                    patchLines = [];
                }
                continue;
            }

            if (line === '{') {
                if (!currentEntity) {
                    currentEntity = { classname: '', properties: {}, brushes: [], patches: [] };
                } else if (!currentBrush) {
                    // Nested brace means a brush
                    currentBrush = { planes: [] };
                }
            } else if (line === '}') {
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
                    const planeMatch = line.match(/\(\s*([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s*\)\s*\(\s*([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s*\)\s*\(\s*([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s*\)\s+(\S+)\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)/);

                    if (planeMatch) {
                        const p1 = [parseFloat(planeMatch[1]), parseFloat(planeMatch[2]), parseFloat(planeMatch[3])];
                        const p2 = [parseFloat(planeMatch[4]), parseFloat(planeMatch[5]), parseFloat(planeMatch[6])];
                        const p3 = [parseFloat(planeMatch[7]), parseFloat(planeMatch[8]), parseFloat(planeMatch[9])];

                        currentBrush.planes.push({
                            p1, p2, p3,
                            texture: planeMatch[10],
                            u_offset: parseFloat(planeMatch[11]),
                            v_offset: parseFloat(planeMatch[12]),
                            rotation: parseFloat(planeMatch[13]),
                            u_scale: parseFloat(planeMatch[14]),
                            v_scale: parseFloat(planeMatch[15])
                        });
                    }
                } else if (currentEntity) {
                    // Parse Property: "key" "value"
                    const propMatch = line.match(/"([^"]+)"\s+"([^"]*)"/);
                    if (propMatch) {
                        const key = propMatch[1];
                        const value = propMatch[2];
                        currentEntity.properties[key] = value;
                        if (key === 'classname') {
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
            let texture = '';
            let width = 0;
            let height = 0;
            const controlPoints: PatchControlPoint[][] = [];
            
            let state: 'texture' | 'dimensions' | 'points' | 'done' = 'texture';

            for (const line of lines) {
                const trimmed = line.trim();
                if (trimmed === '{' || trimmed === '}' || trimmed === '(' || trimmed === ')') {
                    continue;
                }

                if (state === 'texture' && !trimmed.startsWith('(')) {
                    texture = trimmed;
                    state = 'dimensions';
                    continue;
                }

                if (state === 'dimensions') {
                    // Parse ( width height 0 0 0 )
                    const dimMatch = trimmed.match(/\(\s*(\d+)\s+(\d+)\s+\d+\s+\d+\s+\d+\s*\)/);
                    if (dimMatch) {
                        width = parseInt(dimMatch[1]);
                        height = parseInt(dimMatch[2]);
                        state = 'points';
                    }
                    continue;
                }

                if (state === 'points') {
                    // Parse control points: ( ( x y z u v ) ( x y z u v ) ... )
                    // Each line that contains control points is a row
                    const pointMatches = [...trimmed.matchAll(/\(\s*([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s*\)/g)];
                    
                    if (pointMatches.length > 0) {
                        // This line contains control points - it's a complete row
                        const row: PatchControlPoint[] = [];
                        for (const match of pointMatches) {
                            row.push({
                                x: parseFloat(match[1]),
                                y: parseFloat(match[2]),
                                z: parseFloat(match[3]),
                                u: parseFloat(match[4]),
                                v: parseFloat(match[5])
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
