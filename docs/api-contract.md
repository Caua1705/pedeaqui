# PedeAqui Frontend API Contract

The restaurant frontend is API-first. Configure the backend in `scripts/config/app-config.js`.

## Routes

- `GET /health`
- `GET /restaurants/{restaurant_slug}`
- `GET /restaurants/{restaurant_slug}/menu`
- `GET /restaurants/{restaurant_slug}/categories/{category_slug}/products`
- `GET /restaurants/{restaurant_slug}/products/{product_slug}`
- `POST /restaurants/{restaurant_slug}/orders`
- `GET /restaurants/{restaurant_slug}/orders/{order_number}?phone=PHONE`

## Menu Payload

`GET /restaurants/{restaurant_slug}/menu` is the primary page payload:

```json
{
  "restaurant": {},
  "settings": {},
  "branches": [],
  "banners": [],
  "coupons": [],
  "categories": [],
  "products": []
}
```

The frontend does not depend on `featured_products`, `is_featured`, `badge`, or `highlight_order`.
