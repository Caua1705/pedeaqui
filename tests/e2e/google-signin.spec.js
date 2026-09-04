import { test, expect } from '@playwright/test';
import {
  mockApi, seedPickupSession, esperarAppPronto,
  AUTH_CONTA, GOOGLE_TOKENS, GOOGLE_NONCE, CUSTOMER, RESTAURANT_URL
} from './helpers.js';

// ============================================================================
//  ENTRAR COM GOOGLE — os três desfechos, e as contas conectadas.
//
//  `POST /auth/google` responde UMA forma com o campo `status` decidindo qual
//  bloco está preenchido. Os três casos pedem coisas diferentes do cliente, e
//  confundi-los custa caro nos dois sentidos:
//
//    authenticated               entra. Nada a pedir.
//    link_confirmation_required  o `sub` é novo e o e-mail JÁ TEM conta aqui.
//                                NINGUÉM foi logado e NADA foi ligado ainda: um
//                                código saiu por e-mail, e é ELE que autoriza.
//                                Tratar isto como "entrou" seria entregar a
//                                conta de quem já estava aqui a quem provou só
//                                ter o mesmo endereço de e-mail no Google.
//    profile_required            conta nova. Faltam TELEFONE e nascimento, que
//                                o Google não manda e `customers` exige.
//
//  O TELEFONE DO CASO (c) NÃO É BUROCRACIA. Para cliente logado o pedido copia
//  `customers.phone` no snapshot, e é esse número que o ENTREGADOR liga: conta
//  sem telefone é pedido sem para quem ligar. Por isso ele é obrigatório na
//  tela, e não "depois, no perfil".
//
//  O QUE ESTE ARQUIVO **NÃO** EXERCITA, e é preciso dizer: o download do SDK do
//  Google. O `addInitScript` abaixo define `window.google` ANTES do boot, e
//  `ensureSdk()` volta na primeira linha por causa disso — é a armadilha do
//  Mercado Pago (§4 da skill), onde o atraso e a falha do download passaram
//  batidos pela suíte inteira exatamente assim. Quem mede a URL, a tag e a
//  falha de rede é `tests/unit/google-identity.test.js`, sem browser.
// ============================================================================

const json = (body, status = 200) => ({
  status,
  contentType: 'application/json',
  body: JSON.stringify(body)
});

const CLIENT_ID_DO_E2E = 'e2e.apps.googleusercontent.com';

/**
 * O SDK falso do Google.
 *
 * Ele guarda o que `initialize()` recebeu (para o teste conferir o nonce e o
 * client id que saíram daqui) e desenha um botão de verdade, que ao ser clicado
 * chama o `callback` com o `id_token` que o teste escolheu. É o gesto real: o
 * app não chama o callback sozinho em lugar nenhum.
 */
async function instalarGoogleFalso(page) {
  await page.addInitScript(() => {
    window.__gid = { initialize: null, render: null, botoes: 0 };
    window.google = {
      accounts: {
        id: {
          initialize(cfg) { window.__gid.initialize = { ...cfg, callback: undefined }; window.__gid._cb = cfg.callback; },
          renderButton(el, opts) {
            window.__gid.render = opts;
            window.__gid.botoes += 1;
            const botao = document.createElement('button');
            botao.id = 'e2eGoogleBtn';
            botao.type = 'button';
            botao.textContent = 'Continuar com Google';
            botao.addEventListener('click', () => {
              window.__gid._cb?.({ credential: window.__idTokenDoE2E || '' });
            });
            el.appendChild(botao);
          }
        }
      }
    };
  });
}

async function abrirApp(page, opcoes = {}) {
  await page.setViewportSize({ width: 390, height: 844 });
  await instalarGoogleFalso(page);
  const mock = await mockApi(page, opcoes);
  await seedPickupSession(page);
  await page.goto(RESTAURANT_URL);
  await esperarAppPronto(page);
  await page.evaluate(() => window.RapidexActions.resolve('closeOperationScreen')?.());
  return mock;
}

/**
 * Liga o botão neste ambiente.
 *
 * O client id vem de `VITE_GOOGLE_CLIENT_ID` no build, e ele é VAZIO no build
 * do e2e de propósito: um client id de verdade faria a suíte inteira baixar
 * `accounts.google.com` em todo boot. Escrevê-lo aqui, depois do boot,
 * funciona porque `isEnabled()` lê `APP_CONFIG` NA CHAMADA — e é a mesma razão
 * pela qual um acessor não pode virar cópia (§2.1 da skill).
 */
const ligarBotaoDoGoogle = (page, clientId = CLIENT_ID_DO_E2E) =>
  page.evaluate(id => { window.APP_CONFIG.GOOGLE_CLIENT_ID = id; }, clientId);

