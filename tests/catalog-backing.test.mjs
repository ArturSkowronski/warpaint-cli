import test from 'node:test';
import assert from 'node:assert/strict';

import { loadBuiltInCatalog } from '../src/catalog-data.mjs';

// Regression guard for the 2026-07-17 purge of model-hallucinated catalog
// entries (introduced by commit 6c06ffb): names that have no backing in the
// upstream (alexparlett/hobby-desk-data) or a pinned hand-curated source must
// stay out of the catalog. See scripts/prune-unbacked.mjs.

const AP_GHOSTS = [
  'hexed lichen', // Vallejo Game Color 72.015, never an Army Painter paint
  'mystic purple', // exists in no known brand
  'purple tentacle', // exists in no known brand
  'imperial purple', // Reaper Master Series 09023
  'nightshade purple', // Reaper Master Series 09022
  'warlord purple', // Vallejo Game Color 72.014
];

test('army_painter carries no cross-brand ghost names', async () => {
  const catalog = await loadBuiltInCatalog();
  const apNames = new Set(
    catalog.paints.filter((p) => p.provider === 'army_painter').map((p) => p.normalized_name),
  );
  for (const ghost of AP_GHOSTS) {
    assert.ok(!apNames.has(ghost), `army_painter must not contain "${ghost}"`);
  }
});

test('legitimate cross-brand name collisions survive the purge', async () => {
  const catalog = await loadBuiltInCatalog();
  // Alien Purple genuinely exists in BOTH brands (AP WP3128 Fanatic, Vallejo 72.076).
  assert.ok(catalog.paints.some((p) => p.id === 'army_painter/alien-purple'));
  assert.ok(catalog.paints.some((p) => p.id === 'vallejo/alien-purple'));
});

test('pruned catalog sizes match the backed upstream sets', async () => {
  const catalog = await loadBuiltInCatalog();
  const byProvider = {};
  for (const p of catalog.paints) byProvider[p.provider] = (byProvider[p.provider] || 0) + 1;
  assert.equal(byProvider.army_painter, 419); // 552 - 133 unbacked
  assert.equal(byProvider.citadel, 261); // 288 - 27 unbacked
  assert.equal(byProvider.vallejo, 226); // fully backed (incl. 12 pinned Game Inks + 20x4 TMM)
  assert.equal(byProvider.ak_interactive, 613); // fully backed
});
