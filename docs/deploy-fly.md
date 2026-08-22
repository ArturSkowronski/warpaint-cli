# Deploying warpaint-mcp to Fly.io

This is the HTTP MCP transport so Claude (mobile/desktop) can connect to your
inventory as a remote MCP server.

## What gets deployed

- `src/mcp-http-server.mjs` exposes:
  - `POST /mcp` (MCP Streamable HTTP, for Claude) and `POST /mcp/v3` (ChatGPT connector)
  - `GET /health` — liveness probe
  - `GET`/`PUT`/`DELETE /api/*` — REST for paints and inventory
  - `GET`/`POST /inventory` — bearer-token inventory sync (legacy; JSON/file mode only)
- Inventory is stored in **Postgres** when `DATABASE_URL` is set (the current live setup — see
  "Postgres mode" below); otherwise in a JSON file on a Fly volume at `/data/inventory.json`
  (`INVENTORY_PATH`).
- Stateless MCP transport: each request gets a fresh server+transport.

This is single-user. OAuth and per-user storage come later.

## Prereqs

- `flyctl` installed and `fly auth login` done.
- You picked an app name (default in `fly.toml` is `warpaint-mcp`, which may be
  taken — change it before launch).

## First deploy

```sh
# 1. Claim app name (no deploy yet)
fly launch --no-deploy --copy-config --name <your-app-name>

# 2. Create the volume that will hold inventory.json
fly volumes create inventory_data --region arn --size 1

# 3. Set the sync bearer token (used by /inventory endpoint)
fly secrets set INVENTORY_SYNC_TOKEN="$(openssl rand -hex 32)"

# 4. Deploy
fly deploy

# 5. Note the URL (e.g. https://<your-app-name>.fly.dev) and the token value
fly secrets list   # token is hashed; if you forgot it, rotate with `fly secrets set`
```

## Deploying from GitHub Actions (preferred)

Manual `fly deploy` works, but the release path is automated in
[`.github/workflows/release.yml`](../.github/workflows/release.yml). Pushing a `v*` tag runs the
test suite, `catalog lint` and the clean-room install test, then publishes to npm and deploys
here — and finally checks that the deployed server really serves the new catalog.

### One-time setup

Create a **deploy-scoped** token (not your personal login token, which is long-lived and can do
everything to every app):

```sh
fly tokens create deploy -a warpaint-mcp
```

Put the value in the repo as a secret named `FLY_API_TOKEN`
(Settings → Secrets and variables → Actions → New repository secret).

For npm, prefer **Trusted Publishing** over a token — npmjs.com → `minipainter` → Settings →
Trusted Publisher → GitHub Actions, repo `ArturSkowronski/minipainter`, workflow `release.yml`.
That authenticates over OIDC and has nothing to expire. If you would rather use a token, add it
as the `NPM_TOKEN` secret instead; the workflow uses it when present. Note that an expired npm
token makes `npm publish` fail with a **404 on `PUT`**, not a 401.

### Cutting a release

```sh
npm version <major|minor|patch> --no-git-tag-version
git commit -am "release: vX.Y.Z — …"
git tag -a vX.Y.Z -m "vX.Y.Z — …"
git push origin master && git push origin vX.Y.Z
```

The workflow refuses to run if the tag and `package.json` version disagree, and skips the npm
publish (without failing) if that version is already on the registry — so a re-run after a
half-finished release deploys Fly without tripping over the published package.

### Redeploying without a release

Actions → Release → Run workflow. Untick **Publish the package to npm** to deploy Fly only.
This is the way to push a catalog change to the server between versions: the catalog reaches
Fly *only* through a deploy, never through the `/inventory` sync.

## Smoke test

```sh
TOKEN=<your token>
APP=https://<your-app-name>.fly.dev

# Health
curl -s "$APP/health"

# MCP initialize (no auth)
curl -s -X POST "$APP/mcp" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{
    "jsonrpc":"2.0","id":1,
    "method":"initialize",
    "params":{
      "protocolVersion":"2025-06-18",
      "capabilities":{},
      "clientInfo":{"name":"curl","version":"0"}
    }
  }'

# List tools (no auth)
curl -s -X POST "$APP/mcp" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/list"}'

# Read inventory (auth required)
curl -s -H "Authorization: Bearer $TOKEN" "$APP/inventory"
```

## Connect Claude

In Claude (mobile or web) add a custom MCP connector:

- URL: `https://<your-app-name>.fly.dev/mcp`

