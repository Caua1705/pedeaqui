import { test, expect } from '@playwright/test';
import { mockApi, SLUG, esperarAppPronto } from './helpers.js';

// Fase 4, bloco B2: a rede de segurança da migração dos handlers inline.
//
// A suíte E2E percorre o caminho do pedido, mas o app tem centenas de botões
// fora dele. Estes testes não clicam em tudo — eles conferem, de forma
// estática e exaustiva, que TODA ação declarada no markup resolve para uma
// função de verdade. É o que pega o erro típico da migração: um nome que ficou
// só no HTML porque a função nunca foi registrada.

async function boot(page) {
  await mockApi(page);
  await page.goto(`/restaurant.html?slug=${SLUG}`);
  await esperarAppPronto(page);
}

test('nenhum handler inline on*= sobrou no documento', async ({ page }) => {
  await boot(page);

  const inline = await page.evaluate(() => {
    const out = [];
    for (const el of document.querySelectorAll('*')) {
      for (const attr of el.attributes) {
        if (/^on[a-z]+$/i.test(attr.name)) {
          out.push(`${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''} [${attr.name}]`);
        }
      }
    }
    return out;
  });

  // Zero: é o que permite script-src 'self' sem 'unsafe-inline'.
  expect(inline, `handler inline encontrado:\n${inline.join('\n')}`).toEqual([]);
});

test('toda ação declarada no markup resolve para uma função', async ({ page }) => {
  await boot(page);

  const broken = await page.evaluate(() => {
    const { parseSpec, resolve } = window.RapidexActions;
    const problems = [];
    for (const el of document.querySelectorAll('*')) {
      for (const attr of el.attributes) {
        if (!attr.name.startsWith('data-act-')) continue;
        const spec = parseSpec(attr.value);
        if (!spec.length) {
          problems.push(`${attr.name}="${attr.value}" não parseou`);
          continue;
        }
        for (const [name] of spec) {
          if (name.startsWith('$')) continue; // pseudo-ação
          if (!resolve(name)) problems.push(`${attr.name}: ação "${name}" não resolve`);
        }
      }
    }
    return [...new Set(problems)];
  });

  expect(broken, `ações quebradas:\n${broken.join('\n')}`).toEqual([]);
});

test('o despachante roda a ação do elemento clicado, com os argumentos declarados', async ({
  page
}) => {
  await boot(page);

  const result = await page.evaluate(() => {
    const calls = [];
    window.RapidexActions.register({
      __probe: function (...args) { calls.push({ args, thisTag: this.tagName }); }
    });
    const button = document.createElement('button');
    button.setAttribute('data-act-click', JSON.stringify(['__probe', 'alpha', 7, '$this']));
    document.body.appendChild(button);
    button.click();

    // Delegação de verdade: o clique num filho tem que subir até o elemento
    // que declara a ação.
    const child = document.createElement('span');
    button.appendChild(child);
    child.click();

    button.remove();
    return calls;
  });

  expect(result).toHaveLength(2);
  expect(result[0].args[0]).toBe('alpha');
  expect(result[0].args[1]).toBe(7);
  expect(result[0].thisTag).toBe('BUTTON'); // $this é quem declara, não o alvo
  expect(result[1].args[0]).toBe('alpha');
});

test('uma ação que explode não derruba as outras da sequência', async ({ page }) => {
  await boot(page);

  const survived = await page.evaluate(() => {
    let reached = false;
    window.RapidexActions.register({
      __boom: () => { throw new Error('proposital'); },
      __after: () => { reached = true; }
    });
    const button = document.createElement('button');
    button.setAttribute('data-act-click', JSON.stringify([['__boom'], ['__after']]));
    document.body.appendChild(button);
    button.click();
    button.remove();
    return reached;
  });

  // Um listener no document serve a tela inteira: se uma ação quebrada o
  // matasse, o app inteiro ficaria sem cliques.
  expect(survived).toBe(true);
});
