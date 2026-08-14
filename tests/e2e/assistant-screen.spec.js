import { test, expect } from '@playwright/test';
import { mockApi, seedPickupSession, RESTAURANT_URL, PRODUCT_H2O } from './helpers.js';

// A tela do assistente no app do consumidor.
//
// O que estes testes travam é o CONTRATO, não o desenho: a marca sai da cor
// cadastrada pelo lojista (e só dela), é vetor nítido, tem os três estados que
// a tela usa, para sem sumir sob prefers-reduced-motion, e a abertura não volta
// a ser uma tela vazia. Nada aqui mede pixel de cor — a paleta pode mudar.

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

test('a marca é pintada com a cor do restaurante, sem cor fixa', async ({ page }) => {
  await openAssistant(page);
  await waitForIntro(page);

  // O balao recebe o gradiente do tenant, nao uma cor fixa da plataforma.
  const ler = () => page.locator('#assistantIntroMark').evaluate(el => {
    const paradas = [...el.querySelectorAll('linearGradient stop')]
      .map(s => getComputedStyle(s).stopColor);
    return {
      brand: getComputedStyle(el).getPropertyValue('--brand').trim(),
      temaBrand: getComputedStyle(document.documentElement).getPropertyValue('--brand-primary').trim(),
      paradas,
      fill: el.querySelector('.assistant-mark__bubble').getAttribute('fill')
    };
  });

  const laranja = await ler();
  await page.evaluate(() => window.RapidexTheme.applyBrandTheme('#2A2D7C'));
  const indigo = await ler();

  expect(laranja.brand.toUpperCase(), 'o componente não leu a cor do tema').toBe(laranja.temaBrand.toUpperCase());
  expect(indigo.brand.toUpperCase()).toBe('#2A2D7C');

  // O azul entra de fato nas duas paradas do desenho.
  expect(indigo.paradas, 'o gradiente perdeu uma parada').toHaveLength(2);
  for (let i = 0; i < 2; i++) {
    expect(indigo.paradas[i], `a parada ${i} não acompanhou o tenant`).not.toBe(laranja.paradas[i]);
  }
  expect(indigo.fill).toMatch(/^url\(#assistantMarkGrad\d+\)$/);
  expect(indigo.paradas[0], 'o gradiente virou cor chapada').not.toBe(indigo.paradas[1]);
});

test('cada marca tem seu próprio gradiente', async ({ page }) => {
  await openAssistant(page, { chatDelay: 3000 });
  await waitForIntro(page);
  await page.locator('.assistant-starter-card').first().click();
  await expect(page.locator('#assistantTypingMessage .assistant-mark')).toBeVisible();

  // IDs de <defs> são globais no documento. Com um id fixo, o segundo
  // <linearGradient> de mesmo nome é ignorado e as duas marcas passam a apontar
  // para o primeiro — que some junto com o elemento que o declarou, deixando o
  // glifo preto. Aqui há DUAS marcas na tela ao mesmo tempo.
  const marcas = await page.locator('#mobViewAssistant').evaluate(raiz => {
    const nos = [...raiz.querySelectorAll('.assistant-mark')];
    return nos.map(m => ({
      idGradiente: m.querySelector('linearGradient')?.id,
      fillBalao: m.querySelector('.assistant-mark__bubble')?.getAttribute('fill')
    }));
  });

  expect(marcas.length, 'o teste precisa de duas marcas na tela').toBeGreaterThanOrEqual(2);
  const ids = marcas.map(m => m.idGradiente);
  expect(new Set(ids).size, `ids de gradiente repetidos: ${ids}`).toBe(ids.length);
  // E cada glifo aponta para o SEU gradiente, não para o do vizinho.
  for (const m of marcas) {
    expect(m.fillBalao, `o balao nao usa o gradiente da propria instancia (${m.idGradiente})`)
      .toBe(`url(#${m.idGradiente})`);
  }
});

test('é vetor nítido: nenhum desfoque, filtro ou máscara', async ({ page }) => {
  await openAssistant(page);
  await waitForIntro(page);

  // A regressão que este teste existe para barrar. O que morava aqui era uma
  // nuvem de ruído fractal, e sete tentativas mostraram que desfoque sobre fundo
  // claro degenera em mancha pixelada no celular. A troca só vale enquanto
  // ninguém reintroduzir blur — em CSS ou em primitiva de filtro SVG.
  const desenho = await page.locator('#assistantIntroMark').evaluate(el => {
    const estilos = [el, ...el.querySelectorAll('*')].map(n => {
      const cs = getComputedStyle(n);
      return { filter: cs.filter, backdrop: cs.backdropFilter, mask: cs.maskImage };
    });
    return {
      estilos,
      tags: [...new Set([...el.querySelectorAll('*')].map(n => n.tagName))],
      // O glifo e geometria: balao, vapor e cloche; nada rasterizado.
      paths: el.querySelectorAll('path').length,
      viewBox: el.querySelector('svg').getAttribute('viewBox')
    };
  });

  for (const s of desenho.estilos) {
    expect(s.filter, 'voltou filtro CSS na marca').toMatch(/^none$/);
    expect(s.backdrop, 'voltou backdrop-filter na marca').toMatch(/^none$/);
    expect(s.mask, 'voltou máscara na marca').toMatch(/^none$/);
  }
  for (const proibida of ['FILTER', 'FETURBULENCE', 'FEDISPLACEMENTMAP', 'FEGAUSSIANBLUR',
    'FEFLOOD', 'FECOMPOSITE', 'MASK', 'IMG', 'VIDEO', 'CANVAS']) {
    expect(desenho.tags, `a marca voltou a depender de <${proibida.toLowerCase()}>`).not.toContain(proibida);
  }
  expect(desenho.paths, 'o simbolo perdeu parte da sua geometria').toBe(4);
  expect(desenho.viewBox).toBe('0 0 32 32');
});

test('o simbolo nao depende de fundo ou sombra CSS', async ({ page }) => {
  await openAssistant(page);
  await waitForIntro(page);

  // Toda a forma vive no SVG; raiz e glyph nao desenham uma segunda placa.
  const fundo = await page.locator('#assistantIntroMark').evaluate(el => {
    const invisivel = v => /^(rgba\(0, 0, 0, 0\)|transparent|none)$/.test(v);
    const olhar = (n, quem) => {
      const cs = getComputedStyle(n);
      const antes = getComputedStyle(n, '::before').content;
      const depois = getComputedStyle(n, '::after').content;
      return {
        quem,
        fundo: cs.backgroundColor, imagem: cs.backgroundImage,
        sombra: cs.boxShadow, borda: cs.borderStyle, raio: cs.borderRadius,
        pseudo: [antes, depois].filter(c => c !== 'none').length,
        limpo: invisivel(cs.backgroundColor) && invisivel(cs.backgroundImage)
          && invisivel(cs.boxShadow)
      };
    };
    return [olhar(el, 'raiz'), olhar(el.querySelector('.assistant-mark__glyph'), 'svg')];
  });

  for (const n of fundo) {
    expect(n.limpo, `voltou fundo/sombra CSS atras do glifo (${n.quem}): ${JSON.stringify(n)}`).toBe(true);
    expect(n.borda, `voltou contorno na marca (${n.quem})`).toMatch(/^none$/);
    expect(n.pseudo, `voltou um pseudo-elemento desenhando atrás do glifo (${n.quem})`).toBe(0);
  }
});

test('a marca encolhe em telas curtas sem perder proporcao', async ({ page }) => {
  await openAssistant(page);
  await waitForIntro(page);

  const medir = () => page.locator('#assistantIntroMark').evaluate(el => {
    const r = el.getBoundingClientRect();
    const g = el.querySelector('.assistant-mark__glyph').getBoundingClientRect();
    return {
      lado: [Math.round(r.width), Math.round(r.height)],
      glifo: [Math.round(g.width), Math.round(g.height)],
      desvio: [Math.abs((g.left + g.width / 2) - (r.left + r.width / 2)),
        Math.abs((g.top + g.height / 2) - (r.top + r.height / 2))]
    };
  });

  const padrao = await medir();
  expect(padrao.lado, 'a marca saiu do tamanho de abertura').toEqual([68, 68]);
  expect(padrao.glifo).toEqual([68, 68]);
  for (const d of padrao.desvio) expect(d, 'o simbolo saiu do centro').toBeLessThanOrEqual(1);

  // Tela curta: encolhe proporcionalmente, sem virar oval.
  await page.setViewportSize({ width: 390, height: 700 });
  const curta = await medir();
  expect(curta.lado, 'a marca não encolheu na tela curta').toEqual([54, 54]);
  expect(curta.lado[0]).toBe(curta.lado[1]);
  expect(curta.glifo[0] / curta.lado[0]).toBeCloseTo(padrao.glifo[0] / padrao.lado[0], 2);
});

test('o simbolo combina conversa, cardapio e atividade', async ({ page }) => {
  await openAssistant(page);
  await waitForIntro(page);

  const mark = page.locator('#assistantIntroMark');
  await expect(mark.locator('.assistant-mark__bubble')).toHaveCount(1);
  await expect(mark.locator('.assistant-mark__cloche')).toHaveCount(1);
  await expect(mark.locator('.assistant-mark__steam')).toHaveCount(2);
});
test('pensando e respondendo usam ritmos diferentes sem redimensionar a marca', async ({ page }) => {
  await openAssistant(page, { chatDelay: 2500 });
  await waitForIntro(page);

  const marca = page.locator('#assistantIntroMark');

  // O tamanho e medido pelo fator de escala da matriz, nao pela caixa visual:
  // translacao e rotacao podem mudar o rect sem redimensionar o desenho.
  const escalaBalao = () => marca.locator('.assistant-mark__bubble').evaluate(el => {
    const m = new DOMMatrixReadOnly(getComputedStyle(el).transform);
    return { x: Math.hypot(m.a, m.b), y: Math.hypot(m.c, m.d) };
  });

  // 1. O contrato do CSS, isolado: ligar "pensando" muda o ritmo e SÓ ele.
  //    A alternância é forçada na classe porque, numa conversa de verdade, a
  //    abertura é escondida assim que a primeira mensagem sai — a marca da
  //    abertura mediria zero e o teste passaria sem ter medido nada.
  await expect(marca).not.toHaveClass(/is-thinking/);
  await expect(marca.locator('.assistant-mark__bubble')).toBeVisible();

  await marca.evaluate(el => el.classList.add('is-thinking'));

  const animacao = await marca.locator('.assistant-mark__bubble')
    .evaluate(el => getComputedStyle(el).animationName);
  expect(animacao, 'o balao nao entrou no ritmo de pensando').toContain('assistant-mark-thinking');

  // Amostra ao longo do ciclo: um scale no keyframe só aparece no meio da
  // animação, então uma leitura única não pegaria.
  for (let i = 0; i < 6; i++) {
    const escala = await escalaBalao();
    expect(escala.x, 'a marca cresceu na horizontal ao pensar').toBeCloseTo(1, 2);
    expect(escala.y, 'a marca cresceu na vertical ao pensar').toBeCloseTo(1, 2);
    await page.waitForTimeout(220);
  }

  await marca.evaluate(el => el.classList.remove('is-thinking'));

  await marca.evaluate(el => el.classList.add('is-responding'));
  const respondingAnimation = await marca.locator('.assistant-mark__bubble')
    .evaluate(el => getComputedStyle(el).animationName);
  expect(respondingAnimation).toContain('assistant-mark-responding');
  await marca.evaluate(el => el.classList.remove('is-responding'));

  // 2. E o app move esse estado sozinho: parada -> pensando -> respondendo.
  await page.locator('.assistant-starter-card').first().click();
  await expect(marca).toHaveClass(/is-thinking/);
  await expect(marca).not.toHaveClass(/is-thinking/, { timeout: 15000 });
});

test('sob movimento reduzido a marca aparece parada e inteira', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openAssistant(page);
  await waitForIntro(page);

  const estado = await page.locator('#assistantIntroMark').evaluate(el => {
    const r = el.getBoundingClientRect();
    const steam = el.querySelector('.assistant-mark__steam');
    const bubble = el.querySelector('.assistant-mark__bubble');
    const cs = getComputedStyle(el), csteam = getComputedStyle(steam);
    return {
      largura: Math.round(r.width),
      visibilidade: cs.visibility,
      animacaoBalao: getComputedStyle(bubble).animationName,
      animacaoVapor: csteam.animationName,
      opacidadeVapor: Number(csteam.opacity),
      opacidadeBalao: Number(getComputedStyle(bubble).opacity)
    };
  });

  // Parada de verdade: sem animação declarada, não só pausada.
  expect(estado.animacaoBalao, 'o balao continuou se movendo').toBe('none');
  expect(estado.animacaoVapor, 'o vapor continuou se movendo').toBe('none');
  expect(estado.opacidadeVapor, 'o vapor ficou apagado').toBeGreaterThanOrEqual(0.5);
  expect(estado.opacidadeBalao).toBe(1);
  expect(estado.largura).toBe(68);
  expect(estado.visibilidade).toBe('visible');
});

test('o menu inferior tem quatro rótulos e um botão central destacado', async ({ page }) => {
  await openAssistant(page);

  // A marca vive só DENTRO da tela do assistente: aqui o que aparece é um
  // ícone de balão, e o botão não tem texto — o nome dele é o aria-label.
  await expect(page.locator('#mobBottomNav .assistant-mark')).toHaveCount(0);
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

  // Grade compacta: quatro ideias visiveis sem depender de descobrir uma rolagem.
  const geometry = await cards.evaluateAll(items => items.map(el =>
    ({ left: el.offsetLeft, top: el.offsetTop })));
  expect(new Set(geometry.map(item => item.top)).size, 'a grade nao formou duas linhas').toBe(2);
  expect(new Set(geometry.map(item => item.left)).size, 'a grade nao formou duas colunas').toBe(2);

  const firstCardSize = await cards.first().evaluate(el => {
    const rect = el.getBoundingClientRect();
    const style = getComputedStyle(el);
    return {
      width: rect.width,
      height: rect.height,
      minWidth: style.minWidth,
      radius: style.borderRadius,
      fontSize: style.fontSize,
      lineHeight: style.lineHeight
    };
  });
  expect(firstCardSize.height).toBe(62);
  expect(firstCardSize.minWidth).toBe('0px');
  expect(firstCardSize.radius).toBe('16px');
  expect(firstCardSize.fontSize).toBe('16px');
  expect(firstCardSize.lineHeight).toBe('24px');

  const leftSpacing = await page.evaluate(() => {
    const view = document.getElementById('mobViewAssistant').getBoundingClientRect();
    const first = document.querySelector('.assistant-starter-card').getBoundingClientRect();
    return first.left - view.left;
  });
  expect(leftSpacing).toBeCloseTo(20, 0);

  const rail = await page.locator('#assistantStarter').evaluate(el => ({
    overflowX: getComputedStyle(el).overflowX,
    columns: getComputedStyle(el).gridTemplateColumns,
    background: getComputedStyle(el).backgroundColor,
    borderWidth: getComputedStyle(el).borderTopWidth,
    shadow: getComputedStyle(el).boxShadow
  }));
  expect(rail.overflowX).toBe('visible');
  expect(rail.columns.split(' ')).toHaveLength(2);
  expect(rail.background).toBe('rgba(0, 0, 0, 0)');
  expect(rail.borderWidth).toBe('0px');
  expect(rail.shadow).toBe('none');

  // Frases podem ocupar duas linhas, mas nunca sao cortadas com reticencias.
  const label = await page.locator('.assistant-starter-card-label').first().evaluate(el => {
    const style = getComputedStyle(el);
    return { wrap: style.whiteSpace, ellipsis: style.textOverflow, lines: el.getClientRects().length };
  });
  expect(label.wrap).toBe('normal');
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
  await expect(skeleton.locator('.assistant-mark--mini')).toHaveClass(/is-thinking/);
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

test('a abertura ocupa a tela com conteudo util, sem vao morto', async ({ page }) => {
  await openAssistant(page);
  await waitForIntro(page);

  const layout = await page.evaluate(() => {
    const box = sel => {
      const rect = document.querySelector(sel).getBoundingClientRect();
      return { top: rect.top, bottom: rect.bottom };
    };
    const body = box('#assistantAiBody');
    const top = box('.assistant-intro-top');
    const starter = box('.assistant-starter-zone');
    const input = box('.assistant-ai-input-bar');
    return {
      acimaDoBloco: top.top - body.top,
      entreBlocoESugestoes: starter.top - top.bottom,
      entreSugestoesEcampo: input.top - starter.bottom
    };
  });

  expect(layout.acimaDoBloco, 'o cartao de abertura descolou do topo').toBeLessThanOrEqual(24);
  expect(layout.entreBlocoESugestoes, 'as sugestoes descolaram do cartao').toBeLessThanOrEqual(32);
  expect(layout.entreSugestoesEcampo, 'voltou o grande vazio antes do campo').toBeLessThanOrEqual(120);
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
