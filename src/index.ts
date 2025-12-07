import "./style.css";
import {
  ArcRotateCamera,
  Color3,
  Color4,
  Engine,
  HemisphericLight,
  PointerEventTypes,
  PointLight,
  Scene,
  StandardMaterial,
  Vector3,
} from "babylonjs";
import { BrushGenerator } from "./loader/BrushGenerator";
import { MapParser } from "./loader/MapParser";
import { type PatchDefinition, PatchGenerator } from "./loader/PatchGenerator";
import { TextureManager } from "./loader/TextureManager";
import { RTSCameraController } from "./scene/RTSCameraController";
import { UIManager } from "./ui/UIManager";

const canvas = document.getElementById("renderCanvas") as HTMLCanvasElement;

// Initialize Babylon Engine
const engine = new Engine(canvas, true);

const createScene = async () => {
  const scene = new Scene(engine);
  scene.clearColor = new Color4(0.1, 0.1, 0.1, 1);
  scene.collisionsEnabled = true;

  // Isometric Camera (Orthographic)
  // High angle from "up"
  const camera = new ArcRotateCamera("camera", -Math.PI / 4, Math.PI / 4, 200, Vector3.Zero(), scene);
  camera.mode = ArcRotateCamera.ORTHOGRAPHIC_CAMERA;

  // Camera Zoom Control
  let orthoSize = 250; // Default Vertical size

  const updateCameraOrtho = () => {
    const ratio = canvas.width / canvas.height;
    camera.orthoTop = orthoSize;
    camera.orthoBottom = -orthoSize;
    camera.orthoLeft = -orthoSize * ratio;
    camera.orthoRight = orthoSize * ratio;
  };

  // Initial update
  updateCameraOrtho();

  // Expose setZoom to console
  (window as any).setZoom = (newSize: number) => {
    orthoSize = newSize;
    updateCameraOrtho();
    console.log(`Zoom set to ${orthoSize}`);
  };
  console.log("Use 'setZoom(value)' to adjust camera zoom. Default is 250.");

  // Centralized Resize Handler
  window.addEventListener("resize", () => {
    engine.resize();
    updateCameraOrtho();
  });

  // Disable default controls to prevent rotation
  camera.inputs.clear();

  // Lights
  const light = new HemisphericLight("light", new Vector3(0, 1, 0), scene);
  light.intensity = 0.3;
  light.groundColor = new Color3(0.2, 0.2, 0.3); // Fill light for undersides
  const dirLight = new HemisphericLight("dirLight", new Vector3(1, 1, 1), scene);
  dirLight.intensity = 0.15;

  // Initialize TextureManager
  const textureManager = TextureManager.getInstance();
  textureManager.init(scene);

  // Map Loading Logic
  const loadMap = async (mapName: string) => {
    try {
      console.log(`Loading map: ${mapName}`);

      // Clear existing map meshes and lights
      scene.meshes.forEach((mesh) => {
        if (mesh.name === "brush" || mesh.name === "patch" || mesh.name.startsWith("light_")) {
          mesh.dispose();
        }
      });
      scene.lights.forEach((light) => {
        if (light.name.startsWith("light_")) {
          light.dispose();
        }
      });

      // Clear texture cache for new map
      textureManager.clearCache();

      const response = await fetch(`/maps/${mapName}`);
      const mapText = await response.text();
      const entities = MapParser.parse(mapText);

      console.log("Parsed Entities:", entities);

      let playerStartPosition = new Vector3(0, 10, 0);

      for (const entity of entities) {
        if (entity.classname === "info_player_start" && entity.properties.origin) {
          const parts = entity.properties.origin.split(" ").map(parseFloat);
          // Quake Z is up, Babylon Y is up. Swap Y and Z.
          playerStartPosition = new Vector3(parts[0], parts[2], parts[1]);
        } else if (entity.classname === "light" && entity.properties.origin) {
          const parts = entity.properties.origin.split(" ").map(parseFloat);
          const lightPos = new Vector3(parts[0], parts[2], parts[1]);

          const light = new PointLight("light_" + Math.random(), lightPos, scene);

          // Parse Intensity (default 300 in Quake)
          const intensity = entity.properties.light ? parseFloat(entity.properties.light) : 300;
          light.intensity = intensity / 200.0; // Scale down for Babylon

          // Parse Color (default white)
          if (entity.properties._color) {
            const colors = entity.properties._color.split(" ").map(parseFloat);
            // Check if 0-1 or 0-255 range. If any > 1, assume 255.
            if (colors.some((c) => c > 1.0)) {
              light.diffuse = new Color3(colors[0] / 255, colors[1] / 255, colors[2] / 255);
            } else {
              light.diffuse = new Color3(colors[0], colors[1], colors[2]);
            }
          } else {
            light.diffuse = new Color3(1, 1, 1);
          }
        }

        for (const brush of entity.brushes) {
          const mesh = BrushGenerator.buildMesh(brush, scene);
          if (mesh) {
            // Only apply material if one isn't already set (e.g. by BrushGenerator for triggers)
            if (!mesh.material) {
              // Use first face's texture for the whole brush
              // TODO: Support multi-material for per-face textures
              const textureName = brush.planes[0]?.texture;
              const planeDef = brush.planes[0];

              if (textureName) {
                const material = await textureManager.getMaterial({
                  path: textureName,
                  u_offset: planeDef?.u_offset || 0,
                  v_offset: planeDef?.v_offset || 0,
                  rotation: planeDef?.rotation || 0,
                  u_scale: planeDef?.u_scale || 1,
                  v_scale: planeDef?.v_scale || 1,
                });
                mesh.material = material;
              } else {
                // Fallback material
                const material = new StandardMaterial("mat_default", scene);
                material.diffuseColor = new Color3(0.8, 0.8, 0.8);
                material.specularColor = new Color3(0, 0, 0);
                material.backFaceCulling = false;
                mesh.material = material;
              }
            }

            mesh.checkCollisions = true;

            // Attach Entity Properties to Metadata
            if (!mesh.metadata) mesh.metadata = {};
            mesh.metadata.properties = entity.properties;
          }
        }

        // Process patches (bezier surfaces)
        for (const patch of entity.patches) {
          // Convert MapParser patch format to PatchGenerator format
          const patchDef: PatchDefinition = {
            texture: patch.texture,
            width: patch.width,
            height: patch.height,
            controlPoints: patch.controlPoints.map((row) =>
              row.map((cp) => ({
                // Quake Z-up to Babylon Y-up conversion
                position: new Vector3(cp.x, cp.z, cp.y),
                u: cp.u,
                v: cp.v,
              })),
            ),
          };

          const mesh = PatchGenerator.buildMesh(patchDef, scene);
          if (mesh) {
            // Apply material using TextureManager
            const material = await textureManager.getMaterial({
              path: patch.texture,
              u_offset: 0,
              v_offset: 0,
              rotation: 0,
              u_scale: 1,
              v_scale: 1,
            });
            // Patches need two-sided lighting since they can curve in any direction
            material.twoSidedLighting = true;
            mesh.material = material;
            mesh.checkCollisions = true;

            // Attach Entity Properties to Metadata
            mesh.metadata = { properties: entity.properties };

            console.log(`Created patch mesh: ${patch.width}x${patch.height} control points`);
          }
        }
      }

      // Set Camera Target to center of map (or player start)
      camera.setTarget(playerStartPosition);
    } catch (e) {
      console.error("Failed to load map:", e);
    }
  };

  // Expose loadMap to console for debugging
  (window as any).loadMap = loadMap;

  // Initial Map Load
  loadMap("patch_test.map");

  // Initialize RTS Camera Controller
  new RTSCameraController(scene, camera, canvas);

  // Handle Trigger Clicks
  scene.onPointerObservable.add((pointerInfo) => {
    if (pointerInfo.type === PointerEventTypes.POINTERPICK) {
      const mesh = pointerInfo.pickInfo?.pickedMesh;
      if (mesh && mesh.metadata && mesh.metadata.isTrigger) {
        console.log("Clicked Trigger:", mesh.metadata);

        const properties = mesh.metadata.properties;
        if (properties) {
          if (properties.windowTarget) {
            console.log(`Opening Dialog: ${properties.windowTarget}`);
            UIManager.getInstance().openDialog(properties.windowTarget);
          }

          if (properties.targetMap) {
            console.log(`Switching to Map: ${properties.targetMap}`);
            loadMap(properties.targetMap);
          }
        } else {
          console.warn("Trigger clicked but no properties found.");
        }
      }
    }
  });

  return scene;
};

// Scene is now async
createScene().then((scene) => {
  engine.runRenderLoop(() => {
    // Force Isometric View
    if (scene.activeCamera) {
      const cam = scene.activeCamera as ArcRotateCamera;
      cam.alpha = -Math.PI / 4;
      cam.beta = Math.PI / 4;
    }
    scene.render();
  });
});
