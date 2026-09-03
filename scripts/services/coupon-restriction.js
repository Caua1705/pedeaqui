// ============================================================================
//  AS DUAS RESTRIÇÕES QUE O CUPOM PODE TER, EM PORTUGUÊS.
//
//  `CustomerCouponState` tem cinco valores, e até 03/09/2026 o front conhecia
//  três: `payment_method_not_allowed` e `outside_hours` eram DESCARTADOS por
//  `club-service.normalizeCustomerCoupons`. O cupom sumia da lista do Clube — e
//  desde `judgedCouponForDetail`, o descarte fazia a folha de detalhe cair no
//  cupom da vitrine (sem `state`) e o botão dizer "Usar cupom" para um cupom
//  que o backend acabou de recusar.
//
//  Este arquivo existe para que a frase que o cliente lê NUNCA seja o código do
//  backend. É a mesma disciplina de `services/coupon-reason.js`, criado quando
//  `minimum_order_not_reached` chegou cru a um toast: **tabela NOMINAL, e o que
//  não estiver nela devolve string vazia** para o chamador cair numa frase
//  genérica em português, em vez de virar um palpite.
//
//  OS DOIS CAMPOS SÃO DO CONTRATO, conferidos em `scripts/types/api.d.ts`:
//
//    allowed_payment_methods  string[] | null   (CustomerCouponResponse)
//    valid_hours_from         string | null     format: time
//    valid_hours_until        string | null     format: time
//
//  `valid_hours_from` e `valid_hours_until` ANDAM JUNTOS — o backend recusa um
//  sem o outro (`_faixa_do_dia_valida` em coupon_schema.py) e recusa os dois
//  iguais. Aqui isso não é assumido: sem os dois, a frase não sai.
//
//  E o vocabulário de forma de pagamento é o `PAYMENT_METHODS` do backend
//  (src/core/constants.py), com SETE valores. A tabela cobre os sete. Um oitavo
//  valor que o backend publique amanhã cai no vazio e vira a frase genérica —
//  que é o comportamento certo, e não "meal voucher" na tela.
// ============================================================================
(function () {
  // O vocabulário fechado do backend. `other` é a etiqueta que o próprio
  // backend usa para "a lista precisa crescer": traduzi-la para um nome
  // específico seria inventar a forma de pagamento.
  const FORMAS = {
    pix: 'Pix',
    credit_card: 'cartão de crédito',
    debit_card: 'cartão de débito',
    cash: 'dinheiro',
    voucher: 'vale',
    meal_voucher: 'vale-refeição',
    other: ''
  };

  /** "15:00:00" -> "15h"; "15:30:00" -> "15h30". '' para qualquer outra coisa. */
  function horaCurta(valor) {
    const m = /^(\d{2}):(\d{2})/.exec(String(valor ?? '').trim());
    if (!m) return '';
    const [, hora, minuto] = m;
    const h = String(Number(hora));
    return minuto === '00' ? `${h}h` : `${h}h${minuto}`;
  }

  /**
   * "Vale das 15h às 18h" — ou '' quando o contrato não deu a faixa.
   *
   * Devolver '' importa: o estado `outside_hours` diz que o cupom está fora do
   * horário, e a faixa é o ÚNICO dado que torna a frase acionável ("volto às
   * 15h"). Sem ela, uma frase inventada seria pior que a genérica.
   */
  function couponHoursPhrase(coupon) {
    const de = horaCurta(coupon?.valid_hours_from);
    const ate = horaCurta(coupon?.valid_hours_until);
    if (!de || !ate) return '';
    return `Vale das ${de} às ${ate}`;
  }

  /**
   * "Só no Pix" / "Só no Pix ou no cartão de crédito" — ou '' quando a lista
   * não veio, veio vazia, ou só tem nomes que este front não sabe dizer.
   *
   * Lista vazia NÃO é "não vale em forma nenhuma": o backend recusa a lista
   * vazia com 422 (`allowed_payment_methods vazio não vale em forma nenhuma`),
   * e `null` é que quer dizer "vale em todas". Nos dois casos aqui a frase não
   * sai, porque não há restrição a anunciar.
   */
  function couponPaymentPhrase(coupon) {
    const lista = Array.isArray(coupon?.allowed_payment_methods) ? coupon.allowed_payment_methods : [];
    const nomes = lista
      .map(forma => FORMAS[String(forma ?? '').trim().toLowerCase()])
      .filter(Boolean);
    if (!nomes.length) return '';
    // "no Pix" e "no cartão de crédito": a preposição é a mesma para todos os
    // nomes desta tabela, então ela mora aqui e não em cada linha.
    const comArtigo = nomes.map(nome => `no ${nome}`);
    const frase = comArtigo.length === 1
      ? comArtigo[0]
      : `${comArtigo.slice(0, -1).join(', ')} ou ${comArtigo[comArtigo.length - 1]}`;
    // "Só no Pix" — maiúscula só na primeira letra da frase inteira, para
    // "Só no cartão de crédito" não virar "Só No Cartão".
    return `Só ${frase}`;
  }

  window.PedeAquiCouponRestriction = { couponHoursPhrase, couponPaymentPhrase, FORMAS };
})();
