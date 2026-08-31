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
// Favicon, ícone de tela inicial e meta de compartilhamento do tenant. Depende
// de brand-theme (cor da marca e guarda de contraste da letra) e precisa vir
// ANTES de pwa.js, que consome tenantIcons() para montar o manifest.
import './utils/tenant-identity.js';
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
// Formatador unico de dinheiro. Precisa vir ANTES das paginas: quatro delas o
// chamam ao renderizar, e o modulo nao tem fallback de proposito.
import './utils/currency.js';
// As 14 ferramentas de tela (skill §9). Le os globais NA CHAMADA, entao a
// posicao exata nao importa — só precisa vir antes das telas (screens/*).
import './utils/screen-kit.js';
import './utils/validators.js';
// Leitura do `detail` de erro da API (string | array 422 | objeto estruturado).
// Precisa vir antes do api-client, que o usa para montar a mensagem do erro.
import './utils/api-error.js';
import './services/api-client.js';
import './services/api.js';
import './services/customer-auth-service.js';
import './services/branch-availability-service.js';
import './services/restaurant-info-service.js';
import './services/payment-config-service.js';
import './services/menu-service.js';
import './services/customer-service.js';
import './services/address-service.js';
import './services/customer-card-service.js';
import './services/mercado-pago-service.js';
import './services/delivery-service.js';
import './services/cart-service.js';
import './services/order-service.js';
import './services/order-payload.js';
import './services/club-service.js';
// Rotulo do cupom, lido pela folha de detalhe (restaurant-page) e pelo card do
// Clube (restaurant-club). Usa o formatador de moeda, importado la em cima.
import './services/coupon-format.js';
// Rotulo da bandeira do cartao, lido pela lista de cartoes salvos
// (payment-card-flow) e pela linha de pagamento da sacola (restaurant-page).
// Nao depende de nada; so precisa vir antes dos dois.
import './services/card-format.js';
// Formatadores puros de /info (skill §9). Puros de verdade: nao dependem de
// nada e nada aqui depende da posicao deles.
import './services/store-info-format.js';
import './content/privacy-policy.js';
import './content/loyalty-policy.js';
import './state/order-state.js';
// tracking_token por slug. Precisa vir antes das páginas, que gravam o token no
// mesmo instante em que a resposta de POST /orders chega.
import './state/order-tracking.js';
import './stores/restaurant-store.js';
import './stores/cart-store.js';
import './pages/restaurant-ui.js';
import './pages/restaurant-club.js';
import './pages/restaurant-assistant.js';
// Depende da ponte publicada por restaurant-assistant.js (RapidexAssistantChat).
import './pages/restaurant-assistant-voice.js';
// O transporte se registra na tela por setDriver(), então vem DEPOIS dela.
import './pages/restaurant-assistant-voice-session.js';
// Fluxo de endereco (escolha, lista, Google Maps, formulario). Veio de dentro do
// restaurant-page.js. Precisa carregar ANTES dele: e quem publica
// window.PedeAquiAddressFlow, que o restaurant-page consome no proprio corpo do
// IIFE, chamando init() com as dependencias que ficaram la.
import './pages/restaurant-address-flow.js';
// Pagamento por Pix e acompanhamento do pedido. Mesmo motivo de ordem do
// modulo de endereco: publica window.PedeAquiPixFlow, que o restaurant-page
// consome no corpo do proprio IIFE.
import './pages/restaurant-pix-flow.js';
// Entrar, cadastrar, verificar codigo e recuperar senha. Mesmo motivo de ordem
// dos outros dois: publica window.PedeAquiAuthFlow, consumido pelo
// restaurant-page no corpo do proprio IIFE.
import './pages/restaurant-auth-flow.js';
// Telas do contrato mount(ctx) (skill §9). Publicam window.PedeAqui*Screen e
// NAO executam nada no import; o restaurant-page chama mount() no fim do IIFE
// dele — por isso TODA tela precisa vir antes dele.
import './pages/screens/profile-screen.js';
import './pages/screens/customer-data-screen.js';
import './pages/restaurant-page.js';
// A tela de cartao usa as acoes publicadas por restaurant-page para voltar a
// sacola com o meio de pagamento selecionado, portanto vem logo depois dela.
import './pages/payment-card-flow.js';
import './pages/cashback-statement.js';
