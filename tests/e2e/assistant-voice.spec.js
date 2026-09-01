import { test, expect } from '@playwright/test';
import { mockApi, seedPickupSession, RESTAURANT_URL, esperarAppPronto } from './helpers.js';

// O modo voz — a interface.
//
// O que estes testes travam é o que CUSTA DINHEIRO quando quebra. Uma sessão de
// voz é faturada por minuto enquanto o microfone estiver aberto, então:
//
//   - o botão não pode abrir voz quando a pessoa quis enviar texto;
//   - visitante não pode chegar na tela (a credencial exige token de cliente);
//   - a tela precisa ter UMA saída, e ela precisa funcionar;
//   - falha de cota e restaurante sem voz precisam APARECER, não sumir no log.
//
// Nada aqui mede pixel de cor — a paleta é do lojista e pode mudar.

async function abrirChat(page, { logado = true } = {}) {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockApi(page);
  if (logado) {
    // O token é o que separa quem pode falar de quem não pode. A rota do perfil
    // é servida junto porque o 401 padrão do mockApi deixaria a sessão meio viva.
    await page.addInitScript(() =>
      localStorage.setItem('rapidex.customer.token', 'e2e.voice.token'));
    await page.route('**/customers/me**', route => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ id: 'c1', name: 'E2E', email: 'e@e.com', phone: '85999999999' })
    }));
  }
  await seedPickupSession(page);
  await page.goto(RESTAURANT_URL);
  await esperarAppPronto(page);

  // Estes testes são sobre a TELA. O transporte de verdade é trocado por um
  // dublê pelo mesmo `setDriver` que ele usa — o que também deixa cada teste
  // conferir o que a tela pediu a ele, e com que motivo.
  await page.evaluate(() => {
    window.__voz = { inicios: 0, paradas: [], mudo: [] };
    window.RapidexAssistantVoice.setDriver({
      start: () => { window.__voz.inicios += 1; },
      stop: motivo => { window.__voz.paradas.push(motivo); },
      setMuted: valor => { window.__voz.mudo.push(valor); }
    });
  });

  await page.evaluate(() => window.RapidexActions.resolve('mobNavAssistant')());
  await expect(page.locator('#assistantStarter')).toHaveClass(/is-ready/);
}

const botao = page => page.locator('#mobViewAssistant .assistant-ai-send');
const painel = page => page.locator('#assistantVoice');

async function abrirVoz(page) {
  await botao(page).click();
  await expect(painel(page)).toHaveClass(/is-open/);
}

test('o botão troca com o campo: vazio é ondas, com texto é a seta', async ({ page }) => {
  await abrirChat(page);
  const enviar = botao(page);
  const campo = page.locator('#assistantInput');

  const ler = () => enviar.evaluate(el => ({
    rotulo: el.getAttribute('aria-label'),
    desabilitado: el.disabled,
    // O desenho, e não a classe: é o glifo que a pessoa vê.
    paths: [...el.querySelectorAll('path')].map(p => p.getAttribute('d')),
    caixa: (({ x, y, width, height }) => ({
      x: Math.round(x), y: Math.round(y), width: Math.round(width), height: Math.round(height)
    }))(el.getBoundingClientRect())
  }));

  const vazio = await ler();
  // Cinco barras verticais — ondas de áudio. NÃO um microfone: microfone
  // significa ditado (falar vira texto), que é a promessa errada para uma
  // conversa em tempo real.
  expect(vazio.paths, 'o botão vazio não está com as cinco ondas').toHaveLength(5);
  for (const d of vazio.paths) {
    expect(d, `a onda "${d}" não é uma barra vertical`).toMatch(/^M[\d.]+ [\d.]+v[\d.]+$/);
  }
  expect(vazio.rotulo).toBe('Conversar por voz');
  // Campo vazio deixou de ser "nada a fazer": o botão está VIVO.
  expect(vazio.desabilitado, 'o botão de voz nasceu desabilitado').toBe(false);

  await campo.fill('quero uma sobremesa');
  const comTexto = await ler();
  expect(comTexto.paths, 'com texto o botão não virou a seta').toEqual(['M12 19V5', 'm5 12 7-7 7 7']);
  expect(comTexto.rotulo).toBe('Enviar');
  expect(comTexto.desabilitado).toBe(false);

  // E volta a ondas quando o campo esvazia.
  await campo.fill('');
  const devolta = await ler();
  expect(devolta.paths, 'esvaziar o campo não devolveu as ondas').toEqual(vazio.paths);
  expect(devolta.rotulo).toBe('Conversar por voz');

  // A troca não move nem redimensiona o botão. Um botão que salta é um botão
  // que a pessoa erra — e errar aqui abre voz sem querer.
  expect(comTexto.caixa, 'o botão mudou de lugar ou de tamanho ao trocar').toEqual(vazio.caixa);
  expect(devolta.caixa).toEqual(vazio.caixa);
});

