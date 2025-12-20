/**
 * CharacterGenerator - Creates procedural cartoon-style NPC characters
 * 
 * Generates customizable humanoid characters with:
 * - Different body types
 * - Customizable colors (skin, hair, clothes)
 * - Various hairstyles
 * - Accessories
 * - Animated idle/walk states
 */

import {
  Color3,
  Mesh,
  MeshBuilder,
  Scene,
  StandardMaterial,
  TransformNode,
  Vector3,
  Animation,
} from "babylonjs";

// ==================== Types ====================

export interface CharacterColors {
  skin: string;       // Hex color
  hair: string;
  shirt: string;
  pants: string;
  shoes: string;
  eyes?: string;
  accessory?: string;
}

export interface CharacterStyle {
  bodyType: "slim" | "average" | "heavy";
  hairStyle: "short" | "long" | "bald" | "mohawk" | "ponytail" | "afro";
  gender: "male" | "female" | "neutral";
  accessory?: "hat" | "glasses" | "bandana" | "headphones" | "none";
  facialHair?: "none" | "beard" | "mustache" | "goatee";
}

export interface CharacterConfig {
  id: string;
  name: string;
  colors: CharacterColors;
  style: CharacterStyle;
  scale?: number;
  outlineColor?: string;
}

// ==================== Preset Colors ====================

export const SKIN_TONES = {
  light: "#FFE0BD",
  fair: "#FFCD94",
  medium: "#EAC086",
  olive: "#C68642",
  tan: "#8D5524",
  brown: "#6B4423",
  dark: "#3B2219",
};

export const HAIR_COLORS = {
  black: "#1C1C1C",
  brown: "#4A3728",
  blonde: "#D4A76A",
  red: "#8B2500",
  gray: "#808080",
  white: "#E8E8E8",
  blue: "#4169E1",
  pink: "#FF69B4",
  green: "#32CD32",
  purple: "#9932CC",
};

export const SHIRT_COLORS = {
  white: "#FFFFFF",
  black: "#2C2C2C",
  red: "#DC143C",
  blue: "#4169E1",
  green: "#228B22",
  yellow: "#FFD700",
  orange: "#FF8C00",
  purple: "#8B008B",
  pink: "#FF69B4",
  gray: "#696969",
  teal: "#008B8B",
  brown: "#8B4513",
};

// ==================== Character Generator ====================

export class CharacterGenerator {
  private static instance: CharacterGenerator;
  private scene: Scene | null = null;
  private characterCache: Map<string, TransformNode> = new Map();

  private constructor() {}

  public static getInstance(): CharacterGenerator {
    if (!CharacterGenerator.instance) {
      CharacterGenerator.instance = new CharacterGenerator();
    }
    return CharacterGenerator.instance;
  }

  public init(scene: Scene): void {
    this.scene = scene;
  }

  public isInitialized(): boolean {
    return this.scene !== null;
  }

  /**
   * Create a cartoon character mesh
   */
  public createCharacter(config: CharacterConfig): TransformNode | null {
    if (!this.scene) {
      console.error("CharacterGenerator not initialized");
      return null;
    }

    // Note: Caching disabled - BabylonJS TransformNode.clone() doesn't properly
    // clone child mesh materials/visibility. Each character is created fresh.

    const scale = config.scale ?? 1;
    const root = new TransformNode(config.id, this.scene);

    // Create body parts
    const body = this.createBody(config, scale);
    const head = this.createHead(config, scale);
    const hair = this.createHair(config, scale);
    const arms = this.createArms(config, scale);
    const legs = this.createLegs(config, scale);

    // Parent all to root
    body.parent = root;
    head.parent = root;
    hair.parent = root;
    arms.left.parent = root;
    arms.right.parent = root;
    legs.left.parent = root;
    legs.right.parent = root;

    // Add accessory if specified
    if (config.style.accessory && config.style.accessory !== "none") {
      const accessory = this.createAccessory(config, scale);
      if (accessory) {
        accessory.parent = root;
      }
    }

    // Add facial hair if specified
    if (config.style.facialHair && config.style.facialHair !== "none") {
      const facialHair = this.createFacialHair(config, scale);
      if (facialHair) {
        facialHair.parent = root;
      }
    }

    // Create outline effect
    this.addOutline(root, config.outlineColor ?? "#000000", scale);

    // Add idle animation
    this.addIdleAnimation(root, arms, scale);

    return root;
  }

