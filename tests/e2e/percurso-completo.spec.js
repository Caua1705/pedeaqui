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

  // `RegisterCustomerResponse` nao traz `access_token` — o contrato e
  // `customer_id, email, message, requires_email_verification` e mais nada.
  // O que vem depois e a tela de seis digitos.
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

  // E AQUI A PESSOA ESTA LOGADA. `entrarAposCadastro()` pede a sessao com as
  // credenciais que ela acabou de digitar, porque a rota de verificacao nao
  // devolve token sem ticket do Google. Ate 05/09/2026 ela saia daqui com um
  // cliente LOCAL, e o cartao — o unico caminho que exige conta — batia num
  // pedido de login que o Pix nao fazia.
  //
  // O TOKEN e a assercao certa, nao o nome na tela: `applyLocalCustomer` grava
  // o perfil sem sessao nenhuma, entao "aparece o nome" passava nos dois
  // mundos. E o token que separa um do outro.
  await expect.poll(() => page.evaluate(
    () => !!localStorage.getItem('rapidex.customer.token')
  ), { message: 'cadastrar tem de deixar a pessoa LOGADA, não só com perfil local' }).toBe(true);
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

      // NAO HA DESVIO POR LOGIN AQUI, e ate 05/09/2026 havia.
      //
      // Cadastrar nao logava: quem acabava de criar a conta seguia com um
      // cliente LOCAL, sem token. Pelo Pix pagava do mesmo jeito; pelo cartao
      // batia num pedido de login — duas regras de conta em dois caminhos de
      // pagamento. Hoje `entrarAposCadastro()` pede a sessao com as credenciais
      // que a pessoa acabou de digitar, e as duas colunas desta tabela chegam
      // ao cartao pelo MESMO caminho. Se o desvio voltar, este teste acusa.

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
//  A FOLHA DE LOGIN DO CARTAO ABRIA POR BAIXO DA TELA DE PAGAMENTO.
//
//  O cliente tocava em "Cadastrar novo cartao" e A TELA NAO MUDAVA. Nada: sem
//  toast, sem erro, sem navegacao — a foto depois do toque era identica a de
//  antes. O app fazia a coisa certa e ela nao chegava a ele.
//
//  Medido em 390x844, ANTES da correcao:
//
//      #paymentMethodModal   z-index 280      <- por cima
//      #loginModal           z-index 200      <- a folha que o app quis mostrar
//      botao "Entrar":  x=18 y=417 354x45     (meio da tela)
//      document.elementFromPoint(centro) -> DIV.payment-method-content
//
//  E nao era so a primeira folha: a pilha de conta INTEIRA ficava no nivel do
//  pagamento ou abaixo — `.lgn-screen` e `.reg-screen` em 270, `.vfy-screen`
//  em 280 (empate com o pagamento, decidido pela ordem no DOM). Hoje: 305 para
//  a folha, 306 para os formularios, 307 para a verificacao, todos acima dos
//  302 do topo da pilha de pagamento e abaixo dos 320 do `.vfy-alert-overlay`.
//
//  POR QUE ESTE TESTE NAO AFIRMA `toHaveClass(/active/)`:
//  porque essa assercao PASSAVA com a folha embaixo. O `#loginModal` recebia
//  `active`, com `display:flex` e `opacity:1` — classe nao e visibilidade
//  quando ha z-index no meio, e nenhum portao pegou por isso. E a familia da
//  §12.14 com o sinal trocado: la o DOM dizia escondido e o olho via; aqui o
//  DOM dizia aberto e o olho nao via.
//
//  As DUAS assercoes abaixo sao de propriedades diferentes, e as duas importam:
//
//   1. `elementFromPoint` — a unica pergunta que o dedo do cliente faz. Ela
//      NOMEIA quem esta por cima quando falha, que e o diagnostico.
//   2. o CLIQUE de verdade, seguido do efeito. Um clique interceptado faz o
//      Playwright esperar ate o teto e dizer "subtree intercepts pointer
//      events" — e o efeito (`#loginScreen` ativo) prova que o toque chegou ao
//      destino, nao so que havia um alvo no ponto.
//
//  Vista vermelha com os quatro z-index revertidos: a (1) falha em ~1 s
//  nomeando `DIV.payment-method-content`, e sem ela a (2) gastaria 30 s ate o
//  teto do teste. Por isso a mais barata vem primeiro (§13.3: afirme o
//  observavel antes do mecanismo, e o mais externo antes do mais interno).
// ────────────────────────────────────────────────────────────────────────────
test('a folha de login do cartão abre por cima da tela de pagamento, e o toque a alcança', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockApi(page);
  await seedOnlineCardBranch(page);
  await page.route('**/payment-config', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ provider: 'mercadopago', public_key: 'APP_USR-e2e-public-key', card_enabled: true })
  }));
  // PERFIL LOCAL SEM TOKEN. Desde que cadastrar passou a logar, este estado
  // deixou de ser a saida normal do cadastro — mas continua existindo: e o
  // ramo de degradacao de `entrarAposCadastro()` (a conta foi criada, o
  // e-mail verificado, e o login seguinte falhou), e e o de quem se cadastrou
  // ANTES desta mudanca e voltou ao app com o perfil guardado.
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

  await expect(page.locator('#loginModal')).toHaveClass(/active/);

  const entrar = page.locator('#loginModal .login-secondary');

  // ESPERAR A FOLHA ASSENTAR ANTES DE PERGUNTAR QUEM RECEBE O TOQUE.
  //
  // Ela entra deslizando, e `elementFromPoint` responde sobre um INSTANTE.
  // Medido nesta tela: aos 200 ms o botão está em x=155 (a meio caminho), e
  // antes disso o centro dele cai FORA da viewport — onde `elementFromPoint`
  // devolve `null`, não o elemento de cima. A primeira versão deste teste caiu
  // assim, com `quem recebe o toque: null`, e o defeito JÁ ESTAVA CORRIGIDO:
  // eu estava medindo a animação, não a camada (§11, armadilha 1).
  //
  // A espera é por CONDIÇÃO — três quadros com o mesmo retângulo —, não por um
  // prazo chutado: máquina lenta só aumenta o número de quadros, que é o lado
  // seguro. É o mesmo `esperarAssentar` de pix-payment.spec.js.
  await entrar.evaluate(elemento => new Promise(resolve => {
    let anterior = '';
    let iguais = 0;
    const olhar = () => {
      const r = elemento.getBoundingClientRect();
      const agora = `${r.x}|${r.y}|${r.width}|${r.height}`;
      iguais = agora === anterior ? iguais + 1 : 0;
      anterior = agora;
      if (iguais >= 3) return resolve();
      requestAnimationFrame(olhar);
    };
    requestAnimationFrame(olhar);
  }));

  const noPonto = await entrar.evaluate(botao => {
    const r = botao.getBoundingClientRect();
    const alvo = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
    return {
      alcanca: alvo === botao || botao.contains(alvo),
      quemRecebe: alvo ? `${alvo.tagName}.${alvo.className}`.slice(0, 80) : null
    };
  });
  expect(noPonto.alcanca, `quem recebe o toque no botão "Entrar": ${noPonto.quemRecebe}`).toBe(true);

  await entrar.click();
  await expect(page.locator('#loginScreen')).toHaveClass(/active/);
});
