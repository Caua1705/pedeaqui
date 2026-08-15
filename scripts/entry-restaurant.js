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
// Depende de restaurant-slug (topologia do tenant) e de brand-theme (cor).
import './utils/pwa.js';
import './utils/actions.js';
import './utils/slugify.js';
import './utils/dom.js';
// Registro de desligamento (signal + onTeardown). Precisa vir antes das páginas,
// que registram os observers e intervalos nele.
import './utils/lifecycle.js';
// Cache com prazo e teto. Precisa vir antes dos serviços que o instanciam.
import './utils/ttl-cache.js';
import './utils/image-cdn.js';
// Gerador do QR do Pix. Sem dependência de runtime e sem imagem externa — a
// CSP proíbe as duas coisas. Ver o cabeçalho do arquivo.
import './utils/qrcode.js';
import './utils/validators.js';
// Leitura do `detail` de erro da API (string | array 422 | objeto estruturado).
// Precisa vir antes do api-client, que o usa para montar a mensagem do erro.
import './utils/api-error.js';
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
// tracking_token por slug. Precisa vir antes das páginas, que gravam o token no
// mesmo instante em que a resposta de POST /orders chega.
import './state/order-tracking.js';
import './state/ui-state.js';
import './stores/restaurant-store.js';
import './stores/customer-store.js';
import './stores/cart-store.js';
import './stores/ui-store.js';
import './pages/restaurant-ui.js';
import './pages/restaurant-club.js';
import './pages/restaurant-assistant.js';
// Depende da ponte publicada por restaurant-assistant.js (RapidexAssistantChat).
import './pages/restaurant-assistant-voice.js';
import './pages/restaurant-page.js';
import './pages/cashback-statement.js';
