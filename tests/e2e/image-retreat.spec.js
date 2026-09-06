import { test, expect } from '@playwright/test';
import { mockApi, seedPickupSession, esperarAppPronto, RESTAURANT_URL } from './helpers.js';

// ============================================================================
//  SE A TRANSFORMAÇÃO DO STORAGE CAIR, A TELA FICA GRANDE — NUNCA BRANCA.
//
//  `srcset` não tem rede de segurança: quando o candidato escolhido falha, o
//  browser NÃO cai no `src`. A imagem simplesmente não pinta, e o `src` daqui
//  aponta para o original justamente para esse caso — só faltava alguém
//  executar o retorno.
//
//  Isso deixou de ser hipótese em 05/09/2026: o painel do plano passou a
//  mostrar "Storage Image Transformations: Unavailable in plan". Medido por
//  `curl`, o endpoint continuava respondendo 200 com a derivada — mas um
//  rótulo desses é aviso suficiente para não deixar a primeira tela do app
//  pendurada num recurso que pode sumir.
//
//  ESTE TESTE DERRUBA A TRANSFORMAÇÃO DE PROPÓSITO: `/render/image/` responde
//  403 e `/object/public/` responde um pixel. Nada vai para a rede — o custo
//  do experimento é zero, que é o motivo de ele poder rodar em toda execução.
//
//  O que ele afirma é o observável do CLIENTE ("a imagem pintou"), e não o
//  mecanismo ("o srcset saiu do elemento"): `naturalWidth > 0` só é verdade
//  depois de um byte de imagem ter chegado.
// ============================================================================

// PNG de 1x1 que DECODIFICA — o webp curto que estava aqui deixava
// `naturalWidth` em zero com `complete` true (ver helpers.js).
const PIXEL = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
);

async function bootarSemTransformacao(page) {
  const negados = [];
  await page.setViewportSize({ width: 390, height: 844 });
  await mockApi(page);
  // DEPOIS do mockApi: a última rota registrada vence.
  await page.route('**/*.supabase.co/**', route => {
    const url = route.request().url();
    if (url.includes('/render/image/public/')) {
      negados.push(url);
      // 403 é o que um recurso fora do plano responderia. O corpo vazio
      // importa: uma imagem sem bytes é o que dispara `error` no elemento.
      return route.fulfill({ status: 403, contentType: 'application/json', body: '{"error":"fora do plano"}' });
    }
    return route.fulfill({ status: 200, contentType: 'image/png', body: PIXEL });
  });
  await seedPickupSession(page);
  await page.goto(RESTAURANT_URL);
  await esperarAppPronto(page);
  await page.evaluate(() => window.RapidexActions.resolve('closeOperationScreen')?.());
  return negados;
}

/**
 * O estado das imagens que o cliente REALMENTE VÊ e que já tentaram carregar.
 *
 * Duas versões anteriores deste helper reprovaram o app CERTO, e as duas pelo
 * mesmo motivo — media quem não tinha tentado:
 *
 * 1. `clientWidth > 8` pega as slides do carrossel e a arte dos cupons, que
 *    são `loading="lazy"` e ficam FORA da viewport. Elas nunca carregam, nunca
 *    disparam `error` e nunca recuam — e uma imagem que jamais começou tem
 *    `complete: false` com o `srcset` intacto, que é exatamente a assinatura
 *    de "falhou e não recuou";
 * 2. casar por NOME DE ARQUIVO junta o herói parado com as duas slides clonadas
 *    do mesmo banner: uma tentou, duas não.
 *
 * Quem separa é `currentSrc`: ele só tem valor depois de o browser ESCOLHER um
 * candidato e começar a baixá-lo. Vazio = a imagem nem entrou na fila.
 *
 * E há um detalhe do `lazy` que vale saber antes de estranhar o resultado: uma
 * imagem fora da tela que RECUOU não baixa o original na hora — ela espera
 * entrar na viewport, como qualquer lazy. O recuo aconteceu; o download é que
 * fica para depois. Por isso a conta é só sobre o que está À VISTA.
 */
