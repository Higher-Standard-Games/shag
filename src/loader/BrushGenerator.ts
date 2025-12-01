import { Scene, Mesh, Vector3, Plane, VertexData, StandardMaterial, Color3 } from "babylonjs";
import { Brush, PlaneDefinition } from "./MapParser";

export interface BrushFace {
    vertices: Vector3[];
    normal: Vector3;
    planeDefinition: PlaneDefinition;
    uvs: number[];
}

export class BrushGenerator {
    /**
     * Build a mesh from a brush definition
     * Returns the mesh and face data for texture application
     */
    static buildMesh(brush: Brush, scene: Scene): Mesh | null {
        // Calculate Approximate Center of the Brush
        // We use this to determine the correct orientation of planes (Auto-Winding)
        let center = Vector3.Zero();
        let pointCount = 0;

        for (const def of brush.planes) {
            // Quake: Z is Up. Babylon: Y is Up.
            const p1 = new Vector3(def.p1[0], def.p1[2], def.p1[1]);
            const p2 = new Vector3(def.p2[0], def.p2[2], def.p2[1]);
            const p3 = new Vector3(def.p3[0], def.p3[2], def.p3[1]);

            center.addInPlace(p1).addInPlace(p2).addInPlace(p3);
            pointCount += 3;
        }

        if (pointCount > 0) {
            center.scaleInPlace(1.0 / pointCount);
        }

        const planes: Plane[] = [];

        // Build Planes and Auto-Correct Normals
        for (const def of brush.planes) {
            const p1 = new Vector3(def.p1[0], def.p1[2], def.p1[1]);
            const p2 = new Vector3(def.p2[0], def.p2[2], def.p2[1]);
            const p3 = new Vector3(def.p3[0], def.p3[2], def.p3[1]);

            const v1 = p2.subtract(p1);
            const v2 = p3.subtract(p1);

            // Initial Normal (Standard Winding)
            let normal = Vector3.Cross(v2, v1).normalize();
            let d = -Vector3.Dot(normal, p1);

            // Check if Center is "Outside" this plane
            // If Dot(Normal, Center) + d > 0, the Normal points Inward (towards center) or Center is on positive side
            // We want Normal to point Outward, so Center should be on negative side (dist < 0)
            if (Vector3.Dot(normal, center) + d > 0) {
                // Flip Normal
                normal.scaleInPlace(-1);
                d = -d;
            }

            planes.push(new Plane(normal.x, normal.y, normal.z, d));
        }

        // Generate Vertices
        const vertices: Vector3[] = [];
        for (let i = 0; i < planes.length; i++) {
            for (let j = i + 1; j < planes.length; j++) {
                for (let k = j + 1; k < planes.length; k++) {
                    const intersection = this.getIntersection(planes[i], planes[j], planes[k]);
                    if (intersection) {
                        if (this.isPointInsideBrush(intersection, planes)) {
                            if (!vertices.some(v => Vector3.DistanceSquared(v, intersection) < 0.001)) {
                                vertices.push(intersection);
                            }
                        }
                    }
                }
            }
        }

        if (vertices.length < 4) {
            // console.warn("Brush rejected: Not enough vertices");
            return null;
        }

        const customMesh = new Mesh("brush", scene);
        const positions: number[] = [];
        const indices: number[] = [];
        const normals: number[] = [];
        const uvs: number[] = [];

        // Store face data for per-face texturing
        const faces: BrushFace[] = [];

        // Group vertices by plane to create faces
        let indexOffset = 0;
        for (let i = 0; i < planes.length; i++) {
            const plane = planes[i];
            const planeDef = brush.planes[i];
            const faceVertices: Vector3[] = [];

            for (const v of vertices) {
                if (Math.abs(Vector3.Dot(new Vector3(plane.normal.x, plane.normal.y, plane.normal.z), v) + plane.d) < 0.1) {
                    faceVertices.push(v);
                }
            }

            if (faceVertices.length >= 3) {
                const normal = new Vector3(plane.normal.x, plane.normal.y, plane.normal.z);
                const faceCenter = faceVertices.reduce((a, b) => a.add(b), Vector3.Zero()).scale(1 / faceVertices.length);

                let tangent = Vector3.Cross(normal, Vector3.Up());
                if (tangent.lengthSquared() < 0.001) {
                    tangent = Vector3.Cross(normal, Vector3.Right());
                }
                tangent.normalize();
                const bitangent = Vector3.Cross(normal, tangent);

                faceVertices.sort((a, b) => {
                    const va = a.subtract(faceCenter);
                    const vb = b.subtract(faceCenter);
                    const angleA = Math.atan2(Vector3.Dot(va, bitangent), Vector3.Dot(va, tangent));
                    const angleB = Math.atan2(Vector3.Dot(vb, bitangent), Vector3.Dot(vb, tangent));
                    return angleA - angleB;
                });

                // Calculate UV coordinates for this face
                const faceUVs = this.calculateFaceUVs(faceVertices, normal, planeDef);

                // Store face data
                faces.push({
                    vertices: [...faceVertices],
                    normal: normal.clone(),
                    planeDefinition: planeDef,
                    uvs: faceUVs
                });

                for (let j = 1; j < faceVertices.length - 1; j++) {
                    positions.push(faceVertices[0].x, faceVertices[0].y, faceVertices[0].z);
                    positions.push(faceVertices[j].x, faceVertices[j].y, faceVertices[j].z);
                    positions.push(faceVertices[j + 1].x, faceVertices[j + 1].y, faceVertices[j + 1].z);

                    normals.push(normal.x, normal.y, normal.z);
                    normals.push(normal.x, normal.y, normal.z);
                    normals.push(normal.x, normal.y, normal.z);

                    // Add UVs for the triangle
                    uvs.push(faceUVs[0 * 2], faceUVs[0 * 2 + 1]);
                    uvs.push(faceUVs[j * 2], faceUVs[j * 2 + 1]);
                    uvs.push(faceUVs[(j + 1) * 2], faceUVs[(j + 1) * 2 + 1]);

                    indices.push(indexOffset, indexOffset + 1, indexOffset + 2);
                    indexOffset += 3;
                }
            }
        }

        const vertexData = new VertexData();
        vertexData.positions = positions;
        vertexData.indices = indices;
        vertexData.normals = normals;
        vertexData.uvs = uvs;
        vertexData.applyToMesh(customMesh);

        // Store faces in metadata for per-face material access
        customMesh.metadata = { ...customMesh.metadata, faces };

        // Check for "trigger" texture
        const isTrigger = brush.planes.some(p => p.texture && p.texture.toLowerCase().includes("trigger"));
        if (isTrigger) {
            const mat = new StandardMaterial("triggerMat", scene);
            mat.diffuseColor = new Color3(1, 0, 0); // Red
            mat.alpha = 0.3;
            mat.wireframe = true;
            mat.backFaceCulling = false; // Ensure all sides are visible
            customMesh.material = mat;
            customMesh.metadata = { isTrigger: true };
            console.log(`Created Trigger Mesh with ${vertices.length} vertices`);
        }

        return customMesh;
    }

