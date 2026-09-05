// ────────────────────────────────────────────────────────────────────────────
//  O PERCURSO INTEIRO, NAS OITO COMBINACOES — do cardapio ao pagamento pago.
//
//  Por que ele existe, medido antes de escrever uma linha: dos SETE specs que
//  chegam a `POST /orders`, exatamente UM (club-coupons) tem sessao logada. Os
//  outros seis pedem como VISITANTE. E dos cinco specs que fazem login de
//  verdade, NENHUM pede. Ou seja, o cruzamento "quem tem conta faz um pedido e
//  paga" — que e o caminho da esmagadora maioria dos clientes — nao era
//  percorrido por teste nenhum.
//
//  Isso NAO e falta de cobertura das partes: cada perna esta bem guardada
//  (auth-flow prova a conta, pix-payment prova a cobranca, card-payment-flow
//  prova a tokenizacao, cart-money-chain prova o dinheiro). O que faltava era a
//  COSTURA — e e nela que moram os defeitos que sobrevivem a suites verdes,
//  porque cada dono olha so o seu pedaco.
//
//  As oito combinacoes sao as tres perguntas que mudam o caminho:
//    conta      NOVA (cadastro pela tela) x EXISTENTE (sessao ja gravada)
//    modalidade ENTREGA (endereco, taxa)  x RETIRADA (sem endereco)
//    pagamento  PIX (cobranca + polling)  x CARTAO ONLINE (tokenizacao)
//
//  DUAS ARMADILHAS que este arquivo paga adiantado, as duas da skill:
//
//  1. `seedOnlineCardBranch(page)` vem DEPOIS de `mockApi(page)` — no Playwright
//     a rota registrada por ULTIMO vence. E ele e obrigatorio: o fixture de
//     filial e copia fiel da producao, e la `credit_card` so existe no grupo
//     `delivery` (a maquininha na porta). Sem ele o cartao online nao cabe.
//
//  2. `confirmOrderSheet(page)` e obrigatorio. Um percurso que clique so no CTA
//     da sacola NUNCA ve o `POST /orders` — a folha de confirmacao fica entre
//     os dois.
// ────────────────────────────────────────────────────────────────────────────
import { test, expect } from '@playwright/test';
import {
  mockApi,
  addH2OToCart,
  confirmOrderSheet,
  pixOrder,
  trackedOrder,
  seedOnlineCardBranch,
  RESTAURANT_URL,
  SLUG,
  BRANCH_MATRIZ,
  esperarAppPronto
} from './helpers.js';

const ENDERECO = {
  street: 'Rua Andrade Furtado',
  number: '955',
  complement: 'Ao 1802 bloco LUZ',
  neighborhood: 'Cocó',
  city: 'Fortaleza',
  state: 'Ceará',
  postal_code: '60190090',
  summary: 'Rua Andrade Furtado, 955 - Cocó'
};

/**
 * A sessao de quem JA TEM CONTA. Token + perfil sao globais (a conta e do
 * Rapidex, nao do restaurante); o contexto de operacao e por slug.
 */
async function semearContaExistente(page, { modalidade }) {
  await page.addInitScript(({ slug, branchId, endereco, tipo }) => {
    localStorage.setItem('rapidex.customer.token', 'e2e-percurso-token');
    localStorage.setItem('rapidex.customer.profile', JSON.stringify({
      id: 'customer-e2e',
      name: 'Cliente Teste',
      phone: '85999999999',
      email: 'cliente.e2e@example.com'
    }));
    if (tipo === 'delivery') localStorage.setItem('rapidex.customerAddress', JSON.stringify(endereco));
    localStorage.setItem(`rapidex.operationContext.${slug}`, JSON.stringify({
      order_type: tipo,
      branch_id: branchId,
      branch_label: 'Matriz',
      ...(tipo === 'delivery' ? { address: endereco } : {}),
      confirmed: true
    }));
  }, { slug: SLUG, branchId: BRANCH_MATRIZ, endereco: ENDERECO, tipo: modalidade });
}

