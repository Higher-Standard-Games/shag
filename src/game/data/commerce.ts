/**
 * Commerce Data
 * 
 * Dealers, customers, shop categories, and shop items.
 */

import type { Dealer } from "../DealerSystem";
import type { CustomerTemplate } from "../OrderSystem";
import type { ShopItem, ShopCategory } from "../ShopSystem";
import { generateSeedShopItems } from "./StrainLoader";

// ==================== Dealers ====================
// NPCs that buy products from the player

export const DEALERS: Dealer[] = [
  {
    id: "dealer_street",
    name: "Street Dealer",
    title: "Local Buyer",
    icon: "🧢",
    priceMultiplier: 0.8,
    preferredCategories: ["fresh"],
    preferredBonus: 0.1,
    minReputation: 0,
    maxQuantity: 50,
    dealCooldown: 60000,
    riskLevel: "low",
    requiredLevel: 1,
    isAvailable: true,
    areaId: "slums_street",
  },
  {
    id: "dealer_dispensary",
    name: "Green Leaf Dispensary",
    title: "Licensed Buyer",
    icon: "🏪",
    priceMultiplier: 1.0,
    preferredCategories: ["cured"],
    preferredBonus: 0.2,
    minReputation: 10,
    maxQuantity: 200,
    dealCooldown: 300000,
    riskLevel: "low",
    requiredLevel: 2,
    isAvailable: true,
    areaId: "downtown",
  },
  {
    id: "dealer_wholesale",
    name: "Big Mike",
    title: "Wholesale Buyer",
    icon: "💼",
    priceMultiplier: 1.15,
    preferredCategories: ["cured"],
    preferredBonus: 0.15,
    minReputation: 25,
    maxQuantity: 500,
    dealCooldown: 600000,
    riskLevel: "medium",
    requiredLevel: 5,
    isAvailable: true,
    areaId: "industrial",
  },
  {
    id: "dealer_premium",
    name: "The Connoisseur",
    title: "Premium Buyer",
    icon: "🎩",
    priceMultiplier: 1.5,
    preferredCategories: ["cured"],
    preferredBonus: 0.25,
    minReputation: 50,
    maxQuantity: 100,
    dealCooldown: 1800000,
    riskLevel: "low",
    requiredLevel: 10,
    isAvailable: true,
    areaId: "uptown",
  },
  {
    id: "dealer_underground",
    name: "Shadow",
    title: "Underground Contact",
    icon: "🕶️",
    priceMultiplier: 2.0,
    preferredCategories: ["cured", "fresh"],
    preferredBonus: 0.1,
    minReputation: 75,
    maxQuantity: 1000,
    dealCooldown: 3600000,
    riskLevel: "high",
    requiredLevel: 15,
    isAvailable: true,
    areaId: "underground",
  },
];

// ==================== Customers ====================

export const CUSTOMERS: CustomerTemplate[] = [
  {
    id: "casual_buyer",
    name: "Casual Buyer",
    icon: "🧑",
    unlockLevel: 1,
    basePatience: 5 * 60 * 1000,
    tipMultiplier: 1.0,
    requestableItems: ["harvest_genetics_afghan_kush", "harvest_genetics_durban_poison", "harvest_genetics_thai"],
    quantityRange: [10, 30],
    dialogues: [
      "Hey, got any good stuff?",
      "I heard you have quality products.",
      "My friend recommended you!",
    ],
  },
  {
    id: "regular",
    name: "Regular Customer",
    icon: "👨",
    unlockLevel: 2,
    basePatience: 4 * 60 * 1000,
    tipMultiplier: 1.2,
    requestableItems: [
      "harvest_genetics_afghan_kush", "harvest_genetics_durban_poison", "harvest_genetics_thai",
      "harvest_genetics_og_kush", "harvest_genetics_skunk_1",
    ],
    quantityRange: [15, 40],
    dialogues: [
      "The usual, please!",
      "You know what I like.",
    ],
  },
  {
    id: "connoisseur",
    name: "Connoisseur",
    icon: "🎩",
    unlockLevel: 4,
    basePatience: 3 * 60 * 1000,
    tipMultiplier: 1.5,
    requestableItems: [
      "harvest_genetics_og_kush", "harvest_genetics_skunk_1",
      "harvest_genetics_girl_scout_cookies", "harvest_genetics_gelato",
    ],
    quantityRange: [20, 50],
    dialogues: [
      "Only the finest quality, please.",
      "I appreciate the good stuff.",
    ],
  },
  {
    id: "collector",
    name: "Collector",
    icon: "💎",
    unlockLevel: 6,
    basePatience: 2 * 60 * 1000,
    tipMultiplier: 2.0,
    requestableItems: [
      "harvest_genetics_lemon_cherry_gelato", "harvest_genetics_blue_lobster",
      "harvest_genetics_master_kush",
    ],
    quantityRange: [25, 50],
    dialogues: [
      "I only collect the rarest strains.",
      "Money is no object for quality.",
      "Show me what you've got!",
    ],
  },
];