  private createBody(config: CharacterConfig, scale: number): Mesh {
    const { bodyType } = config.style;
    
    // Body dimensions based on type
    const widths = { slim: 0.35, average: 0.45, heavy: 0.55 };
    const width = widths[bodyType] * scale;
    const height = 0.5 * scale;

    // Create torso (rounded box shape using cylinder)
    const body = MeshBuilder.CreateCylinder("body", {
      height,
      diameterTop: width * 0.9,
      diameterBottom: width,
      tessellation: 8,
    }, this.scene!);

    body.position.y = 0.75 * scale;

    // Apply shirt color
    const material = new StandardMaterial("body_mat", this.scene!);
    material.diffuseColor = Color3.FromHexString(config.colors.shirt);
    material.specularColor = new Color3(0.1, 0.1, 0.1);
    material.backFaceCulling = false;
    body.material = material;
    body.isVisible = true;

    return body;
  }

  private createHead(config: CharacterConfig, scale: number): Mesh {
    // Create head as sphere
    const head = MeshBuilder.CreateSphere("head", {
      diameter: 0.4 * scale,
      segments: 12,
    }, this.scene!);

    head.position.y = 1.25 * scale;

    // Apply skin color
    const material = new StandardMaterial("head_mat_" + Math.random(), this.scene!);
    material.diffuseColor = Color3.FromHexString(config.colors.skin);
    material.specularColor = new Color3(0.1, 0.1, 0.1);
    head.material = material;

    // Add eyes
    this.addEyes(head, config, scale);

    // Add mouth
    this.addMouth(head, config, scale);

    return head;
  }

  private addEyes(head: Mesh, config: CharacterConfig, scale: number): void {
    const eyeColor = config.colors.eyes ?? "#2C2C2C";
    const eyeSize = 0.05 * scale;
    const eyeSpacing = 0.08 * scale;
    const eyeHeight = 0.02 * scale;
    const eyeForward = 0.18 * scale;

    // Left eye (white)
    const leftEyeWhite = MeshBuilder.CreateSphere("leftEyeWhite", {
      diameter: eyeSize * 1.5,
      segments: 8,
    }, this.scene!);
    leftEyeWhite.position = new Vector3(-eyeSpacing, eyeHeight, eyeForward);
    leftEyeWhite.parent = head;
    const whiteMat = new StandardMaterial("eyeWhite", this.scene!);
    whiteMat.diffuseColor = Color3.White();
    leftEyeWhite.material = whiteMat;

    // Left pupil
    const leftPupil = MeshBuilder.CreateSphere("leftPupil", {
      diameter: eyeSize,
      segments: 8,
    }, this.scene!);
    leftPupil.position = new Vector3(-eyeSpacing, eyeHeight, eyeForward + 0.02 * scale);
    leftPupil.parent = head;
    const pupilMat = new StandardMaterial("pupil", this.scene!);
    pupilMat.diffuseColor = Color3.FromHexString(eyeColor);
    leftPupil.material = pupilMat;

    // Right eye (white)
    const rightEyeWhite = MeshBuilder.CreateSphere("rightEyeWhite", {
      diameter: eyeSize * 1.5,
      segments: 8,
    }, this.scene!);
    rightEyeWhite.position = new Vector3(eyeSpacing, eyeHeight, eyeForward);
    rightEyeWhite.parent = head;
    rightEyeWhite.material = whiteMat;

    // Right pupil
    const rightPupil = MeshBuilder.CreateSphere("rightPupil", {
      diameter: eyeSize,
      segments: 8,
    }, this.scene!);
    rightPupil.position = new Vector3(eyeSpacing, eyeHeight, eyeForward + 0.02 * scale);
    rightPupil.parent = head;
    rightPupil.material = pupilMat;
  }

