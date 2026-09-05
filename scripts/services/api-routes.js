(function () {
  const routeSlug = value => encodeURIComponent(value);

  const API_ROUTES = {
    health: '/health',

    restaurant: restaurantSlug =>
      `/restaurants/${routeSlug(restaurantSlug)}`,

    restaurantInfo: (restaurantSlug, branchId) =>
      `/restaurants/${routeSlug(restaurantSlug)}/info${branchId ? `?branch_id=${routeSlug(branchId)}` : ''}`,

    restaurantPaymentConfig: restaurantSlug =>
      `/restaurants/${routeSlug(restaurantSlug)}/payment-config`,

    // O cardápio é DA FILIAL desde 20/08/2026: produtos, categorias, preços e
    // `settings` saem todos da filial pedida, e cada loja tem os próprios ids.
    // Sem `branch_id` vale a filial padrão do backend — que é a resposta certa
    // só enquanto o cliente ainda não escolheu a loja.
    menu: (restaurantSlug, branchId) =>
      `/restaurants/${routeSlug(restaurantSlug)}/menu${branchId ? `?branch_id=${routeSlug(branchId)}` : ''}`,
    branchAvailability: restaurantSlug =>
      `/restaurants/${routeSlug(restaurantSlug)}/branches/availability`,
    // Os cupons DESTA loja para QUEM ESTÁ OLHANDO. Substituiu
    // `/coupons/available`, que responde 404 desde 28/08/2026 — enquanto o
    // front chamou a rota velha, a tela do Clube ficou em "Não foi possível
    // carregar seus cupons" para todo mundo.
    //
    // Os parâmetros de contexto (subtotal, delivery_fee, order_type) são os
    // mesmos de antes: sem eles a resposta é a do Clube, com eles é a do
    // checkout. O que mudou é a RESPOSTA — cada cupom vem com `state`,
    // `discount_amount` e `missing_amount` já decididos (ver club-service.js).
    customerCoupons: restaurantSlug =>
      `/restaurants/${routeSlug(restaurantSlug)}/coupons`,
    previewCoupon: restaurantSlug =>
      `/restaurants/${routeSlug(restaurantSlug)}/coupons/preview`,
    // DIGITAR UM CÓDIGO SEM SACOLA. É o par de `customerCoupons`: resgatado
    // aqui, o cupom passa a ser do cliente e aparece na lista; APLICAR continua
    // sendo outra coisa, no checkout.
    //
    // Resgate NÃO é uso, e a diferença é da campanha: o backend grava em
    // `coupon_claims`, que não tem pedido nem valor, e `coupon_redemptions`
    // continua sendo o registro de uso — é ela que conta no teto. Gravar
    // resgate lá faria um cupom de 100 usos se esgotar com gente que só digitou
    // o código.
    //
    // Idempotente: resgatar de novo devolve o mesmo cupom, 201, sem erro.
    claimCoupon: restaurantSlug =>
      `/restaurants/${routeSlug(restaurantSlug)}/coupons/claim`,
    deliveryEstimate: restaurantSlug =>
      `/restaurants/${routeSlug(restaurantSlug)}/delivery/estimate`,

    productsByCategory: (restaurantSlug, categorySlug) =>
      `/restaurants/${routeSlug(restaurantSlug)}/categories/${routeSlug(categorySlug)}/products`,

    productDetail: (restaurantSlug, productSlug) =>
      `/restaurants/${routeSlug(restaurantSlug)}/products/${routeSlug(productSlug)}`,

    createOrder: restaurantSlug =>
      `/restaurants/${routeSlug(restaurantSlug)}/orders`,

    // A consulta pública por telefone (?phone=) NÃO EXISTE MAIS na API. O único
    // jeito de um visitante alcançar o próprio pedido é o tracking_token que
    // POST /orders devolve — quem tem o token é quem fez o pedido. Cliente
    // logado usa customerOrder(orderId), que autoriza pelo Bearer.
    trackOrder: (restaurantSlug, trackingToken) =>
      `/restaurants/${routeSlug(restaurantSlug)}/orders/track/${routeSlug(trackingToken)}`,

    startOrderPayment: (restaurantSlug, trackingToken) =>
      `/restaurants/${routeSlug(restaurantSlug)}/orders/${routeSlug(trackingToken)}/payment`,

    // CANCELAR O PRÓPRIO PEDIDO, pelo cliente.
    //
    // Autoriza pelo `tracking_token` da URL — o MESMO do acompanhamento, e
    // **sem login, de propósito**: pedido de convidado é caso normal, e exigir
    // conta aqui deixaria justamente o convidado sem saída.
    //
    // O backend só aceita em `pending` e `accepted`. A partir de `preparing` o
    // insumo já saiu do estoque, quem come o prejuízo passa a ser o lojista, e
    // a rota responde **409** — o app manda falar com o restaurante.
    //
    // Ela faz três coisas junto, e é por isso que a tela precisa dizê-las: o
    // pagamento online é ESTORNADO, o cupom volta a ficar disponível e o
    // cashback resgatado volta para o saldo. O estorno acontece depois do
    // commit e não derruba a resposta — gateway fora do ar não impede o
    // cancelamento, uma varredura devolve o dinheiro depois.
    //
    // Sem `Idempotency-Key`, e ela não faz falta: o segundo clique chega com o
    // pedido já em `cancelled` e leva 409 da máquina de estados.
    cancelOrder: (restaurantSlug, trackingToken) =>
      `/restaurants/${routeSlug(restaurantSlug)}/orders/track/${routeSlug(trackingToken)}/cancel`,

    // A CONTRAPARTIDA AUTENTICADA da de cima, publicada pelo backend em
    // 02/09/2026 — o cliente logado cancelando de QUALQUER aparelho.
    //
    // O vínculo aqui sai de `orders.customer_id`, então não há token nenhum
    // para guardar nem para vazar. A do `tracking_token` continua existindo e
    // NÃO é redundância: ela é a única saída do convidado, que não tem conta
    // para autenticar.
    //
    // Mesma janela (`pending`/`accepted`), mesmo 409 a partir de `preparing`,
    // mesmo corpo opcional. O que muda é quem autoriza.
    cancelCustomerOrder: orderId =>
      `/customers/me/orders/${routeSlug(orderId)}/cancel`,

    // ---- Assistente por texto ----
    //
    // Estas duas estavam escritas LITERALMENTE dentro do
    // `restaurant-assistant.js` ('/chat' e '/chat/feedback'), fora do ponto
    // único de rotas. Quem as denunciou foi o aviso novo do
    // `api-contract.test.js`, em 02/09/2026: elas saíram na lista de "rotas que
    // a API oferece e o front não usa" — o app usava as duas, mas nenhuma delas
    // passava por aqui, então a varredura não as via.
    //
    // O preço de estar fora não era teórico: rota literal não é conferida
    // contra o spec pelo teste que existe justamente para isso. Se o backend
    // renomeasse `/chat`, o app quebraria como a tela do Clube quebrou quando
    // `/coupons/available` virou `/coupons` — com todos os portões verdes.
    chat: () => '/chat',
    chatFeedback: () => '/chat/feedback',

    // ---- Atendimento por voz ----
    // Só a emissão exige Bearer; as outras três são abertas. Quando a voz está
    // desligada na plataforma, TODAS respondem 404 — a rota deixa de existir.
    voiceSession: () => '/voice/session',
    voiceSessionConnected: sessionId =>
      `/voice/session/${routeSlug(sessionId)}/connected`,
    voiceSessionEnded: sessionId =>
      `/voice/session/${routeSlug(sessionId)}/ended`,
    voiceSearch: () => '/voice/search',

    // ---- Customer authentication ----
    authRegister: () => '/auth/register',
    authVerifyEmailCode: () => '/auth/verify-email-code',
    authResendEmailCode: () => '/auth/resend-email-code',
    authLogin: () => '/auth/login',
    authForgotPassword: () => '/auth/forgot-password',
    authVerifyResetCode: () => '/auth/verify-reset-code',
    authResetPassword: () => '/auth/reset-password',

    // ---- Entrar com Google ----
    //
    // O NONCE VEM PRIMEIRO, e não é cerimônia. `POST /auth/google/nonce` devolve
    // um par: o `nonce` vai para `google.accounts.id.initialize()` e volta
    // ASSINADO dentro do `id_token`; o `nonce_token` volta para nós ao lado
    // dele. Sem o par, um `id_token` legítimo capturado em qualquer lugar seria
    // aceito aqui como se fosse a pessoa entrando agora — com ele, o token só
    // vale na sessão que pediu o par. Validade de 10 minutos; vencido, o
    // `/auth/google` responde 400 e o caminho é pedir outro par, não consertar
    // nada do lado do app.
    authGoogleNonce: () => '/auth/google/nonce',

    // TRÊS DESFECHOS NUMA RESPOSTA SÓ, decididos pelo campo `status` — é a
    // mesma forma que `LoginResponse` já usa nesta API:
    //
    //   authenticated               o `sub` já é conhecido. Vem `access_token`,
    //                               `token_type` e `customer`; a sessão se usa
    //                               igual à do login por e-mail.
    //   link_confirmation_required  o `sub` é novo e o e-mail JÁ TEM conta aqui.
    //                               NINGUÉM foi logado e NADA foi ligado: saiu um
    //                               código de 6 dígitos por e-mail e veio um
    //                               `link_ticket`. A sessão sai do
    //                               `/auth/verify-email-code`, com o ticket.
    //   profile_required            o `sub` é novo e o e-mail não tem conta. Vêm
    //                               `signup_ticket`, `email` e `name`; faltam
    //                               telefone e data de nascimento, que o Google
    //                               não fornece e `customers` exige.
    //
    // E o que ela NÃO faz: não junta contas por e-mail, em hipótese nenhuma.
    authGoogle: () => '/auth/google',

    // O telefone daqui não aceita enfeite: para cliente logado o pedido copia
    // `customers.phone` no snapshot, e é esse número que o entregador liga.
    // 409 aqui significa RECOMEÇAR (chamar `/auth/google` de novo, que cai
    // sozinho no caso certo), não "tente outros dados".
    authGoogleCompleteSignup: () => '/auth/google/complete-signup',

    // ---- Contas conectadas ----
    //
    // Lista vazia quer dizer "esta conta abre só por e-mail e senha". Junto com
    // o `password_set` de `GET /customers/me`, ela diz exatamente quando o
    // botão de desconectar tem de estar DESABILITADO: conta sem senha utilizável
    // e um único provedor não pode desconectar esse provedor — sem senha e sem
    // provedor ninguém entra mais, e a pessoa só descobriria isso na próxima vez
    // que tentasse entrar, sem nenhuma pista.
    //
    // A lista NÃO traz o `provider_user_id` (o `sub`), de propósito: ele é
    // identificador da pessoa dentro do Google e pertence à exportação da LGPD,
    // que é um pedido explícito — não a uma tela que abre sozinha e cujo corpo
    // passa por log de proxy, cache de app e captura de tela.
    customerSocialAccounts: () => '/customers/me/social',
    customerSocialProvider: provider =>
      `/customers/me/social/${routeSlug(provider)}`,

    // CONECTAR O GOOGLE SEM SAIR DA CONTA. É o caminho de quem já entra por
    // e-mail e senha e quer passar a entrar pelo Google; sem ele a única forma
    // seria sair, tocar em "Entrar com Google" e cair no caso (b) — digitar um
    // código para provar um e-mail que a sessão aberta já provava.
    //
    // O CORPO LEVA A SENHA ATUAL, e isso não é burocracia: conectar ACRESCENTA
    // uma forma de entrar. Sem a senha, um token roubado vira acesso
    // permanente — o ladrão conecta o Google dele, a vítima troca a senha (o
    // que mata todos os tokens) e ele volta pelo botão. Trocar a senha
    // deixaria de ser o que expulsa quem entrou na conta.
    //
    // NÃO EXISTE PROVA POR CÓDIGO NESTA ROTA, e quem diz é o contrato:
    // `LinkGoogleAccountRequest` declara `id_token`, `nonce_token` e
    // `password`, e nada mais — conferido em 04/09/2026, com o `--check` do
    // backend em dia. Enquanto for assim, a tela pede a senha.
    //
    // Conta com `password_set: false` recebe 400 com o caminho escrito
    // ("Defina uma senha antes de conectar outra conta"), e não 401: quem nunca
    // teve senha não errou senha nenhuma. Ver `renderConnectedAccountsHtml()`
    // para por que essa conta não chega a ver o botão.
    customerSocialLinkGoogle: () => '/customers/me/social/google',

    // ---- Authenticated customer ----
    customerMe: () => '/customers/me',
    customerOrders: () => '/customers/me/orders',
    customerOrder: orderId => `/customers/me/orders/${routeSlug(orderId)}`,
    customerCashback: () => '/customers/me/cashback',
    customerCashbackTransactions: ({ limit = 20, offset = 0 } = {}) => {
      const safeLimit = Math.min(50, Math.max(1, Number.parseInt(limit, 10) || 20));
      const safeOffset = Math.max(0, Number.parseInt(offset, 10) || 0);
      return `/customers/me/cashback/transactions?limit=${safeLimit}&offset=${safeOffset}`;
    },
    customerPassword: () => '/customers/me/password',

    // O CÓDIGO QUE CONFIRMA A EXCLUSÃO — e ele NÃO exclui nada.
    //
    // É o passo anterior ao `DELETE /customers/me` para quem tem
    // `password_set: false`: a conta que entrou só pelo Google e nunca definiu
    // senha. O código vai para o e-mail e vale 10 minutos.
    //
    // **Só para conta sem senha.** A que tem senha recebe 400 — um segundo
    // caminho de exclusão onde um bastava deixaria quem tem o token e a caixa
    // de entrada apagar a conta sem saber a senha.
    //
    // A resposta é a MESMA quando o código não sai (cooldown de 60s, ou três
    // códigos em 15 minutos): não há nada que a tela faça de diferente, e
    // variar a resposta só contaria quantos códigos já saíram.
    customerDeleteCode: () => '/customers/me/delete-code',
    customerAddresses: () => '/customers/me/addresses',
    customerAddressesImport: () => '/customers/me/addresses/import',
    customerAddress: addressId =>
      `/customers/me/addresses/${routeSlug(addressId)}`,
    customerAddressDefault: addressId =>
      `/customers/me/addresses/${routeSlug(addressId)}/default`,
    customerCards: restaurantSlug =>
      `/customers/me/cards?restaurant_slug=${routeSlug(restaurantSlug)}`,
    customerCard: cardId =>
      `/customers/me/cards/${routeSlug(cardId)}`,

    // ── O ENTREGADOR ──
    // Outra página (entregador.html), outra credencial: o `link_token` vem no
    // CAMINHO e o código de 6 dígitos vai no header `X-Courier-Code`, em toda
    // requisição. Não há sessão, não há Authorization e não há slug — quem
    // identifica a filial é o próprio token.
    //
    // Ficam aqui, e não num arquivo do entregador, porque este é o ÚNICO
    // arquivo que `tests/unit/api-contract.test.js` lê para saber o que o
    // front chama. Rota declarada noutro lugar nasce sem guarda, e foi assim
    // que `/coupons/available` sobreviveu 404 por semanas.
    courierMe: linkToken =>
      `/courier/${routeSlug(linkToken)}/me`,
    courierOrders: linkToken =>
      `/courier/${routeSlug(linkToken)}/orders`,
    courierOrdersOutForDelivery: linkToken =>
      `/courier/${routeSlug(linkToken)}/orders/out-for-delivery`,
    courierOrderDelivered: (linkToken, orderId) =>
      `/courier/${routeSlug(linkToken)}/orders/${routeSlug(orderId)}/delivered`,
    courierHistory: (linkToken, { startDate, endDate } = {}) => {
      const q = new URLSearchParams();
      if (startDate) q.set('start_date', startDate);
      if (endDate) q.set('end_date', endDate);
      const query = q.toString();
      return `/courier/${routeSlug(linkToken)}/history${query ? `?${query}` : ''}`;
    }
  };

  window.API_ROUTES = API_ROUTES;
  window.PedeAquiApiRoutes = API_ROUTES;
})();
