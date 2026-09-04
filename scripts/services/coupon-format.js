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
    const type = String(source.discount_type || '').toLowerCase();
    const value = couponAmount(source.discount_value);
    if (type === 'percent' || type === 'percentage') return `${value.toLocaleString('pt-BR')}% OFF`;
    if (type === 'free_delivery' || type === 'free_shipping') return 'Frete grátis';
    if (value > 0) return `${window.PedeAquiCurrency.formatCurrency(value)} OFF`;
    return source.name || source.code || 'Cupom';
  }

  // ── O PRAZO DO CUPOM, e o sentinela do banco que vazava para a tela ──
  //
  //  O relato: a folha de detalhe anunciava "Válido até 31/12/2099", e o card
  //  do Clube — que escreve só dia/mês — anunciava a MESMA linha como
  //  "Válido até 31/12", disfarçada de prazo desta virada de ano.
  //
  //  2099 não é um prazo: é como se escrevia "para sempre" enquanto
  //  `restaurant_coupons.valid_until` era NOT NULL no banco (a migração
  //  `20260722_add_coupon_campaigns.sql` faz `ALTER COLUMN valid_until SET NOT
  //  NULL`). Desde 02/09/2026 a coluna é anulável e campanha sem prazo se diz
  //  com NULO — que esta função já tratava. As linhas antigas continuam lá.
  //
  //  A régua é DISTÂNCIA, não uma lista de datas proibidas. Lista nominal é o
  //  idioma daqui para CÓDIGO de conjunto fechado (coupon-reason.js, os treze
  //  `reason=`); data não é código, e quem escreveu "para sempre" pôde digitar
  //  31/12/2099, 01/01/2100 ou o que quisesse — uma lista erra em silêncio na
  //  primeira que não estiver nela. A pergunta que a linha responde é "dá
  //  tempo?", e uma data a uma década daqui não responde isso em campanha
  //  nenhuma.
  //
  //  O outro lado da conta fixa a ordem de grandeza: a MESMA migração
  //  preencheu o campo ausente com `now() + interval '1 year'`, e essas linhas
  //  são prazos de verdade que têm de continuar aparecendo. Dez anos deixa uma
  //  ordem de grandeza inteira entre os dois casos.
  //
  //  Guarda: tests/unit/coupon-deadline.test.js.
  const ANOS_ATE_DEIXAR_DE_SER_PRAZO = 10;

  const prazoQueNaoVence = (ano) =>
    Number.isFinite(ano) && ano - new Date().getFullYear() >= ANOS_ATE_DEIXAR_DE_SER_PRAZO;

  function couponDeadline(value, { withYear = false } = {}) {
    if (!value) return '';
    const raw = String(value);
    const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (match) {
      const [, ano, mes, dia] = match;
      if (prazoQueNaoVence(Number(ano))) return '';
      return withYear ? `${dia}/${mes}/${ano}` : `${dia}/${mes}`;
    }
    const date = new Date(raw);
    if (Number.isNaN(date.getTime())) return raw;
    if (prazoQueNaoVence(date.getFullYear())) return '';
    return new Intl.DateTimeFormat('pt-BR', withYear ? undefined : { day: '2-digit', month: '2-digit' })
      .format(date);
  }

  window.PedeAquiCouponFormat = { couponLabel, couponAmount, couponDeadline };
})();
