# Genetics System

A comprehensive plant genetics and breeding system for creating, managing, and breeding plant strains.

---

## Overview

The Genetics System provides:

- **Strain Properties** - THC, CBD, effects, flavors, terpenes (like Leafly)
- **Growth Traits** - Flowering time, yield, difficulty, resistances
- **Appearance Traits** - Bud density, trichomes, purple expression
- **Genetic Lineage** - Family trees, generations, breeding history
- **Breeding Mechanics** - Crossbreeding, trait inheritance, phenotype variation
- **Progression System** - Tiers, special traits, unlock requirements

---

## Data Files

Strain data is stored in JSON for easy editing:

```
src/data/
├── strains.json              # All strain definitions
└── schemas/
    └── strain.schema.json    # JSON Schema for validation
```

### Adding a New Strain

Edit `src/data/strains.json`:

```json
{
  "id": "genetics_my_strain",
  "name": "My Custom Strain",
  "description": "A custom strain with unique properties.",
  "type": "hybrid",
  "indicaPercent": 60,
  "thcContent": 22,
  "cbdContent": 1,
  "effects": { "relaxed": 80, "happy": 70, "euphoric": 65 },
  "negativeEffects": { "dry_mouth": 30 },
  "flavors": { "sweet": 75, "citrus": 60 },
  "terpenes": { "limonene": 55, "myrcene": 45 },
  "growthTraits": {
    "floweringTime": 60,
    "yieldPotential": 70,
    "heightPotential": 55,
    "difficulty": 40,
    "moldResistance": 60,
    "pestResistance": 55,
    "droughtTolerance": 50
  },
  "appearance": {
    "budDensity": 80,
    "trichomeCoverage": 85,
    "purpleExpression": 20,
    "orangeHairs": 65
  },
  "lineage": {
    "parent1Id": "genetics_og_kush",
    "parent2Id": "genetics_durban_poison",
    "generation": 2,
    "isStabilized": true,
    "breederName": "Your Name"
  },
  "rarity": "rare",
  "basePrice": 15,
  "isLandrace": false,
  "tier": 3,
  "specialTraits": ["high_thc"],
  "unlockLevel": 5
}
```

---

## Strain Properties

### Basic Info

| Property | Type | Description |
|----------|------|-------------|
| `id` | string | Unique identifier (e.g., `genetics_og_kush`) |
| `name` | string | Display name |
| `description` | string | Flavor text |
| `type` | enum | `indica`, `sativa`, or `hybrid` |
| `indicaPercent` | 0-100 | Percentage of indica genetics |
| `isLandrace` | boolean | True for original landrace strains |

### Potency

| Property | Range | Description |
|----------|-------|-------------|
| `thcContent` | 0-35 | THC percentage |
| `cbdContent` | 0-20 | CBD percentage |

### Effects (0-100 intensity)

**Positive Effects:**
- `relaxed`, `euphoric`, `happy`, `uplifted`, `creative`
- `energetic`, `focused`, `tingly`, `giggly`, `hungry`
- `sleepy`, `talkative`

**Negative Effects:**
- `dry_mouth`, `dry_eyes`, `paranoid`, `anxious`
- `dizzy`, `headache`

### Flavors (0-100 intensity)

- `earthy`, `sweet`, `citrus`, `berry`, `pine`
- `woody`, `spicy`, `herbal`, `floral`, `tropical`
- `grape`, `lemon`, `orange`, `mint`, `vanilla`
- `coffee`, `diesel`, `skunk`, `cheese`, `pungent`

### Terpenes (0-100 intensity)

| Terpene | Common Effects |
|---------|----------------|
| `myrcene` | Relaxing, sedating |
| `limonene` | Uplifting, stress relief |
| `caryophyllene` | Anti-inflammatory |
| `pinene` | Alertness, memory |
| `linalool` | Calming, anti-anxiety |
| `humulene` | Appetite suppressant |
| `terpinolene` | Uplifting, antioxidant |
| `ocimene` | Energizing |

