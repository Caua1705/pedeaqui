import { test, expect } from '@playwright/test';
import { mockApi, seedPickupSession, RESTAURANT_URL, PRODUCT_H2O, esperarAppPronto } from './helpers.js';

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

async function openAssistant(page, { chatDelay = 0, viewport, answer = CHAT_ANSWER } = {}) {
  await page.setViewportSize(viewport || { width: 390, height: 844 });
  await mockApi(page);
  await page.route('**/chat', async route => {
    if (chatDelay) await new Promise(resolve => setTimeout(resolve, chatDelay));
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(answer)
    });
  });
  await seedPickupSession(page);
  await page.goto(RESTAURANT_URL);
  await esperarAppPronto(page);
  await page.evaluate(() => window.RapidexActions.resolve('mobNavAssistant')());
  await expect(page.locator('#mobViewAssistant .assistant-hdr')).toBeVisible();
}

/** Espera a abertura terminar de se revelar (pergunta digitada + sugestões). */
async function waitForIntro(page) {
  await expect(page.locator('#assistantStarter')).toHaveClass(/is-ready/);
}

// Lê as paradas de MARCA do degradê da esfera. O corpo tem três camadas: o
// brilho branco e a sombra preta que dão o volume, sem matiz nenhum, e o
// degradê linear que carrega a cor do lojista. Filtrar por saturação separa os
// dois grupos sem depender da ordem em que o navegador serializa as camadas.
const paradasDeMarca = (backgroundImage) =>
  [...String(backgroundImage).matchAll(/rgba?\((\d+),\s*(\d+),\s*(\d+)/g)]
    .map(m => [+m[1], +m[2], +m[3]])
    .filter(([r, g, b]) => Math.max(r, g, b) - Math.min(r, g, b) > 6)
    .map(([r, g, b]) => `rgb(${r}, ${g}, ${b})`);

test('a marca é pintada com a cor do restaurante, sem cor fixa', async ({ page }) => {
  await openAssistant(page);
  await waitForIntro(page);

  // A esfera recebe as tintas do tenant, não uma cor fixa da plataforma. As
  // duas paradas são markInkColors (brand-theme.js): a primária escurecida até
  // 3:1 contra o branco desta tela, e ela mesma um degrau de luminosidade
  // abaixo — a segunda é DERIVADA da primeira, nunca escrita no CSS.
  const ler = () => page.locator('#assistantIntroMark').evaluate(el => ({
    brand: getComputedStyle(el).getPropertyValue('--brand').trim(),
    temaBrand: getComputedStyle(document.documentElement).getPropertyValue('--brand-primary').trim(),
    fundo: getComputedStyle(el.querySelector('.assistant-mark__orb')).backgroundImage
  }));

  const laranja = await ler();
  await page.evaluate(() => window.RapidexTheme.applyBrandTheme('#2A2D7C'));
  const indigo = await ler();

  expect(laranja.brand.toUpperCase(), 'o componente não leu a cor do tema').toBe(laranja.temaBrand.toUpperCase());
  expect(indigo.brand.toUpperCase()).toBe('#2A2D7C');

  const antes = paradasDeMarca(laranja.fundo);
  const depois = paradasDeMarca(indigo.fundo);

  expect(antes, 'o degradê da esfera perdeu uma parada').toHaveLength(2);
  expect(depois).toHaveLength(2);
  for (let i = 0; i < 2; i++) {
    expect(depois[i], `a parada ${i} não acompanhou o tenant`).not.toBe(antes[i]);
  }
  expect(depois[0], 'o degradê virou cor chapada').not.toBe(depois[1]);
});

test('a marca da abertura pinta e o indicador antigo usa o bloco animado', async ({ page }) => {
  await openAssistant(page, { chatDelay: 3000 });
  await waitForIntro(page);
  await page.locator('.assistant-starter-card').first().click();
  await expect(page.locator('#assistantTypingMessage .assistant-thinking--dark')).toBeVisible();

  // Este teste nasceu de um defeito de SVG: ids de <defs> são GLOBAIS no
  // documento, então com duas marcas na tela ao mesmo tempo (a da abertura e a
  // do esqueleto de digitação) o segundo <linearGradient> de mesmo nome era
  // ignorado e as duas apontavam para o primeiro — que some junto com o
  // elemento que o declarou, deixando o glifo preto. Era só por isso que o
  // arquivo mantinha um contador de instância para a marca.
  //
  // Com o degradê no CSS o modo de falha deixou de existir: não há id nenhum
  // para colidir. O teste fica porque a PERGUNTA continua válida — as duas
  // marcas pintam ao mesmo tempo? — e porque ele barra a volta do desenho por
  // <defs>, que traria o defeito de volta junto.
  const marcas = await page.locator('#mobViewAssistant').evaluate(raiz => {
    const nos = [...raiz.querySelectorAll('.assistant-mark')];
    return {
      fundos: nos.map(m => getComputedStyle(m.querySelector('.assistant-mark__orb')).backgroundImage),
      gradientesDeSvg: raiz.querySelectorAll('linearGradient, radialGradient').length
    };
  });

  expect(marcas.fundos.length, 'a marca da abertura desapareceu').toBeGreaterThanOrEqual(1);
  expect(marcas.gradientesDeSvg, 'o degradê voltou para <defs>, e com ele a colisão de id').toBe(0);
  for (const fundo of marcas.fundos) {
    expect(paradasDeMarca(fundo), 'uma das marcas ficou sem a cor do lojista').toHaveLength(2);
  }
  // As duas leem os MESMOS tokens, então pintam igual — e era exatamente isso
  // que a colisão de id quebrava.
  expect(new Set(marcas.fundos.map(f => paradasDeMarca(f).join('|'))).size).toBe(1);
  await expect(page.locator('#assistantTypingMessage .assistant-thinking-dots--dark span')).toHaveCount(49);
});

test('é vetor nítido: nenhum desfoque, filtro ou máscara', async ({ page }) => {
  await openAssistant(page);
  await waitForIntro(page);

  // A regressão que este teste existe para barrar. O que morava aqui antes do
  // SVG era uma nuvem de ruído fractal, e sete tentativas mostraram que
  // desfoque sobre fundo claro degenera em mancha pixelada no celular. O
  // desenho mudou duas vezes desde então; a proibição não. O volume da esfera
  // vem de degradê radial, que o navegador resolve sem borrar nada.
  const desenho = await page.locator('#assistantIntroMark').evaluate(el => {
    const estilos = [el, ...el.querySelectorAll('*')].map(n => {
      const cs = getComputedStyle(n);
      return { filter: cs.filter, backdrop: cs.backdropFilter, mask: cs.maskImage };
    });
    return {
      estilos,
      tags: [...new Set([...el.querySelectorAll('*')].map(n => n.tagName))],
      camadas: el.querySelectorAll('.assistant-mark__orb, .assistant-mark__halo').length
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
  expect(desenho.camadas, 'a esfera perdeu uma das duas camadas (sopro e corpo)').toBe(2);
});

test('a esfera é redonda e desenhada pelo CSS, sem uma segunda placa atrás', async ({ page }) => {
  await openAssistant(page);
  await waitForIntro(page);

  // Este contrato INVERTEU com a troca do desenho, e é de propósito. Enquanto a
  // marca era SVG, fundo e sombra CSS eram proibidos: qualquer um dos dois seria
  // uma segunda placa desenhada atrás do glifo. Agora a forma É o fundo — o
  // degradê pinta a esfera e a sombra fecha o volume. O que continua proibido é
  // a placa a mais: a caixa não desenha nada, e nenhum pseudo-elemento entra.
  const camadas = await page.locator('#assistantIntroMark').evaluate(el => {
    const invisivel = v => /^(rgba\(0, 0, 0, 0\)|transparent|none)$/.test(v);
    const olhar = (n, quem) => {
      const cs = getComputedStyle(n);
      return {
        quem,
        raio: cs.borderRadius,
        temImagem: !invisivel(cs.backgroundImage),
        limpo: invisivel(cs.backgroundColor) && invisivel(cs.backgroundImage) && invisivel(cs.boxShadow),
        borda: cs.borderStyle,
        pseudo: [getComputedStyle(n, '::before').content, getComputedStyle(n, '::after').content]
          .filter(c => c !== 'none').length
      };
    };
    return {
      raiz: olhar(el, 'raiz'),
      corpo: olhar(el.querySelector('.assistant-mark__orb'), 'corpo'),
      halo: olhar(el.querySelector('.assistant-mark__halo'), 'halo'),
      svgs: el.querySelectorAll('svg').length
    };
  });

  expect(camadas.svgs, 'o desenho voltou para dentro de um <svg>').toBe(0);
  expect(camadas.raiz.limpo, `a caixa da marca voltou a desenhar: ${JSON.stringify(camadas.raiz)}`).toBe(true);
  for (const n of [camadas.raiz, camadas.corpo, camadas.halo]) {
    expect(n.borda, `voltou contorno na marca (${n.quem})`).toMatch(/^none$/);
    expect(n.pseudo, `voltou um pseudo-elemento desenhando atrás da esfera (${n.quem})`).toBe(0);
  }
  // Esfera, não quadrado de cantos arredondados: 50% nas duas camadas.
  for (const n of [camadas.corpo, camadas.halo]) {
    expect(n.raio, `a ${n.quem} deixou de ser redonda`).toMatch(/^50%/);
    expect(n.temImagem, `a ${n.quem} ficou sem degradê`).toBe(true);
  }
});

test('a marca encolhe em telas curtas sem perder proporcao', async ({ page }) => {
  await openAssistant(page);
  await waitForIntro(page);

  // O corpo é medido por offsetWidth/offsetHeight, que é a caixa de LAYOUT, e
  // não por getBoundingClientRect, que inclui o transform: a esfera respira em
  // repouso (scale até 1.02), então o rect visual dela mede 69 num quadro e 68
  // no outro. Foi assim que a primeira versão deste teste falhou — e a
  // diferença importa, porque o que este teste guarda é a PROPORÇÃO da marca,
  // que é da caixa, não a amplitude do ritmo, que é medida no teste dos ritmos.
  const medir = () => page.locator('#assistantIntroMark').evaluate(el => {
    const r = el.getBoundingClientRect();
    const corpo = el.querySelector('.assistant-mark__orb');
    const g = corpo.getBoundingClientRect();
    return {
      lado: [Math.round(r.width), Math.round(r.height)],
      corpo: [corpo.offsetWidth, corpo.offsetHeight],
      desvio: [Math.abs((g.left + g.width / 2) - (r.left + r.width / 2)),
        Math.abs((g.top + g.height / 2) - (r.top + r.height / 2))]
    };
  });

  const padrao = await medir();
  expect(padrao.lado, 'a marca saiu do tamanho de abertura').toEqual([68, 68]);
  expect(padrao.corpo).toEqual([68, 68]);
  for (const d of padrao.desvio) expect(d, 'a esfera saiu do centro').toBeLessThanOrEqual(1);

  // Tela curta: encolhe proporcionalmente, sem virar oval.
  await page.setViewportSize({ width: 390, height: 700 });
  const curta = await medir();
  expect(curta.lado, 'a marca não encolheu na tela curta').toEqual([54, 54]);
  expect(curta.lado[0]).toBe(curta.lado[1]);
  expect(curta.corpo[0] / curta.lado[0]).toBeCloseTo(padrao.corpo[0] / padrao.lado[0], 2);
});

test('o simbolo é uma esfera, e nada do desenho antigo sobrou', async ({ page }) => {
  await openAssistant(page);
  await waitForIntro(page);

  const mark = page.locator('#assistantIntroMark');
  await expect(mark.locator('.assistant-mark__orb')).toHaveCount(1);
  await expect(mark.locator('.assistant-mark__halo')).toHaveCount(1);
  // O balão de conversa com a cloche dentro lia como SINO em 54px, e sino é
  // notificação, não assistente. Se qualquer uma destas voltar, a troca foi
  // desfeita pela metade e a tela fica com dois símbolos para a mesma coisa.
  for (const morta of ['bubble', 'cloche', 'steam', 'service', 'glyph']) {
    await expect(mark.locator(`.assistant-mark__${morta}`),
      `o desenho antigo voltou: .assistant-mark__${morta}`).toHaveCount(0);
  }
});

test('parado, pensando e respondendo usam ritmos diferentes sem mexer na caixa', async ({ page }) => {
  await openAssistant(page, { chatDelay: 2500 });
  await waitForIntro(page);

  const marca = page.locator('#assistantIntroMark');
  const corpo = marca.locator('.assistant-mark__orb');

  // A escala é medida pelo fator da matriz, não pela caixa visual: translação e
  // rotação mudam o rect sem redimensionar o desenho.
  const escalaCorpo = () => corpo.evaluate(el => {
    const m = new DOMMatrixReadOnly(getComputedStyle(el).transform);
    return Math.hypot(m.a, m.b);
  });
  const ritmo = () => corpo.evaluate(el => {
    const cs = getComputedStyle(el);
    return { nome: cs.animationName, duracao: parseFloat(cs.animationDuration) };
  });
  const caixa = () => marca.evaluate(el => {
    const r = el.getBoundingClientRect();
    return [Math.round(r.width), Math.round(r.height)];
  });

  // 1. O contrato do CSS, isolado. A alternância é forçada na classe porque,
  //    numa conversa de verdade, a abertura é escondida assim que a primeira
  //    mensagem sai — a marca da abertura mediria zero e o teste passaria sem
  //    ter medido nada.
  await expect(marca).not.toHaveClass(/is-thinking/);
  await expect(corpo).toBeVisible();

  const parado = await ritmo();
  expect(parado.nome, 'a esfera parou de respirar em repouso').toContain('assistant-mark-idle');

  await marca.evaluate(el => el.classList.add('is-thinking'));
  const pensando = await ritmo();
  expect(pensando.nome, 'a esfera não entrou no ritmo de pensando').toContain('assistant-mark-thinking');

  await marca.evaluate(el => el.classList.replace('is-thinking', 'is-responding'));
  const respondendo = await ritmo();
  expect(respondendo.nome).toContain('assistant-mark-responding');

  // Parado é o mais lento de todos; entre os ativos, pensar é o lento e
  // responder é o rápido — a diferença entre "estou procurando" e "estou te
  // respondendo agora".
  expect(parado.duracao).toBeGreaterThan(pensando.duracao);
  expect(pensando.duracao).toBeGreaterThan(respondendo.duracao);

  // 2. A esfera CRESCE E ENCOLHE de verdade, e a caixa não se mexe. É o oposto
  //    do desenho antigo, que só andava em translateY e tinha `scale` proibido:
  //    lá quem escalava era o <svg>, que OCUPA a caixa. Aqui quem escala é um
  //    filho absoluto dentro de uma caixa de tamanho fixo, então a esfera cresce
  //    sem empurrar o título nem a linha de digitação.
  const caixaAntes = await caixa();
  const escalas = [];
  for (let i = 0; i < 8; i++) {
    escalas.push(await escalaCorpo());
    expect(await caixa(), 'a caixa da marca mudou de tamanho durante o ritmo').toEqual(caixaAntes);
    await page.waitForTimeout(150);
  }
  const amplitude = Math.max(...escalas) - Math.min(...escalas);
  expect(amplitude, `a esfera não cresceu nem encolheu ao responder: ${escalas.join(', ')}`)
    .toBeGreaterThan(0.02);

  await marca.evaluate(el => el.classList.remove('is-responding'));

  // 3. E o app move esse estado sozinho: parada -> pensando -> respondendo.
  //
  // Quem observa é um MutationObserver instalado ANTES do clique, e não uma
  // amostragem: `answering` dura os 190ms do temporizador da resposta mais a
  // revelação, então perguntar de fora "está respondendo agora?" acerta ou erra
  // conforme a máquina. O observador não perde a transição, ele a REGISTRA.
  //
  // Sem isto, `is-responding` não teria guarda nenhuma: até 02/09/2026 o estado
  // `answering` era emitido de dois lugares e não pintava nada, e a parte 1
  // deste teste força a classe na mão — ela prova o CSS, não o app.
  await page.evaluate(() => {
    window.__estadosDaMarca = [];
    const alvo = document.getElementById('assistantIntroMark');
    new MutationObserver(() => {
      const atual = [...alvo.classList].filter(c => c.startsWith('is-')).join(' ') || 'parada';
      if (window.__estadosDaMarca.at(-1) !== atual) window.__estadosDaMarca.push(atual);
    }).observe(alvo, { attributes: true, attributeFilter: ['class'] });
  });

  await page.locator('.assistant-starter-card').first().click();
  await expect(marca).toHaveClass(/is-thinking/);
  await expect(marca).not.toHaveClass(/is-thinking/, { timeout: 15000 });

  const observados = await page.evaluate(() => window.__estadosDaMarca);
  expect(observados, `a marca nunca entrou em pensando: ${observados.join(' -> ')}`)
    .toContain('is-thinking');
  expect(observados, `a marca nunca entrou em respondendo: ${observados.join(' -> ')}`)
    .toContain('is-responding');
  expect(observados.indexOf('is-responding'), 'respondendo veio antes de pensando')
    .toBeGreaterThan(observados.indexOf('is-thinking'));
});

test('sob movimento reduzido a marca aparece parada e inteira', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openAssistant(page);
  await waitForIntro(page);

  const estado = await page.locator('#assistantIntroMark').evaluate(el => {
    const corpo = getComputedStyle(el.querySelector('.assistant-mark__orb'));
    const halo = getComputedStyle(el.querySelector('.assistant-mark__halo'));
    const r = el.getBoundingClientRect();
    return {
      largura: Math.round(r.width),
      visibilidade: getComputedStyle(el).visibility,
      animacaoCorpo: corpo.animationName,
      animacaoHalo: halo.animationName,
      opacidadeCorpo: Number(corpo.opacity),
      opacidadeHalo: Number(halo.opacity),
      escalaHalo: new DOMMatrixReadOnly(halo.transform).a
    };
  });

  // Parada de verdade: sem animação declarada, não só pausada.
  expect(estado.animacaoCorpo, 'a esfera continuou se movendo').toBe('none');
  expect(estado.animacaoHalo, 'o sopro continuou se movendo').toBe('none');
  // E inteira: parar não pode apagar nem encolher nada. O halo tem `scale(1.2)`
  // declarado FORA do keyframe — um `transform:none` no bloco de movimento
  // reduzido o encolheria em vez de só pará-lo, e é por isso que ele não está lá.
  expect(estado.opacidadeCorpo).toBe(1);
  expect(estado.opacidadeHalo, 'o sopro ficou apagado').toBeGreaterThanOrEqual(0.5);
  expect(estado.escalaHalo, 'o sopro encolheu ao parar').toBeGreaterThan(1);
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
  // Dois fixos + um situacional (rodada de 31/08/2026): três com cardápio ou
  // loja fechada; dois no pior caso (aberta e sem categoria elegível).
  expect(count, 'a tela voltou a abrir sem sugestões').toBeGreaterThanOrEqual(2);

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
  expect(firstCardSize.height).toBe(56);
  expect(firstCardSize.minWidth).toBe('0px');
  expect(firstCardSize.radius).toBe('16px');
  expect(firstCardSize.fontSize).toBe('16px');
  expect(firstCardSize.lineHeight).toBe('24px');

  // Nenhuma preenchida: a primeira pergunta não vale mais que a última, e uma
  // pílula chapada na marca inventava uma hierarquia que não existe.
  const fills = await cards.evaluateAll(items => items.map(el => {
    const style = getComputedStyle(el);
    return { background: style.backgroundColor, image: style.backgroundImage, color: style.color };
  }));
  expect(new Set(fills.map(fill => fill.background)).size, 'as pílulas não têm o mesmo fundo').toBe(1);
  expect(new Set(fills.map(fill => fill.color)).size, 'as pílulas não têm a mesma cor de texto').toBe(1);
  for (const fill of fills) {
    expect(fill.background, 'voltou pílula preenchida').toBe('rgb(255, 255, 255)');
    expect(fill.image, 'voltou degradê na pílula').toBe('none');
  }
  // E sem a seta: nem no markup, nem como pseudo-elemento.
  await expect(page.locator('.assistant-starter-card-arrow')).toHaveCount(0);
  const arrows = await cards.evaluateAll(items => items.map(el =>
    getComputedStyle(el, '::after').content));
  for (const arrow of arrows) {
    expect(arrow, 'voltou a seta no cartão de sugestão').toBe('none');
  }

  const leftSpacing = await page.evaluate(() => {
    const view = document.getElementById('mobViewAssistant').getBoundingClientRect();
    const first = document.querySelector('.assistant-starter-card').getBoundingClientRect();
    return first.left - view.left;
  });
  expect(leftSpacing).toBeCloseTo(20, 0);

  const rail = await page.locator('#assistantStarter').evaluate(el => ({
    scroll: el.scrollWidth,
    client: el.clientWidth,
    overflowX: getComputedStyle(el).overflowX,
    snap: getComputedStyle(el).scrollSnapType,
    background: getComputedStyle(el).backgroundColor,
    borderWidth: getComputedStyle(el).borderTopWidth,
    shadow: getComputedStyle(el).boxShadow
  }));
  expect(rail.scroll, 'a régua não transborda, então não rola').toBeGreaterThan(rail.client);
  expect(rail.overflowX).toBe('auto');
  // O navegador serializa `x proximity` como só `x`: proximity é o valor
  // inicial da força e some da forma computada.
  expect(rail.snap).toMatch(/^x( proximity)?$/);
  expect(rail.background).toBe('rgba(0, 0, 0, 0)');
  expect(rail.borderWidth).toBe('0px');
  expect(rail.shadow).toBe('none');

  // A frase nunca quebra nem é cortada com reticências: inteira, ou não entra.
  const label = await page.locator('.assistant-starter-card-label').first().evaluate(el => {
    const style = getComputedStyle(el);
    return { wrap: style.whiteSpace, ellipsis: style.textOverflow, lines: el.getClientRects().length };
  });
  expect(label.wrap).toBe('nowrap');
  expect(label.ellipsis).not.toBe('ellipsis');
  expect(label.lines, 'a frase quebrou em duas linhas').toBe(1);

  // E não sobrou rótulo nem frase de rodapé em volta da régua: as próprias
  // sugestões já ensinam o que dá para perguntar.
  await expect(page.locator('.assistant-starter-heading')).toHaveCount(0);
  await expect(page.locator('.assistant-starter-hint')).toHaveCount(0);

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

test('carregando: recupera "Digitando" e o bloco animado antigo, sem cartão fantasma', async ({ page }) => {
  await openAssistant(page, { chatDelay: 3000 });
  await waitForIntro(page);
  await page.locator('.assistant-starter-card').first().click();

  const skeleton = page.locator('#assistantTypingMessage');
  await expect(skeleton).toBeVisible();
  await expect(skeleton.locator('.assistant-typing-label')).toHaveText('Digitando...');
  await expect(skeleton.locator('.assistant-thinking--dark')).toBeVisible();
  await expect(skeleton.locator('.assistant-thinking-dots--dark span')).toHaveCount(49);
  expect(await skeleton.locator('.assistant-thinking-dots--dark span.is-ring-0').evaluate(
    element => getComputedStyle(element).animationName
  )).toBe('assistant-polygon-ring-0');
  await expect(skeleton.locator('.assistant-skeleton-line')).toHaveCount(0);

  // Os cartões fantasma saíram: eles prometiam produtos antes de saber se viria
  // algum e, numa resposta só de texto, viravam retângulos que apareciam e
  // sumiam. Cartão só entra quando o produto chega de verdade.
  await expect(skeleton.locator('.assistant-skeleton-card')).toHaveCount(0);
  await expect(page.locator('.assistant-product-card')).toHaveCount(0);

  await expect(page.locator('.assistant-product-card').first()).toBeVisible({ timeout: 15000 });
  await expect(skeleton).toHaveCount(0);
});

test('carregando sem produto: nada de retângulo que aparece e some', async ({ page }) => {
  // A regressão que este teste barra: uma resposta só de texto não pode deixar
  // rastro de cartão nenhum na tela durante a espera.
  await openAssistant(page, {
    chatDelay: 1500,
    answer: { response_type: 'text', message: 'Servimos das 18h às 23h.' }
  });
  await waitForIntro(page);
  await page.locator('.assistant-starter-card').first().click();

  await expect(page.locator('#assistantTypingMessage')).toBeVisible();
  await expect(page.locator('#mobViewAssistant .assistant-skeleton-card')).toHaveCount(0);
  await expect(page.locator('.assistant-chat-assistant-message:not(.assistant-chat-typing)'))
    .toBeVisible({ timeout: 15000 });
  await expect(page.locator('.assistant-product-card')).toHaveCount(0);
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

test('a abertura: marca e título centrados, sugestões ancoradas no campo', async ({ page }) => {
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

  // O bloco de cima se centra no espaço livre: o vão acima dele e o vão até as
  // sugestões são o mesmo, seja qual for a altura da tela.
  expect(
    Math.abs(layout.acimaDoBloco - layout.entreBlocoESugestoes),
    `bloco fora do centro: ${JSON.stringify(layout)}`
  ).toBeLessThanOrEqual(2);

  // E as sugestões ficam ancoradas junto do campo, não boiando no meio.
  expect(layout.entreSugestoesEcampo, 'as sugestões descolaram do campo').toBeLessThanOrEqual(40);
  expect(layout.entreSugestoesEcampo).toBeGreaterThan(0);
});

test('a abertura não tem moldura: nem cartão, nem crachá, nem ícone em caixa', async ({ page }) => {
  await openAssistant(page);
  await waitForIntro(page);

  await expect(page.locator('.assistant-ai-eyebrow')).toHaveCount(0);
  await expect(page.locator('.assistant-starter-zone')).toHaveCount(0);

  const intro = await page.locator('.assistant-intro-top').evaluate(el => {
    const style = getComputedStyle(el);
    return {
      background: style.backgroundColor,
      image: style.backgroundImage,
      border: style.borderTopWidth,
      radius: style.borderTopLeftRadius,
      shadow: style.boxShadow,
      pseudos: [getComputedStyle(el, '::before').content, getComputedStyle(el, '::after').content]
        .filter(content => content !== 'none').length
    };
  });
  expect(intro.background, 'voltou fundo no bloco de abertura').toBe('rgba(0, 0, 0, 0)');
  expect(intro.image, 'voltou degradê no bloco de abertura').toBe('none');
  expect(intro.border, 'voltou contorno no bloco de abertura').toBe('0px');
  expect(intro.radius).toBe('0px');
  expect(intro.shadow, 'voltou sombra no bloco de abertura').toBe('none');
  expect(intro.pseudos, 'voltaram os círculos decorativos').toBe(0);
});

test('a resposta é texto na página, sem cartão e sem avatar ao lado', async ({ page }) => {
  await openAssistant(page);
  await waitForIntro(page);
  await page.locator('.assistant-starter-card').first().click();

  const answer = page.locator('.assistant-chat-assistant-message:not(.assistant-chat-typing)');
  await expect(answer).toBeVisible({ timeout: 15000 });

  // O avatar quadrado ao lado de cada resposta não existe mais: a marca só
  // aparece na abertura e no indicador de carregamento.
  await expect(page.locator('.assistant-response-mark')).toHaveCount(0);
  await expect(answer.locator('.assistant-mark')).toHaveCount(0);

  const surfaces = await answer.locator('.assistant-result-content').evaluate(el => {
    const style = getComputedStyle(el);
    return {
      background: style.backgroundColor,
      image: style.backgroundImage,
      border: style.borderTopWidth,
      shadow: style.boxShadow
    };
  });
  expect(surfaces.background, 'a resposta voltou a ter fundo').toBe('rgba(0, 0, 0, 0)');
  expect(surfaces.image, 'a resposta voltou a ter degradê').toBe('none');
  expect(surfaces.border, 'a resposta voltou a ter borda').toBe('0px');
  expect(surfaces.shadow, 'a resposta voltou a ter sombra').toBe('none');

  // Só o cliente tem balão — é esse contraste que diz quem fala.
  const bubble = await page.locator('.assistant-chat-user-message .assistant-result-title')
    .evaluate(el => getComputedStyle(el).backgroundColor);
  expect(bubble).not.toBe('rgba(0, 0, 0, 0)');
});

test('a cor do restaurante aparece em três lugares, e o texto passa em AA', async ({ page }) => {
  // A resposta cita um produto em negrito de propósito: é a citação dentro do
  // texto que carrega a cor da marca, e ela precisa ser medida.
  await openAssistant(page, {
    answer: { ...CHAT_ANSWER, message: 'Boa! A **Água H2O** é a mais pedida gelada.' }
  });
  await waitForIntro(page);
  await page.locator('.assistant-starter-card').first().click();
  await expect(page.locator('.assistant-product-card').first()).toBeVisible({ timeout: 15000 });
  await page.locator('#assistantInput').fill('e mais alguma coisa?');

  // Rodado em três marcas de comportamento oposto: a do piloto, uma clara (que
  // some no branco) e uma escura (que some no preto).
  for (const brand of ['#D95C04', '#FFD34D', '#2A2D7C']) {
    await page.evaluate(hex => window.RapidexTheme.applyBrandTheme(hex), brand);
    // O botão de enviar tem transição de cor: medido no mesmo quadro, o valor
    // computado é uma cor intermediária da animação, não a do tema.
    await page.waitForTimeout(400);

    const audit = await page.evaluate(() => {
      const parse = value => (value.match(/[\d.]+/g) || []).slice(0, 3).map(Number);
      const luminance = rgb => {
        const [r, g, b] = rgb.map(channel => {
          const v = channel / 255;
          return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
        });
        return 0.2126 * r + 0.7152 * g + 0.0722 * b;
      };
      const ratio = (a, b) => {
        const [light, dark] = [luminance(parse(a)), luminance(parse(b))].sort((x, y) => y - x);
        return (light + 0.05) / (dark + 0.05);
      };
      const root = getComputedStyle(document.documentElement);
      const tints = ['--brand-primary-rgb', '--brand-tint', '--brand-surface', '--brand-tint-strong']
        .map(token => `rgb(${parse(root.getPropertyValue(token)).join(', ')})`);

      // Toda superfície VISÍVEL pintada com a marca ou com um wash dela.
      const stained = [];
      for (const el of document.querySelectorAll('#mobViewAssistant *')) {
        if (!el.getClientRects().length) continue;
        const style = getComputedStyle(el);
        const paint = `${style.backgroundColor} ${style.backgroundImage}`;
        if (!tints.some(tint => paint.includes(tint))) continue;
        stained.push(el.closest('.assistant-chat-user-message')
          ? 'assistant-chat-user-message'
          : (el.className?.baseVal ?? String(el.className || el.tagName)));
      }

      const measure = (selector, background) => {
        const el = document.querySelector(selector);
        if (!el) return null;
        const style = getComputedStyle(el);
        return {
          ratio: ratio(style.color, background || style.backgroundColor),
          size: parseFloat(style.fontSize),
          weight: style.fontWeight
        };
      };

      const PAPER = 'rgb(255, 255, 255)';
      return {
        stained,
        text: {
          resposta: measure('.assistant-chat-assistant-message .assistant-result-title', PAPER),
          citacao: measure('.assistant-chat-assistant-message .assistant-result-title strong', PAPER),
          preco: measure('.assistant-product-card .assistant-result-price', PAPER),
          nomeDoProduto: measure('.assistant-product-card .assistant-result-title', PAPER),
          balao: measure('.assistant-chat-user-message .assistant-result-title'),
          titulo: measure('.assistant-ai-question', PAPER),
          subtitulo: measure('.assistant-ai-subtitle', PAPER),
          sugestao: measure('.assistant-starter-card', PAPER),
          cabecalho: measure('#assistantHdrName', PAPER),
          // O texto de exemplo do campo também é texto que a pessoa lê.
          exemploDoCampo: (() => {
            const el = document.querySelector('.assistant-ai-input');
            if (!el) return null;
            const style = getComputedStyle(el, '::placeholder');
            return { ratio: ratio(style.color, PAPER), size: parseFloat(style.fontSize), weight: style.fontWeight };
          })()
        }
      };
    });

    // Só duas superfícies da tela são pintadas com a marca: o balão do cliente
    // e o botão de enviar. (O balão usa a tinta guardada --brand-ink-strong,
    // que coincide com a primária quando a marca já é escura o bastante — é o
    // caso do índigo.) Nenhum wash, nenhum degradê, em lugar nenhum.
    for (const klass of audit.stained) {
      expect(klass, `sobrou superfície na cor da marca em ${brand}: ${klass}`)
        .toMatch(/assistant-ai-send|assistant-chat-user-message/);
    }
    expect(audit.stained.some(klass => /assistant-ai-send/.test(klass)),
      'o botão de enviar perdeu a cor da marca').toBe(true);

    // E todo texto da tela passa no AA de texto normal (4,5:1).
    for (const [nome, medida] of Object.entries(audit.text)) {
      expect(medida, `${nome} sumiu da tela`).not.toBeNull();
      expect(medida.ratio, `${nome} em ${brand}: ${medida.ratio?.toFixed(2)}:1`)
        .toBeGreaterThanOrEqual(4.5);
    }
  }
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


test('as sugestões são dois botões fixos + um situacional do cardápio', async ({ page }) => {
  await openAssistant(page);
  await waitForIntro(page);

  const labels = await page.locator('.assistant-starter-card-label').allTextContents();
  // Regra dura da rodada: só botão que o assistente SABE responder. Os dois
  // fixos, sempre; o terceiro sai do cardápio DESTE tenant (loja aberta).
  expect(labels[0]).toBe('O que você recomenda?');
  expect(labels[1]).toBe('Quanto tempo demora a entrega?');
  expect(labels).toHaveLength(3);
  expect(labels[2]).toMatch(/^Tem .+\?$/);
  // "Quais são os mais pedidos?" saiu: o backend não publica ranking de
  // vendas, e botão que promete dado que a resposta não tem é botão mentiroso.
  expect(labels).not.toContain('Quais são os mais pedidos?');
});

test('com a loja fechada, o botão situacional pergunta o horário de abertura', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockApi(page);
  await page.route(/\/menu(\?|$)/, async route => {
    const { menuForBranch } = await import('./helpers.js');
    const body = menuForBranch(new URL(route.request().url()).searchParams.get('branch_id'));
    body.settings = { ...body.settings, is_open: false };
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
  await seedPickupSession(page);
  await page.goto(RESTAURANT_URL);
  await esperarAppPronto(page);
  await page.evaluate(() => window.RapidexActions.resolve('mobNavAssistant')());
  await waitForIntro(page);

  const labels = await page.locator('.assistant-starter-card-label').allTextContents();
  expect(labels[2]).toBe('Que horas vocês abrem?');
});
