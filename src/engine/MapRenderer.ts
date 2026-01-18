import { ClusteredLightContainer } from "@babylonjs/core/Lights/Clustered/clusteredLightContainer";
import "@babylonjs/core/Lights/Clustered/clusteredLightingSceneComponent";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { PointLight } from "@babylonjs/core/Lights/pointLight";
import { Scene } from "@babylonjs/core/scene";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import type { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { BrushGenerator } from "./loader";
import { type Entity } from "./loader";
import { ModelLoader } from "./loader";
import { type PatchDefinition, PatchGenerator } from "./loader";
import { PrefabInstance } from "./loader";
import { InstancedMeshManager } from "./rendering/InstancedMeshManager";
import { TextureManager } from "./loader";
import { type BillboardSprite } from "./sprites/BillboardSprite";
import { SpriteBuildingManager } from "./sprites/SpriteBuilding";
import { SpriteManager } from "./sprites/SpriteManager";
import { SkyLightSystem } from "./lighting/SkyLightSystem";
import { StreetLampSystem } from "./lighting/StreetLampSystem";
import { LocalDebrisManager, type LocalDebrisType } from "./effects/LocalDebrisEffect";
import { EntityHandlerRegistry, type EntityData } from "./core/EntityHandlerRegistry";
import { PhysicsSystem } from "./physics/PhysicsSystem";
import { PhysicsShapeType } from "@babylonjs/core/Physics/v2/IPhysicsEnginePlugin";

export interface MapRenderResult {
  playerStartPosition: Vector3;
  prefabInstances: TransformNode[];
  sprites: BillboardSprite[];
  /** Camera mode specified in worldspawn, or null if not specified */
  cameraMode: "perspective" | "orthographic" | "fake_ortho" | null;
  /** Camera height/distance specified in worldspawn, or null if not specified */
  cameraHeight: number | null;
  /** Camera alpha angle specified in worldspawn, or null if not specified */
  cameraAlpha: number | null;
  /** Camera beta angle specified in worldspawn, or null if not specified */
  cameraBeta: number | null;
  /** Camera controller type specified in worldspawn, or null if not specified */
  cameraController: "isometric" | "fps" | "sidescroll" | "follow" | null;
  /** Playlist file specified in worldspawn, or null to keep current/default */
  playlist: string | null;
  /** Whether this map is indoors (disables rain/snow effects) */
  indoor: boolean;
  /** Lighting overrides from worldspawn */
  lighting: {
    sunIntensity?: number;
    moonIntensity?: number;
    ambientIntensity?: number;
    shadows?: boolean;
  } | null;
  /** Weather settings from worldspawn */
  weather: {
    type?: 'rain' | 'snow' | 'clear';
    intensity?: number;
    fog?: boolean;
    fogDensity?: number;
  } | null;
  /** Time settings from worldspawn */
  time: {
    dayLength?: number;
    startHour?: number;
  } | null;
}

export class MapRenderer {
  /**
   * Renders parsed map entities into a Babylon scene.
   * Returns the player start position if found.
   */
  public static async renderEntities(
    entities: Entity[],
    scene: Scene,
    mapName?: string
  ): Promise<MapRenderResult> {
    const textureManager = TextureManager.getInstance();

    const resolvedMapName = mapName ?? "unknown";
    const tagMapOwned = (obj: { metadata?: any } | null | undefined): void => {
      if (!obj) return;
      if (!obj.metadata) obj.metadata = {};
      obj.metadata.mapOwned = true;
      obj.metadata.mapName = resolvedMapName;
    };

    // Ensure TextureManager is initialized for this scene
    if (!textureManager.isInitialized()) {
      textureManager.init(scene);
    }

    // Convert entities to EntityData for hooks
    const entityDataList: EntityData[] = entities.map(e => ({
      classname: e.classname,
      properties: e.properties,
      brushes: e.brushes,
      patches: e.patches,
    }));

    // Run pre-render hooks (game-specific initialization)
    await EntityHandlerRegistry.runPreRenderHooks(entityDataList, scene);

    // Pre-process: Group misc_model entities by model path for instancing optimization
    const modelEntityGroups = new Map<string, Entity[]>();
    for (const entity of entities) {
      if (entity.classname === "misc_model" && entity.properties.model) {
        const modelPath = entity.properties.model;
        if (ModelLoader.isModelFile(modelPath)) {
          if (!modelEntityGroups.has(modelPath)) {
            modelEntityGroups.set(modelPath, []);
          }
          modelEntityGroups.get(modelPath)!.push(entity);
        }
      }
    }

    // Register instanced templates for models with multiple instances
    const instancedModels = new Set<string>();
    const instanceManager = InstancedMeshManager.getInstance();
    const modelLoader = ModelLoader.getInstance();

    if (!modelLoader.isInitialized()) {
      modelLoader.init(scene);
    }

    for (const [modelPath, modelEntities] of modelEntityGroups) {
      // Use instancing if 3+ instances of the same model
      if (modelEntities.length >= 3) {
        const registered = await modelLoader.registerInstanceTemplate(
          modelPath,
          modelPath,
          Math.max(100, modelEntities.length * 2)
        );
        if (registered) {
          instancedModels.add(modelPath);
          console.log(`[MapRenderer] Using instancing for ${modelPath} (${modelEntities.length} instances)`);
        }
      }
    }

    let playerStartPosition = new Vector3(0, 10, 0);
    const prefabInstances: TransformNode[] = [];
    const sprites: BillboardSprite[] = [];
    let cameraMode: "perspective" | "orthographic" | "fake_ortho" | null = null;
    let cameraHeight: number | null = null;
    let cameraAlpha: number | null = null;
    let cameraBeta: number | null = null;
    let cameraController: "isometric" | "fps" | "sidescroll" | "follow" | null = null;
    let playlist: string | null = null;
    let indoor: boolean = false;
    let lighting: MapRenderResult['lighting'] = null;
    let weather: MapRenderResult['weather'] = null;
    let time: MapRenderResult['time'] = null;

    // Collect static point lights for clustered rendering
    const staticLights: PointLight[] = [];

    for (const entity of entities) {
      // Handle worldspawn (first entity, contains map-wide settings)
      if (entity.classname === "worldspawn") {
        // Parse camera_mode if specified
        if (entity.properties.camera_mode) {
          const mode = entity.properties.camera_mode.toLowerCase();
          if (mode === "perspective" || mode === "orthographic" || mode === "fake_ortho") {
            cameraMode = mode;
            console.log(`Map specifies camera_mode: ${cameraMode}`);
          } else {
            console.warn(`Unknown camera_mode in worldspawn: ${entity.properties.camera_mode}`);
          }
        }

        // Parse camera_height if specified (controls zoom/distance)
        if (entity.properties.camera_height) {
          const height = parseFloat(entity.properties.camera_height);
          if (!isNaN(height) && height > 0) {
            cameraHeight = height;
            console.log(`Map specifies camera_height: ${cameraHeight}`);
          }
        }

        // Parse camera_alpha if specified (horizontal rotation)
        if (entity.properties.camera_alpha) {
          const alpha = parseFloat(entity.properties.camera_alpha);
          if (!isNaN(alpha)) {
            cameraAlpha = alpha;
            console.log(`Map specifies camera_alpha: ${cameraAlpha}`);
          }
        }

        // Parse camera_beta if specified (vertical angle)
        if (entity.properties.camera_beta) {
          const beta = parseFloat(entity.properties.camera_beta);
          if (!isNaN(beta)) {
            cameraBeta = beta;
            console.log(`Map specifies camera_beta: ${cameraBeta}`);
          }
        }

        // Parse camera_controller if specified (controller type for this map)
        if (entity.properties.camera_controller) {
          const controller = entity.properties.camera_controller.toLowerCase();
          if (controller === "isometric" || controller === "fps" || controller === "sidescroll" || controller === "follow") {
            cameraController = controller;
            console.log(`Map specifies camera_controller: ${cameraController}`);
          } else {
            console.warn(`Unknown camera_controller in worldspawn: ${entity.properties.camera_controller}`);
          }
        }

        // Parse playlist if specified (music playlist for this map)
        if (entity.properties.playlist) {
          playlist = entity.properties.playlist;
          console.log(`Map specifies playlist: ${playlist}`);
        }

        // Parse indoor flag (disables rain/snow effects)
        if (entity.properties.indoor === "1") {
          indoor = true;
          console.log(`Map is marked as indoor - weather effects disabled`);
        }

        // Parse lighting overrides
        if (entity.properties.sun_intensity || entity.properties.moon_intensity ||
          entity.properties.ambient_intensity || entity.properties.shadows) {
          lighting = {};
          if (entity.properties.sun_intensity) {
            lighting.sunIntensity = parseFloat(entity.properties.sun_intensity);
          }
          if (entity.properties.moon_intensity) {
            lighting.moonIntensity = parseFloat(entity.properties.moon_intensity);
          }
          if (entity.properties.ambient_intensity) {
            lighting.ambientIntensity = parseFloat(entity.properties.ambient_intensity);
          }
          if (entity.properties.shadows) {
            lighting.shadows = entity.properties.shadows === "1";
          }
          console.log(`Map specifies lighting overrides:`, lighting);
        }

        // Parse weather settings
        if (entity.properties.weather || entity.properties.fog) {
          weather = {};
          if (entity.properties.weather) {
            const w = entity.properties.weather.toLowerCase();
            if (w === 'rain' || w === 'snow' || w === 'clear') {
              weather.type = w;
            }
          }
          if (entity.properties.weather_intensity) {
            weather.intensity = parseFloat(entity.properties.weather_intensity);
          }
          if (entity.properties.fog === "1") {
            weather.fog = true;
          }
          if (entity.properties.fog_density) {
            weather.fogDensity = parseFloat(entity.properties.fog_density);
          }
          console.log(`Map specifies weather:`, weather);
        }

        // Parse time settings
        if (entity.properties.day_length || entity.properties.start_hour) {
          time = {};
          if (entity.properties.day_length) {
            time.dayLength = parseFloat(entity.properties.day_length);
          }
          if (entity.properties.start_hour) {
            time.startHour = parseFloat(entity.properties.start_hour);
          }
          console.log(`Map specifies time settings:`, time);
        }
      }

      // Handle player start
      if (entity.classname === "info_player_start" && entity.properties.origin) {
        const parts = entity.properties.origin.split(" ").map(parseFloat);
        playerStartPosition = new Vector3(parts[0], parts[2], parts[1]);
      }

      // Handle lights
      if (entity.classname === "light" && entity.properties.origin) {
        const parts = entity.properties.origin.split(" ").map(parseFloat);
        const lightPos = new Vector3(parts[0], parts[2], parts[1]);

        const light = new PointLight("light_" + Math.random(), lightPos, scene);
        tagMapOwned(light as any);

        // Parse intensity from Quake light value (default 300)
        const quakeIntensity = entity.properties.light
          ? parseFloat(entity.properties.light)
          : 300;

        // Convert to Babylon intensity and set range
        // Quake light values are roughly: 200-300 = normal, 500+ = bright
        light.intensity = quakeIntensity / 100.0; // Increased divisor for brighter lights

        // Set range based on intensity - Quake lights have infinite range but we need to limit
        // Use the light value as a rough guide for range
        light.range = entity.properties.range
          ? parseFloat(entity.properties.range)
          : quakeIntensity; // Range roughly equals light value in world units

        // Parse color
        if (entity.properties._color) {
          const colors = entity.properties._color.split(" ").map(parseFloat);
          if (colors.some((c) => c > 1.0)) {
            light.diffuse = new Color3(
              colors[0] / 255,
              colors[1] / 255,
              colors[2] / 255
            );
          } else {
            light.diffuse = new Color3(colors[0], colors[1], colors[2]);
          }
        } else {
          light.diffuse = new Color3(1, 1, 1);
        }

        staticLights.push(light);
        console.log(`Created light at ${lightPos.toString()}, intensity: ${light.intensity}, range: ${light.range}`);
      }

      // Handle sprite entities (rocks, vegetation, etc.)
      // Supports both "sprite" (legacy/generated) and "misc_sprite" (NetRadiant)
      if ((entity.classname === "sprite" || entity.classname === "misc_sprite") && entity.properties.origin) {
        console.log(`MapRenderer: Found ${entity.classname} entity:`, entity.properties);
        const parts = entity.properties.origin.split(" ").map(parseFloat);
        const position = new Vector3(parts[0], parts[2], parts[1]);

        const spritePath = entity.properties.sprite;
        const width = parseFloat(entity.properties.width || "32");
        const height = parseFloat(entity.properties.height || "32");
        const scale = parseFloat(entity.properties.scale || "1");
        const hasShadow = entity.properties.shadow !== "0"; // Default true
        const shadowOpacity = parseFloat(entity.properties.shadowOpacity || "0.3");
        const isBillboard = entity.properties.billboard !== "0"; // Default true
        const anchor = (entity.properties.anchor || "bottom-center") as "bottom-center" | "center" | "bottom-left" | "bottom-right";

        if (spritePath) {
          const spriteManager = SpriteManager.getInstance();
          const sprite = spriteManager.createStaticSprite(
            {
              id: `map_sprite_${Date.now()}`,
              file: spritePath, // Full path from map entity
              width,
              height,
              anchor,
              billboard: isBillboard,
              shadow: hasShadow,
              shadowOpacity,
            },
            position,
            scale
          );
          if (sprite) {
            tagMapOwned(sprite.mesh as any);
            tagMapOwned((sprite.shadowMesh ?? null) as any);
            console.log(`Created sprite at ${position.toString()}: ${spritePath}`);
          }
        }
      }

      // Handle street lamps (lights that turn on at night)
      if (entity.classname === "street_lamp" && entity.properties.origin) {
        const lampSystem = StreetLampSystem.getInstance();

        // Initialize if needed
        if (!lampSystem.isInitialized()) {
          lampSystem.init(scene);
        }

        const parts = entity.properties.origin.split(" ").map(parseFloat);
        const position = new Vector3(parts[0], parts[2], parts[1]);

        // Parse color
        let color: Color3 | undefined;
        if (entity.properties._color) {
          const colors = entity.properties._color.split(" ").map(parseFloat);
          if (colors.some((c) => c > 1.0)) {
            color = new Color3(colors[0] / 255, colors[1] / 255, colors[2] / 255);
          } else {
            color = new Color3(colors[0], colors[1], colors[2]);
          }
        }

        // Parse other properties
        const intensity = entity.properties.light
          ? parseFloat(entity.properties.light) / 200.0
          : 1.0;
        const range = entity.properties.range
          ? parseFloat(entity.properties.range)
          : 100;
        const fadeTime = entity.properties.fadeTime
          ? parseFloat(entity.properties.fadeTime)
          : 2;
        const turnOnHour = entity.properties.turnOnHour
          ? parseFloat(entity.properties.turnOnHour)
          : 18;
        const turnOffHour = entity.properties.turnOffHour
          ? parseFloat(entity.properties.turnOffHour)
          : 6;
        const flickerEnabled = entity.properties.flicker === "1";
        const showBulb = entity.properties.showBulb !== "0";
        const bulbSize = entity.properties.bulbSize
          ? parseFloat(entity.properties.bulbSize)
          : 3;

        const lampId = entity.properties.targetname || `lamp_${Date.now()}_${Math.random()}`;

        lampSystem.createLamp({
          id: lampId,
          position,
          color,
          intensity,
          range,
          fadeTime,
          turnOnHour,
          turnOffHour,
          flickerEnabled,
          showBulb,
          bulbSize,
        });
      }

      // Handle brushes
      for (const brush of entity.brushes) {
        const mesh = BrushGenerator.buildMesh(brush, scene);
        if (mesh) {
          tagMapOwned(mesh as any);
          if (!mesh.material) {
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
              const material = new StandardMaterial("mat_default", scene);
              material.diffuseColor = new Color3(0.8, 0.8, 0.8);
              material.specularColor = new Color3(0, 0, 0);
              material.backFaceCulling = false;
              mesh.material = material;
            }
          }

          mesh.checkCollisions = true;

          if (!mesh.metadata) mesh.metadata = {};
          mesh.metadata.properties = entity.properties;

          // Physics setup
          if (mesh.checkCollisions) {
            // Check if it's a trigger or skip texture. Usually BrushGenerator filters these for rendering,
            // but if a mesh exists, it's likely visible.
            // Triggers/clips usually don't result in a mesh from BrushGenerator unless debug is on.
            PhysicsSystem.getInstance().createStaticBody(mesh, PhysicsShapeType.MESH);
          }
        }
      }

      // Handle patches
      for (const patch of entity.patches) {
        const patchDef: PatchDefinition = {
          texture: patch.texture,
          width: patch.width,
          height: patch.height,
          controlPoints: patch.controlPoints.map((row) =>
            row.map((cp) => ({
              position: new Vector3(cp.x, cp.z, cp.y),
              u: cp.u,
              v: cp.v,
            }))
          ),
        };

        const mesh = PatchGenerator.buildMesh(patchDef, scene);
        if (mesh) {
          tagMapOwned(mesh as any);
          const material = await textureManager.getMaterial({
            path: patch.texture,
            u_offset: 0,
            v_offset: 0,
            rotation: 0,
            u_scale: 1,
            v_scale: 1,
          });
          material.twoSidedLighting = true;
          mesh.material = material;
          mesh.checkCollisions = true;
          if (!mesh.metadata) mesh.metadata = {};
          mesh.metadata.properties = entity.properties;

          // Physics setup for patches
          if (mesh.checkCollisions) {
            PhysicsSystem.getInstance().createStaticBody(mesh, PhysicsShapeType.MESH);
          }
        }
      }

      // Handle misc_model (prefab instances or 3D models)
      if (entity.classname === "misc_model" && entity.properties.model) {
        const modelPath = entity.properties.model;
        console.log(`misc_model: ${modelPath}, isModelFile: ${ModelLoader.isModelFile(modelPath)}`);

        // Parse origin (Quake coords: X Y Z where Z is up)
        let position = Vector3.Zero();
        if (entity.properties.origin) {
          const parts = entity.properties.origin.split(" ").map(parseFloat);
          position = new Vector3(parts[0], parts[2], parts[1]); // Swap Y/Z
        }

        // Parse angle (Y rotation in degrees)
        const angle = entity.properties.angle
          ? parseFloat(entity.properties.angle)
          : 0;

        // Parse scale
        const scale = entity.properties.scale
          ? parseFloat(entity.properties.scale)
          : 1;

        // Check if this is a 3D model file (GLB/glTF/OBJ) or a .map prefab
        if (ModelLoader.isModelFile(modelPath)) {
          // Check if this model should use GPU instancing
          if (instancedModels.has(modelPath)) {
            // Use instanced rendering (much faster for repeated models)
            const instanceData = instanceManager.createInstance(modelPath, {
              position,
              rotation: new Vector3(0, (angle * Math.PI) / 180, 0),
              scaling: new Vector3(scale, scale, scale),
            });

            if (instanceData) {
              tagMapOwned(instanceData.mesh as any);
              if (!instanceData.mesh.metadata) instanceData.mesh.metadata = {};
              instanceData.mesh.metadata.instanceId = instanceData.id;
              instanceData.mesh.metadata.templateName = instanceData.templateName;
              // Note: Instanced meshes don't create a TransformNode root
              // They're managed by InstancedMeshManager
              console.log(`[MapRenderer] Created instance of ${modelPath}`);
            }
          } else {
            // Load as individual 3D model (GLB/glTF/OBJ)
            const hasCollision = entity.properties.collision !== "0";
            const receiveShadows = entity.properties.receiveShadows !== "0";
            const castShadows = entity.properties.castShadows === "1";
            const visible = entity.properties.visible !== "0";
            const renderingGroupId = entity.properties.renderingGroup
              ? parseInt(entity.properties.renderingGroup)
              : 0;

            // Get shadow generator if casting shadows
            const skyLight = SkyLightSystem.getInstance();
            const shadowGenerator = castShadows ? skyLight.getShadowGenerator() : null;

            const result = await modelLoader.loadModel(modelPath, {
              position,
              angle,
              scale,
              hasCollision,
              receiveShadows,
              castShadows,
              shadowGenerator,
              visible,
              renderingGroupId,
            });

            if (result) {
              tagMapOwned(result.root as any);
              for (const m of result.meshes) tagMapOwned(m as any);
              prefabInstances.push(result.root);
            }
          }
        } else {
          // Load as .map prefab (existing behavior)
          const dropToGround = entity.properties.dropToGround === "1";
          const dropOffset = entity.properties.dropOffset
            ? parseFloat(entity.properties.dropOffset)
            : 0;

          const result = await PrefabInstance.create(modelPath, scene, {
            position,
            angle,
            scale,
            dropToGround,
            dropOffset,
          });

          if (result) {
            tagMapOwned(result.root as any);
            for (const m of result.meshes) tagMapOwned(m as any);
            prefabInstances.push(result.root);
          }
        }
      }

      // Handle sprite_building entities (2D isometric sprites as buildings)
      if (entity.classname === "sprite_building" && entity.properties.origin) {
        const spriteBuildingManager = SpriteBuildingManager.getInstance();

        // Initialize if needed
        if (!spriteBuildingManager["scene"]) {
          spriteBuildingManager.init(scene);
        }

        // Parse position
        const parts = entity.properties.origin.split(" ").map(parseFloat);
        const position = new Vector3(parts[0], parts[2], parts[1]);

        // Get texture path
        const texturePath = entity.properties.texture || entity.properties.sprite;
        if (!texturePath) {
          console.warn("sprite_building missing texture property");
          continue;
        }

        // Parse dimensions
        const width = entity.properties.width ? parseFloat(entity.properties.width) : 100;
        const height = entity.properties.height ? parseFloat(entity.properties.height) : 100;

        // Parse rotation (for fixed isometric angle)
        const rotation = entity.properties.angle
          ? (parseFloat(entity.properties.angle) * Math.PI / 180)
          : 0;

        // Billboard mode (face camera)
        const billboard = entity.properties.billboard === "1";

        // Emissive for glowing effects
        const emissiveIntensity = entity.properties.emissive
          ? parseFloat(entity.properties.emissive)
          : 0;

        // Trigger properties
        let trigger = undefined;
        if (entity.properties.triggerWidth || entity.properties.windowTarget) {
          trigger = {
            size: new Vector3(
              entity.properties.triggerWidth ? parseFloat(entity.properties.triggerWidth) : width,
              entity.properties.triggerHeight ? parseFloat(entity.properties.triggerHeight) : height,
              entity.properties.triggerDepth ? parseFloat(entity.properties.triggerDepth) : 20
            ),
            properties: {
              windowTarget: entity.properties.windowTarget,
              ...entity.properties,
            },
          };
        }

        // Collision properties
        let collision = undefined;
        if (entity.properties.collisionWidth) {
          collision = {
            size: new Vector3(
              parseFloat(entity.properties.collisionWidth),
              entity.properties.collisionHeight ? parseFloat(entity.properties.collisionHeight) : height,
              entity.properties.collisionDepth ? parseFloat(entity.properties.collisionDepth) : 20
            ),
          };
        }

        // Create the sprite building
        const building = spriteBuildingManager.create({
          id: entity.properties.targetname || `sprite_building_${Date.now()}`,
          texturePath,
          position,
          width,
          height,
          rotation,
          billboard,
          emissiveIntensity,
          trigger,
          collision,
        });

        if (building) {
          tagMapOwned(building.getMesh() as any);
          console.log(`Created sprite building: ${building.getId()} at ${position.toString()}`);
        }
      }

      // Handle npc_sprite entities
      if (entity.classname === "npc_sprite" && entity.properties.origin) {
        const spriteManager = SpriteManager.getInstance();

        if (!spriteManager.isInitialized()) {
          console.warn("SpriteManager not initialized - skipping npc_sprite");
          continue;
        }

        // Parse position
        const parts = entity.properties.origin.split(" ").map(parseFloat);
        const position = new Vector3(parts[0], parts[2], parts[1]);

        // Get sprite path - sprite property is required
        const spritePath = entity.properties.sprite;
        if (!spritePath) {
          console.warn(`npc_sprite "${entity.properties.targetname}" missing sprite path, skipping`);
          continue;
        }

        // Parse sprite sheet config
        const config = {
          path: spritePath,
          frameWidth: entity.properties.frameWidth ? parseInt(entity.properties.frameWidth) : 32,
          frameHeight: entity.properties.frameHeight ? parseInt(entity.properties.frameHeight) : 32,
          framesPerDirection: entity.properties.frames ? parseInt(entity.properties.frames) : 4,
          directions: entity.properties.directions ? parseInt(entity.properties.directions) : 8,
          frameRate: entity.properties.frameRate ? parseInt(entity.properties.frameRate) : 8,
          hasAlpha: true,
        };

        // Create sprite
        const sprite = spriteManager.createSpriteWithSheet(
          `sprite_${entity.properties.targetname || Date.now()}`,
          config
        );

        tagMapOwned(sprite.mesh as any);

        // Set position and scale (default bigger size)
        sprite.position = position;
        sprite.scale = entity.properties.scale ? parseFloat(entity.properties.scale) : 48;

        // Set facing angle
        if (entity.properties.angle) {
          sprite.setFacingDegrees(parseFloat(entity.properties.angle));
        }

        // Enable lighting if requested (default: true for nice effect)
        const receiveLighting = entity.properties.receiveLighting !== "0";
        sprite.receiveLighting = receiveLighting;
        if (entity.properties.ambientLevel) {
          sprite.ambientLevel = parseFloat(entity.properties.ambientLevel);
        }

        // Enable shadow (default: true)
        const castShadow = entity.properties.castShadow !== "0";
        sprite.castShadow = castShadow;
        if (entity.properties.shadowOpacity) {
          sprite.shadowOpacity = parseFloat(entity.properties.shadowOpacity);
        }
        if (entity.properties.shadowScale) {
          sprite.shadowScale = parseFloat(entity.properties.shadowScale);
        }

        // Add default walk animation
        sprite.addAnimation({
          name: "idle",
          startFrame: 0,
          frameCount: config.framesPerDirection,
          loop: true,
        });
        sprite.playAnimation("idle");

        sprites.push(sprite);
        console.log(`Created sprite: ${entity.properties.targetname || "unnamed"} at ${position.toString()}`);
      }

      // Handle entities via EntityHandlerRegistry (game-specific handlers)
      const entityHandler = EntityHandlerRegistry.getHandler(entity.classname);
      if (entityHandler) {
        const entityData: EntityData = {
          classname: entity.classname,
          properties: entity.properties,
          brushes: entity.brushes,
          patches: entity.patches,
        };
        const result = await entityHandler(entityData, scene);
        if (result.handled && result.node) {
          tagMapOwned(result.node as any);
          prefabInstances.push(result.node);
        }
      }

      // Handle info_debris_zone entities (local debris particle spawners)
      if (entity.classname === "info_debris_zone" && entity.properties.origin) {
        const debrisManager = LocalDebrisManager.getInstance();
        debrisManager.init(scene);

        // Parse position
        const parts = entity.properties.origin.split(" ").map(parseFloat);
        const position = new Vector3(parts[0], parts[2], parts[1]);

        // Get zone properties
        const zoneId = entity.properties.targetname || `debris_${Date.now()}`;
        const debrisType = (entity.properties.type || "leaves") as LocalDebrisType;
        const radius = entity.properties.radius ? parseFloat(entity.properties.radius) : 128;
        const height = entity.properties.height ? parseFloat(entity.properties.height) : 64;
        const density = entity.properties.density ? parseFloat(entity.properties.density) : 0.5;
        const windInfluence = entity.properties.windInfluence ? parseFloat(entity.properties.windInfluence) : 0.8;

        // Create the debris zone (only if not indoor)
        if (!indoor) {
          debrisManager.createZone(zoneId, {
            position,
            radius,
            height,
            type: debrisType,
            density,
            windInfluence,
          });
          console.log(`Created debris zone: ${zoneId} (${debrisType}) at ${position.toString()}`);
        }
      }
    }

    // Use ClusteredLightContainer for static point lights
    // This allows many lights without hitting WebGL uniform buffer limits
    if (staticLights.length > 0) {
      if (!scene.metadata) scene.metadata = {};
      const existing = (scene.metadata as any).clusteredLightContainer;
      if (existing && typeof existing.dispose === "function") {
        existing.dispose();
      }
      const clusteredLights = new ClusteredLightContainer("mapLightsCluster", staticLights, scene);
      (scene.metadata as any).clusteredLightContainer = clusteredLights;
      // Configure for orthographic camera compatibility
      // Very few depth slices and coarse tiles minimize artifacts
      clusteredLights.depthSlices = 4;
      clusteredLights.horizontalTiles = 8;
      clusteredLights.verticalTiles = 8;
      // Set max range to match our scene size
      clusteredLights.maxRange = 1000;
      console.log(`Created clustered light container with ${staticLights.length} static lights`);
    }

    return {
      playerStartPosition,
      prefabInstances,
      sprites,
      cameraMode,
      cameraHeight,
      cameraAlpha,
      cameraBeta,
      cameraController,
      playlist,
      indoor,
      lighting,
      weather,
      time
    };
  }

  /**
   * Clears all map-related meshes and lights from a scene.
   */
  public static clearMap(scene: Scene, mapName?: string): void {
    // Dispose sprite buildings first so their trigger/collision meshes are released
    // and do not linger in manager-owned references.
    SpriteBuildingManager.getInstance().dispose();

    const matchesMap = (metadata: any): boolean => {
      if (!metadata?.mapOwned) return false;
      if (!mapName) return true;
      return metadata.mapName === mapName;
    };

    // Collect meshes to dispose first (avoid modifying array during iteration)
    const meshesToDispose = scene.meshes.filter((mesh) =>
      matchesMap(mesh.metadata) ||
      mesh.name === "brush" ||
      mesh.name === "patch" ||
      mesh.name.startsWith("light_") ||
      mesh.name.startsWith("prefab_") ||
      mesh.name.startsWith("sprite_") ||
      mesh.name.startsWith("buildZone_") ||
      mesh.name.startsWith("npc_") ||
      mesh.name.startsWith("character_") ||
      mesh.name.startsWith("trigger_") ||
      // Also catch any mesh with map-related metadata
      mesh.metadata?.properties?.classname
    );

    const instanceManager = InstancedMeshManager.getInstance();
    for (const mesh of meshesToDispose) {
      const instanceId = mesh.metadata?.instanceId;
      if (instanceId && instanceManager.isInitialized()) {
        instanceManager.removeInstance(instanceId);
      } else {
        mesh.dispose();
      }
    }

    // Dispose transform nodes (NPCs, prefabs, etc.)
    const nodesToDispose = scene.transformNodes.filter((node) =>
      matchesMap(node.metadata) ||
      node.name.startsWith("prefab_") ||
      node.name.startsWith("npc_") ||
      node.name.startsWith("character_") ||
      // Also catch any node with NPC metadata
      node.metadata?.npcId
    );

    for (const node of nodesToDispose) {
      node.dispose();
    }

    // Dispose map lights
    const lightsToDispose = scene.lights.filter((light) =>
      matchesMap((light as any).metadata) ||
      light.name.startsWith("light_")
    );

    for (const light of lightsToDispose) {
      light.dispose();
    }

    // Clear street lamps
    StreetLampSystem.getInstance().clear();

    // Clear sprites
    SpriteManager.getInstance().clear();

    // Run pre-render hooks (clears game-specific state like build zones)
    // Note: This is sync clear, pre-render hooks for actual rendering are async
    EntityHandlerRegistry.runPreRenderHooks([], scene);

    // Clear debris zones
    LocalDebrisManager.getInstance().clear();

    const clustered = (scene.metadata as any)?.clusteredLightContainer;
    if (clustered && typeof clustered.dispose === "function") {
      clustered.dispose();
      (scene.metadata as any).clusteredLightContainer = null;
    }

    TextureManager.getInstance().clearCache();
  }
}
