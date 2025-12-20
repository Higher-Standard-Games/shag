import {
  ClusteredLightContainer,
  Color3,
  PointLight,
  Scene,
  StandardMaterial,
  type TransformNode,
  Vector3,
} from "babylonjs";
import { BuildingSystem } from "../game/BuildingSystem";
import { BrushGenerator } from "./loader/BrushGenerator";
import type { Entity } from "./loader/MapParser";
import { ModelLoader } from "./loader/ModelLoader";
import { type PatchDefinition, PatchGenerator } from "./loader/PatchGenerator";
import { PrefabInstance } from "./loader/PrefabInstance";
import { TextureManager } from "./loader/TextureManager";
import { type BillboardSprite } from "./sprites/BillboardSprite";
import { SpriteBuildingManager } from "./sprites/SpriteBuilding";
import { SpriteManager } from "./sprites/SpriteManager";
import { 
  CharacterGenerator, 
  PRESET_CHARACTERS, 
  SKIN_TONES, 
  HAIR_COLORS, 
  SHIRT_COLORS,
  type CharacterConfig,
  type CharacterStyle,
} from "../game/CharacterGenerator";
import { SkyLightSystem } from "./lighting/SkyLightSystem";
import { StreetLampSystem } from "./lighting/StreetLampSystem";

export interface MapRenderResult {
  playerStartPosition: Vector3;
  prefabInstances: TransformNode[];
  sprites: BillboardSprite[];
  /** Camera mode specified in worldspawn, or null if not specified */
  cameraMode: "perspective" | "orthographic" | "fake_ortho" | null;
  /** Camera height/distance specified in worldspawn, or null if not specified */
  cameraHeight: number | null;
}

export class MapRenderer {
  /**
   * Renders parsed map entities into a Babylon scene.
   * Returns the player start position if found.
   */
  public static async renderEntities(
    entities: Entity[],
    scene: Scene
  ): Promise<MapRenderResult> {
    const textureManager = TextureManager.getInstance();

    // Ensure TextureManager is initialized for this scene
    if (!textureManager.isInitialized()) {
      textureManager.init(scene);
    }

    let playerStartPosition = new Vector3(0, 10, 0);
    const prefabInstances: TransformNode[] = [];
    const sprites: BillboardSprite[] = [];
    let cameraMode: "perspective" | "orthographic" | "fake_ortho" | null = null;
    let cameraHeight: number | null = null;
    
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
          mesh.metadata = { properties: entity.properties };
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
          // Load as 3D model (GLB/glTF/OBJ)
          const modelLoader = ModelLoader.getInstance();
          
          // Initialize if needed
          if (!modelLoader.isInitialized()) {
            modelLoader.init(scene);
          }

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
            prefabInstances.push(result.root);
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

      // Handle info_npc entities (3D cartoon characters)
      if (entity.classname === "info_npc" && entity.properties.origin) {
        const charGen = CharacterGenerator.getInstance();
        
        // Initialize if needed
        if (!charGen.isInitialized()) {
          charGen.init(scene);
        }

        // Parse position
        const parts = entity.properties.origin.split(" ").map(parseFloat);
        const position = new Vector3(parts[0], parts[2], parts[1]);

        // Get NPC ID and name
        const npcId = entity.properties.targetname || `npc_${Date.now()}`;
        const npcName = entity.properties.name || npcId;

        // Check for preset character
        const presetId = entity.properties.preset;
        let character: TransformNode | null = null;

        // Default scale of 32 to match game world units (characters ~48 units tall)
        const baseScale = entity.properties.scale ? parseFloat(entity.properties.scale) * 32 : 32;

        if (presetId) {
          // Use preset character with world-scale
          const preset = PRESET_CHARACTERS.find(p => p.id === presetId);
          if (preset) {
            const finalScale = baseScale * (preset.scale ?? 1);
            character = charGen.createCharacter({ 
              ...preset, 
              id: npcId,
              scale: finalScale,
            });
          }
        }
        
        if (!character && entity.properties.random === "1") {
          // Generate random character with world-scale
          character = charGen.createRandomCharacter(npcId, npcName, baseScale);
        }
        
        if (!character) {
          // Build custom character from entity properties
          // Default scale of 32 to match game world units (characters ~48 units tall)
          const npcScale = entity.properties.scale ? parseFloat(entity.properties.scale) * 32 : 32;
          const config: CharacterConfig = {
            id: npcId,
            name: npcName,
            colors: {
              skin: entity.properties.skinColor || SKIN_TONES.medium,
              hair: entity.properties.hairColor || HAIR_COLORS.brown,
              shirt: entity.properties.shirtColor || SHIRT_COLORS.blue,
              pants: entity.properties.pantsColor || "#2C2C2C",
              shoes: entity.properties.shoesColor || "#2C2C2C",
              accessory: entity.properties.accessoryColor,
            },
            style: {
              bodyType: (entity.properties.bodyType as CharacterStyle["bodyType"]) || "average",
              hairStyle: (entity.properties.hairStyle as CharacterStyle["hairStyle"]) || "short",
              gender: (entity.properties.gender as CharacterStyle["gender"]) || "neutral",
              accessory: (entity.properties.accessory as CharacterStyle["accessory"]) || "none",
              facialHair: (entity.properties.facialHair as CharacterStyle["facialHair"]) || "none",
            },
            scale: npcScale,
          };
          character = charGen.createCharacter(config);
        }

        if (character) {
          character.position = position;
          
          // Apply rotation
          if (entity.properties.angle) {
            const angle = parseFloat(entity.properties.angle);
            character.rotation.y = (angle * Math.PI) / 180;
          }

          // Store metadata
          character.metadata = {
            npcId,
            npcName,
            properties: entity.properties,
          };

          // Add shadow support for NPC meshes
          const skyLight = SkyLightSystem.getInstance();
          if (skyLight.getShadowGenerator()) {
            const childMeshes = character.getChildMeshes();
            for (const mesh of childMeshes) {
              skyLight.addShadowCaster(mesh, false);
              mesh.receiveShadows = true;
            }
          }

          prefabInstances.push(character);
          console.log(`Created NPC: ${npcName} at ${position.toString()}`);
        }
      }

      // Handle build_zone entities
      if (entity.classname === "build_zone" && entity.properties.origin) {
        const buildingSystem = BuildingSystem.getInstance();

        // Parse position
        const parts = entity.properties.origin.split(" ").map(parseFloat);
        const position = new Vector3(parts[0], parts[2], parts[1]);

        // Get zone properties
        const zoneId = entity.properties.targetname || `zone_${Date.now()}`;
        const zoneType = entity.properties.zoneType || "plant";
        const size = entity.properties.size ? parseFloat(entity.properties.size) : 64;

        // Get current map ID (from entity or default)
        const mapId = entity.properties.mapId || "current";

        // Register the zone
        buildingSystem.registerZone(zoneId, position, size, zoneType, mapId);
      }
    }

