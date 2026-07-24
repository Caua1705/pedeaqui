# Rapidex Frontend

Static white-label frontend for Rapidex, a restaurant ordering SaaS.

## Pages

- `index.html`: Rapidex landing page.
- `restaurant.html?slug=<slug>`: generic restaurant ordering page loaded by slug.

## Tenant resolution

Which restaurant a page serves is decided in one place, `scripts/utils/restaurant-slug.js`,
with this precedence:

1. **Subdomain** — `<slug>.rapidex.com`. Only read when the host ends in one of
   `VITE_TENANT_ROOT_DOMAINS`, so Vercel previews and `localhost` are never
   mistaken for a tenant. Reserved names (`www`, `api`, `admin`, …) and the apex
   resolve to no tenant.
2. **Query** — `?slug=<slug>`, which is what the `vercel.json` rewrites produce.
3. **Path** — `rapidex.com/<slug>`, plus the older `/r/<slug>` and
   `/restaurantes/<slug>`.

There is **no default restaurant**. An absent, malformed or unknown slug renders
"Restaurante não encontrado" — serving a different tenant's menu, brand and
prices in its place is a multi-tenant isolation failure, not a friendly fallback.

## Storage model

The customer account is global to Rapidex, matching the backend (`customers.phone`
is unique across the table and `customers` has no `restaurant_id`). So session,
profile and addresses are stored **unnamespaced** and stay valid across every
restaurant. The **cart is the only per-restaurant key** (`rapidex.cart.<slug>`),
along with the chosen order type/branch. See `scripts/utils/storage-keys.js`.

## API Configuration

Edit `scripts/config/app-config.js`. Keep `API_BASE_URL` centralized there and do not duplicate the production API URL in page or component files.

## Google Maps key

The key is never committed. Copy `scripts/config/maps-config.example.js` to
`scripts/config/maps-config.local.js` (gitignored) and set `RAPIDEX_MAPS_KEY`.
Restrict the key in the Google Cloud Console to your HTTP referrers and to the
Maps JavaScript + Places APIs.

Set `USE_MOCK_DATA: true` only for local development with `data/restaurants/{slug}.json`.

## Local Run

Use any static server:

```powershell
python -m http.server 4174 --bind 127.0.0.1
```

Then open:

```text
http://127.0.0.1:4174/restaurant.html?slug=<slug>
```

## Architecture

See:

- `docs/architecture.md`
- `docs/frontend-structure.md`
- `docs/api-contract.md`
