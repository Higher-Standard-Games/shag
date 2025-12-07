# Data Files

All game-specific content is defined in JSON files for easy editing without code changes.

---

## Directory Structure

```
src/data/
├── strains.json              # Plant strain genetics
├── progression.json          # Leveling, XP, rewards
├── items.json                # Buildable items (TODO)
├── quests.json               # Quest definitions (TODO)
├── npcs.json                 # NPC templates (TODO)
├── achievements.json         # Achievement definitions (TODO)
├── world.json                # Areas and lots (TODO)
└── schemas/
    ├── strain.schema.json    # Strain validation schema
    ├── progression.schema.json # Progression validation schema
    └── ...                   # Other schemas
```

---

## JSON Schemas

Each data file has a corresponding JSON Schema for:
- **Validation** - Catch errors before runtime
- **Autocomplete** - IDE suggestions while editing
- **Documentation** - Inline descriptions of fields

### Using Schemas

Add the `$schema` property to your JSON file:

```json
{
  "$schema": "./schemas/strain.schema.json",
  "strains": [...]
}
```

---

## Strains (`strains.json`)

Plant genetics definitions including effects, flavors, growth traits, and breeding info.

### Schema Reference

See [Genetics System](./genetics-system.md) for full documentation.

---

## Progression (`progression.json`)

Player leveling, XP sources, and level-up rewards.

### Structure

```json
{
  "leveling": {
    "maxLevel": 50,
    "xpCurve": {
      "type": "formula",
      "base": 100,
      "exponent": 1.5
    },
    "levelRewards": [...]
  },
  "titles": [...],
  "xpSources": {...}
}
```

### XP Curve

The formula `base * level^exponent` determines XP needed:

| Level | XP (base=100, exp=1.5) |
|-------|------------------------|
| 1 | 100 |
| 5 | 1,118 |
| 10 | 3,162 |
| 25 | 12,500 |
| 50 | 35,355 |

### Level Rewards

```json
{
  "level": 5,
  "rewards": [
    { "type": "money", "amount": 500 },
    { "type": "unlock", "id": "genetics_girl_scout_cookies" },
    { "type": "unlock", "id": "breeding_station" }
  ],
  "message": "Breeding station unlocked! GSC seeds available!"
}
```

**Reward Types:**
- `money` - Add currency
- `unlock` - Unlock feature/item/strain
- `title` - Grant player title
- `item` - Add item to inventory

### XP Sources

Define how much XP each action gives:

```json
{
  "harvest_plant": { "base": 25, "perQuality": 0.5 },
  "complete_order": { "base": 50, "perValue": 0.1 },
  "breed_strain": { "base": 75, "perTrait": 25 }
}
```

**Usage in code:**
```typescript
// Simple XP
state.addXP(100);

// XP from source with context
state.addXPFromSource("harvest_plant", { quality: 85 });
// = 25 + (85 * 0.5) = 67 XP

state.addXPFromSource("breed_strain", { traits: 3 });
// = 75 + (3 * 25) = 150 XP
```

### Titles

```json
{
  "id": "master_grower",
  "name": "Master Grower",
  "minLevel": 10
}
```

---

## Strains (`strains.json`)

Plant genetics definitions including effects, flavors, growth traits, and breeding info.

### Schema Reference

See [Genetics System](./genetics-system.md) for full documentation.

### Quick Example

```json
{
  "id": "genetics_example",
  "name": "Example Strain",
  "type": "hybrid",
  "indicaPercent": 50,
  "thcContent": 20,
  "cbdContent": 1,
  "effects": { "relaxed": 70, "happy": 65 },
  "negativeEffects": { "dry_mouth": 25 },
  "flavors": { "sweet": 60, "citrus": 50 },
  "terpenes": { "limonene": 55 },
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
    "budDensity": 75,
    "trichomeCoverage": 80,
    "purpleExpression": 10,
    "orangeHairs": 60
  },
  "lineage": {
    "generation": 1,
    "isStabilized": true
  },
  "rarity": "uncommon",
  "basePrice": 12,
  "isLandrace": false,
  "tier": 2,
  "specialTraits": [],
  "unlockLevel": 3
}
```

---

## Items (`items.json`) - TODO

Buildable items like pots, lights, and equipment.

### Planned Schema

