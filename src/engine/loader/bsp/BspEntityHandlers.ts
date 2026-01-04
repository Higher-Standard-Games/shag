/**
 * BspEntityHandlers - Entity handlers for BSP-specific entities
 * 
 * Registers handlers for Q3/Warsow entities like func_door, func_button, etc.
 * These handlers build brush model meshes and wire up animations.
 */

import { Vector3, Animation, Scene, Mesh } from 'babylonjs';
import { EntityHandlerRegistry, type EntityData, type EntityHandlerResult } from '../../core/EntityHandlerRegistry';
import { buildBrushModel } from './BspMeshBuilder';
import type { BspFile } from './BspLoader';

// Store reference to current BSP for entity handlers
let currentBsp: BspFile | null = null;

/**
 * Set the current BSP for entity handlers to use
 */
export function setCurrentBspForHandlers(bsp: BspFile | null): void {
  currentBsp = bsp;
}

/**
 * Parse model index from Q3 model string (e.g., "*5" -> 5)
 */
function parseModelIndex(modelStr: string): number {
  if (!modelStr || !modelStr.startsWith('*')) return -1;
  return parseInt(modelStr.substring(1), 10);
}

/**
 * Calculate door movement direction from Q3 angle
 * Q3 angles: -1 = UP, -2 = DOWN, positive = horizontal degrees
 */
function getDoorDirection(angle: number): Vector3 {
  if (angle === -1) return new Vector3(0, 1, 0);  // UP
  if (angle === -2) return new Vector3(0, -1, 0); // DOWN
  
  // Horizontal angle (degrees) - convert to radians
  const radians = (angle * Math.PI) / 180;
  return new Vector3(Math.cos(radians), 0, Math.sin(radians));
}

/**
 * Calculate door travel distance from brush bounds
 * Q3 doors move (brush_size - lip) in the specified direction
 */
function getDoorTravelDistance(mesh: Mesh, direction: Vector3, lip: number = 8): number {
  const bounds = mesh.metadata?.modelBounds;
  if (!bounds) return 100; // fallback

  const size = bounds.max.subtract(bounds.min);
  
  // Get size along movement direction
  const absDir = new Vector3(Math.abs(direction.x), Math.abs(direction.y), Math.abs(direction.z));
  const travelSize = size.x * absDir.x + size.y * absDir.y + size.z * absDir.z;
  
  return Math.max(travelSize - lip, 0);
}

/**
 * Create door open/close animation
 */
function createDoorAnimation(
  mesh: Mesh,
  direction: Vector3,
  distance: number,
  speed: number,
  scene: Scene
): { open: () => void; close: () => void; toggle: () => void } {
  const startPos = mesh.position.clone();
  const endPos = startPos.add(direction.scale(distance));
  
  // Calculate duration from speed (units per second)
  const duration = distance / speed;
  const frameRate = 30;
  const totalFrames = Math.ceil(duration * frameRate);

  let isOpen = false;
  let isAnimating = false;

  const openAnim = new Animation(
    `${mesh.name}_open`,
    'position',
    frameRate,
    Animation.ANIMATIONTYPE_VECTOR3,
    Animation.ANIMATIONLOOPMODE_CONSTANT
  );
  openAnim.setKeys([
    { frame: 0, value: startPos },
    { frame: totalFrames, value: endPos },
  ]);

  const closeAnim = new Animation(
    `${mesh.name}_close`,
    'position',
    frameRate,
    Animation.ANIMATIONTYPE_VECTOR3,
    Animation.ANIMATIONLOOPMODE_CONSTANT
  );
  closeAnim.setKeys([
    { frame: 0, value: endPos },
    { frame: totalFrames, value: startPos },
  ]);

  return {
    open: () => {
      if (isOpen || isAnimating) return;
      isAnimating = true;
      mesh.animations = [openAnim];
      scene.beginAnimation(mesh, 0, totalFrames, false, 1, () => {
        isOpen = true;
        isAnimating = false;
      });
    },
    close: () => {
      if (!isOpen || isAnimating) return;
      isAnimating = true;
      mesh.animations = [closeAnim];
      scene.beginAnimation(mesh, 0, totalFrames, false, 1, () => {
        isOpen = false;
        isAnimating = false;
      });
    },
    toggle: () => {
      if (isAnimating) return;
      if (isOpen) {
        closeAnim.setKeys([
          { frame: 0, value: mesh.position.clone() },
          { frame: totalFrames, value: startPos },
        ]);
        mesh.animations = [closeAnim];
        isAnimating = true;
        scene.beginAnimation(mesh, 0, totalFrames, false, 1, () => {
          isOpen = false;
          isAnimating = false;
        });
      } else {
        openAnim.setKeys([
          { frame: 0, value: mesh.position.clone() },
          { frame: totalFrames, value: endPos },
        ]);
        mesh.animations = [openAnim];
        isAnimating = true;
        scene.beginAnimation(mesh, 0, totalFrames, false, 1, () => {
          isOpen = true;
          isAnimating = false;
        });
      }
    },
  };
}