async function abrirFolhaDeLogin(page) {
  await page.evaluate(() => window.openLoginScreen('profile'));
  await expect(page.locator('#loginModal')).toHaveClass(/active/);
}

async function tocarNoGoogle(page, idToken) {
  await page.evaluate(token => { window.__idTokenDoE2E = token; }, idToken);
  await page.locator('#e2eGoogleBtn').click();
}

const tokenGuardado = (page) =>
  page.evaluate(() => localStorage.getItem('rapidex.customer.token'));

async function digitarCodigo(page, codigo) {
  const digitos = page.locator('#vfyCode .vfy-digit');
  // O app dá o foco sozinho num `setTimeout(60)`; ESPERAR esse foco em vez de
  // tomá-lo é o que impede o temporizador de chegar no meio da digitação e
  // atropelar os seis caracteres (§11, armadilha 3).
  await expect(digitos.first()).toBeFocused();
  await page.keyboard.type(codigo);
  await expect(page.locator('#vfySubmitBtn')).toBeEnabled();
  await page.locator('#vfySubmitBtn').click();
}

// ---------------------------------------------------------------------------

test('SEM client id o botão não aparece — e nenhum nonce é pedido', async ({ page }) => {
  // A decisão que este teste guarda: um "Entrar com Google" que não pode
  // funcionar é PIOR que nenhum. O cliente toca, nada acontece, e ele conclui
  // que o app está quebrado em vez de usar o caminho que funciona ao lado.
  const { googleNonceRequests, rotasDesconhecidas } = await abrirApp(page);
  await abrirFolhaDeLogin(page);

  await expect(page.locator('#loginGoogleBlock')).toBeHidden();
  await expect(page.locator('#e2eGoogleBtn')).toHaveCount(0);
  // E nada foi pedido ao backend por um botão que ninguém ia ver.
  expect(googleNonceRequests).toHaveLength(0);
  expect(rotasDesconhecidas).toEqual([]);
});

test('(a) o sub já conhecido entra, e o par de nonce vai junto do id_token', async ({ page }) => {
  const { googleRequests, googleNonceRequests, rotasDesconhecidas } = await abrirApp(page);
  await ligarBotaoDoGoogle(page);
  await abrirFolhaDeLogin(page);

  await expect(page.locator('#loginGoogleBlock')).toBeVisible();
  await expect(page.locator('#e2eGoogleBtn')).toBeVisible();

  // O NONCE VEM ANTES DO BOTÃO, e o que o Google recebe é o `nonce` — nunca o
  // `nonce_token`, que é a metade que volta para nós. Trocar os dois faria o
  // backend recusar todo login com 400, e a mensagem não diria qual metade.
  expect(googleNonceRequests).toHaveLength(1);
  expect(await page.evaluate(() => window.__gid.initialize)).toMatchObject({
    client_id: CLIENT_ID_DO_E2E,
    nonce: GOOGLE_NONCE.nonce,
    auto_select: false
  });

  await tocarNoGoogle(page, GOOGLE_TOKENS.contaConhecida);

  await expect.poll(() => googleRequests.length).toBe(1);
  // O corpo é EXATAMENTE o que `GoogleSignInRequest` declara, e a igualdade é
  // estrita de propósito: é a §12.10 pelo lado da conta.
  expect(googleRequests[0].body).toEqual({
    id_token: GOOGLE_TOKENS.contaConhecida,
    nonce_token: GOOGLE_NONCE.nonce_token
  });

  await expect.poll(() => tokenGuardado(page)).toBe(AUTH_CONTA.token);
  await expect(page.locator('#loginModal')).not.toHaveClass(/active/);
  expect(rotasDesconhecidas).toEqual([]);
});

