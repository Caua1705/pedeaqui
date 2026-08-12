(function () {
  const $ = (id) => window.PedeAquiDom?.byId?.(id) || document.getElementById(id);

  let savedScrollY = 0;
  let bodyScrollLocked = false;
  let softScrollLocked = false;
  let correctingSoftScroll = false;
  let categoryTransitionClone = null;

  function currentScrollY() {
    return window.pageYOffset
      || document.documentElement.scrollTop
      || document.body.scrollTop
      || 0;
  }

  function keepSoftScrollStable() {
    if (!softScrollLocked || correctingSoftScroll) return;
    const actualY = window.pageYOffset || document.documentElement.scrollTop || document.body.scrollTop || 0;
    if (Math.abs(actualY - savedScrollY) < 1) return;
    correctingSoftScroll = true;
    window.scrollTo({ top: savedScrollY, left: 0, behavior: 'instant' });
    requestAnimationFrame(() => { correctingSoftScroll = false; });
  }

  window.addEventListener('scroll', keepSoftScrollStable, {
    passive: true,
    signal: window.RapidexLifecycle?.signal
  });

  function showCategoryTransitionClone() {
    if (categoryTransitionClone || !document.body.classList.contains('menu-tab')) return;
    const source = document.querySelector('.cats');
    if (!source) return;
    const rect = source.getBoundingClientRect();
    if (!rect.width || !rect.height) return;

    const clone = source.cloneNode(true);
    clone.removeAttribute('id');
    clone.querySelectorAll('[id]').forEach(element => element.removeAttribute('id'));
    clone.setAttribute('aria-hidden', 'true');
    clone.style.setProperty('position', 'fixed', 'important');
    clone.style.setProperty('top', `${rect.top}px`, 'important');
    clone.style.setProperty('left', `${rect.left}px`, 'important');
    clone.style.setProperty('width', `${rect.width}px`, 'important');
    clone.style.setProperty('max-width', `${rect.width}px`, 'important');
    clone.style.setProperty('height', `${rect.height}px`, 'important');
    clone.style.setProperty('margin', '0', 'important');
    clone.style.setProperty('transform', 'none', 'important');
    clone.style.setProperty('visibility', 'visible', 'important');
    clone.style.setProperty('opacity', '1', 'important');
    clone.style.setProperty('pointer-events', 'none', 'important');
    clone.style.setProperty('z-index', '39', 'important');

    categoryTransitionClone = {
      clone,
      source,
      visibility: source.style.getPropertyValue('visibility'),
      visibilityPriority: source.style.getPropertyPriority('visibility')
    };
    source.style.setProperty('visibility', 'hidden', 'important');
    document.body.appendChild(clone);
    clone.scrollLeft = source.scrollLeft;
  }

  function hideCategoryTransitionClone() {
    if (!categoryTransitionClone) return;
    const { clone, source, visibility, visibilityPriority } = categoryTransitionClone;
    clone.remove();
    if (visibility) source.style.setProperty('visibility', visibility, visibilityPriority);
    else source.style.removeProperty('visibility');
    categoryTransitionClone = null;
  }

  function hasBlockingUiOpen() {
    return Boolean(document.querySelector(
      '.overlay.active,.mob-view.active,.lgn-screen.active,.reg-screen.active,.policy-screen.active,.vfy-screen.active,.coupon-detail-overlay.active,.vfy-alert-overlay.active'
    ));
  }

  function lockBodyScroll(scrollY = currentScrollY(), mode = 'fixed') {
    if (mode === 'soft' || mode === 'product-soft') {
      if (bodyScrollLocked) {
        document.body.classList.add(mode === 'product-soft' ? 'product-modal-open' : 'modal-open');
        return;
      }
      savedScrollY = scrollY;
      softScrollLocked = true;
      showCategoryTransitionClone();
      document.body.classList.add('soft-scroll-locked');
      document.body.classList.add(mode === 'product-soft' ? 'product-modal-open' : 'modal-open');
      return;
    }
    if (bodyScrollLocked) {
      document.body.classList.add('modal-open');
      return;
    }
    bodyScrollLocked = true;
    savedScrollY = scrollY;
    document.body.style.position = 'fixed';
    document.body.style.top = `-${savedScrollY}px`;
    document.body.style.left = '0';
    document.body.style.right = '0';
    document.body.style.width = '100%';
    document.body.style.overflowY = 'scroll';
    document.body.classList.add('modal-open');
  }

  function unlockBodyScroll(restoreY = savedScrollY) {
    if (softScrollLocked && !bodyScrollLocked) {
      softScrollLocked = false;
      savedScrollY = restoreY;
      document.body.classList.remove('modal-open', 'product-modal-open', 'soft-scroll-locked');
      window.scrollTo({ top: restoreY, left: 0, behavior: 'auto' });
      hideCategoryTransitionClone();
      return;
    }
    if (!bodyScrollLocked) {
      document.body.classList.remove('modal-open', 'product-modal-open', 'soft-scroll-locked');
      hideCategoryTransitionClone();
      return;
    }
    bodyScrollLocked = false;
    savedScrollY = restoreY;
    document.body.style.position = '';
    document.body.style.top = '';
    document.body.style.left = '';
    document.body.style.right = '';
    document.body.style.width = '';
    document.body.style.overflowY = '';
    document.body.classList.remove('modal-open');
    window.scrollTo({ top: restoreY, left: 0, behavior: 'auto' });
    requestAnimationFrame(() => {
      if (!hasBlockingUiOpen()) window.scrollTo({ top: restoreY, left: 0, behavior: 'auto' });
    });
  }

  function unlockBodyScrollIfClear() {
    if (!hasBlockingUiOpen()) unlockBodyScroll();
    else document.body.classList.add('modal-open');
  }

  const KEEP_NAV_OVERLAYS = new Set([
    'productModal',
    'operationModal',
    'loginModal',
    'couponDetailOverlay'
  ]);

  function syncBottomNavVisibility() {
    const keep = Array.from(KEEP_NAV_OVERLAYS).some(id => $(id)?.classList.contains('active'));
    document.body.classList.toggle('keep-bottom-nav', keep);
  }

  /**
   * Telas que abrem POR CIMA da Home rolada travam o scroll no modo "soft".
   *
   * A trava "fixed" põe `position:fixed` no <body> com `top:-scrollY`. Isso zera
   * o scroll do documento, e `.home-sticky-header` — que é `position:sticky` —
   * perde o deslocamento que o mantinha grudado no topo: ele volta para a
   * posição de fluxo, que com o body deslocado cai FORA da tela. O efeito é o
   * header (widget de localização + "Entre ou cadastre-se") sumir no instante
   * do toque, antes mesmo de a tela nova entrar.
   *
   * A trava "soft" preserva o container de scroll original e o sticky continua
   * pinado. O #loginModal já vivia aqui pelo mesmo motivo — ver a regra
   * `body.home-tab.soft-scroll-locked.modal-open` em utilities.css.
   */
  const SOFT_LOCK_MODALS = new Set(['loginModal', 'operationModal']);

  function scrollLockMode(id) {
    if (id === 'productModal') return 'product-soft';
    return SOFT_LOCK_MODALS.has(id) ? 'soft' : 'fixed';
  }

  function openModal(id) {
    const el = $(id);
    if (!el) return;
    const scrollY = currentScrollY();
    el.classList.add('active');
    syncBottomNavVisibility();
    lockBodyScroll(scrollY, scrollLockMode(id));
  }

  function openModalImmediately(id) {
    const el = $(id);
    if (!el) return;
    const scrollY = currentScrollY();
    el.classList.add('no-motion');
    el.classList.add('active');
    syncBottomNavVisibility();
    lockBodyScroll(scrollY, scrollLockMode(id));
    setTimeout(() => el.classList.remove('no-motion'), 50);
  }

  function stopModalMomentum(el) {
    const scrollers = [el?.querySelector('.modal--product'), el?.querySelector('.modal-body')].filter(Boolean);
    scrollers.forEach(scroller => {
      const top = scroller.scrollTop;
      scroller.style.scrollBehavior = 'auto';
      scroller.style.webkitOverflowScrolling = 'auto';
      scroller.scrollTop = top;
      scroller.style.overflowY = 'hidden';
      setTimeout(() => {
        scroller.style.scrollBehavior = '';
        scroller.style.webkitOverflowScrolling = '';
        scroller.style.overflowY = '';
      }, 620);
    });
  }

  function closeModalId(id) {
    const el = $(id);
    if (!el) return;
    if (id === 'productModal' && (bodyScrollLocked || softScrollLocked)) {
      const restoreY = savedScrollY;
      stopModalMomentum(el);
      el.classList.remove('active');
      syncBottomNavVisibility();
      setTimeout(() => {
        if (!hasBlockingUiOpen()) unlockBodyScroll(restoreY);
      }, 560);
      return;
    }
    if (id === 'loginModal' && (bodyScrollLocked || softScrollLocked)) {
      const restoreY = savedScrollY;
      el.classList.remove('active');
      syncBottomNavVisibility();
      setTimeout(() => {
        if (!hasBlockingUiOpen()) unlockBodyScroll(restoreY);
      }, 560);
      return;
    }
    el.classList.remove('active');
    syncBottomNavVisibility();
    unlockBodyScrollIfClear();
  }

  function closeModalImmediately(id) {
    const el = $(id);
    if (!el) return;
    el.classList.add('no-motion');
    const panel = el.querySelector('.modal--fs,.modal--login,.modal--product,.modal--cart');
    el.style.transition = 'none';
    if (panel) panel.style.transition = 'none';
    el.classList.remove('active');
    setTimeout(() => {
      el.style.transition = '';
      if (panel) panel.style.transition = '';
      el.classList.remove('no-motion');
    }, 50);
    syncBottomNavVisibility();
    unlockBodyScrollIfClear();
  }

  function closeModal(event, id) {
    if (event.target && event.target.id === id) closeModalId(id);
  }

  window.PedeAquiRestaurantUi = {
    currentScrollY,
    hasBlockingUiOpen,
    lockBodyScroll,
    unlockBodyScroll,
    unlockBodyScrollIfClear,
    syncBottomNavVisibility,
    openModal,
    openModalImmediately,
    closeModalId,
    closeModalImmediately,
    closeModal
  };
})();
