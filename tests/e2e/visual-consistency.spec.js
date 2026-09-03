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

// A HIERARQUIA DO "Deseja sair?" ESTAVA INVERTIDA.
//
// Quem abre este dialogo quer sair; o cheio tem de ser o "Sair". Ate 03/09/2026
// era o contrario — `#logoutConfirm .addr-delete-cancel` (o "Cancelar") vinha
// com `background:var(--brand-primary)` e o "Sair" contornado.
//
// Isto era a §4.1 da skill em pessoa: `.addr-delete-yes` e
// `.addr-delete-cancel` nomeiam a POSICAO no par, nao a funcao, e nesta tela os
// papeis vinham trocados. Ficou levantado de proposito em 30/08/2026 por ser
// decisao de produto; a decisao foi tomada agora, e as tres telas passam a ler
// igual: `.addr-delete-yes` e a acao, `.addr-delete-cancel` volta atras.
//
// O que este teste NAO exige: que o Sair seja vermelho. Sair da conta nao apaga
// nada — a cor de estado e para o que destroi, e o teste abaixo guarda os dois
// dialogos onde ela vale.
test('no "Deseja sair?" o botao CHEIO e o Sair, e o Cancelar e o contornado', async ({ page }) => {
  // A INVERSAO SO EXISTE NO CELULAR: o bloco que a fazia mora dentro de
  // `@media(max-width:767px)` (utilities.css). Na largura padrao do Playwright
  // (1280) esta tela nem chega a ser a folha de baixo, e o teste passaria sem
  // ter olhado para o defeito.
  await page.setViewportSize({ width: 414, height: 896 });
  await mockApi(page);
  await seedPickupSession(page);
  await page.goto(RESTAURANT_URL);
  await esperarAppPronto(page);
  await page.evaluate(() => {
    window.PedeAquiCustomerAuth.setToken('e2e-logout-token');
    window.PedeAquiCustomerService.getCurrentCustomer = async () => ({ id: 'c', name: 'E2E', phone: '85999999999' });
    window.PedeAquiOrderService.getCustomerOrders = async () => [];
    window.PedeAquiAddressService.getCustomerAddresses = async () => [];
    window.RapidexActions.resolve('logout')();
  });

  const sair = page.locator('#logoutConfirm .addr-delete-yes');
  const cancelar = page.locator('#logoutConfirm .addr-delete-cancel');
  await expect(sair).toBeVisible();

  // Os rotulos primeiro: sem isto o teste afirmaria sobre a classe, e a classe
  // e justamente a que mente aqui.
  await expect(sair).toHaveText('Sair');
  await expect(cancelar).toHaveText('Cancelar');
  await expect(sair).toHaveAttribute('data-act-click', /confirmLogout/);
  await expect(cancelar).toHaveAttribute('data-act-click', /cancelLogout/);

  const caixa = (locator) =>
    locator.evaluate((el) => {
      const cs = getComputedStyle(el);
      return { fundo: cs.backgroundColor, texto: cs.color, borda: cs.borderTopWidth };
    });
  const marca = await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue('--brand-primary').trim()
  );
  const hexParaRgb = (hex) => {
    const n = hex.replace('#', '');
    const [r, g, b] = [0, 2, 4].map((i) => parseInt(n.slice(i, i + 2), 16));
    return `rgb(${r}, ${g}, ${b})`;
  };

  const cheio = await caixa(sair);
  const vazado = await caixa(cancelar);

  expect(cheio.fundo, 'o Sair e o preenchido na cor da marca').toBe(hexParaRgb(marca));
  expect(cheio.borda, 'preenchido nao tem borda').toBe('0px');
  expect(vazado.fundo, 'o Cancelar nao pode estar preenchido na marca').not.toBe(
    hexParaRgb(marca)
  );
  expect(vazado.texto, 'o Cancelar leva a marca no TEXTO').toBe(hexParaRgb(marca));
  expect(parseFloat(vazado.borda), 'o Cancelar e contornado').toBeGreaterThan(0);

  // Contraste do rotulo sobre o preenchido: o piso e 3:1, nao 4,5.
  // `--brand-on` e calculado por `onBrandColor()` contra ON_BRAND_MIN_CONTRAST
  // = 3, que e o minimo AA de COMPONENTE de interface — rotulo de botao, chip,
  // aba ativa —, nunca texto corrido. Exigir 4,5 aqui seria exigir deste botao
  // mais do que o app inteiro exige de toda superficie de marca (o CTA da
  // sacola da 3,83:1 no piloto). O 4,5 do teste de cima e outro caso: la a cor
  // e NOSSA (--state-danger-strong), escolhida justamente para alcanca-lo.
  expect(contraste(cheio.fundo, cheio.texto)).toBeGreaterThanOrEqual(3);
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
