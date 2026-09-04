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
  await abrirContasConectadas(page);
  return mock;
}

test('a lista mostra o provedor conectado, e desconectar pede a senha', async ({ page }) => {
  const { unlinkRequests } = await entrarEAbrirContas(page, { social: { contas: [CONTA_GOOGLE] } });

  await expect(page.locator('#profConnectedBody .prof-social-name')).toHaveText('Google');
  await expect(page.locator('#profConnectedBody .prof-social-detail')).toContainText('01/08/2026');
  const botao = page.locator('#profConnectedBody .prof-social-unlink');
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
  await expect(page.locator('#profConnectedBody .prof-social-row')).toHaveCount(0);
  await expect(page.locator('#profConnectedBody')).toContainText('só por e-mail e senha');
  // E A OFERTA DE CONECTAR VOLTA. Desconectar não é uma porta que se fecha: quem
  // desconectou por engano refaz sem sair da conta, que é exatamente o caminho
  // que esta tela passou a oferecer em 04/09/2026.
  await expect(page.locator('#profConnectedBody .prof-social-connect')).toBeVisible();
});

test('a ÚNICA forma de entrar não pode ser desconectada — e a tela diz antes do clique', async ({ page }) => {
  // Conta nascida pelo Google: `password_set: false` e um único provedor. O
  // backend responde 400; o que este teste guarda é a tela ANTECIPAR isso. Sem
  // a antecipação a pessoa não descobriria no botão, e sim na próxima vez que
  // tentasse entrar, sem nenhuma pista.
  const { unlinkRequests } = await entrarEAbrirContas(page, {
    social: { contas: [CONTA_GOOGLE], passwordSet: false }
  });

  await expect(page.locator('#profConnectedBody .prof-social-unlink')).toBeDisabled();
  await expect(page.locator('#profConnectedBody .prof-social-locked'))
    .toContainText('única forma de entrar');
  expect(unlinkRequests).toHaveLength(0);
});

// ---------------------------------------------------------------------------
//  CONECTAR O GOOGLE A PARTIR DO PERFIL
//
//  A conta destes testes entra POR E-MAIL E SENHA, e não pelo botão do Google:
//  é a conta que este caminho existe para servir. Entrar pelo Google e depois
//  oferecer "conectar o Google" seria testar um estado que não acontece.
//
//  O QUE O CONTRATO PERMITE HOJE, e é preciso dizer porque a tela seria outra:
//  `LinkGoogleAccountRequest` declara `id_token`, `nonce_token` e `password`, e
//  NADA MAIS — não há prova por código de e-mail nesta rota (conferido em
//  04/09/2026, com o `--check` do backend em dia). Se ela nascer, o que muda é
//  o diálogo; a oferta, o corpo e o redesenho da lista continuam iguais.
// ---------------------------------------------------------------------------

async function entrarPorSenhaEAbrirContas(page, mockOpcoes = {}) {
  const mock = await abrirApp(page, { social: { contas: [] }, ...mockOpcoes });
  await ligarBotaoDoGoogle(page);
  await entrarPorSenha(page);
  await abrirContasConectadas(page);
  return mock;
}

/**
 * Entra pelo formulário de e-mail e senha.
 *
 * A FOLHA DE LOGIN NÃO É O FORMULÁRIO: `openLoginScreen()` abre o `#loginModal`,
 * que oferece "Cadastre-se" e "Entrar", e o formulário sai do segundo (§16.4).
 */
async function entrarPorSenha(page) {
  await page.evaluate(() => window.openLoginScreen('profile'));
  await expect(page.locator('#loginModal')).toHaveClass(/active/);
  await page.locator('#loginModal .login-secondary').click();
  await expect(page.locator('#loginScreen')).toHaveClass(/active/);
  await page.locator('#loginEmail').fill(AUTH_CONTA.login);
  await page.locator('#loginPassword').fill(AUTH_CONTA.senha);
  await page.locator('#loginSubmitBtn').click();
  await expect.poll(() => tokenGuardado(page)).toBe(AUTH_CONTA.token);
}

