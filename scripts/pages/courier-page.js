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

  // O `status` do contrato é string livre, e os valores são os do BACKEND
  // (`ORDER_STATUSES`, ../pedeaqui_back/src/core/constants.py:54). Este mapa
  // não decide nada — quem decide o que pode ser feito é
  // `can_leave`/`can_deliver`.
  //
  // A TABELA ESTAVA ERRADA DOS DOIS LADOS até 03/09/2026, que é a mesma forma
  // do `orderStatusLabel()` do app do cliente (skill §14.5):
  //
  //  - SOBRAVA `delivered`, que não existe em `ORDER_STATUSES`. O nome do
  //    contrato é `completed`, e é ele que o `COURIER_TRANSITIONS` produz
  //    (`out_for_delivery` -> `completed`). Chave fantasma: nenhuma resposta
  //    do backend jamais casou com ela. O mock do e2e respondia `delivered`
  //    no `/delivered`, então o dublê confirmava a leitura errada;
  //  - FALTAVAM `pending` e `accepted`, e os dois CHEGAM aqui: a atribuição
  //    só recusa status terminal (`admin_courier_service._assign_one`) e a
  //    lista só exclui os terminais (`courier_delivery_service.list_orders`).
  //    Um pedido atribuído antes de o restaurante aceitar aparecia sem chip.
  //
  // `completed` NÃO entra, e é medida, não esquecimento: ele é terminal, então
  // some da lista; e a resposta do `/delivered`, que o traz, é DESCARTADA por
  // `marcarEntregue()`, que recarrega em vez de desenhar o corpo. Pôr um
  // rótulo aqui seria repor um fantasma com outro nome. Quem guarda os dois
  // lados é `tests/unit/courier-status-labels.test.js`.
  const STATUS_EM_PORTUGUES = {
    pending: 'Aguardando o restaurante',
    accepted: 'Aceito',
    preparing: 'Em preparo',
    ready: 'Pronto',
    out_for_delivery: 'A caminho'
  };

  let pedidos = [];
  const selecionados = new Set();
  let carregando = false;
  // UM menu aberto por vez, e é o id do pedido — não um booleano. Dois menus
  // abertos num celular estreito se sobrepõem, e fechar "o menu" sem saber qual
  // era deixaria o `aria-expanded` do outro mentindo.
  let menuAberto = null;
  // Os cartões com os detalhes abertos. Sobrevive ao redesenho da lista de
  // propósito: o `carregarPedidos()` roda sozinho depois de cada ação, e um
  // painel que fechasse a cada volta da rede seria um painel que não abre.
  const detalhados = new Set();

  // ── Montagem de nós ──────────────────────────────────────────────────────
  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null && text !== '') node.textContent = String(text);
    return node;
  }

  // ── As telas, exclusivas ─────────────────────────────────────────────────
  //
  //  Três delas são ABAS (trabalho, acerto, ajustes) e duas não (a porta e o
  //  fim da linha). A barra de abas só existe nas três primeiras: não há para
  //  onde navegar sem código, e um link morto não tem seções.
  const ABAS = new Set(['trabalho', 'acerto', 'ajustes']);

  function mostrar(qual) {
    for (const [id, ativo] of [
      ['courierGate', qual === 'porta'],
      ['courierApp', qual === 'trabalho'],
      ['courierHistory', qual === 'acerto'],
      ['courierSettings', qual === 'ajustes'],
      ['courierDead', qual === 'fim']
    ]) {
      const node = $(id);
      if (node) node.hidden = !ativo;
    }
    // Trocar de tela fecha qualquer menu aberto. Sem isto o menu do pedido
    // sobreviveria por trás da tela nova e reapareceria na volta, aberto sobre
    // um cartão que a pessoa não estava mais olhando.
    menuAberto = null;
    const tabs = $('courierTabs');
    if (tabs) {
      const eAba = ABAS.has(qual);
      tabs.hidden = !eAba;
      if (eAba) {
        tabs.querySelectorAll('.cr-tabs__btn').forEach(botao => {
          const ativa = botao.dataset.aba === qual;
          // `aria-current` e não `aria-selected`: isto é navegação entre telas,
          // não um `tablist` ARIA — não há painéis irmãos com `role=tabpanel`, e
          // declarar a semântica errada é pior que não declarar nenhuma.
          if (ativa) botao.setAttribute('aria-current', 'page');
          else botao.removeAttribute('aria-current');
        });
      }
    }
    document.body.classList.remove('courier-booting');
  }

  /**
   * Trocar de aba.
   *
   * "Entregas" RECARREGA, e é de propósito: era o que `courierHistoryBack` já
   * fazia antes de existir barra de abas, pelo mesmo motivo — o entregador pode
   * ter ficado minutos na outra tela, e voltar para uma lista congelada é o
   * caminho curto para um toque em "Entregue" que responde 409.
   *
   * De brinde, isso dá um recarregar ao alcance do polegar sem inventar
   * controle nenhum: a aba fica embaixo, e o botão do topo continua lá para
   * quem já está na lista.
   */
  function irParaAba(aba) {
    if (aba === 'acerto') return abrirAcerto();
    if (aba === 'ajustes') {
      mostrar('ajustes');
      return;
    }
    mostrar('trabalho');
    carregarPedidos();
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

  /**
   * O PRAZO PROMETIDO AO CLIENTE — quanto falta, ou quanto passou.
   *
   * A conta é contra `delivery_due_at`, que é o TETO da janela: o instante da
   * promessa mais o `delivery_eta_max`. **A soma é do backend**, e isso não é
   * detalhe de arquitetura — `delivery_estimated_at` (o instante do checkout)
   * tem nome de "instante prometido" sem ser, e quem o lesse assim mostraria um
   * prazo vencido em TODO pedido. Aqui não se soma nada; lê-se o teto pronto.
   *
   * E nunca contra `created_at`: um pedido que ficou meia hora na cozinha não
   * está meia hora atrasado.
   *
   * NULO É O CASO COMUM, não a exceção — cerca de um terço dos pedidos
   * entregues não tem prazo gravado (pedido antigo, retirada, estimativa que
   * nunca existiu). Sem o campo não há chip: um "0 min" seria "chegou a hora"
   * para um pedido que nunca teve hora.
   *
   * O ARREDONDAMENTO NÃO LISONJEIA. Quanto falta desce (`floor`) e quanto
   * passou sobe (`ceil`): a tela nunca promete um minuto que não existe nem
   * esconde um minuto de atraso. `date-time` que não parseia vira nulo, em vez
   * de "NaN min" no cartão de quem está na rua.
   */
  function prazoDoPedido(pedido) {
    const bruto = pedido?.delivery_due_at;
    if (!bruto) return null;
    const limite = new Date(bruto).getTime();
    if (!Number.isFinite(limite)) return null;
    const restante = limite - Date.now();
    if (restante >= 0) {
      return { tom: 'ok', texto: `+${Math.floor(restante / 60000)} min` };
    }
    // U+2212 (menos), e não hífen: no tamanho do chip o hífen some.
    return { tom: 'late', texto: `−${Math.ceil(-restante / 60000)} min` };
  }

  /**
   * A janela prometida, em minutos, como o cliente a viu: "40 a 55 min".
   *
   * Os dois lados são `int | null` independentes. Com um só, a frase é o que
   * se sabe — inventar o outro lado seria prometer pelo backend.
   */
  function janelaPrometida(pedido) {
    const min = Number(pedido?.delivery_eta_min);
    const max = Number(pedido?.delivery_eta_max);
    const temMin = Number.isFinite(min);
    const temMax = Number.isFinite(max);
    if (temMin && temMax) return `${min} a ${max} min`;
    if (temMax) return `até ${max} min`;
    if (temMin) return `a partir de ${min} min`;
    return '';
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
    // O prazo fica no TOPO, ao lado do status: é a informação que decide a
    // ordem das entregas, e quem está com o celular na mão lê o topo do cartão.
    const prazo = prazoDoPedido(pedido);
    if (prazo) {
      topo.append(el('span', `cr-card__deadline cr-card__deadline--${prazo.tom}`, prazo.texto));
    }
    card.append(topo);

    card.append(el('div', 'cr-card__who', pedido.customer_name));

    const endereco = enderecoEmTexto(pedido);
    if (endereco) card.append(el('div', 'cr-card__addr', endereco));
    if (pedido.address_complement) card.append(el('div', 'cr-card__addr', pedido.address_complement));
    if (pedido.address_reference) card.append(el('div', 'cr-card__addr', `Referência: ${pedido.address_reference}`));

    // O DINHEIRO, E O ESTADO DELE EM COR.
    //
    // `is_paid` e `amount_to_collect` são independentes e os dois vêm prontos:
    // um pedido pode estar pago e não ter nada a receber. Nada aqui soma,
    // subtrai ou arredonda.
    //
    // O CHIP entrou em 03/09/2026 porque isto era texto cinza discreto ao lado
    // do valor, e cobrar duas vezes é o erro que sai do bolso do entregador. A
    // cor é de ESTADO, nunca de marca — esta tela não tem marca, e a folha
    // declara `--cr-paid`/`--cr-unpaid` separados da cor de ação.
    //
    // E o chip carrega A PALAVRA, não só a cor: no sol duas cores saturadas
    // viram a mesma mancha, e daltonismo é comum. A cor acelera a leitura; quem
    // informa é o texto.
    const aReceber = Number(pedido.amount_to_collect);
    const linhaPagamento = el('div', 'cr-card__pay');
    if (pedido.is_paid) {
      linhaPagamento.append(el('div', 'cr-card__paid', 'Nada a receber'));
      linhaPagamento.append(el('span', 'cr-card__chip cr-card__chip--paid', 'Pago'));
    } else if (Number.isFinite(aReceber) && aReceber > 0) {
      const metodo = pedido.payment_method ? ` (${pedido.payment_method})` : '';
      linhaPagamento.append(el('div', 'cr-card__money', `Receber ${fmt(aReceber)}${metodo}`));
      linhaPagamento.append(el('span', 'cr-card__chip cr-card__chip--unpaid', 'Não pago'));
    } else {
      // Não pago e sem valor a receber é dado contraditório do backend. A tela
      // diz o que sabe e não inventa um número: um valor chutado aqui vira
      // dinheiro cobrado a mais ou a menos na porta de alguém. O chip continua
      // sendo "Não pago", que é o fato de `is_paid: false` — o que falta é
      // QUANTO, e disso a frase ao lado cuida.
      linhaPagamento.append(el('div', 'cr-card__paid', 'Valor não confirmado — confira com o restaurante'));
      linhaPagamento.append(el('span', 'cr-card__chip cr-card__chip--unpaid', 'Não pago'));
    }
    card.append(linhaPagamento);

    if (pedido.notes) card.append(el('div', 'cr-card__notes', pedido.notes));

    // Os detalhes ficam montados e escondidos: abrir e fechar não redesenha o
    // cartão, e um redesenho fecharia o menu que acabou de ser tocado.
    const detalhes = painelDeDetalhes(pedido);
    detalhes.hidden = !detalhados.has(pedido.order_id);
    card.append(detalhes);

    const acoes = el('div', 'cr-card__acts');

    // O QUE FICA NO CARTÃO é a seleção para o lote. Ela não é uma ação sobre um
    // pedido — é o que alimenta a barra de baixo —, e escondê-la no menu
    // tornaria o fluxo principal um segredo. Quem manda é o backend:
    // `can_leave`/`can_deliver`, nunca o `status`.
    if (pedido.can_leave) {
      const escolher = el('button', 'cr-btn cr-btn--ghost',
        selecionados.has(pedido.order_id) ? 'Remover da saída' : 'Selecionar para sair');
      escolher.type = 'button';
      escolher.dataset.acao = 'alternar';
      acoes.append(escolher);
    }
    acoes.append(menuDoPedido(pedido));
    card.append(acoes);
    return card;
  }

  // ── O menu de ações do pedido ────────────────────────────────────────────
  //
  //  Elas eram quatro links e botões soltos disputando a mesma linha do cartão.
  //  Num celular estreito quebravam em duas fileiras e o cartão ficava mais
  //  alto que a informação dentro dele — cabiam dois pedidos na tela em vez de
  //  três, e a lista é o que essa pessoa passa o turno olhando.
  //
  //  O menu é montado por nó, como o resto: nome de cliente e endereço vêm da
  //  API e vão para a tela.
  const PONTINHOS = 'M12 6.2a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3zm0 7.3a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3zm0 7.3a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z';

  function itemDeMenu(texto, acao, classe) {
    const botao = el('button', classe ? `cr-pop--${classe}` : null, texto);
    botao.type = 'button';
    botao.dataset.acao = acao;
    return botao;
  }

  function menuDoPedido(pedido) {
    const caixa = el('div', 'cr-card__menu');

    const dots = el('button', 'cr-card__dots');
    dots.type = 'button';
    dots.dataset.acao = 'menu';
    dots.setAttribute('aria-haspopup', 'true');
    dots.setAttribute('aria-expanded', menuAberto === pedido.order_id ? 'true' : 'false');
    dots.setAttribute('aria-label', `Ações do pedido ${pedido.order_number}`);
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', PONTINHOS);
    path.setAttribute('fill', 'currentColor');
    svg.append(path);
    dots.append(svg);
    caixa.append(dots);

    const pop = el('div', 'cr-card__pop');
    pop.hidden = menuAberto !== pedido.order_id;

    // Confirmar entrega lidera, e só ela é colorida: as outras quatro são
    // caminhos, esta é a que fecha o pedido. Só aparece quando o BACKEND diz
    // que dá — `can_deliver`.
    if (pedido.can_deliver) pop.append(itemDeMenu('Confirmar entrega', 'entregue', 'go'));

    // Quem decide o que vira link é utils/contact-link.js — o mesmo dono do
    // app do cliente. O WhatsApp pode não existir com o `tel:` existindo: oito
    // dígitos discam na cidade, mas sem DDD um wa.me aponta para outra pessoa.
    const contato = window.PedeAquiContactLink;
    const telefone = telefoneDoCliente(pedido);
    const discar = contato.telHref(telefone);
    if (discar) {
      const ligar = el('a', null, 'Ligar para o cliente');
      ligar.href = discar;
      pop.append(ligar);

      const zapHref = contato.whatsAppHref(telefone);
      if (zapHref) {
        const zap = el('a', null, 'Chamar no WhatsApp');
        zap.href = zapHref;
        zap.target = '_blank';
        // O link sai desta janela, e a URL desta janela carrega o link_token,
        // que é credencial. `noreferrer` é o que impede o token de viajar no
        // Referer — a mesma razão do `<meta name="referrer">` da página.
        zap.rel = 'noopener noreferrer';
        pop.append(zap);
      }
    }

    if (enderecoEmTexto(pedido)) pop.append(itemDeMenu('Copiar endereço', 'copiar'));

    // O mapa CONTINUA, com o nome trocado. Ele já existia como "Rota" e apagar
    // função que funciona não é reorganizar — mas "rota" virou o nome de uma
    // frente de fase 2 (planejar a rota do turno), e dois significados para a
    // mesma palavra na mesma tela é como se promete o que não existe.
    const mapa = linkDeMapa(pedido);
    if (mapa) {
      const abrir = el('a', null, 'Abrir no mapa');
      abrir.href = mapa;
      abrir.target = '_blank';
      abrir.rel = 'noopener noreferrer';
      pop.append(abrir);
    }

    pop.append(itemDeMenu(
      detalhados.has(pedido.order_id) ? 'Ocultar detalhes' : 'Detalhes',
      'detalhes'
    ));

    caixa.append(pop);
    return caixa;
  }

  /**
   * O TELEFONE DO CLIENTE, quando o que chega é um telefone.
   *
   * `customer_phone` é required no contrato, e required não é "não vazio" nem
   * "é um número": uma string em branco viraria `tel:` sem número, um alvo que
   * promete e não cumpre. E há um valor pior que o vazio.
   *
   * Quando o cliente exclui a conta, o backend anonimiza os pedidos dele e
   * grava um SENTINELA em `customer_phone_snapshot` — `removido-<hex do id>` —,
   * que é de onde sai este campo (courier_delivery_service.py:364). O sentinela
   * é não numérico DE PROPÓSITO, e o comentário do backend diz por quê:
   * "qualquer coisa que trate este valor como telefone falha alto, em vez de
   * mandar um SMS para um numero inventado que pode ser de outra pessoa".
   *
   * Esta tela fazia o contrário: arrancava os dígitos do hex e montava um
   * `wa.me/55...` para o número de OUTRA PESSOA, sem um erro sequer. Falha alto
   * quer dizer, aqui, não oferecer o caminho: sem telefone o cartão continua
   * inteiro, com endereço, mapa e as ações do pedido.
   *
   * QUEM DECIDE é `utils/contact-link.js`, o mesmo dono do app do cliente — as
   * letras do sentinela separam os dígitos em cacos curtos demais para serem
   * telefone. O que fica aqui é a devolução do TEXTO, que é o que a tela mostra
   * no painel de detalhes; o número que vai no link sai de lá.
   */
  function telefoneDoCliente(pedido) {
    const valor = String(pedido?.customer_phone || '').trim();
    return window.PedeAquiContactLink.telHref(valor) ? valor : '';
  }

  /**
   * Os detalhes, no próprio cartão.
   *
   * SEM tela nova e SEM rota nova: tudo aqui já está em `CourierOrderResponse`.
   * Uma tela de detalhe pediria uma rota de detalhe do entregador, que não
   * existe — e inventar uma chamada para preencher tela é o caminho para o
   * front chamar rota que o contrato não tem.
   */
  function painelDeDetalhes(pedido) {
    const caixa = el('div', 'cr-card__detalhes');
    caixa.dataset.papel = 'detalhes';

    const linha = (rotulo, valor) => {
      if (valor === '' || valor === null || valor === undefined) return;
      const par = el('div', 'cr-card__det');
      par.append(el('dt', null, rotulo));
      par.append(el('dd', null, valor));
      caixa.append(par);
    };

    linha('Pedido', `#${pedido.order_number}`);
    linha('Cliente', pedido.customer_name);
    // Pelo mesmo filtro do menu: o sentinela da conta excluída não é telefone,
    // e escrevê-lo aqui seria o código do banco na tela do entregador. Linha
    // FORA, como parcela zerada na sacola.
    linha('Telefone', telefoneDoCliente(pedido));
    if (pedido.address_complement) linha('Complemento', pedido.address_complement);
    if (pedido.address_reference) linha('Referência', pedido.address_reference);
    // A janela que o CLIENTE viu no checkout. O chip do topo diz quanto falta;
    // esta linha diz o que foi prometido — é ela que explica o chip.
    linha('Prazo prometido', janelaPrometida(pedido));
    if (pedido.payment_method) linha('Forma de pagamento', pedido.payment_method);
    // O `total` DO PEDIDO NÃO ENTRA AQUI, e isso é decisão, não esquecimento.
    //
    // A primeira versão deste painel mostrava os dois lado a lado ("são números
    // diferentes num pedido pago online, mostrar só um deixa a pergunta sem
    // resposta"). O argumento é bom e perde para um mais caro: o único número
    // que o entregador cobra na porta é `amount_to_collect`, e o `total` é o
    // ÚNICO número desta tela sobre o qual ele não pode agir. Num pedido pago
    // online eles são 118,90 e 23,50 — e cobrar o de cima é exatamente o erro
    // que o chip Pago/Não pago entrou para evitar.
    //
    // Quem já guardava isso é `courier-screen.spec.js:213` ("o valor a receber
    // é o do backend"), que exige o total AUSENTE do cartão. O painel novo o
    // reintroduziu escondido e o teste reprovou — que é o teste fazendo o
    // trabalho dele. Se o dono quiser o total aqui, é inversão consciente: o
    // teste vira asserção do que continua valendo, não some (§14.8 da skill).
    //
    // `amount_to_collect` é `number` obrigatório e ZERO é linha FORA, nunca um
    // "R$ 0,00" solto — a mesma regra da sacola do cliente. Quem diz que não há
    // nada a receber é a linha "Nada a receber" com o chip "Pago" ao lado.
    const aCobrar = Number(pedido.amount_to_collect);
    if (Number.isFinite(aCobrar) && aCobrar > 0) linha('A receber na entrega', fmt(aCobrar));
    // `courier_fee` é `number | null`, e nulo NÃO é zero: é "esta corrida não
    // tem taxa registrada". É a mesma distinção da tela de acerto.
    linha('Sua taxa', pedido.courier_fee == null ? 'sem taxa registrada' : fmt(pedido.courier_fee));
    if (pedido.assigned_at) linha('Atribuído', quando(pedido.assigned_at));
    if (pedido.created_at) linha('Pedido feito', quando(pedido.created_at));

    return caixa;
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

  // ── Sair ─────────────────────────────────────────────────────────────────
  //
  //  NÃO é "sair da conta": não há conta. É "este aparelho esquece o código", e
  //  é por isso que a tela diz exatamente isso embaixo do botão. O link
  //  continua valendo — quem revoga link é o restaurante, pelo painel.
  //
  //  Ele reusa `pedirCodigo()`, que já apaga o guardado e limpa o código do
  //  serviço. Uma segunda implementação de "esquecer credencial" é a chance de
  //  uma delas esquecer metade.
  function sair() {
    // A lista e a seleção morrem junto: deixá-las em memória faria a tela
    // seguinte, de quem digitar outro código no mesmo aparelho, nascer com os
    // pedidos do turno anterior até a primeira resposta chegar.
    pedidos = [];
    selecionados.clear();
    detalhados.clear();
    aviso('');
    desenhar();
    pedirCodigo('');
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
    $('courierLogout')?.addEventListener('click', sair);

    $('courierTabs')?.addEventListener('click', (event) => {
      const botao = event.target.closest('.cr-tabs__btn');
      if (botao?.dataset.aba) irParaAba(botao.dataset.aba);
    });

    $('courierList')?.addEventListener('click', (event) => {
      const alvo = event.target.closest('button[data-acao]');
      // Um toque em qualquer outro lugar da lista FECHA o menu aberto. Sem
      // isto ele só fecharia pelo próprio botão, e num celular o gesto natural
      // para desistir é tocar fora.
      if (!alvo) {
        if (menuAberto) { menuAberto = null; desenhar(); }
        return;
      }
      const card = alvo.closest('.cr-card');
      const id = card?.dataset.orderId;
      if (!id) return;

      if (alvo.dataset.acao === 'menu') {
        menuAberto = menuAberto === id ? null : id;
        desenhar();
        return;
      }
      if (alvo.dataset.acao === 'alternar') {
        if (selecionados.has(id)) selecionados.delete(id); else selecionados.add(id);
        menuAberto = null;
        desenhar();
        return;
      }
      if (alvo.dataset.acao === 'detalhes') {
        if (detalhados.has(id)) detalhados.delete(id); else detalhados.add(id);
        menuAberto = null;
        desenhar();
        return;
      }
      if (alvo.dataset.acao === 'copiar') {
        menuAberto = null;
        copiarEndereco(id);
        return;
      }
      if (alvo.dataset.acao === 'entregue') {
        menuAberto = null;
        marcarEntregue(id, alvo);
      }
    });

    // Um menu aberto some ao tocar em QUALQUER outro lugar da página, e ao
    // apertar Esc. Os dois no `document`: o menu é `position:absolute` dentro
    // do cartão, mas o toque de desistência acontece fora da lista tanto quanto
    // dentro dela.
    document.addEventListener('click', (event) => {
      if (!menuAberto) return;
      if (event.target.closest('.cr-card__menu')) return;
      menuAberto = null;
      desenhar();
    });
    document.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape' || !menuAberto) return;
      menuAberto = null;
      desenhar();
    });
  }

  /**
   * Copiar o endereço.
   *
   * `navigator.clipboard` NÃO é garantido: ele exige contexto seguro e, em
   * alguns browsers, permissão — e esta tela roda no celular de alguém na rua,
   * onde falhar calado é pior que falhar. Por isso o `catch` avisa em vez de
   * engolir: quem tocou precisa saber se pode colar ou se vai colar o que
   * estava antes na área de transferência.
   */
  async function copiarEndereco(orderId) {
    const pedido = pedidos.find(item => item.order_id === orderId);
    const texto = pedido ? enderecoEmTexto(pedido) : '';
    if (!texto) return;
    desenhar();
    try {
      await navigator.clipboard.writeText(texto);
      aviso('Endereço copiado.');
    } catch {
      aviso('Não foi possível copiar. O endereço está no cartão.');
    }
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
