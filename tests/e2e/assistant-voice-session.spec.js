import { test, expect } from '@playwright/test';
import { mockApi, seedPickupSession, RESTAURANT_URL, MENU, BRANCH_MATRIZ } from './helpers.js';

// O modo voz — o transporte.
//
// A OpenAI é trocada por um SEGUNDO RTCPeerConnection dentro da própria página.
// Não é um dublê de mentira: o SDP é real, a negociação é real, o canal
// `oai-events` abre de verdade e os eventos trafegam por ele. É o que permite
// testar a fila de resposta ativa e a deduplicação por call_id — as duas coisas
// que o contrato marca como "já quebrou em teste real" e que um mock de fetch
// nunca alcançaria.
//
// O que estes testes protegem é a CONTA: uma sessão que não fecha é uma sessão
// que continua sendo faturada por minuto.

const OPENAI = 'https://api.openai.com/v1/realtime/calls';
const CALL_ID = 'rtc_e2e_abc123';
const RESTAURANTE = '11111111-1111-4111-8111-111111111111';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization,content-type',
  'Access-Control-Allow-Methods': 'POST,OPTIONS',
  // Sem isto o navegador esconde o Location do JavaScript — é exatamente a
  // situação que o contrato prevê, e que o teste do call_id ausente exercita.
  'Access-Control-Expose-Headers': 'Location'
};

const LIMITES = { duracao_maxima_s: 300, inatividade_s: 45, aviso_antes_s: 10 };

const emissaoOk = (limites = LIMITES) => ({
  sessao_id: '8e1b0000-0000-4000-8000-000000000001',
  credencial: {
    value: 'ek_credencial_efemera_de_teste',
    expires_at: Math.floor(Date.now() / 1000) + 585,
    session: { type: 'realtime', model: 'gpt-realtime-mini' }
  },
  saudacao: 'Olá, E2E! Como posso te ajudar hoje?',
  limites
});

const json = (body, status = 200) => ({
  status, contentType: 'application/json', body: JSON.stringify(body)
});

/**
 * Sobe o app com um cliente logado, o microfone falso do Chromium e todas as
 * rotas /voice sob controle do teste. Devolve os registros vivos de cada rota.
 */
async function montar(page, context, {
  emissao = emissaoOk(),
  statusEmissao = 200,
  busca = { produtos: [], resumo: 'Nenhum produto encontrado.' },
  comLocation = true,
  conectado = { registrado: true },
  // Restaurante sem NENHUMA filial ativa — o único jeito de o app chegar à voz
  // sem loja escolhida, e o caso que o backend descreve em §3.1.
  semFilial = false
} = {}) {
  const chamadas = { sessao: [], connected: [], ended: [], busca: [], openai: [] };

  await context.grantPermissions(['microphone']);
  await page.setViewportSize({ width: 390, height: 844 });
  await mockApi(page);

  // Depois do mockApi de propósito: a rota registrada por último é a que vale.
  if (semFilial) {
    await page.route('**/restaurants/*/menu*', route => route.fulfill(json({
      ...MENU, branches: [], products: [], categories: [], settings: null
    })));
  }

  await page.addInitScript(() =>
    localStorage.setItem('rapidex.customer.token', 'e2e.voice.token'));

  // Espia as faixas que o app recebe do microfone, para o teste poder afirmar
  // que elas foram PARADAS no fim — e não só silenciadas. O segundo pedido de
  // getUserMedia é o do par que faz de OpenAI, e não interessa aqui.
  await page.addInitScript(() => {
    window.__faixas = null;
    const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async (...argumentos) => {
      const stream = await original(...argumentos);
      if (!window.__faixas) window.__faixas = stream.getTracks();
      return stream;
    };
  });
  await page.route('**/customers/me**', route => route.fulfill(
    json({ id: 'c1', name: 'E2E', email: 'e@e.com', phone: '85999999999' })));

  await page.route('**/voice/session', async route => {
    chamadas.sessao.push({
      autorizacao: route.request().headers().authorization || null,
      corpo: JSON.parse(route.request().postData() || '{}')
    });
    return route.fulfill(json(emissao, statusEmissao));
  });

  await page.route('**/voice/session/*/connected', async route => {
    chamadas.connected.push(JSON.parse(route.request().postData() || '{}'));
    return route.fulfill(json(conectado));
  });

  await page.route('**/voice/session/*/ended', async route => {
    chamadas.ended.push(JSON.parse(route.request().postData() || '{}'));
    return route.fulfill(json({ encerrado: true }));
  });

  await page.route('**/voice/search', async route => {
    chamadas.busca.push(JSON.parse(route.request().postData() || '{}'));
    return route.fulfill(json(busca));
  });

  // A OpenAI. O par que responde vive DENTRO da página: só ele consegue produzir
  // uma resposta SDP que case com a oferta.
  await page.route(OPENAI, async route => {
    if (route.request().method() === 'OPTIONS') {
      return route.fulfill({ status: 204, headers: CORS, body: '' });
    }
    const oferta = route.request().postData();
    chamadas.openai.push({
      autorizacao: route.request().headers().authorization || null,
      tipo: route.request().headers()['content-type'] || null,
      oferta
    });
    const resposta = await page.evaluate(async sdp => {
      const par = new RTCPeerConnection();
      window.__par = par;
      window.__recebidos = [];
      par.ondatachannel = evento => {
        window.__canal = evento.channel;
        evento.channel.addEventListener('message', mensagem => {
          window.__recebidos.push(JSON.parse(mensagem.data));
        });
      };
      // Devolve áudio, como a OpenAI faz — é o que dispara o ontrack do app.
      const midia = await navigator.mediaDevices.getUserMedia({ audio: true });
      await par.setRemoteDescription({ type: 'offer', sdp });
      midia.getTracks().forEach(faixa => par.addTrack(faixa, midia));
      await par.setLocalDescription(await par.createAnswer());
      // A oferta do app sai SEM candidatos — é assim que o contrato manda, e
      // funciona porque quem tem endereço alcançável é o outro lado. Então a
      // resposta daqui precisa levar os candidatos dela, e para isso é preciso
      // esperar a coleta terminar antes de devolver o SDP.
      await new Promise(resolve => {
        if (par.iceGatheringState === 'complete') return resolve();
        par.addEventListener('icegatheringstatechange', () => {
          if (par.iceGatheringState === 'complete') resolve();
        });
        setTimeout(resolve, 4000);
      });
      return par.localDescription.sdp;
    }, oferta);

    return route.fulfill({
      status: 201,
      headers: comLocation
        ? { ...CORS, Location: `/v1/realtime/calls/${CALL_ID}` }
        : CORS,
      contentType: 'application/sdp',
      body: resposta
    });
  });

  await seedPickupSession(page);
  await page.goto(RESTAURANT_URL);
  await page.waitForFunction(() => !document.body.classList.contains('app-booting'));
  // O id do restaurante sai da loja; o fixture não traz um UUID no lugar que o
  // transporte lê, e ele recusa qualquer coisa que não seja UUID.
  await page.evaluate(id => {
    const loja = window.PedeAquiRestaurantStore.get();
    window.PedeAquiRestaurantStore.set({
      restaurant: { ...(loja.restaurant || {}), id }
    });
  }, RESTAURANTE);
  await page.evaluate(() => window.RapidexActions.resolve('mobNavAssistant')());
  await expect(page.locator('#assistantStarter')).toHaveClass(/is-ready/);

  return chamadas;
}

