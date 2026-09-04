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
