import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { mockApi, SLUG, esperarAppPronto } from './helpers.js';

// Fase 4, bloco B3: a CSP tem que valer no app REAL, não no papel.
//
// A política é lida do próprio vercel.json — se alguém afrouxar o header em
// produção, é este arquivo que passa a ser testado, não uma cópia que envelhece
// em silêncio. O `vite preview` não aplica headers da Vercel, então o teste os
// injeta na resposta do documento.

const here = dirname(fileURLToPath(import.meta.url));
const vercel = JSON.parse(readFileSync(resolve(here, '..', '..', 'vercel.json'), 'utf8'));

const headerValue = (key) =>
  vercel.headers?.[0]?.headers?.find(h => h.key.toLowerCase() === key.toLowerCase())?.value;

const CSP = headerValue('Content-Security-Policy');

/**
 * Espera a tela PARAR de mudar, em vez de esperar um numero de milissegundos.
 *
 * Aqui havia `waitForTimeout(1200)` depois do boot e `waitForTimeout(250)` a
 * cada troca de tela. Este teste falha ao contrario dos outros: relogio curto
 * demais nao o deixa vermelho, deixa CEGO. A violacao que chegasse aos 300ms
 * numa maquina ocupada nunca entrava em `__cspViolations`, e o teste que existe
 * para provar que a CSP de producao nao bloqueia nada passava dizendo que
 * estava tudo bem porque nao olhou. Passar pelo motivo errado, na guarda de
 * seguranca do arquivo — o pior lugar para isso acontecer.
 *
 * O criterio agora e observavel: o DOM parou de mutar E nenhuma violacao nova
 * chegou, por tres leituras seguidas. Numa maquina lenta isto espera MAIS, que
 * e exatamente o contrario do que o relogio fixo fazia.
 */
async function aguardarSilencio(page, leiturasQuietas = 3) {
  let anterior = null;
  let quietas = 0;
  const limite = Date.now() + 15_000;
  while (quietas < leiturasQuietas) {
    if (Date.now() > limite) throw new Error('a tela nao parou de mudar em 15s');
    const atual = await page.evaluate(
      () => `${window.__domMutations}:${window.__cspViolations.length}`
    );
    quietas = atual === anterior ? quietas + 1 : 0;
    anterior = atual;
    // 60ms nao e um prazo: e o intervalo entre AMOSTRAS. Se a tela ainda
    // estiver mudando, o laco continua — nao ha teto de espera embutido.
    await page.waitForTimeout(60);
  }
}

/** Serve o documento com os headers reais de produção e coleta as violações. */
async function bootUnderCsp(page) {
  const violations = [];
  const consoleErrors = [];

  await page.addInitScript(() => {
    window.__cspViolations = [];
    document.addEventListener('securitypolicyviolation', (event) => {
      window.__cspViolations.push({
        directive: event.effectiveDirective || event.violatedDirective,
        blocked: event.blockedURI,
        sample: event.sample || ''
      });
    });
    // Contador de mutacoes do DOM. E ele que diz se a tela TERMINOU de montar
    // o markup gerado em runtime — que e onde um style/script inline
    // reapareceria. Ver aguardarSilencio().
    window.__domMutations = 0;
    new MutationObserver((records) => { window.__domMutations += records.length; })
      .observe(document.documentElement, { childList: true, subtree: true, attributes: true });
  });

  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });

  await mockApi(page);

  // Aplica o header no documento HTML, como a Vercel faria.
  await page.route('**/restaurant.html*', async (route) => {
    const response = await route.fetch();
    await route.fulfill({
      response,
      headers: { ...response.headers(), 'content-security-policy': CSP }
    });
  });

  await page.goto(`/restaurant.html?slug=${SLUG}`);
  await esperarAppPronto(page);
  await aguardarSilencio(page);

  // A home sozinha exercita pouca coisa. Estas telas montam markup gerado em
  // runtime — que é justamente onde um style/script inline reapareceria.
  const screens = [
    () => window.setMobNavActive?.('mobViewMenu'),
    () => window.openModal?.('cartModal'),
    () => window.closeModal?.('cartModal'),
    () => window.openRestaurantInfo?.(),
    () => window.closeModalId?.('infoModal'),
    () => window.setMobNavActive?.('mobViewClub'),
    () => window.setMobNavActive?.('mobViewAssistant'),
    () => window.setMobNavActive?.('mobViewProfile'),
    () => window.openModal?.('loginModal'),
    () => window.closeModalId?.('loginModal'),
    () => window.openModal?.('operationModal')
  ];
  for (const go of screens) {
    await page.evaluate(go).catch(() => {});
    await aguardarSilencio(page);
  }

  violations.push(...(await page.evaluate(() => window.__cspViolations)));
  return { violations, consoleErrors };
}

