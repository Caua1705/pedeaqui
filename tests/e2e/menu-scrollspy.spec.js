import { test, expect } from '@playwright/test';
import { mockApi, RESTAURANT_URL, seedPickupSession, esperarAppPronto } from './helpers.js';

// Rolar o cardápio tem de (a) mover o destaque para a categoria da seção visível
// e (b) trazer essa aba para dentro da barra horizontal.
//
// O (a) quebrou em 5618157: o scrollspy casava botão com seção lendo
// `btn.getAttribute('onclick')`, e aquele commit trocou o handler inline por
// data-cat-slug + addEventListener. getAttribute passou a devolver null, o
// `?.includes(...)` virou undefined e o toggle desligava TODOS os botões.
// Nenhum teste pegou porque nenhum rolava o cardápio.

const MOBILE = { width: 390, height: 844 };

test.use({ viewport: MOBILE });

async function bootMenu(page) {
  await mockApi(page);
  await seedPickupSession(page);
  await page.goto(RESTAURANT_URL);
  await esperarAppPronto(page);
  await page.evaluate(() => window.mobNavMenu?.());
  await page.waitForFunction(() => document.querySelectorAll('.menu-section').length > 1);
  await page.waitForTimeout(500);
}

const activeSlug = (page) =>
  page.evaluate(() => document.querySelector('.cat.active')?.dataset.catSlug ?? null);

// As fotos entram por lazy-load e mudam a altura das seções DEPOIS do scroll,
// então uma rolagem só erra o alvo. Reaplica até a posição parar de andar.
async function scrollToSection(page, id) {
  for (let i = 0; i < 5; i++) {
    await page.evaluate((sectionId) => {
      const el = document.getElementById(sectionId);
      window.scrollTo({ top: el.getBoundingClientRect().top + window.pageYOffset - 80, behavior: 'auto' });
    }, id);
    await page.waitForTimeout(350);
  }
  await page.waitForTimeout(400);
}

// Qual seção a regra do app (última com top <= 150) elege na posição atual.
// Assertar contra ela testa o VÍNCULO botão<->seção — que é o que quebrou — sem
// depender de o scroll ter parado num pixel exato.
const expectedSlug = (page) =>
  page.evaluate(() => {
    let current = '';
    document.querySelectorAll('.menu-section').forEach((s) => {
      if (s.getBoundingClientRect().top <= 150) current = s.id;
    });
    return current || document.querySelector('.menu-section')?.id || null;
  });

test('rolar o cardápio move o destaque para a categoria visível', async ({ page }) => {
  await bootMenu(page);

  const slugs = await page.evaluate(() =>
    [...document.querySelectorAll('.menu-section')].map((s) => s.id)
  );
  expect(slugs.length).toBeGreaterThan(2);

  // Começa na primeira categoria.
  expect(await activeSlug(page)).toBe(slugs[0]);

  // Rola até a terceira seção — longe o bastante para o destaque ter de andar.
  await scrollToSection(page, slugs[2]);

  const esperado = await expectedSlug(page);
  expect(esperado, 'o scroll não saiu da primeira seção').not.toBe(slugs[0]);
  expect(await activeSlug(page), 'o destaque não acompanhou a seção visível').toBe(esperado);
});

test('a barra de abas rola sozinha para manter a categoria ativa visível', async ({ page }) => {
  await bootMenu(page);

  const slugs = await page.evaluate(() =>
    [...document.querySelectorAll('.menu-section')].map((s) => s.id)
  );

  // Uma categoria bem adiante, que com certeza nasce fora da área visível da
  // barra (a barra só mostra ~4 abas de cada vez num viewport de 390px).
  const target = slugs[Math.min(6, slugs.length - 1)];

  const before = await page.evaluate(() => document.getElementById('catNav').scrollLeft);

  await scrollToSection(page, target);
  const esperado = await expectedSlug(page);
  expect(await activeSlug(page)).toBe(esperado);

  const state = await page.evaluate(() => {
    const nav = document.getElementById('catNav');
    const btn = nav.querySelector('.cat.active');
    const navBox = nav.getBoundingClientRect();
    const btnBox = btn.getBoundingClientRect();
    return {
      scrollLeft: nav.scrollLeft,
      // Visível de verdade: dentro das bordas do trilho, não só no DOM.
      fullyVisible: btnBox.left >= navBox.left - 1 && btnBox.right <= navBox.right + 1
    };
  });

  expect(state.scrollLeft, 'a barra não rolou').toBeGreaterThan(before);
  expect(state.fullyVisible, 'a aba ativa ficou fora da área visível da barra').toBe(true);
});

test('voltar ao topo devolve o destaque para a primeira categoria', async ({ page }) => {
  await bootMenu(page);
  const slugs = await page.evaluate(() =>
    [...document.querySelectorAll('.menu-section')].map((s) => s.id)
  );

  await scrollToSection(page, slugs[3]);
  expect(await activeSlug(page)).toBe(await expectedSlug(page));
  expect(await activeSlug(page)).not.toBe(slugs[0]);

  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'auto' }));
  await page.waitForTimeout(600);
  expect(await activeSlug(page)).toBe(slugs[0]);
});
