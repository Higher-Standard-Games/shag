/**
 * EntityHandlers - Game-specific entity handlers for MapRenderer
 * 
 * Registers handlers for game-specific entity types like build_zone and info_npc.
 * This keeps game logic out of the engine while allowing extension.
 * 
 * Usage:
 *   import { registerGameEntityHandlers } from './EntityHandlers';
 *   registerGameEntityHandlers(); // Call once at startup
 */

import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { 
  EntityHandlerRegistry, 
  type EntityData, 
  type EntityHandlerResult 
} from "../../engine/core/EntityHandlerRegistry";
import { SkyLightSystem } from "../../engine/lighting/SkyLightSystem";
import { BuildingSystem } from "./BuildingSystem";
import { 
  CharacterGenerator, 
  PRESET_CHARACTERS, 
  SKIN_TONES, 
  HAIR_COLORS, 
  SHIRT_COLORS,
  type CharacterConfig,
  type CharacterStyle,
} from "./CharacterGenerator";

/**
 * Handler for build_zone entities
 */
function handleBuildZone(entity: EntityData): EntityHandlerResult {
  if (!entity.properties.origin) {
    return { handled: false };
  }

  console.log(`[EntityHandlers] Registering build_zone: ${entity.properties.targetname}`);
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
  console.log(`[EntityHandlers] Zone registered, total zones: ${buildingSystem.getZonesByType(zoneType).length}`);

  return { handled: true };
}

/**
 * Handler for info_npc entities (3D cartoon characters)
 */
async function handleInfoNpc(entity: EntityData, scene: any): Promise<EntityHandlerResult> {
  if (!entity.properties.origin) {
    return { handled: false };
  }

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
  let character: any = null;

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

    console.log(`Created NPC: ${npcName} at ${position.toString()}`);
    return { handled: true, node: character };
  }

  return { handled: false };
}

/**
 * Pre-render hook to clear game-specific state before map load
 */
function clearGameState(): void {
  // Clear build zones
  BuildingSystem.getInstance().clearZones();
}

/**
 * Register all game-specific entity handlers
 * Call this once during game startup
 */
export function registerGameEntityHandlers(): void {
  // Register entity handlers
  EntityHandlerRegistry.register('build_zone', handleBuildZone);
  EntityHandlerRegistry.register('info_npc', handleInfoNpc);
  
  // Register pre-render hook to clear game state
  EntityHandlerRegistry.addPreRenderHook(clearGameState);
  
  console.log('[EntityHandlers] Registered game entity handlers');
}

/**
 * Unregister all game-specific entity handlers
 * Useful for testing or cleanup
 */
export function unregisterGameEntityHandlers(): void {
  EntityHandlerRegistry.unregister('build_zone');
  EntityHandlerRegistry.unregister('info_npc');
  EntityHandlerRegistry.clear();
}