test('a política existe e é restritiva onde importa', () => {
  expect(CSP, 'CSP ausente do vercel.json').toBeTruthy();

  // O ponto da fase: script-src sem 'unsafe-inline' e sem 'unsafe-eval'.
  const scriptSrc = CSP.split(';').map(s => s.trim()).find(s => s.startsWith('script-src'));
  expect(scriptSrc).toBeTruthy();
  expect(scriptSrc, "script-src nao pode ter 'unsafe-inline'").not.toContain("'unsafe-inline'");
  expect(scriptSrc, "script-src nao pode ter 'unsafe-eval'").not.toContain("'unsafe-eval'");
  expect(scriptSrc).toContain("'self'");

  // Clickjacking e injeção de <base>.
  expect(CSP).toContain("frame-ancestors 'none'");
  expect(CSP).toContain("object-src 'none'");
  expect(CSP).toContain("base-uri 'none'");
});

test('a produção deixa o modo voz existir', () => {
  // Estes dois headers matam a voz SÓ EM PRODUÇÃO: em dev o Vite não os aplica,
  // então a conversa funciona na máquina de quem programou e responde com um
  // NotAllowedError na Vercel. Foi por isso que viraram teste.
  const connect = CSP.split(';').map(s => s.trim()).find(s => s.startsWith('connect-src'));
  expect(connect, 'a chamada de SDP à OpenAI seria bloqueada pela CSP')
    .toContain('https://api.openai.com');
  expect(connect, 'connect-src continua sem curinga').not.toMatch(/\s\*/);

  // O áudio remoto entra por srcObject (MediaStream), que não é uma busca e não
  // passa por diretiva nenhuma — mas o elemento existe, e default-src 'self'
  // seria o fallback se algum dia ele virar URL.
  expect(CSP).toContain('media-src');

  const permissoes = headerValue('Permissions-Policy');
  // `microphone=()` desliga getUserMedia no documento inteiro, antes de qualquer
  // diálogo de permissão aparecer.
  expect(permissoes, 'o microfone está desligado por Permissions-Policy')
    .toContain('microphone=(self)');
  // E a câmera continua desligada: a voz não é desculpa para abrir o resto.
  expect(permissoes).toContain('camera=()');
});

test('a produção permite somente os hosts necessários aos Secure Fields', () => {
  const directives = CSP.split(';').map(value => value.trim());
  const script = directives.find(value => value.startsWith('script-src'));
  const connect = directives.find(value => value.startsWith('connect-src'));
  const frame = directives.find(value => value.startsWith('frame-src'));

  expect(script).toContain('https://sdk.mercadopago.com');
  expect(connect).toContain('https://api.mercadopago.com');
  expect(connect).toContain('https://events.mercadopago.com');
  expect(frame).toContain('https://secure-fields.mercadopago.com');

  // O host do iframe também precisa estar em connect-src: antes de apontar o
  // <iframe> para lá, o SDK faz um `fetch` na página dos campos (cacheUrl) e
  // cai no api-static (sourceUrl) se ela falhar. Com só o frame-src liberado o
  // fetch morria na política, os campos nunca montavam e o cliente via "campo
  // indisponível" — que foi exatamente o bug desta linha.
  expect(connect, 'o fetch da página dos campos seria bloqueado')
    .toContain('https://secure-fields.mercadopago.com');
  expect(connect, 'a reserva do fetch da página dos campos seria bloqueada')
    .toContain('https://api-static.mercadopago.com');

  // O device fingerprint do SDK injeta script INLINE com o session_id da vez
  // dentro — corpo diferente a cada carregamento, portanto sem hash estável, e
  // o SDK não aceita nonce. Ele fica desligado (advancedFraudPrevention:false)
  // justamente para o script-src não precisar afrouxar.
  expect(script, "o inline do device fingerprint nao justifica 'unsafe-inline'")
    .not.toContain("'unsafe-inline'");
  expect(script, "'strict-dynamic' liberaria qualquer script criado por script")
    .not.toContain("'strict-dynamic'");
  expect(script).not.toMatch(/\s\*/);
  expect(connect).not.toMatch(/\s\*/);
  expect(frame).not.toMatch(/\s\*/);
});