/**
 * O caminho até as contas conectadas, pelo GESTO.
 *
 * Ela mora dentro de "Gerenciar perfil", ao lado de "Alterar senha" — a mesma
 * família (configuração de acesso à conta). Chamar
 * `openConnectedAccountsScreen` direto pularia justamente a linha que precisa
 * existir, e o teste passaria com o menu vazio.
 */
async function abrirContasConectadas(page) {
  await page.evaluate(() => window.RapidexActions.resolve('mobNavProfile')());
  await page.evaluate(() => window.RapidexActions.resolve('openProfSub')('meusdados'));
  await expect(page.locator('#profSubmeusdados')).toHaveClass(/active/);
  await page.locator('#profSubmeusdados .prof-manage-row', { hasText: 'Contas conectadas' }).click();
  await expect(page.locator('#profConnectedScreen')).toHaveClass(/active/);
}

/** O botão que o SDK falso desenha DENTRO do diálogo de conectar. */
const botaoDoGoogleNoDialogo = (page) => page.locator('#linkGoogleButton #e2eGoogleBtn');

async function tocarNoGoogleDoDialogo(page, idToken) {
  await page.evaluate(token => { window.__idTokenDoE2E = token; }, idToken);
  await botaoDoGoogleNoDialogo(page).click();
}

test('conectar o Google pede a senha, e o corpo é exatamente o do contrato', async ({ page }) => {
  const { linkGoogleRequests, googleNonceRequests, rotasDesconhecidas } =
    await entrarPorSenhaEAbrirContas(page);

  // A conta abre só por e-mail e senha, e a tela diz as duas coisas: que não há
  // provedor conectado, e que dá para conectar um.
  await expect(page.locator('#profConnectedBody')).toContainText('Nenhuma conta conectada');
  const oferta = page.locator('#profConnectedBody .prof-social-connect');
  await expect(oferta).toBeVisible();

  await oferta.click();
  await expect(page.locator('#linkGoogleConfirm')).toHaveClass(/active/);
  // O NONCE É PEDIDO AO ABRIR O DIÁLOGO, e não no boot: o par vale 10 minutos e
  // um pedido no boot já teria vencido quando a pessoa chegasse até aqui.
  await expect(botaoDoGoogleNoDialogo(page)).toBeVisible();
  expect(googleNonceRequests.length).toBeGreaterThanOrEqual(1);

  await page.locator('#linkGooglePassword').fill(AUTH_CONTA.senha);
  await tocarNoGoogleDoDialogo(page, GOOGLE_TOKENS.contaConhecida);

  await expect.poll(() => linkGoogleRequests.length).toBe(1);
  // Igualdade ESTRITA: é a §12.10 pelo lado da conta. Um campo a mais aqui é um
  // campo que o backend descarta em SILÊNCIO (este esquema não é fechado), e um
  // a menos é 422 — as duas metades do mesmo contrato de saída.
  expect(linkGoogleRequests[0].body).toEqual({
    id_token: GOOGLE_TOKENS.contaConhecida,
    nonce_token: GOOGLE_NONCE.nonce_token,
    password: AUTH_CONTA.senha
  });

  // A ROTA DEVOLVE A LISTA JÁ COM O PROVEDOR NOVO, e é ela que a tela redesenha:
  // sem isso a tela discordaria do servidor até alguém recarregar.
  await expect(page.locator('#linkGoogleConfirm')).not.toHaveClass(/active/);
  await expect(page.locator('#profConnectedBody .prof-social-name')).toHaveText('Google');
  await expect(page.locator('#profConnectedBody .prof-social-unlink')).toBeEnabled();
  // E a oferta SAI: um botão que se oferece a fazer o que já está feito é a
  // tela mentindo sobre o estado.
  await expect(page.locator('#profConnectedBody .prof-social-connect')).toHaveCount(0);
  expect(rotasDesconhecidas).toEqual([]);
});

