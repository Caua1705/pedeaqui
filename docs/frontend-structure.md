# Frontend Structure

Root production files:

- `index.html`: PedeAqui landing page.
- `restaurant.html`: generic white-label restaurant ordering page.
- `junior-da-picanha.html`: compatibility redirect to `restaurant.html?slug=junior-da-picanha`.
- `vercel.json`: optional clean URL rewrites.

Runtime folders:

- `assets/`: brand assets and restaurant/media assets.
- `scripts/config/`: app configuration and route helpers.
- `scripts/services/`: API client and domain services.
- `scripts/state/`: local UI/cart/order state.
- `scripts/pages/`: page orchestration.
- `scripts/utils/`: small shared helpers.
- `styles/`: CSS split by concern.

Reference and archived material:

- `references/imagens_referencia/`: visual and extracted reference assets.
- `docs/archive/`: old local scratch/reference files that are not part of production runtime.
