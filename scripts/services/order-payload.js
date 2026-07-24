// ============================================================================
//  Montagem do payload de POST /restaurants/{slug}/orders — PONTO ÚNICO.
//
//  Contrato completo: docs/order-contract.md (derivado do OpenAPI da API).
//  Se o backend recusar o payload, o conserto é AQUI e em mais lugar nenhum.
//
//  buildOrderPayload() é PURA: recebe todo o estado por parâmetro e não lê
//  nenhum global. É isso que a torna testável fora do browser.
//
//  PRINCÍPIO: o backend é a fonte de verdade dos valores. Este payload carrega
//  apenas INPUTS (itens, opções, endereço, modalidade, cupom, pagamento).
//  subtotal/total/desconto/cashback NÃO são enviados — nem existem no schema.
// ============================================================================
(function () {
  const text = (value) => {
    const raw = String(value ?? '').trim();
    return raw || null;
  };

  const uuid = (value) => {
    const raw = String(value ?? '').trim();
    return raw || null;
  };

  // Só entram no JSON as chaves com valor útil: o backend trata ausente e null
  // de formas diferentes em alguns campos, e "" nunca é o que queremos dizer.
  function compact(object) {
    const result = {};
    for (const [key, value] of Object.entries(object)) {
      if (value !== null && value !== undefined) result[key] = value;
    }
    return result;
  }

  function buildItem(item) {
    const productId = uuid(item?.product_id ?? item?.id);
    if (!productId) return null;

    const quantity = Math.max(1, Number.parseInt(item?.qty ?? item?.quantity ?? 1, 10) || 1);

    // O carrinho já grava selected_options no formato exato do schema
    // ({option_group_id, option_id}) — aqui só filtramos entradas quebradas.
    const selectedOptions = (Array.isArray(item?.selected_options) ? item.selected_options : [])
      .map(option => {
        const groupId = uuid(option?.option_group_id);
        const optionId = uuid(option?.option_id);
        return groupId && optionId ? { option_group_id: groupId, option_id: optionId } : null;
      })
      .filter(Boolean);

    return compact({
      product_id: productId,
      quantity,
      observation: text(item?.obs ?? item?.observation),
      selected_options: selectedOptions.length ? selectedOptions : null
    });
  }

  // O front normaliza CEP como postal_code; o schema chama de zipcode.
  function buildAddress(address) {
    if (!address) return null;
    const built = compact({
      street: text(address.street ?? address.street_name),
      number: text(address.number),
      neighborhood: text(address.neighborhood),
      complement: text(address.complement),
      reference: text(address.reference),
      city: text(address.city),
      state: text(address.state),
      zipcode: text(address.zipcode ?? address.postal_code ?? address.zip_code ?? address.cep),
      latitude: address.latitude ?? address.lat ?? null,
      longitude: address.longitude ?? address.lng ?? null
    });
    return Object.keys(built).length ? built : null;
  }

  /**
   * @param {object} state
   * @param {Array}  state.cart             itens do carrinho
   * @param {object} state.operationContext {branch_id, order_type, address}
   * @param {object} [state.coupon]         cupom selecionado (id e/ou code)
   * @param {string} [state.paymentMethod]  method_type canônico do backend
   * @param {object} [state.customer]       snapshot {name, phone} — visitante
   * @param {boolean} state.isAuthenticated true => identidade vem do JWT
   * @param {string} [state.notes]          observação do pedido
   */
  function buildOrderPayload(state = {}) {
    const {
      cart = [],
      operationContext = {},
      coupon = null,
      paymentMethod = '',
      customer = null,
      isAuthenticated = false,
      notes = null
    } = state;

    const items = (Array.isArray(cart) ? cart : []).map(buildItem).filter(Boolean);
    const orderType = text(operationContext?.order_type) || 'delivery';
    const isDelivery = orderType === 'delivery';

    const payload = {
      branch_id: uuid(operationContext?.branch_id),
      order_type: orderType,
      items
    };

    // Endereço: id XOR objeto, e só em delivery.
    if (isDelivery) {
      const address = operationContext?.address || null;
      const addressId = uuid(address?.id ?? address?.address_id);
      if (addressId) payload.customer_address_id = addressId;
      else {
        const built = buildAddress(address);
        if (built) payload.address = built;
      }
    }

    // Autenticado: identidade sai do Bearer token. customer_id nunca é enviado
    // (nem existe no schema). O bloco customer é exclusivo do visitante.
    if (!isAuthenticated) {
      const name = text(customer?.name);
      const phone = text(customer?.phone);
      if (name && phone) payload.customer = { name, phone };
    }

    // Cupom: id XOR code, nunca os dois.
    const couponId = uuid(coupon?.id ?? coupon?.coupon_id);
    const couponCode = text(coupon?.code ?? coupon?.coupon_code);
    if (couponId) payload.coupon_id = couponId;
    else if (couponCode) payload.coupon_code = couponCode.slice(0, 100);

    const method = text(paymentMethod);
    if (method) payload.payment_method = method;

    const orderNotes = text(notes);
    if (orderNotes) payload.notes = orderNotes;

    return payload;
  }

  /**
   * Valida o payload ANTES de gastar uma requisição. Devolve lista de motivos
   * legíveis (vazia = pronto para enviar).
   *
   * `hasValidDeliveryFee` vem de fora (hasValidDeliveryEstimateFee no page):
   * pedido de entrega sem taxa apurada não pode ser criado — o total sairia
   * sem o frete.
   */
  function validateOrderPayload(payload, context = {}) {
    const { hasValidDeliveryFee = true, isAuthenticated = false } = context;
    const problems = [];

    if (!payload?.branch_id) problems.push('Escolha a unidade da loja antes de continuar.');
    if (!payload?.items?.length) problems.push('Seu carrinho está vazio.');
    if (!payload?.payment_method) problems.push('Escolha a forma de pagamento.');

    if (payload?.order_type === 'delivery') {
      if (!payload.customer_address_id && !payload.address) {
        problems.push('Informe o endereço de entrega.');
      }
      if (!hasValidDeliveryFee) {
        problems.push('Não foi possível calcular a taxa de entrega. Confirme o endereço e tente novamente.');
      }
    }

    if (!isAuthenticated && !payload?.customer) {
      problems.push('Informe seu nome e telefone para continuar.');
    }

    return problems;
  }

  window.RapidexOrderPayload = { buildOrderPayload, validateOrderPayload };
})();