/**
 * A sessao de quem AINDA NAO TEM CONTA: so o contexto de operacao, sem token e
 * sem perfil. O cadastro acontece pela TELA, mais adiante no percurso.
 */
async function semearContaNova(page, { modalidade }) {
  await page.addInitScript(({ slug, branchId, endereco, tipo }) => {
    if (tipo === 'delivery') localStorage.setItem('rapidex.customerAddress', JSON.stringify(endereco));
    localStorage.setItem(`rapidex.operationContext.${slug}`, JSON.stringify({
      order_type: tipo,
      branch_id: branchId,
      branch_label: 'Matriz',
      ...(tipo === 'delivery' ? { address: endereco } : {}),
      confirmed: true
    }));
  }, { slug: SLUG, branchId: BRANCH_MATRIZ, endereco: ENDERECO, tipo: modalidade });
}

/**
 * O cadastro PELA TELA, com os tres gestos que a §16.4 registra como
 * contra-intuitivos: a folha de login NAO e o formulario, o formulario de
 * cadastro sai do PRIMEIRO botao, e o checkbox de privacidade e um <input>
 * atras de um quadrado desenhado — quem recebe o toque e o quadrado.
 */
async function cadastrarPelaTela(page) {
  await page.evaluate(() => window.openLoginScreen('profile'));
  await expect(page.locator('#loginModal')).toHaveClass(/active/);
  await page.locator('#loginModal .cart-cta-btn').click();
  await expect(page.locator('#registerScreen')).toHaveClass(/active/);

  await page.locator('#regFullName').fill('Cliente Novo');
  await page.locator('#regEmail').fill('novo@exemplo.com');
  await page.locator('#regPhone').fill('85999998888');
  await page.locator('#regBirth').fill('12041990');
  await page.locator('#regPassword').fill('senha-do-e2e-8');
  await page.locator('#regPasswordConfirm').fill('senha-do-e2e-8');
  const caixa = page.locator('#registerScreen label.reg-check').filter({ hasText: 'política de privacidade' });
  await caixa.locator('.reg-check-box').click();
  await expect(page.locator('#regPrivacy')).toBeChecked();
  await page.locator('#regSubmitBtn').click();

  // CADASTRAR NAO LOGA, e o percurso so descobre isso aqui.
  // `RegisterCustomerResponse` nao tem `access_token` — o contrato diz
  // `customer_id, email, message, requires_email_verification` e mais nada. O
  // que vem depois e a tela de seis digitos, e o proprio auth-flow escreve o
  // desfecho: "Nao vem token: verificacao nao loga. A conta local do fluxo de
  // cadastro e o que o cliente digitou". Ou seja, quem acaba de se cadastrar
  // seque para o checkout com um cliente LOCAL, sem sessao — e e assim que ele
  // pede. O `tracking_token` e a porta dele para o proprio pedido (§6).
  await expect(page.locator('#verifyScreen')).toHaveClass(/active/);

  // ESPERAR O FOCO QUE O APP DA, em vez de tomar o foco por um clique:
  // `openVerifyScreen()` termina com um `setTimeout(..., 60)` que devolve o
  // foco ao digito 0. Com a maquina ocupada ele chega no MEIO da digitacao e os
  // seis caracteres se atropelam — o botao nunca habilita (§11, armadilha 3).
  await expect(page.locator('#vfyCode .vfy-digit').first()).toBeFocused();
  await page.keyboard.type('123456');
  await expect(page.locator('#vfySubmitBtn')).toBeEnabled();
  await page.locator('#vfySubmitBtn').click();
  await expect(page.locator('#verifyScreen')).not.toHaveClass(/active/);
}

/**
 * Abre a tela de forma de pagamento a partir da sacola.
 *
 * A GUARDA DO ENDERECO fica aqui de proposito: no fluxo de ENTREGA o CTA da
 * sacola le "Informe seu endereco" enquanto nao houver um, e clicar nele leva
 * para o endereco em vez do pagamento. Afirmar o texto ANTES do clique faz o
 * vermelho dizer "faltou endereco" em vez de "o modal errado abriu".
 */
