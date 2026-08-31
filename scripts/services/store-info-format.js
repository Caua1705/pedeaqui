// ============================================================================
//  Formatadores PUROS da resposta de GET /restaurants/{slug}/info.
//
//  Cada função recebe o pedaço do contrato (api.d.ts) e devolve texto — sem
//  DOM, sem window de app, sem estado. É o que permite unitários de verdade
//  (ambiente node, fixture info.json) para a parte do modal de informações
//  que mais errou nome de campo nesta base: o horário de funcionamento já
//  mostrou "0" como dia da semana e deslocou a semana inteira em um por ler
//  display_name/day_name (nomes que nunca existiram) e cair num mapa 1..7 —
//  o weekday do contrato é 0=SEGUNDA (datetime.weekday() do Python).
//
//  Publica em window quando há window (o app) e em module.exports quando não
//  há (o vitest roda em node puro).
// ============================================================================
(function () {
  const DIAS_DO_CONTRATO = ['Segunda-feira', 'Terça-feira', 'Quarta-feira', 'Quinta-feira', 'Sexta-feira', 'Sábado', 'Domingo'];

  const textOrEmpty = (value) => {
    const text = String(value ?? '').trim();
    return text;
  };

  /** BusinessHourDayResponse → rótulo do dia. day_label vem PRONTO do backend. */
  function formatWeekday(day) {
    const label = textOrEmpty(day?.day_label);
    if (label) return label;
    return DIAS_DO_CONTRATO[Number(day?.weekday)] || String(day?.weekday ?? '');
  }

  /** "10:00:00" | "10:00" → "10:00". Vazio se não houver hora. */
  function formatTime(value) {
    const text = textOrEmpty(value);
    return text ? text.slice(0, 5) : '';
  }

  /** BusinessHourDayResponse → "10:00 às 22:00" (períodos unidos) ou "Fechado". */
  function formatHoursLine(day) {
    if (day?.is_closed === true) return 'Fechado';
    const periods = Array.isArray(day?.periods) ? day.periods : [];
    const parts = periods.map(period => {
      const start = formatTime(period?.opens_at);
      const end = formatTime(period?.closes_at);
      return start && end ? `${start} às ${end}` : '';
    }).filter(Boolean);
    return parts.length ? parts.join(' - ') : 'Fechado';
  }

  /**
   * RestaurantInfoResponse → o BusinessHourDayResponse de HOJE, casando
   * current_weekday com weekday POR NÚMERO (os dois são números no contrato).
   */
  function todayHours(info) {
    const hours = Array.isArray(info?.business_hours) ? info.business_hours : [];
    const today = hours.find(day => Number(day?.weekday) === Number(info?.current_weekday));
    return today || null;
  }

  /**
   * BranchAddressResponse (ou objeto com os mesmos nomes) → endereço numa
   * linha. full_address vence quando o backend já o montou.
   */
  function formatFullAddress(address) {
    if (!address || typeof address !== 'object') return '';
    if (textOrEmpty(address.full_address)) return address.full_address;
    return [
      [address.street, address.number].filter(Boolean).join(', '),
      address.neighborhood,
      address.city,
      address.state
    ].filter(Boolean).join(' - ');
  }

  /** Telefone/WhatsApp → href de wa.me com DDI 55 (só dígitos). '' sem número. */
  function formatWhatsappHref(value) {
    const digits = String(value ?? '').replace(/\D/g, '');
    if (!digits) return '';
    return `https://wa.me/${digits.startsWith('55') ? digits : `55${digits}`}`;
  }

  /** method_type de BranchPaymentMethodResponse → rótulo do grupo na tela. */
  function formatPaymentGroupLabel(methodType) {
    return ({
      credit: 'Crédito',
      debit: 'Débito',
      cash: 'Dinheiro',
      pix: 'PIX na entrega',
      voucher: 'Vale-refeição / alimentação'
    })[String(methodType ?? '').toLowerCase()] || '';
  }

  /** RestaurantInfoBranchResponse → nome exibível da unidade. */
  function formatBranchLabel(branch) {
    return textOrEmpty(branch?.display_name) || textOrEmpty(branch?.name) || 'Unidade';
  }

  const api = {
    formatWeekday,
    formatTime,
    formatHoursLine,
    todayHours,
    formatFullAddress,
    formatWhatsappHref,
    formatPaymentGroupLabel,
    formatBranchLabel
  };

  if (typeof window !== 'undefined') window.PedeAquiStoreInfoFormat = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
