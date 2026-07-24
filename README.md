# Rapidex Frontend

Static white-label frontend for Rapidex, a restaurant ordering SaaS.

## Pages

- `index.html`: Rapidex landing page.
- `restaurant.html?slug=junior-da-picanha`: generic restaurant ordering page loaded by slug.

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
http://127.0.0.1:4174/restaurant.html?slug=junior-da-picanha
```

## Architecture

See:

- `docs/architecture.md`
- `docs/frontend-structure.md`
- `docs/api-contract.md`
