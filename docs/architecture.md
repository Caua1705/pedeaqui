# Architecture

PedeAqui is split into two public surfaces:

- Landing: `index.html`, `styles/landing.css`, `scripts/pages/landing-page.js`.
- Restaurant app: `restaurant.html`, restaurant CSS, service/state/component scripts, and JSON data.

The restaurant app is white-label-ready. It reads a slug from `restaurant.html?slug=...`, asks the service layer for the restaurant menu payload, applies theme variables from the restaurant record, and renders the existing menu/cart/checkout/profile flows.

The current service layer uses local JSON. The future backend switch should happen in `scripts/services/api.js`, not inside components.
