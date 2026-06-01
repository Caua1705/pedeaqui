# PedeAqui Frontend

Static white-label frontend for PedeAqui, a restaurant ordering SaaS.

## Pages

- `index.html`: PedeAqui landing page.
- `restaurant.html?slug=junior-da-picanha`: generic restaurant ordering page loaded by slug.
- `junior-da-picanha.html`: compatibility redirect only.

## API Configuration

Edit `scripts/config/app-config.js`:

```js
const APP_CONFIG = {
  API_BASE_URL: 'http://localhost:8000',
  DEFAULT_RESTAURANT_SLUG: 'junior-da-picanha',
  STORAGE_MODE: 'api',
  USE_MOCK_DATA: false
};
```

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
