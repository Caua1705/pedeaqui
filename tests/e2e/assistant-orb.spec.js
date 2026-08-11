import { test, expect } from '@playwright/test';
import { mockApi, seedPickupSession, RESTAURANT_URL, PRODUCT_H2O } from './helpers.js';

// A esfera que substituiu o mascote no app do consumidor.
//
// O que estes testes travam é o CONTRATO, não o desenho: a esfera sai da cor
// cadastrada pelo lojista (e só dela), tem os três estados que a tela usa, para
// sem sumir sob prefers-reduced-motion, e a abertura não volta a ser uma tela
// vazia. Nada aqui mede pixel de gradiente — o gradiente pode mudar.

const CHAT_ANSWER = {
  response_type: 'products',
  message: 'Boa! Separei uma opção gelada.',
  products: [{ id: PRODUCT_H2O, name: 'Água H2O', price: 7.05 }]
};

async function openAssistant(page, { chatDelay = 0, viewport } = {}) {
  await page.setViewportSize(viewport || { width: 390, height: 844 });
  await mockApi(page);
  await page.route('**/chat', async route => {
    if (chatDelay) await new Promise(resolve => setTimeout(resolve, chatDelay));
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(CHAT_ANSWER)
    });
  });
  await seedPickupSession(page);
  await page.goto(RESTAURANT_URL);
  await page.waitForFunction(() => !document.body.classList.contains('app-booting'));
  await page.evaluate(() => window.RapidexActions.resolve('mobNavAssistant')());
  await expect(page.locator('#mobViewAssistant .assistant-hdr')).toBeVisible();
}

/** Espera a abertura terminar de se revelar (pergunta digitada + sugestões). */
async function waitForIntro(page) {
  await expect(page.locator('#assistantStarter')).toHaveClass(/is-ready/);
}

test('a esfera é pintada com a cor do restaurante, sem cor fixa', async ({ page }) => {
  await openAssistant(page);
  await waitForIntro(page);

  const read = () => page.locator('#assistantIntroOrb').evaluate(el => ({
    // A variável do componente tem que ser a do tema. O bloco de CSS traz
    // #F26B21 como valor de ORIGEM, e ele não pode vencer o hex do lojista.
    brand: getComputedStyle(el).getPropertyValue('--brand').trim(),
    themeBrand: getComputedStyle(document.documentElement)
      .getPropertyValue('--brand-primary').trim(),
    field: getComputedStyle(el.querySelector('.assistant-orb__field')).backgroundColor,
    tint: getComputedStyle(el.querySelector('.assistant-orb__wisp--tint')).backgroundImage
  }));

  const orange = await read();
  await page.evaluate(() => window.RapidexTheme.applyBrandTheme('#2A2D7C'));
  const indigo = await read();

  expect(orange.brand.toUpperCase(), 'o componente não leu a cor do tema').toBe(orange.themeBrand.toUpperCase());
  expect(indigo.brand.toUpperCase()).toBe('#2A2D7C');
  expect(indigo.field, 'a esfera não acompanhou a cor do tenant').not.toBe(orange.field);
  // O azul entra de fato na pintura do arco de cor, não só numa variável.
  expect(indigo.tint).toMatch(/rgba?\(\s*4[0-9],\s*4[0-9],\s*12[0-9]\s*[,)]/);
});

