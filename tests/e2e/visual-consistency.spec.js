import { test, expect } from '@playwright/test';
import { mockApi, seedPickupSession, addH2OToCart, RESTAURANT_URL, esperarAppPronto } from './helpers.js';

// ============================================================================
//  Consistencia visual: o que a padronizacao nao pode desfazer.
//
//  Cada teste aqui existe porque a auditoria de 29/08/2026 mediu uma
//  divergencia concreta no CSS. Sao afirmacoes sobre o que a tela MOSTRA, nao
//  sobre como a folha esta escrita — a folha pode ser reorganizada a vontade
//  desde que estes numeros continuem valendo.
// ============================================================================

/** Contraste WCAG entre duas cores computadas ("rgb(r, g, b)"). */
function contraste(a, b) {
  const canal = (c) => {
    const v = c / 255;
    return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  const lum = (css) => {
    const [r, g, bl] = css.match(/\d+/g).map(Number);
    return 0.2126 * canal(r) + 0.7152 * canal(g) + 0.0722 * canal(bl);
  };
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

async function abrirSacolaComItem(page) {
  await mockApi(page);
  await seedPickupSession(page);
  await page.goto(RESTAURANT_URL);
  await addH2OToCart(page, 3);
  await page.evaluate(() => window.openModal('cartModal'));
  await expect(page.locator('#cartModal')).toHaveClass(/active/);
}

test('o botao que EXCLUI nao pode ser igual ao que confirma o pedido', async ({ page }) => {
  // O defeito: `.addr-delete-yes` usava var(--brand-primary), a mesma cor do
  // CTA da sacola. Num dialogo de duas opcoes, a unica pista de que um dos
  // botoes destroi alguma coisa era a palavra "Sim".
  await abrirSacolaComItem(page);

  const ctaPedido = await page
    .locator('#cartCtaBtn')
    .evaluate((el) => getComputedStyle(el).backgroundColor);

  await page.evaluate(() => {
    const uid = window.PedeAquiCartStore.get().items[0].uid;
    window.RapidexActions.resolve('openCartItemDeleteConfirm')(uid);
  });
  const excluir = page.locator('#cartItemDeleteConfirm .addr-delete-yes');
  await expect(excluir).toBeVisible();

  const fundo = await excluir.evaluate((el) => getComputedStyle(el).backgroundColor);
  const texto = await excluir.evaluate((el) => getComputedStyle(el).color);

  expect(fundo, 'excluir e confirmar pedido nao podem ter a mesma cor').not.toBe(ctaPedido);

  // E vermelho de verdade, nao um laranja um pouco diferente: canal R domina
  // com folga sobre G e B.
  const [r, g, b] = fundo.match(/\d+/g).map(Number);
  expect(r, 'o vermelho de perigo tem R alto').toBeGreaterThan(150);
  expect(r - g, 'R bem acima de G').toBeGreaterThan(120);
  expect(r - b, 'R bem acima de B').toBeGreaterThan(120);

  // Legivel: o rotulo e 12px/700, texto normal para efeito de contraste.
  expect(
    contraste(fundo, texto),
    'texto do botao de perigo precisa de 4.5:1'
  ).toBeGreaterThanOrEqual(4.5);
});

test('toda seta de voltar do app tem a mesma caixa', async ({ page }) => {
  // Havia DEZ regras prefixadas por id repetindo 32x32 / 9px / #ececec para
  // derrubar uma base que dizia 36x36 / 50% / #f5f5f5 (e 40x40 / 12px no
  // mobile). As unicas telas que mostravam a base eram o Checkout e o Ajuda do
  // perfil — que por isso tinham a seta visivelmente maior e mais clara que a
  // dos irmaos ao lado. A base virou o valor que as dez repetiam.
  //
  // A varredura le TODOS os botoes do documento, inclusive os de telas
  // fechadas: getComputedStyle nao precisa do elemento visivel, e assim o teste
  // cobre as 14 setas sem navegar por 14 telas.
  await mockApi(page);
  await seedPickupSession(page);
  await page.goto(RESTAURANT_URL);
  await esperarAppPronto(page);

  const caixas = await page.evaluate(() =>
    [...document.querySelectorAll('.cart-hdr-back')].map((el) => {
      const s = getComputedStyle(el);
      return {
        onde: el.closest('[id]')?.id || '(sem id)',
        w: s.width,
        h: s.height,
        raio: s.borderRadius,
        fundo: s.backgroundColor
      };
    })
  );

  expect(caixas.length, 'o app tem varias setas de voltar').toBeGreaterThanOrEqual(10);
  const fora = caixas.filter(
    (c) => c.w !== '32px' || c.h !== '32px' || c.raio !== '9px' || c.fundo !== 'rgb(236, 236, 236)'
  );
  expect(fora, `setas fora do padrao:\n${JSON.stringify(fora, null, 2)}`).toEqual([]);

  // O espacador acompanha o botao, senao o titulo sai do centro.
  const espacadores = await page.evaluate(() =>
    [...document.querySelectorAll('.cart-hdr-spacer')].map((el) => getComputedStyle(el).width)
  );
  expect(new Set(espacadores).size, 'um unico valor de espacador').toBeLessThanOrEqual(1);
  if (espacadores.length) expect(espacadores[0]).toBe('32px');
});

test('nenhum peso de fonte pedido esta fora dos que o Inter carrega', async ({ page }) => {
  // O <link> do Google Fonts pede Inter em 100;300;400;500;600;700;800. Pesos
  // fora dessa lista (650, 850, 615, 425...) nao existem no arquivo: o
  // navegador arredonda para o vizinho e a folha passa a mentir sobre o que
  // renderiza. 88 declaracoes estavam assim.
  await mockApi(page);
  await seedPickupSession(page);
  await page.goto(RESTAURANT_URL);
  await esperarAppPronto(page);

  const fora = await page.evaluate(() => {
    const CARREGADOS = new Set(['100', '300', '400', '500', '600', '700', '800']);
    const vistos = new Set();
    for (const folha of document.styleSheets) {
      let regras;
      try {
        regras = folha.cssRules;
      } catch {
        continue; // folha de outra origem (a do Google) nao e legivel
      }
      const anda = (lista) => {
        for (const r of lista) {
          if (r.cssRules) anda(r.cssRules);
          const w = r.style?.getPropertyValue('font-weight')?.trim();
          if (w && /^\d+$/.test(w) && !CARREGADOS.has(w)) vistos.add(`${w} em ${r.selectorText}`);
        }
      };
      anda(regras);
    }
    return [...vistos];
  });

  expect(fora, `pesos que a fonte nao tem:\n  ${fora.join('\n  ')}`).toEqual([]);
});