test('a senha errada não conecta, o diálogo diz, e o botão volta ARMADO', async ({ page }) => {
  const { linkGoogleRequests, googleNonceRequests } = await entrarPorSenhaEAbrirContas(page);

  await page.locator('#profConnectedBody .prof-social-connect').click();
  await expect(botaoDoGoogleNoDialogo(page)).toBeVisible();
  const noncesAntes = googleNonceRequests.length;

  await page.locator('#linkGooglePassword').fill('senha-errada-8');
  await tocarNoGoogleDoDialogo(page, GOOGLE_TOKENS.contaConhecida);

  await expect.poll(() => linkGoogleRequests.length).toBe(1);
  // A FRASE FICA. Rearmar sem preservar o erro devolvia a pessoa a um diálogo
  // MUDO logo depois de um erro que EXIGE um segundo toque — a armadilha 5 da
  // §18.4, e o motivo de `armLinkGoogleButton` ter o parâmetro `limparErro`.
  await expect(page.locator('#linkGoogleErr')).toHaveClass(/show/);
  await expect(page.locator('#linkGoogleErr')).toContainText('Senha incorreta');
  await expect(page.locator('#linkGoogleConfirm')).toHaveClass(/active/);
  // E o botão volta ARMADO, com par de nonce NOVO: o `id_token` é de uso único e
  // o par foi gasto. Sem o rearme, o segundo toque não teria como funcionar.
  await expect.poll(() => googleNonceRequests.length).toBeGreaterThan(noncesAntes);
  await expect(botaoDoGoogleNoDialogo(page)).toBeVisible();

  // E nada foi conectado.
  await expect(page.locator('#profConnectedBody .prof-social-connect')).toBeVisible();
});

test('o campo em branco não gasta a credencial: nenhuma requisição sai', async ({ page }) => {
  // O `id_token` do Google é de USO ÚNICO. Mandar um corpo sem senha só para
  // ouvir o 400 gastaria a credencial, e a pessoa teria de tocar no Google de
  // novo sem entender por quê — por isso a checagem do campo vazio é local, e a
  // tela rearma o botão em vez de falar com a rede.
  const { linkGoogleRequests, googleNonceRequests } = await entrarPorSenhaEAbrirContas(page);

  await page.locator('#profConnectedBody .prof-social-connect').click();
  await expect(botaoDoGoogleNoDialogo(page)).toBeVisible();
  const noncesAntes = googleNonceRequests.length;

  await tocarNoGoogleDoDialogo(page, GOOGLE_TOKENS.contaConhecida);

  // O REARME É O RECIBO de que o app terminou de tratar a credencial — sem ele,
  // afirmar "nenhuma requisição saiu" logo depois do clique passaria antes de a
  // requisição ter tido tempo de sair, que é a corrida da §11.
  await expect.poll(() => googleNonceRequests.length).toBeGreaterThan(noncesAntes);
  // O FATO vem antes do mecanismo (§13.3): com a guarda local removida, esta
  // linha reprova com `expected 0, received 1` e nomeia a credencial gasta. A
  // frase na tela é o PORQUÊ, e ela sozinha acusaria só o texto errado.
  expect(linkGoogleRequests).toHaveLength(0);
  await expect(page.locator('#linkGoogleErr')).toContainText('Informe sua senha');
});

test('o Google de OUTRA conta é recusado com 409, e a lista não muda', async ({ page }) => {
  // Um `sub` que já pertence a outra conta é alguém tentando servir a duas. O
  // UNIQUE do banco recusaria de qualquer jeito, mas como 500: o 409 é a recusa
  // com frase, e a tela tem de mostrá-la em vez de um "não foi possível".
  const { linkGoogleRequests } = await entrarPorSenhaEAbrirContas(page);

  await page.locator('#profConnectedBody .prof-social-connect').click();
  await expect(botaoDoGoogleNoDialogo(page)).toBeVisible();
  await page.locator('#linkGooglePassword').fill(AUTH_CONTA.senha);
  await tocarNoGoogleDoDialogo(page, GOOGLE_TOKENS.subDeOutraConta);

  await expect.poll(() => linkGoogleRequests.length).toBe(1);
  await expect(page.locator('#linkGoogleErr')).toContainText('já está conectada a outra conta');
  await expect(page.locator('#linkGoogleConfirm')).toHaveClass(/active/);
  await expect(page.locator('#profConnectedBody .prof-social-connect')).toBeVisible();
});