/**
 * Abre a voz, espera a conversa estar de pé e FECHA o ciclo da saudação.
 *
 * O último passo não é cerimônia: a saudação de abertura é uma resposta em
 * curso, e a API de verdade a fecha com response.created / response.done. Sem
 * isso a sessão fica achando que ainda há resposta ativa — e todo pedido
 * seguinte espera na fila, corretamente, para sempre.
 */
async function conversar(page) {
  await page.locator('#mobViewAssistant .assistant-ai-send').click();
  await expect(page.locator('#assistantVoice')).toHaveClass(/is-open/);
  await expect(page.locator('#assistantVoice')).toHaveClass(/is-listening|is-speaking/, { timeout: 15000 });

  await expect.poll(async () => (await recebidos(page)).map(m => m.type), { timeout: 10000 })
    .toContain('response.create');
  await emitir(page, { type: 'response.created' });
  await emitir(page, { type: 'response.done' });
  await expect(page.locator('#assistantVoice')).toHaveClass(/is-listening/);
}

/** O par-OpenAI manda um evento pelo canal, como a API faria. */
const emitir = (page, evento) =>
  page.evaluate(e => window.__canal.send(JSON.stringify(e)), evento);

const recebidos = page => page.evaluate(() => window.__recebidos);

test.use({
  launchOptions: {
    args: [
      // Microfone falso, sem diálogo.
      '--use-fake-device-for-media-stream',
      '--use-fake-ui-for-media-stream',
      // Os dois pares vivem na mesma página: sem isto o Chrome troca o IP local
      // por um nome .local que ninguém resolve em headless, e o ICE nunca fecha.
      '--disable-features=WebRtcHideLocalIpsWithMdns',
      '--allow-loopback-in-peer-connection'
    ]
  }
});

test('o caminho feliz: emite, conecta, registra o call_id e o assistente fala primeiro', async ({ page, context }) => {
  const chamadas = await montar(page, context);
  await conversar(page);

  // 1. A emissão levou o token do CLIENTE, o restaurante certo e a FILIAL que
  //    o cliente escolheu — a mesma que o carrinho e o pedido usam. Sem ela a
  //    rota responde 422, e com uma filial padrão o modelo falaria o preço da
  //    loja errada em áudio.
  expect(chamadas.sessao).toHaveLength(1);
  expect(chamadas.sessao[0].autorizacao).toBe('Bearer e2e.voice.token');
  expect(chamadas.sessao[0].corpo).toEqual({
    restaurant_id: RESTAURANTE,
    branch_id: BRANCH_MATRIZ
  });

  // 2. A OpenAI recebeu o SEGREDO EFÊMERO, e não o token do cliente. Os dois
  //    segredos têm destinos diferentes, e trocá-los vaza a sessão do cliente.
  expect(chamadas.openai).toHaveLength(1);
  expect(chamadas.openai[0].autorizacao).toBe('Bearer ek_credencial_efemera_de_teste');
  expect(chamadas.openai[0].autorizacao).not.toContain('e2e.voice.token');
  expect(chamadas.openai[0].tipo).toContain('application/sdp');
  expect(chamadas.openai[0].oferta, 'o corpo tem de ser o SDP cru').toMatch(/^v=0/);

  // 3. O call_id saiu do último segmento do Location.
  await expect.poll(() => chamadas.connected.length).toBe(1);
  expect(chamadas.connected[0]).toEqual({ call_id: CALL_ID });

  // 4. O assistente fala primeiro usando, sem remontar, a frase do backend.
  const abertura = await recebidos(page);
  const saudacao = abertura.find(m => m.type === 'conversation.item.create'
    && m.item?.role === 'system');
  expect(saudacao?.item).toEqual({
    type: 'message',
    role: 'system',
    content: [{
      type: 'input_text',
      text: 'Cumprimente o cliente falando exatamente isto, e nada mais: Olá, E2E! Como posso te ajudar hoje?'
    }]
  });
  expect(abertura.map(m => m.type)).toContain('response.create');
});