// ==================== Shop Categories ====================

export const SHOP_CATEGORIES: ShopCategory[] = [
  { id: "seeds", name: "Seeds", icon: "🌱", order: 1 },
  { id: "supplies", name: "Supplies", icon: "🧪", order: 2 },
  { id: "upgrades", name: "Upgrades", icon: "⬆️", order: 3 },
];

// ==================== Shop Items ====================
// Seeds are generated from strains.json via generateSeedShopItems()

export const SHOP_ITEMS_BASE: ShopItem[] = [
  // Fertilizers
  {
    id: "fertilizer_basic",
    name: "Basic Fertilizer",
    description: "For light feeders (1 application). Increases yield from 60% to 100%.",
    icon: "🌱",
    category: "supplies",
    price: 50,
    itemType: "consumable",
    quantity: 1,
    requiredLevel: 1,
    maxPurchases: -1,
    stock: -1,
    restockInterval: 0,
    isVisible: true,
    onSale: false,
    saleDiscount: 0,
  },
  {
    id: "fertilizer_premium",
    name: "Premium Fertilizer",
    description: "For medium feeders (2 applications). Increases yield from 60% to 100%.",
    icon: "🧪",
    category: "supplies",
    price: 100,
    itemType: "consumable",
    quantity: 1,
    requiredLevel: 2,
    maxPurchases: -1,
    stock: -1,
    restockInterval: 0,
    isVisible: true,
    onSale: false,
    saleDiscount: 0,
  },
  {
    id: "fertilizer_advanced",
    name: "Advanced Fertilizer",
    description: "For heavy feeders (3 applications). Increases yield from 60% to 100%.",
    icon: "⚗️",
    category: "supplies",
    price: 200,
    itemType: "consumable",
    quantity: 1,
    requiredLevel: 3,
    maxPurchases: -1,
    stock: -1,
    restockInterval: 0,
    isVisible: true,
    onSale: false,
    saleDiscount: 0,
  },
  // Curing Barrels
  {
    id: "basic_barrel",
    name: "Basic Curing Barrel",
    description: "Cures up to 200g of fresh harvest. Required to sell your product!",
    icon: "🛢️",
    category: "supplies",
    price: 100,
    itemType: "equipment",
    quantity: 1,
    requiredLevel: 1,
    maxPurchases: -1,
    stock: -1,
    restockInterval: 0,
    isVisible: true,
    onSale: false,
    saleDiscount: 0,
  },
  {
    id: "oak_barrel",
    name: "Oak Curing Barrel",
    description: "Cures up to 500g, 25% faster. Premium quality curing.",
    icon: "🪵",
    category: "supplies",
    price: 500,
    itemType: "equipment",
    quantity: 1,
    requiredLevel: 3,
    maxPurchases: -1,
    stock: -1,
    restockInterval: 0,
    isVisible: true,
    onSale: false,
    saleDiscount: 0,
  },
  {
    id: "premium_barrel",
    name: "Premium Curing Barrel",
    description: "Cures up to 1kg, 50% faster. Professional grade!",
    icon: "✨",
    category: "supplies",
    price: 2000,
    itemType: "equipment",
    quantity: 1,
    requiredLevel: 5,
    maxPurchases: -1,
    stock: -1,
    restockInterval: 0,
    isVisible: true,
    onSale: false,
    saleDiscount: 0,
  },
];

// Combined shop items: generated seeds from strains.json + base items
export const SHOP_ITEMS: ShopItem[] = [
  ...generateSeedShopItems(),
  ...SHOP_ITEMS_BASE,
];