  private addMouth(head: Mesh, _config: CharacterConfig, scale: number): void {
    // Simple smile using a flattened torus or box
    const mouth = MeshBuilder.CreateBox("mouth", {
      width: 0.1 * scale,
      height: 0.02 * scale,
      depth: 0.02 * scale,
    }, this.scene!);
    
    mouth.position = new Vector3(0, -0.08 * scale, 0.18 * scale);
    mouth.parent = head;

    const mouthMat = new StandardMaterial("mouth", this.scene!);
    mouthMat.diffuseColor = Color3.FromHexString("#8B0000");
    mouth.material = mouthMat;
  }

  private createHair(config: CharacterConfig, scale: number): Mesh {
    const { hairStyle } = config.style;
    let hair: Mesh;

    switch (hairStyle) {
      case "bald":
        // No hair, create invisible placeholder
        hair = MeshBuilder.CreateBox("hair", { size: 0.01 }, this.scene!);
        hair.isVisible = false;
        break;

      case "short":
        hair = this.createShortHair(scale);
        break;

      case "long":
        hair = this.createLongHair(scale);
        break;

      case "mohawk":
        hair = this.createMohawk(scale);
        break;

      case "ponytail":
        hair = this.createPonytail(scale);
        break;

      case "afro":
        hair = this.createAfro(scale);
        break;

      default:
        hair = this.createShortHair(scale);
    }

    // Apply hair color
    const material = new StandardMaterial("hair_mat", this.scene!);
    material.diffuseColor = Color3.FromHexString(config.colors.hair);
    material.specularColor = new Color3(0.2, 0.2, 0.2);
    hair.material = material;

    return hair;
  }

  private createShortHair(scale: number): Mesh {
    const hair = MeshBuilder.CreateSphere("hair", {
      diameter: 0.42 * scale,
      segments: 12,
      slice: 0.6,
    }, this.scene!);
    hair.position.y = 1.3 * scale;
    hair.rotation.x = -0.3;
    return hair;
  }

  private createLongHair(scale: number): Mesh {
    // Combine top and back
    const top = MeshBuilder.CreateSphere("hairTop", {
      diameter: 0.44 * scale,
      segments: 12,
      slice: 0.6,
    }, this.scene!);
    top.position.y = 1.3 * scale;
    top.rotation.x = -0.3;

    const back = MeshBuilder.CreateCylinder("hairBack", {
      height: 0.4 * scale,
      diameter: 0.3 * scale,
      tessellation: 8,
    }, this.scene!);
    back.position.y = 1.0 * scale;
    back.position.z = -0.1 * scale;

    // Merge meshes
    const hair = Mesh.MergeMeshes([top, back], true, true, undefined, false, true);
    hair!.name = "hair";
    return hair!;
  }

  private createMohawk(scale: number): Mesh {
    const hair = MeshBuilder.CreateBox("hair", {
      width: 0.08 * scale,
      height: 0.25 * scale,
      depth: 0.3 * scale,
    }, this.scene!);
    hair.position.y = 1.45 * scale;
    return hair;
  }

  private createPonytail(scale: number): Mesh {
    const top = MeshBuilder.CreateSphere("hairTop", {
      diameter: 0.42 * scale,
      segments: 12,
      slice: 0.6,
    }, this.scene!);
    top.position.y = 1.3 * scale;
    top.rotation.x = -0.3;

    const tail = MeshBuilder.CreateCylinder("hairTail", {
      height: 0.35 * scale,
      diameterTop: 0.05 * scale,
      diameterBottom: 0.12 * scale,
      tessellation: 8,
    }, this.scene!);
    tail.position.y = 1.1 * scale;
    tail.position.z = -0.2 * scale;
    tail.rotation.x = 0.5;

    const hair = Mesh.MergeMeshes([top, tail], true, true, undefined, false, true);
    hair!.name = "hair";
    return hair!;
  }

