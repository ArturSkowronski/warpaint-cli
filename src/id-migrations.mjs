// Legacy paint id -> current paint id.
//
// 2026-08-13: the Vallejo True Metallic Metal range was re-imported with all four
// variants per colour (Light / Base / Shade / Airbrush). Before that, the transform kept
// only the smallest SKU per colour name and filed it under the bare colour name — which
// was always the *Light* bottle (77.10x). Those ids now carry an explicit `-light` suffix,
// so anything already in an inventory is remapped to the paint it actually referred to.
//
// Note: `vallejo/ultramarine-blue` is intentionally absent. That is the Vallejo Game Color
// paint, a different product that merely shares a name with the TMM colour; only the
// TMM entry (which carried a `-77-110` disambiguation suffix) is remapped.
const TMM_LIGHT_SLUGS = [
  'aged-metal',
  'amber-green',
  'amethyst-purple',
  'ancient-copper',
  'arcane-gold',
  'beetle-green',
  'celestial-violet',
  'crimson-magenta',
  'dusken-green',
  'forged-red',
  'greenish-gold',
  'hydra-turquoise',
  'imperial-gold',
  'obsidian-black',
  'radiant-yellow',
  'ruby-red',
  'rusty-metal',
  'sapphire-blue',
  'sterling-silver',
];

export const PAINT_ID_MIGRATIONS = Object.freeze({
  ...Object.fromEntries(
    TMM_LIGHT_SLUGS.map((slug) => [`vallejo/${slug}`, `vallejo/${slug}-light`]),
  ),
  'vallejo/ultramarine-blue-77-110': 'vallejo/ultramarine-blue-light',
});

export function migratePaintId(id) {
  return PAINT_ID_MIGRATIONS[id] ?? id;
}

export function migratePaintIds(ids) {
  return ids.map(migratePaintId);
}
