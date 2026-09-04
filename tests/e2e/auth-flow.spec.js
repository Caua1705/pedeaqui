import { test, expect } from '@playwright/test';
import {
  mockApi, seedPickupSession, addH2OToCart, esperarAppPronto,
  AUTH_CONTA, RESTAURANT_URL
} from './helpers.js';

// ============================================================================
//  A CONTA: entrar, cadastrar, recuperar a senha.
//
//  O MAIOR BURACO DE COBERTURA do repositório até 03/09/2026, e ele tinha um
//  formato específico: existiam TRÊS specs de auth (auth-screen-nav,
//  login-entry-paths, verify-email-code) e nenhuma delas fazia login. As duas
//  primeiras afirmam sobre NAVEGAÇÃO e layout — qual camada abre, o scroll da
//  Home, a barra de baixo — e não tocam a rede; a terceira cobre um ramo só
//  (200 com `verified:false`).
//
//  O resultado: `POST /auth/login`, `/auth/register`, `/auth/forgot-password`,
//  `/auth/verify-reset-code` e `/auth/reset-password` nunca foram exercidas
//  por teste nenhum. E como `mockApi()` não as declarava, elas caíam no
//  catch-all 404 — então nem por acidente um spec passaria por ali.
//
//  O que estes testes guardam, em ordem de custo se quebrar:
//
//  1. O TOKEN. Entrar guarda a sessão; falhar NÃO guarda nada. Um front que
//     grave token numa recusa deixa a pessoa "logada" com credencial que o
//     backend não emitiu — e o próximo 401 vira tela quebrada, não login.
//  2. O PAYLOAD. É a §12.10 pelo lado da conta: o corpo que sai tem de ser o
//     que o contrato declara. `mockApi()` confere o corpo contra o
//     `openapi.json` antes de qualquer rota, e é assim que este arquivo
//     descobriu que o cadastro mandava um campo que a API não tem.
//  3. A CADEIA DA RECUPERAÇÃO: e-mail -> código -> `reset_token` -> senha
//     nova. São três rotas e o token da segunda alimenta a terceira; qualquer
//     elo mudo deixa a pessoa sem caminho de volta para a própria conta.
//  4. A SACOLA ATRAVESSA. Entrar no meio do pedido não pode custar o pedido.
// ============================================================================

const json = (body, status = 200) => ({
  status,
  contentType: 'application/json',
  body: JSON.stringify(body)
});

async function abrirApp(page, opcoes = {}) {
  await page.setViewportSize({ width: 390, height: 844 });
  const mock = await mockApi(page, opcoes);
  await seedPickupSession(page);
  await page.goto(RESTAURANT_URL);
  await esperarAppPronto(page);
  await page.evaluate(() => window.RapidexActions.resolve('closeOperationScreen')?.());
  return mock;
}

const tokenGuardado = (page) =>
  page.evaluate(() => localStorage.getItem('rapidex.customer.token'));

// A FOLHA DE LOGIN NÃO É O FORMULÁRIO. `openLoginScreen()` abre o #loginModal,
// que oferece "Cadastre-se" e "Entrar"; o formulario (#loginScreen) sai do
// segundo. Um spec que chame openLoginScreen e ja procure o campo de senha
// espera por um elemento que ninguem abriu.
async function abrirLogin(page) {
  await page.evaluate(() => window.openLoginScreen('profile'));
  await expect(page.locator('#loginModal')).toHaveClass(/active/);
  await page.locator('#loginModal .login-secondary').click();
  await expect(page.locator('#loginScreen')).toHaveClass(/active/);
}

async function abrirCadastro(page) {
  await page.evaluate(() => window.openLoginScreen('profile'));
  await expect(page.locator('#loginModal')).toHaveClass(/active/);
  await page.locator('#loginModal .cart-cta-btn').click();
  await expect(page.locator('#registerScreen')).toHaveClass(/active/);
}

async function aceitarPrivacidade(page) {
  // ESCOPADO NO #registerScreen. Este seletor era único até 04/09/2026, quando a
  // tela de completar o cadastro do Google (`#googleSignupScreen`) ganhou o
  // mesmo par de caixas — e um `label.reg-check` sem escopo passou a casar dois
  // elementos. O modo estrito do Playwright acusou na hora, que é o desfecho
  // bom; um seletor único por acidente é o que fica esperando o segundo.
  const caixa = page.locator('#registerScreen label.reg-check').filter({ hasText: 'política de privacidade' });
  await caixa.locator('.reg-check-box').click();
  await expect(page.locator('#regPrivacy')).toBeChecked();
}