---

## Growth Traits

| Trait | Range | Description |
|-------|-------|-------------|
| `floweringTime` | 30-120 | Days to flower (game days) |
| `yieldPotential` | 0-100 | How much product per plant |
| `heightPotential` | 0-100 | Short (0) to tall (100) |
| `difficulty` | 0-100 | Easy (0) to hard (100) |
| `moldResistance` | 0-100 | Resistance to mold |
| `pestResistance` | 0-100 | Resistance to pests |
| `droughtTolerance` | 0-100 | Water requirements |

---

## Appearance Traits

| Trait | Range | Description |
|-------|-------|-------------|
| `budDensity` | 0-100 | Loose (0) to dense (100) |
| `trichomeCoverage` | 0-100 | Frosty appearance |
| `purpleExpression` | 0-100 | Purple coloration |
| `orangeHairs` | 0-100 | Orange pistil coverage |

---

## Genetic Lineage

```typescript
interface StrainLineage {
  parent1Id?: string;      // Mother strain ID
  parent2Id?: string;      // Father strain ID
  generation: number;      // 0 = landrace, 1 = F1, 2 = F2, etc.
  isStabilized: boolean;   // Consistent offspring
  breederName?: string;    // Creator
  originRegion?: string;   // Geographic origin (landraces)
  createdAt?: number;      // Timestamp
}
```

### Generation System

| Generation | Description |
|------------|-------------|
| 0 | Landrace (original genetics) |
| 1 | F1 (first cross) |
| 2 | F2 (second generation) |
| 3 | F3 (third generation) |
| 4+ | F4+ (stabilized) |

---

## Tier System

Strains are organized into tiers that determine unlock requirements:

| Tier | Unlock Level | Examples | Characteristics |
|------|--------------|----------|-----------------|
| 1 | Level 1 | Afghan Kush, Skunk #1 | Easy to grow, starter strains |
| 2 | Level 3 | Thai, OG Kush | Moderate difficulty |
| 3 | Level 5 | Girl Scout Cookies | High THC, requires breeding |
| 4 | Level 7 | Gelato | Multiple special traits |
| 5 | Level 10 | Lemon Cherry Gelato | Legendary, 5+ traits |

---

## Special Traits

Special traits are rare genetic features that increase value:

| Trait | Requirement | Effect |
|-------|-------------|--------|
| `auto_flower` | Special breeding | Flowers regardless of light |
| `high_thc` | THC ≥ 25% | Higher sale price |
| `high_cbd` | CBD ≥ 15% | Medical market access |
| `fast_flower` | Flowering ≤ 45 days | Faster harvests |
| `heavy_yield` | Yield ≥ 85 | More product per plant |
| `purple_pheno` | Purple ≥ 70% | Visual appeal, premium |
| `frost_giant` | Trichomes ≥ 90% | Higher potency |
| `pest_immune` | Pest resist ≥ 95% | No pest problems |
| `drought_master` | Drought ≥ 90% | Less watering |
| `compact_growth` | Short + high yield | Space efficient |
| `giant_growth` | Height ≥ 90% | Massive plants |
| `exotic_flavor` | Unique terpenes | Connoisseur market |
| `balanced_hybrid` | 45-55% indica | Perfect balance |
| `medicinal` | THC ≥ 10% + CBD ≥ 10% | Medical premium |
| `connoisseur` | Quality score 95+ | Top shelf |

---

## Breeding System

### API Usage

```typescript
import { GeneticsSystem } from "./game/GeneticsSystem";

const genetics = GeneticsSystem.getInstance();

// Check compatibility
const pair = genetics.getBreedingCompatibility(
  "genetics_og_kush",
  "genetics_durban_poison"
);
console.log(pair.compatibility); // 0-100
console.log(pair.predictedTraits); // Expected offspring traits

// Breed strains
const result = genetics.breed(
  "genetics_og_kush",
  "genetics_durban_poison",
  {
    seedCount: 5,
    createNewStrain: true,
    newStrainName: "My Custom Hybrid"
  }
);

if (result.success) {
  console.log(`Created ${result.seeds.length} seeds`);
  console.log(`New strain ID: ${result.childStrainId}`);
}
```

