// Service worker do Rapidex.
//
// A REGRA QUE MANDA EM TODO O RESTO: este arquivo NUNCA pode entregar cardápio,
// preço, taxa de entrega, cupom ou status de loja aberta/fechada que tenha vindo
// de cache. Um preço velho servido offline não é "degradação graciosa": é o
// cliente fechando um pedido por um valor que a loja não pratica mais.
//
// Por isso a política não é "cache com revalidação" para dados — é REDE, ponto.
// A garantia é ESTRUTURAL, não uma convenção que alguém precisa lembrar:
//
//   - `event.respondWith` só é chamado para GET da PRÓPRIA origem;
//   - a API vive em outra origem (api.pederapidex.com), então toda chamada de
//     dado cai fora do `if` e vai para a rede sem passar por aqui;
//   - e mesmo que um dia a API passe a ser servida em /api/ na mesma origem,
//     NETWORK_ONLY já a exclui explicitamente.
//
// O que É cacheado, e por que é seguro:
//   - /assets/<nome>-<hash>.<ext> — o hash do Vite é do CONTEÚDO. Mudou o
//     arquivo, mudou a URL. Um cache-first aqui não tem como ficar velho.
//   - imagens de marca sem hash (copiadas verbatim pelo build) — stale-while-
//     revalidate. São logo e mascote, não preço.
//   - o HTML — network-first. Cai no cache SÓ quando a rede falha, e o HTML não
//     carrega nenhum preço: ele é a casca, os dados chegam por fetch depois.
const VERSION = 'v2';
const SHELL_CACHE = `rapidex-shell-${VERSION}`;
const ASSET_CACHE = `rapidex-assets-${VERSION}`;
const CURRENT_CACHES = [SHELL_CACHE, ASSET_CACHE];

// Teto de documentos guardados. Cada tenant navegado deixa uma cópia do HTML
// (~100 kB); sem teto, um device que passeia por muitos restaurantes acumula
// sem fim. 8 é folgado para o uso real (1–2 restaurantes por aparelho).
const MAX_SHELL_ENTRIES = 8;

// Nunca passam pelo cache, mesmo sendo da própria origem.
//   /api/          — dado, pela regra do topo.
//   sw.js          — quem versiona o worker é o browser.
//   manifest       — precisa refletir o tenant e a marca do momento.
const NETWORK_ONLY = /^\/api\/|^\/sw\.js$|manifest\.webmanifest$/;

// Saída hasheada do Vite: <nome>-<hash>.<ext>, com hash de 8 caracteres.
const HASHED_ASSET = /^\/assets\/.+-[A-Za-z0-9_-]{8}\.[a-z0-9]+$/;

// Assets copiados verbatim (vite.config.js / viteStaticCopy) e ícones do PWA:
// mesmo nome entre deploys, então precisam revalidar.
const STATIC_ASSET = /^\/assets\//;

self.addEventListener('install', () => {
  // Nada de precache: os nomes hasheados só existem depois do build e este
  // arquivo é escrito à mão. O cache se forma conforme o uso real.
  //
  // Sem skipWaiting de propósito. Uma versão nova só assume quando não sobra
  // nenhuma aba controlada pela antiga — assim uma página já aberta nunca troca
  // de worker no meio da sessão.
});

self.addEventListener('activate', event => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names
          .filter(name => name.startsWith('rapidex-') && !CURRENT_CACHES.includes(name))
          .map(name => caches.delete(name))
      );
      await self.clients.claim();
    })()
  );
});

self.addEventListener('fetch', event => {
  const request = event.request;

  // POST /orders, PATCH, DELETE: nunca. Só GET tem resposta cacheável.
  if (request.method !== 'GET') return;

  let url;
  try {
    url = new URL(request.url);
  } catch {
    return;
  }

  // Outra origem = API, Google Fonts, Maps, imagens do Supabase. Tudo direto
  // para a rede. É esta linha que torna impossível servir preço de cache.
  if (url.origin !== self.location.origin) return;
  if (NETWORK_ONLY.test(url.pathname)) return;

  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request));
    return;
  }
  if (HASHED_ASSET.test(url.pathname)) {
    event.respondWith(cacheFirst(request));
    return;
  }
  if (STATIC_ASSET.test(url.pathname)) {
    event.respondWith(staleWhileRevalidate(request));
    return;
  }
  // Qualquer outra coisa da própria origem: rede, sem opinião.
});

// Só respostas completas e da própria origem entram no cache. Um 404, um 500 ou
// uma resposta opaca guardados viram erro permanente até o cache virar.
function isCacheable(response) {
  return Boolean(response) && response.ok && response.type === 'basic';
}

// O HTML é a casca do app e não carrega preço nenhum — os dados chegam por
// fetch depois que ele roda. Mesmo assim a rede vem primeiro: uma casca velha
// aponta para /assets/<hash> que o deploy novo já apagou.
async function networkFirst(request) {
  const cache = await caches.open(SHELL_CACHE);
  try {
    const response = await fetch(request);
    if (isCacheable(response)) {
      await cache.put(request, response.clone());
      await trimCache(cache, MAX_SHELL_ENTRIES);
    }
    return response;
  } catch (error) {
    // Offline. Devolve a cópia DESTA MESMA URL, nunca a de outra: o HTML é
    // idêntico entre tenants hoje, mas responder a /pizzaria com o documento
    // guardado de /churrascaria é a porta de um vazamento entre tenants.
    const cached = await cache.match(request);
    if (cached) return cached;
    throw error;
  }
}

// URL contém o hash do conteúdo: se está no cache, está correto por definição.
async function cacheFirst(request) {
  const cache = await caches.open(ASSET_CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (isCacheable(response)) await cache.put(request, response.clone());
  return response;
}

// Nome estável entre deploys: entrega o que tem e busca a versão nova em
// paralelo, para a próxima visita. Vale só para imagem de marca.
async function staleWhileRevalidate(request) {
  const cache = await caches.open(ASSET_CACHE);
  const cached = await cache.match(request);
  const network = fetch(request)
    .then(response => {
      if (isCacheable(response)) cache.put(request, response.clone());
      return response;
    })
    .catch(() => null);
  if (cached) return cached;
  const response = await network;
  if (response) return response;
  throw new Error(`Falha ao buscar ${request.url}`);
}

// A Cache API devolve as chaves em ordem de inserção, então as primeiras são as
// mais antigas. Sem contagem de acesso: o custo de manter LRU de verdade não se
// paga para um teto de 8.
async function trimCache(cache, maxEntries) {
  const keys = await cache.keys();
  if (keys.length <= maxEntries) return;
  await Promise.all(keys.slice(0, keys.length - maxEntries).map(key => cache.delete(key)));
}
