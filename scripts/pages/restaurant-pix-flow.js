// ============================================================================
//  Pagamento online por Pix, e o acompanhamento do pedido que sai dele.
//
//  Saiu de scripts/pages/restaurant-page.js na auditoria de 29/08/2026 — 1.064
//  linhas, 61 funções. Segundo corte daquele arquivo.
//
//  O PEDIDO JÁ EXISTE quando esta parte começa: POST /orders respondeu, o
//  carrinho foi limpo e o tracking_token está guardado. O que falta é a
//  cobrança — e é ela, não o pedido, que pode falhar daqui para frente. Por
//  isso nenhum erro daqui volta a falar em "não foi possível criar o pedido":
//  seria mentira, e levaria o cliente a pedir de novo. Essa fronteira é o que
//  torna este bloco separável: ele começa depois do dinheiro ter sido decidido.
//
//  O CÓDIGO NÃO FOI REESCRITO. Corpos verbatim; só a costura abaixo é nova.
//
//  --- A costura, e por que ela aponta para os DOIS lados ---
//
//  No módulo de endereço todo o estado mutável ficou com o restaurant-page, e a
//  seta era de mão única. Aqui não: `pixSession` e `trackedOrder` NASCEM neste
//  bloco, e o restaurant-page também os lê e escreve — a tela de sucesso do
//  pedido zera a sessão de cobrança, guarda o pedido acompanhável, e o gancho
//  de visibilidade da aba retoma a consulta quando o cliente volta do app do
//  banco.
//
//  Então o dono passou a ser ESTE arquivo, e o restaurant-page os alcança pelo
//  objeto `compartilhado`, com getter e setter de verdade:
//
//      P.pixSession = null            -> chama o setter, muda a variável daqui
//      P.pixSession.pollTimer = null  -> escreve na propriedade do mesmo objeto
//
//  É o mesmo idioma do `S` de restaurant-address-flow.js, na direção oposta.
//  Copiar o valor em vez disso daria aos dois lados sessões de Pix diferentes:
//  um pararia de consultar uma cobrança que o outro ainda considera aberta.
//
//  --- O markup ---
//
//  As 13 ações deste fluxo se registram aqui, em RapidexActions, que MESCLA.
//  Nenhum `data-act-*` do HTML mudou.
// ============================================================================
(function () {
  // Preenchidos por init(); ver o cabeçalho.
  let $,
    checkoutTrace,
    closeModalId,
    closeModalImmediately,
    currentCartBranchLabel,
    detailText,
    errorTrace,
    esc,
    failCardCheckout,
    fallback,
    fmt,
    getRestaurantSlug,
    jumpToTop,
    leaveCartAfterOrder,
    logAppError,
    openModal,
    orderAmount,
    renderTotalMismatch,
    showHomeTab,
    showOrderSuccess;

  // ------------------------------------------------------------
  //  O que MUDA de valor no restaurant-page, lido a cada acesso.
  //
  //  `restaurant` e `selectedSavedCard` vinham na lista de cima, POR VALOR — e
  //  os dois sao reatribuidos la (3 e 7 vezes). O init() deste modulo roda no
  //  corpo do IIFE do page, ANTES do boot: as duas copias que chegavam aqui
  //  eram `{}` e `null`, e continuavam sendo `{}` e `null` para sempre. E a
  //  FOTOGRAFIA DO BOOT da secao 2.1 da skill, a armadilha que ela chama de
  //  mais cara — a que nao produz erro nenhum na tela.
  //
  //  O que ela custou, medido: `pixStoreLabel()` lia `restaurant.name` de um
  //  `{}`, caia no `fallback().restaurantName`, e o cartao do pedido na tela de
  //  pagamento dizia "Restaurante - MATRIZ" em vez de
  //  "Junior da Picanha - MATRIZ". Num app white-label, na ULTIMA tela antes de
  //  o cliente pagar.
  //
  //  Mesmo idioma do `S` de restaurant-address-flow.js, e pelo mesmo motivo.
  // ------------------------------------------------------------
  const S = {};
  const ESTADO_OBRIGATORIO = ['restaurant', 'selectedSavedCard'];

  // Estado desta cobrança. Dono: este arquivo. Ver `compartilhado`, no fim.
  let trackedOrder = null;
  let pixSession = null;

  // ============================================================
  //  Pagamento online (Pix)
  //
  //  O pedido JÁ EXISTE quando esta parte começa: POST /orders respondeu, o
  //  carrinho foi limpo e o tracking_token está guardado. O que falta é a
  //  cobrança — e é ela, não o pedido, que pode falhar daqui para frente. Por
  //  isso nenhum erro deste bloco volta a falar em "não foi possível criar o
  //  pedido": seria mentira, e levaria o cliente a pedir de novo.
  //
  //  Sequência:
  //    POST .../orders/{token}/payment  -> qr_code e/ou checkout_url
  //    GET  .../orders/track/{token}    -> repetido até payment_status virar
  //                                        pago, com prazo (ver PIX_POLL_*)
  //
  //  As duas rotas são autorizadas pelo próprio tracking_token, então o fluxo
  //  inteiro funciona para visitante sem conta.
  // ============================================================

  // Intervalo entre consultas e teto da janela de espera. O teto existe para
  // que a tela não fique consultando para sempre uma cobrança que ninguém vai
  // pagar: ao estourar, o polling PARA e o cliente decide se verifica de novo.
  const PIX_POLL_INTERVAL_MS = 5000;
  const PIX_POLL_WINDOW_MS = 10 * 60 * 1000;
  // O texto de consequência sai da MESMA constante que o contador e o polling:
  // mudar a janela num lugar só não pode deixar a tela prometendo outro prazo.
  const PIX_WINDOW_MINUTES = Math.round(PIX_POLL_WINDOW_MS / 60000);
  // Falhas de rede seguidas na consulta não são falha de pagamento — só
  // desistimos de consultar depois de algumas.
  const PIX_POLL_MAX_FAILURES = 5;

  // Pedido exibido na tela de sucesso, quando ele tem tracking_token.
  // Sessão de pagamento em aberto. Trocar de sessão invalida as respostas em
  // voo da anterior (a comparação `pixSession !== session` aparece em todo
  // ponto que retoma depois de um await).
  // Tickers da tela de Pix, independentes da sessão: o contador regressivo e o
  // sumiço automático do aviso de "copiado".
  let pixCountdownTimer = null;
  let pixToastTimer = null;
  // Um timer por folha (confirmação de saída, "Como funciona"): o [hidden] só
  // volta quando a animação de descida termina.
  const pixSheetTimers = new Map();
  const PIX_EXIT_SHEET_TRANSITION_MS = 700;

  const isOnlinePaymentFlow = order =>
    String(order?.payment_flow || '').trim().toLowerCase() === 'online';

  /**
   * `payment_status` é `string` livre no OpenAPI — não há enum publicado. Em
   * vez de adivinhar um valor único, classificamos em três desfechos e tratamos
   * o desconhecido como PENDENTE: seguir esperando é o erro barato; dar um
   * pedido como pago sem estar é o caro.
   */
  function paymentStatusKind(status) {
    const value = String(status || '').trim().toLowerCase();
    if (['paid', 'approved', 'succeeded', 'success', 'confirmed', 'captured', 'settled', 'completed'].includes(value)) return 'paid';
    if (['failed', 'failure', 'canceled', 'cancelled', 'expired', 'refused', 'rejected', 'declined', 'error', 'refunded', 'chargeback', 'voided'].includes(value)) return 'failed';
    return 'pending';
  }

  // Cartão APROVADO, e cartão EM ANÁLISE — as duas únicas listas que autorizam
  // o pedido a existir. Ambas são explícitas de propósito (ver cardChargeKind).
  const CARD_APPROVED_STATUSES = new Set([
    'paid', 'approved', 'succeeded', 'success', 'confirmed', 'captured', 'settled', 'completed', 'authorized'
  ]);
  const CARD_IN_REVIEW_STATUSES = new Set([
    'in_review', 'in_process', 'in_analysis', 'under_review', 'pending_review', 'review'
  ]);

  /**
   * Desfecho de uma cobrança NO CARTÃO — e por que ele NÃO é paymentStatusKind().
   *
   * No Pix, "não sei" quer dizer ESPERE: a cobrança fica aberta, o cliente ainda
   * vai pagar, e continuar consultando é o erro barato. No cartão não existe
   * esperar. A autorização é síncrona: quando esta resposta chega, o gateway já
   * disse sim ou não. Então aqui o desconhecido cai para o outro lado —
   * NÃO APROVADO —, porque o erro caro passou a ser o oposto: dar como feito um
   * pedido que ninguém pagou.
   *
   * Era exatamente esse buraco que deixava um cartão recusado virar tela de
   * "pedido feito": `pending` (e qualquer status fora da lista de recusa) caía
   * no mesmo balde do Pix aguardando pagamento.
   *
   * @returns {'approved'|'in_review'|'declined'}
   */
  function cardChargeKind(status) {
    const value = String(status || '').trim().toLowerCase();
    if (CARD_APPROVED_STATUSES.has(value)) return 'approved';
    // Análise antifraude é decisão TOMADA, só não liquidada: o pedido vale, e
    // é assim que a tela já se comportava.
    if (CARD_IN_REVIEW_STATUSES.has(value)) return 'in_review';
    return 'declined';
  }

  /**
   * O motivo da recusa, em português — traduzido de `status_detail`.
   *
   * `StartPaymentResponse` NÃO tem campo de mensagem: numa recusa (200 com
   * `payment_status: "failed"`) o que vem é `status_detail`, o motivo CRU do
   * Mercado Pago. Sem esta tabela o cliente lê sempre a mesma frase genérica,
   * e "cartão sem limite" e "CVV errado" pedem coisas opostas dele.
   *
   * A tabela é NOMINAL de propósito: um `status_detail` que não conhecemos cai
   * na frase genérica, em vez de virar um palpite errado sobre o que corrigir.
   */
  const CARD_DECLINE_REASONS = {
    cc_rejected_bad_filled_security_code: 'Código de segurança incorreto. Confira o CVV do cartão e tente de novo.',
    cc_rejected_bad_filled_date: 'Data de validade incorreta. Confira a validade do cartão e tente de novo.',
    cc_rejected_bad_filled_card_number: 'Número do cartão incorreto. Confira os dados e tente de novo.',
    cc_rejected_bad_filled_other: 'Algum dado do cartão está incorreto. Confira e tente de novo.',
    cc_rejected_insufficient_amount: 'O cartão não tem limite suficiente para este pedido. Use outro cartão ou outra forma de pagamento.',
    cc_rejected_high_risk: 'O cartão não foi aprovado. Escolha outro cartão ou outra forma de pagamento.',
    cc_rejected_max_attempts: 'Muitas tentativas com este cartão. Use outro cartão ou outra forma de pagamento.',
    cc_rejected_call_for_authorize: 'O banco precisa autorizar esta compra. Ligue para o seu banco e tente de novo, ou use outro cartão.',
    cc_rejected_card_disabled: 'Este cartão está desabilitado. Ligue para o seu banco ou use outro cartão.',
    cc_rejected_duplicated_payment: 'Já existe um pagamento igual a este. Confira antes de pagar de novo.',
    cc_rejected_card_error: 'Não foi possível processar este cartão. Tente de novo ou use outro cartão.',
    cc_rejected_invalid_installments: 'O cartão não aceita este parcelamento. Escolha outra forma de pagamento.',
    cc_rejected_blacklist: 'O cartão não foi aprovado. Escolha outro cartão ou outra forma de pagamento.',
    cc_rejected_other_reason: 'O cartão não foi aprovado. Escolha outro cartão ou outra forma de pagamento.'
  };

  /** A frase que o cliente lê quando o cartão não passou. */
  function cardDeclineMessage(payment) {
    const detail = String(payment?.status_detail || '').trim().toLowerCase();
    if (CARD_DECLINE_REASONS[detail]) return CARD_DECLINE_REASONS[detail];
    // Alguns 200 não têm status_detail; um erro estruturado (401/400/502/503)
    // já vem com `message` pronta e em português, escrita pelo backend.
    const fromGateway = String(payment?.message || '').trim() || detailText(payment?.detail);
    if (fromGateway) return fromGateway;
    return 'Pagamento não aprovado pelo cartão. Confira os dados, escolha outro cartão ou outra forma de pagamento.';
  }

  /**
   * @param {Array} [items] foto das linhas do carrinho, tirada ANTES da limpeza
   *   — é a única cópia que sobra delas depois que o pedido é criado.
   */
  function rememberTrackingToken(response, items) {
    try {
      const saved = window.RapidexOrderTracking?.remember?.(getRestaurantSlug(), response, { items });
      if (!saved && isOnlinePaymentFlow(response)) {
        // Sem token não há como iniciar a cobrança nem acompanhar o pedido.
        logAppError('Pedido online criado sem tracking_token', new Error('tracking_token ausente na resposta'));
      }
      return saved;
    } catch (error) {
      logAppError('Falha ao guardar o tracking_token', error);
      return null;
    }
  }

  function updateTrackingEntry(trackingToken, patch) {
    try { window.RapidexOrderTracking?.update?.(getRestaurantSlug(), trackingToken, patch); }
    catch (error) { logAppError('Falha ao atualizar o pedido guardado', error); }
  }

  function setPixState(state) {
    document.querySelectorAll('#pixPaymentModal [data-pix-state]').forEach(section => {
      section.hidden = section.dataset.pixState !== state;
    });
    // O rodapé serve a UMA ação, copiar o código, e só existe onde ela faz
    // sentido: cobrança pronta E com código. Numa cobrança que veio só com
    // checkout_url o botão não teria o que copiar (renderPixCharge esvazia o
    // campo nesse caso), e a saída é o link, não ele.
    const footer = $('pixFooter');
    if (footer) footer.hidden = !(state === 'ready' && !!$('pixCopyCode')?.dataset.code?.trim());
  }

  /**
   * Traduz a falha de CRIAR A COBRANÇA em título, mensagem e desfecho.
   *
   * Duas regras valem em todos os ramos:
   *
   * 1. O pedido JÁ EXISTE quando chegamos aqui. Nenhuma mensagem pode sugerir
   *    refazê-lo — o cliente que refaz acaba com dois pedidos.
   * 2. Retentável e definitivo são telas diferentes. No definitivo o botão
   *    "Tentar novamente" não aparece: ele só levaria o cliente a repetir uma
   *    tentativa que já se sabe que falha. No lugar dele, a orientação de
   *    combinar outra forma de pagamento com o restaurante.
   *
   * ⚠️ Não existe rota para trocar a forma de pagamento de um pedido já criado
   * (o OpenAPI só expõe POST /orders, POST .../payment e GET .../track). Por
   * isso "escolher outra forma" é orientação para resolver com o restaurante
   * pelo número do pedido, e não um botão que prometeria algo que a API não faz.
   *
   * @returns {{message: string, title: string, canRetry: boolean, code: string}}
   */
  function pixChargeErrorOutcome(error, { card = false } = {}) {
    const info = window.PedeAquiApiError?.paymentErrorInfo?.(error)
      || { code: '', providerCode: '', retryable: false, text: '', structured: false };
    // SÃO DOIS CÓDIGOS, e o de suporte é o segundo. `code` é do NOSSO catálogo
    // (`PaymentErrorCode`, sete valores); `provider_error_code` é do catálogo
    // do GATEWAY ("2062", "bad_request"), e é esse que o atendimento do Mercado
    // Pago pede. Ele estava publicado no contrato e ninguém o lia — a tela de
    // recusa mostrava só o nosso, que não serve para abrir chamado lá.
    //
    // Vão JUNTOS numa linha só, separados por ponto médio: são a mesma
    // informação (a referência técnica desta falha) e duas linhas discretas
    // pesariam mais que a mensagem que importa.
    const code = [info.code, info.providerCode ? `ref. ${info.providerCode}` : '']
      .filter(Boolean).join(' · ');

    if (card && info.text) {
      return {
        title: 'Pagamento não realizado',
        message: info.text,
        canRetry: info.retryable,
        code: ''
      };
    }

    // Num 5xx o `detail` é mensagem INTERNA do servidor ("gateway indisponível"),
    // escrita para log, não para o cliente. Só aproveitamos o texto quando ele
    // vem estruturado — aí foi feito para ser exibido — ou quando a resposta não
    // é erro de servidor. Fora isso, quem escreve a frase é esta função.
    const serverText = Number(error?.status) >= 500 && !info.structured ? '' : info.text;

    // Transporte: a requisição nem chegou a ter resposta. Sempre retentável, e
    // o `detail` (se houver) não diria nada de útil aqui.
    if (error?.name === 'TimeoutError' || error?.name === 'NetworkError') {
      return {
        title: 'Não foi possível gerar a cobrança',
        message: 'Não conseguimos falar com o provedor de pagamento. Verifique sua conexão e tente de novo — seu pedido já está registrado.',
        canRetry: true,
        code
      };
    }

    if (error?.status === 404) {
      return {
        title: 'Pedido não encontrado para pagamento',
        message: 'Não localizamos este pedido para pagamento. Procure o restaurante informando o número do pedido — ele não foi perdido.',
        canRetry: false,
        code
      };
    }

    // 409 tem leitura própria: o pedido saiu do estado "aguardando pagamento",
    // e um dos motivos possíveis é ele JÁ ESTAR PAGO. Mandar esse cliente
    // "escolher outra forma de pagamento" seria empurrá-lo a pagar duas vezes.
    if (error?.status === 409) {
      return {
        title: 'Este pedido não está mais aguardando pagamento',
        message: serverText
          ? `${serverText} Confira a situação do pedido com o restaurante antes de pagar de novo.`
          : 'Este pedido não está mais aguardando pagamento — ele pode já ter sido pago. Confira a situação com o restaurante informando o número do pedido antes de pagar de novo.',
        canRetry: false,
        code
      };
    }

    // A partir daqui o backend respondeu, e é o `retryable` dele que decide.
    if (info.retryable) {
      return {
        title: 'Não foi possível gerar a cobrança',
        message: serverText
          ? `${serverText} Seu pedido continua registrado — toque em Tentar novamente.`
          : 'O provedor de pagamento não conseguiu criar a cobrança agora. Seu pedido continua registrado — toque em Tentar novamente.',
        canRetry: true,
        code
      };
    }

    return {
      title: 'Pix indisponível para este pedido',
      message: serverText
        ? `${serverText} Não adianta tentar de novo por Pix: combine outra forma de pagamento com o restaurante informando o número do pedido.`
        : 'Não foi possível cobrar por Pix neste pedido, e tentar de novo levaria ao mesmo resultado. Combine outra forma de pagamento com o restaurante informando o número do pedido.',
      canRetry: false,
      code
    };
  }

  /**
   * @param {string} message
   * @param {object} [options]
   * @param {boolean} [options.canRetry] false esconde "Tentar novamente"
   * @param {string}  [options.code]     código do gateway, exibido como referência
   */
  function showPixError(message, { title = 'Não foi possível gerar a cobrança', canRetry = true, code = '' } = {}) {
    stopPixPolling();
    if ($('pixErrorTitle')) $('pixErrorTitle').textContent = title;
    if ($('pixErrorMessage')) $('pixErrorMessage').textContent = message;
    if ($('pixRetryBtn')) $('pixRetryBtn').hidden = !canRetry;

    // O número do pedido é a prova, na tela, de que ele sobreviveu à falha.
    const orderLine = $('pixErrorOrder');
    if (orderLine) {
      const orderNumber = pixSession?.order?.order_number;
      orderLine.hidden = orderNumber == null;
      orderLine.textContent = orderNumber == null ? '' : `Seu pedido #${orderNumber} está registrado.`;
    }

    const codeLine = $('pixErrorCode');
    if (codeLine) {
      // `code` é texto do servidor: vai por textContent, nunca por innerHTML.
      codeLine.hidden = !code;
      codeLine.textContent = code ? `Código do erro: ${code}` : '';
    }

    setPixState('error');
  }

  /**
   * Nome da loja no cartão do pedido: restaurante e, quando ela tem nome
   * próprio, a unidade — é o que diferencia duas lojas da mesma marca. Repetir
   * o nome do restaurante como unidade não informa nada, então esse caso cai
   * para só o nome.
   */
  function pixStoreLabel() {
    const name = String(S.restaurant?.name || fallback().restaurantName || '').trim();
    const branch = currentCartBranchLabel();
    if (!branch || branch === name.toUpperCase()) return name || 'Seu pedido';
    return name ? `${name} - ${branch}` : branch;
  }

  /**
   * Gaveta de conferência. Os itens vêm da foto tirada quando o pedido foi
   * criado (order-tracking.js): nenhuma rota do ciclo os devolve. Sem foto, o
   * botão some — melhor não oferecer do que abrir uma gaveta vazia.
   */
  function renderPixOrderItems(items) {
    const toggle = $('pixItemsToggle');
    const list = $('pixOrderItems');
    if (!toggle || !list) return;

    const rows = (Array.isArray(items) ? items : []).filter(item => item?.name);
    toggle.hidden = !rows.length;
    // Toda abertura de tela começa com a gaveta fechada.
    toggle.classList.remove('is-open');
    toggle.setAttribute('aria-expanded', 'false');
    list.hidden = true;
    // Quantidade em chip + nome, sem preço por linha: é a linha da referência
    // (assets/testeimagensreferencias/"Captura de tela 2026-08-05 191441.png").
    // O que se paga continua na tela — é o "Total" logo acima, e é ele que tem
    // que bater com a cobrança.
    list.innerHTML = rows.map(item => `
        <li class="pix-order-item">
          <span class="pix-order-item-qty">${esc(String(item.qty || 1))}</span>
          <span class="pix-order-item-name">${esc(item.name)}</span>
        </li>`).join('');
  }

  function togglePixOrderItems() {
    const toggle = $('pixItemsToggle');
    const list = $('pixOrderItems');
    if (!toggle || !list) return;
    const open = list.hidden;
    list.hidden = !open;
    toggle.classList.toggle('is-open', open);
    toggle.setAttribute('aria-expanded', String(open));
  }

  /**
   * Monta a sessão, cria a cobrança e deixa a tela no estado FINAL — pronta,
   * paga ou em erro. Não abre nada.
   *
   * A tela de "Gerando o código de pagamento..." saiu daqui: era uma tela cheia
   * inteira para anunciar a espera de uma requisição, no meio de um caminho em
   * que o cliente já tinha um botão à sua frente. A espera passou para esse
   * botão — o "Confirmar" da folha, o da barra de pagamento pendente e o
   * "Tentar novamente" do erro —, e a tela do Pix entra pela lateral já com o
   * código na mão.
   *
   * @param {object} order resposta de POST /orders (ou entrada guardada com os mesmos campos)
   * @param {object} [options]
   * @param {Array}  [options.items] foto das linhas; sem ela vale a que ficou
   *   guardada com o token (o caso de quem recarregou a página)
   * @returns {Promise<object>} a sessão preparada, para presentPixPayment()
   *   conferir que ela ainda é a corrente
   */
  async function preparePixPayment(order, { items, ownsCart = false, cardPayment = null } = {}) {
    const trackingToken = String(order?.tracking_token || '').trim();
    pixSession = {
      order,
      ownsCart,
      cardPayment,
      cardCompleted: false,
      trackingToken,
      payment: null,
      pollTimer: null,
      pollUntil: 0,
      pollFailures: 0,
      stopped: false
    };

    if ($('pixOrderStore')) $('pixOrderStore').textContent = pixStoreLabel();
    if ($('pixOrderNumber')) {
      $('pixOrderNumber').textContent = order?.order_number != null ? `Nº do pedido ${order.order_number}` : 'Seu pedido';
    }
    if ($('pixOrderTotal')) $('pixOrderTotal').textContent = fmt(orderAmount(order?.total));
    // Aqui o aviso pesa MAIS que na tela de sucesso: este total vira cobranca
    // no proximo toque, e o cliente paga antes de qualquer conferencia.
    renderTotalMismatch(order, 'pixTotalMismatchRow', 'pixTotalMismatch');
    renderPixOrderItems(items || order?.items);
    // O prazo sai de PIX_POLL_WINDOW_MS para não poder divergir do contador.
    // ⚠️ O cancelamento é afirmação de PRODUTO, não do contrato: nem a cobrança
    // declara validade nem existe rota que confirme o cancelamento do pedido
    // não pago (docs/order-contract.md, item 11).
    if ($('pixConsequence')) {
      $('pixConsequence').textContent =
        `Você tem até ${PIX_WINDOW_MINUTES} minutos para fazer o pagamento. Após esse tempo, o pedido será cancelado.`;
    }
    hidePixToast();
    closePixSheets();
    updatePixCountdown();

    const session = pixSession;
    if (!trackingToken) {
      // Sem token não há rota: nem cobrança, nem acompanhamento. Retentar não
      // resolveria nada, então o botão de retry não aparece.
      showPixError(
        'Seu pedido foi registrado, mas não recebemos o código de acompanhamento necessário para o pagamento online. Procure o restaurante informando o número do pedido.',
        { canRetry: false }
      );
      return session;
    }

    await startPixCharge();
    return session;
  }

  /**
   * Abre a tela, já com o estado decidido por preparePixPayment().
   * @param {object} [session] a sessão de quem preparou; se ela não for mais a
   *   corrente, o cliente saiu no meio da espera e não há tela para abrir.
   */
  function presentPixPayment(session) {
    if (session && pixSession !== session) return;
    openModal('pixPaymentModal');
  }

  function hasCreatedCartPixPayment() {
    const session = pixSession;
    return Boolean(
      session?.ownsCart
      && session.payment
      && paymentStatusKind(session.order?.payment_status) === 'pending'
    );
  }

  function resumeCreatedCartPixPayment() {
    if (!hasCreatedCartPixPayment()) return false;
    const session = pixSession;
    session.stopped = false;
    startPixPolling();
    presentPixPayment(session);
    return true;
  }

  /** Prepara e abre — o caminho de quem não tem outra tela para fechar antes. */
  async function openPixPayment(order, options) {
    presentPixPayment(await preparePixPayment(order, options));
  }

  async function startPixCharge() {
    const session = pixSession;
    if (!session?.trackingToken) return;

    const isCard = Boolean(session.cardPayment);
    let payment;
    try {
      checkoutTrace(`9/11 criando a cobrança (${isCard ? 'cartão' : 'pix'})`, {
        trackingToken: session.trackingToken,
        temTokenDoCartao: Boolean(session.cardPayment?.token),
        savedCardId: session.cardPayment?.saved_card_id || null
      });
      payment = await window.PedeAquiOrderService.startOrderPayment(
        getRestaurantSlug(),
        session.trackingToken,
        session.cardPayment ? { card: session.cardPayment } : {}
      );
    } catch (error) {
      if (pixSession !== session) return;
      checkoutTrace('9/11 PAROU: a rota de cobrança falhou', errorTrace(error));
      logAppError('Falha ao criar a cobrança do Pix', error);
      const outcome = pixChargeErrorOutcome(error, { card: isCard });
      // Cartão é o mesmo desfecho da recusa: não houve cobrança, então não
      // pode haver tela de pedido feito nem tela de Pix. O cliente volta para
      // a sacola com o motivo.
      if (isCard) {
        session.cardDeclined = { message: outcome.message };
        return;
      }
      showPixError(outcome.message, outcome);
      return;
    }
    if (pixSession !== session) return; // a tela mudou enquanto esperávamos

    session.payment = payment;
    if (isCard) {
      const kind = cardChargeKind(payment?.payment_status);
      checkoutTrace('10/11 o gateway respondeu a cobrança do cartão', {
        payment_status: payment?.payment_status ?? null,
        // O motivo CRU do Mercado Pago: é ele que diz se a recusa foi de CVV,
        // de limite ou do banco. Sem ele no console, uma recusa é indistinguível
        // de outra.
        status_detail: payment?.status_detail ?? null,
        desfecho: kind,
        provider: payment?.provider ?? null,
        provider_payment_id: payment?.provider_payment_id ?? null
      });
      // ⚠️ REGRA DO CARTÃO: só APROVAÇÃO (ou análise, que é decisão tomada)
      // cria pedido. Qualquer outra coisa — recusa, `pending`, status que não
      // conhecemos, resposta sem status — é NÃO PAGO, e não pago não vira tela
      // de sucesso. Ver cardChargeKind().
      if (kind === 'declined') {
        checkoutTrace('11/11 FIM: cartão não aprovado — voltando para a sacola', {
          payment_status: payment?.payment_status ?? null
        });
        session.cardDeclined = { message: cardDeclineMessage(payment) };
        return;
      }
      checkoutTrace('11/11 FIM: cartão aprovado — pedido confirmado', {
        payment_status: payment?.payment_status ?? null,
        desfecho: kind
      });
      session.cardCompleted = true;
      leaveCartAfterOrder();
      showOrderSuccess(session.order);
      return;
    }
    const kind = paymentStatusKind(payment?.payment_status);
    if (kind === 'paid') {
      // A cobrança já nasceu paga (retomada de um pagamento feito antes).
      showPixPaid(payment);
      return;
    }
    if (kind === 'failed') {
      showPixError(
        'A cobrança deste pedido não está mais válida. Procure o restaurante informando o número do pedido.',
        { title: 'Cobrança não está mais válida', canRetry: false }
      );
      return;
    }

    if (!renderPixCharge(payment)) return;
    setPixState('ready');
    startPixPolling();
  }

  /**
   * Resumo do payload EMV para a tela: corta logo depois do "BR" do domínio
   * (`...0014BR.GOV.BCB.PIX...`), que é onde a referência corta. O resto são
   * centenas de caracteres que ninguém lê nem digita.
   * @param {string} code payload completo
   * @returns {string} trecho seguido de reticências
   */
  function shortPixCode(code) {
    const full = String(code || '');
    const cut = full.indexOf('BR');
    // Sem "BR" o payload não é um Pix conhecido; ainda assim não deixamos a
    // linha inteira na tela — o CSS trunca o que sobrar.
    return cut < 0 ? full : `${full.slice(0, cut + 2)}...`;
  }

  /**
   * Preenche a tela com o que o gateway devolveu.
   * @returns {boolean} false quando não há como pagar (a tela já foi para erro)
   */
  function renderPixCharge(payment) {
    const code = String(payment?.qr_code || '').trim();
    const checkoutUrl = String(payment?.checkout_url || '').trim();

    // Documentado no próprio OpenAPI: qr_code e checkout_url são alternativos e
    // o sandbox não devolve nenhum dos dois. Sem os dois não há para onde mandar
    // o cliente, e dizer isso é melhor do que mostrar uma tela vazia.
    if (!code && !checkoutUrl) {
      showPixError(
        'A cobrança foi criada, mas o provedor não devolveu o QR Code nem o link de pagamento. Seu pedido está registrado — procure o restaurante informando o número do pedido.',
        { title: 'Cobrança sem forma de pagamento', canRetry: true }
      );
      return false;
    }

    // O payload INTEIRO fica no dataset e é DELE que a cópia sai — o texto
    // visível é só um resumo, e copiar um código cortado cobra errado.
    const codeEl = $('pixCopyCode');
    if (codeEl) {
      codeEl.dataset.code = code || '';
      codeEl.textContent = shortPixCode(code);
    }
    if ($('pixCodeField')) $('pixCodeField').hidden = !code;

    // Sem código, a instrução de copiar não se aplica: a única saída é o link.
    if ($('pixLede')) {
      $('pixLede').textContent = code
        ? 'Copie o código abaixo e utilize o Pix Copia e Cola no aplicativo do seu banco.'
        : 'Abra a página de pagamento para concluir a cobrança no seu banco.';
    }

    const link = $('pixCheckoutLink');
    if (link) {
      // Só http(s): um checkout_url com esquema estranho viraria um vetor de
      // navegação que não controlamos.
      const safeUrl = /^https?:\/\//i.test(checkoutUrl) ? checkoutUrl : '';
      // O link é a SAÍDA DE EMERGÊNCIA, não um segundo caminho: com código na
      // tela ele só competia com o botão de copiar. Some quando há código e
      // aparece quando não há — que é o único caso em que a tela ficaria sem
      // nada para o cliente fazer.
      link.hidden = !safeUrl || !!code;
      if (safeUrl) link.href = safeUrl;
      else link.removeAttribute('href');
    }

    return true;
  }

  /**
   * Aviso curto sobre o cabeçalho. O [hidden] sai antes da classe que anima
   * para o elemento já estar no fluxo quando a transição começa — trocar os
   * dois no mesmo quadro faria o toast surgir sem animação.
   */
  function showPixToast(message) {
    const toast = $('pixToast');
    if (!toast) return;
    clearTimeout(pixToastTimer);
    if ($('pixToastText')) $('pixToastText').textContent = message;
    toast.hidden = false;
    requestAnimationFrame(() => toast.classList.add('is-open'));
    pixToastTimer = setTimeout(hidePixToast, 2400);
  }

  function hidePixToast() {
    const toast = $('pixToast');
    clearTimeout(pixToastTimer);
    pixToastTimer = null;
    if (!toast) return;
    toast.classList.remove('is-open');
    pixToastTimer = setTimeout(() => { toast.hidden = true; }, 200);
  }

  async function copyPixCode() {
    // dataset, não textContent: o texto na tela é o resumo até o "BR".
    const code = $('pixCopyCode')?.dataset.code?.trim();
    if (!code) return;

    let copied;
    try {
      await navigator.clipboard.writeText(code);
      copied = true;
    } catch {
      // Clipboard API exige contexto seguro e nem todo webview a tem. O
      // caminho antigo ainda funciona nesses casos.
      copied = copyTextFallback(code);
    }

    showPixToast(copied ? 'PIX copiado com sucesso!' : 'Não foi possível copiar');
  }

  function copyTextFallback(value) {
    const field = document.createElement('textarea');
    field.value = value;
    field.setAttribute('readonly', '');
    field.className = 'u-visually-hidden';
    document.body.appendChild(field);
    let copied;
    try {
      field.select();
      copied = document.execCommand('copy');
    } catch {
      copied = false;
    }
    field.remove();
    return copied;
  }

  /* ---------------- Acompanhamento do pagamento ---------------- */

  function startPixPolling() {
    const session = pixSession;
    if (!session) return;
    session.pollUntil = Date.now() + PIX_POLL_WINDOW_MS;
    session.pollFailures = 0;
    startPixCountdown();
    schedulePixPoll(PIX_POLL_INTERVAL_MS);
  }

  function schedulePixPoll(delay) {
    const session = pixSession;
    if (!session || session.stopped) return;
    clearTimeout(session.pollTimer);
    session.pollTimer = setTimeout(() => { pollPixStatus(); }, delay);
  }

  function stopPixPolling() {
    stopPixCountdown();
    if (!pixSession) return;
    pixSession.stopped = true;
    clearTimeout(pixSession.pollTimer);
    pixSession.pollTimer = null;
  }

  /**
   * Contador regressivo e a barra que o acompanha. Contam a MESMA janela em que
   * o polling ainda verifica sozinho — ao zerar, `pollPixStatus` leva a tela
   * para o estado "expired". Um contador com prazo próprio mentiria numa das
   * pontas, e uma barra alimentada por outra conta mentiria na outra: as duas
   * saem daqui, do mesmo `remainingMs`.
   */
  function updatePixCountdown() {
    const node = $('pixCountdown');
    const bar = $('pixCountdownBar');
    if (!node && !bar) return;
    const session = pixSession;
    const remainingMs = session && !session.stopped ? Math.max(0, session.pollUntil - Date.now()) : 0;
    const totalSeconds = Math.ceil(remainingMs / 1000);
    const minutes = String(Math.floor(totalSeconds / 60)).padStart(2, '0');
    const seconds = String(totalSeconds % 60).padStart(2, '0');
    if (node) node.textContent = `${minutes}:${seconds}`;
    if (bar) {
      const ratio = Math.max(0, Math.min(1, remainingMs / PIX_POLL_WINDOW_MS));
      bar.style.width = `${(ratio * 100).toFixed(2)}%`;
    }
  }

  function startPixCountdown() {
    stopPixCountdown();
    updatePixCountdown();
    pixCountdownTimer = setInterval(updatePixCountdown, 1000);
  }

  function stopPixCountdown() {
    clearInterval(pixCountdownTimer);
    pixCountdownTimer = null;
  }

  async function pollPixStatus() {
    const session = pixSession;
    if (!session || session.stopped) return;

    // Aba em segundo plano não consulta: o pageshow retoma. Consultar em
    // background só gastaria bateria e requisição numa tela que ninguém vê.
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
      session.pollTimer = null;
      return;
    }

    if (Date.now() >= session.pollUntil) {
      stopPixPolling();
      setPixState('expired');
      return;
    }

    let detail;
    try {
      detail = await window.PedeAquiOrderService.trackOrder(getRestaurantSlug(), session.trackingToken);
    } catch (error) {
      if (pixSession !== session || session.stopped) return;
      session.pollFailures++;
      if (session.pollFailures >= PIX_POLL_MAX_FAILURES) {
        logAppError('Consulta do pagamento falhou repetidamente', error);
        showPixError(
          'Perdemos o contato com o servidor enquanto aguardávamos o pagamento. Se você já pagou, o restaurante confirma assim que a conexão voltar.',
          { title: 'Não conseguimos verificar o pagamento', canRetry: true }
        );
        return;
      }
      // Recuo progressivo: uma instabilidade curta não vira uma rajada.
      schedulePixPoll(PIX_POLL_INTERVAL_MS * (session.pollFailures + 1));
      return;
    }
    if (pixSession !== session || session.stopped) return;

    session.pollFailures = 0;
    updateTrackingEntry(session.trackingToken, {
      status: detail?.status,
      payment_status: detail?.payment_status
    });

    const kind = paymentStatusKind(detail?.payment_status);
    if (kind === 'paid') {
      showPixPaid(detail);
      return;
    }
    if (kind === 'failed') {
      showPixError(
        'O pagamento não foi aprovado. Você pode tentar novamente pelo app do seu banco ou procurar o restaurante.',
        { title: 'Pagamento não aprovado', canRetry: false }
      );
      return;
    }

    schedulePixPoll(PIX_POLL_INTERVAL_MS);
  }

  /** Consulta única, disparada pelo cliente depois que a janela automática fechou. */
  async function checkPixStatusNow() {
    const session = pixSession;
    if (!session?.trackingToken) return;
    session.stopped = false;
    session.pollFailures = 0;
    // A consulta espera no próprio botão, como as outras: trocar a tela por uma
    // de carregamento tiraria da frente o aviso que explica por que ele está ali.
    const button = $('pixCheckNowBtn');
    button?.classList.add('is-loading');

    let detail;
    try {
      detail = await window.PedeAquiOrderService.trackOrder(getRestaurantSlug(), session.trackingToken);
    } catch (error) {
      button?.classList.remove('is-loading');
      if (pixSession !== session) return;
      logAppError('Falha ao verificar o pagamento', error);
      showPixError(
        'Não conseguimos verificar o pagamento agora. Tente novamente em instantes.',
        { title: 'Não conseguimos verificar o pagamento', canRetry: true }
      );
      return;
    }
    button?.classList.remove('is-loading');
    if (pixSession !== session) return;

    updateTrackingEntry(session.trackingToken, {
      status: detail?.status,
      payment_status: detail?.payment_status
    });

    if (paymentStatusKind(detail?.payment_status) === 'paid') {
      showPixPaid(detail);
      return;
    }
    // Continua pendente: reabre a janela de espera do ponto zero.
    if (session.payment && !renderPixCharge(session.payment)) return;
    setPixState('ready');
    startPixPolling();
  }

  /** Pagamento confirmado: para tudo e entrega a tela de sucesso. */
  function showPixPaid(detail) {
    stopPixPolling();
    const base = pixSession?.order || {};
    // A resposta da criação tem `message`, a de acompanhamento não; a de
    // acompanhamento tem o status atual. As duas juntas dão a tela completa.
    const merged = {
      ...base,
      ...(detail && typeof detail === 'object' ? detail : {}),
      tracking_token: base.tracking_token || detail?.tracking_token,
      message: 'Pagamento confirmado! Seu pedido foi enviado ao restaurante.'
    };
    updateTrackingEntry(merged.tracking_token, {
      status: merged.status,
      payment_status: merged.payment_status
    });
    renderPendingPaymentBar();
    hidePixToast();
    closePixSheets();
    if (pixSession?.ownsCart) leaveCartAfterOrder({ confirmationAlreadyClosed: true });
    closeModalImmediately('pixPaymentModal');
    showOrderSuccess(merged);
  }

  async function retryPixPayment() {
    if (!pixSession) return;
    pixSession.stopped = false;
    if (pixSession.cardPayment && S.selectedSavedCard?.id) {
      const token = await window.PedeAquiCardFlow?.requestSavedCardToken?.(S.selectedSavedCard);
      if (!token) return;
      pixSession.cardPayment = { ...pixSession.cardPayment, token };
    }
    // A tela de erro continua na frente enquanto a tentativa acontece: a
    // espera cabe no próprio botão, e trocar a tela por uma de carregamento
    // faria o cliente perder de vista o que deu errado.
    const button = $('pixRetryBtn');
    const session = pixSession;
    button?.classList.add('is-loading');
    try {
      await startPixCharge();
      // Uma retentativa de CARTÃO também pode voltar recusada, e recusa não
      // tem tela aqui: o desfecho do cartão é sempre a sacola. Sem isto o
      // botão pararia de girar e nada mais aconteceria — a falha muda que este
      // fluxo já teve uma vez.
      if (session?.cardDeclined) {
        closeModalImmediately('pixPaymentModal');
        failCardCheckout(session.cardDeclined.message);
      }
    } finally {
      button?.classList.remove('is-loading');
    }
  }

  /* ---------------- Folhas da tela ---------------- */

  function openPixSheet(id) {
    const sheet = $(id);
    if (!sheet) return;
    clearTimeout(pixSheetTimers.get(id));
    sheet.hidden = false;
    // Mesmo motivo do toast: o elemento precisa estar no fluxo um quadro antes
    // da classe que anima, senão a folha aparece já no lugar.
    requestAnimationFrame(() => sheet.classList.add('is-open'));
  }

  /** Só desce a folha — nada do que está por baixo é tocado. */
  function closePixSheet(id, { animate = true } = {}) {
    const sheet = $(id);
    if (!sheet) return;
    clearTimeout(pixSheetTimers.get(id));
    sheet.classList.remove('is-open');
    if (!animate) {
      sheet.hidden = true;
      return;
    }
    const hideDelay = id === 'pixExitConfirm' ? PIX_EXIT_SHEET_TRANSITION_MS + 20 : 300;
    pixSheetTimers.set(id, setTimeout(() => { sheet.hidden = true; }, hideDelay));
  }

  // Passo a passo do pagamento. Fica fora da tela principal porque é ajuda, não
  // instrução obrigatória: quem já paga por Pix não precisa lê-la.
  function openPixHowTo() { openPixSheet('pixHowTo'); }
  function closePixHowTo(options) { closePixSheet('pixHowTo', options); }

  // Os dois botões do cabeçalho (voltar e X) caem aqui: uma vez que o pedido
  // existe, sair da cobrança não é um "voltar" qualquer.
  function openPixExitConfirm() { openPixSheet('pixExitConfirm'); }

  /** Só desce a folha — a cobrança continua exatamente como estava. */
  function closePixExitConfirm(options) { closePixSheet('pixExitConfirm', options); }

  /**
   * Baixa TODAS as folhas de uma vez, sem animação. Usada ao entrar e ao sair
   * da tela: uma folha esquecida aberta reapareceria por cima da próxima
   * cobrança.
   */
  function closePixSheets() {
    closePixExitConfirm({ animate: false });
    closePixHowTo({ animate: false });
  }

  /** "Cancelar pedido": volta à sacola quando a cobrança nasceu dela. */
  function confirmPixExit() {
    if (pixSession?.ownsCart && $('cartModal')?.classList.contains('active')) {
      returnPixToCart();
      return;
    }
    closePixSheets();
    closePixPayment();
  }

  function returnPixToCart() {
    stopPixPolling();
    hidePixToast();
    const panel = document.querySelector('#pixPaymentModal .modal');
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      panel?.removeEventListener('transitionend', onTransitionEnd);
      closePixSheets();
      $('cartCtaBtn')?.focus({ preventScroll: true });
    };
    const onTransitionEnd = event => {
      if (event.target === panel && event.propertyName === 'transform') finish();
    };
    panel?.addEventListener('transitionend', onTransitionEnd);
    closeModalId('pixPaymentModal');
    // A pendência não deixa de existir porque a saída foi para a sacola. A
    // barra da loja é o único caminho de volta à cobrança depois que a sacola
    // também for fechada, e sem esta chamada ela nunca aparecia nesta saída —
    // só na de closePixPayment(), que este ramo justamente evita.
    renderPendingPaymentBar();
    setTimeout(finish, 650);
  }

  /** Sai da tela sem cancelar nada: o pedido e o token continuam guardados. */
  function closePixPayment() {
    if (pixSession?.ownsCart && $('cartModal')?.classList.contains('active')) {
      returnPixToCart();
      return;
    }
    stopPixPolling();
    hidePixToast();
    closePixSheets();
    const session = pixSession;
    pixSession = null;
    closeModalId('pixPaymentModal');
    renderPendingPaymentBar();
    if (session?.order) trackedOrder = session.order;
    setTimeout(() => { showHomeTab(); jumpToTop(); }, 160);
  }

  /* ---------------- Retomada e acompanhamento ---------------- */

  // Pagamento pendente guardado para esta loja. Sem pendência a barra nem
  // existe na tela, e a loja fica exatamente como era.
  let pendingPaymentDismissed = false;

  function pendingOnlinePayment() {
    if (pendingPaymentDismissed) return null;
    const entries = window.RapidexOrderTracking?.list?.(getRestaurantSlug()) || [];
    return entries.find(entry =>
      String(entry.payment_flow || '').toLowerCase() === 'online' &&
      paymentStatusKind(entry.payment_status) === 'pending'
    ) || null;
  }

  function renderPendingPaymentBar() {
    const bar = $('pendingPaymentBar');
    if (!bar) return;
    const pending = pendingOnlinePayment();
    bar.hidden = !pending;
    if (!pending) return;
    if ($('pendingPaymentTitle')) {
      $('pendingPaymentTitle').textContent = pending.order_number != null
        ? `Pedido #${pending.order_number} aguardando pagamento`
        : 'Pedido aguardando pagamento';
    }
    if ($('pendingPaymentSubtitle')) {
      $('pendingPaymentSubtitle').textContent = pending.total != null
        ? `Toque para pagar ${fmt(orderAmount(pending.total))} via Pix`
        : 'Toque para concluir o pagamento';
    }
  }

  async function resumePendingPayment() {
    const pending = pendingOnlinePayment();
    if (!pending) {
      renderPendingPaymentBar();
      return;
    }
    // A barra fica no lugar, girando, até a tela estar pronta. Escondê-la no
    // clique — como antes, quando havia uma tela de carregamento para receber
    // o cliente — deixaria a loja sem nenhum sinal de que algo está vindo.
    const bar = $('pendingPaymentBar');
    const button = bar?.querySelector('.pending-payment-main');
    button?.classList.add('is-loading');
    try {
      // Chamar o endpoint de pagamento de novo é seguro: o backend devolve a
      // cobrança corrente do pedido em vez de criar outra.
      await openPixPayment(pending);
    } finally {
      button?.classList.remove('is-loading');
      bar?.setAttribute('hidden', '');
    }
  }

  function dismissPendingPayment() {
    pendingPaymentDismissed = true;
    renderPendingPaymentBar();
  }

  /**
   * Botão "Atualizar status" da tela de sucesso — o caminho de acompanhamento
   * do VISITANTE, autorizado só pelo tracking_token.
   */
  async function refreshTrackedOrder() {
    const trackingToken = trackedOrder?.tracking_token;
    const button = $('ordSuccessTrackBtn');
    if (!trackingToken) return;

    if (button) {
      button.disabled = true;
      button.textContent = 'Consultando...';
    }
    try {
      const detail = await window.PedeAquiOrderService.trackOrder(getRestaurantSlug(), trackingToken);
      updateTrackingEntry(trackingToken, {
        status: detail?.status,
        payment_status: detail?.payment_status
      });
      renderPendingPaymentBar();
      showOrderSuccess({
        ...trackedOrder,
        ...detail,
        tracking_token: trackingToken,
        message: trackedOrder.message
      });
    } catch (error) {
      logAppError('Falha ao acompanhar o pedido', error);
      if (button) {
        button.disabled = false;
        button.textContent = 'Não foi possível atualizar. Tentar de novo';
      }
    }
  }

  // As 13 ações que o markup deste fluxo chama por data-act-*.
  const ACOES_DO_MODULO = {
    checkPixStatusNow,
    closePixExitConfirm,
    closePixHowTo,
    closePixPayment,
    confirmPixExit,
    copyPixCode,
    dismissPendingPayment,
    openPixExitConfirm,
    openPixHowTo,
    refreshTrackedOrder,
    resumePendingPayment,
    retryPixPayment,
    togglePixOrderItems
  };

  /**
   * Chamado UMA vez, por restaurant-page.js, no ponto onde este bloco morava.
   */
  function init(deps) {
    // Getter faltando para em init(), com o nome — em vez de o modulo seguir
    // decidindo com `undefined`, que e como esta classe de defeito se esconde.
    for (const nome of ESTADO_OBRIGATORIO) {
      if (typeof deps?.[nome] !== 'function') {
        throw new Error(`PedeAquiPixFlow.init: falta o getter de ${nome}`);
      }
      Object.defineProperty(S, nome, { get: deps[nome], configurable: true });
    }
    ({
      $,
      checkoutTrace,
      closeModalId,
      closeModalImmediately,
      currentCartBranchLabel,
      detailText,
      errorTrace,
      esc,
      failCardCheckout,
      fallback,
      fmt,
      getRestaurantSlug,
      jumpToTop,
      leaveCartAfterOrder,
      logAppError,
      openModal,
      orderAmount,
      renderTotalMismatch,
      showHomeTab,
      showOrderSuccess
    } = deps);
    window.RapidexActions.register(ACOES_DO_MODULO);
  }

  /**
   * O estado que os dois lados leem E escrevem. Getter e setter de verdade:
   * quem escreve aqui muda a variável deste módulo, e quem lê vê o valor de
   * agora — nunca uma cópia do instante do init().
   */
  const compartilhado = {
    get pixSession() { return pixSession; },
    set pixSession(valor) { pixSession = valor; },
    get trackedOrder() { return trackedOrder; },
    set trackedOrder(valor) { trackedOrder = valor; }
  };

  window.PedeAquiPixFlow = {
    init,
    compartilhado,
    // As portas que o restaurant-page.js ainda chama pelo nome.
    hasCreatedCartPixPayment,
    isOnlinePaymentFlow,
    paymentStatusKind,
    pollPixStatus,
    preparePixPayment,
    presentPixPayment,
    rememberTrackingToken,
    renderPendingPaymentBar,
    resumeCreatedCartPixPayment,
    stopPixPolling
  };
})();