  private createAfro(scale: number): Mesh {
    const hair = MeshBuilder.CreateSphere("hair", {
      diameter: 0.6 * scale,
      segments: 12,
    }, this.scene!);
    hair.position.y = 1.35 * scale;
    hair.scaling = new Vector3(1, 0.9, 1);
    return hair;
  }

  private createArms(config: CharacterConfig, scale: number): { left: Mesh; right: Mesh } {
    const { bodyType } = config.style;
    const armWidth = bodyType === "heavy" ? 0.12 : bodyType === "slim" ? 0.08 : 0.1;

    // Left arm
    const leftArm = MeshBuilder.CreateCylinder("leftArm", {
      height: 0.4 * scale,
      diameter: armWidth * scale,
      tessellation: 8,
    }, this.scene!);
    leftArm.position = new Vector3(-0.3 * scale, 0.7 * scale, 0);
    leftArm.rotation.z = 0.2;

    // Right arm
    const rightArm = MeshBuilder.CreateCylinder("rightArm", {
      height: 0.4 * scale,
      diameter: armWidth * scale,
      tessellation: 8,
    }, this.scene!);
    rightArm.position = new Vector3(0.3 * scale, 0.7 * scale, 0);
    rightArm.rotation.z = -0.2;

    // Apply skin color (arms visible below sleeves)
    const material = new StandardMaterial("arm_mat", this.scene!);
    material.diffuseColor = Color3.FromHexString(config.colors.skin);
    material.specularColor = new Color3(0.1, 0.1, 0.1);
    leftArm.material = material;
    rightArm.material = material;

    // Add hands
    this.addHand(leftArm, config, scale, true);
    this.addHand(rightArm, config, scale, false);

    return { left: leftArm, right: rightArm };
  }

  private addHand(arm: Mesh, config: CharacterConfig, scale: number, _isLeft: boolean): void {
    const hand = MeshBuilder.CreateSphere("hand", {
      diameter: 0.1 * scale,
      segments: 8,
    }, this.scene!);
    hand.position.y = -0.22 * scale;
    hand.parent = arm;

    const material = new StandardMaterial("hand_mat", this.scene!);
    material.diffuseColor = Color3.FromHexString(config.colors.skin);
    hand.material = material;
  }

  private createLegs(config: CharacterConfig, scale: number): { left: Mesh; right: Mesh } {
    const { bodyType } = config.style;
    const legWidth = bodyType === "heavy" ? 0.14 : bodyType === "slim" ? 0.1 : 0.12;

    // Left leg
    const leftLeg = MeshBuilder.CreateCylinder("leftLeg", {
      height: 0.45 * scale,
      diameter: legWidth * scale,
      tessellation: 8,
    }, this.scene!);
    leftLeg.position = new Vector3(-0.12 * scale, 0.25 * scale, 0);

    // Right leg
    const rightLeg = MeshBuilder.CreateCylinder("rightLeg", {
      height: 0.45 * scale,
      diameter: legWidth * scale,
      tessellation: 8,
    }, this.scene!);
    rightLeg.position = new Vector3(0.12 * scale, 0.25 * scale, 0);

    // Apply pants color
    const material = new StandardMaterial("leg_mat", this.scene!);
    material.diffuseColor = Color3.FromHexString(config.colors.pants);
    material.specularColor = new Color3(0.1, 0.1, 0.1);
    leftLeg.material = material;
    rightLeg.material = material;

    // Add feet/shoes
    this.addShoe(leftLeg, config, scale);
    this.addShoe(rightLeg, config, scale);

    return { left: leftLeg, right: rightLeg };
  }

  private addShoe(leg: Mesh, config: CharacterConfig, scale: number): void {
    const shoe = MeshBuilder.CreateBox("shoe", {
      width: 0.12 * scale,
      height: 0.06 * scale,
      depth: 0.18 * scale,
    }, this.scene!);
    shoe.position = new Vector3(0, -0.24 * scale, 0.03 * scale);
    shoe.parent = leg;

    const material = new StandardMaterial("shoe_mat", this.scene!);
    material.diffuseColor = Color3.FromHexString(config.colors.shoes);
    shoe.material = material;
  }

