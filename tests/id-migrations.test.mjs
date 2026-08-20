import test from 'node:test';
import assert from 'node:assert/strict';

import { loadBuiltInCatalog } from '../src/catalog-data.mjs';
import { PAINT_ID_MIGRATIONS, migratePaintId, migratePaintIds } from '../src/id-migrations.mjs';
import { normalizeInventory } from '../src/inventory-schema.mjs';

test('every migration target exists in the catalog', async () => {
  const catalog = await loadBuiltInCatalog();
  const ids = new Set(catalog.paints.map((p) => p.id));
  for (const [legacy, current] of Object.entries(PAINT_ID_MIGRATIONS)) {
    assert.ok(ids.has(current), `${legacy} -> ${current}: target must exist`);
  }
});

test('no migration source is still a live catalog id', async () => {
  const catalog = await loadBuiltInCatalog();
  const ids = new Set(catalog.paints.map((p) => p.id));
  for (const legacy of Object.keys(PAINT_ID_MIGRATIONS)) {
    assert.ok(!ids.has(legacy), `${legacy} should no longer be a catalog id`);
  }
});

test('the 20 TMM colours are remapped to their Light bottle', () => {
  assert.equal(Object.keys(PAINT_ID_MIGRATIONS).length, 20);
  assert.equal(migratePaintId('vallejo/imperial-gold'), 'vallejo/imperial-gold-light');
  assert.equal(migratePaintId('vallejo/ultramarine-blue-77-110'), 'vallejo/ultramarine-blue-light');
});

test('the Vallejo Game Color Ultramarine Blue is not remapped', () => {
  assert.equal(migratePaintId('vallejo/ultramarine-blue'), 'vallejo/ultramarine-blue');
});

test('an unknown id passes through untouched', () => {
  assert.equal(migratePaintId('citadel/mephiston-red'), 'citadel/mephiston-red');
  assert.deepEqual(migratePaintIds(['citadel/abaddon-black']), ['citadel/abaddon-black']);
});

test('normalizeInventory migrates owned ids', () => {
  const inventory = normalizeInventory({
    version: 1,
    owned: ['vallejo/imperial-gold', 'citadel/mephiston-red'],
  });
  assert.deepEqual(inventory.owned, ['citadel/mephiston-red', 'vallejo/imperial-gold-light']);
});

test('normalizeInventory collapses a legacy id held alongside its current id', () => {
  const inventory = normalizeInventory({
    version: 1,
    owned: ['vallejo/imperial-gold', 'vallejo/imperial-gold-light'],
  });
  assert.deepEqual(inventory.owned, ['vallejo/imperial-gold-light']);
});
