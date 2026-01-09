/**
 * GeneticsSystem - Generic plant genetics and breeding system
 * 
 * Features:
 * - Strain properties (effects, flavors, potency, etc.)
 * - Genetic traits with inheritance
 * - Crossbreeding with genetic mixing
 * - Strain family trees
 * - Phenotype variation
 * - Seed generation from breeding
 */

import { GameState } from "./GameState";

// ==================== Types ====================

/**
 * Effect types (like Leafly)
 */
export type EffectType = 
  | "relaxed" | "euphoric" | "happy" | "uplifted" | "creative"
  | "energetic" | "focused" | "tingly" | "giggly" | "hungry"
  | "sleepy" | "talkative";

export type NegativeEffectType =
  | "dry_mouth" | "dry_eyes" | "paranoid" | "anxious" 
  | "dizzy" | "headache";

export type FlavorType =
  | "earthy" | "sweet" | "citrus" | "berry" | "pine"
  | "woody" | "spicy" | "herbal" | "floral" | "tropical"
  | "grape" | "lemon" | "orange" | "mint" | "vanilla"
  | "coffee" | "diesel" | "skunk" | "cheese" | "pungent";

export type TerpeneType =
  | "myrcene" | "limonene" | "caryophyllene" | "pinene"
  | "linalool" | "humulene" | "terpinolene" | "ocimene";

export type StrainType = "indica" | "sativa" | "hybrid";

/**
 * Genetic tier - determines unlock requirements and value
 */
export type GeneticTier = 1 | 2 | 3 | 4 | 5;

/**
 * Special genetic traits that can be bred for
 * These are rare and valuable
 */
export type SpecialTrait = 
  | "auto_flower"        // Flowers regardless of light cycle
  | "high_thc"           // THC > 25%
  | "high_cbd"           // CBD > 15%
  | "fast_flower"        // Flowering time reduced 20%
  | "heavy_yield"        // Yield increased 30%
  | "purple_pheno"       // Purple coloration
  | "frost_giant"        // Extra trichome coverage
  | "pest_immune"        // 100% pest resistance
  | "drought_master"     // Minimal water needs
  | "compact_growth"     // Short but dense
  | "giant_growth"       // Extra tall
  | "exotic_flavor"      // Unique flavor profile
  | "balanced_hybrid"    // Perfect 50/50 split
  | "medicinal"          // High therapeutic value
  | "connoisseur";       // Perfect quality score

/**
 * Breeding challenge/goal
 */
export interface BreedingChallenge {
  id: string;
  name: string;
  description: string;
  requirements: {
    minThc?: number;
    minCbd?: number;
    minYield?: number;
    maxFloweringTime?: number;
    requiredEffects?: EffectType[];
    requiredFlavors?: FlavorType[];
    requiredTraits?: SpecialTrait[];
    requiredType?: StrainType;
    minIndicaPercent?: number;
    maxIndicaPercent?: number;
  };
  reward: {
    xp: number;
    money: number;
    unlockTier?: GeneticTier;
    unlockStrain?: string;
    title?: string;
  };
  tier: GeneticTier;
  isCompleted?: boolean;
}

/**
 * Growth characteristics
 */
export interface GrowthTraits {
  floweringTime: number;      // Days to flower (game days)
  yieldPotential: number;     // 0-100
  heightPotential: number;    // 0-100 (short to tall)
  difficulty: number;         // 0-100 (easy to hard)
  moldResistance: number;     // 0-100
  pestResistance: number;     // 0-100
  droughtTolerance: number;   // 0-100
}

/**
 * Visual appearance traits
 */
export interface AppearanceTraits {
  budDensity: number;         // 0-100 (fluffy to dense)
  trichomeCoverage: number;   // 0-100
  purpleExpression: number;   // 0-100 (green to purple)
  orangeHairs: number;        // 0-100
}

/**
 * Complete strain genetics profile
 */
export interface StrainGenetics {
  id: string;
  name: string;
  description: string;
  
  // Classification
  type: StrainType;
  indicaPercent: number; // 0-100 (sativa = 100 - indica)
  
  // Potency (0-100 scale, representing %)
  thcContent: number;
  cbdContent: number;
  
  // Effects (0-100 intensity for each)
  effects: Partial<Record<EffectType, number>>;
  negativeEffects: Partial<Record<NegativeEffectType, number>>;
  
