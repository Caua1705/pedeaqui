# Architecture

The frontend is a static, mobile-first white-label ordering app.

`restaurant.html` reads the restaurant slug from `?slug=...` and requests the complete menu payload from the backend. Restaurant identity, theme colors, branches, banners, coupons, categories, products, and checkout settings come from that payload.

The API layer is centralized:

- `scripts/services/api-client.js`: low-level HTTP helper.
- `scripts/services/api.js`: backend route wrapper plus optional local fallback.
- `scripts/services/menu-service.js`: normalizes backend menu data.
- `scripts/services/order-service.js`: creates and fetches orders.

`scripts/pages/restaurant-page.js` owns the current page orchestration and binds existing DOM elements to service/state data.

Local JSON is only a development fallback when `APP_CONFIG.USE_MOCK_DATA` is `true`.
