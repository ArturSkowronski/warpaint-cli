import test from 'node:test';
import assert from 'node:assert/strict';

import { loadBuiltInCatalog } from '../src/catalog-data.mjs';
import { transformTmm, variantForSku, buildVallejoMetallicPaint } from '../scripts/vallejo-tmm-transform.mjs';

// The True Metallic Metal range ships four products per colour, one per SKU block:
// Light (77.101-120), Base (77.121-140), Shade (77.141-160), Airbrush (77.161-180).

test('Vallejo True Metallic Metal range (20 colours x 4 variants) is in the built-in catalog', async () => {
  const catalog = await loadBuiltInCatalog();
  const tmm = catalog.paints.filter((p) => p.provider === 'vallejo' && p.usage_roles.includes('metallic'));
  assert.equal(tmm.length, 80);
  assert.equal(new Set(tmm.map((p) => p.normalized_name)).size, 20);
});

test('every colour carries all four variants', async () => {
  const catalog = await loadBuiltInCatalog();
  const tmm = catalog.paints.filter((p) => p.provider === 'vallejo' && p.usage_roles.includes('metallic'));
  const byColour = new Map();
  for (const paint of tmm) {
    const suffix = paint.id.slice(paint.id.lastIndexOf('-') + 1);
    const colour = paint.normalized_name;
    if (!byColour.has(colour)) byColour.set(colour, new Set());
    byColour.get(colour).add(suffix);
  }
  for (const [colour, variants] of byColour) {
    assert.deepEqual(
      [...variants].sort(),
      ['airbrush', 'base', 'light', 'shade'],
      `${colour} should carry all four variants`,
    );
  }
});

test('the four Imperial Gold bottles are distinct paints with their own rgb', async () => {
  const catalog = await loadBuiltInCatalog();
  const byId = (id) => catalog.paints.find((p) => p.id === id);

  const light = byId('vallejo/imperial-gold-light');
  assert.ok(light, 'vallejo/imperial-gold-light should exist');
  assert.equal(light.name, 'Imperial Gold (Light)');
  assert.deepEqual(light.rgb, { r: 209, g: 169, b: 101 }); // #D1A965, SKU 77.103

  const base = byId('vallejo/imperial-gold-base');
  assert.equal(base.name, 'Imperial Gold (Base)');
  assert.deepEqual(base.rgb, { r: 203, g: 139, b: 80 }); // #CB8B50, SKU 77.123

  const shade = byId('vallejo/imperial-gold-shade');
  assert.equal(shade.name, 'Imperial Gold (Shade)');
  assert.deepEqual(shade.rgb, { r: 96, g: 60, b: 30 }); // #603C1E, SKU 77.143

  const airbrush = byId('vallejo/imperial-gold-airbrush');
  assert.equal(airbrush.name, 'Imperial Gold (Airbrush)');
  assert.deepEqual(airbrush.rgb, { r: 203, g: 139, b: 80 }); // #CB8B50, SKU 77.163
});

test('Shade bottles resolve to wash, the other three to metallic', async () => {
  const catalog = await loadBuiltInCatalog();
  const tmm = catalog.paints.filter((p) => p.provider === 'vallejo' && p.usage_roles.includes('metallic'));

  const shades = tmm.filter((p) => p.id.endsWith('-shade'));
  assert.equal(shades.length, 20);
  for (const shade of shades) {
    assert.equal(shade.product_format, 'wash', `${shade.id} should be a wash`);
  }

  for (const paint of tmm.filter((p) => !p.id.endsWith('-shade'))) {
    assert.equal(paint.product_format, 'metallic', `${paint.id} should be metallic`);
  }
});

test('every TMM paint resolves a non-null product_format', async () => {
  const catalog = await loadBuiltInCatalog();
  const unresolved = catalog.paints
    .filter((p) => p.provider === 'vallejo' && p.usage_roles.includes('metallic') && p.product_format == null)
    .map((p) => p.id);
  assert.deepEqual(unresolved, []);
});

test('a TMM colour stays searchable under its bare name', async () => {
  const catalog = await loadBuiltInCatalog();
  const hits = catalog.paints.filter((p) => p.normalized_name === 'imperial gold');
  assert.equal(hits.length, 4);
});

test('the Vallejo Game Color Ultramarine Blue is untouched by the TMM import', async () => {
  const catalog = await loadBuiltInCatalog();
  const gameColor = catalog.paints.find((p) => p.id === 'vallejo/ultramarine-blue');
  assert.ok(gameColor, 'the Game Color paint should survive');
  assert.deepEqual(gameColor.usage_roles, ['layer']);
});

test('variantForSku maps each SKU block, including its edges', () => {
  assert.equal(variantForSku('77.101').key, 'light');
  assert.equal(variantForSku('77.120').key, 'light');
  assert.equal(variantForSku('77.121').key, 'base');
  assert.equal(variantForSku('77.140').key, 'base');
  assert.equal(variantForSku('77.141').key, 'shade');
  assert.equal(variantForSku('77.160').key, 'shade');
  assert.equal(variantForSku('77.161').key, 'airbrush');
  assert.equal(variantForSku('77.180').key, 'airbrush');
});

test('variantForSku rejects a SKU outside the range', () => {
  assert.throws(() => variantForSku('77.999'), /outside the True Metallic Metal blocks/);
  assert.throws(() => variantForSku('72.103'), /unrecognised/);
});

test('buildVallejoMetallicPaint names, aliases and roles a Shade bottle', () => {
  const paint = buildVallejoMetallicPaint({ name: 'Sterling Silver', sku: '77.141', hex: '#393836' });
  assert.equal(paint.id, 'vallejo/sterling-silver-shade');
  assert.equal(paint.name, 'Sterling Silver (Shade)');
  assert.equal(paint.normalized_name, 'sterling silver');
  assert.deepEqual(paint.aliases, ['Sterling Silver Shade', '77.141']);
  assert.deepEqual(paint.usage_roles, ['metallic', 'shade']);
});

test('transformTmm keeps all four bottles of a colour instead of deduplicating', () => {
  const records = [
    { name: 'Imperial Gold', sku: '77.143', hex: '#603C1E' },
    { name: 'Imperial Gold', sku: '77.103', hex: '#D1A965' },
    { name: 'Imperial Gold', sku: '77.123', hex: '#CB8B50' },
    { name: 'Imperial Gold', sku: '77.163', hex: '#CB8B50' },
  ];
  const paints = transformTmm(records);
  assert.deepEqual(paints.map((p) => p.id), [
    'vallejo/imperial-gold-airbrush',
    'vallejo/imperial-gold-base',
    'vallejo/imperial-gold-light',
    'vallejo/imperial-gold-shade',
  ]);
});

test('transformTmm falls back to a sku suffix when a variant id is already taken', () => {
  const records = [{ name: 'Ultramarine Blue', sku: '77.110', hex: '#7EB0CB' }];
  const paints = transformTmm(records, new Set(['vallejo/ultramarine-blue-light']));
  assert.equal(paints[0].id, 'vallejo/ultramarine-blue-77-110');
});
