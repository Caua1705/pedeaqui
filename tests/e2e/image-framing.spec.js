import { test, expect } from '@playwright/test';
import { mockApi, RESTAURANT_URL, seedPickupSession, esperarAppPronto } from './helpers.js';

// As derivadas do Storage precisam chegar com a MESMA proporção do original.
// Pedindo só `width`, o modo padrão (`cover`) usa a altura original como alvo e
// devolve a imagem achatada — 1200x719 virava 168x719. Com object-fit:cover, o
// browser amplia até cobrir a caixa e corta o resto: era o enquadramento
// estragado dos cupons, banners e fotos de produto.
//
// Este teste bate na rede de verdade (as fixtures apontam para o bucket real e
// mockApi só intercepta api.pederapidex.com), que é o único jeito de flagrar
// uma regressão que mora na resposta do Storage e não no nosso CSS.

test.use({ viewport: { width: 390, height: 844 } });

// Quanto a proporção da derivada pode fugir da do original.
const TOLERANCIA = 0.04;

// Espera haver DERIVADA CARREGADA SUFICIENTE para medir — condição, não relógio.
//
// Aqui havia `waitForTimeout(2500)` em dois testes. Este spec bate na REDE de
// verdade (as fixtures apontam para o bucket real), então 2,5 s é uma aposta
// sobre a rede da máquina que estiver rodando — e a aposta errada NÃO FALHA:
// ela media naturalWidth 0, a proporção virava NaN e a imagem passava como se
// estivesse certa.
//
// A primeira versão desta espera exigia que TODAS as candidatas estivessem
// `complete`, e ela estourou o teto de 30 s na tela do cardápio: as fotos
// entram por lazy-load conforme o layout assenta, então sempre há uma em voo e
// o "todas" nunca fecha. É a mesma lição do `scrollToSection` desta rodada —
// não peça à página um estado de repouso que a afirmação nunca precisou.
//
// O que a afirmação precisa é de amostra: se a derivada vier achatada, ela vem
// achatada em TODAS as imagens daquele tipo. Quatro carregadas bastam, e o
// filtro de `measure` (naturalWidth > 0) garante que nenhuma das medidas seja
// uma imagem em voo.
const MINIMO_MEDIVEL = 4;

async function esperarDerivadasCarregadas(page) {
  await page.waitForFunction((minimo) => {
    const prontas = [...document.querySelectorAll('img')].filter(
      (img) => img.currentSrc.includes('/render/image/public/') && img.clientWidth > 20
        && img.complete && img.naturalWidth > 0
    );
    return prontas.length >= minimo;
  }, MINIMO_MEDIVEL, { timeout: 20000 });
}

async function boot(page) {
  // `imagensReais: true` — A EXCEÇÃO, e ela é o motivo de o interruptor existir.
  //
  // Desde 05/09/2026 `mockApi()` dubla as imagens do Storage com um pixel de
  // 1x1: as fixtures apontam para o bucket de produção e a suíte inteira
  // baixava tudo de verdade, o que estourou a cota de egress do plano.
  //
  // ESTE spec é o único que não pode aceitar o dublê, e a razão está no
  // cabeçalho acima: ele compara a proporção da DERIVADA com a do ORIGINAL.
  // Com o pixel, as duas viram 1x1, a razão fica 1 contra 1 e ele passa VERDE
  // sem ter medido nada — nem o `rows.length > 0` pega, porque medir um pixel
  // ainda é medir algo. Medido, com o `resize=contain` removido de
  // `image-cdn.js`: com imagens reais ele REPROVA; com o dublê ele PASSA.
  //
  // O preço é o download de algumas dezenas de derivadas por execução. É o
  // preço do único guarda que existe contra um defeito que mora na resposta do
  // Storage, e não no nosso CSS.
  await mockApi(page, { imagensReais: true });
  await seedPickupSession(page);
  await page.goto(RESTAURANT_URL);
  await esperarAppPronto(page);
}

// Mede, para cada <img> transformada em tela, a proporção do candidato que o
// browser realmente baixou contra a proporção do original apontado no src.
const measure = () =>
  Promise.all(
    [...document.querySelectorAll('img')]
      // `naturalWidth > 0` não é zelo: uma imagem ainda não carregada dá
      // naturalWidth 0, a proporção vira NaN, e `Math.abs(NaN - x) > 0.04` é
      // FALSO — ela passaria como se estivesse certa. Sem isso, o teste ficava
      // dependendo de a espera ter sido longa o bastante para não mentir.
      .filter((img) => img.currentSrc.includes('/render/image/public/') && img.clientWidth > 20 && img.naturalWidth > 0)
      .slice(0, 12)
      .map(
        (img) =>
          new Promise((resolve) => {
            const probe = new Image();
            probe.onload = () =>
              resolve({
                nome: img.currentSrc.split('/').pop().split('?')[0],
                derivada: img.naturalWidth / img.naturalHeight,
                original: probe.naturalWidth / probe.naturalHeight,
                fit: getComputedStyle(img).objectFit
              });
            probe.onerror = () => resolve(null);
            probe.src = img.getAttribute('src');
          })
      )
  ).then((rows) => rows.filter(Boolean));

function assertProporcional(rows) {
  expect(rows.length, 'nenhuma imagem transformada em tela — o teste não mediu nada').toBeGreaterThan(0);
  const tortas = rows
    .filter((r) => Math.abs(r.derivada - r.original) > TOLERANCIA)
    .map(
      (r) =>
        `${r.nome}: derivada ${r.derivada.toFixed(3)} vs original ${r.original.toFixed(3)} (fit:${r.fit})`
    );
  expect(tortas, 'derivada com proporção diferente do original').toEqual([]);
}

test('cupons e banners da home mantêm a proporção do original', async ({ page }) => {
  await boot(page);
  await esperarDerivadasCarregadas(page);
  assertProporcional(await page.evaluate(measure));
});

test('as fotos do cardápio mantêm a proporção do original', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => window.mobNavMenu?.());
  await page.waitForFunction(() => document.querySelectorAll('.product-image').length > 0);
  await esperarDerivadasCarregadas(page);

  const rows = await page.evaluate(measure);
  assertProporcional(rows);

  // A foto de produto é quadrada na origem e a caixa é 110x110: com a proporção
  // certa, `cover` não corta nada. Se a derivada voltar achatada, corta muito.
  const quadradas = rows.filter((r) => Math.abs(r.original - 1) < 0.02);
  expect(quadradas.length, 'nenhuma foto quadrada medida').toBeGreaterThan(0);
});