const estadoDoQueEstaAVista = (page) => page.evaluate(() =>
  [...document.querySelectorAll('img')]
    .filter(img => (img.getAttribute('src') || '').includes('.supabase.co'))
    .filter(img => img.currentSrc)
    .filter(img => {
      const r = img.getBoundingClientRect();
      return r.width > 8 && r.height > 8 && r.top < window.innerHeight && r.bottom > 0;
    })
    .map(img => ({
      nome: (img.getAttribute('src') || '').split('/').pop(),
      emVoo: !img.complete,
      pintou: img.complete && img.naturalWidth > 0,
      aindaTemSrcset: img.hasAttribute('srcset')
    }))
);

/**
 * Espera haver AMOSTRA ASSENTADA — e não a ausência de imagens em voo.
 *
 * A primeira versão desta espera exigia zero `complete: false`, e ela nunca
 * fecha: o carrossel do herói troca de slide a cada 5 s e as slides são
 * `loading="lazy"`, então sempre há uma entrando na viewport e começando a
 * baixar. É a MESMA armadilha que `image-framing.spec.js` já documenta ("não
 * peça à página um estado de repouso que a afirmação nunca precisou").
 *
 * O que a afirmação precisa é de amostra: se o recuo estiver quebrado, ele está
 * quebrado em TODAS. Imagem em voo não é prova nem contraprova — fica de fora
 * da conta, e o piso de amostra impede que "todas em voo" passe por vazio.
 */
const AMOSTRA_MINIMA = 2;

async function esperarAmostraAssentada(page) {
  await expect.poll(
    async () => (await estadoDoQueEstaAVista(page)).filter(img => !img.emVoo).length,
    { timeout: 15000, message: 'nenhuma imagem à vista terminou de carregar' }
  ).toBeGreaterThanOrEqual(AMOSTRA_MINIMA);
}

/** Só as que ASSENTARAM: em voo não é prova nem contraprova. */
const assentadas = (imagens) => imagens.filter(img => !img.emVoo);

test('transformação fora do ar: o herói, o logo e os destaques ainda pintam', async ({ page }) => {
  const negados = await bootarSemTransformacao(page);
  await esperarAmostraAssentada(page);

  // SONDA CONTRA VACUIDADE, em duas pontas. Sem a primeira, um app que não
  // pedisse derivada nenhuma passaria por não ter o que falhar; sem a segunda,
  // um roteiro que não desenhasse imagem passaria por não ter o que medir.
  expect(negados.length, 'nenhuma derivada foi pedida — o teste não derrubou nada').toBeGreaterThan(3);
  const imagens = assentadas(await estadoDoQueEstaAVista(page));
  expect(imagens.length, 'nenhuma imagem do Storage à vista e assentada').toBeGreaterThanOrEqual(AMOSTRA_MINIMA);

  const brancas = imagens.filter(img => !img.pintou);
  expect(
    brancas,
    `imagem(ns) em BRANCO com a transformação fora do ar:\n  ${brancas.map(b => b.nome).join('\n  ')}`
  ).toEqual([]);

  // E o recuo é REAL: quem falhou largou o srcset e voltou para o original.
  expect(imagens.every(img => !img.aindaTemSrcset), 'alguma imagem ficou com o srcset que falhou').toBe(true);
});

test('com a transformação de pé, ninguém recua', async ({ page }) => {
  // O outro lado da mesma afirmação: o recuo é para a FALHA, não um caminho
  // que roda sempre. Se ele disparasse no caso bom, o app estaria servindo o
  // original para todo mundo — que é exatamente a conta que estourou o plano.
  const pedidas = [];
  await page.setViewportSize({ width: 390, height: 844 });
  await mockApi(page);
  await page.route('**/*.supabase.co/**', route => {
    if (route.request().url().includes('/render/image/public/')) pedidas.push(route.request().url());
    return route.fulfill({ status: 200, contentType: 'image/png', body: PIXEL });
  });
  await seedPickupSession(page);
  await page.goto(RESTAURANT_URL);
  await esperarAppPronto(page);
  await page.evaluate(() => window.RapidexActions.resolve('closeOperationScreen')?.());
  await esperarAmostraAssentada(page);

  const imagens = assentadas(await estadoDoQueEstaAVista(page));
  expect(imagens.length, 'nenhuma imagem do Storage à vista e assentada').toBeGreaterThanOrEqual(AMOSTRA_MINIMA);
  expect(pedidas.length, 'nenhuma derivada foi pedida').toBeGreaterThan(3);
  const semSrcset = imagens.filter(img => !img.aindaTemSrcset);
  expect(
    semSrcset,
    `recuou sem precisar:\n  ${semSrcset.map(s => s.nome).join('\n  ')}`
  ).toEqual([]);
});

