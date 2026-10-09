/**
 * Player-chosen spawn kits, for modes that have them.
 *
 * Warsow Bomb is a pure loadout mode — it zeroes every item mask and lets you
 * pick two weapons at spawn. Ours is close: in a mode with kits the map's
 * weapons do not spawn, so the kit is your arsenal, but ammo, armor, health and
 * powerups stay on the floor where you have to go and take them. You spawn with
 * a blade, one primary and one secondary.
 *
 * The table is shared because three places need the same answer: the server
 * builds the kit from it, the client menu lists it, and bots pick from it.
 * A choice that is not in the table is not a choice.
 */

import type { WeaponLoadout } from "./GametypeTypes";

/**
 * The heavy weapon. Exactly one, unlike Warsow's pairs — with map weapons still
 * spawning, handing out two power weapons would leave nothing worth walking to.
 */
export const PRIMARY_CHOICES = ["rlauncher", "voltaic", "electrobolt"] as const;

/** The utility weapon. */
export const SECONDARY_CHOICES = ["riotgun", "plasmagun", "glauncher", "machinegun"] as const;

export type PrimaryWeapon = (typeof PRIMARY_CHOICES)[number];
export type SecondaryWeapon = (typeof SECONDARY_CHOICES)[number];

export interface LoadoutChoice {
  primary: PrimaryWeapon;
  secondary: SecondaryWeapon;
}

/**
 * What a player gets who has never chosen.
 *
 * Rocket launcher and machinegun: the two weapons whose behaviour is most
 * obvious on sight, so a first-timer is armed with something they can use
 * rather than something they have to learn first.
 */
export const DEFAULT_LOADOUT: LoadoutChoice = { primary: "rlauncher", secondary: "machinegun" };

/**
 * Spawn ammo, from Warsow's `player.as` (`AMMO_RL 15`, `AMMO_EB 15`,
 * `AMMO_LG 180`, `AMMO_PG 140`, `AMMO_RG 15`, `AMMO_MG 150`, `AMMO_GL 10`).
 *
 * Enough to fight a round with, not enough to stop caring about the map: an
 * empty rocket launcher is a reason to go somewhere dangerous.
 */
const SPAWN_AMMO: Record<PrimaryWeapon | SecondaryWeapon, number> = {
  rlauncher: 15,
  electrobolt: 15,
  voltaic: 180,
  riotgun: 15,
  plasmagun: 140,
  glauncher: 10,
  machinegun: 150,
};

/** Warsow's `PLAYER_ARMOR` — nobody starts a round soft. */
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
 * Read a loadout off the wire or out of a console command.
 *
 * Returns null rather than a default on bad input: silently handing someone a
 * rocket launcher when they asked for something else is worse than telling them
 * the name was wrong. Accepts the short aliases players actually type.
 */
export function parseLoadout(primary: string | undefined, secondary: string | undefined): LoadoutChoice | null {
  const p = resolveAlias(primary);
  const s = resolveAlias(secondary);
  if (!p || !s || !isPrimary(p) || !isSecondary(s)) return null;
  return { primary: p, secondary: s };
}

/** Short names, including the Warsow ones players coming from it will type. */
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
 * When a changed kit takes effect. `round`: at the next round, so a lost
 * gunfight is not a free re-kit (S&D, Amphi). `respawn`: at the player's next
 * spawn, which in a respawning mode comes within seconds (Deathmatch).
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