The `/mcp` endpoint currently has no authentication. Use URL obscurity and
Fly's network controls until per-user auth lands.

## ChatGPT connector endpoint (v3)

`POST /mcp/v3` is a second MCP endpoint shaped for the OpenAI ChatGPT connector
contract. It exposes `search`, `fetch`, and `match_color` (the existing `/mcp`
with the 7 paint tools is unchanged, for Claude).

- `search({query})` → `{"results":[{"id","title","url"}]}`
- `fetch({id})` → `{"id","title","text","url","metadata"}`

Result `url`s are built from `PUBLIC_BASE_URL` (default
`https://warpaint-mcp.fly.dev`), pointing at `GET /api/paints/<id>`. Set it if the
app is deployed under a different hostname:

    fly secrets set PUBLIC_BASE_URL="https://<your-app-name>.fly.dev"

Add it in ChatGPT as a custom connector pointing at `https://<app>.fly.dev/mcp/v3`.

Smoke test against a live deploy:

    APP=https://warpaint-mcp.fly.dev
    curl -s -X POST "$APP/mcp/v3" \
      -H "Content-Type: application/json" \
      -H "Accept: application/json, text/event-stream" \
      -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"search","arguments":{"query":"nuln oil"}}}'

> Follow-up: versioning across `/mcp` and `/mcp/v3` will be unified into a single
> coherent `/mcp/vN` scheme in a later change.

## Postgres mode (current setup)

Setting `DATABASE_URL` switches inventory storage from the JSON file/volume to Postgres — the
same code path, chosen at runtime (`src/registry-store.mjs`). This is what `docker compose up`
and the Render Blueprint (`render.yaml`) use, and **the live `warpaint-mcp.fly.dev` runs this
mode** (v0.5+): inventory lives in Fly Managed Postgres, so it survives machine restarts.

Attach a Fly **Managed Postgres** (MPG) cluster to the app — either a new one or an existing one:

```sh
# option A: a new dedicated cluster (a paid MPG plan)
fly mpg create --name warpaint-db --plan Basic --region arn --pg-major-version 16
fly mpg attach <CLUSTER_ID> --app warpaint-mcp    # sets the DATABASE_URL secret

# option B: reuse a cluster you already pay for
fly mpg list --org <your-org>                     # find the cluster id
fly mpg attach <CLUSTER_ID> --app warpaint-mcp
```

Migrate the existing inventory in the same step: stage the current owned list as a one-time
seed, then deploy the Postgres-capable image. On first boot the app creates the `owned_paints`
table and seeds it from `INVENTORY_JSON` (only while the table is empty):

```sh
SEED=$(curl -s https://warpaint-mcp.fly.dev/api/inventory \
  | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.stringify({version:1,owned:JSON.parse(s).items.map(i=>i.id)})))')
fly secrets set --stage INVENTORY_JSON="$SEED" --app warpaint-mcp
fly deploy --app warpaint-mcp
```

Without `DATABASE_URL` the volume-backed JSON file is used exactly as before (local dev, and any
deploy you don't want on a DB). After migrating, the old `/data` volume and `WARPAINT_INVENTORY_JSON`
secret become unused leftovers. For a turnkey stack elsewhere, prefer `docker compose up` (see the README).

## Known limitations of this iteration

- `/mcp` is unauthenticated — anyone with the URL can call tools.
- `/inventory` is protected by a single shared bearer token.
- Stateless transport: no SSE streaming of long-running tool results
  (minipainter tools are fast, so this is fine).

## Persistent Inventory (v2)

Inventory now lives on a Fly volume mounted at `/data`. Before the first deploy
that uses persistent storage, create the volume:

    fly volumes create inventory_data --size 1 --region arn

Pick a single region matching `primary_region` in `fly.toml`. After the volume
exists, deploy normally:

    fly deploy

The container reads `INVENTORY_PATH` (defaulted to `/data/inventory.json` in
the Docker image). If the file is absent, the server seeds it from
`INVENTORY_JSON` (or the legacy `WARPAINT_INVENTORY_JSON`) on first boot.

To bootstrap from your local inventory:

    fly secrets set INVENTORY_JSON="$(cat ~/.minipainting/inventory.json)"

After the first boot, the volume is the source of truth — the env var is
ignored on subsequent loads (a warning is logged). Use the sync CLI for
ongoing updates: `mpaint sync add <name> --url <app-url> --token <token>`
then `mpaint sync push` (see the "Self-hosting your own MCP" section in the
README for the full flow).