// ────────────────────────────────────────────────────────────────────────────
//  O CARDAPIO — o buraco que os dois testes acima nao alcancavam.
//
//  Eles bootam na HOME e medem herói, logo e destaques. As FOTOS DE PRATO
//  ficam na aba do cardápio, e ali o recuo estava errado de duas maneiras ao
//  mesmo tempo:
//
//  1. o ouvinte de `error` cobria OITO imagens. Quem se ligava a elas era
//     `waitForMenuCriticalMedia()`, com `menuImagesNearViewport().slice(0, 8)`,
//     e so no instante do boot na aba. Toda foto que entrasse depois — rolando
//     a lista, trocando de categoria — nao tinha ouvinte NENHUM;
//  2. o recuo era uma COPIA que nao recarregava: `img.src = originalSrc` sem
//     limpar o `src` antes deixa o elemento em `complete: true` com
//     `naturalWidth: 0`, sem `load` e sem `error` (§23.2). O segundo `error`,
//     o que chamaria o placeholder, nunca vinha.
//
//  Medido com o Storage de producao em 402: 140 imagens no DOM, 54 QUEBRADAS,
//  5 placeholders. O cliente via o icone de imagem quebrada do navegador com o
//  `alt` cru ao lado, em cada prato.
//
//  Os LOGOS nunca tiveram isso porque chamam `RapidexImageCdn.retreat()`. Era a
//  §3.1: duas implementacoes da mesma coisa, e a errada ganhando onde a certa
//  nao passa.
//
//  QUAL TESTE GUARDA QUAL METADE — medido, e nao e o que se supoe:
//
//    a COBERTURA (toda foto tem ouvinte) ....... os dois testes daqui de baixo
//    o `removeAttribute('src')` do recuo ....... o teste do HEROI, la em cima
//
//  Tirando aquela linha de `image-cdn.js`, quem fica vermelho e
//  "transformacao fora do ar: o heroi, o logo e os destaques ainda pintam"; os
//  dois do cardapio passam. Ou seja: as fotos de prato voltam a pintar mesmo
//  sem ela, e as do heroi nao. Nao presuma que estes dois cobrem aquele
//  mecanismo — o arquivo cobre, por outro teste.
// ────────────────────────────────────────────────────────────────────────────

/** Abre a aba do cardapio e rola, para o lazy soltar fotos alem das do boot. */
async function abrirCardapioERolar(page) {
  await page.evaluate(() => window.mobNavMenu?.());
  await expect.poll(
    () => page.locator('#menuContainer img.product-image, #menuContainer .product-image--placeholder').count(),
    { timeout: 15000, message: 'o cardápio não desenhou foto nenhuma' }
  ).toBeGreaterThan(4);
  // ROLAR É PARTE DO TESTE, não cenário: o defeito era justamente a foto que
  // entra DEPOIS das oito do boot, e sem rolar ela nunca aparece.
  await page.evaluate(async () => {
    for (let y = 0; y < 2600; y += 320) {
      window.scrollTo({ top: y, behavior: 'instant' });
      await new Promise(r => setTimeout(r, 90));
    }
  });
}

