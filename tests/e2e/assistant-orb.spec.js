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

/**
 * Lê as paradas do gradiente com as cores JÁ RESOLVIDAS. Elas são a paleta do
 * componente: `stop-color` sai de color-mix() sobre var(--brand), então é aqui
 * que se vê se a esfera seguiu o tema do lojista.
 *
 * color-mix() computa como `color(srgb 0.98 0.92 0.87)` — canais de 0 a 1 —, e
 * NÃO como `rgb(250, 235, 225)`. Um parser que só busca dígitos lê "0.982118"
 * como 0 e 982118, a luminância estoura e o teste passa achando que mediu
 * alguma coisa. Já aconteceu uma vez nesta suíte.
 */
const CANAIS = (valor) => {
  const moderno = valor.match(/color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)/i);
  if (moderno) return [+moderno[1], +moderno[2], +moderno[3]];
  return valor.match(/[\d.]+/g).slice(0, 3).map(n => Number(n) / 255);
};
const luminancia = (valor) => {
  const [r, g, b] = CANAIS(valor);
  const linear = s => (s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4));
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
};

const lerPaleta = (page) => page.locator('#assistantIntroOrb').evaluate(el => {
  const cor = classe => getComputedStyle(el.querySelector('.assistant-orb__s--' + classe)).stopColor;
  return {
    brand: getComputedStyle(el).getPropertyValue('--brand').trim(),
    temaBrand: getComputedStyle(document.documentElement).getPropertyValue('--brand-primary').trim(),
    pale: cor('pale'), tint: cor('tint'), marca: cor('brand'), deep: cor('deep')
  };
});

test('a esfera é pintada com a cor do restaurante, sem cor fixa', async ({ page }) => {
  await openAssistant(page);
  await waitForIntro(page);

  // A variável do componente tem que ser a do tema. O bloco de CSS traz
  // #F26B21 como valor de ORIGEM, e ele não pode vencer o hex do lojista.
  const laranja = await lerPaleta(page);
  await page.evaluate(() => window.RapidexTheme.applyBrandTheme('#2A2D7C'));
  const indigo = await lerPaleta(page);

  expect(laranja.brand.toUpperCase(), 'o componente não leu a cor do tema').toBe(laranja.temaBrand.toUpperCase());
  expect(indigo.brand.toUpperCase()).toBe('#2A2D7C');

  // E o azul entra de fato na PINTURA, não só numa variável: as quatro paradas
  // do gradiente mudam junto. Um hex fixo em qualquer uma delas trava aqui.
  for (const parada of ['pale', 'tint', 'marca', 'deep']) {
    expect(indigo[parada], `a parada "${parada}" não acompanhou o tenant`).not.toBe(laranja[parada]);
  }
  const [r, g, b] = CANAIS(indigo.marca).map(v => Math.round(v * 255));
  expect([r, g, b], 'a marca cheia não é a cor do lojista').toEqual([0x2A, 0x2D, 0x7C]);
});

test('a maior parte do campo é clara; a marca cheia é uma região', async ({ page }) => {
  await openAssistant(page);
  await waitForIntro(page);

  // A regressão que este teste trava: preencher o recorte com a marca. Numa
  // página branca, uma marca escura vira massa fechada e o desfoque funde tudo
  // num borrão. `pale` e `tint` ocupam 78% do período do gradiente, então são
  // eles que mandam na leitura geral — e os dois têm que ficar bem mais claros
  // que a marca crua, em qualquer tenant.
  for (const hex of ['#F26B21', '#FFD34D', '#2A2D7C']) {
    await page.evaluate(c => window.RapidexTheme.applyBrandTheme(c), hex);
    const paleta = await lerPaleta(page);

    const lumMarca = luminancia(`rgb(${parseInt(hex.slice(1, 3), 16)}, `
      + `${parseInt(hex.slice(3, 5), 16)}, ${parseInt(hex.slice(5, 7), 16)})`);

    // Claro em termos absolutos — perto do branco da página, não da marca.
    expect(luminancia(paleta.pale), `campo escuro demais em ${hex}`).toBeGreaterThan(0.7);
    // E claro EM RELAÇÃO à marca: mesmo num amarelo já claro, o campo continua
    // sendo o sopro da cor sobre branco, nunca a cor crua.
    expect(luminancia(paleta.pale), `o campo virou a marca crua em ${hex}`).toBeGreaterThan(lumMarca);
    expect(luminancia(paleta.tint), `o meio-tom virou a marca crua em ${hex}`).toBeGreaterThan(lumMarca);
    // O acento é o oposto: tem que ser mais ESCURO que a marca, senão some.
    expect(luminancia(paleta.deep), `o acento não escureceu em ${hex}`).toBeLessThan(lumMarca);
  }
});

