// Pure transform: Vallejo "True Metallic Metal" range (hobby-desk-data) -> our catalog schema.
// Source upstream: alexparlett/hobby-desk-data, vallejo/vallejo_true_metallic_metal.json
// Pinned commit: 1bc4e09 (same pin as the AK import).
//
// The range ships FOUR products per colour, one per SKU block, each with its own hex and
// its own product page: Light (77.101-120), Base (77.121-140), Shade (77.141-160) and
// Airbrush (77.161-180). Upstream therefore lists each of the 20 colours four times.
// All 80 are imported as distinct paints; an earlier version of this transform kept only
// the smallest SKU per name, which silently reduced the range to its Light bottles.
import { slugify, hexToRgb, classifyColorFamily } from './ak-transform.mjs';
import { normalizeText } from '../src/normalize.mjs';

// `usage_roles` drive product_format through data/overrides/product_formats.json, which is
// first-match-wins. `vallejo + shade` is ordered before `vallejo + metallic`, so the Shade
// bottles resolve to `wash` while the rest stay `metallic`. Every variant keeps `metallic`
// so import-vallejo-tmm.mjs can still recognise the range for idempotent re-import.
export const TMM_VARIANTS = Object.freeze([
  { key: 'light', label: 'Light', firstSku: 101, lastSku: 120, usage_roles: ['metallic'] },
  { key: 'base', label: 'Base', firstSku: 121, lastSku: 140, usage_roles: ['metallic'] },
  { key: 'shade', label: 'Shade', firstSku: 141, lastSku: 160, usage_roles: ['metallic', 'shade'] },
  { key: 'airbrush', label: 'Airbrush', firstSku: 161, lastSku: 180, usage_roles: ['metallic', 'air'] },
].map(Object.freeze));

export function variantForSku(sku) {
  const match = /^77\.(\d{3})$/.exec(String(sku ?? '').trim());
  if (!match) throw new Error(`unrecognised True Metallic Metal sku: ${JSON.stringify(sku)}`);
  const number = Number(match[1]);
  const variant = TMM_VARIANTS.find((v) => number >= v.firstSku && number <= v.lastSku);
  if (!variant) throw new Error(`sku ${sku} falls outside the True Metallic Metal blocks`);
  return variant;
}

export function buildVallejoMetallicPaint(source, takenIds = new Set()) {
  if (!source.name) throw new Error('missing name');
  if (!source.sku) throw new Error(`missing sku for ${JSON.stringify(source.name)}`);

  const variant = variantForSku(source.sku);
  const rgb = hexToRgb(source.hex);
  const base = `vallejo/${slugify(source.name)}-${variant.key}`;
  const id = takenIds.has(base) ? `vallejo/${slugify(source.name)}-${slugify(source.sku)}` : base;

  return {
    id,
    provider: 'vallejo',
    name: `${source.name} (${variant.label})`,
    // Deliberately bare: keeps the upstream-name backing that prune-unbacked.mjs checks,
    // and keeps a search for the colour returning the whole family of four.
    normalized_name: normalizeText(source.name),
    aliases: [`${source.name} ${variant.label}`, String(source.sku)],
    usage_roles: [...variant.usage_roles],
    color_families: ['metallic', classifyColorFamily(rgb)],
    rgb,
    owned: false,
  };
}

// `existingIds` are the ids already present in the catalog that this range must not
// collide with (the pre-existing Vallejo Game Color ids). Colliding ids fall back to a
// `-<sku>` suffix, mirroring the AK import's disambiguation.
export function transformTmm(records, existingIds = new Set()) {
  const taken = new Set(existingIds);
  const paints = [];
  for (const record of records) {
    const paint = buildVallejoMetallicPaint(record, taken);
    taken.add(paint.id);
    paints.push(paint);
  }
  paints.sort((a, b) => a.id.localeCompare(b.id));
  return paints;
}
