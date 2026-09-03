import { test, expect } from '@playwright/test';
import { mockApi, MENU, SLUG, menuForBranch, esperarAppPronto } from './helpers.js';

// Fase 4, bloco A: a trava do white-label.
//
// Antes desta fase o tema NÃO chegava na interface — ~250 cores de marca
// chumbadas no CSS (86 delas sob !important) venciam as custom properties que
// applyTheme() escrevia. Na prática, qualquer restaurante novo nascia
// parcialmente laranja do Júnior da Picanha, o que travava comercialmente o
// cadastro do segundo restaurante.
//
// Estes testes falham se essa regressão voltar.

const PILOT_PRIMARY = 'rgb(217, 92, 4)'; // #D95C04, o que o piloto cadastrou
const BLUE = '#1B4FD8';

// Superfícies que o lojista reconhece como "a minha marca na tela" — uma de
// cada área citada no escopo da fase.
const BRAND_SURFACES = [
  ['CTA da home', 'button.home-order-cta', 'backgroundColor'],
  ['botão da sacola', '#cartStickyBtn', 'backgroundColor'],
  ['CTA do carrinho', 'button.cart-cta-btn', 'backgroundColor'],
  ['botão primário', 'button.btn-primary', 'backgroundColor'],
  ['ícone da aba ativa', '.mob-nav-item.active .nav-icon svg', 'color'],
  ['aba do carrinho ativa', 'button.cart-tab.active', 'color'],
  ['preço do produto', 'div.pm-price', 'color'],
  ['controle de quantidade', 'button.qty-btn', 'color'],
  ['chip de benefício', 'button.cart-benefit-action', 'color'],
  ['cupom', 'button.coupon-detail-use', 'backgroundColor'],
  ['perfil', 'button.profile-login-btn', 'backgroundColor'],
  ['ação secundária do login', 'button.login-secondary', 'color']
];

// applyTheme() reescreve --brand-primary depois que os botões já estão pintados,
// e duas superfícies de marca animam esse repaint (.btn-primary tem `transition:.25s`,
// que é `all`; .cart-cta-btn tem `transition:background .2s`). Amostrar a cor
// computada durante a interpolação devolve um valor intermediário — foi o que
// deixou este spec verde no Windows e vermelho no runner do CI, só por timing.
//
// Estes testes provam a cor FINAL pintada, não a animação até ela, então zeramos
// as transições. Injetado DEPOIS do load de propósito: como <style> no fim do
// <head>, vence por ordem de documento as regras de transição do app. Aplicar
// `transition:none` no meio de uma transição já em curso a cancela e faz o estilo
// computado saltar para o valor final, então isto vale mesmo se o repaint já começou.
async function freezeTransitions(page) {
  await page.addStyleTag({
    content: '*,*::before,*::after{transition:none!important;animation:none!important}'
  });
}

/** Boota o app com a cor de marca pedida e devolve a página pronta. */
async function bootWithPrimary(page, primaryColor) {
  await mockApi(page);
  if (primaryColor) {
    const menu = JSON.parse(JSON.stringify(MENU));
    menu.restaurant.primary_color = primaryColor;
    // Registrada DEPOIS de mockApi: o Playwright consulta a rota mais recente
    // primeiro, então é esta que responde /menu.
    await page.route('**/api.pederapidex.com/**', async (route) => {
      if (/\/menu(\?|$)/.test(route.request().url())) {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(menu)
        });
      }
      return route.fallback();
    });
  }
  await page.goto(`/restaurant.html?slug=${SLUG}`);
  await esperarAppPronto(page);
  await freezeTransitions(page);
  return page;
}

const brandPrimary = (page) =>
  page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--brand-primary').trim());

/** Cor efetiva de cada superfície de marca. */
async function surfaceColors(page) {
  return page.evaluate((surfaces) => {
    const out = {};
    for (const [label, selector, prop] of surfaces) {
      const el = document.querySelector(selector);
      out[label] = el ? getComputedStyle(el)[prop] : null;
    }
    return out;
  }, BRAND_SURFACES);
}

test('o piloto renderiza a cor que cadastrou, não a cor chumbada no CSS', async ({ page }) => {
  await bootWithPrimary(page, null);

  expect(await brandPrimary(page)).toBe('#D95C04');

  const colors = await surfaceColors(page);
  for (const [label] of BRAND_SURFACES) {
    expect(colors[label], `${label} não renderizou`).not.toBeNull();
    expect(colors[label], label).toBe(PILOT_PRIMARY);
  }
});

