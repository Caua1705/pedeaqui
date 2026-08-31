import { test, expect } from '@playwright/test';
import { mockApi, seedPickupSession, RESTAURANT_URL, PRODUCT_H2O, esperarAppPronto } from './helpers.js';

test('detalhe recomendado pelo Rapi anima ao abrir e ao voltar', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockApi(page);
  await page.route('**/chat', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      response_type: 'products',
      products: [{
        id: PRODUCT_H2O,
        name: 'Água H2O',
        description: 'Produto recomendado pelo Rapi.',
        price: 7.05,
        recommendation_reason: 'Combina com o que você pediu.'
      }]
    })
  }));
  await seedPickupSession(page);
  await page.goto(RESTAURANT_URL);
  await esperarAppPronto(page);
  await page.evaluate(() => window.RapidexActions.resolve('mobNavAssistant')());

  await page.locator('#assistantInput').fill('Me recomenda um prato');
  await page.locator('.assistant-ai-send').click();
  await expect(page.locator('.assistant-product-card')).toBeVisible();

  const detail = page.locator('#assistantProductDetail');

  // A SONDA VIVE DENTRO DA PÁGINA E MEDE CONTRA O RELÓGIO DA PRÓPRIA ANIMAÇÃO.
  //
  // A versão anterior deste teste lia `getAnimations()` de fora e, depois de um
  // `waitForTimeout(120)`, exigia `display: flex`. As duas afirmações são sobre
  // um INSTANTE que só existe enquanto a saída corre, e quem decide se ele ainda
  // dura quando a pergunta atravessa o protocolo é a carga da máquina — não o
  // app. Sob quatro workers a pergunta chegou depois dos 540 ms do temporizador
  // que devolve o `hidden`, leu `display: none` e reprovou um app correto
  // (suíte completa de 31/08/2026: "Expected flex, Received none").
  //
  // O que esta tela promete não é um pixel num milissegundo: é que o painel
  // continue DESENHADO enquanto a transição de saída inteira corre — a nota no
  // `assistant.css` diz isso com todas as letras, e é o que `[hidden]
  // {display:none}` cedo demais quebra. Então a sonda mede, em quadros de
  // animação, quanto tempo o diálogo ficou desenhado depois que a saída começou,
  // e compara com a duração que o PRÓPRIO CSS declara. Assim o teste também
  // passa a pegar o defeito que o antigo não pegava: alongar a transição no CSS
  // sem alongar o temporizador do JS.
  await detail.evaluate(element => {
    const alvo = element.querySelector('.assistant-product-detail-panel');
    const registro = { abertura: [], fechamento: [], transicaoMs: null, desenhadoAteMs: null };
    window.__detalheDoRapi = registro;
    alvo.addEventListener('transitionrun', evento => {
      if (evento.target !== alvo || evento.propertyName !== 'transform') return;
      if (element.classList.contains('is-open')) { registro.abertura.push('transform'); return; }

      registro.fechamento.push('transform');
      registro.transicaoMs = Math.round(parseFloat(getComputedStyle(alvo).transitionDuration) * 1000);
      const inicio = performance.now();
      const olhar = () => {
        if (getComputedStyle(element).display === 'none') {
          registro.desenhadoAteMs = Math.round(performance.now() - inicio);
          return;
        }
        requestAnimationFrame(olhar);
      };
      requestAnimationFrame(olhar);
    });
  });
  const registro = () => page.evaluate(() => window.__detalheDoRapi);

  await page.locator('.assistant-product-card').click();
  await expect(detail).toHaveClass(/is-open/);
  await expect.poll(async () => (await registro()).abertura).toContain('transform');

  await detail.locator('.assistant-product-detail-close').click();
  await expect(detail).not.toHaveClass(/is-open/);
  // Se a saída nem começasse (o caso de `hidden` voltando junto com a classe),
  // é aqui que o teste morre, e dizendo qual metade faltou.
  await expect.poll(async () => (await registro()).fechamento).toContain('transform');

  await expect.poll(async () => (await registro()).desenhadoAteMs !== null,
    { timeout: 5_000 }).toBe(true);
  const medido = await registro();
  expect(
    medido.desenhadoAteMs,
    `o painel parou de ser desenhado ${medido.desenhadoAteMs} ms depois do começo da `
      + `saída, e o CSS declara ${medido.transicaoMs} ms de transição — o fim da `
      + `animação foi cortado`
  ).toBeGreaterThanOrEqual(medido.transicaoMs);

  // E o `hidden` volta: o diálogo sai da árvore de acessibilidade quando acaba.
  await expect(detail).toHaveAttribute('hidden', '');
});