### Trait Inheritance

When breeding:

1. **Blending** - Most traits average between parents with variance
2. **Dominance** - Some traits favor one parent
3. **Mutation** - Small chance of new traits appearing
4. **Phenotype Variation** - Seeds from same cross can vary

```
Parent A (THC: 20%)  +  Parent B (THC: 24%)
                    ↓
            Offspring THC: 20-24% (with variance)
```

### Special Trait Inheritance

- **50% chance** to inherit each parent's special traits
- **New traits** can develop if stats meet requirements
- **Stacking** - Offspring can have more traits than parents

---

## Family Tree

```typescript
// Get complete ancestry
const tree = genetics.getFamilyTree("genetics_lemon_cherry_gelato");

// Get direct children
const children = genetics.getChildren("genetics_og_kush");

// Check shared ancestry
const related = genetics.shareAncestry("strain_a", "strain_b");
```

### Example Family Tree

```
Afghan Kush (Landrace, Tier 1)
├── OG Kush (F1, Tier 2)
│   └── Girl Scout Cookies (F2, Tier 3)
│       └── Gelato (F3, Tier 4)
│           └── Lemon Cherry Gelato (F4, Tier 5)
│
Thai (Landrace, Tier 2)
└── Skunk #1 (F1, Tier 1)

Durban Poison (Landrace, Tier 1)
└── Girl Scout Cookies (F2, Tier 3)
```

---

## Progression Path

### Early Game (Tier 1)
1. Start with basic seeds (Afghan Kush, Skunk #1)
2. Learn growing mechanics
3. Harvest and sell for money

### Mid Game (Tier 2-3)
1. Unlock Thai and OG Kush at level 3
2. Start breeding experiments
3. Discover special traits
4. Unlock GSC at level 5

### Late Game (Tier 4-5)
1. Breed for specific trait combinations
2. Create legendary strains
3. Complete breeding challenges
4. Achieve "Master Breeder" status

---

## Rarity System

| Rarity | Base Price Multiplier | Drop Rate |
|--------|----------------------|-----------|
| Common | 1.0x | 40% |
| Uncommon | 1.2x | 30% |
| Rare | 1.5x | 20% |
| Legendary | 2.0x | 8% |
| Unique | 3.0x | 2% |

Breeding can increase rarity:
- 20% chance offspring is rarer than parents
- Special traits increase rarity

---

## Quality Score

Quality is calculated from multiple factors:

```typescript
const score = genetics.calculateQualityScore("genetics_gelato");
// Returns 0-100

// Factors:
// - THC/CBD content
// - Effect intensity
// - Flavor complexity
// - Terpene diversity
// - Appearance traits
// - Special traits
```

---

## Events

```typescript
genetics.on((event, data) => {
  switch (event) {
    case "strain_registered":
      console.log(`New strain: ${data.strain.name}`);
      break;
    case "breeding_complete":
      console.log(`Created ${data.seeds.length} seeds`);
      break;
    case "trait_discovered":
      console.log(`Discovered: ${data.trait}`);
      break;
  }
});
```

---

## Best Practices

### For Game Designers

1. **Balance tiers** - Each tier should feel like progression
2. **Reward experimentation** - Random mutations keep it interesting
3. **Create goals** - Breeding challenges give direction
4. **Visual feedback** - Show trait inheritance clearly

### For Modders

1. **Use JSON** - Edit `src/data/strains.json` for new strains
2. **Validate schema** - Use the JSON schema for validation
3. **Test breeding** - Verify trait inheritance works
4. **Balance stats** - Keep values within reasonable ranges

---

## See Also

- [Plant System](./plant-system.md) - Growing mechanics
- [Game Systems](./game-systems.md) - Core engine systems
- [Data Files](./data-files.md) - JSON data format
