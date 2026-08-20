import { migratePaintIds } from './id-migrations.mjs';

export function validateInventory(inventory) {
  if (
    !inventory
    || inventory.version !== 1
    || !Array.isArray(inventory.owned)
    || !inventory.owned.every((id) => typeof id === 'string')
  ) {
    throw new Error('invalid inventory shape');
  }
}

export function normalizeInventory(inventory) {
  validateInventory(inventory);
  // Renamed paints are remapped here so both the JSON and Postgres repositories inherit
  // the migration; the Set below absorbs an inventory that holds a legacy id and its
  // current id at the same time.
  const owned = [...new Set(migratePaintIds(inventory.owned))].sort();
  return { version: 1, owned };
}