  // Flavors (0-100 intensity)
  flavors: Partial<Record<FlavorType, number>>;
  
  // Terpene profile (0-100)
  terpenes: Partial<Record<TerpeneType, number>>;
  
  // Growth characteristics
  growthTraits: GrowthTraits;
  
  // Appearance
  appearance: AppearanceTraits;
  
  // Genetic lineage
  lineage: StrainLineage;
  
  // Rarity and value
  rarity: "common" | "uncommon" | "rare" | "legendary" | "unique";
  basePrice: number;
  
  // Is this a landrace (original) strain?
  isLandrace: boolean;
  
  // Genetic tier (1-5, determines unlock requirements)
  tier: GeneticTier;
  
  // Special traits this strain has
  specialTraits: SpecialTrait[];
  
  // Required player level to obtain seeds
  unlockLevel: number;
  
  // Custom metadata
  metadata?: Record<string, unknown>;
}

/**
 * Strain lineage/family tree
 */
export interface StrainLineage {
  parent1Id?: string;         // Mother strain
  parent2Id?: string;         // Father strain
  generation: number;         // F1, F2, etc. (0 = landrace)
  isStabilized: boolean;      // True if bred for consistency
  breederName?: string;       // Who created this strain
  createdAt?: number;         // When it was created
  originRegion?: string;      // Geographic origin for landraces
}

/**
 * A seed with genetic information
 */
export interface GeneticSeed {
  id: string;
  strainId: string;
  
  // Seeds can have phenotype variation
  phenotypeVariation: number; // 0-1, how much it varies from parent
  
  // Specific trait modifiers for this seed
  traitModifiers: Partial<{
    thc: number;              // -10 to +10 modifier
    cbd: number;
    yield: number;
    floweringTime: number;
    effects: Partial<Record<EffectType, number>>;
  }>;
  
  // Breeding info
  isFeminized: boolean;
  isAutoflower: boolean;
  
  // Quality
  viability: number;          // 0-100, chance to germinate
  
  createdAt: number;
}

/**
 * Breeding result
 */
export interface BreedingResult {
  success: boolean;
  seeds: GeneticSeed[];
  childStrainId?: string;     // If a new strain was created
  message: string;
}

/**
 * Breeding pair info
 */
export interface BreedingPair {
  mother: StrainGenetics;
  father: StrainGenetics;
  compatibility: number;      // 0-100
  predictedTraits: Partial<StrainGenetics>;
}

type GeneticsEventCallback = (event: string, data: unknown) => void;

// ==================== GeneticsSystem ====================

export class GeneticsSystem {
  private static instance: GeneticsSystem;
  
  // Registered strain genetics
  private strains: Map<string, StrainGenetics> = new Map();
  
  // Player-created strains
  private customStrains: Map<string, StrainGenetics> = new Map();
  
  // Strain family tree cache
  private familyTrees: Map<string, string[]> = new Map();
  
  // Event listeners
  private listeners: GeneticsEventCallback[] = [];
  
  private constructor() {}
  
  public static getInstance(): GeneticsSystem {
    if (!GeneticsSystem.instance) {
      GeneticsSystem.instance = new GeneticsSystem();
    }
    return GeneticsSystem.instance;
  }
  
  public static resetInstance(): void {
    GeneticsSystem.instance = null as any;
  }
  
  // ==================== Registration ====================
  
  public registerStrain(strain: StrainGenetics): void {
    this.strains.set(strain.id, strain);
    this.updateFamilyTree(strain);
  }
  
  public registerStrains(strains: StrainGenetics[]): void {
    for (const strain of strains) {
      this.registerStrain(strain);
    }
    console.log(`GeneticsSystem: Registered ${strains.length} strains`);
  }
  
  // ==================== Getters ====================
  
  public getStrain(id: string): StrainGenetics | undefined {
    return this.strains.get(id) || this.customStrains.get(id);
  }
  
  public getAllStrains(): StrainGenetics[] {
    return [
      ...Array.from(this.strains.values()),
      ...Array.from(this.customStrains.values()),
    ];
  }
  
  public getStrainsByType(type: StrainType): StrainGenetics[] {
    return this.getAllStrains().filter(s => s.type === type);
  }
  