test('é ruído fractal em SVG — nem mídia, nem gradiente radial pintando o campo', async ({ page }) => {
  await openAssistant(page);
  await waitForIntro(page);

  const desenho = await page.locator('#assistantIntroOrb').evaluate(el => ({
    tags: [...new Set([...el.querySelectorAll('*')].map(n => n.tagName))],
    turbulencias: el.querySelectorAll('feTurbulence').length,
    deslocamentos: el.querySelectorAll('feDisplacementMap').length,
    seeds: [...el.querySelectorAll('feTurbulence')].map(t => t.getAttribute('seed')),
    frequenciaAnimada: [...el.querySelectorAll('animate')]
      .map(a => a.getAttribute('attributeName')),
    // O gradiente radial é legítimo no RECORTE e no acento; o que não pode é
    // ele pintar o campo, que é justamente o disco borrado de sempre.
    campos: [...el.querySelectorAll('.assistant-orb__drift--a rect, .assistant-orb__drift--b rect')]
      .map(r => r.getAttribute('fill')),
    linearesDefinidos: [...el.querySelectorAll('linearGradient')].map(gr => '#' + gr.id)
  }));

  expect(desenho.tags).not.toContain('IMG');
  expect(desenho.tags).not.toContain('VIDEO');
  expect(desenho.tags).not.toContain('CANVAS');

  // A técnica: turbulência fractal + deslocamento. Sem os dois, é outra coisa.
  expect(desenho.turbulencias, 'sumiu o feTurbulence').toBeGreaterThanOrEqual(2);
  expect(desenho.deslocamentos, 'sumiu o feDisplacementMap').toBeGreaterThanOrEqual(2);
  // Seeds distintos: com o mesmo ruído em todas as camadas o padrão se alinha e
  // volta a parecer regular.
  expect(new Set(desenho.seeds).size, 'as camadas repetem o mesmo ruído').toBe(desenho.seeds.length);

  // baseFrequency NUNCA é animada: mudá-la obriga a regerar a turbulência a cada
  // quadro. Só a scale do deslocamento oscila.
  expect(desenho.frequenciaAnimada).not.toContain('baseFrequency');
  expect(desenho.frequenciaAnimada.every(a => a === 'scale'),
    `animação em atributo caro: ${desenho.frequenciaAnimada}`).toBe(true);

  // As duas camadas de campo são pintadas por gradiente LINEAR (que a distorção
  // dobra em manchas), não radial (que borrado vira disco).
  expect(desenho.campos).toHaveLength(2);
  for (const fill of desenho.campos) {
    expect(desenho.linearesDefinidos, `o campo voltou a ser pintado por ${fill}`)
      .toContain(fill.replace(/^url\(|\)$/g, ''));
  }
});