test('a troca é imediata: nada de transição no botão de voz', async ({ page }) => {
  await abrirChat(page);
  const estilos = await botao(page).evaluate(el => {
    const cs = getComputedStyle(el);
    return { transicao: cs.transitionDuration, animacao: cs.animationName, opacidade: cs.opacity };
  });
  // Sem isto, quem aperta no meio da troca dispara a ação do ícone que estava
  // saindo — e uma delas é paga.
  expect(estilos.transicao, 'voltou transição no botão de voz').toMatch(/^0s(, 0s)*$/);
  expect(estilos.animacao).toBe('none');
  expect(estilos.opacidade).toBe('1');
});

test('visitante não entra na voz: vai para o login', async ({ page }) => {
  await abrirChat(page, { logado: false });

  // O motivo aparece ANTES do toque; não é uma surpresa explicada só depois.
  await expect(page.locator('#assistantVoiceLoginHint')).toBeVisible();
  await expect(page.locator('#assistantVoiceLoginHint')).toHaveText(/entre para usar a voz/i);
  await expect(botao(page)).toHaveClass(/is-login-required/);
  await expect(botao(page)).toHaveAttribute('aria-label', 'Entre para usar a voz');

  await botao(page).click();

  // A emissão da credencial exige token de cliente. Sem login não se abre a tela
  // nem se pede o microfone — o 401 viria depois de tudo isso.
  await expect(page.locator('#loginModal')).toHaveClass(/active/);
  await expect(page.locator('#loginVoiceReason')).toBeVisible();
  await expect(painel(page)).toHaveCount(0);
  await expect(page.locator('body')).not.toHaveClass(/assistant-voice-open/);
});

test('login pedido pela voz volta ao chat e deixa o microfone pronto', async ({ page }) => {
  await abrirChat(page, { logado: false });
  await page.route('**/auth/login', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      access_token: 'e2e.voice.after-login',
      customer: { id: 'c-voice', name: 'Cliente Voz', email: 'voz@e2e.com', phone: '85999999999' }
    })
  }));
  await page.route('**/customers/me/addresses**', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ addresses: [] })
  }));

  await botao(page).click();
  await page.locator('#loginModal .login-secondary').click();
  await page.locator('#loginEmail').fill('voz@e2e.com');
  await page.locator('#loginPassword').fill('senha-e2e');
  await page.locator('#loginSubmitBtn').click();

  await expect(page.locator('#loginModal')).not.toHaveClass(/active/);
  await expect(page.locator('#mobViewAssistant')).toHaveClass(/active/);
  await expect(painel(page)).toHaveClass(/is-open/);
  await expect.poll(() => page.evaluate(() => window.__voz.inicios)).toBe(1);
  await expect(page.locator('#assistantVoiceLoginHint')).toBeHidden();
});