test('o app boota sob a CSP sem nenhuma violação', async ({ page }) => {
  const { violations } = await bootUnderCsp(page);

  const describe = violations
    .map(v => `${v.directive} bloqueou ${v.blocked} ${v.sample}`)
    .join('\n');
  expect(violations, `violacoes de CSP:\n${describe}`).toEqual([]);
});

test('nada quebra em silêncio no console sob a CSP', async ({ page }) => {
  const { consoleErrors } = await bootUnderCsp(page);

  // A chave do Maps não é configurada no teste; esse aviso é esperado e não é
  // efeito da CSP.
  const unexpected = consoleErrors.filter(text => !/Google Maps/i.test(text));
  expect(unexpected, `erros no console:\n${unexpected.join('\n')}`).toEqual([]);
});

test('a CSP está de fato ATIVA: script inline injetado é bloqueado', async ({ page }) => {
  // Sem isto, os testes acima passariam mesmo com a política inerte — o que
  // daria uma falsa sensação de segurança justamente no ponto da fase.
  await bootUnderCsp(page);

  const result = await page.evaluate(() => {
    window.__xss = false;
    const script = document.createElement('script');
    script.textContent = 'window.__xss = true;'; // é isto que um XSS faria
    document.body.appendChild(script);
    script.remove();
    const executou = window.__xss;
    // O evento securitypolicyviolation é assíncrono: sai da fila antes de ler.
    return new Promise(resolve => setTimeout(() => resolve({
      executou,
      violacoes: window.__cspViolations.map(v => v.directive)
    }), 100));
  });

  expect(result.executou, 'script inline EXECUTOU — a CSP não está valendo').toBe(false);
  expect(result.violacoes).toContain('script-src-elem');
});

test('nenhum handler inline sobrevive no markup gerado', async ({ page }) => {
  // A migração para delegação (data-act-*) tirou 269 atributos on*= do app, mas
  // dois voltaram por setAttribute('onclick', ...) em código que monta markup em
  // runtime — invisíveis para um grep no HTML e para os testes acima, porque a
  // violação só aparece na tela onde aquele markup é montado. Sob script-src
  // 'self' o handler não roda: o controle fica morto e ainda emite relatório.
  await bootUnderCsp(page);

  const inline = await page.evaluate(() =>
    [...document.querySelectorAll('*')]
      .flatMap(el => [...el.attributes]
        .filter(a => /^on/i.test(a.name))
        .map(a => `${el.tagName.toLowerCase()}[${a.name}="${a.value}"]`))
  );

  expect(inline, `handlers inline (bloqueados pela CSP):\n${inline.join('\n')}`).toEqual([]);
});

test('os demais headers de segurança estão presentes', () => {
  expect(headerValue('X-Content-Type-Options')).toBe('nosniff');
  expect(headerValue('Referrer-Policy')).toBeTruthy();
  expect(headerValue('Permissions-Policy')).toContain('camera=()');
  // Proteção de frame nos dois mecanismos: header legado + diretiva da CSP.
  expect(headerValue('X-Frame-Options')).toBe('DENY');
});

