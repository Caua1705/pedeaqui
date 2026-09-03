import { test, expect } from '@playwright/test';
import { mockApi, addH2OToCart, MENU, SLUG, RESTAURANT_URL, esperarAppPronto } from './helpers.js';

// ============================================================================
//  AS DUAS PORTAS DO LOGIN, e por que elas tinham de ser iguais.
//
//  O #loginModal (a folha "Entre ou cadastre-se") abre por caminhos diferentes,
//  e cada caminho carimba uma classe de ORIGEM nele: `from-bottom-nav`
//  (Perfil/Clube), `from-coupon` (a folha do cupom), `from-add-address`. Essas
//  classes decidem coisas visíveis — o scrim e o z-index —, e por isso a mesma
//  tela chegava de dois jeitos diferentes conforme a porta.
//
//  Este arquivo mede a porta, não o formulário: o que o cliente vê ao ENTRAR e
//  ao VOLTAR.
// ============================================================================

const CELULAR = { width: 414, height: 896 };

/**
 * VISITANTE DE VERDADE: contexto de operação escolhido, e NADA de conta.
 *
 * Não dá para usar `seedPickupSession()` aqui — ela grava
 * `rapidex.customer.profile`, e com um perfil no armazenamento o Perfil
 * renderiza a tela de quem já se identificou em vez de abrir o login. O que
 * este arquivo mede é justamente a PORTA do login, então a porta precisa
 * abrir.
 */
async function bootVisitante(page) {
  await page.setViewportSize(CELULAR);
  await mockApi(page);
  await page.addInitScript(
    ({ slug, branchId }) => {
      localStorage.setItem(
        `rapidex.operationContext.${slug}`,
        JSON.stringify({ order_type: 'pickup', branch_id: branchId, branch_label: 'Matriz', confirmed: true })
      );
    },
    { slug: SLUG, branchId: MENU.branch_id }
  );
  await page.goto(RESTAURANT_URL);
  await esperarAppPronto(page);
  await page.evaluate(() => window.RapidexActions.resolve('closeOperationScreen')?.());
}

/**
 * As camadas empilhadas, medidas DEPOIS de elas assentarem.
 *
 * A espera não é decoração e não é um sleep: o scrim do #loginModal tem
 * `transition: background .28s`, e ler durante a interpolação devolve um valor
 * intermediário. A primeira versão deste teste lia direto e PASSOU com o
 * defeito injetado — leu `rgba(0,0,0,0)` porque a transição para .42 mal tinha
 * começado. Um teste que passa por chegar cedo demais não afirma nada.
 *
 * O que se espera é um ESTADO DEFINIDO, não um prazo: `getAnimations()` inclui
 * as transições CSS em curso, então lista vazia é "esta camada parou de mudar".
 * Máquina lenta só faz a espera durar mais, que é o lado seguro.
 */
async function camadas(page) {
  await page.waitForFunction(() => ['couponDetailOverlay', 'loginModal']
    .every(id => (document.getElementById(id)?.getAnimations().length ?? 0) === 0));
  return page.evaluate(() => {
    const ler = (id) => {
      const el = document.getElementById(id);
      if (!el) return null;
      const s = getComputedStyle(el);
      return {
        ativa: el.classList.contains('active'),
        fundo: s.backgroundColor,
        z: s.zIndex
      };
    };
    return { cupom: ler('couponDetailOverlay'), login: ler('loginModal') };
  });
}

/** Abre o login pela FOLHA DO CUPOM (visitante, sacola cheia). */
async function loginPeloCupom(page) {
  await addH2OToCart(page, 3);
  await page.evaluate(() => window.RapidexActions.resolve('showHomeTab')?.());
  await page.locator('#couponRail .coupon-use-btn').first().click();
  await expect(page.locator('#couponDetailOverlay')).toHaveClass(/active/);
  await page.locator('.coupon-detail-use').click();
  await expect(page.locator('#loginModal')).toHaveClass(/active/);
}

/** Abre o login pelo PERFIL — para um visitante, a aba já o abre sozinha. */
async function loginPeloPerfil(page) {
  await page.evaluate(() => window.RapidexActions.resolve('mobNavProfile')());
  await expect(page.locator('#loginModal')).toHaveClass(/active/);
}

// ============================================================================
//  O FADE PRETO AO TOCAR "Entrar", que só existia por um dos caminhos.
//
//  Medido, 414x896, visitante:
//    pelo CUPOM  -> #loginModal com `rgba(0,0,0,.42)` SOBRE o
//                   #couponDetailOverlay, que também é `rgba(0,0,0,.42)` e
//                   continua aberto atrás. Dois scrims empilhados dão ~66% de
//                   preto; e ao tocar "Entrar" a classe `signin-open` entra e
//                   derruba SÓ o de cima, de .42 para 0 em .28s, com o de baixo
//                   parado. Esse degrau é o "fade preto estranho".
//    pelo PERFIL -> #loginModal com `rgba(0,0,0,0)` e nenhuma camada atrás.
//                   Tocar "Entrar" não muda nada.
//
//  A diferença estava numa regra só: `from-bottom-nav` tinha o fundo
//  transparente e `from-coupon` não. Hoje as duas têm.
// ============================================================================
test('o login entra com a MESMA camada pelos dois caminhos, e "Entrar" não escurece nada', async ({
  page
}) => {
  await bootVisitante(page);
  await loginPeloCupom(page);

  const peloCupom = await camadas(page);
  expect(peloCupom.cupom.ativa, 'a folha do cupom continua aberta atrás — é para lá que se volta').toBe(true);
  expect(
    peloCupom.login.fundo,
    'o login empilhou um SEGUNDO scrim sobre o scrim da folha do cupom'
  ).toBe('rgba(0, 0, 0, 0)');

  // Tocar "Entrar" não pode mexer na camada: era esse degrau que se via.
  await page.locator('#loginModal .login-secondary').click();
  await expect(page.locator('#loginScreen')).toHaveClass(/active/);
  const depoisDeEntrar = await camadas(page);
  expect(depoisDeEntrar.login.fundo, 'o scrim do login mudou ao abrir o formulário').toBe(
    peloCupom.login.fundo
  );

  // E a comparação que dá nome ao teste: o outro caminho tem de dar o MESMO.
  const outra = await page.context().newPage();
  await bootVisitante(outra);
  await loginPeloPerfil(outra);
  const peloPerfil = await camadas(outra);
  expect(
    peloPerfil.login.fundo,
    'os dois caminhos precisam abrir o login com a mesma camada'
  ).toBe(peloCupom.login.fundo);
  await outra.close();
});