// Store door controllers for console access (grouped by targetname)
interface DoorGroup {
  controllers: ReturnType<typeof createDoorAnimation>[];
  open: () => void;
  close: () => void;
  toggle: () => void;
}

const doorGroups: Map<string, DoorGroup> = new Map();

/**
 * Get door controller by targetname (returns group controller)
 */
export function getDoorController(targetname: string): DoorGroup | undefined {
  return doorGroups.get(targetname);
}

/**
 * Get all door targetnames
 */
export function getDoorNames(): string[] {
  return Array.from(doorGroups.keys());
}

/**
 * Add a door to a group (or create new group)
 */
function addDoorToGroup(targetname: string, controller: ReturnType<typeof createDoorAnimation>): void {
  let group = doorGroups.get(targetname);
  if (!group) {
    group = {
      controllers: [],
      open: () => group!.controllers.forEach(c => c.open()),
      close: () => group!.controllers.forEach(c => c.close()),
      toggle: () => group!.controllers.forEach(c => c.toggle()),
    };
    doorGroups.set(targetname, group);
  }
  group.controllers.push(controller);
}

/**
 * func_door handler
 */
async function handleFuncDoor(entity: EntityData, scene: Scene): Promise<EntityHandlerResult> {
  if (!currentBsp) {
    console.warn('[BspEntityHandlers] No BSP loaded for func_door');
    return { handled: false };
  }

  const modelStr = entity.properties.model;
  const modelIndex = parseModelIndex(modelStr);
  
  if (modelIndex < 0) {
    console.warn(`[BspEntityHandlers] func_door has invalid model: ${modelStr}`);
    return { handled: false };
  }

  const targetname = entity.properties.targetname || `door_${modelIndex}`;
  const angle = parseFloat(entity.properties.angle) || 0;
  const speed = parseFloat(entity.properties.speed) || 200;
  const lip = parseFloat(entity.properties.lip) || 8;

  // Build the door mesh (async - loads textures)
  const mesh = await buildBrushModel(currentBsp, modelIndex, scene, `func_door_${targetname}`);
  if (!mesh) {
    console.warn(`[BspEntityHandlers] Failed to build mesh for func_door model *${modelIndex}`);
    return { handled: false };
  }

  // Calculate movement
  const direction = getDoorDirection(angle);
  const distance = getDoorTravelDistance(mesh, direction, lip);

  // Create animation controller
  const controller = createDoorAnimation(mesh, direction, distance, speed, scene);
  addDoorToGroup(targetname, controller);

  // Store controller in mesh metadata for easy access
  mesh.metadata = {
    ...mesh.metadata,
    entityType: 'func_door',
    targetname,
    doorController: controller,
  };

  console.log(`[BspEntityHandlers] Created func_door "${targetname}": model=*${modelIndex}, angle=${angle}, speed=${speed}, distance=${distance.toFixed(0)}`);

  return { handled: true, node: mesh };
}

/**
 * Register all BSP entity handlers
 */
export function registerBspEntityHandlers(): void {
  EntityHandlerRegistry.register('func_door', handleFuncDoor);
  console.log('[BspEntityHandlers] Registered BSP entity handlers: func_door');
}

/**
 * Unregister BSP entity handlers
 */
export function unregisterBspEntityHandlers(): void {
  EntityHandlerRegistry.unregister('func_door');
  doorGroups.clear();
}
