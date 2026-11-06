/**
 * Shared spawn-kit choices, aliases, ammunition and display names.
 * Each kit contains the blade, one primary weapon and one secondary weapon.
 * The server builds kits from these tables; the client and bots use the same choices.
 */

import type { WeaponLoadout } from "./GametypeTypes";

/** Primary weapon choices; each kit contains exactly one. */
export const PRIMARY_CHOICES = ["rlauncher", "voltaic", "electrobolt"] as const;

/** Secondary weapon choices; each kit contains exactly one. */
export const SECONDARY_CHOICES = ["riotgun", "plasmagun", "glauncher", "machinegun"] as const;

export type PrimaryWeapon = (typeof PRIMARY_CHOICES)[number];
export type SecondaryWeapon = (typeof SECONDARY_CHOICES)[number];

export interface LoadoutChoice {
  primary: PrimaryWeapon;
  secondary: SecondaryWeapon;
}

/** Default choice used when a player has no selected kit. */
export const DEFAULT_LOADOUT: LoadoutChoice = { primary: "rlauncher", secondary: "machinegun" };

/** Ammunition granted for each selected weapon when building a kit. */
const SPAWN_AMMO: Record<PrimaryWeapon | SecondaryWeapon, number> = {
  rlauncher: 15,
  electrobolt: 15,
  voltaic: 180,
  riotgun: 15,
  plasmagun: 140,
  glauncher: 10,
  machinegun: 150,
};

/** Default spawn armor; buildLoadout callers may override it. */
export const LOADOUT_SPAWN_ARMOR = 100;

/** Display names, for the menu and the console. */
export const WEAPON_LABELS: Record<PrimaryWeapon | SecondaryWeapon, string> = {
  rlauncher: "Rocket Launcher",
  voltaic: "Voltaic",
  electrobolt: "Electrobolt",
  riotgun: "Riotgun",
  plasmagun: "Plasmagun",
  glauncher: "Grenade Launcher",
  machinegun: "Machinegun",
};

function isPrimary(value: string): value is PrimaryWeapon {
  return (PRIMARY_CHOICES as readonly string[]).includes(value);
}

function isSecondary(value: string): value is SecondaryWeapon {
  return (SECONDARY_CHOICES as readonly string[]).includes(value);
}

/**
 * Parse weapon IDs or aliases, returning null for missing, unknown or wrong-slot choices.
 */
export function parseLoadout(primary: string | undefined, secondary: string | undefined): LoadoutChoice | null {
  const p = resolveAlias(primary);
  const s = resolveAlias(secondary);
  if (!p || !s || !isPrimary(p) || !isSecondary(s)) return null;
  return { primary: p, secondary: s };
}

/** Accepted weapon aliases, resolved after trimming and lowercasing input. */
const ALIASES: Record<string, string> = {
  rl: "rlauncher",
  rocket: "rlauncher",
  rocketlauncher: "rlauncher",
  eb: "electrobolt",
  bolt: "electrobolt",
  lg: "voltaic",
  laser: "voltaic",
  lasergun: "voltaic",
  volt: "voltaic",
  rg: "riotgun",
  riot: "riotgun",
  shotgun: "riotgun",
  pg: "plasmagun",
  plasma: "plasmagun",
  gl: "glauncher",
  grenade: "glauncher",
  grenadelauncher: "glauncher",
  mg: "machinegun",
};

function resolveAlias(value: string | undefined): string | null {
  if (!value) return null;
  const key = value.trim().toLowerCase();
  if (!key) return null;
  return ALIASES[key] ?? key;
}

/**
 * When a changed kit takes effect: `round` at the next round (S&D, Amphi),
 * `respawn` at the player's next spawn (Deathmatch).
 */
export type LoadoutMode = "round" | "respawn";

/**
 * A bot's kit, picked from the table by a seed (its player id), so a bot is
 * armed the same every time a match is replayed and the bots in a match do
 * not all carry the default.
 */
export function botLoadout(seed: number): LoadoutChoice {
  const mixed = Math.abs(Math.imul(seed | 0, 2654435761) | 0);
  return {
    primary: PRIMARY_CHOICES[mixed % PRIMARY_CHOICES.length],
    secondary: SECONDARY_CHOICES[Math.floor(mixed / PRIMARY_CHOICES.length) % SECONDARY_CHOICES.length],
  };
}

/** Build the spawn kit for a choice. The blade is not optional. */
export function buildLoadout(choice: LoadoutChoice, armor = LOADOUT_SPAWN_ARMOR): WeaponLoadout {
  return {
    weapons: ["blade", choice.primary, choice.secondary],
    ammo: {
      blade: 1,
      [choice.primary]: SPAWN_AMMO[choice.primary],
      [choice.secondary]: SPAWN_AMMO[choice.secondary],
    },
    health: 100,
    armor,
  };
}

/** "Rocket Launcher + Machinegun", for confirmations and the scoreboard. */
export function describeLoadout(choice: LoadoutChoice): string {
  return `${WEAPON_LABELS[choice.primary]} + ${WEAPON_LABELS[choice.secondary]}`;
}
