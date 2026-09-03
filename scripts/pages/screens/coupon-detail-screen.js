// ============================================================================
//  Folha de detalhe do cupom — ler regras, e SÓ confirmar aplica.
//
//  A separação que vale dinheiro continua a mesma da skill §4:
//  `couponDetailCoupon` (aberto para LEITURA) mora AQUI, dentro da tela;
//  `selectedCoupon` (APLICADO à sacola, vai no payload) mora no
//  restaurant-page, e a folha só o toca pelas três portas da shell
//  (armSelectedCoupon / restoreSelectedCoupon / persistCouponChoice).
//  Fechar a leitura nunca desaplica o que já valia.
// ============================================================================
(function () {
  let $, esc, fmt;
  let app, shell;
  const UI = () => window.PedeAquiRestaurantUi;

  let couponDetailCoupon = null;
  let couponDetailScrollY = 0;

  // .coupon-detail-art — width:min(100%,414px) (styles/utilities.css:237).
  const COUPON_DETAIL_FLUID = {
    widths: [414, 620, 828, 1242],
    sizes: '(max-width: 414px) 100vw, 414px'
  };

  // ============================================================
  //  Esta tela de detalhe serve DOIS contratos, e é preciso saber disso.
  //
  //  Vitrine pública (`payload.coupons`, de GET /menu — PublicCouponResponse):
  //    name, discount_type, discount_value (número), min_order_value (número).
  //  Feed do cliente (clubController, de GET /coupons — CustomerCouponResponse):
  //    title, state, label, discount_amount, missing_amount, valid_until,
  //    min_order_value (string decimal). NÃO tem discount_value.
  //
  //  Por isso cada leitor abaixo prefere o campo já resolvido e só cai no
  //  cálculo quando ele falta — que é exatamente o caso da vitrine.
  // ============================================================

  // Rótulo e valor do cupom: implementação única em
  // scripts/services/coupon-format.js. A folha de detalhe e o card do Clube
  // liam duas versões JÁ DIVERGENTES — o cabeçalho de lá conta em quê.
  const couponAmount = (value) => window.PedeAquiCouponFormat.couponAmount(value);
  const couponLabel = (coupon) => window.PedeAquiCouponFormat.couponLabel(coupon);

  /** "2099-12-31T23:59:59Z" -> "31/12/2099". */
  function couponValidUntil(value) {
    if (!value) return '';
    const match = String(value).match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (match) return `${match[3]}/${match[2]}/${match[1]}`;
    const date = new Date(value);
    return Number.isNaN(date.getTime())
      ? String(value)
      : new Intl.DateTimeFormat('pt-BR').format(date);
  }

  function couponRules(coupon) {
    const rules = [];
    const minimum = couponAmount(coupon.min_order_value ?? coupon.minimum_order_value ?? coupon.min_subtotal);
    const discount = couponAmount(coupon.discount_amount);
    const missing = couponAmount(coupon.missing_amount);
    // O desconto desta sacola, quando o backend já o decidiu. Vem antes do
    // mínimo porque é a resposta à pergunta que traz a pessoa até aqui.
    if (coupon.state === 'applicable' && discount > 0) {
      rules.push(`Desconto de ${fmt(discount)} nesta sacola`);
    }
    if (coupon.state === 'missing_amount' && missing > 0) {
      rules.push(`Faltam ${fmt(missing)} para este cupom valer`);
    }
    if (coupon.state === 'login_required') {
      rules.push('Entre na sua conta para usar este cupom');
    }
    if (minimum > 0) rules.push(`Em pedidos a partir de ${fmt(minimum)}`);
    // A data ia CRUA para a tela ("Válido até 2099-12-31T23:59:59Z"). Na
    // vitrine o campo não vinha, então ninguém tinha visto ainda.
    //
    // `valid_until` DEIXOU de ser obrigatório em 02/09/2026: em
    // `CustomerCouponResponse` ele é `string | null` e saiu do `required`, ou
    // seja, cupom sem prazo agora é legal. A linha inteira sai quando não há
    // data — que é o certo, e é o mesmo princípio da sacola: parcela sem valor
    // é linha FORA, nunca um rótulo com o campo vazio atrás.
    //
    // `expires_at` NÃO EXISTE em cupom nenhum do contrato (ele é de cashback e
    // de pagamento), então o primeiro operando é `undefined` em 100% das
    // chamadas e quem responde é sempre o segundo. Está aqui só por inércia:
    // não quebra nada hoje, e vira armadilha no dia em que o backend criar um
    // `expires_at` de cupom com outra semântica.
    const validUntil = couponValidUntil(coupon.expires_at || coupon.valid_until);
    if (validUntil) rules.push(`Válido até ${validUntil}`);
    // `max_discount` saiu de propósito do contrato do cliente: teto é limite
    // interno da campanha, e publicá-lo só serviria para refazer a conta.
    if (coupon.description) rules.push(coupon.description);
    return rules;
  }

  function openCouponDetail(code, source) {
    const coupon = shell.getCouponForDetail(code);
    if (!coupon) return;
    // ABRIR É LER. Só confirmCouponDetail() aplica — ver a nota em
    // `couponDetailCoupon`, lá em cima.
    couponDetailCoupon = coupon;
    document.body.classList.add('coupon-nav-keep');
    couponDetailScrollY = UI().currentScrollY();
    UI().lockBodyScroll(couponDetailScrollY, 'soft');
    const image = shell.couponImageUrl(coupon);
    const label = couponLabel(coupon);
    const minText = Number(coupon.min_order_value) > 0 ? `Pedido mínimo ${fmt(coupon.min_order_value)}` : 'Sem mínimo informado';
    const art = $('couponDetailArt');
    if (art) {
      const fallbackMarkup = `<div class="coupon-detail-art-fallback"><span>Cupom</span><strong>${esc(label)}</strong></div>`;
      const preview = shell.readyCardImage(source, '.coupon-card', '.coupon-art img')
        || shell.readyCardImage(source, '.club-available-coupon-card', '.club-available-coupon-image');
      if (image) {
        shell.renderDetailImage(art, {
          url: image,
          alt: coupon.name || coupon.title || label,
          className: 'coupon-detail-photo',
          fluid: COUPON_DETAIL_FLUID,
          preview,
          fallbackMarkup
        });
      } else {
        art.innerHTML = fallbackMarkup;
      }
    }
    if ($('couponDetailTitle')) $('couponDetailTitle').textContent = coupon.name || coupon.title || label;
    if ($('couponDetailCode')) $('couponDetailCode').textContent = coupon.code || 'CUPOM';
    if ($('couponDetailMin')) $('couponDetailMin').textContent = minText;
    const rules = $('couponDetailRules');
    if (rules) rules.innerHTML = couponRules(coupon).map(rule => `<li>${esc(rule)}</li>`).join('');
    $('couponDetailOverlay')?.classList.add('active');
  }

  function closeCouponDetail(event) {
    if (event && event.currentTarget && event.target !== event.currentTarget) return;
    const restoreY = couponDetailScrollY;
    const overlay = $('couponDetailOverlay');
    // A leitura acabou. `selectedCoupon` NÃO é tocado aqui de propósito: se um
    // cupom já estava aplicado à sacola, abrir outro para ler e fechar não pode
    // desaplicar o que estava valendo.
    couponDetailCoupon = null;
    overlay?.classList.remove('active');
    document.body.classList.remove('coupon-nav-keep');
    setTimeout(() => {
      if (!UI().hasBlockingUiOpen()) UI().unlockBodyScroll(restoreY);
    }, 560);
  }

  /**
   * O ÚNICO caminho que aplica um cupom à sacola.
   *
   * Toca no `selectedCoupon` só depois de o cupom ter passado por todas as
   * portas, e o desarma de novo se ele não passar — sair daqui com um cupom
   * armado que o backend recusou é o mesmo defeito de antes, uma porta adiante.
   */
  async function confirmCouponDetail() {
    const coupon = couponDetailCoupon;
    if (!coupon) return;
    // `requires_login` era do contrato antigo e sumiu junto com
    // /coupons/available. Como o campo deixou de existir, a comparação
    // `=== true` passou a ser sempre falsa: o cupom que exige conta seguia
    // direto para o preview, que respondia 401, e o cliente via "Não foi
    // possível aplicar este cupom" em vez da tela de login.
    if (coupon.state === 'login_required' && !app.isLogged()) {
      shell.openLoginScreen('coupon');
      return;
    }
    // O cupom que ainda não cabe nesta sacola não vira tentativa: o backend já
    // disse quanto falta, e gastar uma requisição para ouvir a mesma coisa só
    // adiaria o aviso.
    if (coupon.state === 'missing_amount') {
      const missing = couponAmount(coupon.missing_amount);
      shell.showCouponNotice(missing > 0
        ? `Faltam ${fmt(missing)} na sacola para usar este cupom.`
        : 'Este cupom ainda não vale para esta sacola.');
      return;
    }

    const previousCoupon = shell.armSelectedCoupon(coupon);

    if (!app.cart.length) {
      // Escolha explícita com a sacola vazia: fica guardado para quando houver
      // itens. É o único caso em que armar sem preview é o que a pessoa pediu.
      shell.persistCouponChoice();
      closeCouponDetail();
      await shell.mobNavMenu();
      shell.showCouponNotice('Cupom selecionado. Adicione produtos à sacola para usar.');
      return;
    }

    const button = document.querySelector('.coupon-detail-use');
    if (button) {
      button.disabled = true;
      button.textContent = 'Validando...';
    }
    const preview = await shell.previewSelectedCoupon();
    if (button) {
      button.disabled = false;
      button.textContent = 'Usar cupom';
    }
    if (!preview) {
      // Recusado, inelegível ou falha de rede: a sacola volta EXATAMENTE ao que
      // era. Antes o `return` seco deixava `selectedCoupon` apontando para um
      // cupom que o backend não aceitou — a tela não mostrava desconto nenhum,
      // mas o coupon_id seguia indo no pedido.
      shell.restoreSelectedCoupon(previousCoupon);
      return;
    }
    closeCouponDetail();
    shell.showCouponNotice(`Cupom aplicado. Desconto de ${fmt(shell.couponDiscountAmount())}.`);
  }

  function useCoupon(code) {
    openCouponDetail(code);
  }

  function mount(ctx) {
    if (!ctx?.kit || !ctx?.app || !ctx?.shell) throw new Error('coupon-detail-screen: mount(ctx) exige kit, app e shell');
    ({ $, esc, fmt } = ctx.kit);
    app = ctx.app;
    shell = ctx.shell;
    for (const nome of ['getCouponForDetail', 'armSelectedCoupon', 'restoreSelectedCoupon', 'persistCouponChoice', 'previewSelectedCoupon', 'couponDiscountAmount', 'couponImageUrl', 'readyCardImage', 'renderDetailImage', 'openLoginScreen', 'showCouponNotice', 'mobNavMenu']) {
      if (typeof shell[nome] !== 'function') throw new Error(`coupon-detail-screen: shell.${nome} ausente`);
    }
    window.RapidexActions.register({
      openCouponDetail,
      closeCouponDetail,
      confirmCouponDetail,
      useCoupon
    });
  }

  window.PedeAquiCouponDetailScreen = { mount };
})();
