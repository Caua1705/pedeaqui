import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const FONTE = fs.readFileSync(path.join(RAIZ, 'scripts/services/google-identity-service.js'), 'utf8');

// ============================================================================
//  O QUE ESTE ARQUIVO GUARDA, e por que ele existe apesar do E2E.
//
//  O E2E do "entrar com Google" define `window.google` ANTES do boot, e por
//  isso ele NUNCA baixa o SDK: `ensureSdk()` começa por
//  `if (window.google?.accounts?.id) return` e volta na primeira linha. É a
//  mesma armadilha do Mercado Pago (§4 da skill), onde o atraso e a falha do
//  download passaram batidos pela suíte inteira porque um `addInitScript`
//  definia o SDK.
//
//  Então o download é medido AQUI, sem browser: a URL exata, a tag injetada uma
//  única vez, e a promessa DESCARTADA na falha — guardar uma promessa rejeitada
//  transformaria uma queda de rede momentânea em "o botão não funciona mais
//  nesta aba".
//
//  E a URL não é decorativa: ela tem de ser exatamente o host que a
//  `script-src` da CSP de produção libera. Um host a mais no código sem o par
//  no `vercel.json` é uma tela que funciona em teste e é bloqueada em produção
//  sem uma linha de erro nossa — a classe de bug do commit 63ffa5a.
// ============================================================================

function carregarServico() {
  // O arquivo é uma IIFE que publica em `window`; num ambiente sem `document`
  // ele não faria nada de útil, então o DOM mínimo vem antes.
  const fn = new Function('window', 'document', `${FONTE}\nreturn window.PedeAquiGoogleIdentity;`);
  return fn(globalThis.window, globalThis.document);
}

function domFalso() {
  const tags = [];
  // As tags CRIADAS, contadas à parte das que estão no DOM. A tag morta é
  // removida no erro, então o tamanho do DOM sozinho não distingue "baixou de
  // novo" de "reusou a morta" — nos dois casos ele volta a UM.
  const criadas = [];
  const head = { appendChild: tag => tags.push(tag) };
  const doc = {
    head,
    querySelector: seletor => tags.find(t => `script[src="${t.src}"]` === seletor) || null,
    createElement: () => {
      const ouvintes = {};
      const tag = {
        src: '', async: false, defer: false,
        addEventListener: (nome, fn) => { ouvintes[nome] = fn; },
        remove: () => { const i = tags.indexOf(tag); if (i >= 0) tags.splice(i, 1); },
        disparar: nome => ouvintes[nome]?.()
      };
      criadas.push(tag);
      return tag;
    }
  };
  return { doc, tags, criadas };
}

describe('google-identity-service', () => {
  let tags, criadas;

  beforeEach(() => {
    const { doc, tags: t, criadas: c } = domFalso();
    tags = t;
    criadas = c;
    globalThis.document = doc;
    globalThis.window = { APP_CONFIG: {}, document: doc };
  });

  afterEach(() => {
    delete globalThis.document;
    delete globalThis.window;
    vi.restoreAllMocks();
  });

  it('sem client id o botão não é oferecido', () => {
    const servico = carregarServico();
    expect(servico.isEnabled()).toBe(false);
    globalThis.window.APP_CONFIG.GOOGLE_CLIENT_ID = '   ';
    expect(servico.isEnabled(), 'espaço em branco não é client id').toBe(false);
    globalThis.window.APP_CONFIG.GOOGLE_CLIENT_ID = 'abc.apps.googleusercontent.com';
    expect(servico.isEnabled()).toBe(true);
  });

  it('baixa o gsi/client do host que a CSP de produção libera, e uma vez só', async () => {
    const servico = carregarServico();
    expect(servico.SDK_URL).toBe('https://accounts.google.com/gsi/client');

    const csp = JSON.parse(fs.readFileSync(path.join(RAIZ, 'vercel.json'), 'utf8'))
      .headers[0].headers.find(h => h.key === 'Content-Security-Policy').value;
    const scriptSrc = csp.match(/script-src[^;]*/)[0];
    const host = new URL(servico.SDK_URL).origin;
    expect(scriptSrc, `script-src não libera ${host}`).toContain(host);
    // O SDK monta o botão num IFRAME e conversa com o próprio host: sem estas
    // duas, o script carrega e o botão não aparece — sem erro nosso na tela.
    expect(csp.match(/frame-src[^;]*/)[0]).toContain(host);
    expect(csp.match(/connect-src[^;]*/)[0]).toContain(host);

    const p1 = servico.ensureSdk();
    const p2 = servico.ensureSdk();
    expect(tags, 'duas telas pedindo o botão não podem virar duas tags').toHaveLength(1);
    expect(tags[0].src).toBe(servico.SDK_URL);
    expect(tags[0].async).toBe(true);

    globalThis.window.google = { accounts: { id: { marcador: true } } };
    tags[0].disparar('load');
    await expect(p1).resolves.toEqual({ marcador: true });
    await expect(p2).resolves.toEqual({ marcador: true });
  });

  it('uma falha de rede NÃO fica guardada: a tentativa seguinte volta a baixar', async () => {
    const servico = carregarServico();
    const primeira = servico.ensureSdk();
    tags[0].disparar('error');
    await expect(primeira).rejects.toThrow(/Não foi possível carregar o Google/);

    servico.ensureSdk();
    expect(criadas, 'a segunda tentativa não criou tag nova — ela reusou a morta').toHaveLength(2);
    expect(tags, 'a tag morta continuou no DOM ao lado da nova').toHaveLength(1);
    expect(tags[0], 'o DOM ficou com a tag MORTA, não com a nova').toBe(criadas[1]);
  });

  it('SDK já presente na página não baixa nada', async () => {
    globalThis.window.google = { accounts: { id: { marcador: 'ja-estava' } } };
    const servico = carregarServico();
    await expect(servico.ensureSdk()).resolves.toEqual({ marcador: 'ja-estava' });
    expect(tags).toHaveLength(0);
  });
});