async function preencherLogin(page, { login, senha }) {
  await page.locator('#loginEmail').fill(login);
  await page.locator('#loginPassword').fill(senha);
  await page.locator('#loginSubmitBtn').click();
}

test('entrar guarda a sessão e devolve a pessoa ao lugar de onde saiu', async ({ page }) => {
  const { loginRequests } = await abrirApp(page);
  // A sacola é montada ANTES do login: entrar no meio do pedido não pode
  // custar o pedido, e é o caminho real de quem clica em "Entrar" no checkout.
  await addH2OToCart(page, 2);

  await abrirLogin(page);
  await preencherLogin(page, { login: AUTH_CONTA.login, senha: AUTH_CONTA.senha });

  // O que o app MANDOU: o contrato de LoginRequest é `{login, password}` — o
  // campo único aceita e-mail ou telefone e o nome dele é `login`, não `email`.
  await expect.poll(() => loginRequests.length).toBe(1);
  expect(loginRequests[0].body).toEqual({
    login: AUTH_CONTA.login,
    password: AUTH_CONTA.senha
  });

  // O que o app GUARDOU: o token do backend, e o cliente da resposta.
  await expect.poll(() => tokenGuardado(page)).toBe(AUTH_CONTA.token);
  await expect(page.locator('#loginScreen')).not.toHaveClass(/active/);

  // E a sacola atravessou o login inteira.
  await page.evaluate(() => window.openModal('cartModal'));
  await expect(page.locator('#cartList .cart-item-row')).toHaveCount(1);
  await expect(page.locator('#cartItemCountLabel')).toContainText('2');
});

test('entrar pelo TELEFONE chega na mesma conta, e vai em dígitos', async ({ page }) => {
  // O campo é um só e aceita os dois. Quem digita com máscara não pode ser
  // recusado por causa dela: o front manda dígitos.
  const { loginRequests } = await abrirApp(page);
  await abrirLogin(page);
  await preencherLogin(page, { login: '(85) 99999-0000', senha: AUTH_CONTA.senha });

  await expect.poll(() => loginRequests.length).toBe(1);
  expect(loginRequests[0].body.login).toBe(AUTH_CONTA.telefone);
  await expect.poll(() => tokenGuardado(page)).toBe(AUTH_CONTA.token);
});

test('senha errada NÃO guarda token, e a tela diz o que houve', async ({ page }) => {
  const { loginRequests } = await abrirApp(page);
  await abrirLogin(page);
  await preencherLogin(page, { login: AUTH_CONTA.login, senha: 'senha-errada-8' });

  await expect.poll(() => loginRequests.length).toBe(1);
  await expect(page.locator('#lgnSummary')).toBeVisible();
  await expect(page.locator('#lgnSummary')).toContainText('incorretos');

  // O PONTO CARO: nada guardado. Uma recusa que grava token deixa a pessoa
  // "logada" com credencial que o backend não emitiu.
  expect(await tokenGuardado(page)).toBeNull();
  // E a tela fica onde estava, com o botão de volta ao normal.
  await expect(page.locator('#loginScreen')).toHaveClass(/active/);
  await expect(page.locator('#loginSubmitBtn')).toBeEnabled();
});

