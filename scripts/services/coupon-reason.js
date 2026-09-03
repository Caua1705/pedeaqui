// ============================================================================
//  O MOTIVO DA RECUSA DE UM CUPOM, EM PORTUGUÊS.
//
//  `CouponPreviewResponse.ineligibility_reason` é `string | null` no contrato,
//  mas o que vem ali NÃO é uma frase: é um CÓDIGO INTERNO do backend
//  (`coupon_service.py`, os treze `reason=`). O front mostrava esse campo cru,
//  e o cliente com uma sacola de R$ 11 e um cupom de mínimo R$ 30 lia, num
//  toast escuro, `minimum_order_not_reached`.
//
//  O comentário que autorizava aquilo dizia "a razão vem do backend em
//  português e é específica". Metade certa — ela é específica —, e a metade
//  errada é a que custou a tela.
//
//  ## A tabela é NOMINAL, e isso é a decisão
//
//  Mesmo desenho de `CARD_DECLINE_REASONS` (restaurant-pix-flow.js), pelo mesmo
//  motivo: um código que este front não conhece precisa cair na frase genérica
//  de quem chamou, e não virar um palpite errado sobre o que o cliente deve
//  fazer. Por isso o desconhecido devolve `''` — a mesma convenção de
//  `api-error.detailText`, onde string vazia significa "não há texto meu aqui,
//  use o seu".
//
//  Os treze códigos abaixo são os `reason=` que o backend produz hoje. Quatro
//  deles nunca chegam pela LISTA de cupons (o backend os transforma em "o card
//  não aparece", via `REASON_TO_STATE`), mas todos chegam pelo
//  `POST /coupons/preview`, que é onde um código digitado à mão é julgado.
//
//  ## Quanto falta
//
//  `CouponPreviewResponse` não devolve `missing_amount` — só a lista devolve.
//  Então a frase mais útil das treze, a do pedido mínimo, precisa do número de
//  algum lugar, e ele sai de dois valores que o BACKEND deu: o
//  `min_order_value` do cupom e o `subtotal` que acabou de ser enviado no
//  preview. É a mesma subtração que o backend faz
//  (`missing_amount = minimum - subtotal`), sobre as mesmas duas entradas.
//
//  Isto NÃO é o front calculando dinheiro: o número não entra na sacola, não
//  entra no payload e não muda total nenhum — ele existe só dentro da frase. E
//  quando não dá para calcular (sem mínimo, ou já atingido), a frase degrada
//  para a genérica em vez de anunciar "Faltam R$ 0,00".
// ============================================================================
(function () {
  const MOTIVOS = Object.freeze({
    login_required: 'Entre na sua conta para usar este cupom.',
    outside_hours: 'Este cupom não vale neste horário.',
    payment_method_not_allowed: 'Este cupom não vale para a forma de pagamento escolhida.',
    expired: 'Este cupom venceu.',
    not_started: 'Este cupom ainda não começou a valer.',
    inactive: 'Este cupom não está mais disponível.',
    not_visible: 'Este cupom não está disponível para a sua conta.',
    coupon_from_another_restaurant: 'Este cupom não é deste restaurante.',
    total_limit_reached: 'Este cupom já atingiu o limite de usos.',
    customer_limit_reached: 'Você já usou este cupom o número máximo de vezes.',
    cooldown_active: 'Você usou este cupom há pouco tempo. Tente de novo mais tarde.',
    first_order_only: 'Este cupom é só para a primeira compra.'
  });

  /**
   * @param {unknown} reason  `ineligibility_reason` cru
   * @param {{ faltam?: number, fmt?: (n: number) => string }} [contexto]
   * @returns {string} a frase para o cliente, ou '' se este front não conhece
   *   o código — aí quem chamou escreve a dele.
   */
  function couponReasonMessage(reason, contexto = {}) {
    const codigo = String(reason ?? '').trim().toLowerCase();
    if (!codigo) return '';

    // O único que muda de frase conforme o contexto.
    if (codigo === 'minimum_order_not_reached') {
      const faltam = Number(contexto.faltam);
      const fmt = contexto.fmt || ((valor) => String(valor));
      return faltam > 0
        ? `Faltam ${fmt(faltam)} para usar este cupom.`
        : 'Este cupom exige um pedido maior. Adicione mais itens à sacola.';
    }

    return MOTIVOS[codigo] || '';
  }

  /**
   * Quanto falta para o pedido mínimo do cupom, a partir dos DOIS valores que o
   * backend conhece. `null` quando não dá para responder — e `null` é resposta,
   * não erro: a frase genérica é melhor que um "Faltam R$ 0,00".
   *
   * `min_order_value` chega como string decimal em `CustomerCouponResponse` e
   * como número em `PublicCouponResponse`; `Number()` atende os dois.
   */
  function couponMissingAmount(coupon, subtotal) {
    const minimo = Number(coupon?.min_order_value);
    const sacola = Number(subtotal);
    if (!Number.isFinite(minimo) || !Number.isFinite(sacola)) return null;
    const falta = Math.round((minimo - sacola) * 100) / 100;
    return falta > 0 ? falta : null;
  }

  window.PedeAquiCouponReason = { couponReasonMessage, couponMissingAmount, MOTIVOS };
})();