test('trocar a cor do tenant repinta a interface inteira', async ({ page }) => {
  await bootWithPrimary(page, BLUE);

  expect(await brandPrimary(page)).toBe(BLUE);

  const colors = await surfaceColors(page);
  for (const [label] of BRAND_SURFACES) {
    expect(colors[label], `${label} não renderizou`).not.toBeNull();
    // A prova: nenhuma superfície de marca ficou com a cor do piloto.
    expect(colors[label], `${label} continuou com a cor do piloto`).not.toBe(PILOT_PRIMARY);
    expect(colors[label], label).toBe('rgb(27, 79, 216)');
  }
});

test('loader de três pontos usa a cor sólida e as medidas do white label', async ({ page }) => {
  await bootWithPrimary(page, BLUE);
  await page.evaluate(() => document.body.classList.add('app-booting'));

  const loader = page.locator('.app-loader-dots');
  await expect(loader).toBeVisible();

  const appearance = await loader.evaluate(element => {
    const rect = element.getBoundingClientRect();
    return {
      width: Math.round(rect.width * 10) / 10,
      height: Math.round(rect.height * 10) / 10,
      dots: [...element.children].map(dot => {
        const style = getComputedStyle(dot);
        return {
          width: Math.round(parseFloat(style.width) * 10) / 10,
          height: Math.round(parseFloat(style.height) * 10) / 10,
          color: style.backgroundColor,
          image: style.backgroundImage,
          opacity: style.opacity,
          animation: style.animationName
        };
      })
    };
  });

  expect(appearance).toEqual({
    width: 60,
    height: 13.3,
    dots: Array.from({ length: 3 }, () => ({
      width: 13.3,
      height: 13.3,
      color: 'rgb(27, 79, 216)',
      image: 'none',
      opacity: '1',
      animation: 'appLoaderDotPulse'
    }))
  });
});

// O contrário do que este teste pedia antes: ele exigia que o loader
// completasse uma volta inteira dos pontinhos (900ms) antes de revelar o app.
// Esse piso era espera inventada e saiu. O que passa a ser garantido é que
// NADA segura a tela depois de os dados chegarem — nem relógio, nem imagem.
test('a tela aparece assim que os dados chegam, sem piso de tempo nem espera por imagem', async ({ page }) => {
  await mockApi(page);
  // As imagens da Home nunca respondem: se o boot ainda dependesse delas,
  // a tela ficaria presa no loader até o timeout.
  await page.route('**/storage/v1/**', () => { /* pendente de propósito */ });

  let releaseMenu;
  const menuGate = new Promise(resolve => { releaseMenu = resolve; });
  await page.route('**/restaurants/*/menu**', async (route) => {
    await menuGate;
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(menuForBranch(MENU.branch_id))
    });
  });

  // O RELOGIO DA PAGINA FICA PARADO o teste inteiro.
  //
  // Antes daqui havia `expect(Date.now() - releasedAt).toBeLessThan(900)`, e
  // ele nao media o app: media a maquina. Passava sozinho e caia com a suite em
  // paralelo (1200ms medidos contra o teto de 900, na rodada de 29/08/2026), e o
  // `retries: 1` do CI escondia — um teste que so falha quando a maquina esta
  // ocupada nao esta afirmando nada sobre o codigo.
  //
  // Congelar o relogio troca "foi rapido o bastante" por "nao depende de tempo
  // nenhum", que e literalmente o que o titulo do teste promete. Com Date,
  // setTimeout, setInterval e rAF parados, um piso de tempo que volte a existir
  // NUNCA elapsa: o teste falha por timeout, em qualquer maquina, sempre.
  //
  // `install()` SOZINHO NAO BASTA — e foi o primeiro erro desta correcao. Ele
  // troca os timers pelos falsos, mas o relogio continua andando: com um piso de
  // 900ms injetado de proposito no boot, a versao com so `install()` passou.
  // Um teste-fantasma no lugar do flaky teria sido troca ruim. Quem para o
  // relogio e `pauseAt`.
  // O INSTANTE DA PAUSA E DEPOIS DO DA INSTALACAO, e a diferenca nao e estilo.
  //
  // `pauseAt` SO ANDA PARA A FRENTE: uma data anterior a atual do relogio e
  // erro ("Cannot fast-forward to the past"). E entre `install()` e
  // `pauseAt()` o relogio falso AINDA ANDA — sao duas idas ao browser pelo
  // protocolo, e o tempo real que passa entre elas avanca a hora da pagina.
  //
  // Com os dois recebendo o MESMO instante, o teste vivia de a diferenca ser
  // zero, o que depende da maquina estar livre. Em 02/09/2026 ele caiu numa
  // suite completa com exatamente essa mensagem, e o experimento confirmou:
  // com 300ms injetados entre as duas chamadas, o braco antigo falha sempre e
  // este passa sempre.
  //
  // O minuto de folga e arbitrario e nao e medido por ninguem — ele so precisa
  // ser maior que qualquer atraso de protocolo. Nada acontece nesse salto: as
  // duas chamadas rodam ANTES do `goto`, entao nao ha temporizador da pagina
  // para disparar no caminho.
  const INSTANTE = new Date('2026-08-29T12:00:00Z');
  await page.clock.install({ time: INSTANTE });
  await page.clock.pauseAt(new Date(INSTANTE.getTime() + 60_000));

  // `commit` porque as imagens ficam pendentes de propósito: o evento `load`
  // da página nunca chegaria, e não é dele que este teste trata.
  await page.goto(`/restaurant.html?slug=${SLUG}`, { waitUntil: 'commit' });
  await expect(page.locator('body')).toHaveClass(/app-booting/);

  releaseMenu();

  // toHaveClass reavalia PELO PROTOCOLO, de fora da pagina — funciona com o
  // relogio parado. `waitForFunction`, que fazia polling por rAF DENTRO da
  // pagina, nao funcionaria: o rAF tambem esta congelado.
  //
  // O teto explicito repara uma DESIGUALDADE que a escolha da ferramenta criou
  // sem querer: toda outra espera de boot da suite usa `page.waitForFunction`,
  // cujo orcamento e o do teste inteiro (30 s). Esta precisou usar `expect` por
  // causa do relogio parado, e com isso herdou o padrao de 5 s — um quinto do
  // que as irmas tem. Sob carga o boot desta pagina passou de 5 s e o teste
  // reprovou um app correto (suite de 31/08/2026: `Received string:
  // "app-booting"`, 6 tentativas).
  //
  // E o numero NAO enfraquece o que o teste prova: o defeito que ele guarda e
  // um PISO DE TEMPO no boot, e com o relogio congelado um piso de tempo nunca
  // elapsa. Ele falha por estouro de espera em qualquer maquina, com 5 s ou com
  // 15 — a diferenca e so quanto tempo uma maquina lenta tem para nao ser
  // acusada no lugar do codigo.
  await expect(page.locator('body')).not.toHaveClass(/app-booting/, { timeout: 15_000 });
});