  public getStrainsByRarity(rarity: StrainGenetics["rarity"]): StrainGenetics[] {
    return this.getAllStrains().filter(s => s.rarity === rarity);
  }
  
  public getLandraceStrains(): StrainGenetics[] {
    return this.getAllStrains().filter(s => s.isLandrace);
  }
  
  public getCustomStrains(): StrainGenetics[] {
    return Array.from(this.customStrains.values());
  }
  
  // ==================== Trait Calculations ====================
  
  /**
   * Get the dominant effects for a strain (top 3)
   */
  public getDominantEffects(strainId: string): Array<{ effect: EffectType; intensity: number }> {
    const strain = this.getStrain(strainId);
    if (!strain) return [];
    
    return Object.entries(strain.effects)
      .map(([effect, intensity]) => ({ effect: effect as EffectType, intensity: intensity || 0 }))
      .sort((a, b) => b.intensity - a.intensity)
      .slice(0, 3);
  }
  
  /**
   * Get the dominant flavors for a strain (top 3)
   */
  public getDominantFlavors(strainId: string): Array<{ flavor: FlavorType; intensity: number }> {
    const strain = this.getStrain(strainId);
    if (!strain) return [];
    
    return Object.entries(strain.flavors)
      .map(([flavor, intensity]) => ({ flavor: flavor as FlavorType, intensity: intensity || 0 }))
      .sort((a, b) => b.intensity - a.intensity)
      .slice(0, 3);
  }
  
  /**
   * Get the dominant terpenes for a strain
   */
  public getDominantTerpenes(strainId: string): Array<{ terpene: TerpeneType; level: number }> {
    const strain = this.getStrain(strainId);
    if (!strain) return [];
    
    return Object.entries(strain.terpenes)
      .map(([terpene, level]) => ({ terpene: terpene as TerpeneType, level: level || 0 }))
      .sort((a, b) => b.level - a.level)
      .slice(0, 3);
  }
  
  /**
   * Calculate overall quality score (0-100)
   */
  public calculateQualityScore(strainId: string): number {
    const strain = this.getStrain(strainId);
    if (!strain) return 0;
    
    // Weight different factors
    const thcScore = strain.thcContent * 0.3;
    const effectScore = Math.min(100, Object.values(strain.effects).reduce((a, b) => a + (b || 0), 0) / 3) * 0.2;
    const flavorScore = Math.min(100, Object.values(strain.flavors).reduce((a, b) => a + (b || 0), 0) / 3) * 0.15;
    const yieldScore = strain.growthTraits.yieldPotential * 0.15;
    const appearanceScore = (strain.appearance.trichomeCoverage + strain.appearance.budDensity) / 2 * 0.2;
    
    return Math.round(thcScore + effectScore + flavorScore + yieldScore + appearanceScore);
  }
  
  // ==================== Breeding ====================
  
  /**
   * Check breeding compatibility between two strains
   */
  public getBreedingCompatibility(strain1Id: string, strain2Id: string): BreedingPair | null {
    const mother = this.getStrain(strain1Id);
    const father = this.getStrain(strain2Id);
    
    if (!mother || !father) return null;
    
    // Calculate compatibility based on genetic distance
    const typeDiff = Math.abs(mother.indicaPercent - father.indicaPercent);
    const thcDiff = Math.abs(mother.thcContent - father.thcContent);
    
    // More different = more interesting offspring but lower compatibility
    const compatibility = 100 - (typeDiff * 0.3 + thcDiff * 0.2);
    
    // Predict offspring traits
    const predictedTraits = this.predictOffspringTraits(mother, father);
    
    return {
      mother,
      father,
      compatibility: Math.max(0, Math.min(100, compatibility)),
      predictedTraits,
    };
  }
  
  /**
   * Predict offspring traits (with variance)
   */
  private predictOffspringTraits(mother: StrainGenetics, father: StrainGenetics): Partial<StrainGenetics> {
    return {
      type: this.predictType(mother, father),
      indicaPercent: (mother.indicaPercent + father.indicaPercent) / 2,
      thcContent: (mother.thcContent + father.thcContent) / 2,
      cbdContent: (mother.cbdContent + father.cbdContent) / 2,
      effects: this.blendEffects(mother.effects, father.effects),
      flavors: this.blendFlavors(mother.flavors, father.flavors),
    };
  }
  