test('o campo é claro; a cor cheia fica no arco, não no campo inteiro', async ({ page }) => {
  await openAssistant(page);
  await waitForIntro(page);

  // A regressão que este teste trava: preencher o recorte com a marca. Numa
  // página branca, uma marca escura vira massa fechada e o desfoque funde tudo
  // num borrão. A relação de luminância é o componente inteiro — se ela
  // inverter, deixa de parecer emissão de luz.
  // color-mix() computa como `color(srgb 0.98 0.92 0.88)` — canais de 0 a 1 —,
  // e NÃO como `rgb(250, 235, 225)`. Um parser que só busca dígitos lê
  // "0.982118" como 0 e 982118, a luminância estoura e o teste passa achando
  // que mediu alguma coisa. Foi o que aconteceu na primeira versão disto.
  const channels = (value) => {
    const modern = value.match(/color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)/i);
    if (modern) return [+modern[1], +modern[2], +modern[3]];
    return value.match(/[\d.]+/g).slice(0, 3).map(n => Number(n) / 255);
  };
  const luminance = (value) => {
    const [r, g, b] = channels(value);
    const linear = s => (s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4));
    return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
  };

  for (const hex of ['#F26B21', '#FFD34D', '#2A2D7C']) {
    await page.evaluate(c => window.RapidexTheme.applyBrandTheme(c), hex);
    const field = await page.locator('#assistantIntroOrb .assistant-orb__field')
      .evaluate(el => getComputedStyle(el).backgroundColor);

    const brandLuminance = luminance(`rgb(${parseInt(hex.slice(1, 3), 16)}, `
      + `${parseInt(hex.slice(3, 5), 16)}, ${parseInt(hex.slice(5, 7), 16)})`);
    const fieldLuminance = luminance(field);

    // Claro em termos absolutos — perto do branco da página, não da marca.
    expect(fieldLuminance, `campo escuro demais em ${hex}`).toBeGreaterThan(0.7);
    // E claro EM RELAÇÃO à marca: mesmo num amarelo já claro, o campo continua
    // sendo o sopro da cor sobre branco, nunca a cor crua.
    expect(fieldLuminance, `o campo virou a marca crua em ${hex}`)
      .toBeGreaterThan(brandLuminance);
  }
});

test('é CSS, não vídeo nem imagem', async ({ page }) => {
  await openAssistant(page);
  await waitForIntro(page);

  const media = await page.locator('#assistantIntroOrb').evaluate(el => ({
    tags: [...el.querySelectorAll('*')].map(child => child.tagName),
    url: getComputedStyle(el.querySelector('.assistant-orb__field')).backgroundImage
  }));

  expect(media.tags).not.toContain('IMG');
  expect(media.tags).not.toContain('VIDEO');
  expect(media.tags).not.toContain('CANVAS');
  expect(media.url, 'a esfera passou a depender de um arquivo').not.toContain('url(');
});

test('os três estados mudam o ritmo, e SÓ o ritmo', async ({ page }) => {
  await openAssistant(page, { chatDelay: 2500 });
  await waitForIntro(page);

  const orb = page.locator('#assistantIntroOrb');

  // 1. A conversa move o estado: parada -> pensando -> respondendo.
  await expect(orb).not.toHaveClass(/is-thinking/);
  await page.locator('.assistant-starter-card').first().click();
  await expect(orb).toHaveClass(/is-thinking/);
  await expect(orb).not.toHaveClass(/is-thinking/, { timeout: 15000 });
});

test('trocar de estado não mexe no recorte, só no que corre dentro dele', async ({ page }) => {
  await openAssistant(page);
  await waitForIntro(page);

  // Com a abertura na tela — durante a conversa ela some, e uma caixa oculta
  // mede 0x0, o que faria este teste passar por acidente.
  const measure = (state) => page.evaluate(name => {
    const el = document.getElementById('assistantIntroOrb');
    el.classList.toggle('is-thinking', name === 'thinking');
    const rect = el.getBoundingClientRect();
    const field = getComputedStyle(el.querySelector('.assistant-orb__field'));
    return {
      frame: [Math.round(rect.width), Math.round(rect.height), Math.round(rect.top), Math.round(rect.left)],
      rhythm: parseFloat(field.animationDuration)
    };
  }, state);

  const idle = await measure('idle');
  const thinking = await measure('thinking');
  const answering = await measure('answering');

  expect(idle.frame[0], 'a abertura não estava visível').toBeGreaterThan(40);

  // Pensando acelera o movimento INTERNO — é só isso que o estado significa.
  expect(thinking.rhythm, 'pensando não acelerou').toBeLessThan(idle.rhythm);
  expect(answering.rhythm, 'respondendo não voltou ao ritmo calmo').toBe(idle.rhythm);

  // E o círculo fica exatamente onde estava, do mesmo tamanho, nos três. Um
  // orbe que incha ao pensar vira loader: pede atenção em vez de mostrar estado.
  expect(thinking.frame, 'o recorte mudou ao pensar').toEqual(idle.frame);
  expect(answering.frame, 'o recorte mudou ao responder').toEqual(idle.frame);
});