  private createAccessory(config: CharacterConfig, scale: number): Mesh | null {
    const { accessory } = config.style;
    let mesh: Mesh | null = null;

    switch (accessory) {
      case "hat":
        mesh = this.createHat(scale);
        break;
      case "glasses":
        mesh = this.createGlasses(scale);
        break;
      case "bandana":
        mesh = this.createBandana(scale);
        break;
      case "headphones":
        mesh = this.createHeadphones(scale);
        break;
    }

    if (mesh && config.colors.accessory) {
      const material = new StandardMaterial("accessory_mat", this.scene!);
      material.diffuseColor = Color3.FromHexString(config.colors.accessory);
      mesh.material = material;
    }

    return mesh;
  }

  private createHat(scale: number): Mesh {
    // Beanie/cap style
    const hat = MeshBuilder.CreateCylinder("hat", {
      height: 0.15 * scale,
      diameterTop: 0.35 * scale,
      diameterBottom: 0.4 * scale,
      tessellation: 12,
    }, this.scene!);
    hat.position.y = 1.5 * scale;
    return hat;
  }

  private createGlasses(scale: number): Mesh {
    // Simple frame
    const frame = MeshBuilder.CreateTorus("glasses", {
      diameter: 0.08 * scale,
      thickness: 0.01 * scale,
      tessellation: 16,
    }, this.scene!);
    frame.position = new Vector3(-0.08 * scale, 1.27 * scale, 0.18 * scale);
    frame.rotation.x = Math.PI / 2;

    const frame2 = MeshBuilder.CreateTorus("glasses2", {
      diameter: 0.08 * scale,
      thickness: 0.01 * scale,
      tessellation: 16,
    }, this.scene!);
    frame2.position = new Vector3(0.08 * scale, 1.27 * scale, 0.18 * scale);
    frame2.rotation.x = Math.PI / 2;

    const bridge = MeshBuilder.CreateBox("bridge", {
      width: 0.08 * scale,
      height: 0.01 * scale,
      depth: 0.01 * scale,
    }, this.scene!);
    bridge.position = new Vector3(0, 1.27 * scale, 0.18 * scale);

    const glasses = Mesh.MergeMeshes([frame, frame2, bridge], true, true, undefined, false, true);
    glasses!.name = "glasses";
    return glasses!;
  }

  private createBandana(scale: number): Mesh {
    const bandana = MeshBuilder.CreateCylinder("bandana", {
      height: 0.08 * scale,
      diameter: 0.42 * scale,
      tessellation: 12,
    }, this.scene!);
    bandana.position.y = 1.35 * scale;
    return bandana;
  }

  private createHeadphones(scale: number): Mesh {
    // Headband
    const band = MeshBuilder.CreateTorus("headband", {
      diameter: 0.4 * scale,
      thickness: 0.02 * scale,
      tessellation: 16,
    }, this.scene!);
    band.position.y = 1.35 * scale;
    band.rotation.z = Math.PI / 2;

    // Ear cups
    const leftCup = MeshBuilder.CreateCylinder("leftCup", {
      height: 0.05 * scale,
      diameter: 0.12 * scale,
      tessellation: 12,
    }, this.scene!);
    leftCup.position = new Vector3(-0.22 * scale, 1.25 * scale, 0);
    leftCup.rotation.z = Math.PI / 2;

    const rightCup = MeshBuilder.CreateCylinder("rightCup", {
      height: 0.05 * scale,
      diameter: 0.12 * scale,
      tessellation: 12,
    }, this.scene!);
    rightCup.position = new Vector3(0.22 * scale, 1.25 * scale, 0);
    rightCup.rotation.z = Math.PI / 2;

    const headphones = Mesh.MergeMeshes([band, leftCup, rightCup], true, true, undefined, false, true);
    headphones!.name = "headphones";
    return headphones!;
  }

