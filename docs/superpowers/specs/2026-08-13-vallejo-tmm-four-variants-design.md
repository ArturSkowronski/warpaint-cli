# Vallejo True Metallic Metal — support all four variants

Date: 2026-08-13

## Problem

Vallejo's True Metallic Metal (TMM) range ships **four products per colour**, not one:

| SKU block | Variant | Purpose |
|---|---|---|
| 77.101–77.120 | Light | lighter, more luminous version of the Base tone |
| 77.121–77.140 | Base | the foundation colour |
| 77.141–77.160 | Shade | darker tone for depth, applied like a wash |
| 77.161–77.180 | Airbrush | Base colour formulated for airbrush |

Upstream (`alexparlett/hobby-desk-data`, pin `1bc4e09`,
`vallejo/vallejo_true_metallic_metal.json`) carries all 80 records: 20 colours × 4 blocks,
each with its own hex and its own product page.

`scripts/vallejo-tmm-transform.mjs` currently calls `dedupeBySku`, keeping only the
**smallest SKU per name**. That is not a canonical pick — it is always the *Light* bottle.
So the catalog today has two defects:

1. **Missing products.** Base, Shade and Airbrush (60 paints) are absent.
2. **Mislabelled products.** `vallejo/imperial-gold` (rgb `#D1A965`) is presented as plain
   "Imperial Gold" when it is in fact *Imperial Gold Light*.

## Design

### Catalog entries

Import all 80 records. Per record:

| Field | Value | Note |
|---|---|---|
| `id` | `vallejo/<slug>-<variant>` | e.g. `vallejo/imperial-gold-base` |
| `name` | `<Name> (<Variant>)` | e.g. `Imperial Gold (Base)` — four same-named bottles must be tellable apart in list output |
| `normalized_name` | `normalizeText(<Name>)` | stays **bare** (`imperial gold`) |
| `aliases` | `["<Name> <Variant>", "<sku>"]` | targets one variant; SKU is the natural disambiguator |
| `usage_roles` | see below | |
| `color_families` | `['metallic', classifyColorFamily(rgb)]` | from that variant's own hex |
| `rgb` | that record's hex | no more cross-variant hex confusion |
| `owned` | `false` | |

Keeping `normalized_name` bare is deliberate: it preserves the upstream-name backing that
`scripts/prune-unbacked.mjs` and `tests/catalog-backing.test.mjs` check, and it keeps
`paint search "imperial gold"` returning the whole family. The cost is that
`paint show "Imperial Gold"` now resolves as **ambiguous** (4 hits) — correct, since four
distinct products carry that name. Users disambiguate by id, by `Imperial Gold Base`, or by SKU.

### usage_roles and product_format

`product_format` is never set directly; it falls out of the overlay in
`data/overrides/product_formats.json`. Rules are first-match-wins and `vallejo + shade`
already sits **before** `vallejo + metallic`, so no new rules are needed:

| Variant | `usage_roles` | resolves to |
|---|---|---|
| Light | `['metallic']` | `metallic` |
| Base | `['metallic']` | `metallic` |
| Shade | `['metallic', 'shade']` | `wash` |
| Airbrush | `['metallic', 'air']` | `metallic` (no `vallejo + air` rule; falls through to metallic) |

Shade resolving to `wash` is the point of the exercise: a TMM Shade is used the way a
Citadel Shade or an AP Quickshade is, and cross-brand reasoning reads `product_format`.
Every variant keeps `metallic` in `usage_roles`, which also preserves the idempotency
marker `import-vallejo-tmm.mjs` uses to drop and re-derive the range.

### Inventory migration

`vallejo/imperial-gold` is owned in a real inventory, so the 20 legacy ids cannot just
vanish. Add `src/id-migrations.mjs` holding a frozen legacy→current map
(`vallejo/imperial-gold` → `vallejo/imperial-gold-light`, and so on for all 20, including
`vallejo/ultramarine-blue-77-110` → `vallejo/ultramarine-blue-light`). Light is the correct
target: it is factually what those entries always were.

`vallejo/ultramarine-blue` (Vallejo Game Color) is **not** in the map — it is a different,
legitimate paint that merely shares a name.

Apply the map inside `normalizeInventory` (`src/inventory-schema.mjs`). Both the JSON and
Postgres repositories funnel through it, so one seam covers both backends; de-duplication
already happens there, which absorbs the case where a user owns both the legacy and the new
id. `readInventoryFile` in the JSON repository must normalize on read too — it currently
only validates, so a migrated id would otherwise not surface until the next write.

### Counts

`vallejo` 166 → 226 (166 − 20 + 80). Catalog total 1459 → 1519.

## Testing

- Transform: 80 paints out of 80 records; SKU→variant classification incl. block edges
  (77.120 is Light, 77.121 is Base); ids, names, aliases, roles per variant.
- Catalog: all four Imperial Gold variants present with the right rgb; Shade resolves to
  `wash`, the other three to `metallic`; `catalog lint` stays clean (no null `product_format`).
- Backing: `vallejo` count 226; no TMM entry loses upstream name backing.
- Migration: every legacy id maps to an existing catalog id; `vallejo/ultramarine-blue` is
  untouched; `normalizeInventory` rewrites and de-duplicates.

## Out of scope

RGB drift versus the older Vallejo Game Color entries (a known, documented caveat) and any
re-sampling of legacy swatches.