test('sem filial escolhida a voz para antes de emitir, e diz por quê', async ({ page, context }) => {
  // O cardápio é da FILIAL. Sem loja escolhida não há preço a falar, e o
  // caminho errado aqui não é o erro — é escolher uma loja por conta própria e
  // o modelo dizer, em áudio e com preço, o nome de um prato que aquela loja
  // não vende.
  const chamadas = await montar(page, context, { semFilial: true });

  await page.evaluate(() => window.RapidexAssistantVoice.request());

  await expect(page.locator('#assistantVoiceAlert')).toBeVisible();
  await expect(page.locator('#assistantVoiceAlertText')).toContainText(/escolha a unidade/i);

  // E a parte que vale dinheiro: a credencial NÃO foi emitida. Uma emissão é
  // faturada e conta na cota de cinco conversas por cliente em 24h.
  await page.waitForTimeout(400);
  expect(chamadas.sessao, 'emitiu credencial sem saber de qual loja falar').toEqual([]);
});

test('sem o cabeçalho Location a conversa continua, e nada de call_id inventado', async ({ page, context }) => {
  // Caso previsto no contrato: Location é cabeçalho de outra origem e o
  // navegador só o entrega se a OpenAI o expuser. Perder isso custa o
  // desligamento remoto, não a conversa.
  const chamadas = await montar(page, context, { comLocation: false });
  await conversar(page);

  await page.waitForTimeout(500);
  expect(chamadas.connected, 'mandou /connected sem ter um call_id').toEqual([]);
  await expect(page.locator('#assistantVoiceAlert')).toBeHidden();
});

test('a mesma tool call chega por dois eventos e a busca acontece uma vez só', async ({ page, context }) => {
  const chamadas = await montar(page, context, {
    busca: {
      produtos: [
        { id: 'p1', name: 'Pudim', price: 12.5, image_url: null },
        { id: 'p2', name: 'Brownie', price: 15, image_url: null }
      ],
      resumo: 'Produtos encontrados: Pudim - R$ 12,50; Brownie - R$ 15,00'
    }
  });
  await conversar(page);
  await page.evaluate(() => { window.__recebidos.length = 0; });

  const argumentos = JSON.stringify({ consulta: 'sobremesa de chocolate', preco_maximo: 50 });
  // Os dois eventos da mesma chamada, a menos de 1 ms de distância — como chegam
  // de verdade. A dedup é síncrona porque entre um await e outro o segundo já
  // chegou.
  await page.evaluate(args => {
    window.__canal.send(JSON.stringify({
      type: 'response.function_call_arguments.done',
      call_id: 'call_1', name: 'buscar_no_cardapio', arguments: args
    }));
    window.__canal.send(JSON.stringify({
      type: 'response.output_item.done',
      item: { type: 'function_call', call_id: 'call_1', name: 'buscar_no_cardapio', arguments: args }
    }));
  }, argumentos);

  await expect.poll(() => chamadas.busca.length, { timeout: 10000 }).toBe(1);
  // A busca fala da MESMA filial da sessão: o backend só procura no cardápio
  // daquela loja, e um "não encontrei" aqui é dela, não do restaurante.
  expect(chamadas.busca[0]).toEqual({
    restaurant_id: RESTAURANTE,
    branch_id: BRANCH_MATRIZ,
    consulta: 'sobremesa de chocolate',
    preco_maximo: 50
  });

  // ESPERAR O FIM DO CAMINHO, NÃO O COMEÇO DELE. O poll acima só prova que a
  // requisição ENTROU no route handler; a resposta ainda tem de voltar, ser
  // lida e virar mensagem no canal de dados. Perguntar pelos `recebidos` no
  // instante seguinte é perguntar se a carta chegou no momento em que ela foi
  // postada — passa sozinho e falha com a máquina ocupada (skill §4). O marco
  // do FIM é o `response.create`, que o app manda DEPOIS do
  // function_call_output.
  await expect.poll(async () => (await recebidos(page)).map(m => m.type), { timeout: 10000 })
    .toContain('response.create');

  // O modelo recebe o RESUMO, string, sem transformação — e recebe uma vez só.
  const saidas = (await recebidos(page)).filter(m => m.type === 'conversation.item.create');
  expect(saidas, 'a mesma chamada foi respondida duas vezes').toHaveLength(1);
  expect(saidas[0].item).toEqual({
    type: 'function_call_output',
    call_id: 'call_1',
    output: 'Produtos encontrados: Pudim - R$ 12,50; Brownie - R$ 15,00'
  });
  // E o response.create veio DEPOIS dele — é o que a espera acima já provou:
  // sem ele o modelo ficaria calado com o resultado na mão.
  const tipos = (await recebidos(page)).map(m => m.type);
  expect(tipos.indexOf('response.create'))
    .toBeGreaterThan(tipos.indexOf('conversation.item.create'));

  // Os cartões saem de `produtos`, com o preço do banco — nunca do que o modelo
  // falou.
  const cartoes = page.locator('#assistantVoiceRail .assistant-product-card');
  await expect(cartoes).toHaveCount(2);
  await expect(cartoes.first().locator('.assistant-result-price')).toHaveText('R$ 12,50');
  // E o resumo NUNCA aparece na tela.
  await expect(page.locator('#assistantVoice')).not.toContainText('Produtos encontrados:');
});

