(function () {
  const $ = (id) => window.PedeAquiDom?.byId?.(id) || document.getElementById(id);

  let savedScrollY = 0;
  let bodyScrollLocked = false;
  let softScrollLocked = false;

  function currentScrollY() {
    return window.pageYOffset
      || document.documentElement.scrollTop
      || document.body.scrollTop
      || 0;
  }

  function hasBlockingUiOpen() {
    return Boolean(document.querySelector(
      '.overlay.active,.mob-view.active,.lgn-screen.active,.reg-screen.active,.policy-screen.active,.vfy-screen.active,.coupon-detail-overlay.active,.vfy-alert-overlay.active'
    ));
  }

  function lockBodyScroll(scrollY = currentScrollY(), mode = 'fixed') {
    if (mode === 'soft') {
      if (bodyScrollLocked) {
        document.body.classList.add('modal-open');
        return;
      }
      savedScrollY = scrollY;
      softScrollLocked = true;
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
      window.scrollTo({ top: restoreY, left: 0, behavior: 'auto' });
      requestAnimationFrame(() => {
        if (!hasBlockingUiOpen()) window.scrollTo({ top: restoreY, left: 0, behavior: 'auto' });
      });
      return;
    }
    if (!bodyScrollLocked) {
      document.body.classList.remove('modal-open');
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

  function openModal(id) {
    const el = $(id);
    if (!el) return;
    const scrollY = currentScrollY();
    el.classList.add('active');
    syncBottomNavVisibility();
    lockBodyScroll(scrollY, ['loginModal', 'productModal'].includes(id) ? 'soft' : 'fixed');
  }

  function openModalImmediately(id) {
    const el = $(id);
    if (!el) return;
    const scrollY = currentScrollY();
    el.classList.add('no-motion');
    el.classList.add('active');
    syncBottomNavVisibility();
    lockBodyScroll(scrollY, ['loginModal', 'productModal'].includes(id) ? 'soft' : 'fixed');
    setTimeout(() => el.classList.remove('no-motion'), 50);
  }

  function closeModalId(id) {
    const el = $(id);
    if (!el) return;
    if (['loginModal', 'productModal'].includes(id) && (bodyScrollLocked || softScrollLocked)) {
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
