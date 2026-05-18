# PedeAqui Frontend

Static white-label frontend for PedeAqui, a digital menu and ordering platform for restaurants.

## How to open

- Landing page: `index.html`
- Reusable restaurant page: `restaurant.html?slug=junior-da-picanha`
- Compatibility URL: `junior-da-picanha.html`

Use Live Server or any static server. `restaurant.html` loads restaurant data from `data/restaurants/{slug}.json`, so opening directly with `file://` may block `fetch` in some browsers.

## Structure

- `index.html` is only the PedeAqui landing page.
- `restaurant.html` is the reusable ordering app.
- `junior-da-picanha.html` redirects to the reusable restaurant route.
- `data/restaurants/` stores local mock restaurant/menu payloads.
- `assets/brand/` stores PedeAqui brand assets.
- `assets/restaurants/{slug}/` stores restaurant logos, covers and product images.
- `styles/` stores extracted CSS layers.
- `scripts/services/` centralizes data and future API calls.
- `scripts/state/` contains cart, order and UI state helpers.
- `scripts/components/` contains component boundaries for the restaurant UI.
- `scripts/pages/` contains page entry scripts.

## Add Another Restaurant

1. Add assets in `assets/restaurants/{restaurant-slug}/`.
2. Add data in `data/restaurants/{restaurant-slug}.json`.
3. Open `restaurant.html?slug={restaurant-slug}`.

No duplicated full HTML page is needed.