test('não se pede resposta com uma ativa: o pedido espera na fila', async ({ page, context }) => {
  const chamadas = await montar(page, context, {
    busca: { produtos: [], resumo: 'Nenhum produto encontrado.' }
  });
  await conversar(page);

  // Uma resposta em curso.
  await emitir(page, { type: 'response.created' });
  await page.evaluate(() => { window.__recebidos.length = 0; });

  await emitir(page, {
    type: 'response.function_call_arguments.done',
    call_id: 'call_fila', name: 'buscar_no_cardapio',
    arguments: JSON.stringify({ consulta: 'algo' })
  });
  await expect.poll(() => chamadas.busca.length, { timeout: 10000 }).toBe(1);

  // O function_call_output pode ir na hora; o response.create NÃO, porque a
  // resposta ainda está aberta. Pedir agora devolveria
  // conversation_already_has_active_response.
  //
  // A metade POSITIVA espera por condição — ela depende da resposta da busca
  // voltar, e 400 ms de relógio eram uma aposta. A metade NEGATIVA continua com
  // uma janela de acomodação curta, e isso é honesto: uma janela curta demais
  // num "não aconteceu" erra para o lado do verde, nunca do vermelho falso.
  await expect.poll(async () => (await recebidos(page)).map(m => m.type), { timeout: 10000 })
    .toContain('conversation.item.create');
  await page.waitForTimeout(200);
  const durante = (await recebidos(page)).map(m => m.type);
  expect(durante, 'pediu resposta com uma ativa').not.toContain('response.create');

  // Fechada a resposta, a fila escoa.
  await emitir(page, { type: 'response.done' });
  await expect.poll(async () => (await recebidos(page)).map(m => m.type))
    .toContain('response.create');
});

test('o erro de resposta ativa não derruba a sessão: o pedido volta para a fila', async ({ page, context }) => {
  await montar(page, context, { busca: { produtos: [], resumo: 'Nada.' } });
  await conversar(page);
  await page.evaluate(() => { window.__recebidos.length = 0; });

  // O app pede, e a API responde que já havia uma resposta ativa.
  await emitir(page, {
    type: 'response.function_call_arguments.done',
    call_id: 'call_erro', name: 'buscar_no_cardapio',
    arguments: JSON.stringify({ consulta: 'x' })
  });
  await expect.poll(async () => (await recebidos(page)).map(m => m.type))
    .toContain('response.create');
  await page.evaluate(() => { window.__recebidos.length = 0; });

  await emitir(page, {
    type: 'error',
    error: { code: 'conversation_already_has_active_response', message: 'já tem' }
  });
  await page.waitForTimeout(300);

  // A conversa continua de pé — este erro não é fatal.
  await expect(page.locator('#assistantVoice')).toHaveClass(/is-listening|is-speaking/);
  await expect(page.locator('#assistantVoiceAlert')).toBeHidden();

  // E o pedido perdido sai no próximo response.done.
  await emitir(page, { type: 'response.done' });
  await expect.poll(async () => (await recebidos(page)).map(m => m.type))
    .toContain('response.create');
});

test('busca que falha ainda responde ao modelo, em vez de deixá-lo esperando', async ({ page, context }) => {
  await montar(page, context);
  await page.unroute('**/voice/search');
  await page.route('**/voice/search', route => route.fulfill(json({ detail: 'boom' }, 500)));
  await conversar(page);
  await page.evaluate(() => { window.__recebidos.length = 0; });

  await emitir(page, {
    type: 'response.function_call_arguments.done',
    call_id: 'call_falha', name: 'buscar_no_cardapio',
    arguments: JSON.stringify({ consulta: 'qualquer coisa' })
  });

  await expect.poll(async () =>
    (await recebidos(page)).filter(m => m.type === 'conversation.item.create').length,
  { timeout: 10000 }).toBe(1);

  const saida = (await recebidos(page)).find(m => m.type === 'conversation.item.create');
  expect(saida.item.call_id).toBe('call_falha');
  expect(saida.item.output, 'o modelo ficou sem resposta e trava calado').toBeTruthy();
  expect((await recebidos(page)).map(m => m.type)).toContain('response.create');
});

