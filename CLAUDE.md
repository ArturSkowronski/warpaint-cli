# minipainter — project guide for Claude

A CLI + MCP server for managing a miniature-paint inventory and doing cross-brand
paint matching. Node.js ESM, tested with the built-in runner (`npm test` → `node --test`).

## Paint catalog architecture

Paint data lives in two layers — **never** conflate them:

- **`data/catalog/*.json`** — one file per brand (`citadel`, `army_painter`, `vallejo`,
  `ak_interactive`). These are an **upstream mirror** and must **not** be hand-edited; they
  are refreshable/regenerable. Each paint:
  `{ id, provider, name, normalized_name, aliases, usage_roles, color_families, rgb, owned }`.
- **`data/overrides/product_formats.json`** — an overlay that maps `(provider, usage_role)`
  → normalized `product_format` (`opaque_base | opaque_layer | wash | contrast | technical |
  drybrush | metallic | ink`). Brand rules are matched in order (first wins); per-id `overrides`
  win over rules. `src/overrides.mjs::enrichPaint` attaches `product_format` at load time.

### Rules
- To correct a mistagged paint, add a per-id entry in `data/overrides/`, **never** edit the catalog.
- For cross-brand reasoning read `paint.product_format` — do **not** infer product type from
  `usage_roles` or RGB. Predicates live in `src/paint-format.mjs`.
- `color_families` is an **approximate** RGB/HSL classification for search/browse only; it never
  influences `product_format`.
- After any catalog refresh, run `catalog lint` (the CLI command) — it fails if any paint has a
  null `product_format`, i.e. an unresolved overlay rule.

## Upstream source ("Workbench")

The upstream is the GitHub repo **[`alexparlett/hobby-desk-data`](https://github.com/alexparlett/hobby-desk-data)**
— scraper-driven, organized per-brand/per-range (e.g. `ak-interactive/ak_3gen.json`,
`games-workshop/citadel.json`). Its records look like
`{ brand, name, sku, type, hex, range, category, discontinued }`; our catalog schema is produced
by a transform on top of that.

### Adding / refreshing a brand catalog
1. Import from the matching `hobby-desk-data` folder via a transform script
   (see `scripts/ak-transform.mjs` for the pure transform and `scripts/import-ak.mjs` for the
   I/O wrapper — `node scripts/import-ak.mjs <source-dir> [out-file]`). **Pin the source commit.**
2. Write deterministic ids (`<provider>/<slug>`, disambiguating name collisions with `-<sku>`).
3. Add overlay rules in `data/overrides/product_formats.json` so every new paint resolves a
   `product_format`; verify with `catalog lint`.

Caveat: the RGB in the pre-existing `citadel/army_painter/vallejo` catalogs does **not** match
hobby-desk-data (different swatch sampling), and the original import script for those isn't in the
repo. hobby-desk-data is the **canonical upstream going forward** (used for the AK Interactive
catalog, pinned to `1bc4e09`); expect RGB drift versus the older catalogs.

Second caveat: the `citadel`/`army_painter` catalogs were originally **model-generated**
(commit `6c06ffb`), not imported — which left ~160 names that exist in no upstream range (a mix
of Vallejo/Reaper names and pure inventions). Those were **purged 2026-07-17** with
`node scripts/prune-unbacked.mjs <hobby-desk-data-checkout>` (backing = per-brand normalized-name
match against upstream `1bc4e09` + pinned hand-curated sources; never prunes without review of
owned paints — pass `--keep`). All four catalogs are now name-backed; RGB is still legacy.
`tests/catalog-backing.test.mjs` guards against ghosts returning.

The GitHub Pages dataset `docs/assets/paints.js` is generated — run
`node scripts/generate-site-paints.mjs` after any catalog or inventory change.

Ranges upstream doesn't carry get a hand-curated pinned source instead: the Vallejo Game Color
Ink line lives in `scripts/vallejo-game-inks.source.json` (provenance inside) and is merged by
`node scripts/import-vallejo-inks.mjs` (idempotent).

Vallejo **True Metallic Metal** ships **four bottles per colour**, one per SKU block — Light
(77.101–120), Base (77.121–140), Shade (77.141–160), Airbrush (77.161–180) — so upstream's
`vallejo/vallejo_true_metallic_metal.json` holds 20 colours × 4 = 80 records, each with its own
hex. Import **all** of them (`node scripts/import-vallejo-tmm.mjs <source-file>`); do **not**
deduplicate by name, which is what the original transform did and why the range was silently
reduced to its Light bottles until 2026-08-13. Ids are `vallejo/<slug>-<light|base|shade|airbrush>`;
`name` carries the variant (`Imperial Gold (Base)`) while `normalized_name` stays bare so
upstream-name backing and whole-family search both keep working. Shade gets `usage_roles`
`['metallic','shade']` so the first-match overlay resolves it to `wash` (it is used like one);
the rest stay `metallic`.

**Renaming a catalog id is a breaking change for inventories.** Add the old→new pair to
`src/id-migrations.mjs`; `normalizeInventory` applies the map, so both the JSON and Postgres
repositories inherit it. Migration happens on read and is persisted on the next write, so the
on-disk file keeps the legacy id until something mutates it — that is deliberate, not a bug.

## Conventions
- ESM (`.mjs`), `import test from 'node:test'` + `node:assert/strict`.
- Pure logic (transforms, predicates) separated from I/O; keep files focused.
- Run `npm test` before finishing; keep it green.

## Distribution / npm packaging (bugs to not repeat)

The package is meant to be installed from npm and run via `npx minipainter` / `npm i -g minipainter`
(prepared as of v0.6.2; `npm publish` not yet run).
`npm test` runs against the working tree and **cannot** catch install-only breakage — a global
or `npx` install runs the code through a `node_modules/.bin` **symlink** and from a stranger's
`$HOME` with no pre-existing data. Two bugs slipped through this gap (both fixed + regression-tested;
don't reintroduce the patterns):

1. **Is-main-module guard must survive a bin symlink.** `import.meta.url` is realpath-resolved by
   Node, but `process.argv[1]` is the path *as invoked* (the `.bin` symlink). A bare
   `import.meta.url === pathToFileURL(process.argv[1]).href` is **false** under `npx`/global install,
   so the CLI exits 0 with **no output**. Always `realpathSync(process.argv[1])` before comparing
   (see `src/cli.mjs::isMainModule`).
2. **Read paths must treat a missing data file as empty, not throw.** A fresh install has no
   `~/.minipainting/inventory.json`; `load()` returning a bare `fs.readFile` made every command
   (even read-only `paint search`) die with `ENOENT`. Repository reads fall back to an empty
   inventory (honoring `INVENTORY_JSON`); only the first write creates the file
   (`src/infrastructure/inventory/json-inventory-repository.mjs::load`).

**Packaging rules:**
- `package.json` must stay non-`private`, keep a `files` allowlist (**ship only `src/` + `data/`**;
  README/MCP.md/LICENSE/package.json are auto-included — never publish `docs/`, `tests/`, `scripts/`),
  and keep the `minipainter` bin alias so `npx minipainter` resolves a command (short `mpaint` stays).
- **Before touching packaging or an entrypoint, run the clean-room test**, not just `npm test`:
  `npm pack` → install the tarball into a throwaway dir with an isolated `HOME` → run the bin from
  `node_modules/.bin`. If search/match/own/list don't work self-contained, it's broken for users.