test('nenhuma cor de marca chumbada sobrevive num tenant azul', async ({ page }) => {
  await bootWithPrimary(page, BLUE);

  // O que continua legitimamente laranja/amarelo num tenant azul, e por quê.
  // Qualquer coisa FORA desta lista é cor de marca chumbada voltando.
  const ALLOWED = [
    '.pay-brand', // bandeiras de cartão (Visa, Master, Elo): marca de terceiro
    '.g-yellow', // "powered by Google" do autocomplete de endereço
    '.coupon-art', // número do desconto, acento amarelo fixo do cupom
    '.highlight-banner' // superfície bege neutra do banner sem imagem
  ];

  const leaks = await page.evaluate((allowed) => {
    const hue = (value) => {
      const m = String(value).match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([0-9.]+))?\)/);
      if (!m) return null;
      const [r, g, b, a] = [+m[1] / 255, +m[2] / 255, +m[3] / 255, m[4] === undefined ? 1 : +m[4]];
      if (a < 0.06) return null;
      const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
      const l = (max + min) / 2;
      if (!d) return null;
      const s = d / (1 - Math.abs(2 * l - 1));
      let h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
      return { h: (h * 60 + 360) % 360, s: s * 100, l: l * 100 };
    };
    const isOrange = (value) => {
      const c = hue(value);
      return !!c && c.h >= 8 && c.h <= 50 && c.s >= 25 && c.l <= 97;
    };
    const describe = (el) => el.tagName.toLowerCase() +
      (el.id ? '#' + el.id : '') +
      (typeof el.className === 'string' && el.className.trim()
        ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.')
        : '');

    const out = [];
    for (const el of document.querySelectorAll('*')) {
      if (allowed.some(sel => el.closest(sel))) continue;
      const cs = getComputedStyle(el);
      for (const prop of ['color', 'backgroundColor', 'fill', 'stroke']) {
        if (isOrange(cs[prop])) out.push(`${describe(el)} { ${prop}: ${cs[prop]} }`);
      }
      if (cs.backgroundImage && cs.backgroundImage !== 'none') {
        for (const m of cs.backgroundImage.matchAll(/rgba?\([^)]+\)/g)) {
          if (isOrange(m[0])) out.push(`${describe(el)} { background-image: ${m[0]} }`);
        }
      }
    }
    return [...new Set(out)];
  }, ALLOWED);

  expect(leaks, `cor de marca chumbada encontrada:\n${leaks.join('\n')}`).toEqual([]);
});