  private predictType(mother: StrainGenetics, father: StrainGenetics): StrainType {
    const avgIndica = (mother.indicaPercent + father.indicaPercent) / 2;
    if (avgIndica >= 70) return "indica";
    if (avgIndica <= 30) return "sativa";
    return "hybrid";
  }
  
  private blendEffects(
    effects1: Partial<Record<EffectType, number>>,
    effects2: Partial<Record<EffectType, number>>
  ): Partial<Record<EffectType, number>> {
    const result: Partial<Record<EffectType, number>> = {};
    const allEffects = new Set([...Object.keys(effects1), ...Object.keys(effects2)]);
    
    for (const effect of allEffects) {
      const e = effect as EffectType;
      const val1 = effects1[e] || 0;
      const val2 = effects2[e] || 0;
      
      // Average with some randomness
      if (val1 > 0 || val2 > 0) {
        result[e] = Math.round((val1 + val2) / 2);
      }
    }
    
    return result;
  }
  
  private blendFlavors(
    flavors1: Partial<Record<FlavorType, number>>,
    flavors2: Partial<Record<FlavorType, number>>
  ): Partial<Record<FlavorType, number>> {
    const result: Partial<Record<FlavorType, number>> = {};
    const allFlavors = new Set([...Object.keys(flavors1), ...Object.keys(flavors2)]);
    
    for (const flavor of allFlavors) {
      const f = flavor as FlavorType;
      const val1 = flavors1[f] || 0;
      const val2 = flavors2[f] || 0;
      
      if (val1 > 0 || val2 > 0) {
        result[f] = Math.round((val1 + val2) / 2);
      }
    }
    
    return result;
  }
  
  /**
   * Breed two strains to create seeds
   */
  public breed(
    motherStrainId: string,
    fatherStrainId: string,
    options?: {
      seedCount?: number;
      createNewStrain?: boolean;
      newStrainName?: string;
    }
  ): BreedingResult {
    const mother = this.getStrain(motherStrainId);
    const father = this.getStrain(fatherStrainId);
    
    if (!mother || !father) {
      return { success: false, seeds: [], message: "Invalid parent strains" };
    }
    
    const seedCount = options?.seedCount || 5 + Math.floor(Math.random() * 6); // 5-10 seeds
    const seeds: GeneticSeed[] = [];
    
    // Generate seeds with phenotype variation
    for (let i = 0; i < seedCount; i++) {
      const seed = this.generateSeed(mother, father);
      seeds.push(seed);
    }
    
    let childStrainId: string | undefined;
    
    // Optionally create a new strain
    if (options?.createNewStrain && options.newStrainName) {
      const newStrain = this.createChildStrain(mother, father, options.newStrainName);
      this.customStrains.set(newStrain.id, newStrain);
      childStrainId = newStrain.id;
      
      // Update seeds to reference new strain
      for (const seed of seeds) {
        seed.strainId = newStrain.id;
      }
      
      this.emit("strain_created", { strain: newStrain, parents: [mother.id, father.id] });
    }
    
    this.emit("breeding_complete", { 
      mother: mother.id, 
      father: father.id, 
      seedCount: seeds.length,
      childStrainId,
    });
    
    // Add seeds to inventory
    const state = GameState.getInstance();
    for (const seed of seeds) {
      state.setCustomData(`seed_${seed.id}`, seed);
    }
    state.addItem(seeds[0].strainId + "_seed", "seed", seeds.length);
    
    return {
      success: true,
      seeds,
      childStrainId,
      message: `Successfully bred ${seeds.length} seeds!`,
    };
  }
  