test('o silêncio avisa por FALA antes de cortar, e falar cancela o corte', async ({ page, context }) => {
  // Limites curtos vindos do servidor — que é de onde eles vêm de verdade.
  // Curtos, mas com folga: aviso 3s depois da última fala, corte aos 8s. Um
  // orçamento apertado aqui vira teste instável quando a suíte roda em paralelo,
  // e um teste instável não protege nada.
  const chamadas = await montar(page, context, {
    emissao: emissaoOk({ duracao_maxima_s: 300, inatividade_s: 8, aviso_antes_s: 5 })
  });
  await conversar(page);
  await page.evaluate(() => { window.__recebidos.length = 0; });

  const avisou = async () => {
    const mensagens = await recebidos(page);
    const ordem = mensagens.some(m => m.type === 'conversation.item.create'
      && m.item?.role === 'system'
      && /inatividade/i.test(m.item?.content?.[0]?.text || ''));
    return ordem && mensagens.some(m => m.type === 'response.create');
  };

  // Falar zera o contador. Duas vezes seguidas, para provar que cada fala
  // adia o aviso em vez de só a primeira.
  for (let vez = 0; vez < 2; vez++) {
    await emitir(page, { type: 'input_audio_buffer.speech_started' });
    await page.waitForTimeout(1200);
    expect(await avisou(), `avisou mesmo com o cliente falando (volta ${vez + 1})`).toBe(false);
    await expect(page.locator('#assistantVoice')).toHaveClass(/is-open/);
  }

  // Agora o silêncio corre inteiro: primeiro a frase falada, depois o corte.
  await expect.poll(avisou, { timeout: 9000 }).toBe(true);
  await expect(page.locator('#assistantVoice')).not.toHaveClass(/is-open/, { timeout: 9000 });
  await expect.poll(() => chamadas.ended.length).toBe(1);
  expect(chamadas.ended[0].motivo).toBe('silencio por 8s');
});

test('o teto de duração vem do servidor e encerra sozinho', async ({ page, context }) => {
  const chamadas = await montar(page, context, {
    emissao: emissaoOk({ duracao_maxima_s: 2, inatividade_s: 45, aviso_antes_s: 10 })
  });

  // A VOZ SOBE, MAS O CICLO DA SAUDAÇÃO NÃO ENTRA AQUI — e o motivo é o próprio
  // assunto do teste. O teto começa a correr no instante em que o áudio abre, e
  // `conversar()` ainda precisa, DEPOIS desse instante, de uma ida-e-volta pelo
  // canal de dados para ver o `response.create` da saudação. Sob carga essa
  // ida-e-volta passou dos 2 s: a sessão encerrou no meio do preparo, o canal
  // fechou, e a mensagem que o helper esperava nunca chegou. O teto sob teste
  // matava o preparo do teste (suíte de 31/08/2026: `Received array: []`).
  //
  // Medido com o teto rebaixado a 50 ms, para a corrida acontecer sempre: o
  // braço com `conversar()` falha com esse mesmo texto, o braço abaixo passa.
  await page.locator('#mobViewAssistant .assistant-ai-send').click();
  await expect(page.locator('#assistantVoice')).toHaveClass(/is-open/);

  // E não se afirma nada sobre estado intermediário: quem encerra é o app,
  // sozinho, e o /ended chega no route handler sem depender de o teste ter
  // perguntado alguma coisa a tempo. Máquina lenta atrasa a chegada; não muda
  // o que chega.
  await expect.poll(() => chamadas.ended.length, { timeout: 20000 }).toBe(1);
  expect(chamadas.ended[0].motivo).toBe('teto de 2s atingido');
  await expect(page.locator('#assistantVoice')).not.toHaveClass(/is-open/);
});

test('a aba escondida encerra a conversa', async ({ page, context }) => {
  const chamadas = await montar(page, context);
  await conversar(page);

  // O evento é o mesmo que o navegador dispara ao trocar de aba; o app decide
  // pelo document.hidden, então é ele que o teste força.
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    document.dispatchEvent(new Event('visibilitychange'));
  });

  await expect(page.locator('#assistantVoice')).not.toHaveClass(/is-open/, { timeout: 6000 });
  await expect.poll(() => chamadas.ended.length).toBe(1);
  expect(chamadas.ended[0].motivo).toBe('a aba saiu de vista');
});

test('encerrar para as faixas do microfone — o indicador não pode ficar aceso', async ({ page, context }) => {
  const chamadas = await montar(page, context);
  await conversar(page);

  // Espia as faixas vivas antes e depois. É a armadilha nº 3 do contrato: sem o
  // stop(), o indicador de gravação do navegador continua aceso e o microfone
  // continua captando depois de a conversa acabar.
  const antes = await page.evaluate(() => window.__faixas?.map(f => f.readyState));
  expect(antes, 'o teste não capturou as faixas do microfone').toBeTruthy();
  expect(antes.every(estado => estado === 'live')).toBe(true);

  await page.locator('#assistantVoiceEnd').click();

  await expect.poll(async () =>
    page.evaluate(() => window.__faixas.every(f => f.readyState === 'ended')),
  { timeout: 6000 }).toBe(true);

  await expect.poll(() => chamadas.ended.length).toBe(1);
  expect(chamadas.ended[0].motivo).toBe('o cliente clicou em Parar');
});