test('a tela de voz não tem campo de texto, nem dock, nem barra inferior', async ({ page }) => {
  await abrirChat(page);
  await abrirVoz(page);

  // Voz e texto são conversas SEPARADAS no backend, que não se conhecem. Um
  // campo aqui falaria com um assistente que não ouviu nada do que foi dito.
  const digitaveis = await painel(page).evaluate(el =>
    el.querySelectorAll('input, textarea, [contenteditable="true"]').length);
  expect(digitaveis, 'apareceu um campo de digitação dentro do modo voz').toBe(0);

  await expect(page.locator('#mobViewAssistant .assistant-bottom-dock')).toBeHidden();
  await expect(page.locator('#mobBottomNav')).toBeHidden();

  // A esfera, os cartões e a saída: a anatomia que a tela promete.
  await expect(page.locator('#assistantVoiceOrb')).toBeVisible();
  await expect(page.locator('#assistantVoiceEnd')).toBeVisible();

  // A esfera fica EM CIMA, e não é gigante: o meio da tela pertence aos cartões.
  const geometria = await page.evaluate(() => {
    const tela = document.getElementById('assistantVoice').getBoundingClientRect();
    const orb = document.getElementById('assistantVoiceOrb').getBoundingClientRect();
    const sair = document.getElementById('assistantVoiceEnd').getBoundingClientRect();
    return {
      centroDaEsfera: (orb.top + orb.height / 2 - tela.top) / tela.height,
      ladoDaEsfera: Math.round(orb.width),
      redonda: Math.round(orb.width) === Math.round(orb.height),
      alturaDoSair: Math.round(sair.height),
      larguraDoSair: sair.width / tela.width
    };
  });
  // Onde ela senta depende de haver cartões — isso é assunto do teste da
  // centralização. Aqui só importa que ela não desça para a metade de baixo,
  // que é onde ficam os controles.
  expect(geometria.centroDaEsfera, 'a esfera caiu na metade de baixo').toBeLessThan(0.5);
  expect(geometria.redonda, 'a esfera virou oval').toBe(true);
  expect(geometria.ladoDaEsfera, 'a esfera ficou gigante').toBeLessThanOrEqual(200);
  // Grande e claro: o botão de encerrar é o maior alvo da tela.
  expect(geometria.alturaDoSair).toBeGreaterThanOrEqual(52);
  expect(geometria.larguraDoSair).toBeGreaterThan(0.6);
});

test('a esfera é pintada com a cor do restaurante', async ({ page }) => {
  await abrirChat(page);
  await abrirVoz(page);

  const corpo = page.locator('#assistantVoiceOrb .assistant-voice-orb__body');
  const ler = () => corpo.evaluate(el => getComputedStyle(el).backgroundImage);

  const laranja = await ler();
  await page.evaluate(() => window.RapidexTheme.applyBrandTheme('#2A2D7C'));
  const indigo = await ler();

  expect(indigo, 'a esfera não acompanhou o tenant').not.toBe(laranja);
  // Degradê de verdade, e não uma cor chapada: é ele que dá o volume.
  expect(indigo).toMatch(/gradient/);
});

test('a esfera reage à fala pelo nível de áudio, sem mexer no layout', async ({ page }) => {
  await abrirChat(page);
  await abrirVoz(page);

  const medir = () => page.evaluate(() => {
    const orb = document.getElementById('assistantVoiceOrb');
    const corpo = orb.querySelector('.assistant-voice-orb__body');
    const m = new DOMMatrixReadOnly(getComputedStyle(corpo).transform);
    return { escala: Math.hypot(m.a, m.b), caixa: Math.round(orb.getBoundingClientRect().width) };
  });

  await page.evaluate(() => {
    window.RapidexAssistantVoice.setState('listening');
    window.RapidexAssistantVoice.setLevel(0);
  });
  const parado = await medir();

  await page.evaluate(() => window.RapidexAssistantVoice.setLevel(1));
  // A escala sobe por TRANSIÇÃO (`transform .09s linear`), e esperar 250 ms de
  // relógio é apostar que ela já progrediu quando a leitura chegar. Sob carga a
  // aposta se perde: na execução 7 de 15 desta rodada, `parado` e `falando`
  // leram os dois 1. Esperar por CONDIÇÃO não muda o que o teste afirma — muda
  // só quem paga a lentidão da máquina.
  await expect.poll(async () => (await medir()).escala,
    { timeout: 5000 }).toBeGreaterThan(parado.escala);
  const falando = await medir();

  expect(falando.escala, 'a esfera não reagiu à fala').toBeGreaterThan(parado.escala);
  // A reação é transform, não largura: mexer na caixa forçaria layout a cada
  // quadro do analisador de áudio.
  expect(falando.caixa, 'a esfera reagiu redimensionando a caixa').toBe(parado.caixa);
});

