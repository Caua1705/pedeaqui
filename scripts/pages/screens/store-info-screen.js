// ============================================================================
//  Tela de informações da loja: o modal (abas Horários/Endereço/Pagamento) e
//  a subtela de informações do Perfil (#profSubinfo). Contrato mount(ctx) —
//  skill §9.
//
//  Quem BUSCA o /info continua sendo o page (ensureRestaurantInfo: o dado é
//  compartilhado com rodapé, checkout e Ajuda). Quando o estado muda, o page
//  anuncia pela ação 'renderStoreInfoState' e esta tela desenha o que é dela.
//  Os formatadores (dia da semana, períodos) vêm de
//  scripts/services/store-info-format.js — a MESMA fonte do rodapé, para as
//  superfícies nunca divergirem de novo (a semana já saiu deslocada em um dia
//  por ter dois formatadores).
// ============================================================================
(function () {
  let $, esc, act, initials, onlyDigits;
  let app, shell;
  const F = () => window.PedeAquiStoreInfoFormat;

  // Cópia local do helper do page (retorna null no vazio — os `||` daqui
  // dependem disso).
  function nonEmptyString(value) {
    const normalized = String(value ?? '').trim();
    return normalized || null;
  }

  function setStoreInfoTab(tab = 'hours') {
    const order = { hours: 0, address: 1, payment: 2 };
    const modal = $('infoModal');
    const tabs = document.querySelector('#infoModal .store-info-tabs');
    if (modal) modal.dataset.storeInfoTab = tab;
    if (tabs) tabs.style.setProperty('--store-tab-index', order[tab] ?? 0);
    document.querySelectorAll('[data-store-tab]').forEach(button => {
      button.classList.toggle('active', button.dataset.storeTab === tab);
    });
    const map = {
      hours: document.querySelector('.store-hours-card'),
      address: document.querySelector('.store-address-card'),
      payment: $('storeInfoPayment')
    };
    Object.entries(map).forEach(([key, element]) => {
      if (element) element.style.display = key === tab ? '' : 'none';
    });
  }

  function initStoreInfoModal() {
    const header = document.querySelector('#infoModal .store-info-header');
    const close = document.querySelector('#infoModal .store-info-close');
    const title = document.querySelector('#infoModal .store-info-header h2');
    const tabs = document.querySelector('#infoModal .store-info-tabs');
    const addressCard = document.querySelector('#infoModal .store-address-card');
    const hoursCard = document.querySelector('#infoModal .store-hours-card');
    if (close) {
      close.setAttribute('aria-label', 'Voltar');
      close.innerHTML = '<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 12H5"/><path d="m12 19-7-7 7-7"/></svg>';
    }
    if (title) title.textContent = 'Informações';
    if (header && close && title) {
      const spacer = header.querySelector('.store-info-spacer');
      header.insertBefore(close, header.firstElementChild);
      if (spacer) header.appendChild(spacer);
    }
    if (header) header.classList.add('store-info-header--reference');
    if (tabs) {
      tabs.innerHTML = [
        `<button class="active" type="button" data-store-tab="hours" ${act('click', 'setStoreInfoTab', 'hours')}>Horários</button>`,
        `<button type="button" data-store-tab="address" ${act('click', 'setStoreInfoTab', 'address')}>Endereço</button>`,
        `<button type="button" data-store-tab="payment" ${act('click', 'setStoreInfoTab', 'payment')}>Pagamento</button>`
      ].join('');
    }
    if (hoursCard) {
      hoursCard.innerHTML = '<div class="store-info-load-state">Carregando informações...</div>';
    }
    if (addressCard && !$('storeInfoPayment')) {
      addressCard.insertAdjacentHTML('afterend', '<section class="store-payment-card" id="storeInfoPayment"><h3>Pagamento</h3><p>Formas de pagamento não informadas</p></section>');
    }
    setStoreInfoTab('hours');
  }

  function renderInfoPaymentEntries(entries) {
    return entries.map(entry => {
      const label = shell.infoPaymentLabel(entry);
      return `<span><i class='pay-brand ${shell.infoBrandClass(label)}'></i>${esc(label)}</span>`;
    }).join('');
  }

  function renderRestaurantInfoPayment(data) {
    const box = $('storeInfoPayment');
    if (!box) return;
    const groups = shell.infoPaymentData(data);
    const sections = [];
    if (groups.online.length) {
      sections.push(`<p class='store-payment-title'>Pagamento online</p><div class='store-payment-grid'>${renderInfoPaymentEntries(groups.online)}</div>`);
    }
    const deliveryGroups = ['credit', 'debit', 'cash', 'pix', 'voucher']
      .map(type => [type, groups.delivery.filter(entry => entry.method_type === type)])
      .filter(([, entries]) => entries.length);
    if (deliveryGroups.length) {
      sections.push(`<p class='store-payment-title'>Pagamento na entrega</p>`);
      deliveryGroups.forEach(([type, entries]) => {
        const label = ({ credit: 'Crédito', debit: 'Débito', cash: 'Dinheiro', pix: 'PIX na entrega', voucher: 'Vale-refeição / alimentação' })[type];
        sections.push(`<p class='store-payment-group${type === 'debit' ? ' store-payment-group--debit' : ''}'>${label}</p><div class='store-payment-grid'>${renderInfoPaymentEntries(entries)}</div>`);
      });
    }
    box.innerHTML = sections.length ? sections.join('') : '<p>Formas de pagamento não informadas.</p>';
  }

  function renderInfoLogo(url, name) {
    const container = $('infoStoreLogo');
    if (!container) return;
    container.replaceChildren();
    if (!url) {
      const fallbackElement = document.createElement('div');
      fallbackElement.className = 'mob-logo-fallback';
      fallbackElement.textContent = initials(name);
      container.appendChild(fallbackElement);
      return;
    }
    const image = document.createElement('img');
    image.src = url;
    image.alt = name || 'Restaurante';
    image.addEventListener('error', () => {
      const fallbackElement = document.createElement('div');
      fallbackElement.className = 'mob-logo-fallback';
      fallbackElement.textContent = initials(name);
      container.replaceChildren(fallbackElement);
    }, { once: true });
    container.appendChild(image);
  }

  function infoFullAddress(branch = {}) {
    if (nonEmptyString(branch.full_address)) return branch.full_address;
    const address = branch.address && typeof branch.address === 'object' ? branch.address : branch;
    if (nonEmptyString(address.full_address)) return address.full_address;
    if (typeof branch.address === 'string' && branch.address.trim()) return branch.address;
    return [
      [address.street || address.street_name, address.number].filter(Boolean).join(', '),
      address.neighborhood,
      address.city,
      address.state
    ].filter(Boolean).join(' - ');
  }

  function renderProfileRestaurantInfo(data) {
    const body = document.querySelector('#profSubinfo .prof-sub-body');
    if (!body) return;
    const branch = data?.branch || {};
    const hours = Array.isArray(data?.business_hours) ? data.business_hours : (Array.isArray(branch.business_hours) ? branch.business_hours : []);
    const methods = shell.infoPaymentData(data);
    const whatsapp = onlyDigits(branch.whatsapp || '');
    const paymentEntries = [...methods.online, ...methods.delivery];
    body.innerHTML = `
      <div class='prof-info-card'>
        <div class='prof-info-card-header'><span class='prof-info-card-title'>${esc(branch.display_name || branch.name || 'Unidade')}</span></div>
        <div class='prof-info-row'><div><div class='prof-info-row-label'>Endereço</div><div class='prof-info-row-val'>${esc(infoFullAddress(branch) || 'Endereço não informado')}</div></div></div>
        <div class='prof-info-row'><div><div class='prof-info-row-label'>Telefone</div><div class='prof-info-row-val'>${esc(branch.phone || 'Telefone não informado')}</div></div></div>
        <div class='prof-info-row'><div><div class='prof-info-row-label'>E-mail</div><div class='prof-info-row-val'>${esc(branch.email || 'E-mail não informado')}</div></div></div>
        <div class='prof-info-row'><div><div class='prof-info-row-label'>WhatsApp</div>${whatsapp ? `<a class='prof-info-row-link' href='https://wa.me/${whatsapp.startsWith('55') ? whatsapp : `55${whatsapp}`}' target='_blank' rel='noopener'>${esc(branch.whatsapp)}</a>` : `<div class='prof-info-row-val'>WhatsApp não informado</div>`}</div></div>
      </div>
      <div class='prof-info-card'>
        <div class='prof-info-card-header'><span class='prof-info-card-title'>Horário de funcionamento</span></div>
        ${hours.length ? hours.map(item => `<div class='prof-info-row'><div><div class='prof-info-row-label'>${esc(F().formatWeekday(item))}</div><div class='prof-info-row-val'>${esc(F().formatHoursLine(item))}</div></div></div>`).join('') : `<div class='prof-info-row-val'>Horários não informados.</div>`}
      </div>
      <div class='prof-info-card'>
        <div class='prof-info-card-header'><span class='prof-info-card-title'>Formas de pagamento</span></div>
        ${shell.profilePaymentChips(paymentEntries)}
      </div>`;
  }

  function renderStoreInfoData(data) {
    const apiRestaurant = data?.restaurant || {};
    const branch = data?.branch || {};
    const name = apiRestaurant.name || app.restaurant.name || 'Restaurante';
    renderInfoLogo(apiRestaurant.logo_url || apiRestaurant.logo_path || app.restaurant.logo_url || app.restaurant.logo_path, name);
    document.querySelectorAll('#infoModal .store-info-name').forEach(element => { element.textContent = name; });
    document.querySelectorAll('#infoModal .store-info-neighborhood').forEach(element => { element.textContent = branch.display_name || branch.name || ''; });
    document.querySelectorAll('#infoModal .store-info-phone').forEach(element => { element.textContent = branch.phone || 'Telefone não informado'; });
    document.querySelectorAll('#infoModal .store-info-email').forEach(element => { element.textContent = branch.email || 'E-mail não informado'; });
    document.querySelectorAll('#infoModal .store-info-whatsapp').forEach(element => { element.textContent = branch.whatsapp || 'WhatsApp não informado'; });
    document.querySelectorAll('#infoModal .store-contact-row--wa').forEach(element => {
      const phone = onlyDigits(branch.whatsapp || '');
      if (phone) element.href = `https://wa.me/${phone.startsWith('55') ? phone : `55${phone}`}`;
      else element.removeAttribute('href');
    });
    const currentWeekday = Number(data?.current_weekday);
    const hours = Array.isArray(data?.business_hours) ? data.business_hours : [];
    const hoursCard = document.querySelector('#infoModal .store-hours-card');
    if (hoursCard) hoursCard.innerHTML = hours.length
      ? hours.map(item => `<div class='store-hours-row${Number(item.weekday) === currentWeekday ? ' active' : ''}'><span>${esc(F().formatWeekday(item))}</span><strong>${esc(F().formatHoursLine(item))}</strong></div>`).join('')
      : '<div class="store-info-load-state">Horários não informados.</div>';
    if ($('storeInfoAddress')) $('storeInfoAddress').textContent = infoFullAddress(branch) || 'Endereço não informado';
    renderRestaurantInfoPayment(data);
    renderProfileRestaurantInfo(data);
  }

  function renderStoreInfoLoading() {
    const hours = document.querySelector('#infoModal .store-hours-card');
    if (hours) hours.innerHTML = '<div class="store-info-load-state">Carregando informações...</div>';
    if ($('storeInfoAddress')) $('storeInfoAddress').textContent = 'Carregando endereço...';
    if ($('storeInfoPayment')) $('storeInfoPayment').innerHTML = '<div class="store-info-load-state">Carregando formas de pagamento...</div>';
  }

  function renderStoreInfoError() {
    const hours = document.querySelector('#infoModal .store-hours-card');
    if (hours) hours.innerHTML = '<div class="store-info-load-state">Não foi possível carregar as informações.</div>';
    if ($('storeInfoAddress')) $('storeInfoAddress').textContent = 'Endereço indisponível.';
    if ($('storeInfoPayment')) $('storeInfoPayment').innerHTML = '<div class="store-info-load-state">Não foi possível carregar as formas de pagamento.</div>';
    const profileInfo = document.querySelector('#profSubinfo .prof-sub-body');
    if (profileInfo) profileInfo.innerHTML = '<div class="prof-placeholder-card"><div class="prof-placeholder-text">Não foi possível carregar as informações do restaurante.</div></div>';
  }

  function openRestaurantInfo() {
    shell.openModal('infoModal');
    shell.ensureRestaurantInfo();
  }

  function renderStoreInfoState(state) {
    if (state?.status === 'success') return renderStoreInfoData(state.data);
    if (state?.status === 'error') return renderStoreInfoError();
    return renderStoreInfoLoading();
  }

  function mount(ctx) {
    if (!ctx?.kit || !ctx?.app || !ctx?.shell) throw new Error('store-info-screen: mount(ctx) exige kit, app e shell');
    ({ $, esc, act, initials, onlyDigits } = ctx.kit);
    app = ctx.app;
    shell = ctx.shell;
    for (const nome of ['infoPaymentData', 'infoPaymentLabel', 'infoBrandClass', 'profilePaymentChips', 'ensureRestaurantInfo', 'openModal']) {
      if (typeof shell[nome] !== 'function') throw new Error(`store-info-screen: shell.${nome} ausente`);
    }
    window.RapidexActions.register({
      setStoreInfoTab,
      initStoreInfoModal,
      openRestaurantInfo,
      renderStoreInfoState
    });
  }

  window.PedeAquiStoreInfoScreen = { mount };
})();