test('o mudo desliga a faixa, sem derrubar a sessão', async ({ page, context }) => {
  await montar(page, context);
  await conversar(page);

  await page.locator('#assistantVoiceMute').click();
  await expect.poll(() =>
    page.evaluate(() => window.__faixas.every(f => f.enabled === false))).toBe(true);
  await expect(page.locator('#assistantVoice')).toHaveClass(/is-open/);

  await page.locator('#assistantVoiceMute').click();
  await expect.poll(() =>
    page.evaluate(() => window.__faixas.every(f => f.enabled === true))).toBe(true);
});

test('sai um /ended só, mesmo com o cliente insistindo no botão', async ({ page, context }) => {
  const chamadas = await montar(page, context);
  await conversar(page);

  await page.locator('#assistantVoiceEnd').click();
  await expect.poll(() => chamadas.ended.length).toBe(1);

  // A tela já fechou; reabrir e fechar de novo é uma sessão NOVA, não um segundo
  // aviso da mesma. O que este teste barra é o /ended duplicado da mesma sessão.
  await page.evaluate(() => {
    window.RapidexAssistantVoice.end('de novo');
    window.RapidexAssistantVoice.end('e de novo');
  });
  await page.waitForTimeout(400);
  expect(chamadas.ended, 'saiu mais de um /ended para a mesma sessão').toHaveLength(1);
});

/** O `usage` como a OpenAI o manda dentro do response.done. */
const respostaComUso = (entrada, emitidos) => ({
  type: 'response.done',
  response: {
    usage: {
      input_token_details: entrada,
      output_token_details: emitidos
    }
  }
});

test('o uso de tokens é somado na sessão e sai UMA vez, no /ended', async ({ page, context }) => {
  const chamadas = await montar(page, context);
  // O acumulado também é logado no encerramento, para conferir na hora sem
  // precisar abrir a aba de rede.
  const logs = [];
  page.on('console', m => { if (m.type() === 'log') logs.push(m.text()); });
  await conversar(page);

  const voz = page.locator('#assistantVoice');
  // Duas respostas com uso, para provar que ele ACUMULA em vez de sobrescrever.
  //
  // Cada `emitir` é uma mensagem no canal de dados REAL: mandar não é ter
  // chegado. O recibo de que o app PROCESSOU cada uma é o estado da tela, que
  // o mesmo `case` do handler troca — `response.created` põe em speaking,
  // `response.done` (o que carrega o `usage`) devolve para listening. Os
  // 300 ms de relógio que estavam aqui não eram suficientes sob carga: o
  // /ended saía sem os contadores.
  await emitir(page, { type: 'response.created' });
  await expect(voz).toHaveClass(/is-speaking/);
  await emitir(page, respostaComUso(
    { audio_tokens: 120, text_tokens: 30, cached_tokens: 64 },
    { audio_tokens: 200, text_tokens: 15 }
  ));
  await expect(voz).toHaveClass(/is-listening/);
  await emitir(page, { type: 'response.created' });
  await expect(voz).toHaveClass(/is-speaking/);
  await emitir(page, respostaComUso(
    { audio_tokens: 80, text_tokens: 10, cached_tokens: 32 },
    { audio_tokens: 50, text_tokens: 5 }
  ));
  await expect(voz).toHaveClass(/is-listening/);

  await page.locator('#assistantVoiceEnd').click();
  await expect.poll(() => chamadas.ended.length).toBe(1);

  const corpo = chamadas.ended[0];
  expect(corpo.motivo).toBe('o cliente clicou em Parar');
  expect(corpo.input_audio_tokens).toBe(200);
  expect(corpo.input_text_tokens).toBe(40);
  expect(corpo.output_audio_tokens).toBe(250);
  expect(corpo.output_text_tokens).toBe(20);
  // Subconjunto da entrada: soma com os próprios pares, e não entra nem sai do
  // input_audio_tokens.
  expect(corpo.cached_tokens).toBe(96);
  expect(corpo.input_audio_tokens, 'o cached foi descontado da entrada').toBe(200);

  // Duração medida da abertura do áudio até aqui — inteiro, e plausível.
  expect(Number.isInteger(corpo.duration_seconds)).toBe(true);
  expect(corpo.duration_seconds).toBeGreaterThanOrEqual(0);
  expect(corpo.duration_seconds).toBeLessThan(120);

  // Todos os inteiros, nada de fracionário chegando na cobrança.
  for (const campo of ['input_audio_tokens', 'input_text_tokens', 'output_audio_tokens',
    'output_text_tokens', 'cached_tokens']) {
    expect(Number.isInteger(corpo[campo]), `${campo} não é inteiro`).toBe(true);
  }

  const acumulado = logs.find(linha => /\[Voz\] Uso acumulado/.test(linha));
  expect(acumulado, `nada foi logado no encerramento:\n${logs.join('\n')}`).toBeTruthy();
});

