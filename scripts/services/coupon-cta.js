// ============================================================================
//  O QUE O BOTÃO DO CUPOM FAZ — uma implementação, três superfícies.
//
//  A regra dura do fluxo de cupons (decidida em 28/08/2026, construída em
//  02/09/2026): **quem decide se o cupom cabe é sempre o backend**, e o front
//  só traduz o veredito em rótulo e destino. `CustomerCouponState` já vem
//  resolvido contra a sacola que a lista informou:
//
//      applicable | missing_amount | login_required
//
//  Não existe estado para "não tem conserto": cupom vencido, de outro segmento
//  ou de primeira compra para quem já comprou simplesmente NÃO VEM na lista
//  (está escrito no `@description` de CustomerCouponState). Por isso aqui não
//  há ramo de "indisponível" — se ele chegou, existe ação que o destrava.
//
//  ## A quarta situação, que o backend não pode conhecer: a sacola vazia
//
//  Um cupom SEM pedido mínimo volta `applicable` mesmo com a sacola vazia — do
//  ponto de vista da campanha ele cabe. Mas aplicar sobre nada é aplicar para
//  depois falhar, que é exatamente o que este fluxo existe para não fazer: até
//  02/09/2026 `confirmCouponDetail()` com a sacola vazia GUARDAVA o cupom
//  ("Cupom selecionado. Adicione produtos à sacola para usar") e ele seguia
//  armado, indo no `coupon_id` do pedido, sem nunca ter passado por um preview.
//  Num cupom de uso único isso o queima.
//
//  A sacola é a única coisa desta decisão que o front sabe e o backend não —
//  e é por isso que ela entra por parâmetro, e não por adivinhação.
//
//  ## O cupom SEM `state`, que é o da vitrine pública
//
//  A folha de detalhe recebe DOIS contratos (ver o cabeçalho dela):
//  `CustomerCouponResponse`, em que `state` é obrigatório, e
//  `PublicCouponResponse` (o feed do `/menu`), que não tem `state` nenhum —
//  ele é a vitrine, e o backend nunca o julgou contra ESTA pessoa.
//
//  Ausência de `state` NÃO é estado desconhecido, e a diferença decide se o
//  botão cobra ou não:
//
//  - **ausente** = nunca julgado. Aplicar continua passando pelo julgamento do
//    backend, só que uma porta adiante: `previewSelectedCoupon()` chama
//    `POST /coupons/preview`, que é A MESMA função que decidiu os estados da
//    lista. A regra dura ("quem decide se cabe é sempre o backend") continua
//    valendo — o veredito só chega depois do toque.
//  - **presente mas desconhecido** = um valor que este front não sabe ler.
//    Aí "Usar cupom" seria um botão que cobra às cegas, e o destino é o
//    cardápio.
//
//  ## O rótulo do caso que aplica é "Usar cupom" — e isso é uma REVERSÃO
//
//  Em 02/09/2026 ele deixou de ser "Usar cupom" e virou "Aplicar cupom". O
//  motivo estava certo e continua registrado: até ali o botão dizia "Usar
//  cupom" nos QUATRO casos, inclusive para quem não tinha atingido o mínimo,
//  para quem precisava entrar e para quem estava com a sacola vazia — e nesse
//  último "usar" guardava o cupom armado sem preview nenhum.
//
//  O que mudou não foi a decisão, foi o mundo em volta dela: os outros três
//  casos ganharam rótulo próprio ("Faltam R$ X", "Entre para usar", "Ver
//  cardápio"), então "Usar cupom" passou a aparecer SÓ onde o cupom de fato
//  pode ser usado. Aí ele é a palavra do cliente, e "aplicar" é a nossa.
//
//  A guarda do motivo antigo NÃO foi apagada, foi invertida (§14.8): o
//  unitário exige que nenhum dos outros três estados diga "Usar cupom".
//
//  ## Precedência: o VEREDITO DO BACKEND vence a sacola vazia
//
//  Quando os dois valem (visitante, sacola vazia), o rótulo é "Entre para
//  usar". O motivo: `login_required` é o veredito que o backend deu SOBRE ESTE
//  CUPOM, e sem conta ele não aparece nem na lista depois; a sacola vazia é
//  uma condição da tela, que se resolve sozinha ao navegar. Mostrar "Ver
//  cardápio" a quem precisa entrar manda a pessoa para o lugar errado.
//
//  A mesma precedência vale para os quatro estados: eles são o que o servidor
//  decidiu, e a sacola vazia é o que a tela sabe.
//
//  ## Os cinco estados, e a decisão de cada um (03/09/2026)
//
//  Até esta data o front conhecia TRÊS dos cinco `CustomerCouponState`:
//  `payment_method_not_allowed` e `outside_hours` eram descartados por
//  `club-service.normalizeCustomerCoupons`, o cupom sumia da lista, e — desde
//  `judgedCouponForDetail` — a folha de detalhe caía no cupom da vitrine e o
//  botão dizia "Usar cupom" para um cupom que o backend acabou de recusar.
//
//    applicable                  "Usar cupom"          aplica
//    missing_amount              "Faltam R$ X"         cardápio
//    login_required              "Entre para usar"     login
//    outside_hours               "Vale das 15h às 18h" NADA
//    payment_method_not_allowed  "Só no Pix"           escolha de pagamento
//
//  As duas decisões novas, e por que elas são diferentes uma da outra:
//
//  - **fora do horário o card APARECE.** Sumir de manhã seria pior — a
//    campanha da tarde ficaria invisível justamente para quem olha o Clube
//    antes das 15h. E o botão NÃO leva a lugar nenhum: não existe tela que
//    adiante o relógio, e mandar ao cardápio prometeria uma solução que não
//    existe. É o único caso em que a ação certa é nenhuma.
//  - **forma de pagamento a pessoa resolve agora**, e por isso o botão leva à
//    escolha de pagamento. O backend só marca este estado quando a forma JÁ
//    foi escolhida, então existe uma escolha para desfazer.
//
//  NENHUM DOS DOIS PODE DIZER "Usar cupom" — era esse o defeito.
//
//  As frases saem de `services/coupon-restriction.js`, tabela NOMINAL sobre
//  `allowed_payment_methods` / `valid_hours_from` / `valid_hours_until`: código
//  do backend não vira texto de tela (§14.5 da skill).
// ============================================================================
(function () {
  const ACOES = Object.freeze({
    APLICAR: 'aplicar',
    VER_CARDAPIO: 'ver-cardapio',
    ENTRAR: 'entrar',
    // A forma de pagamento escolhida não é uma das que o cupom aceita. O
    // destino é a escolha de pagamento, que é onde isso se resolve.
    VER_PAGAMENTO: 'ver-pagamento',
    // Fora da faixa de horário. NÃO LEVA A LUGAR NENHUM, de propósito: não
    // existe tela que adiante as 15h. O botão diz quando o cupom vale e para
    // por aí — é a única ação honesta.
    SEM_DESTINO: 'sem-destino'
  });

  /**
   * @param {object} coupon CustomerCouponResponse (state, missing_amount)
   * @param {{ sacolaVazia: boolean, fmt: (n: number) => string }} contexto
   * @returns {{ acao: string, rotulo: string }}
   */
  function couponCta(coupon, contexto) {
    // Cupom NENHUM não é "cupom sem state": sem objeto não há o que aplicar, e
    // o ramo da vitrine pública abaixo trataria `undefined` como aplicável.
    if (!coupon) return { acao: ACOES.VER_CARDAPIO, rotulo: 'Ver cardápio' };
    const estado = coupon.state;
    const fmt = contexto?.fmt || ((n) => String(n));

    if (estado === 'login_required') {
      return { acao: ACOES.ENTRAR, rotulo: 'Entre para usar' };
    }

    if (estado === 'missing_amount') {
      const falta = window.PedeAquiCouponFormat.couponAmount(coupon.missing_amount);
      // Sem o quanto falta não há frase acionável; o destino continua o mesmo.
      return {
        acao: ACOES.VER_CARDAPIO,
        rotulo: falta > 0 ? `Faltam ${fmt(falta)}` : 'Ver cardápio'
      };
    }

    // FORA DO HORÁRIO — o card APARECE, e é essa a decisão.
    //
    // Sumir de manhã seria pior: a campanha da tarde ficaria invisível para
    // quem olha o Clube antes das 15h, que é justamente quem ela quer trazer.
    // O botão diz a faixa e não leva a lugar nenhum — não há tela que adiante
    // o relógio, e mandar ao cardápio prometeria uma solução que não existe.
    if (estado === 'outside_hours') {
      const faixa = window.PedeAquiCouponRestriction.couponHoursPhrase(coupon);
      // Sem a faixa no contrato não há frase acionável, e a genérica é a
      // resposta certa — nunca um horário inventado.
      return { acao: ACOES.SEM_DESTINO, rotulo: faixa || 'Fora do horário' };
    }

    // FORMA DE PAGAMENTO — este a pessoa resolve agora, e o botão leva lá.
    //
    // O backend só marca este estado quando a forma JÁ foi escolhida (é o
    // parâmetro `payment_method` de `GET /coupons`), então existe uma escolha
    // para desfazer e a tela de pagamento é onde ela mora.
    if (estado === 'payment_method_not_allowed') {
      const formas = window.PedeAquiCouponRestriction.couponPaymentPhrase(coupon);
      return { acao: ACOES.VER_PAGAMENTO, rotulo: formas || 'Vale em outra forma de pagamento' };
    }

    if (contexto?.sacolaVazia) {
      return { acao: ACOES.VER_CARDAPIO, rotulo: 'Ver cardápio' };
    }

    // `applicable` (o backend já julgou e cabe) e AUSENTE (a vitrine pública,
    // que o backend julga no preview) dão no mesmo botão. Ver o cabeçalho.
    if (estado === 'applicable' || estado === undefined || estado === null || estado === '') {
      return { acao: ACOES.APLICAR, rotulo: 'Usar cupom' };
    }

    // Estado que este front não conhece. `club-service.normalizeCustomerCoupons`
    // já descarta a linha antes de chegar aqui, então isto é a rede de baixo:
    // mandar para o cardápio nunca cobra nada de ninguém, e "Usar cupom"
    // sobre um estado desconhecido, sim.
    return { acao: ACOES.VER_CARDAPIO, rotulo: 'Ver cardápio' };
  }

  window.PedeAquiCouponCta = { couponCta, ACOES };
})();