    // Use ClusteredLightContainer for static point lights
    // This allows many lights without hitting WebGL uniform buffer limits
    if (staticLights.length > 0) {
      const clusteredLights = new ClusteredLightContainer("mapLightsCluster", staticLights, scene);
      // Configure for orthographic camera compatibility
      // Very few depth slices and coarse tiles minimize artifacts
      clusteredLights.depthSlices = 4;
      clusteredLights.horizontalTiles = 8;
      clusteredLights.verticalTiles = 8;
      // Set max range to match our scene size
      clusteredLights.maxRange = 1000;
      console.log(`Created clustered light container with ${staticLights.length} static lights`);
    }

    return { playerStartPosition, prefabInstances, sprites, cameraMode, cameraHeight };
  }

  /**
   * Clears all map-related meshes and lights from a scene.
   */
  public static clearMap(scene: Scene): void {
    scene.meshes.forEach((mesh) => {
      if (
        mesh.name === "brush" ||
        mesh.name === "patch" ||
        mesh.name.startsWith("light_") ||
        mesh.name.startsWith("prefab_") ||
        mesh.name.startsWith("sprite_") ||
        mesh.name.startsWith("buildZone_")
      ) {
        mesh.dispose();
      }
    });

    // Dispose prefab transform nodes
    scene.transformNodes.forEach((node) => {
      if (node.name.startsWith("prefab_")) {
        node.dispose();
      }
    });

    scene.lights.forEach((light) => {
      if (light.name.startsWith("light_")) {
        light.dispose();
      }
    });

    // Clear sprites
    SpriteManager.getInstance().clear();

    // Clear build zones
    BuildingSystem.getInstance().clearZones();

    TextureManager.getInstance().clearCache();
  }
}