async function abrirTelaDePagamento(page) {
  await page.evaluate(() => window.openModal('cartModal'));
  const cta = page.locator('#cartCtaBtn');
  await expect(cta).not.toHaveText('Informe seu endereço');
  await expect(cta).not.toHaveText(/pedido mínimo/);
  await cta.click();
}

/**
 * PIX: escolher NAO CONFIRMA. A opcao acende o rodape (`#paymentMethodFooter`)
 * e quem fecha a tela e o `.payment-method-confirm` — um percurso que so clique
 * na opcao fica com o modal aberto por cima da sacola, e o clique seguinte vai
 * para o lugar errado. Foi exatamente o que aconteceu na primeira execucao
 * deste arquivo, nas oito combinacoes.
 */
async function escolherPix(page) {
  await abrirTelaDePagamento(page);
  await page.locator('[data-payment-screen-panel="online"] [data-payment-key="pix"]').click();
  await expect(page.locator('#paymentMethodFooter')).toBeVisible();
  await page.locator('.payment-method-confirm').click();
  await expect(page.locator('#paymentMethodModal')).not.toHaveClass(/active/);
  await expect(page.locator('#cartModal')).toHaveClass(/active/);
  await expect(page.locator('#cartCtaBtn')).toHaveText('Efetuar pagamento');
}

/**
 * CARTAO ONLINE nao e uma `.payment-method-option`. Medido por sonda: o painel
 * `online` mostra UMA opcao (PIX) e o cartao sai por `.payment-add-card`
 * ("Cadastrar novo cartao"), que leva direto a tela do cartao. Procurar
 * `[data-payment-key="card"]` espera para sempre por um elemento que nao existe.
 */
async function escolherCartaoOnline(page) {
  await abrirTelaDePagamento(page);
  await page.locator('.payment-add-card').click();
}