test('campo que ninguém reportou fica AUSENTE, e não vira zero', async ({ page, context }) => {
  const chamadas = await montar(page, context);
  await conversar(page);

  // Só áudio de entrada. Texto e cache nunca foram mencionados por ninguém.
  // O estado da tela é o recibo de que o `response.done` foi processado — ver
  // a nota do teste do uso acumulado.
  const voz = page.locator('#assistantVoice');
  await emitir(page, { type: 'response.created' });
  await expect(voz).toHaveClass(/is-speaking/);
  await emitir(page, respostaComUso({ audio_tokens: 45 }, {}));
  await expect(voz).toHaveClass(/is-listening/);

  await page.locator('#assistantVoiceEnd').click();
  await expect.poll(() => chamadas.ended.length).toBe(1);

  const corpo = chamadas.ended[0];
  expect(corpo.input_audio_tokens).toBe(45);
  // Ausente significa "não reportado", que é diferente de "foi zero". Mandar 0
  // aqui seria uma afirmação — e uma afirmação errada.
  expect(Object.keys(corpo)).not.toContain('input_text_tokens');
  expect(Object.keys(corpo)).not.toContain('output_audio_tokens');
  expect(Object.keys(corpo)).not.toContain('output_text_tokens');
  expect(Object.keys(corpo)).not.toContain('cached_tokens');
});

test('sessão sem nenhum uso reportado manda só motivo e duração', async ({ page, context }) => {
  const chamadas = await montar(page, context);
  await conversar(page);
  await page.locator('#assistantVoiceEnd').click();
  await expect.poll(() => chamadas.ended.length).toBe(1);

  // A saudação de abertura fecha sem `usage` no dublê — então não há o que
  // reportar, e o corpo não inventa contadores.
  expect(Object.keys(chamadas.ended[0]).sort()).toEqual(['duration_seconds', 'motivo']);
});

test('a medição não muda o rumo da conversa', async ({ page, context }) => {
  const chamadas = await montar(page, context, {
    busca: { produtos: [], resumo: 'Nenhum produto encontrado.' }
  });
  await conversar(page);
  await page.evaluate(() => { window.__recebidos.length = 0; });

  // Um response.done com usage malformado não pode engolir o escoamento da fila:
  // é o mesmo evento que fecha a resposta ativa.
  await emitir(page, { type: 'response.created' });
  await emitir(page, {
    type: 'response.function_call_arguments.done',
    call_id: 'call_medicao', name: 'buscar_no_cardapio',
    arguments: JSON.stringify({ consulta: 'algo' })
  });
  await expect.poll(() => chamadas.busca.length, { timeout: 10000 }).toBe(1);

  await emitir(page, { type: 'response.done', response: { usage: 'lixo' } });
  await expect.poll(async () => (await recebidos(page)).map(m => m.type))
    .toContain('response.create');
  await expect(page.locator('#assistantVoice')).toHaveClass(/is-listening/);
});

test('a conversa é transcrita no console — e SÓ no console', async ({ page, context }) => {
  const DITO = 'quero uma sobremesa de chocolate';
  const RESPONDIDO = 'Temos pudim e brownie. Qual você prefere?';
  const RESUMO = 'Produtos encontrados: Pudim - R$ 12,50';

  const chamadas = await montar(page, context, {
    busca: { produtos: [{ id: 'p1', name: 'Pudim', price: 12.5 }], resumo: RESUMO }
  });
  const linhas = [];
  page.on('console', m => { if (m.type() === 'log') linhas.push(m.text()); });
  await conversar(page);

  await emitir(page, {
    type: 'conversation.item.input_audio_transcription.completed',
    transcript: DITO
  });
  await emitir(page, {
    type: 'response.output_audio_transcript.done',
    transcript: RESPONDIDO
  });
  await emitir(page, {
    type: 'response.function_call_arguments.done',
    call_id: 'call_transcricao', name: 'buscar_no_cardapio',
    arguments: JSON.stringify({ consulta: 'sobremesa', preco_maximo: 40 })
  });
  await expect.poll(() => chamadas.busca.length, { timeout: 10000 }).toBe(1);

  // As quatro linhas chegam por caminhos assíncronos diferentes — duas pelo
  // canal de dados, e a consulta e o resumo dos dois lados de um round trip
  // HTTP. Os 300 ms de relógio que estavam aqui eram uma aposta: sob carga o
  // resumo ainda não tinha sido logado e o teste reprovava um app correto
  // ("received value must be a string", 31/08/2026). A espera agora é por
  // condição, e a mensagem de falha diz QUAL linha faltou.
  const ESPERADAS = [DITO, RESPONDIDO, 'sobremesa (até R$ 40)', RESUMO];
  await expect.poll(
    () => ESPERADAS.filter(termo => !linhas.some(linha => linha.includes(termo))),
    { timeout: 10000 }
  ).toEqual([]);

  const achar = termo => linhas.find(linha => linha.includes(termo));

  // As três origens, cada uma com sua etiqueta.
  expect(achar(DITO), `a fala do cliente não foi transcrita:\n${linhas.join('\n')}`)
    .toMatch(/cliente/);
  expect(achar(RESPONDIDO), 'a fala do assistente não foi transcrita').toMatch(/assistente/);
  // A tool call sai dos dois lados: a consulta enviada e o resumo recebido.
  expect(achar('sobremesa (até R$ 40)'), 'a consulta enviada não foi transcrita').toMatch(/busca/);
  expect(achar(RESUMO), 'o resumo recebido não foi transcrito').toMatch(/busca/);

  // E agora o que importa: NADA disso viajou. A fala do cliente é o dado mais
  // sensível que este app toca, e o caminho dela termina no console.
  await page.locator('#assistantVoiceEnd').click();
  await expect.poll(() => chamadas.ended.length).toBe(1);

  const tudoQueSaiu = JSON.stringify({
    sessao: chamadas.sessao,
    connected: chamadas.connected,
    ended: chamadas.ended,
    busca: chamadas.busca
  });
  expect(tudoQueSaiu, 'a fala do cliente vazou para o backend').not.toContain(DITO);
  expect(tudoQueSaiu, 'a fala do assistente vazou para o backend').not.toContain(RESPONDIDO);
  // O /ended continua sendo só motivo + contadores.
  expect(Object.keys(chamadas.ended[0])).not.toContain('transcript');
  expect(Object.keys(chamadas.ended[0])).not.toContain('transcricao');

  // E nada foi gravado no aparelho.
  const guardado = await page.evaluate(() =>
    JSON.stringify({ local: { ...localStorage }, sessao: { ...sessionStorage } }));
  expect(guardado, 'a transcrição foi gravada no aparelho').not.toContain(DITO);
  expect(guardado).not.toContain(RESPONDIDO);
});