test('(b) e-mail que já tem conta NÃO loga: pede o código, e é ele que liga', async ({ page }) => {
  const { verifyCodeRequests } = await abrirApp(page);
  await ligarBotaoDoGoogle(page);
  await abrirFolhaDeLogin(page);
  await tocarNoGoogle(page, GOOGLE_TOKENS.emailComConta);

  // NADA foi guardado no caminho: a resposta do /auth/google deste caso não
  // traz token nenhum, e um front que "entrasse" aqui entregaria a conta de
  // quem já estava aqui a quem só provou ter o mesmo e-mail no Google.
  await expect(page.locator('#verifyScreen')).toHaveClass(/active/);
  expect(await tokenGuardado(page)).toBeNull();
  await expect(page.locator('#vfyHeaderTitle')).toHaveText('Confirmar seu e-mail');

  // NÃO HÁ ROTA DE REENVIO para este código: `/auth/resend-email-code` desiste
  // em silêncio quando o e-mail já está verificado, que é o caso de todas as
  // contas que caem aqui. Um botão "Reenviar" que não reenvia promete e não
  // cumpre, sem dizer por quê.
  await expect(page.locator('#verifyScreen .vfy-resend-row')).toBeHidden();

  await digitarCodigo(page, AUTH_CONTA.codigo);

  await expect.poll(() => verifyCodeRequests.length).toBe(1);
  expect(verifyCodeRequests[0].body).toEqual({
    email: CUSTOMER.email,
    code: AUTH_CONTA.codigo,
    google_link_ticket: GOOGLE_TOKENS.linkTicket
  });
  // E É DAQUI QUE SAI A SESSÃO. Sem ticket a mesma rota responde
  // `{verified, message}` e não loga ninguém; com ticket ela traz o token.
  await expect.poll(() => tokenGuardado(page)).toBe(AUTH_CONTA.token);
  await expect(page.locator('#verifyScreen')).not.toHaveClass(/active/);
});

test('(b) código errado não liga nada e não guarda sessão', async ({ page }) => {
  await abrirApp(page);
  await ligarBotaoDoGoogle(page);
  await abrirFolhaDeLogin(page);
  await tocarNoGoogle(page, GOOGLE_TOKENS.emailComConta);
  await expect(page.locator('#verifyScreen')).toHaveClass(/active/);

  await digitarCodigo(page, '000000');

  // 200 COM `verified: false` É RECUSA. Ler só o HTTP fecharia a tela como
  // sucesso — a mesma lição do cupom (§4 da skill).
  await expect(page.locator('#vfyMsg')).toHaveClass(/is-error/);
  await expect(page.locator('#verifyScreen')).toHaveClass(/active/);
  expect(await tokenGuardado(page)).toBeNull();
});

test('(c) conta nova pede telefone e nascimento, e manda o que o contrato declara', async ({ page }) => {
  const { googleSignupRequests } = await abrirApp(page);
  await ligarBotaoDoGoogle(page);
  await abrirFolhaDeLogin(page);
  await tocarNoGoogle(page, GOOGLE_TOKENS.emailNovo);

  await expect(page.locator('#googleSignupScreen')).toHaveClass(/active/);
  await expect(page.locator('#gsuIntro')).toContainText(GOOGLE_TOKENS.emailDoPerfilNovo);
  await expect(page.locator('#gsuName')).toHaveValue('Cliente do Google');
  expect(await tokenGuardado(page), 'a conta ainda nem existe').toBeNull();

  // SEM TELEFONE NÃO PASSA, e é isso que impede a conta de nascer sem número
  // para o entregador ligar.
  await page.locator('#gsuSubmitBtn').click();
  await expect(page.locator('#gsuPhoneErr')).toHaveClass(/show/);
  expect(googleSignupRequests, 'o app mandou um cadastro sem telefone').toHaveLength(0);

  await page.locator('#gsuPhone').fill('85999990000');
  await page.locator('#gsuBirth').fill('10/05/1990');
  await page.locator('#googleSignupScreen label.reg-check').filter({ hasText: 'política de privacidade' })
    .locator('.reg-check-box').click();
  await expect(page.locator('#gsuPrivacy')).toBeChecked();
  await page.locator('#gsuSubmitBtn').click();

  await expect.poll(() => googleSignupRequests.length).toBe(1);
  expect(googleSignupRequests[0].body).toEqual({
    signup_ticket: GOOGLE_TOKENS.signupTicket,
    // Dígitos, não a máscara: quem digita com parênteses não pode ser recusado
    // por causa deles.
    phone: '85999990000',
    birth_date: '1990-05-10',
    privacy_accepted: true,
    marketing_opt_in: false,
    name: 'Cliente do Google'
  });
  await expect.poll(() => tokenGuardado(page)).toBe(AUTH_CONTA.token);
  await expect(page.locator('#googleSignupScreen')).not.toHaveClass(/active/);
});

