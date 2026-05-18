# Frontend Structure

## Styles

- `tokens.css`: global CSS variables.
- `base.css`: reset and browser defaults.
- `layout.css`: reusable layout helpers.
- `components.css`: shared component utilities.
- `landing.css`: landing-only styles.
- `restaurant.css`: extracted restaurant ordering UI styles.
- `cart.css`, `checkout.css`, `mobile.css`: reserved layer files as the extracted restaurant CSS is split further.
- `utilities.css`: small utility classes.

## Scripts

- `config/`: app constants and route helpers.
- `services/`: local JSON/API boundary.
- `state/`: cart, order and UI state primitives.
- `utils/`: shared formatting, DOM, slug and storage helpers.
- `components/`: component ownership boundaries.
- `pages/`: page entry points.

The first refactor keeps the proven restaurant behavior in `restaurant-page.js` while moving data loading and assets out of the HTML.