// ============================================================================
//  A CSP DA TELA DO ENTREGADOR — menor privilégio, e a dúvida que ela resolve.
//
//  `/entregador` só fala com a nossa API. Mercado Pago, OpenAI, Google Maps e
//  as fontes do Google são do app do CLIENTE e não têm uso nenhum ali; herdar
//  a política global significava carregar a superfície de ataque de três
//  terceiros numa página que roda com uma credencial no caminho da URL.
//
//  A DÚVIDA: dois blocos de header da vercel.json casam com /entregador, e os
//  dois declaram Content-Security-Policy. A Vercel soma ou substitui?
//
//  O que foi MEDIDO na produção (02/09/2026, curl -I): blocos que casam a mesma
//  URL SOMAM — /sw.js recebe o `Service-Worker-Allowed` do bloco dele E o CSP e
//  o X-Frame-Options do bloco global. Mas isso mede chaves DISTINTAS; para a
//  mesma chave repetida o comportamento não foi observado, porque até hoje não
//  havia chave repetida nenhuma neste arquivo.
//
//  A SAÍDA é não depender da resposta. Se a Vercel mandar as duas, o browser
//  aplica a INTERSEÇÃO (é assim que CSP múltiplo funciona por especificação);
//  se mandar só uma, vale a do bloco mais específico. Como a política do
//  entregador é COMPLETA e é subconjunto da global em toda diretiva, os dois
//  caminhos dão o mesmo resultado: a política do entregador.
//
//  O teste do subconjunto abaixo é o que mantém isso verdadeiro. No dia em que
//  alguém liberar um host no entregador que a global não tem, a interseção
//  passa a BLOQUEAR esse host e a página quebra só em produção — e é esse o
//  defeito que este teste existe para pegar antes.
// ============================================================================

const blocoDe = (source) => vercel.headers?.find(h => h.source === source);
const CSP_ENTREGADOR = blocoDe('/entregador(/.*)?')
  ?.headers?.find(h => h.key.toLowerCase() === 'content-security-policy')?.value;

/** "script-src 'self' https://x" -> Map { 'script-src' => Set{"'self'", 'https://x'} } */
const diretivas = (csp) => new Map(
  String(csp || '').split(';').map(parte => parte.trim()).filter(Boolean).map(parte => {
    const [nome, ...valores] = parte.split(/\s+/);
    return [nome.toLowerCase(), new Set(valores)];
  })
);

test('a tela do entregador tem política própria, e ela é completa', () => {
  expect(CSP_ENTREGADOR, 'bloco de CSP do /entregador ausente da vercel.json').toBeTruthy();
  const d = diretivas(CSP_ENTREGADOR);

  // Completa: não depende de a global chegar junto para ser segura.
  for (const obrigatoria of ['default-src', 'script-src', 'object-src', 'base-uri', 'frame-ancestors']) {
    expect(d.has(obrigatoria), `a política do entregador não declara ${obrigatoria}`).toBe(true);
  }
  expect([...d.get('object-src')]).toEqual(["'none'"]);
  expect([...d.get('base-uri')]).toEqual(["'none'"]);
  expect([...d.get('frame-ancestors')]).toEqual(["'none'"]);
  expect([...d.get('script-src')], 'script-src do entregador deixou de ser só self').toEqual(["'self'"]);
});

test('a tela do entregador não carrega os terceiros do app do cliente', () => {
  // O ponto da mudança, escrito como afirmação: nenhum destes tem uso ali.
  for (const terceiro of [
    'mercadopago.com', 'openai.com', 'googleapis.com', 'gstatic.com', 'ggpht.com', 'supabase.co'
  ]) {
    expect(CSP_ENTREGADOR, `${terceiro} continua liberado na tela do entregador`)
      .not.toContain(terceiro);
  }
  // E o que ela PRECISA continua lá: a nossa API.
  expect(CSP_ENTREGADOR).toContain('https://api.pederapidex.com');
});

test('a política do entregador é subconjunto da global em toda diretiva', () => {
  // É esta propriedade que faz "a Vercel soma ou substitui?" não mudar o
  // resultado. Ver o cabeçalho desta seção.
  const global = diretivas(CSP);
  const courier = diretivas(CSP_ENTREGADOR);

  expect(courier.size, 'sonda cega: nenhuma diretiva casou').toBeGreaterThan(5);

  for (const [nome, valores] of courier) {
    // Diretiva sem lista (upgrade-insecure-requests) não tem o que comparar.
    if (!valores.size) continue;
    const daGlobal = global.get(nome);
    // Diretiva que a global não declara cai no default-src dela.
    const permitido = daGlobal || global.get('default-src');
    expect(permitido, `a global não declara ${nome} nem default-src`).toBeTruthy();
    for (const valor of valores) {
      expect(
        permitido.has(valor),
        `${nome} do entregador libera ${valor}, que a global não tem — somadas, a interseção BLOQUEIA isso e a página quebra só em produção`
      ).toBe(true);
    }
  }
});