for (const conta of ['existente', 'nova']) {
  for (const modalidade of ['pickup', 'delivery']) {
    const rotulo = `${conta} / ${modalidade === 'pickup' ? 'retirada' : 'entrega'}`;

    test(`${rotulo} / Pix: do cardápio ao pagamento confirmado`, async ({ page }) => {
      const { orderRequests, paymentRequests } = await mockApi(page, {
        orderResponse: pixOrder,
        onTrackOrder: (route, _request, attempt) => route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(trackedOrder(
            attempt >= 2 ? { payment_status: 'paid', status: 'confirmed' } : { payment_status: 'pending' }
          ))
        })
      });
      if (conta === 'existente') await semearContaExistente(page, { modalidade });
      else await semearContaNova(page, { modalidade });

      await page.goto(RESTAURANT_URL);
      await esperarAppPronto(page);

      // O CARDAPIO: a sacola e montada antes de qualquer conta, que e o gesto
      // real de quem chega pelo link do restaurante.
      await addH2OToCart(page, 3);

      if (conta === 'nova') {
        await cadastrarPelaTela(page);
        // A SACOLA ATRAVESSA O CADASTRO. Entrar no meio do pedido nao pode
        // custar o pedido — e o caminho de quem so cria conta no checkout.
        await expect.poll(async () => page.evaluate(
          () => (window.PedeAquiCartStore?.get?.().items || []).length
        )).toBe(1);
      }

      await escolherPix(page);
      await page.locator('#cartCtaBtn').click();
      await confirmOrderSheet(page);

      // O PEDIDO EXISTE, e o payload nao carrega dinheiro nenhum (§3.1).
      await expect.poll(() => orderRequests.length).toBe(1);
      expect(orderRequests[0].body).not.toHaveProperty('total');
      expect(orderRequests[0].body.order_type).toBe(modalidade);

      // A COBRANCA: uma so, e a tela de codigo aparece.
      await expect(page.locator('#pixPaymentModal')).toHaveClass(/active/);
      await expect(page.locator('[data-pix-state=ready]')).toBeVisible();
      expect(paymentRequests).toHaveLength(1);

      // O PAGAMENTO CONFIRMADO leva a tela de sucesso sozinho, pelo polling.
      await expect(page.locator('#orderSuccessModal')).toHaveClass(/active/, { timeout: 30000 });
      await expect(page.locator('#ordSuccessPayment')).toHaveText('Pago');
    });

    test(`${rotulo} / cartão online: do cardápio à tela do cartão`, async ({ page }) => {
      await mockApi(page, { orderResponse: pixOrder });
      // DEPOIS do mockApi, sempre: a ultima rota registrada vence, e o fixture
      // de producao nao aceita cartao online sem esta sobreposicao.
      await seedOnlineCardBranch(page);
      // E a pergunta "a filial habilitou cartao online?" (/info) NAO e a
      // pergunta "o restaurante tem gateway?" (/payment-config). As duas
      // precisam responder sim, e sao rotas diferentes.
      await page.route('**/payment-config', route => route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ provider: 'mercadopago', public_key: 'APP_USR-e2e-public-key', card_enabled: true })
      }));
      if (conta === 'existente') await semearContaExistente(page, { modalidade });
      else await semearContaNova(page, { modalidade });

      await page.goto(RESTAURANT_URL);
      await esperarAppPronto(page);
      await addH2OToCart(page, 3);

      if (conta === 'nova') {
        await cadastrarPelaTela(page);
        await expect.poll(async () => page.evaluate(
          () => (window.PedeAquiCartStore?.get?.().items || []).length
        )).toBe(1);
      }

      await escolherCartaoOnline(page);

      if (conta === 'nova') {
        // QUEM ACABOU DE SE CADASTRAR AINDA PRECISA ENTRAR — e so o CARTAO
        // cobra isso. Com cliente LOCAL e sem token, tocar em "Cadastrar novo
        // cartao" abre o `#loginModal`. A DECISAO esta certa (cartao salvo
        // pertence a uma conta, e a cobranca no cartao exige Bearer do cliente
        // — sem ele o backend responde 401 `login_required`).
        //
        // O QUE NAO ESTA CERTO E ONDE ESSA FOLHA ABRE, e o percurso para aqui
        // de proposito: ver o teste `test.fail` logo abaixo. Pelo Pix o mesmo
        // cliente recem-cadastrado paga sem entrar; o cartao e o unico caminho
        // que exige a conta, e e justamente onde a folha nao aparece.
        await expect(page.locator('#loginModal')).toHaveClass(/active/);
        return;
      }

      // SAO DUAS TELAS, nao uma. `.payment-add-card` abre o `#addCardTypeModal`
      // (credito ou debito) e so a escolha do TIPO leva ao formulario
      // `#creditCardModal`. O percurso so descobriu isso errando: a primeira
      // versao esperava um `#paymentCardModal` que nao existe em lugar nenhum
      // do repositorio — e um id inventado falha com "element(s) not found",
      // que e a mensagem certa e nao se confunde com "a tela nao abriu".
      await expect(page.locator('#addCardTypeModal')).toHaveClass(/active/);
      await page.locator('#addCreditCardOption').click();

      // A COSTURA e o que este arquivo guarda: que a pessoa CHEGA ao formulario
      // do cartao nas quatro combinacoes de conta e modalidade. Quem prova a
      // tokenizacao dali ate o "aprovado" — com o SDK dublado, o CVV do cartao
      // salvo e o Bearer na cobranca — e card-payment-flow.spec.js, e repetir
      // aquilo aqui seria a segunda copia do mesmo teste.
      await expect(page.locator('#creditCardModal')).toHaveClass(/active/);
    });
  }
}