test('o cadastro manda o que o contrato declara — e só isso', async ({ page }) => {
  const { registerRequests } = await abrirApp(page);
  await abrirCadastro(page);

  await page.locator('#regFullName').fill('Cliente Novo');
  await page.locator('#regEmail').fill('novo@exemplo.com');
  await page.locator('#regPhone').fill('85999998888');
  await page.locator('#regBirth').fill('12041990');
  await page.locator('#regPassword').fill('senha-do-e2e-8');
  await page.locator('#regPasswordConfirm').fill('senha-do-e2e-8');
  // O <input> real fica ATRAS do quadrado desenhado (.reg-check-box) e fora
  // da viewport ate a rolagem chegar nele: um .check() direto espera para
  // sempre por um alvo que nao recebe clique. Quem recebe o toque da pessoa e
  // o quadrado, e clicar nele e o gesto de verdade.
  await aceitarPrivacidade(page);
  await page.locator('#regSubmitBtn').click();

  await expect.poll(() => registerRequests.length).toBe(1);
  const corpo = registerRequests[0].body;

  // Os seis obrigatórios de RegisterCustomerRequest, com os tipos do contrato:
  // `phone` em dígitos e `birth_date` em ISO.
  expect(corpo).toMatchObject({
    name: 'Cliente Novo',
    email: 'novo@exemplo.com',
    phone: '85999998888',
    birth_date: '1990-04-12',
    password: 'senha-do-e2e-8',
    privacy_accepted: true
  });
  // E NADA ALÉM DELES. `RegisterCustomerRequest` declara sete campos (os seis
  // acima mais `marketing_opt_in`) e o backend ignora o resto em silêncio —
  // por isso este teste conta as chaves em vez de esperar um 422.
  expect(Object.keys(corpo).sort()).toEqual([
    'birth_date', 'email', 'marketing_opt_in', 'name', 'password', 'phone', 'privacy_accepted'
  ]);

  // Cadastrar NÃO loga: o caminho é a verificação de e-mail, e o e-mail
  // aparece mascarado na tela seguinte.
  await expect(page.locator('#verifyScreen')).toHaveClass(/active/);
  await expect(page.locator('#vfyText')).toContainText('n***@exemplo.com');
  expect(await tokenGuardado(page)).toBeNull();
});

test('o 422 do cadastro vira frase em português, sob o campo certo', async ({ page }) => {
  // O FORMATO É O DE PRODUÇÃO: o FastAPI responde `detail` como ARRAY de
  // {loc, msg, type}, e o `msg` é o texto do pydantic, em INGLÊS. É a mesma
  // família do `ineligibility_reason` que chegava cru ao toast do cupom.
  await abrirApp(page, {
    onRegister: (route) => route.fulfill(json({
      detail: [
        { loc: ['body', 'email'], msg: 'value is not a valid email address', type: 'value_error' },
        { loc: ['body', 'password'], msg: 'String should have at least 8 characters', type: 'string_too_short' }
      ]
    }, 422))
  });
  await abrirCadastro(page);

  await page.locator('#regFullName').fill('Cliente Novo');
  await page.locator('#regEmail').fill('novo@exemplo.com');
  await page.locator('#regPhone').fill('85999998888');
  await page.locator('#regBirth').fill('12041990');
  await page.locator('#regPassword').fill('senha-do-e2e-8');
  await page.locator('#regPasswordConfirm').fill('senha-do-e2e-8');
  // O <input> real fica ATRAS do quadrado desenhado (.reg-check-box) e fora
  // da viewport ate a rolagem chegar nele: um .check() direto espera para
  // sempre por um alvo que nao recebe clique. Quem recebe o toque da pessoa e
  // o quadrado, e clicar nele e o gesto de verdade.
  await aceitarPrivacidade(page);
  await page.locator('#regSubmitBtn').click();

  const erroEmail = page.locator('#regEmailErr');
  await expect(erroEmail).toBeVisible();
  await expect(erroEmail, 'o texto do pydantic não pode chegar ao cliente').not.toContainText(
    'value is not a valid'
  );
  await expect(erroEmail).toContainText('e-mail');

  const erroSenha = page.locator('#regPasswordErr');
  await expect(erroSenha).toBeVisible();
  await expect(erroSenha).not.toContainText('String should have');
  await expect(erroSenha).toContainText('8');

  // E a tela fica: cadastro recusado não avança para a verificação.
  await expect(page.locator('#registerScreen')).toHaveClass(/active/);
  await expect(page.locator('#verifyScreen')).not.toHaveClass(/active/);
});