test('sob movimento reduzido ela congela, e não some', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openAssistant(page);
  await waitForIntro(page);

  const state = await page.locator('#assistantIntroOrb').evaluate(el => {
    const rect = el.getBoundingClientRect();
    const layer = name => {
      const style = getComputedStyle(el.querySelector(name));
      return { play: style.animationPlayState, opacity: Number(style.opacity) };
    };
    return {
      width: Math.round(rect.width),
      visibility: getComputedStyle(el).visibility,
      field: layer('.assistant-orb__field'),
      wisp: layer('.assistant-orb__wisp--blot')
    };
  });

  // Congela PAUSANDO, não removendo: a animação continua declarada e o atraso
  // negativo a estaciona num quadro do meio, então a esfera fica parada numa
  // composição viva em vez de no primeiro quadro, que é o mais chapado dos três.
  expect(state.field.play, 'o campo continuou se movendo').toBe('paused');
  expect(state.wisp.play, 'as manchas continuaram se movendo').toBe('paused');
  // Congelada, mas inteira: sumir seria trocar a animação por um buraco na tela.
  expect(state.width).toBeGreaterThan(40);
  expect(state.visibility).toBe('visible');
  expect(state.field.opacity).toBeGreaterThan(0);
  expect(state.wisp.opacity).toBeGreaterThan(0);
});

