// Vite entry for restaurant.html.
//
// The app is NOT modularised in this phase: every file below is still a plain
// IIFE that publishes onto window.PedeAqui* / window.Rapidex* and depends on the
// ones before it having already run. This file only replaces the 27 hand-ordered
// <script> tags — it imports each file for its side effects in the SAME order
// they were loaded in the HTML, so global publication order is preserved exactly.
//
// Do NOT reorder these lines and do NOT convert the imported files to ES modules
// here — that is a later, riskier phase. Keep this list == the old <script> order.
//
// maps-config.local.js (Fase 0) is intentionally absent: the Maps key now comes
// from import.meta.env.VITE_MAPS_KEY (see scripts/config/maps-config.js), with a
// window.RAPIDEX_MAPS_KEY fallback kept for backward compatibility.

import './config/maps-config.js';
import './config/app-config.js';
import './config/fallback-config.js';
import './utils/storage-keys.js';
import './services/api-routes.js';
import './utils/restaurant-slug.js';
import './utils/brand-theme.js';
import './utils/slugify.js';
import './utils/dom.js';
import './utils/validators.js';
import './services/api-client.js';
import './services/api.js';
import './services/customer-auth-service.js';
import './services/restaurant-service.js';
import './services/restaurant-info-service.js';
import './services/menu-service.js';
import './services/customer-service.js';
import './services/address-service.js';
import './services/delivery-service.js';
import './services/cart-service.js';
import './services/order-service.js';
import './services/order-payload.js';
import './services/club-service.js';
import './content/privacy-policy.js';
import './content/loyalty-policy.js';
import './state/order-state.js';
import './state/ui-state.js';
import './stores/restaurant-store.js';
import './stores/customer-store.js';
import './stores/cart-store.js';
import './stores/ui-store.js';
import './pages/restaurant-ui.js';
import './pages/restaurant-club.js';
import './pages/restaurant-rapi.js';
import './pages/restaurant-page.js';
import './pages/cashback-statement.js';