test('transcrição vazia não vira linha em branco no console', async ({ page, context }) => {
  await montar(page, context);
  const linhas = [];
  page.on('console', m => { if (m.type() === 'log') linhas.push(m.text()); });
  await conversar(page);
  const antes = linhas.filter(l => /voz · /.test(l)).length;

  // A API manda transcrição vazia quando não entendeu nada. Uma etiqueta
  // colorida sem texto ao lado só suja o console.
  await emitir(page, { type: 'conversation.item.input_audio_transcription.completed', transcript: '   ' });
  await emitir(page, { type: 'response.output_audio_transcript.done', transcript: '' });
  await emitir(page, { type: 'conversation.item.input_audio_transcription.completed' });
  await page.waitForTimeout(300);

  expect(linhas.filter(l => /voz · /.test(l)).length).toBe(antes);
});

test('cota estourada: a mensagem aparece e nenhum microfone é aberto', async ({ page, context }) => {
  const chamadas = await montar(page, context, {
    statusEmissao: 429,
    emissao: { detail: 'Voce ja usou 5 conversas por voz nas ultimas 24 horas. Tente mais tarde.' }
  });

  await page.locator('#mobViewAssistant .assistant-ai-send').click();
  await expect(page.locator('#assistantVoiceAlert')).toBeVisible();
  // O número vem de dentro do texto do backend: o app não tem como recalculá-lo.
  await expect(page.locator('#assistantVoiceAlertText')).toContainText('5 conversas por voz');

  // Nada de WebRTC e nada de microfone quando a emissão nem passou.
  expect(chamadas.openai).toEqual([]);
  expect(await page.evaluate(() => window.__faixas || null)).toBeNull();
  // E nem um /ended: não houve sessão para encerrar.
  expect(chamadas.ended).toEqual([]);
});

test('restaurante sem voz: 403 vira uma frase legível, sem jargão do backend', async ({ page, context }) => {
  await montar(page, context, {
    statusEmissao: 403,
    emissao: { detail: 'O atendimento por voz nao esta disponivel neste restaurante.' }
  });

  await page.locator('#mobViewAssistant .assistant-ai-send').click();
  await expect(page.locator('#assistantVoiceAlertText'))
    .toHaveText('Este restaurante ainda não atende por voz.');
});

test('voz desligada na plataforma: o 404 da rota inteira também é dito', async ({ page, context }) => {
  await montar(page, context, { statusEmissao: 404, emissao: { detail: 'Not Found' } });

  await page.locator('#mobViewAssistant .assistant-ai-send').click();
  await expect(page.locator('#assistantVoiceAlertText'))
    .toHaveText('O atendimento por voz não está disponível no momento.');
});

test('a sessão emitida que não conecta é encerrada no backend', async ({ page, context }) => {
  const chamadas = await montar(page, context);
  await page.unroute(OPENAI);
  await page.route(OPENAI, route => route.request().method() === 'OPTIONS'
    ? route.fulfill({ status: 204, headers: CORS, body: '' })
    : route.fulfill({ status: 500, headers: CORS, contentType: 'text/plain', body: 'boom' }));

  await page.locator('#mobViewAssistant .assistant-ai-send').click();
  await expect(page.locator('#assistantVoiceAlert')).toBeVisible({ timeout: 15000 });

  // A emissão aconteceu, então a sessão existe no servidor e está contando.
  // Morrer calado aqui deixaria uma sessão aberta do lado de lá.
  expect(chamadas.sessao).toHaveLength(1);
  await expect.poll(() => chamadas.ended.length).toBe(1);
  // E o microfone que chegou a ser aberto foi fechado.
  await expect.poll(async () =>
    page.evaluate(() => (window.__faixas || []).every(f => f.readyState === 'ended'))).toBe(true);
});
