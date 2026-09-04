// ============================================================================
//  Folha de detalhe do cupom — ler regras, e SÓ confirmar aplica.
//
//  A separação que vale dinheiro continua a mesma da skill §4:
//  `couponDetailCoupon` (aberto para LEITURA) mora AQUI, dentro da tela;
//  `selectedCoupon` (APLICADO à sacola, vai no payload) mora no
//  restaurant-page, e a folha só o toca pelas três portas da shell
//  (armSelectedCoupon / restoreSelectedCoupon).
//  Fechar a leitura nunca desaplica o que já valia.
// ============================================================================
(function () {
  let $, esc, fmt;
  let app, shell;
  const UI = () => window.PedeAquiRestaurantUi;
  const CTA = () => window.PedeAquiCouponCta;

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

  /** "2026-09-30T23:59:59Z" -> "30/09/2026"; sem prazo (ou o sentinela) -> ''. */
  const couponValidUntil = (value) =>
    window.PedeAquiCouponFormat.couponDeadline(value, { withYear: true });

  function couponRules(coupon) {
    const rules = [];
    const minimum = couponAmount(coupon.min_order_value);
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
    // AS DUAS RESTRIÇÕES QUE O CUPOM PODE TER, quando o contrato as publica.
    //
    // Elas entram INDEPENDENTE do `state`, e isso é de propósito: um cupom
    // `applicable` que só vale no Pix continua só valendo no Pix, e a pessoa
    // precisa saber disso ANTES de aplicar — não só quando o backend recusa.
    // O `state` decide o BOTÃO; estas linhas são a regra do cupom.
    const restricao = window.PedeAquiCouponRestriction;
    const formas = restricao.couponPaymentPhrase(coupon);
    if (formas) rules.push(formas);
    const faixa = restricao.couponHoursPhrase(coupon);
    if (faixa) rules.push(faixa);
    if (minimum > 0) rules.push(`Em pedidos a partir de ${fmt(minimum)}`);
    // A data ia CRUA para a tela ("Válido até 2099-12-31T23:59:59Z"). Na
    // vitrine o campo não vinha, então ninguém tinha visto ainda.
    //
    // `expires_at` estava NA FRENTE de `valid_until` e não existe em cupom
    // nenhum do contrato (ele é de cashback e de pagamento): lia `undefined`
    // em 100% das chamadas, e no dia em que o backend publicasse esse nome
    // venceria o campo certo. Saiu.
    //
    // E `valid_until` DEIXOU de ser obrigatório em 02/09/2026: em
    // `CustomerCouponResponse` ele é `string | null` e saiu do `required` —
    // cupom sem prazo virou legal. A linha inteira sai quando não há data, que
    // é o mesmo princípio da sacola: parcela sem valor é linha FORA, nunca um
    // rótulo com o campo vazio atrás.
    //
    // E não há UMA forma de dizer "sem prazo": as linhas anteriores àquela data
    // dizem o mesmo com o sentinela que o banco NOT NULL obrigava — era o
    // "Válido até 31/12/2099" que aparecia nesta folha. Quem decide o que é
    // prazo é o formatador único (coupon-format.js).
    const validUntil = couponValidUntil(coupon.valid_until);
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
    // O BOTAO DIZ O QUE VAI ACONTECER. Ate 02/09/2026 ele era "Usar cupom"
    // escrito no restaurant.html, nos quatro casos — e o caso mais caro era o
    // da sacola vazia, em que "usar" guardava o cupom armado sem preview
    // nenhum. Agora o rotulo sai do MESMO decisor do card do Clube.
    aplicarRotuloDoBotao(coupon);
    if ($('couponDetailMin')) $('couponDetailMin').textContent = minText;
    aplicarRegras(coupon);
    $('couponDetailOverlay')?.classList.add('active');
    pedirVeredito(coupon);
  }

  function aplicarRegras(coupon) {
    const rules = $('couponDetailRules');
    if (rules) rules.innerHTML = couponRules(coupon).map(rule => `<li>${esc(rule)}</li>`).join('');
  }

  /**
   * QUEM DIZ É O BOTÃO — e para ele poder dizer, alguém precisa ter julgado.
   *
   * O cupom que chega da vitrine da Home é `PublicCouponResponse` e NÃO TEM
   * `state`: o backend nunca o julgou contra esta pessoa e esta sacola. Sem
   * `state` o botão dizia "Usar cupom" mesmo faltando R$ 28,90, e o cliente só
   * descobria depois do toque — por um toast que dizia o CONTRÁRIO do botão ao
   * lado dele. Duas frases opostas na mesma tela.
   *
   * Aqui a folha PERGUNTA. O front não passa a calcular elegibilidade: quem
   * julga continua sendo o servidor, na mesma rota que já decide os estados do
   * card do Clube (`GET /coupons` com a sacola). Ver `judgedCouponForDetail`.
   *
   * A TELA ABRE ANTES DA RESPOSTA, de propósito: a folha é instantânea hoje e
   * pagar uma ida à rede para abri-la seria trocar um defeito por outro. Ela
   * abre com o que se sabe e se corrige quando o veredito chega.
   *
   * A guarda de identidade não é zelo: entre o pedido e a resposta a pessoa
   * pode ter fechado a folha ou aberto OUTRO cupom, e repintar aí escreveria o
   * veredito de um cupom no botão de outro.
   */
  function pedirVeredito(coupon) {
    if (coupon.state) return;
    const aberto = coupon;
    Promise.resolve(shell.judgedCouponForDetail(coupon.code ?? coupon.id))
      .then(julgado => {
        if (!julgado || couponDetailCoupon !== aberto) return;
        // O julgado é a fonte do estado; o da vitrine continua sendo a fonte
        // da arte e do nome, que só ele tem. `title`/`name` são o MESMO campo
        // em dois esquemas (§12.1), então nenhum dos dois pode sumir.
        couponDetailCoupon = { ...aberto, ...julgado };
        aplicarRotuloDoBotao(couponDetailCoupon);
        aplicarRegras(couponDetailCoupon);
      })
      .catch(() => { /* sem veredito, o backend julga no preview */ });
  }

  /** O rotulo e o destino do CTA, do decisor unico (services/coupon-cta.js). */
  function ctaDoCupom(coupon) {
    return window.PedeAquiCouponCta.couponCta(coupon, {
      // `app.cart` e GETTER (skill §9, regra 3): ler aqui, na chamada, e nao
      // guardar — a sacola muda entre uma abertura da folha e a seguinte.
      sacolaVazia: !app.cart.length,
      fmt
    });
  }

  function aplicarRotuloDoBotao(coupon) {
    const botao = document.querySelector('.coupon-detail-use');
    if (!botao) return;
    const { acao, rotulo } = ctaDoCupom(coupon);
    botao.textContent = rotulo;
    botao.dataset.couponAcao = acao;
    // `SEM_DESTINO` é o único caso em que tocar não faz nada (fora do horário:
    // não há tela que adiante o relógio). `aria-disabled` e NÃO `disabled`: o
    // rótulo É a informação — "Vale das 15h às 18h" —, e `disabled` o tiraria
    // da leitura de tela e da ordem de foco justamente onde ele é o conteúdo.
    const inerte = acao === CTA().ACOES.SEM_DESTINO;
    botao.setAttribute('aria-disabled', inerte ? 'true' : 'false');
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
    const { acao } = ctaDoCupom(coupon);

    // FORA DO HORÁRIO: o botão diz a faixa e é só isso. Não existe tela que
    // adiante as 15h, e fechar a folha "para fazer alguma coisa" tiraria a
    // pessoa da regra que ela acabou de ler. Sai ANTES de qualquer outra
    // porta — inclusive antes do login, porque entrar na conta não muda a hora.
    if (acao === CTA().ACOES.SEM_DESTINO) return;

    // FORMA DE PAGAMENTO: este a pessoa resolve agora. A folha fecha e a
    // escolha de pagamento abre — o backend só marca este estado quando a
    // forma JÁ foi escolhida, então existe uma escolha para desfazer.
    //
    // A sacola vem junto, e não é detalhe: a tela de pagamento volta para ela
    // ao confirmar, e é na sacola que o cupom se aplica. Abrir só o pagamento
    // deixaria a pessoa num beco com o cupom fora de alcance.
    if (acao === CTA().ACOES.VER_PAGAMENTO) {
      closeCouponDetail();
      shell.openCartModal();
      shell.openPaymentMethodScreen();
      return;
    }

    // NAO SE VALIDA O QUE NAO PODE SER APLICADO: sem conta, o login vem
    // ANTES do preview.
    //
    // `requires_login` era do contrato antigo e sumiu junto com
    // /coupons/available. Como o campo deixou de existir, a comparação
    // `=== true` passou a ser sempre falsa: o cupom que exige conta seguia
    // direto para o preview, que respondia 401, e o cliente via "Não foi
    // possível aplicar este cupom" em vez da tela de login.
    //
    // O RAMO `ENTRAR` SOZINHO NAO BASTA, e este era o defeito de 03/09/2026.
    // Ele só cobre `state: 'login_required'`, que é um veredito do backend
    // sobre um cupom da LISTA. O cupom aberto pela vitrine da Home é
    // `PublicCouponResponse` e não tem `state` nenhum, então ele caía em
    // APLICAR mesmo para um visitante: o botão virava "Validando...", o
    // `POST /coupons/preview` saía, o backend respondia 401 (a rota exige
    // Bearer) e só então a tela de login abria. O cliente via um "Validando..."
    // de meio segundo antes de uma tela que não tem nada a ver com validação.
    //
    // `previewSelectedCoupon()` continua abrindo o login no 401 — ela é a rede
    // de baixo, para a sessão que expira ENTRE o toque e a resposta. O que
    // muda aqui é não gastar uma ida à rede para descobrir o que a sessão já
    // dizia antes do toque.
    //
    // E A PERGUNTA É `hasAuthSession()`, NÃO `app.isLogged()`. Medido numa
    // sonda: `isLogged()` é `Boolean(customer || ...)` e responde TRUE para
    // quem só digitou nome e telefone no checkout — isso grava um perfil em
    // localStorage sem token nenhum, e é o caso mais comum do defeito. Quem faz
    // o preview responder 401 é a ausência do Bearer, e só ela.
    if (!shell.hasAuthSession() && (acao === CTA().ACOES.ENTRAR || acao === CTA().ACOES.APLICAR)) {
      shell.openLoginScreen('coupon');
      return;
    }

    // NADA SE APLICA FORA DO CHECKOUT — nem o cupom que "caberia".
    //
    // São dois caminhos que davam no mesmo lugar errado. O do
    // `missing_amount` só avisava, e a pessoa ficava na folha sem o que fazer.
    // O da SACOLA VAZIA era pior: ele ARMAVA o cupom
    // (`armSelectedCoupon` + `persistCouponChoice`) e dizia "Cupom
    // selecionado. Adicione produtos à sacola para usar" — um cupom aplicado
    // sem preview nenhum, que seguia no `coupon_id` do pedido e que, sendo de
    // uso único, o backend queima na primeira tentativa.
    //
    // Agora os dois levam ao cardápio, que é a ação que de fato destrava, e
    // NENHUM dos dois toca em `selectedCoupon`.
    // QUEM DIZ É O BOTÃO, E SÓ ELE. O toast que existia aqui — "Faltam R$ X na
    // sacola para usar este cupom" — era a segunda voz da mesma tela, e ela
    // aparecia ao lado de um botão que (antes do veredito) dizia "Usar cupom".
    // Duas frases opostas no mesmo instante. Com o botão já dizendo "Faltam
    // R$ X", o toast só repete o que a pessoa acabou de ler e tocar.
    if (acao === CTA().ACOES.VER_CARDAPIO) {
      closeCouponDetail();
      await shell.mobNavMenu();
      return;
    }

    const previousCoupon = shell.armSelectedCoupon(coupon);

    const button = document.querySelector('.coupon-detail-use');
    if (button) {
      button.disabled = true;
      button.textContent = 'Validando...';
    }
    const preview = await shell.previewSelectedCoupon();
    if (button) {
      button.disabled = false;
      button.textContent = ctaDoCupom(coupon).rotulo;
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
    // O preview já atualizou a sacola. Volta direto para ela, sem uma camada de
    // sucesso intermediária e sem reconstruir carrinho/operação/restaurante.
    shell.openCartModal();
  }

  function useCoupon(code) {
    openCouponDetail(code);
  }

  function mount(ctx) {
    if (!ctx?.kit || !ctx?.app || !ctx?.shell) throw new Error('coupon-detail-screen: mount(ctx) exige kit, app e shell');
    ({ $, esc, fmt } = ctx.kit);
    app = ctx.app;
    shell = ctx.shell;
    for (const nome of ['getCouponForDetail', 'judgedCouponForDetail', 'armSelectedCoupon', 'restoreSelectedCoupon', 'previewSelectedCoupon', 'couponImageUrl', 'readyCardImage', 'renderDetailImage', 'openLoginScreen', 'hasAuthSession', 'mobNavMenu', 'openCartModal', 'openPaymentMethodScreen']) {
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
