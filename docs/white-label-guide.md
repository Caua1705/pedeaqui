# White-Label Guide

## Data Payload

Each restaurant JSON follows the backend-aligned shape:

- `restaurant`: identity, slug, assets and theme colors.
- `settings`: delivery, pickup, fees and payment settings.
- `branches`: store addresses and contact data.
- `categories`: normalized category records.
- `products`: normalized product records.
- `menu`: compatibility menu grouped by category for the current renderer.

## Theme

`applyRestaurantTheme(restaurant)` in `scripts/pages/restaurant-page.js` maps restaurant colors to CSS variables:

- `--brand-primary`
- `--brand-secondary`
- `--brand-accent`
- legacy variables used by the current UI: `--brand`, `--brand-d`, `--brand2`

## Backend Alignment

When FastAPI/Supabase is available, update `scripts/services/api.js`:

```js
const API_BASE_URL = 'https://api.example.com';
const USE_MOCK_DATA = false;
```

Then `getRestaurantMenu(slug)` can call `/restaurants/{slug}/menu` and return the same payload shape.