  /**
   * Generate a single seed from two parents
   */
  private generateSeed(mother: StrainGenetics, father: StrainGenetics): GeneticSeed {
    const id = `seed_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    // Calculate phenotype variation (more variation for unstabilized strains)
    const stabilityFactor = (mother.lineage.isStabilized && father.lineage.isStabilized) ? 0.1 : 0.3;
    const phenotypeVariation = Math.random() * stabilityFactor;
    
    // Generate trait modifiers
    const traitModifiers: GeneticSeed["traitModifiers"] = {
      thc: this.randomModifier(5),
      cbd: this.randomModifier(3),
      yield: this.randomModifier(10),
      floweringTime: this.randomModifier(2),
    };
    
    return {
      id,
      strainId: mother.id, // Default to mother's strain
      phenotypeVariation,
      traitModifiers,
      isFeminized: Math.random() > 0.5, // 50% chance feminized
      isAutoflower: mother.growthTraits.floweringTime < 50 || father.growthTraits.floweringTime < 50,
      viability: 70 + Math.floor(Math.random() * 30), // 70-100%
      createdAt: Date.now(),
    };
  }
  
  private randomModifier(range: number): number {
    return Math.round((Math.random() * 2 - 1) * range);
  }
  
  /**
   * Create a new child strain from two parents
   */
  private createChildStrain(
    mother: StrainGenetics,
    father: StrainGenetics,
    name: string
  ): StrainGenetics {
    const id = `strain_custom_${Date.now()}`;
    
    // Blend genetics with some randomness
    const variance = () => 0.8 + Math.random() * 0.4; // 0.8-1.2 multiplier
    
    const indicaPercent = Math.round(
      ((mother.indicaPercent + father.indicaPercent) / 2) * variance()
    );
    
    const thcContent = Math.round(
      ((mother.thcContent + father.thcContent) / 2) * variance()
    );
    
    const cbdContent = Math.round(
      ((mother.cbdContent + father.cbdContent) / 2) * variance()
    );
    
    // Blend growth traits
    const growthTraits: GrowthTraits = {
      floweringTime: Math.round((mother.growthTraits.floweringTime + father.growthTraits.floweringTime) / 2),
      yieldPotential: Math.round(((mother.growthTraits.yieldPotential + father.growthTraits.yieldPotential) / 2) * variance()),
      heightPotential: Math.round((mother.growthTraits.heightPotential + father.growthTraits.heightPotential) / 2),
      difficulty: Math.round((mother.growthTraits.difficulty + father.growthTraits.difficulty) / 2),
      moldResistance: Math.round(((mother.growthTraits.moldResistance + father.growthTraits.moldResistance) / 2) * variance()),
      pestResistance: Math.round(((mother.growthTraits.pestResistance + father.growthTraits.pestResistance) / 2) * variance()),
      droughtTolerance: Math.round((mother.growthTraits.droughtTolerance + father.growthTraits.droughtTolerance) / 2),
    };
    
    // Blend appearance
    const appearance: AppearanceTraits = {
      budDensity: Math.round((mother.appearance.budDensity + father.appearance.budDensity) / 2),
      trichomeCoverage: Math.round(((mother.appearance.trichomeCoverage + father.appearance.trichomeCoverage) / 2) * variance()),
      purpleExpression: Math.max(mother.appearance.purpleExpression, father.appearance.purpleExpression) * (Math.random() > 0.5 ? 1 : 0.5),
      orangeHairs: Math.round((mother.appearance.orangeHairs + father.appearance.orangeHairs) / 2),
    };
    
    // Blend terpenes
    const terpenes: Partial<Record<TerpeneType, number>> = {};
    const allTerpenes = new Set([...Object.keys(mother.terpenes), ...Object.keys(father.terpenes)]);
    for (const terpene of allTerpenes) {
      const t = terpene as TerpeneType;
      const val1 = mother.terpenes[t] || 0;
      const val2 = father.terpenes[t] || 0;
      terpenes[t] = Math.round(((val1 + val2) / 2) * variance());
    }
    
    // Calculate rarity based on parent rarity
    const rarityOrder = ["common", "uncommon", "rare", "legendary", "unique"] as const;
    const motherRarityIdx = rarityOrder.indexOf(mother.rarity);
    const fatherRarityIdx = rarityOrder.indexOf(father.rarity);
    const avgRarityIdx = Math.floor((motherRarityIdx + fatherRarityIdx) / 2);
    // Chance to be rarer than parents
    const rarityIdx = Math.random() > 0.8 ? Math.min(avgRarityIdx + 1, 4) : avgRarityIdx;
    
    // Calculate tier based on parents and generation
    const baseTier = Math.max(mother.tier, father.tier);
    const generation = Math.max(mother.lineage.generation, father.lineage.generation) + 1;
    const tier = Math.min(5, baseTier + (generation >= 4 ? 1 : 0)) as GeneticTier;
    
    // Determine special traits (inherited + newly developed)
    const specialTraits = this.calculateSpecialTraits(
      mother, father, thcContent, cbdContent, growthTraits, appearance, indicaPercent
    );
    
    return {
      id,
      name,
      description: `A custom hybrid of ${mother.name} and ${father.name}`,
      type: this.predictType(mother, father),
      indicaPercent: Math.max(0, Math.min(100, indicaPercent)),
      thcContent: Math.max(0, Math.min(35, thcContent)),
      cbdContent: Math.max(0, Math.min(20, cbdContent)),
      effects: this.blendEffects(mother.effects, father.effects),
      negativeEffects: this.blendNegativeEffects(mother.negativeEffects, father.negativeEffects),
      flavors: this.blendFlavors(mother.flavors, father.flavors),
      terpenes,
      growthTraits,
      appearance,
      lineage: {
        parent1Id: mother.id,
        parent2Id: father.id,
        generation,
        isStabilized: false,
        breederName: "Player",
        createdAt: Date.now(),
      },
      rarity: rarityOrder[rarityIdx],
      basePrice: Math.round((mother.basePrice + father.basePrice) / 2 * (1 + rarityIdx * 0.2) * (1 + specialTraits.length * 0.1)),
      isLandrace: false,
      tier,
      specialTraits,
      unlockLevel: tier * 2, // Tier 1 = level 2, Tier 5 = level 10
    };
  }
  
  /**
   * Calculate special traits for a new strain
   */
  private calculateSpecialTraits(
    mother: StrainGenetics,
    father: StrainGenetics,
    thc: number,
    cbd: number,
    growth: GrowthTraits,
    appearance: AppearanceTraits,
    indicaPercent: number
  ): SpecialTrait[] {
    const traits: SpecialTrait[] = [];
    
    // Inherit traits from parents (50% chance each)
    for (const trait of mother.specialTraits) {
      if (Math.random() > 0.5 && !traits.includes(trait)) {
        traits.push(trait);
      }
    }
    for (const trait of father.specialTraits) {
      if (Math.random() > 0.5 && !traits.includes(trait)) {
        traits.push(trait);
      }
    }
    
    // Check for newly developed traits based on stats
    if (thc >= 25 && !traits.includes("high_thc")) {
      traits.push("high_thc");
    }
    if (cbd >= 15 && !traits.includes("high_cbd")) {
      traits.push("high_cbd");
    }
    if (growth.floweringTime <= 45 && !traits.includes("fast_flower")) {
      traits.push("fast_flower");
    }
    if (growth.yieldPotential >= 85 && !traits.includes("heavy_yield")) {
      traits.push("heavy_yield");
    }
    if (appearance.purpleExpression >= 70 && !traits.includes("purple_pheno")) {
      traits.push("purple_pheno");
    }
    if (appearance.trichomeCoverage >= 90 && !traits.includes("frost_giant")) {
      traits.push("frost_giant");
    }
    if (growth.pestResistance >= 95 && !traits.includes("pest_immune")) {
      traits.push("pest_immune");
    }
    if (growth.droughtTolerance >= 90 && !traits.includes("drought_master")) {
      traits.push("drought_master");
    }
    if (growth.heightPotential <= 30 && growth.yieldPotential >= 70 && !traits.includes("compact_growth")) {
      traits.push("compact_growth");
    }
    if (growth.heightPotential >= 90 && !traits.includes("giant_growth")) {
      traits.push("giant_growth");
    }
    if (indicaPercent >= 45 && indicaPercent <= 55 && !traits.includes("balanced_hybrid")) {
      traits.push("balanced_hybrid");
    }
    if (cbd >= 10 && thc >= 10 && !traits.includes("medicinal")) {
      traits.push("medicinal");
    }
    
    return traits;
  }
  
  private blendNegativeEffects(
    effects1: Partial<Record<NegativeEffectType, number>>,
    effects2: Partial<Record<NegativeEffectType, number>>
  ): Partial<Record<NegativeEffectType, number>> {
    const result: Partial<Record<NegativeEffectType, number>> = {};
    const allEffects = new Set([...Object.keys(effects1), ...Object.keys(effects2)]);
    
    for (const effect of allEffects) {
      const e = effect as NegativeEffectType;
      const val1 = effects1[e] || 0;
      const val2 = effects2[e] || 0;
      
      // Take the lower of the two (breeding can reduce negatives)
      if (val1 > 0 || val2 > 0) {
        result[e] = Math.round(Math.min(val1, val2) + Math.abs(val1 - val2) * 0.3);
      }
    }
    
    return result;
  }
  
  // ==================== Family Tree ====================
  
  /**
   * Get the complete family tree for a strain
   */
  public getFamilyTree(strainId: string): StrainGenetics[] {
    const strain = this.getStrain(strainId);
    if (!strain) return [];
    
    const tree: StrainGenetics[] = [strain];
    const visited = new Set<string>([strainId]);
    
    const addParents = (s: StrainGenetics) => {
      if (s.lineage.parent1Id && !visited.has(s.lineage.parent1Id)) {
        const parent1 = this.getStrain(s.lineage.parent1Id);
        if (parent1) {
          visited.add(parent1.id);
          tree.push(parent1);
          addParents(parent1);
        }
      }
      if (s.lineage.parent2Id && !visited.has(s.lineage.parent2Id)) {
        const parent2 = this.getStrain(s.lineage.parent2Id);
        if (parent2) {
          visited.add(parent2.id);
          tree.push(parent2);
          addParents(parent2);
        }
      }
    };
    
    addParents(strain);
    return tree;
  }
  
  /**
   * Get direct children of a strain
   */
  public getChildren(strainId: string): StrainGenetics[] {
    return this.getAllStrains().filter(s => 
      s.lineage.parent1Id === strainId || s.lineage.parent2Id === strainId
    );
  }
  
  /**
   * Get siblings (strains with same parents)
   */
  public getSiblings(strainId: string): StrainGenetics[] {
    const strain = this.getStrain(strainId);
    if (!strain || !strain.lineage.parent1Id || !strain.lineage.parent2Id) return [];
    
    return this.getAllStrains().filter(s => 
      s.id !== strainId &&
      s.lineage.parent1Id === strain.lineage.parent1Id &&
      s.lineage.parent2Id === strain.lineage.parent2Id
    );
  }
  
  /**
   * Update family tree cache
   */
  private updateFamilyTree(strain: StrainGenetics): void {
    const ancestors: string[] = [];
    
    const addAncestors = (s: StrainGenetics) => {
      if (s.lineage.parent1Id) {
        ancestors.push(s.lineage.parent1Id);
        const parent = this.getStrain(s.lineage.parent1Id);
        if (parent) addAncestors(parent);
      }
      if (s.lineage.parent2Id) {
        ancestors.push(s.lineage.parent2Id);
        const parent = this.getStrain(s.lineage.parent2Id);
        if (parent) addAncestors(parent);
      }
    };
    
    addAncestors(strain);
    this.familyTrees.set(strain.id, ancestors);
  }
  
  /**
   * Check if two strains share ancestry
   */
  public shareAncestry(strain1Id: string, strain2Id: string): boolean {
    const tree1 = this.familyTrees.get(strain1Id) || [];
    const tree2 = this.familyTrees.get(strain2Id) || [];
    
    return tree1.some(id => tree2.includes(id) || id === strain2Id) ||
           tree2.some(id => id === strain1Id);
  }
  
  // ==================== Strain Stabilization ====================
  
  /**
   * Stabilize a strain through selective breeding
   * Requires breeding the same strain multiple generations
   */
  public stabilizeStrain(strainId: string): boolean {
    const strain = this.customStrains.get(strainId);
    if (!strain) return false;
    
    if (strain.lineage.isStabilized) return true;
    
    // Check if strain has been bred enough (F4 or higher)
    if (strain.lineage.generation < 4) {
      return false;
    }
    
    strain.lineage.isStabilized = true;
    this.emit("strain_stabilized", { strainId });
    return true;
  }
  
  // ==================== Events ====================
  
  public on(callback: GeneticsEventCallback): void {
    this.listeners.push(callback);
  }
  
  public off(callback: GeneticsEventCallback): void {
    this.listeners = this.listeners.filter(cb => cb !== callback);
  }
  
  private emit(event: string, data: unknown): void {
    for (const callback of this.listeners) {
      callback(event, data);
    }
  }
  
  // ==================== Serialization ====================
  
  public getCustomStrainsData(): StrainGenetics[] {
    return Array.from(this.customStrains.values());
  }
  
  public loadCustomStrains(strains: StrainGenetics[]): void {
    for (const strain of strains) {
      this.customStrains.set(strain.id, strain);
      this.updateFamilyTree(strain);
    }
  }
}
