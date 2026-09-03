// ============================================================================
//  A TELA DO ENTREGADOR.
//
//  Três estados exclusivos, nunca sobrepostos: a PORTA (o código de 6 dígitos),
//  o TRABALHO (a lista) e o FIM DA LINHA (link morto). Um link inválido não
//  tem nada atrás dele para servir de fundo, então a terceira é irmã das duas
//  primeiras e não um overlay.
//
//  DUAS REGRAS QUE VÊM DO APP DO CLIENTE E VALEM IGUAL AQUI:
//
//  1. O front não calcula dinheiro. `amount_to_collect` chega pronto e é o que
//     o entregador vai receber na mão. Nada aqui subtrai, soma ou arredonda.
//  2. Quem decide o que pode ser feito é o backend: `can_leave` e `can_deliver`
//     vêm por pedido. Inferir a ação a partir de `status` seria refazer a
//     decisão dele com a régua errada — e a régua muda no backend sem avisar.
//
//  Sem handler inline e sem innerHTML: os cartões são montados com
//  createElement. Nome de cliente, endereço e observação vêm da API e vão para
//  a tela; montar por nó em vez de por string tira a chance de esquecer um
//  escape num campo que uma pessoa digitou.
// ============================================================================
(function () {
  const service = () => window.RapidexCourierService;
  const fmt = (value) => window.PedeAquiCurrency.formatCurrency(value);

  // Namespace `rapidex.*`, como o resto do repositório, e por LINK: um mesmo
  // aparelho pode receber o link de duas filiais, e o código de uma não abre a
  // outra. O código fica no aparelho do entregador de propósito — ele digita
  // uma vez por link, não uma vez por turno.
  const codeKey = (token) => `rapidex.courier.code.${token}`;

  const $ = (id) => document.getElementById(id);

  // O `status` do contrato é string livre, e os valores são os do BACKEND. Só
  // os que fazem sentido para quem está na rua ganham rótulo; o resto não
  // aparece (ver o comentário em `cartao()`). Este mapa não decide nada — quem
  // decide o que pode ser feito é `can_leave`/`can_deliver`.
  const STATUS_EM_PORTUGUES = {
    ready: 'Pronto',
    preparing: 'Em preparo',
    out_for_delivery: 'A caminho',
    delivered: 'Entregue'
  };

  let pedidos = [];
  const selecionados = new Set();
  let carregando = false;

  // ── Montagem de nós ──────────────────────────────────────────────────────
  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null && text !== '') node.textContent = String(text);
    return node;
  }

  // ── As três telas ────────────────────────────────────────────────────────
  function mostrar(qual) {
    for (const [id, ativo] of [
      ['courierGate', qual === 'porta'],
      ['courierApp', qual === 'trabalho'],
      ['courierHistory', qual === 'acerto'],
      ['courierDead', qual === 'fim']
    ]) {
      const node = $(id);
      if (node) node.hidden = !ativo;
    }
    document.body.classList.remove('courier-booting');
  }

  function fimDaLinha(titulo, texto) {
    $('courierDeadTitle').textContent = titulo;
    $('courierDeadText').textContent = texto;
    mostrar('fim');
  }

  function erroNaPorta(mensagem) {
    const box = $('courierGateError');
    box.textContent = mensagem;
    box.hidden = !mensagem;
  }

  function aviso(mensagem) {
    const box = $('courierAlert');
    box.textContent = mensagem || '';
    box.hidden = !mensagem;
  }

  // ── O endereço, em uma linha ─────────────────────────────────────────────
  // Os campos do endereço são FLAT no contrato (address_street, address_number,
  // ...), cada um `string | null`. Juntar com filter(Boolean) evita as vírgulas
  // órfãs de um endereço incompleto — que é o caso comum, não a exceção.
  function enderecoEmTexto(pedido) {
    const rua = [pedido.address_street, pedido.address_number].filter(Boolean).join(', ');
    const partes = [rua, pedido.address_neighborhood, pedido.address_city].filter(Boolean);
    return partes.join(' — ');
  }

  function linkDeMapa(pedido) {
    const lat = pedido.delivery_latitude;
    const lon = pedido.delivery_longitude;
    // Coordenada quando o backend a tem; senão o texto do endereço. `!= null`
    // de propósito: latitude 0 é uma coordenada legítima, e `||` a descartaria
    // — é a mesma armadilha do `sort_order` que fazia o primeiro item perder a
    // própria ordem.
    const alvo = (lat != null && lon != null)
      ? `${lat},${lon}`
      : enderecoEmTexto(pedido);
    if (!alvo) return '';
    return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(alvo)}`;
  }

  // ── O cartão de um pedido ────────────────────────────────────────────────
  function cartao(pedido) {
    const card = el('article', 'cr-card');
    card.dataset.orderId = pedido.order_id;
    if (selecionados.has(pedido.order_id)) card.classList.add('is-picked');

    const topo = el('div', 'cr-card__top');
    topo.append(el('span', 'cr-card__num', `#${pedido.order_number}`));
    const rotulo = STATUS_EM_PORTUGUES[pedido.status];
    // Status DESCONHECIDO não vira chip. O contrato declara `status` como
    // string livre, então um valor novo do backend chegaria aqui cru — e
    // "OUT_FOR_DELIVERY" na tela de quem está na rua é jargão nosso vazando
    // para quem não tem por que conhecê-lo. Sem rótulo, o cartão continua
    // dizendo o que importa: o endereço, o valor e o que dá para fazer.
    if (rotulo) topo.append(el('span', 'cr-card__status', rotulo));
    card.append(topo);

    card.append(el('div', 'cr-card__who', pedido.customer_name));

    const endereco = enderecoEmTexto(pedido);
    if (endereco) card.append(el('div', 'cr-card__addr', endereco));
    if (pedido.address_complement) card.append(el('div', 'cr-card__addr', pedido.address_complement));
    if (pedido.address_reference) card.append(el('div', 'cr-card__addr', `Referência: ${pedido.address_reference}`));

    // O DINHEIRO. Uma linha sempre, e ela diz o que o backend disse — nunca uma
    // conta feita aqui. `is_paid` e `amount_to_collect` são os dois campos, e
    // são independentes: um pedido pode estar pago e não ter nada a receber, e
    // é isso que a primeira condição cobre.
    const aReceber = Number(pedido.amount_to_collect);
    if (pedido.is_paid) {
      card.append(el('div', 'cr-card__paid', 'Pedido pago — nada a receber'));
    } else if (Number.isFinite(aReceber) && aReceber > 0) {
      const metodo = pedido.payment_method ? ` (${pedido.payment_method})` : '';
      card.append(el('div', 'cr-card__money', `Receber ${fmt(aReceber)}${metodo}`));
    } else {
      // Não pago e sem valor a receber é dado contraditório do backend. A tela
      // diz o que sabe e não inventa um número: um valor chutado aqui vira
      // dinheiro cobrado a mais ou a menos na porta de alguém.
      card.append(el('div', 'cr-card__paid', 'Pagamento não confirmado — confira com o restaurante'));
    }

    if (pedido.notes) card.append(el('div', 'cr-card__notes', pedido.notes));

    const acoes = el('div', 'cr-card__acts');

    if (pedido.customer_phone) {
      const tel = el('a', 'cr-link', 'Ligar');
      tel.href = `tel:${pedido.customer_phone}`;
      acoes.append(tel);
    }
    const mapa = linkDeMapa(pedido);
    if (mapa) {
      const rota = el('a', 'cr-link', 'Rota');
      rota.href = mapa;
      rota.target = '_blank';
      // noopener por higiene; o link vai para fora e não pode alcançar esta
      // janela, que carrega o token na URL.
      rota.rel = 'noopener noreferrer';
      acoes.append(rota);
    }

    // Quem manda é o backend: can_leave e can_deliver, não o status.
    if (pedido.can_leave) {
      const escolher = el('button', 'cr-btn cr-btn--ghost',
        selecionados.has(pedido.order_id) ? 'Remover da saída' : 'Selecionar para sair');
      escolher.type = 'button';
      escolher.dataset.acao = 'alternar';
      acoes.append(escolher);
    }
    if (pedido.can_deliver) {
      const entregue = el('button', 'cr-btn cr-btn--primary', 'Entregue');
      entregue.type = 'button';
      entregue.dataset.acao = 'entregue';
      acoes.append(entregue);
    }

    if (acoes.childElementCount) card.append(acoes);
    return card;
  }

  function desenhar() {
    const lista = $('courierList');
    lista.replaceChildren(...pedidos.map(cartao));
    $('courierEmpty').hidden = pedidos.length > 0;

    const barra = $('courierBar');
    barra.hidden = selecionados.size === 0;
    $('courierBarCount').textContent = selecionados.size === 1
      ? '1 pedido'
      : `${selecionados.size} pedidos`;
  }

  // ── Carregar ─────────────────────────────────────────────────────────────
  async function carregarPedidos() {
    if (carregando) return;
    carregando = true;
    $('courierReload')?.classList.add('is-busy');
    try {
      pedidos = await service().getOrders();
      // Uma seleção só sobrevive se o pedido ainda existe E ainda pode sair.
      // Sem isto, um pedido que outro entregador levou continuaria marcado
      // aqui e entraria no próximo lote, para ser recusado com `wrong_status`.
      const podem = new Set(pedidos.filter(p => p.can_leave).map(p => p.order_id));
      for (const id of [...selecionados]) if (!podem.has(id)) selecionados.delete(id);
      desenhar();
    } catch (error) {
      const tipo = service().classifyError(error);
      if (tipo === 'codigo-invalido') return pedirCodigo('O código não vale mais. Digite de novo.');
      if (tipo === 'link-invalido') return fimDaLinha('Link inválido', 'Peça um link novo para o restaurante.');
      aviso(tipo === 'sem-rede'
        ? 'Sem conexão. Toque em atualizar quando o sinal voltar.'
        : 'Não foi possível carregar seus pedidos.');
    } finally {
      carregando = false;
      $('courierReload')?.classList.remove('is-busy');
    }
  }

  // ── Sair para entrega: LOTE, e 200 não é sucesso ─────────────────────────
  async function sairParaEntrega() {
    const ids = [...selecionados];
    if (!ids.length) return;
    const botao = $('courierLeaveBtn');
    botao.disabled = true;
    try {
      const { aceitos, recusados } = await service().leaveForDelivery(ids);
      // A resposta vem 200 mesmo com pedido recusado dentro. Quem decide o que
      // dizer é o `ok` de cada item, nunca o status HTTP.
      selecionados.clear();
      for (const item of recusados) {
        // Um recusado que ainda pode sair volta para a seleção: o motivo mais
        // comum é `wrong_status` de uma lista velha, e depois do recarregar ele
        // pode estar pronto. `not_found` some da lista sozinho.
        if (item?.error === 'wrong_status') selecionados.add(item.order_id);
      }
      if (recusados.length) {
        const nomes = recusados.map(item => `#${item?.order?.order_number ?? item?.order_id}`).join(', ');
        aviso(aceitos.length
          ? `${aceitos.length} sairam. Nao deu para ${nomes} — a lista estava velha.`
          : `Nenhum pedido saiu. ${nomes} nao estao mais prontos.`);
      } else {
        aviso('');
      }
      await carregarPedidos();
    } catch (error) {
      const tipo = service().classifyError(error);
      if (tipo === 'codigo-invalido') return pedirCodigo('O código não vale mais. Digite de novo.');
      aviso(tipo === 'sem-rede'
        ? 'Sem conexão. Nada foi enviado — tente de novo.'
        : 'Não foi possível marcar a saída.');
    } finally {
      botao.disabled = false;
    }
  }

  // ── Entregue ─────────────────────────────────────────────────────────────
  async function marcarEntregue(orderId, botao) {
    botao.disabled = true;
    try {
      await service().markDelivered(orderId);
      selecionados.delete(orderId);
      aviso('');
      await carregarPedidos();
    } catch (error) {
      // 409 = o pedido não está no estado que permite entregar (já entregue,
      // ou nunca saiu). Não é rede nem código: é a lista da tela estando
      // velha, e a resposta certa é recarregar em vez de repetir o toque.
      if (error?.status === 409) {
        aviso('Este pedido mudou de estado. Atualizei a lista.');
        await carregarPedidos();
        return;
      }
      const tipo = service().classifyError(error);
      if (tipo === 'codigo-invalido') return pedirCodigo('O código não vale mais. Digite de novo.');
      aviso(tipo === 'sem-rede'
        ? 'Sem conexão. O pedido NÃO foi marcado como entregue.'
        : 'Não foi possível marcar como entregue.');
    } finally {
      botao.disabled = false;
    }
  }

  // ── O ACERTO ─────────────────────────────────────────────────────────────
  //
  //  É o número que o entregador leva ao dono no fim do dia. Sem esta tela ele
  //  tem de confiar na palavra do restaurante sobre quantas entregas fez e
  //  quanto elas valem.
  //
  //  NADA É SOMADO AQUI. `fee_total`, `deliveries_count` e
  //  `deliveries_without_fee` são os três campos required de
  //  CourierHistoryResponse e vêm prontos. Se esta tela recalculasse a soma a
  //  partir de `deliveries[].courier_fee`, ela poderia divergir do caixa do
  //  restaurante — e numa discussão sobre dinheiro entre duas telas, quem perde
  //  é quem não tem o sistema na mão.

  /** "2026-09-02T18:30:00Z" -> "02/09, 18:30". Formato curto: a data inteira
   *  não cabe ao lado da taxa num celular estreito, e o ano é o do período. */
  function quando(iso) {
    const data = new Date(iso);
    if (Number.isNaN(data.getTime())) return '';
    return new Intl.DateTimeFormat('pt-BR', {
      day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit'
    }).format(data).replace(', ', ', ');
  }

  /** "2026-09-01" -> "01/09". Aceita data pura, sem hora. */
  function diaCurto(valor) {
    const so = String(valor || '').slice(0, 10);
    const m = so.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    return m ? `${m[3]}/${m[2]}` : so;
  }

  function linhaDeEntrega(item) {
    const linha = el('div', 'cr-entrega');
    const esq = el('div', 'cr-entrega__esq');
    esq.append(el('span', 'cr-entrega__num', `#${item.order_number}`));

    const meta = [quando(item.delivered_at), item.address_neighborhood].filter(Boolean);
    // `distance_km` é `number | null`. `!= null` de propósito: 0 km é uma
    // distância legítima (entrega na porta do restaurante) e `||` a apagaria.
    if (item.distance_km != null) meta.push(`${Number(item.distance_km).toFixed(1)} km`);
    if (meta.length) esq.append(el('span', 'cr-entrega__meta', meta.join(' · ')));
    linha.append(esq);

    // `courier_fee` é `number | null`. Nulo NÃO é zero: é "esta entrega não tem
    // taxa registrada", e é justamente o que `deliveries_without_fee` conta lá
    // em cima. Escrever "R$ 0,00" aqui afirmaria que ela vale zero.
    linha.append(item.courier_fee == null
      ? el('span', 'cr-entrega__taxa cr-entrega__taxa--sem', 'sem taxa')
      : el('span', 'cr-entrega__taxa', fmt(item.courier_fee)));
    return linha;
  }

  async function abrirAcerto() {
    mostrar('acerto');
    $('courierHistoryAlert').hidden = true;
    try {
      const dados = await service().getHistory();

      // Os três números vêm prontos. O grande é o que ele vai receber.
      $('courierFeeTotal').textContent = fmt(dados?.fee_total);
      $('courierPeriod').textContent =
        `${diaCurto(dados?.start_date)} a ${diaCurto(dados?.end_date)}`;

      const entregas = Number(dados?.deliveries_count) || 0;
      $('courierCount').textContent = entregas === 1 ? '1 entrega' : `${entregas} entregas`;

      // SEPARADO da soma, e some quando é zero. Misturar na mesma linha faria a
      // conta parecer maior do que o que será pago; um "0 sem taxa" pendurado
      // ali seria ruído numa tela que existe para tirar dúvida, não criar.
      const semTaxa = Number(dados?.deliveries_without_fee) || 0;
      const aviso = $('courierWithoutFee');
      aviso.hidden = semTaxa === 0;
      // Zero não escreve NADA, nem escondido. Esconder um elemento que carrega
      // "0 entregas sem taxa" deixa a frase no DOM: ela chega ao leitor de tela
      // conforme a implementação, aparece numa busca da página e reaparece
      // inteira no dia em que alguém mexer no `hidden`. Linha FORA é linha sem
      // texto — a mesma regra da parcela zerada na sacola.
      aviso.textContent = semTaxa === 0
        ? ''
        : semTaxa === 1
          ? '1 entrega sem taxa registrada — ela NÃO está no valor acima'
          : `${semTaxa} entregas sem taxa registrada — elas NÃO estão no valor acima`;

      const lista = Array.isArray(dados?.deliveries) ? dados.deliveries : [];
      $('courierHistoryList').replaceChildren(...lista.map(linhaDeEntrega));
      $('courierHistoryEmpty').hidden = lista.length > 0;
    } catch (error) {
      const tipo = service().classifyError(error);
      if (tipo === 'codigo-invalido') return pedirCodigo('O código não vale mais. Digite de novo.');
      if (tipo === 'link-invalido') return fimDaLinha('Link inválido', 'Peça um link novo para o restaurante.');
      const box = $('courierHistoryAlert');
      box.textContent = tipo === 'sem-rede'
        ? 'Sem conexão. Não deu para carregar o acerto.'
        : 'Não foi possível carregar o acerto.';
      box.hidden = false;
      // Zera os números em vez de deixar os da consulta anterior na tela: um
      // valor velho ao lado de um erro é pior que valor nenhum.
      $('courierFeeTotal').textContent = '—';
      $('courierCount').textContent = '';
      $('courierWithoutFee').hidden = true;
      $('courierHistoryList').replaceChildren();
      $('courierHistoryEmpty').hidden = true;
    }
  }

  // ── A porta ──────────────────────────────────────────────────────────────
  function pedirCodigo(mensagem) {
    try { localStorage.removeItem(codeKey(service().currentToken())); } catch { /* modo privado */ }
    service().configure({ code: '' });
    erroNaPorta(mensagem || '');
    mostrar('porta');
    $('courierCodeInput')?.focus();
  }

  async function entrar(codigo) {
    service().configure({ code: codigo });
    const botao = $('courierGateSubmit');
    botao.disabled = true;
    try {
      const eu = await service().getMe();
      // `name` e `branch_name` são os dois campos required de CourierMeResponse.
      $('courierName').textContent = eu?.name || '';
      $('courierBranch').textContent = eu?.branch_name || '';
      try { localStorage.setItem(codeKey(service().currentToken()), codigo); } catch { /* modo privado */ }
      erroNaPorta('');
      mostrar('trabalho');
      await carregarPedidos();
      return true;
    } catch (error) {
      const tipo = service().classifyError(error);
      if (tipo === 'link-invalido') {
        fimDaLinha('Link inválido', 'Este link não vale mais. Peça um novo para o restaurante.');
        return false;
      }
      if (tipo === 'sem-rede') {
        erroNaPorta('Sem conexão. Tente de novo.');
        mostrar('porta');
        return false;
      }
      // Qualquer outra recusa é tratada como código errado: é o caso comum, e
      // errar para este lado só custa uma nova digitação.
      erroNaPorta('Código incorreto.');
      mostrar('porta');
      return false;
    } finally {
      botao.disabled = false;
    }
  }

  // ── Ligação dos eventos, por delegação e sem handler inline ──────────────
  function ligarEventos() {
    $('courierGateForm')?.addEventListener('submit', (event) => {
      event.preventDefault();
      const codigo = ($('courierCodeInput')?.value || '').trim();
      if (!codigo) return erroNaPorta('Digite o código.');
      entrar(codigo);
    });

    // Só dígitos, e sem passar de 6: o teclado numérico do celular ainda deixa
    // entrar outros caracteres em alguns aparelhos.
    $('courierCodeInput')?.addEventListener('input', (event) => {
      const limpo = event.target.value.replace(/\D+/g, '').slice(0, 6);
      if (limpo !== event.target.value) event.target.value = limpo;
    });

    $('courierReload')?.addEventListener('click', () => { aviso(''); carregarPedidos(); });
    $('courierLeaveBtn')?.addEventListener('click', sairParaEntrega);
    $('courierHistoryBtn')?.addEventListener('click', abrirAcerto);
    // Voltar do acerto RECARREGA a lista: o entregador pode ter ficado minutos
    // na outra tela, e voltar para uma lista congelada é o caminho curto para
    // um toque em "Entregue" que responde 409.
    $('courierHistoryBack')?.addEventListener('click', () => {
      mostrar('trabalho');
      carregarPedidos();
    });

    $('courierList')?.addEventListener('click', (event) => {
      const botao = event.target.closest('button[data-acao]');
      if (!botao) return;
      const card = botao.closest('.cr-card');
      const id = card?.dataset.orderId;
      if (!id) return;
      if (botao.dataset.acao === 'alternar') {
        if (selecionados.has(id)) selecionados.delete(id); else selecionados.add(id);
        desenhar();
        return;
      }
      if (botao.dataset.acao === 'entregue') marcarEntregue(id, botao);
    });
  }

  // ── Boot ─────────────────────────────────────────────────────────────────
  // O token vem de `?token=`, escrito pelo rewrite de /entregador/<token> na
  // vercel.json (e espelhado em dev pelo plugin vercelRewrites). O caminho é
  // lido como reserva para quem abrir a URL sem passar pelo rewrite.
  function tokenDaUrl() {
    const daQuery = new URLSearchParams(location.search).get('token');
    if (daQuery) return daQuery;
    const doCaminho = location.pathname.match(/^\/entregador\/([^/?#]+)/);
    return doCaminho ? decodeURIComponent(doCaminho[1]) : '';
  }

  async function boot() {
    ligarEventos();

    const token = tokenDaUrl();
    if (!token) {
      fimDaLinha('Link incompleto', 'Abra pelo link que o restaurante enviou.');
      return;
    }
    service().configure({ token });

    // `catch {}` sem reatribuir: em modo privado o getItem lança, e `salvo`
    // continua na string vazia com que nasceu. Reatribuir ali era escrita morta
    // e o lint a barrou.
    let salvo = '';
    try { salvo = localStorage.getItem(codeKey(token)) || ''; } catch { /* modo privado */ }

    if (!salvo) {
      mostrar('porta');
      $('courierCodeInput')?.focus();
      return;
    }
    // Com código guardado a porta nem aparece: o entregador abre o link e vê o
    // trabalho. Se o código tiver sido revogado, `entrar()` cai na porta com o
    // motivo escrito.
    const ok = await entrar(salvo);
    if (!ok) $('courierCodeInput')?.focus();
  }

  // Só define e publica. Quem CHAMA `boot()` é scripts/entry-courier.js, depois
  // de a ordem de carga estar completa — o corpo deste módulo não executa nada.
  // É a armadilha 1 da §2.1 da skill: um `onTeardown` no corpo de um módulo
  // rodava no import, antes das injeções existirem, e derrubou o app inteiro no
  // boot com lint, typecheck e unitários verdes.
  window.RapidexCourierPage = { boot };
})();