    /**
     * Calculate UV coordinates for face vertices using Quake-style planar projection
     * 
     * Quake uses axis-aligned projection based on the face normal:
     * - If normal is mostly X-aligned: project onto YZ plane
     * - If normal is mostly Y-aligned: project onto XZ plane
     * - If normal is mostly Z-aligned: project onto XY plane
     */
    private static calculateFaceUVs(
        vertices: Vector3[],
        normal: Vector3,
        planeDef: PlaneDefinition
    ): number[] {
        const uvs: number[] = [];

        // Default texture size (Quake standard)
        const textureSize = 64;

        // Determine projection axis based on normal
        const absNormal = new Vector3(
            Math.abs(normal.x),
            Math.abs(normal.y),
            Math.abs(normal.z)
        );

        let uAxis: Vector3;
        let vAxis: Vector3;

        if (absNormal.y >= absNormal.x && absNormal.y >= absNormal.z) {
            // Normal is mostly Y (up/down in Babylon) - project onto XZ
            uAxis = new Vector3(1, 0, 0);
            vAxis = new Vector3(0, 0, -1);
        } else if (absNormal.x >= absNormal.y && absNormal.x >= absNormal.z) {
            // Normal is mostly X - project onto YZ
            uAxis = new Vector3(0, 0, -1);
            vAxis = new Vector3(0, -1, 0);
        } else {
            // Normal is mostly Z - project onto XY
            uAxis = new Vector3(1, 0, 0);
            vAxis = new Vector3(0, -1, 0);
        }

        // Apply rotation if specified
        if (planeDef.rotation !== 0) {
            const rotRad = (planeDef.rotation * Math.PI) / 180;
            const cos = Math.cos(rotRad);
            const sin = Math.sin(rotRad);

            const newU = uAxis.scale(cos).add(vAxis.scale(sin));
            const newV = uAxis.scale(-sin).add(vAxis.scale(cos));
            uAxis = newU;
            vAxis = newV;
        }

        // Calculate UVs for each vertex
        for (const vertex of vertices) {
            // Project vertex onto UV axes
            let u = Vector3.Dot(vertex, uAxis);
            let v = Vector3.Dot(vertex, vAxis);

            // Apply scale (Quake uses inverse - smaller value = larger texture)
            u = u / (textureSize * planeDef.u_scale);
            v = v / (textureSize * planeDef.v_scale);

            // Apply offset (in texture pixels, convert to 0-1 range)
            u += planeDef.u_offset / textureSize;
            v += planeDef.v_offset / textureSize;

            uvs.push(u, v);
        }

        return uvs;
    }

    private static getIntersection(p1: Plane, p2: Plane, p3: Plane): Vector3 | null {
        const n1 = new Vector3(p1.normal.x, p1.normal.y, p1.normal.z);
        const n2 = new Vector3(p2.normal.x, p2.normal.y, p2.normal.z);
        const n3 = new Vector3(p3.normal.x, p3.normal.y, p3.normal.z);

        const det = Vector3.Dot(n1, Vector3.Cross(n2, n3));

        // Relaxed tolerance for determinant
        if (Math.abs(det) < 0.000001) return null;

        const cross23 = Vector3.Cross(n2, n3).scale(-p1.d);
        const cross31 = Vector3.Cross(n3, n1).scale(-p2.d);
        const cross12 = Vector3.Cross(n1, n2).scale(-p3.d);

        return cross23.add(cross31).add(cross12).scale(1 / det);
    }

    private static isPointInsideBrush(point: Vector3, planes: Plane[]): boolean {
        for (let i = 0; i < planes.length; i++) {
            const plane = planes[i];
            const dist = Vector3.Dot(new Vector3(plane.normal.x, plane.normal.y, plane.normal.z), point) + plane.d;
            if (dist > 0.1) { // Relaxed tolerance to 0.1
                return false;
            }
        }
        return true;
    }
}