test('mudo diz que está mudo, com todas as letras', async ({ page }) => {
  await abrirChat(page);
  await abrirVoz(page);
  await page.evaluate(() => window.RapidexAssistantVoice.setState('listening'));
  await expect(page.locator('#assistantVoiceTitle')).toHaveText('Estou ouvindo');

  await page.locator('#assistantVoiceMute').click();

  // Continuar dizendo "Estou ouvindo" com o microfone cortado é a única mentira
  // que esta tela poderia contar.
  await expect(page.locator('#assistantVoiceTitle')).toHaveText('Microfone desligado');
  await expect(page.locator('#assistantVoiceMute')).toHaveAttribute('aria-pressed', 'true');

  await page.locator('#assistantVoiceMute').click();
  await expect(page.locator('#assistantVoiceTitle')).toHaveText('Estou ouvindo');
});

test('os cartões da voz são os mesmos do chat, e abrem o mesmo detalhe', async ({ page }) => {
  await abrirChat(page);
  await abrirVoz(page);

  await expect(page.locator('#assistantVoiceRail')).toBeHidden();

  await page.evaluate(() => {
    const produtos = (window.PedeAquiRestaurantStore.get().products || []).slice(0, 3);
    window.RapidexAssistantVoice.showProducts(produtos);
  });

  const cartoes = page.locator('#assistantVoiceRail .assistant-product-card');
  await expect(cartoes).toHaveCount(3);

  // O preço do cartão vem do BANCO, formatado pelo mesmo código do chat — nunca
  // do que o modelo falou. É essa separação que impede o assistente de dizer um
  // preço e a tela mostrar outro.
  const preco = await cartoes.first().locator('.assistant-result-price').innerText();
  expect(preco).toMatch(/^R\$\s?\d{1,3}(\.\d{3})*,\d{2}$/);

  // O nome nunca sai cortado no meio da palavra: ou cabe, ou termina em
  // reticências.
  const titulo = await cartoes.first().locator('.assistant-result-title').evaluate(el => ({
    ellipsis: getComputedStyle(el).textOverflow,
    cabeNaCaixa: el.scrollWidth <= el.clientWidth + 1 || getComputedStyle(el).textOverflow === 'ellipsis',
    dentroDoCartao: el.getBoundingClientRect().width
      <= el.closest('.assistant-product-card').getBoundingClientRect().width
  }));
  expect(titulo.dentroDoCartao, 'o título estourou a largura do cartão').toBe(true);
  expect(titulo.cabeNaCaixa).toBe(true);

  // E o toque cai na MESMA folha de detalhe do chat.
  await cartoes.first().click();
  await expect(page.locator('#assistantProductDetail')).toHaveClass(/is-open/);
});

