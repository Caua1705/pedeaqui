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
//  ## Precedência: `login_required` vence a sacola vazia
//
//  Quando os dois valem (visitante, sacola vazia), o rótulo é "Entre para
//  usar". O motivo: `login_required` é o veredito que o backend deu SOBRE ESTE
//  CUPOM, e sem conta ele não aparece nem na lista depois; a sacola vazia é
//  uma condição da tela, que se resolve sozinha ao navegar. Mostrar "Ver
//  cardápio" a quem precisa entrar manda a pessoa para o lugar errado.
// ============================================================================
(function () {
  const ACOES = Object.freeze({
    APLICAR: 'aplicar',
    VER_CARDAPIO: 'ver-cardapio',
    ENTRAR: 'entrar'
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