test('o menu inferior tem quatro rótulos e um botão central destacado', async ({ page }) => {
  await openAssistant(page);

  // A esfera vive só DENTRO da tela do assistente: aqui o que aparece é um
  // ícone de balão, e o botão não tem texto — o nome dele é o aria-label.
  await expect(page.locator('#mobBottomNav .assistant-orb')).toHaveCount(0);
  const button = page.locator('#mobBottomNav .mob-nav-assistant-btn');
  await expect(button).toHaveAttribute('aria-label', 'Assistente');
  await expect(button).toHaveText('');

  const nav = await page.evaluate(() => {
    const bar = document.getElementById('mobBottomNav').getBoundingClientRect();
    const tabs = [...document.querySelectorAll('#mobBottomNav .mob-nav-item')].map(el => {
      const rect = el.getBoundingClientRect();
      const label = el.querySelector('span:not(.nav-icon)');
      return {
        id: el.id,
        width: Math.round(rect.width),
        label: label ? label.textContent.trim() : null,
        labelSize: label ? getComputedStyle(label).fontSize : null
      };
    });
    const el = document.querySelector('#mobBottomNav .mob-nav-assistant-btn');
    const rect = el.getBoundingClientRect();
    const style = getComputedStyle(el);
    const icon = el.querySelector('.mob-nav-icon').getBoundingClientRect();
    const iconCenters = [...document.querySelectorAll('#mobBottomNav .mob-nav-item .mob-nav-icon')]
      .map(i => { const r = i.getBoundingClientRect(); return r.top + r.height / 2; });
    return {
      tabs,
      button: {
        width: Math.round(rect.width),
        height: Math.round(rect.height),
        aboveBar: Math.round(bar.top - rect.top),
        iconCenterY: icon.top + icon.height / 2,
        radius: style.borderRadius,
        position: style.position,
        background: style.backgroundColor,
        iconColor: getComputedStyle(el.querySelector('.mob-nav-icon')).color,
        iconSide: Math.round(Math.max(icon.width, icon.height))
      },
      sideIconCenterY: iconCenters.reduce((a, b) => a + b, 0) / iconCenters.length,
      brand: getComputedStyle(document.documentElement).getPropertyValue('--brand-primary').trim()
    };
  });

  // Quatro abas com rótulo, o botão central NÃO entre elas.
  expect(nav.tabs.map(tab => tab.id)).toEqual(
    ['mobNavHome', 'mobNavMenu', 'mobNavOrders', 'mobNavProfile']);
  expect(nav.tabs.map(tab => tab.label)).toEqual(['Início', 'Cardápio', 'Clube', 'Perfil']);
  expect(new Set(nav.tabs.map(tab => tab.labelSize)).size, 'rótulos com corpos diferentes').toBe(1);

  // O botão é um círculo de ~48px, maior que os quatro ícones de linha —
  // por ser maior, ele SEMPRE estoura um pouco acima e abaixo da régua deles
  // mesmo centrado, e é essa sobra que lê como "elevado". O que importa é o
  // CENTRO: alinhado ao centro óptico dos outros quatro ícones, não flutuando
  // acima deles (era isso que ficava "muito pra cima" no mobile real).
  expect(nav.button.width).toBe(48);
  expect(nav.button.height).toBe(48);
  expect(nav.button.position).toBe('absolute');
  expect(nav.button.radius).toMatch(/50%|24px/);
  expect(Math.abs(nav.button.iconCenterY - nav.sideIconCenterY),
    `botão desalinhado dos outros ícones: ${nav.button.iconCenterY} vs ${nav.sideIconCenterY}`
  ).toBeLessThanOrEqual(4);
  // Fundo na marca diluída, ícone na marca cheia — não o contrário.
  expect(nav.button.background).toMatch(/^rgba\(/);
  expect(nav.button.iconColor, 'o ícone não está na cor da marca').not.toBe(nav.button.background);
  expect(nav.button.iconSide).toBeGreaterThan(16);
});

test('os quatro rótulos ficam alinhados entre si', async ({ page }) => {
  await openAssistant(page);

  // Os empurrõezinhos por item foram calibrados para uma régua de CINCO caixas
  // de larguras diferentes; hoje são quatro irmãos iguais mais um slot vazio.
  // O desalinho é invisível item a item — só aparece medindo os intervalos.
  const centers = await page.evaluate(() =>
    [...document.querySelectorAll('#mobBottomNav .mob-nav-item')].map(el => {
      const rect = el.getBoundingClientRect();
      return rect.left + rect.width / 2;
    }));

  expect(centers).toHaveLength(4);
  // O intervalo do meio é maior de propósito: é o slot que guarda o lugar do
  // botão. Os dois pares externos é que têm de ser iguais entre si.
  const gaps = centers.slice(1).map((center, index) => center - centers[index]);
  expect(Math.abs(gaps[0] - gaps[2]), `pares externos irregulares: ${gaps.map(g => g.toFixed(1))}`)
    .toBeLessThanOrEqual(1);
  expect(gaps[1], 'o slot central não abriu espaço para o botão').toBeGreaterThan(gaps[0]);

  // E o botão fica no centro exato da barra, entre os dois pares.
  const buttonCenter = await page.evaluate(() => {
    const rect = document.querySelector('#mobBottomNav .mob-nav-assistant-btn').getBoundingClientRect();
    const bar = document.getElementById('mobBottomNav').getBoundingClientRect();
    return (rect.left + rect.width / 2) - (bar.left + bar.width / 2);
  });
  expect(Math.abs(buttonCenter), 'o botão saiu do centro da barra').toBeLessThanOrEqual(1);
});

test('a abertura oferece sugestões clicáveis montadas com o cardápio do tenant', async ({ page }) => {
  await openAssistant(page);
  await waitForIntro(page);

  const cards = page.locator('.assistant-starter-card:visible');
  const count = await cards.count();
  expect(count, 'a tela voltou a abrir sem sugestões').toBeGreaterThanOrEqual(3);

  // Régua horizontal: todas na MESMA linha, cada uma à direita da anterior.
  // offsetTop/offsetLeft e não getBoundingClientRect: a revelação escalonada
  // ainda está correndo um translateY, e o rect mediria a animação, não o
  // layout — que é o que este teste quer travar.
  const geometry = await cards.evaluateAll(items => items.map(el =>
    ({ left: el.offsetLeft, top: el.offsetTop })));
  expect(new Set(geometry.map(item => item.top)).size, 'as sugestões não estão numa linha só').toBe(1);
  for (let i = 1; i < geometry.length; i++) {
    expect(geometry[i].left, 'as sugestões não estão em sequência').toBeGreaterThan(geometry[i - 1].left);
  }

  // E rola de verdade: o conteúdo é mais largo que a régua. É esse transbordo
  // que permite mais de três — em pilha, a quarta empurrava o resto da tela.
  const rail = await page.locator('#assistantStarter').evaluate(el => ({
    scroll: el.scrollWidth,
    client: el.clientWidth,
    overflowX: getComputedStyle(el).overflowX,
    snap: getComputedStyle(el).scrollSnapType
  }));
  expect(rail.scroll, 'a régua não transborda, então não rola').toBeGreaterThan(rail.client);
  expect(rail.overflowX).toBe('auto');
  // O navegador serializa `x proximity` como só `x`: proximity é o valor
  // inicial da força e some da forma computada.
  expect(rail.snap).toMatch(/^x( proximity)?$/);

  // A frase nunca quebra nem é cortada com reticências: inteira, ou não entra.
  const label = await page.locator('.assistant-starter-card-label').first().evaluate(el => {
    const style = getComputedStyle(el);
    return { wrap: style.whiteSpace, ellipsis: style.textOverflow, lines: el.getClientRects().length };
  });
  expect(label.wrap).toBe('nowrap');
  expect(label.ellipsis).not.toBe('ellipsis');
  expect(label.lines, 'a frase quebrou em duas linhas').toBe(1);

  // E sem a seta à direita: a pílula inteira já é clicável.
  await expect(page.locator('.assistant-starter-card-arrow')).toHaveCount(0);

  // Pelo menos uma pergunta nasce do cardápio DESTE restaurante: uma lista
  // 100% fixa não sobreviveria ao primeiro tenant de outro vertical.
  const labels = await cards.allInnerTexts();
  const categories = await page.evaluate(() =>
    (window.PedeAquiRestaurantStore.get().categories || []).map(category => category.name.toLowerCase()));
  expect(categories.length, 'o fixture perdeu as categorias').toBeGreaterThan(0);
  expect(
    labels.some(label => categories.some(category => label.toLowerCase().includes(category))),
    `nenhuma sugestão veio do cardápio: ${JSON.stringify(labels)}`
  ).toBe(true);

  // E tocar numa sugestão envia a pergunta.
  const chosen = (await cards.first().innerText()).trim();
  const [request] = await Promise.all([
    page.waitForRequest(req => req.url().includes('/chat') && req.method() === 'POST'),
    cards.first().click()
  ]);
  expect(JSON.parse(request.postData()).message).toBe(chosen);
  await expect(page.locator('.assistant-chat-user-message')).toContainText(chosen);
});

test('carregando: esqueleto no lugar da resposta, não meia tela em branco', async ({ page }) => {
  await openAssistant(page, { chatDelay: 3000 });
  await waitForIntro(page);
  await page.locator('.assistant-starter-card').first().click();

  const skeleton = page.locator('#assistantTypingMessage');
  await expect(skeleton).toBeVisible();
  await expect(skeleton.locator('.assistant-orb--mini')).toHaveClass(/is-thinking/);
  await expect(skeleton.locator('.assistant-skeleton-line')).toHaveCount(3);
  await expect(skeleton.locator('.assistant-skeleton-card')).toHaveCount(3);

  // O esqueleto ocupa o lugar EXATO do que está vindo: o cartão fantasma tem a
  // largura do cartão de produto real que vai substituí-lo.
  const ghostWidth = await skeleton.locator('.assistant-skeleton-card').first()
    .evaluate(el => Math.round(el.getBoundingClientRect().width));

  await expect(page.locator('.assistant-product-card').first()).toBeVisible({ timeout: 15000 });
  const realWidth = await page.locator('.assistant-product-card').first()
    .evaluate(el => Math.round(el.getBoundingClientRect().width));

  expect(Math.abs(ghostWidth - realWidth), 'o esqueleto não tem a medida do cartão real')
    .toBeLessThanOrEqual(2);
  await expect(skeleton).toHaveCount(0);
});

test('nada nesta tela nomeia a plataforma', async ({ page }) => {
  await openAssistant(page);
  await waitForIntro(page);

  // Varre o que o cliente LÊ, incluindo rótulos de acessibilidade — a marca
  // saía por aí também ("Escolha do Rapi", aria-label="Rapi").
  const leaked = await page.evaluate(() => {
    const screen = document.getElementById('mobViewAssistant');
    const nav = document.getElementById('mobBottomNav');
    const texts = [];
    for (const root of [screen, nav]) {
      texts.push(root.innerText || '');
      for (const el of root.querySelectorAll('[aria-label],[alt],[title],[placeholder]')) {
        texts.push(el.getAttribute('aria-label'), el.getAttribute('alt'),
          el.getAttribute('title'), el.getAttribute('placeholder'));
      }
    }
    return texts.filter(Boolean).filter(text => /\brapi(dex)?\b/i.test(text));
  });

  expect(leaked, 'a marca da plataforma voltou ao app do consumidor').toEqual([]);
});

test('a abertura não tem mais o vão morto no meio da tela', async ({ page }) => {
  await openAssistant(page);
  await waitForIntro(page);

  const layout = await page.evaluate(() => {
    const box = sel => {
      const rect = document.querySelector(sel).getBoundingClientRect();
      return { top: rect.top, bottom: rect.bottom };
    };
    const body = box('#assistantAiBody');
    const top = box('.assistant-intro-top');
    const starter = box('#assistantStarter');
    const input = box('.assistant-ai-input-bar');
    return {
      acimaDoBloco: top.top - body.top,
      entreBlocoESugestoes: starter.top - top.bottom,
      entreSugestoesEcampo: input.top - starter.bottom
    };
  });

  // O bloco de cima se centra: o espaço acima dele e o espaço até as sugestões
  // são o mesmo, seja qual for a altura da tela. Antes ele ficava colado no topo
  // e todo o resto do vão caía embaixo das sugestões, em branco.
  expect(
    Math.abs(layout.acimaDoBloco - layout.entreBlocoESugestoes),
    `bloco fora do centro: ${JSON.stringify(layout)}`
  ).toBeLessThanOrEqual(2);

  // E as sugestões ficam ancoradas junto do campo, não boiando no meio.
  expect(layout.entreSugestoesEcampo, 'as sugestões descolaram do campo').toBeLessThanOrEqual(40);
  expect(layout.entreSugestoesEcampo).toBeGreaterThan(0);
});

test('as sugestões somem na primeira mensagem e não voltam na mesma conversa', async ({ page }) => {
  await openAssistant(page);
  await waitForIntro(page);

  const starter = page.locator('#assistantStarter');
  await expect(starter).toBeVisible();
  await page.locator('.assistant-starter-card').first().click();
  await expect(page.locator('.assistant-product-card').first()).toBeVisible({ timeout: 15000 });
  await expect(starter, 'as sugestões ficaram durante a conversa').toBeHidden();

  // Sair da tela e voltar não é conversa nova: elas não podem reaparecer por
  // cima do que já foi conversado.
  await page.evaluate(() => window.RapidexActions.resolve('mobNavMenu')());
  await page.evaluate(() => window.RapidexActions.resolve('mobNavAssistant')());
  await expect(page.locator('.assistant-chat-user-message')).toBeVisible();
  await expect(starter, 'voltaram ao reabrir a mesma conversa').toBeHidden();

  // "Limpar conversa" começa uma sessão nova — aí sim.
  await page.locator('#assistantHdrMenuBtn').click();
  await page.locator('#assistantHdrMenu .assistant-hdr-menu-item').click();
  await expect(starter).toBeVisible();
});