// ────────────────────────────────────────────────────────────────────────────
//  DEFEITO ABERTO, ACHADO POR ESTE PERCURSO EM 05/09/2026.
//
//  Quem acabou de se cadastrar (cliente LOCAL, sem token) toca em "Cadastrar
//  novo cartao" e a TELA NAO MUDA. Nada. Sem toast, sem erro, sem navegacao —
//  a foto da sonda mostra a mesma "Formas de pagamento" de antes do toque.
//
//  O app fez a coisa certa e ela nao chegou ao cliente: `#loginModal` RECEBE
//  `active`, com `display:flex` e `opacity:1`. Ele so abre DEBAIXO da tela de
//  pagamento. Medido em 390x844:
//
//      #paymentMethodModal   z-index 280   (por cima)
//      #loginModal           z-index 200   (a folha que o app quis mostrar)
//      #cartModal            z-index 200
//
//      botao "Entrar" da folha:      x=18 y=417 354x45  — meio da tela
//      document.elementFromPoint(centro do botao)  ->  DIV.payment-method-content
//
//  Ou seja: a folha esta desenhada, o DOM diz que esta ativa, e NENHUM toque a
//  alcanca. E a familia da §12.14 (`[hidden]` perdendo para o CSS) com o sinal
//  trocado — la o DOM dizia escondido e o olho via; aqui o DOM diz aberto e o
//  olho nao ve.
//
//  POR QUE NENHUM PORTAO PEGOU: a asserção natural é `toHaveClass(/active/)`, e
//  ela PASSA. Classe nao e visibilidade quando ha z-index no meio. Quem pega e
//  `elementFromPoint`, que e a unica pergunta que o dedo do cliente faz.
//
//  NAO FOI CONSERTADO NESTA RODADA por instrucao ("so LISTE nesta primeira
//  passada"). O teste abaixo esta marcado `test.fail()`: ele afirma o
//  comportamento CERTO e hoje falha de proposito. **No dia em que alguem
//  corrigir a camada, ele fica VERMELHO dizendo "passou mas era esperado que
//  falhasse" — e esse e o sinal para tirar o `test.fail()` daqui.**
// ────────────────────────────────────────────────────────────────────────────
test('a folha de login do cartão abre por cima da tela de pagamento, e o toque a alcança', async ({ page }) => {
  // DENTRO do corpo, nunca no topo do arquivo. Um `test.fail()` solto no
  // escopo do modulo marca TODOS os testes do arquivo como esperados-para-
  // falhar: os oito percursos verdes viraram oito vermelhos dizendo
  // "Expected to fail, but passed", e o unico vermelho de verdade sumiu no
  // meio deles. Custou uma execucao.
  test.fail();
  await page.setViewportSize({ width: 390, height: 844 });
  await mockApi(page);
  await seedOnlineCardBranch(page);
  await page.route('**/payment-config', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ provider: 'mercadopago', public_key: 'APP_USR-e2e-public-key', card_enabled: true })
  }));
  // O estado EXATO de quem acabou de se cadastrar e verificar: perfil local,
  // nenhum token. E o mesmo que `cadastrarPelaTela()` deixa.
  await page.addInitScript(({ slug, branchId }) => {
    localStorage.setItem('rapidex.customer.profile', JSON.stringify({
      name: 'Cliente Novo', phone: '85999998888', email: 'novo@exemplo.com'
    }));
    localStorage.setItem(`rapidex.operationContext.${slug}`, JSON.stringify({
      order_type: 'pickup', branch_id: branchId, branch_label: 'Matriz', confirmed: true
    }));
  }, { slug: SLUG, branchId: BRANCH_MATRIZ });

  await page.goto(RESTAURANT_URL);
  await esperarAppPronto(page);
  await addH2OToCart(page, 3);
  await escolherCartaoOnline(page);

  // A folha ABRE — isto ja passa hoje, e e o que torna o defeito invisivel.
  await expect(page.locator('#loginModal')).toHaveClass(/active/);

  // E O TOQUE A ALCANCA — isto e o que falha. A pergunta e feita como o dedo a
  // faz: quem esta no ponto onde o cliente encosta?
  const alcancavel = await page.evaluate(() => {
    const botao = document.querySelector('#loginModal .login-secondary');
    if (!botao) return { erro: 'botao Entrar nao existe' };
    const r = botao.getBoundingClientRect();
    const noPonto = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
    return {
      alcanca: noPonto === botao || botao.contains(noPonto),
      quemRecebe: noPonto ? `${noPonto.tagName}.${noPonto.className}`.slice(0, 80) : null
    };
  });
  expect(alcancavel.alcanca, `quem recebe o toque no botão "Entrar": ${alcancavel.quemRecebe}`).toBe(true);
});