  private createFacialHair(config: CharacterConfig, scale: number): Mesh | null {
    const { facialHair } = config.style;
    let mesh: Mesh | null = null;

    switch (facialHair) {
      case "beard":
        mesh = MeshBuilder.CreateSphere("beard", {
          diameter: 0.25 * scale,
          segments: 8,
          slice: 0.5,
        }, this.scene!);
        mesh.position = new Vector3(0, 1.1 * scale, 0.1 * scale);
        mesh.rotation.x = Math.PI;
        break;

      case "mustache":
        mesh = MeshBuilder.CreateBox("mustache", {
          width: 0.15 * scale,
          height: 0.03 * scale,
          depth: 0.03 * scale,
        }, this.scene!);
        mesh.position = new Vector3(0, 1.18 * scale, 0.18 * scale);
        break;

      case "goatee":
        mesh = MeshBuilder.CreateCylinder("goatee", {
          height: 0.1 * scale,
          diameterTop: 0.08 * scale,
          diameterBottom: 0.04 * scale,
          tessellation: 8,
        }, this.scene!);
        mesh.position = new Vector3(0, 1.05 * scale, 0.12 * scale);
        break;
    }

    if (mesh) {
      const material = new StandardMaterial("facialHair_mat", this.scene!);
      material.diffuseColor = Color3.FromHexString(config.colors.hair);
      mesh.material = material;
    }

    return mesh;
  }

  private addOutline(root: TransformNode, color: string, scale: number): void {
    // Add subtle outline by scaling up a dark version behind
    // This is a simple approach - could use edge rendering for better results
    const children = root.getChildMeshes();
    
    for (const mesh of children) {
      if (mesh.name.includes("Eye") || mesh.name.includes("pupil")) continue;
      
      mesh.renderOutline = true;
      mesh.outlineColor = Color3.FromHexString(color);
      mesh.outlineWidth = 0.02 * scale;
    }
  }

  private addIdleAnimation(
    root: TransformNode, 
    arms: { left: Mesh; right: Mesh },
    scale: number
  ): void {
    if (!this.scene) return;

    // Subtle breathing/bobbing animation
    const bobAnimation = new Animation(
      "bob",
      "position.y",
      30,
      Animation.ANIMATIONTYPE_FLOAT,
      Animation.ANIMATIONLOOPMODE_CYCLE
    );

    const bobKeys = [
      { frame: 0, value: root.position.y },
      { frame: 30, value: root.position.y + 0.02 * scale },
      { frame: 60, value: root.position.y },
    ];
    bobAnimation.setKeys(bobKeys);

    root.animations = [bobAnimation];
    this.scene.beginAnimation(root, 0, 60, true);

    // Arm sway
    const armSwayLeft = new Animation(
      "armSwayLeft",
      "rotation.x",
      30,
      Animation.ANIMATIONTYPE_FLOAT,
      Animation.ANIMATIONLOOPMODE_CYCLE
    );
    armSwayLeft.setKeys([
      { frame: 0, value: 0 },
      { frame: 45, value: 0.1 },
      { frame: 90, value: 0 },
    ]);
    arms.left.animations = [armSwayLeft];
    this.scene.beginAnimation(arms.left, 0, 90, true);

    const armSwayRight = new Animation(
      "armSwayRight",
      "rotation.x",
      30,
      Animation.ANIMATIONTYPE_FLOAT,
      Animation.ANIMATIONLOOPMODE_CYCLE
    );
    armSwayRight.setKeys([
      { frame: 0, value: 0 },
      { frame: 45, value: -0.1 },
      { frame: 90, value: 0 },
    ]);
    arms.right.animations = [armSwayRight];
    this.scene.beginAnimation(arms.right, 0, 90, true);
  }

