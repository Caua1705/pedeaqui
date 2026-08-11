import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { mockApi, SLUG } from './helpers.js';

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
  await page.waitForFunction(() => !document.body.classList.contains('app-booting'));
  await page.waitForTimeout(1200); // deixa o boot assíncrono terminar

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
    await page.waitForTimeout(250);
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

test('os demais headers de segurança estão presentes', () => {
  expect(headerValue('X-Content-Type-Options')).toBe('nosniff');
  expect(headerValue('Referrer-Policy')).toBeTruthy();
  expect(headerValue('Permissions-Policy')).toContain('camera=()');
  // Proteção de frame nos dois mecanismos: header legado + diretiva da CSP.
  expect(headerValue('X-Frame-Options')).toBe('DENY');
});