test('(c) 409 significa RECOMEÇAR, não "tente outros dados"', async ({ page }) => {
  await abrirApp(page);
  // Entre as duas telas o `sub` foi ligado em outra aba, ou alguém criou conta
  // com esse e-mail. Insistir no formulário nunca sairia do lugar: o caminho é
  // chamar /auth/google de novo, que cai sozinho no caso certo.
  await page.route('**/auth/google', route => route.fulfill(json({
    status: 'profile_required',
    message: 'Falta pouco.',
    email: GOOGLE_TOKENS.emailDoPerfilNovo,
    name: 'Cliente do Google',
    signup_ticket: GOOGLE_TOKENS.ticketConflitado
  })));
  await ligarBotaoDoGoogle(page);
  await abrirFolhaDeLogin(page);
  await tocarNoGoogle(page, GOOGLE_TOKENS.emailNovo);

  await expect(page.locator('#googleSignupScreen')).toHaveClass(/active/);
  await page.locator('#gsuPhone').fill('85999990000');
  await page.locator('#gsuBirth').fill('10/05/1990');
  await page.locator('#googleSignupScreen label.reg-check').filter({ hasText: 'política de privacidade' })
    .locator('.reg-check-box').click();
  await page.locator('#gsuSubmitBtn').click();

  await expect(page.locator('#googleSignupScreen')).not.toHaveClass(/active/);
  await expect(page.locator('#loginModal')).toHaveClass(/active/);
  await expect(page.locator('#loginGoogleError')).toBeVisible();
  expect(await tokenGuardado(page)).toBeNull();
});

// ---------------------------------------------------------------------------
//  CONTAS CONECTADAS
// ---------------------------------------------------------------------------

const CONTA_GOOGLE = {
  provider: 'google',
  linked_at: '2026-08-01T12:00:00Z',
  last_login_at: '2026-09-03T09:30:00Z'
};

async function entrarEAbrirContas(page, mockOpcoes) {
  const mock = await abrirApp(page, mockOpcoes);
  await ligarBotaoDoGoogle(page);
  await abrirFolhaDeLogin(page);
  await tocarNoGoogle(page, GOOGLE_TOKENS.contaConhecida);
  await expect.poll(() => tokenGuardado(page)).toBe(AUTH_CONTA.token);
  await page.evaluate(() => window.RapidexActions.resolve('mobNavProfile')());
  await page.evaluate(() => window.RapidexActions.resolve('openProfSub')('contas'));
  await expect(page.locator('#profSubcontas')).toHaveClass(/active/);
  return mock;
}

test('a lista mostra o provedor conectado, e desconectar pede a senha', async ({ page }) => {
  const { unlinkRequests } = await entrarEAbrirContas(page, { social: { contas: [CONTA_GOOGLE] } });

  await expect(page.locator('#profSubContasBody .prof-social-name')).toHaveText('Google');
  await expect(page.locator('#profSubContasBody .prof-social-detail')).toContainText('01/08/2026');
  const botao = page.locator('#profSubContasBody .prof-social-unlink');
  await expect(botao).toBeEnabled();

  await botao.click();
  await expect(page.locator('#unlinkConfirm')).toHaveClass(/active/);

  // A senha errada não desconecta — e a tela diz. Um mock que só aceita seria
  // um teste que só concorda.
  await page.locator('#unlinkPassword').fill('senha-errada-8');
  await page.locator('#unlinkConfirm .addr-delete-yes').click();
  await expect(page.locator('#unlinkErr')).toHaveClass(/show/);
  await expect(page.locator('#unlinkConfirm')).toHaveClass(/active/);

  await page.locator('#unlinkPassword').fill(AUTH_CONTA.senha);
  await page.locator('#unlinkConfirm .addr-delete-yes').click();

  await expect.poll(() => unlinkRequests.length).toBe(2);
  expect(unlinkRequests[1]).toEqual({ provider: 'google', body: { password: AUTH_CONTA.senha } });
  // A rota DEVOLVE a lista que sobrou, e é ela que a tela redesenha: sem isso a
  // tela discordaria do servidor até alguém recarregar.
  await expect(page.locator('#unlinkConfirm')).not.toHaveClass(/active/);
  await expect(page.locator('#profSubContasBody .prof-social-row')).toHaveCount(0);
  await expect(page.locator('#profSubContasBody')).toContainText('só por e-mail e senha');
});

test('a ÚNICA forma de entrar não pode ser desconectada — e a tela diz antes do clique', async ({ page }) => {
  // Conta nascida pelo Google: `password_set: false` e um único provedor. O
  // backend responde 400; o que este teste guarda é a tela ANTECIPAR isso. Sem
  // a antecipação a pessoa não descobriria no botão, e sim na próxima vez que
  // tentasse entrar, sem nenhuma pista.
  const { unlinkRequests } = await entrarEAbrirContas(page, {
    social: { contas: [CONTA_GOOGLE], passwordSet: false }
  });

  await expect(page.locator('#profSubContasBody .prof-social-unlink')).toBeDisabled();
  await expect(page.locator('#profSubContasBody .prof-social-locked'))
    .toContainText('única forma de entrar');
  expect(unlinkRequests).toHaveLength(0);
});
