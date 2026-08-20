import fs from 'node:fs/promises';
import path from 'node:path';

import { normalizeInventory, validateInventory } from '../../inventory-schema.mjs';
import { withInventoryLock } from './inventory-lock.mjs';

async function readInventoryFile(inventoryPath) {
  const raw = await fs.readFile(inventoryPath, 'utf8');
  const inventory = JSON.parse(raw);
  validateInventory(inventory);
  // Normalize on read, not just on write: renamed paint ids are remapped in
  // normalizeInventory, and a read-only command must see the migrated ids too.
  return normalizeInventory(inventory);
}

function readInventoryFromEnv() {
  const raw = process.env.INVENTORY_JSON || process.env.WARPAINT_INVENTORY_JSON;
  if (!raw) return null;
  const inventory = JSON.parse(raw);
  validateInventory(inventory);
  return inventory;
}

async function tryMigrateLegacyRegistry(inventoryPath) {
  const legacyPath = path.join(path.dirname(inventoryPath), 'registry.json');
  if (legacyPath === inventoryPath) return null;

  try {
    const raw = await fs.readFile(legacyPath, 'utf8');
    const legacy = JSON.parse(raw);
    if (!legacy?.catalog?.paints) return null;
    return legacy.catalog.paints
      .filter((paint) => paint.owned)
      .map((paint) => paint.id)
      .sort();
  } catch (error) {
    if (error && error.code !== 'ENOENT') throw error;
    return null;
  }
}

async function writeAtomic(targetPath, contents) {
  const tmpPath = `${targetPath}.tmp`;
  await fs.writeFile(tmpPath, contents);
  await fs.rename(tmpPath, targetPath);
}

export function createJsonInventoryRepository({ inventoryPath }) {
  return {
    inventoryPath,

    async load() {
      try {
        return await readInventoryFile(inventoryPath);
      } catch (error) {
        if (!error || error.code !== 'ENOENT') throw error;
        // Fresh install: no inventory file yet. Treat as empty (honoring an
        // INVENTORY_JSON seed) so read commands work and the first write creates it.
        return readInventoryFromEnv() || normalizeInventory({ version: 1, owned: [] });
      }
    },

    async save(inventory) {
      const normalized = normalizeInventory(inventory);
      await fs.mkdir(path.dirname(inventoryPath), { recursive: true });
      await writeAtomic(inventoryPath, JSON.stringify(normalized, null, 2));
      return normalized;
    },

    async initIfMissing() {
      try {
        const inventory = await readInventoryFile(inventoryPath);
        if (process.env.INVENTORY_JSON || process.env.WARPAINT_INVENTORY_JSON) {
          console.warn(
            `minipainting: INVENTORY_JSON env is set but ${inventoryPath} already exists — env ignored, disk is source of truth.`,
          );
        }
        return { created: false, inventory };
      } catch (error) {
        if (!error || error.code !== 'ENOENT') {
          throw error;
        }
      }

      const seeded = readInventoryFromEnv();
      const migrated = seeded ? null : await tryMigrateLegacyRegistry(inventoryPath);
      const inventory = normalizeInventory({
        version: 1,
        owned: seeded ? seeded.owned : (migrated || []),
      });

      await fs.mkdir(path.dirname(inventoryPath), { recursive: true });
      await writeAtomic(inventoryPath, JSON.stringify(inventory, null, 2));

      return { created: true, inventory, migratedFromLegacy: Boolean(migrated && !seeded) };
    },

    async mutate(mutator) {
      return withInventoryLock(inventoryPath, async () => {
        const current = await readInventoryFile(inventoryPath);
        const next = normalizeInventory(await mutator(current));
        await fs.mkdir(path.dirname(inventoryPath), { recursive: true });
        await writeAtomic(inventoryPath, JSON.stringify(next, null, 2));
        return next;
      });
    },
  };
}