```json
{
  "items": [
    {
      "id": "basic_pot",
      "name": "Basic Pot",
      "description": "A simple growing container",
      "category": "container",
      "cost": 50,
      "unlockLevel": 1,
      "stats": {
        "waterCapacity": 100,
        "growthBonus": 0
      }
    }
  ]
}
```

---

## Quests (`quests.json`) - TODO

Quest and mission definitions.

### Planned Schema

```json
{
  "quests": [
    {
      "id": "quest_first_harvest",
      "name": "First Harvest",
      "description": "Grow and harvest your first plant",
      "objectives": [
        {
          "type": "harvest_plant",
          "target": 1,
          "description": "Harvest a plant"
        }
      ],
      "rewards": {
        "xp": 100,
        "money": 50
      }
    }
  ]
}
```

---

## NPCs (`npcs.json`) - TODO

NPC templates and dialogue trees.

### Planned Schema

```json
{
  "npcs": [
    {
      "id": "npc_dealer",
      "name": "Street Dealer",
      "icon": "🧑",
      "defaultLocation": "slums_street",
      "interactions": ["shop", "dialogue"],
      "dialogueId": "dialogue_dealer_intro"
    }
  ],
  "dialogues": [
    {
      "id": "dialogue_dealer_intro",
      "nodes": [
        {
          "id": "start",
          "text": "Hey, you looking to buy?",
          "choices": [...]
        }
      ]
    }
  ]
}
```

---

## World (`world.json`) - TODO

Area and lot definitions.

### Planned Schema

```json
{
  "areas": [
    {
      "id": "slums_street",
      "name": "Slums Street",
      "tier": "slums",
      "mapFile": "maps/slums_street.map",
      "accessRequirements": [],
      "lotIds": ["slums_garage"]
    }
  ],
  "lots": [
    {
      "id": "slums_garage",
      "name": "Abandoned Garage",
      "areaId": "slums_street",
      "price": 0,
      "plantSlots": 4
    }
  ]
}
```

---

## Loading Data

Data is loaded and registered during game initialization:

```typescript
// In GameData.ts or a data loader
import strainsData from "../data/strains.json";

export function registerGameData() {
  // Register strains from JSON
  GeneticsSystem.getInstance().registerStrains(strainsData.strains);
  
  // Register other data...
}
```

---

## Validation

### Runtime Validation

```typescript
import Ajv from "ajv";
import strainSchema from "../data/schemas/strain.schema.json";
import strainsData from "../data/strains.json";

const ajv = new Ajv();
const validate = ajv.compile(strainSchema);

if (!validate(strainsData)) {
  console.error("Invalid strain data:", validate.errors);
}
```

### IDE Validation

With the `$schema` property, VS Code will:
- Highlight invalid values
- Show autocomplete suggestions
- Display property descriptions on hover

---

## Best Practices

### Naming Conventions

| Type | Pattern | Example |
|------|---------|---------|
| Strain IDs | `genetics_snake_case` | `genetics_og_kush` |
| Item IDs | `item_snake_case` | `item_basic_pot` |
| Quest IDs | `quest_snake_case` | `quest_first_harvest` |
| NPC IDs | `npc_snake_case` | `npc_dealer` |
| Area IDs | `area_snake_case` | `area_slums_street` |
| Lot IDs | `lot_snake_case` | `lot_slums_garage` |

### Value Ranges

| Property | Range | Notes |
|----------|-------|-------|
| Percentages | 0-100 | Effects, traits, etc. |
| THC | 0-35 | Realistic range |
| CBD | 0-20 | Realistic range |
| Prices | > 0 | In game currency |
| Levels | 1-100 | Player progression |
| Tiers | 1-5 | Genetic tiers |

### Localization

For future localization support, use string IDs:

```json
{
  "name": "strain.og_kush.name",
  "description": "strain.og_kush.description"
}
```

Then resolve in a localization system:

```typescript
const name = localize(strain.name); // "OG Kush"
```

---

## Migration

When changing data structure:

1. Update the JSON Schema
2. Create a migration script
3. Update existing data files
4. Test thoroughly

```typescript
// Example migration
function migrateStrainV1toV2(oldStrain) {
  return {
    ...oldStrain,
    tier: oldStrain.tier || 1,
    specialTraits: oldStrain.specialTraits || [],
    unlockLevel: oldStrain.unlockLevel || 1
  };
}
```

---

## See Also

- [Genetics System](./genetics-system.md) - Strain system details
- [Game Systems](./game-systems.md) - Core engine systems
- [Configuration](./config.md) - Engine configuration