test('a saída é uma só, e devolve o chat inteiro', async ({ page }) => {
  await abrirChat(page);
  await abrirVoz(page);

  // Toda saída passa pelo mesmo caminho — é o que garante que o microfone
  // sempre pare. Uma segunda porta é como o indicador de gravação fica aceso
  // depois de a conversa acabar.
  const saidas = await painel(page).evaluate(el =>
    [...el.querySelectorAll('[data-act-click]')]
      .map(node => node.getAttribute('data-act-click'))
      .filter(spec => spec.includes('assistantVoiceEnd')).length);
  expect(saidas, 'a tela ganhou mais de um jeito de sair').toBe(2); // encerrar + voltar do erro

  await page.locator('#assistantVoiceEnd').click();

  await expect(painel(page)).not.toHaveClass(/is-open/);
  await expect(page.locator('body')).not.toHaveClass(/assistant-voice-open/);
  await expect(page.locator('#mobViewAssistant .assistant-ai-input')).toBeVisible();
  await expect(page.locator('#mobBottomNav')).toBeVisible();

  // E o transporte foi desligado UMA vez, com um motivo legível — é ele que vai
  // parar as faixas do microfone e avisar o backend.
  expect(await page.evaluate(() => window.__voz.paradas))
    .toEqual(['o cliente clicou em Parar']);
});

test('a esfera se centra sem cartões e sobe quando eles chegam', async ({ page }) => {
  await abrirChat(page);
  await abrirVoz(page);

  const medir = () => page.evaluate(() => {
    const tela = document.getElementById('assistantVoice').getBoundingClientRect();
    const orb = document.getElementById('assistantVoiceOrb').getBoundingClientRect();
    return (orb.top + orb.height / 2 - tela.top) / tela.height;
  });

  // Sem cartões a esfera fica no meio: a faixa de branco parada no centro lia
  // como tela quebrada.
  const sozinha = await medir();
  expect(sozinha, `esfera fora do centro: ${sozinha}`).toBeGreaterThan(0.32);
  expect(sozinha).toBeLessThan(0.5);

  await page.evaluate(() => {
    const produtos = (window.PedeAquiRestaurantStore.get().products || []).slice(0, 3);
    window.RapidexAssistantVoice.showProducts(produtos);
  });
  // A subida é uma transição de flex-grow; esperar o fim dela.
  await page.waitForTimeout(600);

  const comCartoes = await medir();
  expect(comCartoes, 'a esfera não subiu quando os produtos chegaram').toBeLessThan(sozinha - 0.06);
  expect(comCartoes).toBeLessThan(0.28);

  // E os cartões ficam abaixo dela, não em cima.
  const abaixo = await page.evaluate(() => {
    const orb = document.getElementById('assistantVoiceOrb').getBoundingClientRect();
    const faixa = document.getElementById('assistantVoiceRail').getBoundingClientRect();
    return faixa.top >= orb.bottom;
  });
  expect(abaixo).toBe(true);
});

test('Escape também encerra', async ({ page }) => {
  await abrirChat(page);
  await abrirVoz(page);
  await page.keyboard.press('Escape');
  await expect(painel(page)).not.toHaveClass(/is-open/);
});

test('cota estourada e restaurante sem voz são LIDOS, não engolidos', async ({ page }) => {
  await abrirChat(page);
  await abrirVoz(page);

  const recado = 'Voce ja usou 5 conversas por voz nas ultimas 24 horas. Tente mais tarde.';
  await page.evaluate(texto => window.RapidexAssistantVoice.fail(texto), recado);

  const alerta = page.locator('#assistantVoiceAlert');
  await expect(alerta).toBeVisible();
  // O texto vem do backend inteiro: o número de conversas está DENTRO dele, e
  // não há campo de código de erro para o front reescrever a frase.
  await expect(page.locator('#assistantVoiceAlertText')).toHaveText(recado);
  await expect(alerta).toHaveAttribute('role', 'alert');

  // E a única coisa a fazer é voltar — que também passa pelo caminho único.
  await alerta.locator('.assistant-voice-alert__btn').click();
  await expect(painel(page)).not.toHaveClass(/is-open/);
});

test('a tela expõe ao transporte exatamente a superfície combinada', async ({ page }) => {
  await abrirChat(page);

  const superficie = await page.evaluate(() =>
    Object.keys(window.RapidexAssistantVoice).sort());
  expect(superficie).toEqual([
    'audioElement', 'clearProducts', 'end', 'fail', 'isMuted', 'isOpen', 'request',
    'setDriver', 'setLevel', 'setMuted', 'setState', 'showProducts', 'state'
  ]);
});
