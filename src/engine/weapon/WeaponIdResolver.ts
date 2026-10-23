/** The selected game's compatibility mapping; absent games use IDs unchanged. */
export type WeaponIdResolver = (id: string) => string;

let resolver: WeaponIdResolver | null = null;

export function registerWeaponIdResolver(value: WeaponIdResolver): void {
  resolver = value;
}

export function resolveWeaponId(id: string): string {
  return resolver?.(id) ?? id;
}

export function clearWeaponIdResolver(): void {
  resolver = null;
}
