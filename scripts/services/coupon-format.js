// ============================================================================
//  O rótulo de um cupom. UMA implementação.
//
//  Havia duas — `couponLabel()` em restaurant-page.js (folha de detalhe) e
//  `getCouponLabel()` em restaurant-club.js (card da lista) — e elas NÃO eram
//  cópias: já tinham divergido em dois pontos. Isso é o pior caso da
//  duplicação, porque a tela de detalhe podia anunciar um desconto e o card do
//  mesmo cupom, na tela anterior, anunciar outro.
//
//  As duas divergências, e qual lado ficou:
//
//  1. VALOR ZERO. A versão do Clube reconhecia `discount_type: 'fixed'` e
//     imprimia o valor SEM conferir se ele existe. Um cupom fixo com
//     `discount_value` ausente virava "R$ 0,00 OFF" — que é exatamente o
//     defeito que o comentário daquele mesmo arquivo conta ter acontecido do
//     lado percentual ("0% OFF": o desconto certo, anunciado como nenhum).
//     Ficou a regra da outra: só imprime valor se houver valor. Sem ele, cai
//     para o nome do cupom, que informa mais que um zero falso.
//
//  2. FALLBACK. A versão da folha tentava `coupon.code` antes de desistir para
//     'Cupom'; a do Clube ia direto para 'Cupom'. Ficou a da folha — um código
//     identifica o cupom, "Cupom" não identifica nada.
//
//  O CAMINHO NORMAL NÃO PASSA POR NADA DISSO. Nos dois contratos o rótulo vem
//  PRONTO no campo `title`, e é a primeira coisa lida aqui. O cálculo abaixo é
//  a rede de baixo, para a vitrine pública do /menu (PublicCouponResponse, que
//  ainda manda o valor). Em CustomerCouponResponse o campo `discount_value`
//  NÃO EXISTE — ele é parâmetro da conta, e quem faz a conta é o backend.
//  Reconstruir desconto aqui não é opção; ler `title` é.
// ============================================================================
(function () {
  /** "30.00" e 30 chegam aqui pelos dois contratos. Não numérico vira 0. */
  function couponAmount(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : 0;
  }

  function couponLabel(coupon) {
    const source = coupon || {};
    const title = String(source.title || '').trim();
    if (title) return title;
    const type = String(source.discount_type || source.type || '').toLowerCase();
    const value = couponAmount(source.discount_value ?? source.value ?? source.amount);
    if (type === 'percent' || type === 'percentage') return `${value.toLocaleString('pt-BR')}% OFF`;
    if (type === 'free_delivery' || type === 'free_shipping') return 'Frete grátis';
    if (value > 0) return `${window.PedeAquiCurrency.formatCurrency(value)} OFF`;
    return source.name || source.code || 'Cupom';
  }

  window.PedeAquiCouponFormat = { couponLabel, couponAmount };
})();
