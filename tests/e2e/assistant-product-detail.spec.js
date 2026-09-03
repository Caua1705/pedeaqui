import { test, expect } from '@playwright/test';
import { mockApi, seedPickupSession, RESTAURANT_URL, PRODUCT_H2O, esperarAppPronto } from './helpers.js';

// AS MARGENS, E POR QUE CADA UMA TEM O TAMANHO QUE TEM.
//
// O CI reprovou este teste exigindo `>= 520` e medindo 519, depois 518 no
// retry. O app estava certo nas duas vezes: o CSS declara `.52s` de transição e
// o JS devolve o `hidden` em 540 ms, então a folga REAL do app é de 20 ms — e a
// sonda gastava essa folga inteira antes de começar a contar. A origem do
// relógio foi corrigida (o comentário da sonda tem a medida), e o que sobra de
// instabilidade é o que estas margens cobrem.
//
// Medir duração de animação com precisão de milissegundo em máquina
// compartilhada nunca vai ser estável: quem decide quando um quadro é desenhado
// é o escalonador do SO, não o app. Um teto de "1 ms de folga" acusa a máquina
// e chama isso de regressão. Então a afirmação ganha margem — e a margem tem
// tamanho MEDIDO, e é do tamanho do INSTRUMENTO que ela cobre. São dois
// instrumentos com resoluções diferentes, então são dois números:
//
// `desenhadoAteMs` é lido por `requestAnimationFrame`, então erra até um quadro
// de cada lado: 33 ms são dois quadros a 60 Hz. É o mais grosseiro dos dois, e
// carga o piora muito — medido com a CPU estrangulada por CDP, em 26 execuções
// sadias ele varreu 562–568 ocioso, 618–681 a 6x com 4 workers e 627–777 a 10x.
// Nenhuma abaixo dos 540 do app, em regime nenhum.
//
// `hiddenAosMs` não passa por quadro nenhum — os dois extremos dele são
// checkpoints de microtarefa — e é limitado por baixo pelo próprio temporizador
// do app, então carga só o atrasa. Em 10 execuções varreu 541–549 ocioso e
// 540–583 a 10x, contra os 627–777 do irmão no mesmo regime: um terço da
// dispersão. 8 ms bastam, e a margem pequena é o que mantém viva a metade que
// pega transição alongada sem temporizador alongado.
const MARGEM_DESENHO_MS = 33;
const MARGEM_HIDDEN_MS = 8;

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
  // A versão mais antiga lia `getAnimations()` de fora e, depois de um
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
  // e compara com a duração que o PRÓPRIO CSS declara.
  //
  // Ela mede DUAS coisas, e a segunda não é luxo. Medir por quadro erra para
  // cima sob carga, e o erro chega a ser maior que o defeito: com o CSS em
  // `.60s` contra o temporizador de 540 ms — a regressão "alongaram a transição
  // e esqueceram o temporizador" — `desenhadoAteMs` deixou passar 1 de 5. O
  // instante em que o `hidden` volta não passa por quadro nenhum, e reprovou as
  // 5. `desenhadoAteMs` é quem fala da promessa da TELA (o painel esteve
  // desenhado); `hiddenAosMs` é a rede fina, e é ela que segura o caso em que a
  // carga afrouxa a primeira.
  await detail.evaluate(element => {
    const alvo = element.querySelector('.assistant-product-detail-panel');
    const registro = {
      abertura: [], fechamento: [], transicaoMs: null, desenhadoAteMs: null, hiddenAosMs: null
    };
    window.__detalheDoRapi = registro;
    let inicio = null;
    const olhar = () => {
      if (getComputedStyle(element).display === 'none') {
        registro.desenhadoAteMs = Math.round(performance.now() - inicio);
        return;
      }
      requestAnimationFrame(olhar);
    };
    // O RELÓGIO COMEÇA ONDE O DO APP COMEÇA: na remoção de `is-open`.
    //
    // A versão que o CI reprovou zerava o cronômetro no `transitionrun`, e ali
    // já é tarde: o temporizador de 540 ms do app foi armado no MESMO instante
    // em que a classe saiu, e o `transitionrun` só é despachado no recálculo de
    // estilo seguinte. A distância entre os dois não é do app — é do
    // escalonador — e o teste a cobrava do app. Medida com a CPU estrangulada
    // por CDP, ela chegou a 93 ms (leitura de 447 contra os 520 exigidos); no
    // CI foram os 22 ms que viraram o 518.
    //
    // Um MutationObserver é despachado no checkpoint de microtarefa logo após a
    // tarefa que removeu a classe — a microssegundos do `setTimeout` que conta
    // os 540, e sem esperar quadro nenhum, ao contrário do `transitionrun`. Com
    // a origem certa, carga só EMPURRA a medida para cima, que é o lado seguro.
    new MutationObserver(registros => {
      for (const r of registros) {
        // O mesmo observador dá o segundo instrumento de graça, e com os dois
        // extremos no mesmo tipo de checkpoint: `inicio` na remoção da classe,
        // este na volta do `hidden`. Nenhum dos dois espera quadro.
        if (r.attributeName === 'hidden') {
          if (inicio !== null && registro.hiddenAosMs === null && element.hasAttribute('hidden')) {
            registro.hiddenAosMs = Math.round(performance.now() - inicio);
          }
          continue;
        }
        const saiu = /(^| )is-open( |$)/.test(r.oldValue || '') && !element.classList.contains('is-open');
        if (!saiu || inicio !== null) continue;
        inicio = performance.now();
        requestAnimationFrame(olhar);
      }
    }).observe(element, {
      attributes: true, attributeFilter: ['class', 'hidden'], attributeOldValue: true
    });
    // O `transitionrun` continua sendo quem prova que a saída COMEÇOU e quem lê
    // a duração que o CSS declara. Ele só deixou de ser o marco zero.
    alvo.addEventListener('transitionrun', evento => {
      if (evento.target !== alvo || evento.propertyName !== 'transform') return;
      if (element.classList.contains('is-open')) { registro.abertura.push('transform'); return; }
      registro.fechamento.push('transform');
      registro.transicaoMs = Math.round(parseFloat(getComputedStyle(alvo).transitionDuration) * 1000);
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
  await expect.poll(async () => (await registro()).hiddenAosMs !== null,
    { timeout: 5_000 }).toBe(true);
  const medido = await registro();

  // O painel continuou DESENHADO enquanto a transição corria. Com o
  // temporizador do JS encurtado para 200 ms, a leitura desaba para 214–232 e
  // esta linha reprova nas 3 de 3. (O outro defeito da família — uma folha que
  // dê `display:none` ao estado sem `is-open` — não chega até aqui: ele mata
  // também a transição de ENTRADA, e quem reprova é o `abertura` lá em cima,
  // dizendo que a animação nunca começou. Conferido.)
  expect(
    medido.desenhadoAteMs,
    `o painel parou de ser desenhado ${medido.desenhadoAteMs} ms depois do começo da `
      + `saída, e o CSS declara ${medido.transicaoMs} ms de transição (margem de `
      + `${MARGEM_DESENHO_MS} ms) — o fim da animação foi cortado`
  ).toBeGreaterThanOrEqual(medido.transicaoMs - MARGEM_DESENHO_MS);

  // E os DOIS relógios do app continuam de acordo: o temporizador que devolve o
  // `hidden` não pode disparar antes de a transição do CSS acabar. É esta a
  // metade que pega "alongaram a transição e esqueceram o temporizador" — a de
  // cima não pega, e isso foi medido: com o CSS em `.60s` contra o temporizador
  // de 540 ms, `desenhadoAteMs` leu 546–565 e reprovou em 4 de 5, enquanto
  // `hiddenAosMs` leu 541–549 e reprovou nas 5.
  expect(
    medido.hiddenAosMs,
    `o \`hidden\` voltou ${medido.hiddenAosMs} ms depois do começo da saída, antes `
      + `dos ${medido.transicaoMs} ms que o CSS declara (margem de `
      + `${MARGEM_HIDDEN_MS} ms) — o temporizador do JS e a transição do CSS `
      + `saíram de sincronia`
  ).toBeGreaterThanOrEqual(medido.transicaoMs - MARGEM_HIDDEN_MS);

  // E o `hidden` volta: o diálogo sai da árvore de acessibilidade quando acaba.
  await expect(detail).toHaveAttribute('hidden', '');
});