test('recuperar a senha: e-mail, código, token e senha nova', async ({ page }) => {
  const { forgotRequests, resetCodeRequests, resetPasswordRequests } = await abrirApp(page);
  await abrirLogin(page);
  await page.evaluate(() => window.RapidexActions.resolve('loginForgotPassword')());
  await expect(page.locator('#forgotPasswordScreen')).toHaveClass(/active/);

  await page.locator('#forgotEmail').fill(AUTH_CONTA.login);
  await page.locator('#forgotSubmitBtn').click();

  await expect.poll(() => forgotRequests.length).toBe(1);
  expect(forgotRequests[0].body).toEqual({ email: AUTH_CONTA.login });
  await expect(page.locator('#recoverCodeScreen')).toHaveClass(/active/);

  // O CÓDIGO, DIGITADO COMO A PESSOA DIGITA, e com o foco do APP esperado.
  //
  // Este trecho falhou UMA vez na suíte completa (4 workers) com
  // `element is not enabled` no botão, ou seja com menos de seis dígitos
  // registrados — e a versão anterior preenchia os seis campos por índice, sem
  // esperar o `setTimeout(() => digito0.focus(), 60)` de
  // `openRecoverCodeScreen()`.
  //
  // O EXPERIMENTO DE DOIS BRAÇOS REPROVOU essa hipótese: com o temporizador
  // esticado para 400 ms, os dois braços passaram 3/3. A causa do vermelho
  // continua sem explicação, e está escrito assim de propósito.
  //
  // O que esta versão garante não é a cura: é o DIAGNÓSTICO. Ela espera o foco
  // que o app dá (em vez de tomá-lo), digita como uma pessoa digita — deixando
  // o próprio app andar entre os campos — e afirma que o botão HABILITOU antes
  // de clicar. Se faltar dígito de novo, o vermelho aponta a linha do botão
  // desabilitado, e não um clique que fica 30 s tentando.
  const digitos = page.locator('#recCode .vfy-digit');
  await expect(digitos.first()).toBeFocused();
  await page.keyboard.type(AUTH_CONTA.codigo);
  await expect(page.locator('#recSubmitBtn')).toBeEnabled();
  await page.locator('#recSubmitBtn').click();

  await expect.poll(() => resetCodeRequests.length).toBe(1);
  expect(resetCodeRequests[0].body).toEqual({ email: AUTH_CONTA.login, code: AUTH_CONTA.codigo });
  await expect(page.locator('#resetPasswordScreen')).toHaveClass(/active/);

  await page.locator('#resetNewPw').fill('senha-nova-do-e2e');
  await page.locator('#resetConfirmPw').fill('senha-nova-do-e2e');
  await page.locator('#resetPwSubmitBtn').click();

  // O ELO QUE NINGUÉM VÊ: o `reset_token` que voltou do código é o que vai na
  // troca de senha. Se ele se perder no caminho, a tela mostra o mesmo
  // formulário e o backend recusa — e o único jeito de saber é este.
  await expect.poll(() => resetPasswordRequests.length).toBe(1);
  expect(resetPasswordRequests[0].body).toEqual({
    reset_token: AUTH_CONTA.resetToken,
    new_password: 'senha-nova-do-e2e',
    confirm_password: 'senha-nova-do-e2e'
  });

  // Trocar a senha NÃO loga: o caminho termina no login, com o e-mail já
  // preenchido — e sem token nenhum guardado.
  await page.locator('.vfy-alert-btn').click();
  await expect(page.locator('#loginScreen')).toHaveClass(/active/);
  await expect(page.locator('#loginEmail')).toHaveValue(AUTH_CONTA.login);
  expect(await tokenGuardado(page)).toBeNull();
});

test('e-mail não cadastrado no "esqueci a senha" não vira código enviado', async ({ page }) => {
  const { resetCodeRequests } = await abrirApp(page);
  await abrirLogin(page);
  await page.evaluate(() => window.RapidexActions.resolve('loginForgotPassword')());

  await page.locator('#forgotEmail').fill('ninguem@exemplo.com');
  await page.locator('#forgotSubmitBtn').click();

  // O 404 do backend vira o cartão de "não encontrado", e a tela do código
  // NÃO abre: avançar ali seria pedir um código que nunca foi enviado.
  await expect(page.locator('#forgotNotFoundModal')).toHaveClass(/active/);
  await expect(page.locator('#recoverCodeScreen')).not.toHaveClass(/active/);
  expect(resetCodeRequests).toHaveLength(0);
});

test('o cliente logado que o backend não reconhece mais perde a sessão', async ({ page }) => {
  // O 401 em /customers/me é a única forma de o app saber que o token morreu.
  // Sem esta limpeza a pessoa fica presa numa tela de conta que não carrega.
  await abrirApp(page);
  await page.evaluate((token) => {
    localStorage.setItem('rapidex.customer.token', token);
  }, 'token-que-o-backend-nao-conhece');
  await page.route(/\/customers\/me(\?|$)/, (route) =>
    route.fulfill(json({ detail: 'Não autenticado' }, 401))
  );

  await page.evaluate(() => window.PedeAquiAuthFlow.syncCustomerSession());
  expect(await tokenGuardado(page)).toBeNull();
  expect(await page.evaluate(() => localStorage.getItem('rapidex.customer.profile'))).toBeNull();
});