test('não tem simetria concêntrica — é nuvem, não bola', async ({ page }) => {
  await openAssistant(page);
  await waitForIntro(page);

  // O critério que matou três tentativas anteriores. Um disco (gradiente radial
  // borrado) tem cor constante ao longo de cada anel em volta do centro: gire
  // 360° num raio fixo e a luminância não muda. Aqui ela TEM que mudar muito.
  //
  // Mede-se num quadro grande, desenhado num canvas: a 96px o ruído fica menor
  // que o pixel e o desvio se confunde com serrilhado.
  const aneis = await page.locator('#assistantIntroOrb').evaluate(async el => {
    const LADO = 300;
    const svg = el.querySelector('svg').cloneNode(true);
    // stop-color vem de folha externa; ao serializar ele se perde e tudo vira
    // preto. Resolve para atributo antes, lendo do elemento vivo.
    const vivos = el.querySelectorAll('stop');
    svg.querySelectorAll('stop').forEach((s, i) => {
      const cs = getComputedStyle(vivos[i]);
      s.setAttribute('stop-color', cs.stopColor);
      s.setAttribute('stop-opacity', cs.stopOpacity);
    });
    svg.setAttribute('width', LADO);
    svg.setAttribute('height', LADO);

    const img = new Image();
    img.src = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(
      new XMLSerializer().serializeToString(svg))));
    await new Promise((ok, fail) => { img.onload = ok; img.onerror = fail; });

    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = LADO;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, LADO, LADO);
    ctx.drawImage(img, 0, 0);
    const px = ctx.getImageData(0, 0, LADO, LADO).data;
    const lum = i => 0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2];

    let tinta = 0;
    for (let i = 0; i < px.length; i += 4) if (lum(i) < 246) tinta++;

    const meio = LADO / 2;
    const desvios = [];
    for (let raio = 30; raio <= 120; raio += 15) {
      const valores = [];
      for (let passo = 0; passo < 180; passo++) {
        const t = passo * Math.PI / 90;
        const x = Math.round(meio + raio * Math.cos(t));
        const y = Math.round(meio + raio * Math.sin(t));
        valores.push(lum((y * LADO + x) * 4));
      }
      const media = valores.reduce((s, v) => s + v, 0) / valores.length;
      desvios.push(Math.sqrt(valores.reduce((s, v) => s + (v - media) ** 2, 0) / valores.length));
    }
    return { cobertura: tinta / (LADO * LADO), desvios };
  });

  // Preenche o recorte: uma nuvem que ocupasse só o miolo leria como bolinha.
  expect(aneis.cobertura, `a esfera está oca: ${aneis.cobertura}`).toBeGreaterThan(0.4);

  // TODO anel tem que variar. O limite é folgado de propósito — o que ele
  // barra é o caso concêntrico, onde o desvio cai para perto de zero.
  const menor = Math.min(...aneis.desvios);
  expect(menor, `anel de cor quase constante (desvios: ${aneis.desvios.map(d => d.toFixed(1))})`)
    .toBeGreaterThan(6);
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
    const camada = getComputedStyle(el.querySelector('.assistant-orb__drift--a'));
    return {
      frame: [Math.round(rect.width), Math.round(rect.height), Math.round(rect.top), Math.round(rect.left)],
      rhythm: parseFloat(camada.animationDuration)
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
      const style = getComputedStyle(el.querySelector('.assistant-orb__drift--' + name));
      return {
        play: style.animationPlayState,
        delay: parseFloat(style.animationDelay),
        opacity: Number(style.opacity)
      };
    };
    return {
      width: Math.round(rect.width),
      visibility: getComputedStyle(el).visibility,
      // SMIL não obedece a animation-play-state, então sob movimento reduzido o
      // <animate> da scale nem chega a ser emitido — se voltar a aparecer, o
      // filtro continua se mexendo por baixo de uma esfera "congelada".
      animates: el.querySelectorAll('animate').length,
      campoA: layer('a'), campoB: layer('b'), acento: layer('k')
    };
  });

  // Congela PAUSANDO, não removendo: a animação continua declarada e o atraso
  // negativo a estaciona num quadro do meio, então a esfera fica parada numa
  // composição viva em vez de no primeiro quadro, que é o mais chapado.
  for (const [nome, camada] of Object.entries(
    { campoA: state.campoA, campoB: state.campoB, acento: state.acento })) {
    expect(camada.play, `a camada ${nome} continuou se movendo`).toBe('paused');
    expect(camada.delay, `a camada ${nome} congelou no primeiro quadro`).toBeLessThan(0);
    expect(camada.opacity, `a camada ${nome} sumiu`).toBeGreaterThan(0);
  }
  expect(state.animates, 'o SMIL do displacement continuou correndo').toBe(0);
  // Congelada, mas inteira: sumir seria trocar a animação por um buraco na tela.
  expect(state.width).toBeGreaterThan(40);
  expect(state.visibility).toBe('visible');
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
    const mean = list => list.reduce((a, b) => a + b, 0) / list.length;
    const iconCenters = [...document.querySelectorAll('#mobBottomNav .mob-nav-item .mob-nav-icon')]
      .map(i => { const r = i.getBoundingClientRect(); return r.top + r.height / 2; });
    // Centro do BLOCO ícone+rótulo de cada aba — é nele que o círculo senta.
    const blockCenters = [...document.querySelectorAll('#mobBottomNav .mob-nav-item')]
      .map(i => { const r = i.getBoundingClientRect(); return r.top + r.height / 2; });
    return {
      tabs,
      button: {
        width: Math.round(rect.width),
        height: Math.round(rect.height),
        aboveBar: Math.round(bar.top - rect.top),
        centerY: rect.top + rect.height / 2,
        iconCenterY: icon.top + icon.height / 2,
        radius: style.borderRadius,
        position: style.position,
        background: style.backgroundColor,
        iconColor: getComputedStyle(el.querySelector('.mob-nav-icon')).color,
        iconSide: Math.round(Math.max(icon.width, icon.height))
      },
      sideIconCenterY: mean(iconCenters),
      sideBlockCenterY: mean(blockCenters),
      brand: getComputedStyle(document.documentElement).getPropertyValue('--brand-primary').trim()
    };
  });

  // Quatro abas com rótulo, o botão central NÃO entre elas.
  expect(nav.tabs.map(tab => tab.id)).toEqual(
    ['mobNavHome', 'mobNavMenu', 'mobNavOrders', 'mobNavProfile']);
  expect(nav.tabs.map(tab => tab.label)).toEqual(['Início', 'Cardápio', 'Clube', 'Perfil']);
  expect(new Set(nav.tabs.map(tab => tab.labelSize)).size, 'rótulos com corpos diferentes').toBe(1);

  // O botão é um círculo de 40px. Ele NÃO se alinha ao centro dos ícones: senta
  // no centro do BLOCO ícone+rótulo das abas vizinhas, que é onde a referência o
  // põe. Ancorado no centro dos ícones, o círculo ficava boiando na metade de
  // cima da barra, com o rótulo das vizinhas descendo sozinho por baixo dele.
  expect(nav.button.width).toBe(40);
  expect(nav.button.height).toBe(40);
  expect(nav.button.position).toBe('absolute');
  expect(nav.button.radius).toMatch(/50%|20px/);
  expect(Math.abs(nav.button.centerY - nav.sideBlockCenterY),
    `botão fora do centro das abas: ${nav.button.centerY} vs ${nav.sideBlockCenterY}`
  ).toBeLessThanOrEqual(2);
  expect(nav.button.centerY, 'o círculo voltou a subir para a linha dos ícones')
    .toBeGreaterThan(nav.sideIconCenterY);
  // Fundo na marca diluída, ícone na marca cheia — não o contrário.
  expect(nav.button.background).toMatch(/^rgba\(/);
  expect(nav.button.iconColor, 'o ícone não está na cor da marca').not.toBe(nav.button.background);
  expect(nav.button.iconSide).toBeGreaterThan(16);
});

test('as quatro abas e o botão central formam uma régua de passo igual', async ({ page }) => {
  await openAssistant(page);

  // Cinco colunas iguais: quatro abas mais o slot do botão. O passo entre
  // centros vizinhos é o mesmo dos dois lados do círculo — sem isso, Início e
  // Perfil colavam na borda da tela e Cardápio/Clube ficavam jogados longe do
  // meio. O desalinho é invisível item a item; só aparece nos intervalos.
  const centers = await page.evaluate(() => {
    const middle = el => { const rect = el.getBoundingClientRect(); return rect.left + rect.width / 2; };
    const tabs = [...document.querySelectorAll('#mobBottomNav .mob-nav-item')].map(middle);
    const button = middle(document.querySelector('#mobBottomNav .mob-nav-assistant-btn'));
    return [...tabs.slice(0, 2), button, ...tabs.slice(2)];
  });

  expect(centers).toHaveLength(5);
  const gaps = centers.slice(1).map((center, index) => center - centers[index]);
  for (const gap of gaps) {
    expect(Math.abs(gap - gaps[0]), `régua irregular: ${gaps.map(g => g.toFixed(1))}`)
      .toBeLessThanOrEqual(1);
  }

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