test('SEM client id não há oferta de conectar — e nenhum nonce é pedido', async ({ page }) => {
  // A mesma decisão do botão da folha de login (§18.3), na outra tela: um
  // "Conectar" que não pode funcionar é pior que nenhum. Aqui seria ainda pior,
  // porque ele abriria um diálogo que pede a senha e não teria o que fazer com
  // ela. Repare que `ligarBotaoDoGoogle` NÃO é chamado.
  const { googleNonceRequests, linkGoogleRequests } = await abrirApp(page, { social: { contas: [] } });
  await entrarPorSenha(page);
  await abrirContasConectadas(page);

  await expect(page.locator('#profConnectedBody')).toContainText('Nenhuma conta conectada');
  await expect(page.locator('#profConnectedBody .prof-social-connect')).toHaveCount(0);
  expect(googleNonceRequests).toHaveLength(0);
  expect(linkGoogleRequests).toHaveLength(0);
});

test('contas conectadas sai do MENU e entra em "Gerenciar perfil"', async ({ page }) => {
  // A DECISÃO QUE ESTE TESTE GUARDA, e o motivo, porque ele é o primeiro lugar
  // onde alguém vai tropeçar ao querer a linha de volta: com UM provedor, uma
  // linha de primeiro nível para dizer "Google: conectado" pesa mais do que
  // informa. Ela mora ao lado de "Alterar senha", que é a mesma família —
  // configuração de acesso à conta.
  //
  // Ela VOLTA para o menu quando houver mais de um provedor. Quando isso
  // acontecer, este teste é INVERTIDO, não apagado (§14.8): o que continua
  // valendo é que existe UM caminho até a tela, e que o "Voltar" devolve para
  // onde se veio. O porquê está em `scratchpad/contas-conectadas-no-menu.md`.
  await abrirApp(page, { social: { contas: [] } });
  await entrarPorSenha(page);
  await page.evaluate(() => window.RapidexActions.resolve('mobNavProfile')());

  const menu = page.locator('.prof-account-list');
  await expect(menu).toBeVisible();
  await expect(menu.locator('.prof-account-row', { hasText: 'Contas conectadas' })).toHaveCount(0);
  // A sonda contra vacuidade: se o menu deixar de ser desenhado, a linha acima
  // passa por não achar NADA — e não por a decisão estar valendo.
  await expect(menu.locator('.prof-account-row', { hasText: 'Gerenciar perfil' })).toHaveCount(1);

  await abrirContasConectadas(page);
  // E o VOLTAR devolve para "Gerenciar perfil", não para o menu do Perfil: a
  // pessoa tocou lá dentro, e é para lá que ela espera voltar. Uma `.prof-sub`
  // própria fecharia dois níveis acima.
  await page.locator('#profConnectedScreen .prof-connected-back').click();
  await expect(page.locator('#profConnectedScreen')).not.toHaveClass(/active/);
  await expect(page.locator('#profSubmeusdados')).toHaveClass(/active/);
  await expect(page.locator('#profSubmeusdados .prof-manage-row').first()).toBeVisible();
});

test('sair de "Gerenciar perfil" com a tela aberta não a deixa armada', async ({ page }) => {
  // A sobreposição guarda o próprio `.active`, e a subtela que a contém some
  // sem apagá-lo. Sem a limpeza na entrada, quem deixasse a tela aberta e
  // trocasse de aba voltaria DIRETO nela — a subtela reaberta com a
  // sobreposição de antes, sem ter tocado em nada.
  await abrirApp(page, { social: { contas: [] } });
  await entrarPorSenha(page);
  await abrirContasConectadas(page);

  // Sai pelo caminho que NÃO passa pelo "Voltar" da sobreposição.
  await page.evaluate(() => window.RapidexActions.resolve('closeProfSub')());
  await page.evaluate(() => window.RapidexActions.resolve('openProfSub')('meusdados'));

  await expect(page.locator('#profSubmeusdados')).toHaveClass(/active/);
  await expect(page.locator('#profConnectedScreen')).not.toHaveClass(/active/);
});
