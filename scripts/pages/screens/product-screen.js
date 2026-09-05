// ============================================================================
//  Modal de produto: abrir, grupos de opções (mínimo/máximo, troca vs
//  adicional), quantidade, observação e o botão Adicionar. Contrato
//  mount(ctx) — skill §9.
//
//  O estado da ESCOLHA (produto aberto, opções marcadas, quantidade, item em
//  edição) mora aqui. O que É da sacola — gravar o item — sai por UMA porta,
//  shell.addDraftToCart: esta tela não escreve `cart` nunca.
// ============================================================================
(function () {
  let $, esc, fmt, act, initials, showEl, fallback;
  let app, shell;

  let currentProd = null;
  let pmQty = 1;
  let pmSelectedOptions = {};
  let editingCartItemUid = null;
  let productScrollIndicatorReady = false;

  // ------------------------------------------------------------------------
  //  ENDEREÇO E CARTÃO DE COMPARTILHAMENTO DO PRODUTO
  //
  //  Até aqui o app tinha UMA url por loja: abrir um produto não mudava o
  //  endereço, e o cartão de compartilhamento continuava sendo a logo. Quem
  //  quisesse mandar um prato para alguém mandava a home.
  //
  //  Duas metades, e as duas são necessárias — uma sem a outra é pior que
  //  nenhuma. Só o cartão: a foto do prato abrindo a home. Só a url: um link
  //  que abre o prato e se anuncia com a logo.
  //
  //  O QUE ISTO NÃO ALCANÇA, e está escrito também em `tenant-identity.js`: o
  //  crawler do WhatsApp/Facebook/Telegram NÃO executa JavaScript, e este app é
  //  servido estático (`vercel.json` não tem função nenhuma). O cartão escrito
  //  aqui chega a quem EXECUTA — o navegador embutido do Instagram e do
  //  WhatsApp ao ABRIR o link, o Web Share da aba, extensões. O preview do
  //  crawler exige render no servidor, e isso é outra frente.
  //
  //  A URL, essa, funciona para todo mundo: `/{slug}/produto/{id}` é rewrite
  //  na Vercel e o boot a lê.
  // ------------------------------------------------------------------------

  /** A url pública deste produto, ou '' quando não dá para montá-la. */
  function productUrl(product) {
    const slug = String(window.RapidexTenant?.resolveSlug?.() || '').trim();
    const id = String(product?.id || '').trim();
    if (!slug || !id) return '';
    return `${window.location.origin}/${encodeURIComponent(slug)}/produto/${encodeURIComponent(id)}`;
  }

  /**
   * Troca o endereço da barra SEM navegar, e escreve o cartão do produto.
   *
   * `replaceState` e não `pushState`: o "voltar" do aparelho tem de sair da
   * loja, não desempilhar um modal. Um `pushState` por produto aberto encheria
   * o histórico de estados que a tela nem sabe restaurar.
   */
  function marcarProdutoNaUrl(product) {
    const url = productUrl(product);
    if (!url) return;
    try { window.history.replaceState(window.history.state, '', url); } catch { /* about:blank, iframe sem permissão */ }
    window.RapidexTenantIdentity?.applyProductMeta?.({
      name: product?.name,
      description: product?.description,
      price: product?.price,
      imageUrl: product?.image_url || product?.image_path,
      url,
      storeName: app.restaurant?.name
    });
  }

  /** Devolve a url e o cartão da LOJA. Chamado ao fechar o modal. */
  function desmarcarProdutoDaUrl() {
    const slug = String(window.RapidexTenant?.resolveSlug?.() || '').trim();
    if (slug) {
      try { window.history.replaceState(window.history.state, '', `${window.location.origin}/${encodeURIComponent(slug)}`); } catch { /* idem */ }
    }
    window.RapidexTenantIdentity?.restoreTenantMeta?.();
  }

  /**
   * O fechar DESTA tela. Ele existe porque o modal precisa desfazer duas coisas
   * que só ele fez — a url e o cartão —, e o `closeModal` genérico do app não
   * pode saber disso.
   *
   * O `event` é opcional e reproduz a guarda do genérico: clique no fundo só
   * fecha quando o alvo É o overlay, senão qualquer toque dentro do painel
   * fecharia a tela.
   */
  function closeProductScreen(event) {
    if (event && event.target && event.target.id !== 'productModal') return;
    desmarcarProdutoDaUrl();
    shell.closeModalId('productModal');
  }

  const productOptionGroups = (product) => Array.isArray(product?.option_groups) ? product.option_groups : [];
  const optionGroupSelections = (group) => pmSelectedOptions[String(group.id)] || [];
  const optionAdditionalPrice = (option) => Number(option?.additional_price || 0);

  function openProduct(id, source) {
    currentProd = app.products.find(p => String(p.id) === String(id));
    // Id que não está no cardápio DESTA filial. O caminho que traz isso é um
    // cartão do assistente montado sobre outra loja; o toque não podia
    // simplesmente não fazer nada — falha muda é o que fez esse defeito
    // demorar a aparecer.
    if (!currentProd) {
      console.warn('[PedeAqui] Produto fora do cardápio carregado.', { id, branch_id: shell.menuBranchId() });
      window.RapidexAssistantChat?.toast?.('Esse item não está no cardápio desta unidade.');
      return;
    }
    editingCartItemUid = null;
    pmQty = 1;
    pmSelectedOptions = {};
    $('pmName').textContent = currentProd.name;
    $('pmDesc').textContent = currentProd.description || '';
    $('pmPrice').innerHTML = Number.isFinite(currentProd.price)
      ? `<span class="pm-price-value">${esc(fmt(currentProd.price))}</span>`
      : esc(fallback().productUnavailablePrice || '');
    $('pmObs').value = '';
    bindProductObservationCounter();
    updateProductObservationCount();
    const hero = $('pmHero');
    // O herói do modal é a única foto FLUIDA: 100% da largura do modal, que no
    // celular é a viewport inteira. Por isso `w` + sizes, e não descritores x.
    if (hero) {
      const image = currentProd.image_url || currentProd.image_path || '';
      const sourceCard = source?.closest?.('.product-card')
        || Array.from(document.querySelectorAll('.product-card')).find(card => String(card.dataset.productId) === String(id));
      const preview = shell.readyCardImage(sourceCard, '.product-card', '.product-image');
      if (image) {
        shell.renderDetailImage(hero, {
          url: image,
          alt: currentProd.name,
          className: 'pm-hero-photo',
          fluid: { widths: [360, 480, 640, 960, 1280], sizes: '(max-width: 560px) 100vw, 560px' },
          preview,
          fallbackMarkup: `<div class="pm-hero-photo product-image--placeholder"><span>${esc(initials(currentProd.name))}</span></div>`
        });
      } else {
        hero.innerHTML = shell.productImage(currentProd, 'pm-hero-photo');
      }
    }
    showEl($('pmWarning'), !Number.isFinite(currentProd.price));
    $('pmForm').style.display = Number.isFinite(currentProd.price) ? 'block' : 'none';
    $('pmFooter').style.display = Number.isFinite(currentProd.price) ? 'flex' : 'none';
    renderProductOptions();
    updatePmUI();
    marcarProdutoNaUrl(currentProd);
    shell.openModal('productModal');
    initProductScrollIndicator();
    const body = $('productModal')?.querySelector('.modal-body');
    if (body) body.scrollTop = 0;
    requestAnimationFrame(syncProductScrollIndicator);
  }

  function optionInstruction(group) {
    const min = Number(group.min_select || 0);
    const max = Math.max(1, Number(group.max_select || 1));
    if (max === 1) return min > 0 ? 'Selecione 1' : 'Selecione at\u00e9 1';
    if (min > 0 && min !== max) return `Selecione de ${min} a ${max}`;
    if (min > 0 && min === max) return `Selecione ${max}`;
    return `Selecione at\u00e9 ${max}`;
  }

  function renderProductOptions() {
    const target = $('pmOptionGroups');
    if (!target) return;
    const groups = productOptionGroups(currentProd);
    target.innerHTML = groups.map(group => renderProductOptionGroup(group)).join('');
    requestAnimationFrame(syncProductScrollIndicator);
  }

  function initProductScrollIndicator() {
    if (productScrollIndicatorReady) return;
    const body = $('productModal')?.querySelector('.modal-body');
    if (!body) return;
    productScrollIndicatorReady = true;
    body.addEventListener('scroll', syncProductScrollIndicator, { passive: true, signal: window.RapidexLifecycle?.signal });
    window.addEventListener('resize', syncProductScrollIndicator, { signal: window.RapidexLifecycle?.signal });
  }

  function syncProductScrollIndicator() {
    const modal = $('productModal')?.querySelector('.modal--product');
    const body = $('productModal')?.querySelector('.modal-body');
    if (!modal || !body) return;
    const scrollable = body.scrollHeight - body.clientHeight;
    const hasOverflow = scrollable > 1;
    modal.classList.toggle('has-product-scroll', hasOverflow);
    modal.classList.toggle('product-no-scroll', !hasOverflow);
    body.style.overflowY = hasOverflow ? 'auto' : 'hidden';
    if (!hasOverflow) body.scrollTop = 0;
  }

  function renderProductOptionGroup(group) {
    const groupId = String(group.id);
    const selections = optionGroupSelections(group);
    const max = Math.max(1, Number(group.max_select || 1));
    const isSingle = max === 1;
    const options = Array.isArray(group.options) ? group.options : [];
    return `
      <section class="pm-option-group" data-option-group-id="${esc(groupId)}">
        <div class="pm-option-head">
          <div class="pm-option-title">${esc(group.name)}</div>
          <div class="pm-option-meta">
            <span>${esc(optionInstruction(group))}</span>
            <span>${selections.length} selec</span>
          </div>
        </div>
        <div class="pm-option-list">
          ${options.map(option => renderProductOption(group, option, isSingle, selections)).join('')}
        </div>
      </section>
    `;
  }

  function renderProductOption(group, option, isSingle, selections) {
    const groupId = String(group.id);
    const optionId = String(option.id);
    const selected = selections.includes(optionId);
    const price = optionAdditionalPrice(option);
    return `
      <button class="pm-option-row ${selected ? 'selected' : ''}" type="button" ${act('click', 'toggleProductOption', groupId, optionId)}>
        <span class="pm-option-copy">
          <span class="pm-option-name">${esc(option.name)}</span>
          ${option.description ? `<span class="pm-option-desc">${esc(option.description)}</span>` : ''}
          ${price > 0 ? `<span class="pm-option-price">${fmt(price)}</span>` : ''}
        </span>
        <span class="${isSingle ? 'pm-option-radio' : 'pm-option-toggle'}" aria-hidden="true">${isSingle ? '' : (selected ? '-' : '+')}</span>
      </button>
    `;
  }

  function toggleProductOption(groupId, optionId) {
    const group = productOptionGroups(currentProd).find(item => String(item.id) === String(groupId));
    if (!group) return;
    const max = Math.max(1, Number(group.max_select || 1));
    const current = [...(pmSelectedOptions[groupId] || [])];
    if (max === 1) {
      pmSelectedOptions[groupId] = current[0] === optionId ? [] : [optionId];
    } else if (current.includes(optionId)) {
      pmSelectedOptions[groupId] = current.filter(id => id !== optionId);
    } else if (current.length < max) {
      pmSelectedOptions[groupId] = [...current, optionId];
    }
    renderProductOptions();
    updatePmUI();
  }

  function productOptionsValid() {
    return productOptionGroups(currentProd).every(group => {
      const selected = optionGroupSelections(group).length;
      const min = Number(group.min_select || 0);
      const max = Math.max(1, Number(group.max_select || 1));
      const required = group.is_required === true || min > 0;
      if (!required && selected === 0) return true;
      return selected >= min && selected <= max;
    });
  }

  function selectedOptionsSnapshot() {
    return productOptionGroups(currentProd).flatMap(group => {
      const options = Array.isArray(group.options) ? group.options : [];
      return optionGroupSelections(group).map(optionId => {
        const option = options.find(item => String(item.id) === String(optionId));
        if (!option) return null;
        return {
          group_name: group.name || '',
          option_name: option.name || '',
          additional_price: optionAdditionalPrice(option)
        };
      }).filter(Boolean);
    });
  }

  function selectedOptionsPayload() {
    return productOptionGroups(currentProd).flatMap(group => optionGroupSelections(group).map(optionId => ({
      option_group_id: String(group.id),
      option_id: String(optionId)
    })));
  }

  function productVisualUnitPrice() {
    if (!currentProd || !Number.isFinite(currentProd.price)) return 0;
    return Number(currentProd.price) + selectedOptionsSnapshot().reduce((sum, option) => sum + Number(option.additional_price || 0), 0);
  }

  function restoreSelectedOptions(item) {
    pmSelectedOptions = {};
    (item.selected_options || []).forEach(selection => {
      const groupId = String(selection.option_group_id || '');
      const optionId = String(selection.option_id || '');
      if (!groupId || !optionId) return;
      pmSelectedOptions[groupId] = [...(pmSelectedOptions[groupId] || []), optionId];
    });
    renderProductOptions();
  }

  function changeQty(delta) {
    pmQty = Math.max(1, pmQty + delta);
    updatePmUI();
  }

  function bindProductObservationCounter() {
    const obs = $('pmObs');
    if (!obs || obs.dataset.counterReady === 'true') return;
    obs.dataset.counterReady = 'true';
    obs.addEventListener('input', updateProductObservationCount);
  }

  function updateProductObservationCount() {
    const obs = $('pmObs');
    const count = $('pmObsCount');
    if (!obs || !count) return;
    if (obs.value.length > 128) obs.value = obs.value.slice(0, 128);
    count.textContent = `${obs.value.length}/128`;
  }

  function updatePmUI() {
    if ($('pmQty')) $('pmQty').textContent = pmQty;
    if ($('pmAddBtn') && currentProd) {
      $('pmAddBtn').textContent = `Adicionar (${fmt(productVisualUnitPrice() * pmQty)})`;
      $('pmAddBtn').disabled = !Number.isFinite(currentProd.price) || !productOptionsValid();
    }
  }

  function addToCart() {
    if (!currentProd || !Number.isFinite(currentProd.price) || !productOptionsValid()) return;
    // O rascunho leva tudo decidido; quem escreve na sacola é o page, pela
    // única porta (shell.addDraftToCart). unit_price aqui JÁ inclui os
    // adicionais — é o preço visual desta escolha.
    shell.addDraftToCart({
      product: currentProd,
      qty: pmQty,
      obs: $('pmObs').value.trim(),
      unitPrice: productVisualUnitPrice(),
      selected_options: selectedOptionsPayload(),
      selected_options_snapshot: selectedOptionsSnapshot(),
      editingUid: editingCartItemUid
    });
    editingCartItemUid = null;
  }

  function editCartItem(uid) {
    const item = app.cart.find(i => i.uid === uid);
    if (!item) return;
    openProduct(item.id);
    editingCartItemUid = uid;
    pmQty = item.qty;
    restoreSelectedOptions(item);
    $('pmObs').value = item.obs || '';
    updateProductObservationCount();
    updatePmUI();
  }

  function mount(ctx) {
    if (!ctx?.kit || !ctx?.app || !ctx?.shell) throw new Error('product-screen: mount(ctx) exige kit, app e shell');
    ({ $, esc, fmt, act, initials, showEl, fallback } = ctx.kit);
    app = ctx.app;
    shell = ctx.shell;
    for (const nome of ['addDraftToCart', 'productImage', 'readyCardImage', 'renderDetailImage', 'openModal', 'closeModalId', 'menuBranchId']) {
      if (typeof shell[nome] !== 'function') throw new Error(`product-screen: shell.${nome} ausente`);
    }
    window.RapidexActions.register({
      openProduct,
      closeProductScreen,
      toggleProductOption,
      changeQty,
      addToCart,
      editCartItem
    });
  }

  window.PedeAquiProductScreen = { mount };
})();