test('a tinta do rótulo sobre a marca é calculada, não fixa em branco', async ({ page }) => {
  // Marca clara: com #fff fixo o rótulo do botão seria ilegível.
  await bootWithPrimary(page, '#FFD400');

  const { onBrand, ctaColor } = await page.evaluate(() => ({
    onBrand: getComputedStyle(document.documentElement).getPropertyValue('--brand-on').trim(),
    ctaColor: getComputedStyle(document.querySelector('button.home-order-cta')).color
  }));

  expect(onBrand).toBe('#1A1A1A');
  expect(ctaColor).toBe('rgb(26, 26, 26)');
});

// A marca do assistente era um balão com uma cloche dentro, pintada por um
// <linearGradient> de SVG. Virou uma esfera pintada por `background-image` do
// CSS.
//
// A varredura de cor chumbada acima NÃO a cobre, e isso foi medido, não
// suposto: com a esfera chumbada no laranja do piloto, o teste do tenant azul
// passou verde. A razão é que ele nunca abre a tela do assistente, e
// `buildAssistantView()` só injeta a marca no DOM na primeira navegação para
// ela — `#assistantIntroMark` não existe enquanto ninguém entra. Vale para tudo
// o que mora nessa tela, não só para a esfera.
//
// Então este teste é a ÚNICA guarda da cor da esfera, e cobra o positivo: ela
// tem de SEGUIR a cor cadastrada, nas duas pontas do espectro. Chumbar cinza
// aqui também passaria despercebido pelo teste acima — cinza não é laranja.
test('a esfera do assistente nasce da cor do lojista, nas duas pontas', async ({ page }) => {
  const esferaDe = async (primaria) => {
    await bootWithPrimary(page, primaria);
    await page.evaluate(() => window.RapidexActions.resolve('mobNavAssistant')());
    await expect(page.locator('#assistantIntroMark')).toBeVisible();
    // As animações da esfera escalam o corpo; `freezeTransitions` as desliga
    // para que a leitura seja da cor pintada, não de um quadro no meio do
    // ritmo. Mesma razão pela qual os testes acima a chamam.
    await freezeTransitions(page);
    return page.locator('#assistantIntroMark .assistant-mark__orb')
      .evaluate(el => getComputedStyle(el).backgroundImage);
  };

  // Matiz do primeiro `rgb()` que aparece no degradê da esfera. As duas paradas
  // vêm de markInkColors: a primária escurecida até 3:1 no branco e ela mesma um
  // degrau abaixo — então o MATIZ é o do lojista nas duas, e é ele que este
  // teste segue. A luminosidade não serve de prova: ela é justamente o que a
  // guarda de contraste tem liberdade para mexer.
  const matiz = (backgroundImage) => {
    const paradas = [...String(backgroundImage).matchAll(/rgba?\((\d+),\s*(\d+),\s*(\d+)/g)]
      // As duas primeiras camadas são o brilho e a sombra do volume (branco e
      // preto): cinza não tem matiz e é descartado aqui, sobra a cor da marca.
      .map(m => [+m[1] / 255, +m[2] / 255, +m[3] / 255])
      .filter(([r, g, b]) => Math.max(r, g, b) - Math.min(r, g, b) > 0.02);
    expect(paradas.length, `a esfera não tem cor nenhuma: ${backgroundImage}`).toBeGreaterThan(0);
    const [r, g, b] = paradas[0];
    const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
    const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    return (h * 60 + 360) % 360;
  };

  const laranja = matiz(await esferaDe('#D95C04'));
  const azul = matiz(await esferaDe(BLUE));

  // ~26° para o laranja do piloto, ~223° para o azul. A folga de 25° é a
  // liberdade que markInkColors tem para escurecer sem virar outra cor.
  expect(laranja, `esfera laranja saiu em ${laranja}°`).toBeGreaterThan(1);
  expect(laranja).toBeLessThan(51);
  expect(azul, `esfera azul saiu em ${azul}°`).toBeGreaterThan(198);
  expect(azul).toBeLessThan(248);
});
