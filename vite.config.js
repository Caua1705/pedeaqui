import { defineConfig } from 'vite';
import { resolve } from 'node:path';
import { viteStaticCopy } from 'vite-plugin-static-copy';
import { vercelRewrites } from './tools/vercel-rewrites.js';

// Multi-page build. Both HTML files are entry points; each pulls in a single
// module entry that side-effect-imports the app scripts in their original order
// (see scripts/entry-restaurant.js). Vite then bundles, minifies and hashes the
// output, which replaces the manual ?v=N cache-busting the HTML used before.
export default defineConfig({
  // Served at domain root (Vercel), same as today.
  base: '/',

  // public/ é o diretório dos arquivos que o Vite copia VERBATIM: mesmo nome,
  // mesmo caminho, sem hash e sem entrar no module graph. É o único mecanismo
  // que atende os três arquivos do PWA, para os quais o caminho é contrato:
  //
  //  - public/sw.js -> /sw.js. Um service worker só controla o diretório em que
  //    ele mora; hasheado ou movido para /assets, o escopo deixaria de ser "/".
  //  - public/manifest.webmanifest -> /manifest.webmanifest. É o destino do
  //    rewrite /:slug/manifest.webmanifest da vercel.json, e seu start_url é o
  //    relativo "./" — em /assets/manifest-<hash>.webmanifest o escopo do app
  //    instalado viraria /assets/.
  //  - public/assets/icons/pwa/*.png. São citados por caminho ABSOLUTO dentro
  //    do JSON do manifest, que o Vite não lê nem reescreve.
  //
  // Não é redundante com o viteStaticCopy abaixo: aquele existe para arquivos
  // que ficam FORA daqui (assets/ é a árvore de origem, com os PNGs master que
  // não podem ir para o build). Este é o oposto — nasce pronto para o dist.
  publicDir: 'public',

  plugins: [
    // O roteamento de produção vive na vercel.json e não existe localmente. Sem
    // este espelho, /<slug>/manifest.webmanifest — a URL de que o manifest por
    // tenant depende — daria 404 em dev, no preview e no e2e.
    vercelRewrites(resolve(import.meta.dirname, 'vercel.json')),

    // Algumas imagens são montadas por string em runtime (a URL só existe
    // depois que o JS roda), então o module graph do Vite nunca as vê e é
    // preciso copiá-las verbatim.
    //
    // A lista é EXPLÍCITA, e não `assets/**/*`, por dois motivos:
    //
    // 1. `{ src: 'assets/**/*', dest: 'assets' }` gravava em
    //    dist/assets/assets/... — com o prefixo duplicado — enquanto o runtime
    //    pede /assets/brand/... Ou seja: o mascote e o ícone de carrinho do
    //    cliente logado respondiam 404 no build. O <img> do mascote tem
    //    data-act-error="$hide", então ele sumia calado em vez de acusar.
    //    tests/e2e/assets.spec.js agora trava esse contrato.
    // 2. Copiar a árvore inteira levava junto os PNGs master (1,2 MB), que
    //    servem só para regerar as variantes (tools/optimize-images.mjs) e
    //    nunca são pedidos pelo browser.
    //
    // Só entram aqui os arquivos referenciados por string em JS. O que é
    // referenciado no HTML continua indo pelo module graph, que hasheia o nome
    // e resolve o cache-busting sozinho.
    viteStaticCopy({
      targets: [
        // dest é '.' porque o plugin NÃO corta o diretório-base do src: ele
        // anexa o caminho inteiro sob o dest. Era daí que vinha o /assets/assets.
        // scripts/pages/restaurant-rapi.js — RAPI_AVATAR_SRC/SRCSET
        { src: 'assets/brand/rapi-mascot@*.webp', dest: '.' },
        // scripts/pages/restaurant-page.js — troca o ícone conforme o login
        { src: 'assets/icons/cart/cart-location-*@*.webp', dest: '.' },
        // scripts/pages/restaurant-page.js — marca do Pix na lista de formas de
        // pagamento. Montada por string, então nunca esteve no module graph: no
        // build ela respondia com o fallback de SPA (200 text/html) em vez da
        // imagem, e o ícone não pintava.
        { src: 'assets/icons/payment/pix.png', dest: '.' }
      ]
    })
  ],

  build: {
    outDir: 'dist',
    emptyOutDir: true,

    // As variantes por DPR não podem virar data: URI.
    //
    // Elas são pequenas (0,3–4,8 kB) e caem sob o limite padrão de inline do
    // Vite, mas inlinar CANDIDATO DE SRCSET é contraproducente: as três URLs do
    // srcset viram três blobs base64 no HTML, então todo cliente baixa 1x, 2x e
    // 3x — em base64, +33% — para renderizar uma só. Medido: só isso engordava
    // restaurant.html de 19,1 para 25,6 kB gzip.
    //
    // Os demais assets seguem o padrão do Vite (undefined = decide ele).
    assetsInlineLimit: (filePath) =>
      /@\dx\.(webp|avif|png)$/.test(filePath) ? false : undefined,
    // Hashed filenames per Vite defaults ([name]-[hash]); this is what
    // supersedes the hand-incremented ?v=N query strings.
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, 'index.html'),
        restaurant: resolve(import.meta.dirname, 'restaurant.html')
      }
    }
  },

  server: {
    port: 5173,
    strictPort: true,
    host: '127.0.0.1'
  },
  preview: {
    port: 4174,
    host: '127.0.0.1'
  }
});