  /**
   * Create a random character with the given name
   */
  public createRandomCharacter(id: string, name: string, scale?: number): TransformNode | null {
    const skinTones = Object.values(SKIN_TONES);
    const hairColors = Object.values(HAIR_COLORS);
    const shirtColors = Object.values(SHIRT_COLORS);
    const hairStyles: CharacterStyle["hairStyle"][] = ["short", "long", "bald", "mohawk", "ponytail", "afro"];
    const bodyTypes: CharacterStyle["bodyType"][] = ["slim", "average", "heavy"];
    const accessories: CharacterStyle["accessory"][] = ["none", "none", "hat", "glasses", "bandana", "headphones"];

    const config: CharacterConfig = {
      id,
      name,
      colors: {
        skin: skinTones[Math.floor(Math.random() * skinTones.length)],
        hair: hairColors[Math.floor(Math.random() * hairColors.length)],
        shirt: shirtColors[Math.floor(Math.random() * shirtColors.length)],
        pants: Math.random() > 0.5 ? "#2C2C2C" : "#1E3A5F",
        shoes: Math.random() > 0.5 ? "#2C2C2C" : "#8B4513",
        accessory: shirtColors[Math.floor(Math.random() * shirtColors.length)],
      },
      style: {
        bodyType: bodyTypes[Math.floor(Math.random() * bodyTypes.length)],
        hairStyle: hairStyles[Math.floor(Math.random() * hairStyles.length)],
        gender: "neutral",
        accessory: accessories[Math.floor(Math.random() * accessories.length)],
      },
      scale,
    };

    return this.createCharacter(config);
  }

  /**
   * Clear character cache
   */
  public clearCache(): void {
    for (const char of this.characterCache.values()) {
      char.dispose();
    }
    this.characterCache.clear();
  }

  public dispose(): void {
    this.clearCache();
    this.scene = null;
  }
}

// ==================== Preset Characters ====================

export const PRESET_CHARACTERS: CharacterConfig[] = [
  {
    id: "dealer_mike",
    name: "Mike",
    colors: {
      skin: SKIN_TONES.medium,
      hair: HAIR_COLORS.black,
      shirt: SHIRT_COLORS.green,
      pants: "#2C2C2C",
      shoes: "#2C2C2C",
      accessory: SHIRT_COLORS.black,
    },
    style: {
      bodyType: "average",
      hairStyle: "short",
      gender: "male",
      accessory: "hat",
    },
  },
  {
    id: "customer_sarah",
    name: "Sarah",
    colors: {
      skin: SKIN_TONES.fair,
      hair: HAIR_COLORS.blonde,
      shirt: SHIRT_COLORS.pink,
      pants: "#1E3A5F",
      shoes: "#FFFFFF",
    },
    style: {
      bodyType: "slim",
      hairStyle: "ponytail",
      gender: "female",
    },
  },
  {
    id: "supplier_tony",
    name: "Tony",
    colors: {
      skin: SKIN_TONES.olive,
      hair: HAIR_COLORS.brown,
      shirt: SHIRT_COLORS.black,
      pants: "#2C2C2C",
      shoes: "#2C2C2C",
      accessory: "#2C2C2C",
    },
    style: {
      bodyType: "heavy",
      hairStyle: "short",
      gender: "male",
      facialHair: "beard",
      accessory: "glasses",
    },
  },
  {
    id: "hipster_alex",
    name: "Alex",
    colors: {
      skin: SKIN_TONES.light,
      hair: HAIR_COLORS.purple,
      shirt: SHIRT_COLORS.teal,
      pants: "#2C2C2C",
      shoes: "#FFFFFF",
      accessory: SHIRT_COLORS.orange,
    },
    style: {
      bodyType: "slim",
      hairStyle: "mohawk",
      gender: "neutral",
      accessory: "headphones",
    },
  },
  {
    id: "reggae_bob",
    name: "Bob",
    colors: {
      skin: SKIN_TONES.brown,
      hair: HAIR_COLORS.black,
      shirt: SHIRT_COLORS.yellow,
      pants: SHIRT_COLORS.green,
      shoes: "#8B4513",
      accessory: SHIRT_COLORS.red,
    },
    style: {
      bodyType: "average",
      hairStyle: "afro",
      gender: "male",
      accessory: "bandana",
    },
  },
];
