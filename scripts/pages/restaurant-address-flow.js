// ============================================================================
//  Endereço: escolha, lista salva, busca no Google, mapa e formulário.
//
//  Saiu de scripts/pages/restaurant-page.js na auditoria de 29/08/2026 — 1.124
//  linhas, 98 funções. Foi o PRIMEIRO corte daquele arquivo por ter a maior
//  razão entre tamanho e superfície: só 4 nomes daqui são alcançados de lá.
//  E porque é o pedaço mais estrangeiro ao resto — fala com o Google Maps, não
//  com dinheiro. Se um corte fosse dar errado, era melhor errar longe do
//  pedido.
//
//  O CÓDIGO NÃO FOI REESCRITO. Os corpos das funções vieram verbatim; o que
//  mudou foi só a costura descrita abaixo. Mudança de comportamento é outro
//  commit — e não há nenhuma neste.
//
//  --- A costura, e por que ela tem duas metades ---
//
//  Isto era tudo um fechamento só. Ao sair dele, o bloco perdeu acesso a 30
//  nomes, e eles NÃO são todos da mesma natureza:
//
//  1. VINTE E SEIS SÃO ESTÁVEIS (declarações de função, e consts que nunca são
//     reatribuídas). Vêm por valor, em init(), e os corpos que os usam não
//     mudaram uma letra.
//
//  2. QUATRO MUDAM DE VALOR, e o dono deles continua sendo o restaurant-page:
//     operationContext, opDraft, operationConfirmed e customerAddress são
//     reatribuídos lá 4, 1, 2 e 3 vezes. Passá-los por valor daria a este
//     módulo uma FOTOGRAFIA do que valiam no instante do init() — e a partir
//     da primeira troca de filial ou do primeiro endereço salvo, este arquivo
//     estaria decidindo com dados velhos, calado. Por isso vêm como getters,
//     lidos a cada acesso através de `S`. É a única mudança que tocou os
//     corpos: 16 identificadores ganharam o prefixo `S.`, e nada mais.
//
//     `S.opDraft.address = x` continua funcionando porque a escrita é na
//     PROPRIEDADE do objeto, não na variável — o getter devolve o mesmo objeto
//     que o restaurant-page tem na mão.
//
//  --- Como o markup chega aqui ---
//
//  Pelo registro de ações (scripts/utils/actions.js), que é compartilhado e
//  MESCLA: este módulo registra as 27 ações dele e o markup `data-act-*` não
//  mudou nenhuma letra. Nenhuma delas passa por window.
// ============================================================================
(function () {
  // Preenchidos por init(). Ficam `let` sem valor de propósito: se init() não
  // rodar, a primeira chamada estoura com "is not a function" em vez de fazer
  // a tela de endereço se comportar como se o cliente não tivesse nenhum.
  let $,
    act,
    addressApiPayload,
    addressFingerprint,
    addressSummary,
    appState,
    closeModalId,
    closeModalImmediately,
    dedupeAddresses,
    defaultBackendAddress,
    esc,
    isLogged,
    isRemoteAddress,
    normalizeAddressValue,
    openModal,
    openModalImmediately,
    readLocalAddressList,
    remoteAddressId,
    renderOperationScreen,
    renderProfileView,
    requestBranchAvailability,
    setAccessibleDialogState,
    setMobNavActive,
    setOperationEntryLoading,
    setSelectedOperationAddress,
    syncCartStickyForActiveView,
    synchronizeCustomerAddresses,
    writeLocalAddressList;

  /**
   * O estado que continua sendo do restaurant-page.js. Cada acesso a
   * `S.operationContext` chama o getter dele — nunca uma cópia.
   */
  const S = {};

  const ESTADO_OBRIGATORIO = ['operationContext', 'opDraft', 'operationConfirmed', 'customerAddress'];
  function openAddressScreen() {
    openAddressChoice();
  }

  function openAddressChoice() {
    const hasSavedAddresses = Boolean(
      S.opDraft?.address
      || S.operationContext?.address
      || S.customerAddress
      || readLocalAddressList().length
      || appState.customerAddresses?.length
    );
    if (isLogged() || hasSavedAddresses) {
      openAddrPicker('operation');
      return;
    }
    openAddressChoiceDirect(true);
  }

  let _addAddressOrigin = 'operation';
  let _returnToAddAddressChoice = false;

  function openAddressChoiceDirect(withMotion = true) {
    _editingAddressId = null;
    const btn = $('adcConfirmBtn');
    if (btn) btn.disabled = true;
    _adcSelection = null;
    const fromPicker = $('addrPickerModal')?.classList.contains('active');
    _addAddressOrigin = fromPicker ? 'picker' : 'operation';
    const geo = $('adcBtnGeo');
    const manual = $('adcBtnManual');
    if (geo) geo.classList.remove('selected');
    if (manual) manual.classList.remove('selected');
    if (!fromPicker) closeModalImmediately('addrPickerModal');
    $('addAddressModal')?.classList.toggle('from-picker', fromPicker);
    $('addAddressModal')?.classList.toggle('no-motion', !withMotion);
    openModal('addAddressModal');
  }

  function backFromAddAddress() {
    const fromPicker = _addAddressOrigin === 'picker';
    closeModalId('addAddressModal');
    _returnToAddAddressChoice = false;
    if (fromPicker) {
      setTimeout(() => {
        $('addAddressModal')?.classList.remove('from-picker', 'no-motion');
      }, 560);
    }
  }

  let _adcSelection = null;

  function selectAdcOption(type) {
    _adcSelection = type;
    const geo = $('adcBtnGeo');
    const manual = $('adcBtnManual');
    if (geo) geo.classList.toggle('selected', type === 'geo');
    if (manual) manual.classList.toggle('selected', type === 'manual');
    const btn = $('adcConfirmBtn');
    if (btn) btn.disabled = false;
  }

  function adcConfirm() {
    if (!_adcSelection) return;
    _returnToAddAddressChoice = true;
    if (_adcSelection === 'geo') {
      adcUseGeoSearch(true);
      return;
    }
    openAddrSearch(true);
    closeAddressEntryStackImmediately();
  }

  function closeAddressEntryStackImmediately() {
    closeModalImmediately('addAddressModal');
    if (_addAddressOrigin === 'picker') closeModalImmediately('addrPickerModal');
    $('addAddressModal')?.classList.remove('from-picker');
  }

  function reopenAddressChoiceImmediately() {
    if (_addAddressOrigin === 'picker') {
      $('addrPickerModal')?.classList.add('no-motion');
      openModalImmediately('addrPickerModal');
    }
    $('addAddressModal')?.classList.toggle('from-picker', _addAddressOrigin === 'picker');
    $('addAddressModal')?.classList.add('no-motion');
    openModalImmediately('addAddressModal');
  }

  function backFromAddrSearch() {
    if (!_returnToAddAddressChoice) {
      closeModalId('addrSearchModal');
      return;
    }
    reopenAddressChoiceImmediately();
    closeModalImmediately('addrSearchModal');
  }

  function backFromAddrMap() {
    if (!_returnToAddAddressChoice) {
      closeModalId('addrMapModal');
      return;
    }
    reopenAddressChoiceImmediately();
    closeModalImmediately('addrMapModal');
  }

  function editAddrDetailsLocation() {
    closeModalImmediately('addrDetailsModal');
    openAddrSearch(true);
  }

  let _addrPickerSelected = null;
  let _addrPickerItems = [];
  let _addrPickerOrigin = 'operation';
  let _addrPickerConfirming = false;
  let _addrJustSavedAddress = null;
  let _addrPickerDeleteId = null;
  let _addrPickerDeleteMode = 'confirm';
  let _editingAddressId = null;
  const ADDR_PICKER_DOTS_VERTICAL = '<svg width="16" height="23" viewBox="0 0 24 32" fill="none" stroke="#aaa" stroke-width="2"><circle cx="12" cy="5" r="1.45" fill="#aaa"/><circle cx="12" cy="16" r="1.45" fill="#aaa"/><circle cx="12" cy="27" r="1.45" fill="#aaa"/></svg>';
  const ADDR_PICKER_DOTS_HORIZONTAL = '<svg width="21" height="8" viewBox="0 0 30 10" fill="none" stroke="#aaa" stroke-width="2"><circle cx="5" cy="5" r="1.45" fill="#aaa"/><circle cx="15" cy="5" r="1.45" fill="#aaa"/><circle cx="25" cy="5" r="1.45" fill="#aaa"/></svg>';
  const ADDR_PICKER_DELETE_ICON = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v5"/><path d="M14 11v5"/></svg>';
  function truncateAddrPickerText(text, max = 25) {
    const value = String(text || '').trim();
    return value.length > max ? `${value.slice(0, max).trimEnd()}...` : value;
  }

  function getCurrentPickerAddress() {
    return _addrJustSavedAddress || S.opDraft?.address || S.operationContext?.address || S.customerAddress || null;
  }

  /**
   * A identidade de um endereço que o backend ainda NÃO numerou.
   *
   * `__current__` nasceu como sentinela de UM endereço — o ativo — e virou o
   * `id` de TODOS os que não têm id do backend, que é a lista inteira de quem
   * nunca sincronizou. Dois endereços com o mesmo id quebram três coisas ao
   * mesmo tempo: o cartão destacado, o aviso de "endereço ativo" (que passava a
   * valer para todos, e travava a exclusão de qualquer um) e a própria
   * exclusão, que filtra a lista local por este id e apagaria os dois.
   *
   * `client_reference` é o nome que este app já dá a um endereço local — é ele
   * que o import para a conta usa. Ele só existe depois de `ensureLocal
   * ClientReferences()`, que só roda no import, então a impressão digital do
   * endereço é a segunda linha: ela é estável, é a mesma que o resto do fluxo
   * usa para comparar endereços, e distingue dois endereços diferentes.
   *
   * O sentinela continua sendo a última linha, para o endereço tão incompleto
   * que não gera impressão digital (sem rua, número ou bairro).
   */
  function localAddressId(addr, fallback = '__current__') {
    const reference = String(addr?.client_reference || '').trim();
    if (reference) return reference;
    const fingerprint = addressFingerprint(addr);
    return fingerprint ? `local:${fingerprint}` : fallback;
  }

  function addrPickerId(addr, fallback = '__current__') {
    return String(addr?.id || addr?.address_id || localAddressId(addr, fallback));
  }

  function sameAddress(a, b) {
    if (!a || !b) return false;
    const aId = a.id || a.address_id;
    const bId = b.id || b.address_id;
    if (aId && bId && String(aId) === String(bId)) return true;
    return String(a.street || '') === String(b.street || '')
      && String(a.number || '') === String(b.number || '')
      && String(a.neighborhood || '') === String(b.neighborhood || '');
  }

  function currentPickerItem(current) {
    if (!current) return null;
    return {
      ...current,
      id: current.id || current.address_id || localAddressId(current),
      label: current.label || current.alias || current.tag || current.name || current.street || 'Endereco'
    };
  }

  function mergeAddressPickerItems(...groups) {
    return dedupeAddresses(groups.flat().filter(Boolean));
  }

  function openAddrPicker(origin) {
    _addrPickerOrigin = origin || ($('mobViewProfile')?.classList.contains('active') && !$('operationModal')?.classList.contains('active') ? 'profile' : 'operation');
    $('addrPickerModal')?.classList.toggle('no-motion', _addrPickerOrigin !== 'profile');
    $('addrPickerModal')?.classList.toggle('from-profile', _addrPickerOrigin === 'profile');
    if (_addrPickerOrigin === 'profile') syncCartStickyForActiveView();
    _addrPickerSelected = null;
    _addrPickerItems = [];
    _addrPickerDeleteId = null;
    setAddrDeleteConfirm(false);
    const confirmBtn = $('addrPickerConfirmBtn');
    if (confirmBtn) {
      confirmBtn.disabled = true;
      setOperationEntryLoading(confirmBtn, false);
    }
    const current = getCurrentPickerAddress();
    const currentItem = currentPickerItem(current);
    const localItems = readLocalAddressList().map(currentPickerItem).filter(Boolean);
    if (currentItem) {
      _addrPickerItems = mergeAddressPickerItems([currentItem], localItems);
      _addrPickerSelected = addrPickerId(currentItem);
    } else {
      _addrPickerItems = localItems;
    }
    _renderAddrPickerList();
    openModal('addrPickerModal');
    if (window.PedeAquiCustomerService?.isLoggedIn?.()) {
      synchronizeCustomerAddresses({ importLocal: true, notifyErrors: true }).then(list => {
        const current = getCurrentPickerAddress();
        const currentItem = currentPickerItem(current);
        const localItems = readLocalAddressList().map(currentPickerItem).filter(Boolean);
        _addrPickerItems = mergeAddressPickerItems(currentItem ? [currentItem] : [], localItems, list);
        const selectedMatch = _addrPickerItems.find(item => addressFingerprint(item) === addressFingerprint(current));
        if (selectedMatch) _addrPickerSelected = addrPickerId(selectedMatch);
        _renderAddrPickerList();
      }).catch(error => {
        console.error('[PedeAqui] Falha ao carregar endereços', error);
        alert('Não foi possível carregar seus endereços. Os endereços salvos neste aparelho continuam disponíveis.');
      });
    }
  }

  function _renderAddrPickerList() {
    const list = $('addrPickerList');
    if (!list) return;
    const current = getCurrentPickerAddress();
    list.innerHTML = _addrPickerItems.map(addr => {
      const id = addrPickerId(addr);
      const label = addr.label || addr.tag || addr.name || 'Endereço';
      const summary = addr.formatted_address || addressSummary(addr);
      const isSel = _addrPickerSelected
        ? _addrPickerSelected === id
        : current && (sameAddress(addr, current) || id === '__current__');
      if (isSel) {
        _addrPickerSelected = id;
        const btn = $('addrPickerConfirmBtn');
        if (btn) btn.disabled = false;
      }
      return `<button class="addr-picker-item${isSel ? ' selected' : ''}" ${act('click', 'selectAddrPickerItem', id)} data-addr-id="${esc(id)}">
        <span class="addr-picker-pin${isSel ? ' active' : ''}">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M21 10c0 7-9 13-9 13S3 17 3 10a9 9 0 1 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
        </span>
        <span class="addr-picker-copy"><strong>${esc(label)}</strong><small data-full-text="${esc(summary)}" data-short-text="${esc(truncateAddrPickerText(summary, 35))}">${esc(truncateAddrPickerText(summary, 35))}</small></span>
        ${isSel
          ? `<span class="addr-picker-check"><svg width="11" height="11" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" fill="#15803d"/><path d="M8 12l3 3 5-5" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></span>
             <span class="addr-picker-dots" ${act('click', 'toggleAddrPickerActions', '$event', '$this')}>${ADDR_PICKER_DOTS_VERTICAL}</span>
             <span class="addr-picker-delete" ${act('click', 'removeAddrPickerItem', '$event', '$this')} aria-label="Excluir endereço">${ADDR_PICKER_DELETE_ICON}</span>`
          : `<span class="addr-picker-dots" ${act('click', 'toggleAddrPickerActions', '$event', '$this')}>${ADDR_PICKER_DOTS_VERTICAL}</span>
             <span class="addr-picker-delete" ${act('click', 'removeAddrPickerItem', '$event', '$this')} aria-label="Excluir endereço">${ADDR_PICKER_DELETE_ICON}</span>`}
      </button>`;
    }).join('');
  }

  function setAddrDeleteConfirm(open) {
    const confirm = $('addrDeleteConfirm');
    setAccessibleDialogState(confirm, Boolean(open), '.addr-delete-yes');
  }

  function closeAddrDeleteConfirm() {
    setAddrDeleteConfirm(false);
  }

  function configureAddrDeleteDialog(mode) {
    const confirm = $('addrDeleteConfirm');
    const title = $('addrDeleteTitle');
    const text = confirm?.querySelector('.addr-delete-text');
    const action = confirm?.querySelector('.addr-delete-yes');
    const cancel = confirm?.querySelector('.addr-delete-cancel');
    _addrPickerDeleteMode = mode;
    confirm?.classList.toggle('is-active-warning', mode === 'active-warning');
    if (title) title.textContent = mode === 'active-warning' ? 'Atenção' : 'Excluir endereço';
    if (text) text.textContent = mode === 'active-warning'
      ? 'Não é possível excluir o endereço que está ativo neste momento.'
      : 'Tem certeza que deseja excluir este endereço?';
    if (action) action.textContent = mode === 'active-warning' ? 'Ok' : 'Excluir';
    if (cancel) {
      cancel.textContent = 'Cancelar';
      cancel.hidden = mode === 'active-warning';
    }
  }

  function closeAddrPickerActions(exceptCard) {
    document.querySelectorAll('#addrPickerModal .addr-picker-item.actions-open').forEach(card => {
      if (exceptCard && card === exceptCard) return;
      card.classList.remove('actions-open');
      const copy = card.querySelector('.addr-picker-copy small');
      if (copy?.dataset.shortText) copy.textContent = copy.dataset.shortText;
      const dots = card.querySelector('.addr-picker-dots');
      if (dots) dots.innerHTML = ADDR_PICKER_DOTS_VERTICAL;
    });
  }

  function toggleAddrPickerActions(event, target) {
    event?.preventDefault();
    event?.stopPropagation();
    const card = target?.closest?.('.addr-picker-item');
    if (!card) return;
    const willOpen = !card.classList.contains('actions-open');
    closeAddrPickerActions(card);
    card.classList.toggle('actions-open', willOpen);
    const copy = card.querySelector('.addr-picker-copy small');
    if (copy) {
      const full = copy.dataset.fullText || copy.textContent || '';
      copy.dataset.fullText = full;
      const short = copy.dataset.shortText || truncateAddrPickerText(full, 35);
      copy.dataset.shortText = short;
      copy.textContent = willOpen ? truncateAddrPickerText(full, 25) : short;
    }
    const dots = card.querySelector('.addr-picker-dots');
    if (dots) dots.innerHTML = willOpen ? ADDR_PICKER_DOTS_HORIZONTAL : ADDR_PICKER_DOTS_VERTICAL;
  }

  function editAddrPickerItem(event, id) {
    event?.preventDefault();
    event?.stopPropagation();
    const address = _addrPickerItems.find(item => addrPickerId(item) === String(id));
    if (!address) return;
    _editingAddressId = String(id);
    _addrTempLoc = {
      ...address,
      lat: Number(address.latitude ?? address.lat) || null,
      lng: Number(address.longitude ?? address.lng) || null,
      street_name: address.street || address.street_name || ''
    };
    closeModalImmediately('addrPickerModal');
    _openAddrDetailsForm(true);
  }
  function removeAddrPickerItem(event, target) {
    event?.preventDefault();
    event?.stopPropagation();
    const card = target?.closest?.('.addr-picker-item');
    const id = card?.dataset.addrId;
    if (!id) return;
    const address = _addrPickerItems.find(item => addrPickerId(item) === String(id));
    const activeAddress = S.operationContext?.address || S.customerAddress;
    // A PERGUNTA É UMA SÓ: este endereço é o que está ativo agora?
    //
    // Aqui havia também `|| _addrPickerSelected === String(id)`, e ele
    // respondia outra pergunta: "qual cartão está DESTACADO na lista". Tocar
    // num cartão só o destaca — a escolha só vale no Confirmar —, então quem
    // tocasse num endereço e o apagasse em seguida levava o aviso de "ativo"
    // sobre um endereço que não era o ativo. E enquanto todo endereço local
    // dividia o id `__current__` (ver localAddressId), esse ramo era verdadeiro
    // para TODOS: o cliente não conseguia apagar endereço nenhum.
    if (address && sameAddress(address, activeAddress)) {
      _addrPickerDeleteId = null;
      closeAddrPickerActions();
      configureAddrDeleteDialog('active-warning');
      setAddrDeleteConfirm(true);
      return;
    }
    _addrPickerDeleteId = String(id);
    closeAddrPickerActions();
    configureAddrDeleteDialog('confirm');
    setAddrDeleteConfirm(true);
  }

  function cancelAddrPickerDelete() {
    _addrPickerDeleteId = null;
    closeAddrDeleteConfirm();
  }

  async function confirmAddrPickerDelete() {
    if (_addrPickerDeleteMode === 'active-warning') {
      _addrPickerDeleteId = null;
      closeAddrDeleteConfirm();
      return;
    }
    const id = _addrPickerDeleteId;
    if (!id) return;
    const address = _addrPickerItems.find(item => addrPickerId(item) === String(id));
    _addrPickerDeleteId = null;
    closeAddrDeleteConfirm();
    try {
      const remoteId = remoteAddressId(address);
      if (remoteId) {
        await window.PedeAquiAddressService.deleteCustomerAddress(remoteId);
      }
    } catch (error) {
      console.error('[PedeAqui] Falha ao excluir endereço', error);
      alert('Não foi possível excluir este endereço. Tente novamente.');
      return;
    }
    _addrPickerItems = _addrPickerItems.filter(item => addrPickerId(item) !== String(id));
    writeLocalAddressList(readLocalAddressList().filter(item => addrPickerId(item) !== String(id) && item.synced_remote_id !== String(id)));
    const selectedWasDeleted = addressFingerprint(S.operationContext?.address) === addressFingerprint(address);
    if (selectedWasDeleted) setSelectedOperationAddress(null, { forceDelivery: false });
    if (_addrPickerSelected === String(id)) _addrPickerSelected = null;
    const btn = $('addrPickerConfirmBtn');
    if (btn) btn.disabled = !_addrPickerSelected;
    if (window.PedeAquiCustomerAuth?.getToken?.()) {
      try {
        const remote = await synchronizeCustomerAddresses({ importLocal: false });
        _addrPickerItems = mergeAddressPickerItems(readLocalAddressList(), remote);
        if (selectedWasDeleted) {
          const replacement = defaultBackendAddress(remote) || remote[0] || null;
          if (replacement) setSelectedOperationAddress(replacement, { confirmed: S.operationConfirmed });
        }
      } catch (error) {
        console.error('[PedeAqui] Falha ao atualizar endereços após exclusão', error);
      }
    }
    _renderAddrPickerList();
  }

  function selectAddrPickerItem(id) {
    closeAddrPickerActions();
    _addrPickerSelected = id;
    const selectedConfirmBtn = $('addrPickerConfirmBtn');
    if (selectedConfirmBtn) selectedConfirmBtn.disabled = false;
    // _renderAddrPickerList() remonta a lista inteira já com o item selecionado
    // e com os data-act-* corretos. O remendo manual que existia aqui embaixo
    // era inalcançável (ficava depois de um `return`) e reintroduzia um
    // onclick="" em atributo — bloqueado pela CSP de produção.
    _renderAddrPickerList();
  }

  async function confirmAddrPicker() {
    if (!_addrPickerSelected || _addrPickerConfirming) return;
    let address = _addrPickerItems.find(item => addrPickerId(item) === _addrPickerSelected);
    if (!address) return;
    const origin = _addrPickerOrigin;
    const confirmBtn = $('addrPickerConfirmBtn');
    _addrPickerConfirming = true;
    if (confirmBtn) confirmBtn.disabled = true;
    setOperationEntryLoading(confirmBtn, true);
    try {
      if (window.PedeAquiCustomerAuth?.getToken?.() && isRemoteAddress(address)) {
        try {
          await window.PedeAquiAddressService.setDefaultCustomerAddress(addrPickerId(address));
          const remote = await synchronizeCustomerAddresses({ importLocal: false });
          address = remote.find(item => addrPickerId(item) === addrPickerId(address)) || address;
        } catch (error) {
          console.error('[PedeAqui] Falha ao definir endereço padrão', error);
          alert('O endereço foi selecionado neste aparelho, mas não foi possível defini-lo como padrão na sua conta.');
        }
      }
      _addrJustSavedAddress = null;
      if (S.opDraft) S.opDraft.address = address;
      setSelectedOperationAddress(address, { confirmed: true });
      if (origin === 'operation' && S.opDraft) {
        await requestBranchAvailability(address);
        renderOperationScreen();
      }
      closeModalImmediately('addrPickerModal');
      if (origin === 'profile') {
        $('mobViewProfile')?.classList.add('active');
        setMobNavActive('mobNavProfile');
        renderProfileView();
        syncCartStickyForActiveView();
      }
      _addrPickerOrigin = 'operation';
    } finally {
      _addrPickerConfirming = false;
      setOperationEntryLoading(confirmBtn, false);
      if (confirmBtn && $('addrPickerModal')?.classList.contains('active')) confirmBtn.disabled = !_addrPickerSelected;
    }
  }

  // ============================================================
  //  Google Maps address flow (search → map → details)
  // ============================================================

  let _addrTempLoc = null;   // { lat, lng, formatted_address, place_id, street_name, number, street, neighborhood, city, state, postal_code }
  let _addrMap = null;
  let _addrSearchDebounce = null;
  let _googleMapsPromise = null;
  let _placesLibraryPromise = null;
  let _mapsLibraryPromise = null;
  let _geocodingLibraryPromise = null;
  let _addrSuggestionCache = [];
  let _addrAutocompleteSessionToken = null;
  let _geocoder = null;
  let _legacyAutocompleteService = null;

  // ----------------------------------------------------------------
  //  Places autocomplete: implementation switch + debug
  // ----------------------------------------------------------------
  // MIGRADO em 31/08/2026: o caminho NOVO (AutocompleteSuggestion, "Places
  // API (New)") é o padrão — o AutocompleteService legado está descontinuado
  // para clientes novos desde mar/2025 e é questão de tempo até parar.
  //
  // O legado NÃO morreu: ele é o fallback AUTOMÁTICO de sessão. Se o caminho
  // novo falhar por permissão/ativação (o 403 "caller does not have
  // permission" do AutocompletePlaces, de chave sem a Places API New
  // liberada no Google Cloud), a busca cai para o legado NA MESMA digitação
  // e segue funcionando — o cliente não vê nada além dos resultados.
  //
  // ⚠ NÃO TESTÁVEL EM DEV: a chave do Maps não libera localhost. O caminho
  // novo contra o Google real precisa ser VERIFICADO EM PREVIEW (scratchpad
  // da rodada: "verificar em preview"). O E2E cobre a troca com SDK falso.
  const USE_LEGACY_PLACES_AUTOCOMPLETE = false;
  // Caminho novo já falhou nesta sessão (por QUALQUER motivo): daqui em
  // diante, direto no legado. Ver o bloco de fallback em _fetchAddrSuggestions.
  let _newPlacesUnavailable = false;

  // Teto de espera do caminho novo. O SDK do Google NÃO tem timeout próprio:
  // uma promessa pendurada deixa o cliente olhando o esqueleto para sempre, e
  // "para sempre" na busca de endereço é um pedido que não acontece. O
  // debounce da digitação é 350ms; um autocomplete que passa de 3s já não
  // serve para quem está digitando, e o legado responde em seguida.
  const NEW_PLACES_TIMEOUT_MS = 3000;

  function _withTimeout(promise, ms, label) {
    let t;
    const limite = new Promise((_, reject) => {
      t = setTimeout(() => reject(new Error(`TIMEOUT_${label}_${ms}ms`)), ms);
    });
    return Promise.race([promise, limite]).finally(() => clearTimeout(t));
  }

  function _isNewPlacesPermissionError(err) {
    const msg = String((err && err.message) || err || '');
    return /caller does not have permission|PERMISSION_DENIED|REQUEST_DENIED|ApiNotActivated|not.*enabled|disabled|403/i.test(msg);
  }

  // Só para o diagnóstico no console — NÃO decide mais se cai para o legado.
  // Essa decisão virou incondicional de propósito; ver o bloco de fallback.
  function _diagnoseNewPlacesFailure(err) {
    const msg = String((err && err.message) || err || '');
    if (_isNewPlacesPermissionError(err))
      return 'Places API (New) sem permissão/ativação na chave — sessão caiu para o legado.';
    if (/^TIMEOUT_/.test(msg))
      return `Caminho novo não respondeu em ${NEW_PLACES_TIMEOUT_MS}ms — sessão caiu para o legado.`;
    if (/OVER_QUERY_LIMIT|RESOURCE_EXHAUSTED|quota/i.test(msg))
      return 'Cota da Places API (New) estourada — sessão caiu para o legado.';
    if (/Falha ao carregar a biblioteca|Chave do Google Maps/i.test(msg))
      return 'A biblioteca places do Maps não carregou. O legado usa a MESMA biblioteca, então ele deve falhar igual — e o erro na tela vem DELE, não daqui.';
    return 'Falha DESCONHECIDA no caminho novo — sessão caiu para o legado. Se isto se repetir, pode ser defeito NOSSO escondido atrás do fallback: leia o rawError.';
  }

  // Verbose, key-safe diagnostics in the console. Set to false to silence.
  const MAPS_DEBUG = true;
  let _mapsDebugLogged = false;

  function _maskKey(k) {
    if (!k) return '(none)';
    return `${String(k).slice(0, 10)}…(len ${String(k).length})`;
  }

  function _loadedMapsScripts() {
    return Array.from(document.querySelectorAll('script[src*="maps.googleapis.com"]'));
  }

  function _scriptKeyPrefix() {
    const s = document.querySelector('script[src*="maps.googleapis.com/maps/api/js"]');
    if (!s) return null;
    try { return (new URL(s.src).searchParams.get('key') || '').slice(0, 10) || null; }
    catch { return null; }
  }

  function _logMapsDebug(stage, extra) {
    if (!MAPS_DEBUG) return;
    const cfgKey = window.GOOGLE_MAPS_API_KEY || '';
    const scripts = _loadedMapsScripts();
    const scriptKey = _scriptKeyPrefix();
    console.groupCollapsed(`[PedeAqui][maps-debug] ${stage}`);
    console.log('location.href      :', window.location.href);
    console.log('location.origin    :', window.location.origin);
    console.log('document.referrer  :', document.referrer || '(empty)');
    console.log('configured key     :', _maskKey(cfgKey));
    console.log('loaded script key  :', scriptKey ? `${scriptKey}…` : '(no maps script yet)');
    console.log('keys match         :', scriptKey ? cfgKey.startsWith(scriptKey) : 'n/a (script not injected yet)');
    console.log('maps scripts count :', scripts.length, scripts.length > 1 ? '⚠ MULTIPLE — duplicate injection' : '(single — ok)');
    scripts.forEach((s, i) => console.log(`  script[${i}]       :`, s.src.replace(/key=[^&]+/, 'key=***')));
    console.log('google.maps        :', !!(window.google && window.google.maps));
    console.log('importLibrary      :', !!(window.google && window.google.maps && window.google.maps.importLibrary));
    console.log('autocomplete mode  :', USE_LEGACY_PLACES_AUTOCOMPLETE
      ? 'LEGACY AutocompleteService → maps.googleapis.com (Places API)'
      : 'NEW AutocompleteSuggestion → places.googleapis.com (Places API New)');
    if (extra) Object.keys(extra).forEach(k => console.log(`${k.padEnd(19)}:`, extra[k]));
    console.groupEnd();
  }

  // Map raw Google errors / status codes to friendly Portuguese messages.
  function _mapPlacesError(err) {
    const msg = String((err && err.message) || err || '');
    if (/Chave do Google Maps/i.test(msg) || /API key/i.test(msg))
      return 'Chave do Google Maps nao configurada.';
    if (/caller does not have permission|PERMISSION_DENIED/i.test(msg))
      return 'Nao foi possivel buscar enderecos agora. Verifique a configuracao do Google Places.';
    if (/RefererNotAllowed|referer|referrer/i.test(msg))
      return 'Este dominio local nao esta autorizado na chave do Google Maps.';
    if (/REQUEST_DENIED|not.*enabled|disabled|ApiNotActivated/i.test(msg))
      return 'Google Places API nao esta ativada para este projeto.';
    if (/ZERO_RESULTS|Nenhum/i.test(msg))
      return 'Nenhum endereco encontrado.';
    return 'Nao foi possivel buscar enderecos agora. Use "Nao achei meu endereco".';
  }

  const FORTALEZA_LOCATION_BIAS = {
    north: -2.35,
    south: -5.1,
    east: -37.0,
    west: -40.2
  };

  function _showAddrSearchMessage(message) {
    const sug = $('addrSuggestions');
    if (sug) sug.innerHTML = `<p class="addr-no-results">${_esc(message)}</p>`;
  }

  function _ensureGoogleMapsLoader() {
    if (!_mapsDebugLogged) { _mapsDebugLogged = true; _logMapsDebug('loader-start'); }
    if (window.google?.maps?.importLibrary) return Promise.resolve(window.google.maps);
    if (_googleMapsPromise) return _googleMapsPromise;

    const key = window.GOOGLE_MAPS_API_KEY || '';
    if (!key) {
      const err = new Error('Chave do Google Maps nao configurada.');
      console.warn('[Rapidex] Google Maps API key not configured. Copy scripts/config/maps-config.example.js to maps-config.local.js and set the key.');
      _googleMapsPromise = Promise.reject(err);
      return _googleMapsPromise;
    }

    const existing = document.querySelector('script[src*="maps.googleapis.com/maps/api/js"]');
    if (existing) {
      _googleMapsPromise = new Promise((resolve, reject) => {
        if (window.google?.maps?.importLibrary) { resolve(window.google.maps); return; }
        existing.addEventListener('load', () => {
          if (window.google?.maps?.importLibrary) resolve(window.google.maps);
          else reject(new Error('Google Maps carregou sem importLibrary.'));
        }, { once: true });
        existing.addEventListener('error', () => reject(new Error('Falha ao carregar o script do Google Maps.')), { once: true });
      });
      return _googleMapsPromise;
    }

    _googleMapsPromise = new Promise((resolve, reject) => {
      const bootstrapCallback = '__pedeAquiGoogleMapsReady';
      window.google = window.google || {};
      window.google.maps = window.google.maps || {};
      window.google.maps[bootstrapCallback] = () => {
        resolve(window.google.maps);
        try { delete window.google.maps[bootstrapCallback]; } catch { window.google.maps[bootstrapCallback] = undefined; }
      };

      const s = document.createElement('script');
      const params = new URLSearchParams({
        key,
        v: 'weekly',
        loading: 'async',
        callback: `google.maps.${bootstrapCallback}`
      });
      s.src = `https://maps.googleapis.com/maps/api/js?${params.toString()}`;
      s.async = true;
      s.onerror = () => {
        reject(new Error('Falha ao carregar o script do Google Maps.'));
      };
      document.head.appendChild(s);
    });
    return _googleMapsPromise;
  }

  async function _importGoogleMapsLibrary(name) {
    await _ensureGoogleMapsLoader();
    try {
      return await google.maps.importLibrary(name);
    } catch {
      throw new Error(`Falha ao carregar a biblioteca ${name} do Google Maps.`);
    }
  }

  function _loadPlacesLibrary() {
    if (!_placesLibraryPromise) _placesLibraryPromise = _importGoogleMapsLibrary('places');
    return _placesLibraryPromise;
  }

  function _loadMapsLibrary() {
    if (!_mapsLibraryPromise) {
      _mapsLibraryPromise = Promise.all([
        _importGoogleMapsLibrary('maps'),
        _importGoogleMapsLibrary('marker')
      ]);
    }
    return _mapsLibraryPromise;
  }

  async function _loadGeocoder() {
    if (!_geocodingLibraryPromise) _geocodingLibraryPromise = _importGoogleMapsLibrary('geocoding');
    await _geocodingLibraryPromise;
    if (!_geocoder) _geocoder = new google.maps.Geocoder();
    return _geocoder;
  }

  function openAddrSearch(instant = false) {
    const inp = $('addrSearchInput');
    const sug = $('addrSuggestions');
    if (inp) inp.value = '';
    if (sug) sug.innerHTML = '';
    _addrSuggestionCache = [];
    _addrAutocompleteSessionToken = null;
    if (instant) openModalImmediately('addrSearchModal');
    else openModal('addrSearchModal');
    _loadPlacesLibrary()
      .then(() => {
        if (MAPS_DEBUG) _logMapsDebug('places-library-loaded', {
          placesLibrary: 'loaded ok',
          AutocompleteService: !!(window.google?.maps?.places?.AutocompleteService),
          AutocompleteSuggestion: !!(window.google?.maps?.places?.AutocompleteSuggestion)
        });
      })
      .catch(err => {
        console.warn('[PedeAqui] Places library unavailable:', err);
        _showAddrSearchMessage(_mapPlacesError(err));
      })
      .finally(() => setTimeout(() => { if (inp) inp.focus(); }, 200));
  }

  function onAddrSearchInput() {
    clearTimeout(_addrSearchDebounce);
    const val = ($('addrSearchInput') || {}).value?.trim() || '';
    const sug = $('addrSuggestions');
    if (!sug) return;
    if (val.length < 2) { sug.innerHTML = ''; return; }
    _renderAddrSkeleton();
    _addrSearchDebounce = setTimeout(() => _fetchAddrSuggestions(val), 350);
  }

  function _renderAddrSkeleton() {
    const sug = $('addrSuggestions');
    if (!sug) return;
    let h = '';
    for (let i = 0; i < 4; i++) {
      h += `<div class="addr-sug-skeleton">
        <div class="addr-sug-sk-icon"></div>
        <div class="addr-sug-sk-text">
          <div class="addr-sug-sk-line addr-sug-sk-line--main"></div>
          <div class="addr-sug-sk-line addr-sug-sk-line--sub"></div>
        </div>
      </div>`;
    }
    sug.innerHTML = h;
  }

  async function _fetchAddrSuggestions(query) {
    const currentValue = ($('addrSearchInput') || {}).value?.trim() || '';
    if (query !== currentValue) return;
    try {
      let normalized;
      if (USE_LEGACY_PLACES_AUTOCOMPLETE || _newPlacesUnavailable) {
        normalized = await _fetchLegacySuggestions(query);
      } else {
        try {
          normalized = await _withTimeout(
            _fetchNewSuggestions(query), NEW_PLACES_TIMEOUT_MS, 'AUTOCOMPLETE_NEW'
          );
        } catch (err) {
          // QUALQUER falha do caminho novo cai para o legado. O novo é a
          // OTIMIZAÇÃO; o legado é a REDE — é ele que serviu este app por
          // anos, e é ele quem responde enquanto a Places API (New) não
          // estiver liberada na chave.
          //
          // A regra ANTERIOR era estreita: só caía para o legado se o erro
          // casasse o regex de permissão. Cota estourada, timeout, biblioteca
          // que não carrega e erro desconhecido eram RELANÇADOS e viravam
          // mensagem de erro na busca de endereço — regressão no caminho do
          // pedido, num lugar onde o legado teria respondido normalmente. E o
          // deploy sai automático da main, então isso iria ao ar sem escala.
          //
          // A sessão fica PRESA no legado de propósito: se o caminho novo já
          // falhou uma vez, insistir cobra o preço da falha (até
          // NEW_PLACES_TIMEOUT_MS) a CADA tecla, e o legado responde igual.
          //
          // Caso especial que NÃO existe aqui de propósito: quando a falha é a
          // biblioteca, o legado também vai falhar (os dois chamam o mesmo
          // _loadPlacesLibrary(), cuja promessa rejeitada fica em cache). O
          // fallback é inútil nesse caso, não errado — rejeita na hora e o
          // catch de fora mostra a mensagem, que é o desfecho certo. Uma
          // segunda regra aqui só daria uma segunda regra para errar.
          _newPlacesUnavailable = true;
          const bruto = String((err && err.message) || err);
          // console.warn INCONDICIONAL: com MAPS_DEBUG desligado, este é o
          // único rastro de que o caminho novo caiu. O fallback esconde
          // defeito nosso atrás de um legado que funciona — o preço aceito
          // por não mostrar erro ao cliente é que o sinal não pode sumir.
          console.warn('[PedeAqui] Autocomplete novo falhou; caindo para o legado:', bruto);
          if (MAPS_DEBUG) _logMapsDebug('autocomplete-fallback-legacy', {
            rawError: bruto,
            diagnosis: _diagnoseNewPlacesFailure(err)
          });
          normalized = await _fetchLegacySuggestions(query);
        }
      }
      if (query !== (($('addrSearchInput') || {}).value?.trim() || '')) return;
      _renderAddrSuggestions(normalized);
    } catch (err) {
      console.warn('[PedeAqui] Places autocomplete failed:', err);
      // Chegar AQUI significa que o LEGADO falhou. O caminho novo não termina
      // mais nesta mensagem: qualquer falha dele cai para o legado antes. Ou
      // seja, esta é a única mensagem de erro que o cliente vê — e ela custa
      // a busca de endereço inteira.
      if (MAPS_DEBUG) _logMapsDebug('autocomplete-error', {
        rawError: String((err && err.message) || err),
        diagnosis: 'O caminho LEGADO falhou (é o último recurso; o novo já caiu para ele antes). Suspeitas: "Places API" (a antiga) não habilitada na chave, restrição de referrer, ou a biblioteca places não ter carregado.'
      });
      _showAddrSearchMessage(_mapPlacesError(err));
    }
  }

  // NEW Places API (places.googleapis.com / AutocompletePlaces RPC).
  // Returns normalized [{ main, sub, placeId, placePrediction }].
  async function _fetchNewSuggestions(query) {
    const { AutocompleteSuggestion, AutocompleteSessionToken } = await _loadPlacesLibrary();
    if (!_addrAutocompleteSessionToken && AutocompleteSessionToken) {
      _addrAutocompleteSessionToken = new AutocompleteSessionToken();
    }
    const req = {
      input: query,
      includedRegionCodes: ['br'],
      language: 'pt-BR',
      region: 'br',
      locationBias: FORTALEZA_LOCATION_BIAS,
      sessionToken: _addrAutocompleteSessionToken
    };
    const { suggestions = [] } = await AutocompleteSuggestion.fetchAutocompleteSuggestions(req);
    return suggestions
      .filter(s => s.placePrediction)
      .map(s => {
        const p = s.placePrediction;
        return {
          main: _predictionText(p.mainText) || _predictionText(p.text) || '',
          sub: _predictionText(p.secondaryText) || '',
          placeId: p.placeId || '',
          placePrediction: p
        };
      });
  }

  // LEGACY AutocompleteService (maps.googleapis.com / "Places API").
  // Returns normalized [{ main, sub, placeId, placePrediction:null }].
  async function _fetchLegacySuggestions(query) {
    await _loadPlacesLibrary();
    if (!_legacyAutocompleteService) {
      _legacyAutocompleteService = new google.maps.places.AutocompleteService();
    }
    const bounds = new google.maps.LatLngBounds(
      { lat: FORTALEZA_LOCATION_BIAS.south, lng: FORTALEZA_LOCATION_BIAS.west },
      { lat: FORTALEZA_LOCATION_BIAS.north, lng: FORTALEZA_LOCATION_BIAS.east }
    );
    return new Promise((resolve, reject) => {
      _legacyAutocompleteService.getPlacePredictions({
        input: query,
        language: 'pt-BR',
        region: 'br',
        componentRestrictions: { country: 'br' },
        bounds
      }, (predictions, status) => {
        const S = google.maps.places.PlacesServiceStatus;
        if (status === S.ZERO_RESULTS) { resolve([]); return; }
        if (status !== S.OK || !predictions) {
          reject(new Error(`PLACES_STATUS_${status}`));
          return;
        }
        resolve(predictions.map(p => ({
          main: (p.structured_formatting && p.structured_formatting.main_text) || p.description || '',
          sub: (p.structured_formatting && p.structured_formatting.secondary_text) || '',
          placeId: p.place_id || '',
          placePrediction: null
        })));
      });
    });
  }

  // Legacy predictions carry only a placeId — resolve full details via Geocoder
  // (Geocoding API), which is already enabled on the key.
  async function _legacyPlaceIdToLocation(placeId) {
    if (!placeId) throw new Error('Sugestao invalida.');
    const r = await _geocodePlaceId(placeId);
    return {
      lat: r.geometry.location.lat(),
      lng: r.geometry.location.lng(),
      formatted_address: r.formatted_address || '',
      place_id: placeId,
      ..._parseAddrComponents(r.address_components || [])
    };
  }

  // Thin wrapper (kept hoisted) so there is a single escaper behind the
  // address/Places rendering.
  function _esc(s) {
    return esc(s);
  }

  function _predictionText(textValue) {
    if (!textValue) return '';
    return typeof textValue === 'string' ? textValue : (textValue.text || '');
  }

  function _normalizePlaceAddressComponents(comps) {
    return (comps || []).map(c => ({
      long_name: c.long_name || c.longText || '',
      short_name: c.short_name || c.shortText || '',
      types: c.types || []
    }));
  }

  function _placeLocationToLatLng(location) {
    if (!location) return null;
    const lat = typeof location.lat === 'function' ? location.lat() : location.lat;
    const lng = typeof location.lng === 'function' ? location.lng() : location.lng;
    if (typeof lat !== 'number' || typeof lng !== 'number') return null;
    return { lat, lng };
  }

  function _geocodePlaceId(placeId) {
    return _loadGeocoder().then(geocoder => new Promise((resolve, reject) => {
      geocoder.geocode({ placeId }, (results, status) => {
        if (status !== 'OK' || !results?.[0]) {
          reject(new Error('Nao foi possivel carregar este endereco.'));
          return;
        }
        resolve(results[0]);
      });
    }));
  }

  async function _placePredictionToLocation(placePrediction) {
    const placeId = placePrediction?.placeId || '';
    if (!placePrediction) throw new Error('Sugestao invalida.');
    try {
      const place = placePrediction.toPlace();
      await place.fetchFields({ fields: ['id', 'formattedAddress', 'location', 'addressComponents'] });
      const loc = _placeLocationToLatLng(place.location);
      if (!loc) throw new Error('Endereco sem coordenadas.');
      return {
        lat: loc.lat,
        lng: loc.lng,
        formatted_address: place.formattedAddress || '',
        place_id: place.id || placeId,
        ..._parseAddrComponents(_normalizePlaceAddressComponents(place.addressComponents || []))
      };
    } catch (err) {
      if (!placeId) throw err;
      const r = await _geocodePlaceId(placeId);
      return {
        lat: r.geometry.location.lat(),
        lng: r.geometry.location.lng(),
        formatted_address: r.formatted_address || '',
        place_id: placeId,
        ..._parseAddrComponents(r.address_components || [])
      };
    }
  }

  function _renderAddrSuggestions(suggestions) {
    const sug = $('addrSuggestions');
    if (!sug) return;
    _addrSuggestionCache = suggestions || [];
    if (!_addrSuggestionCache.length) {
      sug.innerHTML = '<p class="addr-no-results">Nenhum resultado encontrado.</p>';
      return;
    }
    sug.innerHTML = _addrSuggestionCache.map((s, index) => {
      const main = _esc([s.main, s.sub].filter(Boolean).join(s.sub ? ' - ' : ''));
      return `<button class="addr-sug-item" ${act('click', 'selectAddrSuggestion', index)}>
        <svg class="addr-sug-pin" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13S3 17 3 10a9 9 0 1 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
        <div class="addr-sug-copy">
          <span class="addr-sug-main">${main}</span>
        </div>
      </button>`;
    }).join('');
  }

  async function selectAddrSuggestion(index) {
    const suggestion = _addrSuggestionCache[Number(index)];
    if (!suggestion) {
      _showAddrSearchMessage('Sugestao indisponivel. Tente buscar novamente.');
      return;
    }
    try {
      if (suggestion.placePrediction) {
        // NEW Places API prediction object.
        _addrTempLoc = await _placePredictionToLocation(suggestion.placePrediction);
      } else if (suggestion.placeId) {
        // LEGACY prediction — resolve by placeId through the Geocoder.
        _addrTempLoc = await _legacyPlaceIdToLocation(suggestion.placeId);
      } else {
        throw new Error('Sugestao invalida.');
      }
      _addrAutocompleteSessionToken = null;
      closeModalImmediately('addrSearchModal');
      _openAddrDetailsForm(true);
    } catch (err) {
      console.warn('[PedeAqui] Failed to select address suggestion:', err);
      _showAddrSearchMessage(_mapPlacesError(err));
    }
  }
  function _parseAddrComponents(comps) {
    const get = (...types) => { for (const t of types) { const c = comps.find(x => x.types.includes(t)); if (c) return c.long_name; } return ''; };
    const route = get('route');
    const sNum  = get('street_number');
    return {
      street_name: route,
      number: sNum,
      street: route ? (sNum ? `${route}, ${sNum}` : route) : '',
      neighborhood: get('sublocality_level_1','sublocality','neighborhood','political'),
      city: get('administrative_area_level_2','locality'),
      state: get('administrative_area_level_1'),
      postal_code: get('postal_code')
    };
  }

  function adcUseGeoSearch(instant = false) {
    if (!navigator.geolocation) { alert('Geolocalizacao nao disponivel neste navegador.'); return; }
    navigator.geolocation.getCurrentPosition(
      pos => {
        const lat = pos.coords.latitude, lng = pos.coords.longitude;
        _addrTempLoc = { lat, lng, formatted_address:'', place_id:'', street_name:'', number:'', street:'', neighborhood:'', city:'', state:'', postal_code:'' };
        _loadGeocoder()
          .then(geocoder => {
            geocoder.geocode({ location:{ lat, lng } }, (results, status) => {
              if (status === 'OK' && results?.[0]) {
                _addrTempLoc = { lat, lng, formatted_address: results[0].formatted_address || '', place_id: results[0].place_id||'', ..._parseAddrComponents(results[0].address_components||[]) };
              }
              closeModalImmediately('addrSearchModal');
              if (instant) closeAddressEntryStackImmediately();
              _openAddrMapScreen(lat, lng, instant);
            });
          })
          .catch(err => {
            console.warn('[PedeAqui] Geocoder unavailable for current location:', err);
            closeModalImmediately('addrSearchModal');
            if (instant) closeAddressEntryStackImmediately();
            _openAddrMapScreen(lat, lng, instant);
          });
      },
      err => {
        console.warn('[PedeAqui] User location permission denied or unavailable:', err);
        alert('Nao foi possivel acessar sua localizacao. Digite seu endereco manualmente.');
      }
    );
  }

  function _openAddrMapScreen(lat, lng, instant = false) {
    if (instant) openModalImmediately('addrMapModal');
    else openModal('addrMapModal');
    _loadMapsLibrary()
      .then(() => setTimeout(() => _initAddrMap(lat, lng), 160))
      .catch(err => {
        console.warn('[PedeAqui] Maps library unavailable:', err);
        alert('Nao foi possivel carregar o mapa. Tente novamente.');
      });
  }
  function _initAddrMap(lat, lng) {
    if (!window.google) return;
    const el = $('addrMapContainer');
    if (!el) return;
    _addrMap = new google.maps.Map(el, { center:{lat,lng}, zoom:17, disableDefaultUI:true, zoomControl:true, gestureHandling:'greedy' });
    const stage = el.closest('.addr-map-stage');
    _addrMap.addListener('dragstart', () => stage?.classList.add('is-moving'));
    _addrMap.addListener('idle', () => {
      stage?.classList.remove('is-moving');
      const center = _addrMap.getCenter();
      if (!center || !_addrTempLoc) return;
      const nextLat = center.lat();
      const nextLng = center.lng();
      const moved = Math.abs(nextLat - _addrTempLoc.lat) > 0.000001
        || Math.abs(nextLng - _addrTempLoc.lng) > 0.000001;
      _addrTempLoc.lat = nextLat;
      _addrTempLoc.lng = nextLng;
      if (moved) {
        _addrTempLoc.formatted_address = '';
        _addrTempLoc.place_id = '';
        _addrTempLoc.street_name = '';
        _addrTempLoc.number = '';
        _addrTempLoc.street = '';
        _addrTempLoc.neighborhood = '';
        _addrTempLoc.city = '';
        _addrTempLoc.state = '';
        _addrTempLoc.postal_code = '';
      }
    });
  }

  function confirmAddrMap() {
    if (!_addrTempLoc?.lat) return;
    if (_addrMap) {
      const p = _addrMap.getCenter();
      _addrTempLoc.lat = p.lat(); _addrTempLoc.lng = p.lng();
    }
    if (!_addrTempLoc.formatted_address) {
      _loadGeocoder()
        .then(geocoder => {
          geocoder.geocode({ location:{ lat:_addrTempLoc.lat, lng:_addrTempLoc.lng } }, (results, status) => {
            if (status === 'OK' && results?.[0]) {
              const parsed = _parseAddrComponents(results[0].address_components||[]);
              _addrTempLoc = { ..._addrTempLoc, formatted_address: results[0].formatted_address||'', ...parsed };
            }
            closeModalImmediately('addrMapModal');
            _openAddrDetailsForm(true);
          });
        })
        .catch(err => {
          console.warn('[PedeAqui] Reverse geocoding unavailable:', err);
          closeModalImmediately('addrMapModal');
          _openAddrDetailsForm(true);
        });
      return;
    }
    closeModalImmediately('addrMapModal');
    _openAddrDetailsForm(true);
  }

  async function finishAddressDetails(address) {
    const editing = _editingAddressId
      ? _addrPickerItems.find(item => addrPickerId(item) === _editingAddressId) || readLocalAddressList().find(item => addrPickerId(item) === _editingAddressId)
      : null;
    let savedAddress = normalizeAddressValue({
      ...editing,
      ...address,
      id: editing?.id || editing?.address_id || address.id || address.address_id || `local_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      label: address.label || address.alias || editing?.label || address.street || 'Endereco'
    });
    const originalId = _editingAddressId;
    const logged = Boolean(window.PedeAquiCustomerAuth?.getToken?.());
    if (logged) {
      try {
        const response = editing && isRemoteAddress(editing)
          ? await window.PedeAquiAddressService.updateCustomerAddress(addrPickerId(editing), addressApiPayload(savedAddress))
          : await window.PedeAquiAddressService.createCustomerAddress(addressApiPayload(savedAddress));
        const remote = normalizeAddressValue(response?.data || response);
        if (remote && typeof remote === 'object') savedAddress = { ...savedAddress, ...remote, id: remote.id || remote.address_id || savedAddress.id };
      } catch (error) {
        console.error('[PedeAqui] Falha ao salvar endereço no backend', error);
        savedAddress.sync_error = true;
        if (editing && isRemoteAddress(editing)) savedAddress.synced_remote_id = addrPickerId(editing);
        alert('Não foi possível salvar o endereço na sua conta. Ele continuará disponível neste aparelho para você tentar novamente.');
      }
    }
    const localList = readLocalAddressList();
    writeLocalAddressList(dedupeAddresses([
      savedAddress,
      ...localList.filter(item => addrPickerId(item) !== String(originalId || '') && addressFingerprint(item) !== addressFingerprint(savedAddress))
    ]));
    _editingAddressId = null;
    _addrJustSavedAddress = savedAddress;
    if (S.opDraft) S.opDraft.address = savedAddress;
    setSelectedOperationAddress(savedAddress, { confirmed: S.operationConfirmed });
    _returnToAddAddressChoice = false;
    closeModalImmediately('addrDetailsModal');
    closeModalImmediately('addrMapModal');
    closeModalImmediately('addrSearchModal');
    $('addrPickerModal')?.classList.add('no-motion');
    openAddrPicker(_addrPickerOrigin);
    _addrPickerItems = mergeAddressPickerItems([currentPickerItem(savedAddress)], _addrPickerItems);
    _addrPickerSelected = addrPickerId(savedAddress);
    _renderAddrPickerList();
    if ($('operationModal')?.classList.contains('active')) renderOperationScreen();
  }

  function _openAddrDetailsForm(instant = false) {
    const loc = _addrTempLoc || {};
    const set = (id, v) => { const el = $(id); if (el) el.value = v; };
    const setDis = (id, v) => { const el = $(id); if (el) { el.value = v; el.disabled = false; } };
    setDis('addrDetStreet', loc.street_name || loc.street || '');
    setDis('addrDetNumber', loc.number || '');
    set('addrDetNeighborhood', loc.neighborhood || '');
    set('addrDetCep', loc.postal_code ? _fmtCep(loc.postal_code) : '');
    set('addrDetComplement', loc.complement || '');
    set('addrDetReference', loc.reference || '');
    set('addrDetAlias', loc.alias || loc.label || '');
    const noNum = $('addrDetNoNumber');
    if (noNum) noNum.checked = false;
    const titleStreet = loc.street_name || String(loc.street || '').replace(/,\s*[^,]+$/, '');
    const titleNumber = String(loc.number || '').trim();
    const titleHasNumber = titleNumber && new RegExp(`(^|\\D)${titleNumber.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\D|$)`).test(titleStreet);
    const title = titleStreet
      ? `${titleStreet}${titleNumber && !titleHasNumber ? `, ${titleNumber}` : ''}`
      : loc.formatted_address || 'Endereco';
    const sub = [loc.neighborhood, loc.city, loc.state].filter(Boolean).join(', ');
    const titleEl = $('addrDetLocationTitle');
    const subEl = $('addrDetLocationSub');
    if (titleEl) titleEl.textContent = title;
    if (subEl) subEl.textContent = sub || loc.formatted_address || '';
    validateAddrDetails();
    if (instant) openModalImmediately('addrDetailsModal');
    else openModal('addrDetailsModal');
    _loadMapsLibrary()
      .then(() => setTimeout(_initAddrDetailsMiniMap, 160))
      .catch(err => console.warn('[PedeAqui] Mini map unavailable:', err));
  }

  function _initAddrDetailsMiniMap() {
    if (!window.google || !_addrTempLoc?.lat) return;
    const el = $('addrDetailsMiniMap');
    if (!el) return;
    const map = new google.maps.Map(el, { center:{lat:_addrTempLoc.lat,lng:_addrTempLoc.lng}, zoom:16, disableDefaultUI:true, gestureHandling:'none', clickableIcons:false });
    new google.maps.Marker({ position:{lat:_addrTempLoc.lat,lng:_addrTempLoc.lng}, map });
  }

  function _fmtCep(cep) {
    const d = String(cep).replace(/\D/g,'');
    return d.length === 8 ? d.replace(/(\d{5})(\d{3})/,'$1-$2') : cep;
  }

  function maskCep(el) {
    let v = el.value.replace(/\D/g,'').slice(0,8);
    if (v.length > 5) v = v.slice(0,5) + '-' + v.slice(5);
    el.value = v;
  }

  function toggleAddrNoNumber() {
    const noNum = $('addrDetNoNumber');
    const numEl = $('addrDetNumber');
    if (!noNum || !numEl) return;
    if (noNum.checked) { numEl.value = 's/n'; numEl.disabled = true; }
    else { numEl.value = ''; numEl.disabled = false; }
    validateAddrDetails();
  }

  function validateAddrDetails() {
    const v = id => ($( id)||{}).value?.trim()||'';
    const street = v('addrDetStreet');
    const number = v('addrDetNumber');
    const neighborhood = v('addrDetNeighborhood');
    const noNum = $('addrDetNoNumber')?.checked;
    const btn = $('addrDetSaveBtn');
    if (btn) btn.disabled = !(street && (number || noNum) && neighborhood);
  }

  async function saveAddressDetails() {
    const v = id => ($(id)||{}).value?.trim()||'';
    const street       = v('addrDetStreet');
    const rawNum       = v('addrDetNumber');
    const noNum        = $('addrDetNoNumber')?.checked;
    const number       = noNum ? 's/n' : rawNum;
    const neighborhood = v('addrDetNeighborhood');
    const complement   = v('addrDetComplement');
    const reference    = v('addrDetReference');
    const alias        = v('addrDetAlias');
    const postal_code  = v('addrDetCep').replace(/\D/g,'');
    if (!street || (!number && !noNum) || !neighborhood) { alert('Preencha os campos obrigatórios.'); return; }
    const loc = _addrTempLoc || {};
    const address = { street, number, neighborhood, complement, reference, alias, label: alias || street, postal_code,
      formatted_address: loc.formatted_address || `${street}, ${number} - ${neighborhood}`,
      latitude: loc.lat || null, longitude: loc.lng || null, place_id: loc.place_id || '' };
    await finishAddressDetails(address);
  }

  // ── end Google Maps address flow ──

  // As 27 ações que o markup deste fluxo chama por data-act-*. Saíram do objeto
  // ACTIONS do restaurant-page.js e vieram inteiras para cá.
  const ACOES_DO_MODULO = {
    openAddressScreen,
    openAddressChoice,
    openAddressChoiceDirect,
    backFromAddAddress,
    selectAdcOption,
    adcConfirm,
    backFromAddrSearch,
    backFromAddrMap,
    editAddrDetailsLocation,
    openAddrPicker,
    selectAddrPickerItem,
    editAddrPickerItem,
    confirmAddrPicker,
    toggleAddrPickerActions,
    removeAddrPickerItem,
    confirmAddrPickerDelete,
    cancelAddrPickerDelete,
    closeAddrDeleteConfirm,
    openAddrSearch,
    onAddrSearchInput,
    selectAddrSuggestion,
    adcUseGeoSearch,
    confirmAddrMap,
    toggleAddrNoNumber,
    maskCep,
    validateAddrDetails,
    saveAddressDetails
  };

  /**
   * Chamado UMA vez, por restaurant-page.js, no ponto onde este bloco morava.
   *
   * Os quatro getters são obrigatórios e conferidos: um deles faltando não é um
   * detalhe que degrada, é este módulo lendo `undefined` onde havia o endereço
   * do cliente — exatamente a classe de falha silenciosa que a regra 2 do
   * CLAUDE.md descreve. Melhor estourar no boot.
   */
  function init(deps) {
    for (const nome of ESTADO_OBRIGATORIO) {
      if (typeof deps?.[nome] !== 'function') {
        throw new Error(`PedeAquiAddressFlow.init: falta o getter de ${nome}`);
      }
      Object.defineProperty(S, nome, { get: deps[nome], configurable: true });
    }
    ({
      $,
      act,
      addressApiPayload,
      addressFingerprint,
      addressSummary,
      appState,
      closeModalId,
      closeModalImmediately,
      dedupeAddresses,
      defaultBackendAddress,
      esc,
      isLogged,
      isRemoteAddress,
      normalizeAddressValue,
      openModal,
      openModalImmediately,
      readLocalAddressList,
      remoteAddressId,
      renderOperationScreen,
      renderProfileView,
      requestBranchAvailability,
      setAccessibleDialogState,
      setMobNavActive,
      setOperationEntryLoading,
      setSelectedOperationAddress,
      syncCartStickyForActiveView,
      synchronizeCustomerAddresses,
      writeLocalAddressList
    } = deps);
    window.RapidexActions.register(ACOES_DO_MODULO);
  }


  window.PedeAquiAddressFlow = {
    init,
    // As quatro portas que o restaurant-page.js ainda chama pelo nome.
    addrPickerId,
    openAddrPicker,
    openAddressChoiceDirect,
    openAddressScreen
  };
})();