test('cardápio com a transformação fora do ar: toda foto de prato ainda pinta', async ({ page }) => {
  const negados = await bootarSemTransformacao(page);
  await abrirCardapioERolar(page);
  await esperarAmostraAssentada(page);

  expect(negados.length, 'nenhuma derivada foi pedida — o teste não derrubou nada').toBeGreaterThan(3);
  const imagens = assentadas(await estadoDoQueEstaAVista(page));
  expect(imagens.length, 'nenhuma imagem do Storage à vista e assentada').toBeGreaterThanOrEqual(AMOSTRA_MINIMA);

  const brancas = imagens.filter(img => !img.pintou);
  expect(
    brancas,
    `foto(s) de prato em BRANCO com a transformação fora do ar:\n  ${brancas.map(b => b.nome).join('\n  ')}`
  ).toEqual([]);
  expect(imagens.every(img => !img.aindaTemSrcset), 'alguma foto ficou com o srcset que falhou').toBe(true);

  // E NENHUM PLACEHOLDER: o original responde, então toda foto tem de PINTAR.
  //
  // Esta linha não é zelo — ela guarda um defeito que a correção do recuo quase
  // introduziu. `error` é delegado em CAPTURA (`utils/actions.js:33`), então a
  // ação do template corre ANTES do ouvinte direto de
  // `waitForProductImageReady`. Nas ≤8 fotos do boot os dois disparavam no
  // mesmo `error`: a ação recuava e marcava `data-cdn-recuou`, e o ouvinte
  // direto chamava `retreat()` em seguida, recebia `false` — porque a marca já
  // estava lá — e trocava a foto pelo placeholder SEM dar chance ao original.
  //
  // O teste acima não pegava isso: uma foto substituída deixa de ser um `<img>`
  // e some da varredura, então as que sobravam pintavam e o piso de amostra era
  // atingido do mesmo jeito. Passava pelo motivo errado.
  const placeholders = await page.locator('#menuContainer .product-image--placeholder').count();
  expect(placeholders, 'foto virou iniciais mesmo com o ORIGINAL de pé').toBe(0);
});

test('cardápio com o Storage INTEIRO fora: iniciais no lugar, nunca ícone quebrado', async ({ page }) => {
  // O SEGUNDO NÍVEL do recuo, que é o defeito de verdade. Aqui nem a derivada
  // nem o original respondem — é o estado exato em que o Storage esteve em
  // 05/09/2026 (402, `exceed_cached_egress_quota`), e o único desfecho aceitável
  // é o placeholder de iniciais. Um `<img>` quebrado pinta o ícone do navegador
  // com o `alt` cru ao lado, em cada prato do cardápio.
  await page.setViewportSize({ width: 390, height: 844 });
  await mockApi(page);
  await page.route('**/*.supabase.co/**', route => route.fulfill({
    status: 402,
    contentType: 'application/json',
    body: JSON.stringify({ message: 'exceed_cached_egress_quota' })
  }));
  await seedPickupSession(page);
  await page.goto(RESTAURANT_URL);
  await esperarAppPronto(page);
  await page.evaluate(() => window.RapidexActions.resolve('closeOperationScreen')?.());
  await abrirCardapioERolar(page);

  // A espera é pelo EFEITO do fim do caminho (o placeholder existir), não por
  // um prazo: são dois `error` em sequência por imagem, e o segundo só vem
  // depois de o original ter ido à rede e voltado.
  await expect.poll(
    () => page.locator('#menuContainer .product-image--placeholder').count(),
    { timeout: 20000, message: 'nenhum placeholder de iniciais entrou no lugar das fotos' }
  ).toBeGreaterThanOrEqual(4);

  const estado = await page.evaluate(() => {
    const quebradas = [...document.querySelectorAll('#menuContainer img.product-image')]
      .filter(img => {
        const r = img.getBoundingClientRect();
        const aVista = r.width > 8 && r.height > 8 && r.top < window.innerHeight && r.bottom > 0;
        return aVista && img.complete && img.naturalWidth === 0;
      })
      .map(img => (img.getAttribute('src') || img.alt || '?').split('/').pop());
    const placeholders = [...document.querySelectorAll('#menuContainer .product-image--placeholder')];
    return {
      quebradas,
      placeholders: placeholders.length,
      // O placeholder tem de TER as iniciais: um quadrado vazio no lugar da
      // foto é outra forma de não dizer nada.
      semIniciais: placeholders.filter(p => !(p.textContent || '').trim()).length
    };
  });

  expect(
    estado.quebradas,
    `foto(s) de prato à vista com o ícone de imagem quebrada:\n  ${estado.quebradas.join('\n  ')}`
  ).toEqual([]);
  expect(estado.semIniciais, 'placeholder sem as iniciais do prato').toBe(0);
});
