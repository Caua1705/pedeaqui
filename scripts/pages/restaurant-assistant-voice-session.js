/**
 * Modo voz — o transporte.
 *
 * A tela mora em restaurant-assistant-voice.js e não sabe nada disto. Este
 * arquivo é a outra metade: emite a credencial no nosso backend, abre o WebRTC
 * direto com a OpenAI, atende as buscas no cardápio e — a parte que importa —
 * desliga tudo.
 *
 * O ÁUDIO NÃO PASSA PELO NOSSO BACKEND. O navegador conversa direto com a
 * OpenAI. O backend faz três coisas: emite a credencial efêmera, responde à
 * busca no cardápio quando o modelo pede, e mantém o registro da sessão para
 * cobrança e corte.
 *
 * DOIS SEGREDOS, DOIS DESTINOS. `credencial.value` é o Bearer da chamada à
 * OpenAI e NUNCA volta para o nosso backend; o token do cliente é o Bearer da
 * emissão e NUNCA vai para a OpenAI. Trocar os dois de lugar vaza a sessão do
 * cliente para fora, ou a nossa chave para dentro do log deles.
 *
 * ISTO CUSTA DINHEIRO. A sessão é faturada por minuto enquanto o microfone
 * estiver aberto, mesmo em silêncio. Por isso os três fechamentos automáticos
 * (teto de duração, inatividade, aba/janela fora de vista), o caminho único de
 * encerramento e o `getTracks().forEach(t => t.stop())` que vive dentro dele.
 * Nenhum desses é opcional, e nenhum deles pode ganhar uma segunda porta.
 *
 * OS LIMITES VÊM DO SERVIDOR. duracao_maxima_s, inatividade_s e aviso_antes_s
 * chegam no corpo da emissão e podem mudar sem deploy do app. Nada aqui os
 * chuta, e nada aqui os guarda entre sessões.
 */
(function () {
  'use strict';

  const OPENAI_CALLS_URL = 'https://api.openai.com/v1/realtime/calls';
  const CANAL = 'oai-events';
  // Única ferramenta declarada pelo backend na configuração da sessão.
  const FERRAMENTA = 'buscar_no_cardapio';
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const CONSULTA_MAX = 500;
  const MOTIVO_MAX = 200;
  const AVISO_DE_INATIVIDADE =
    'Diga exatamente isto, em uma frase e nada mais: vou encerrar por inatividade.';

  /* ── Estado da sessão ──
     Tudo aqui nasce e morre com uma conversa. `encerrado` começa true porque não
     há sessão: é ele que torna stop() idempotente. */
  let tela = null;
  let sessao = null;          // { id, limites, restauranteId }
  let conexao = null;
  let canal = null;
  let microfone = null;
  let encerrado = true;
  let montando = false;

  // Uma resposta em curso por vez (7.1 do contrato).
  let respostaAtiva = false;
  let fila = [];
  let pedidoEmVoo = null;

  // Idempotência por call_id (7.2).
  const atendidas = new Set();

  // Temporizadores e ouvintes de saída.
  let tetoTimer = null;
  let inatividadeTimer = null;
  let avisoTimer = null;
  let ouvintes = null;

  // Uso de tokens acumulado na sessão, e quando o áudio abriu.
  let uso = null;
  let audioAbertoEm = 0;

  // Medidor de nível para a esfera.
  let audioCtx = null;
  let entrada = null;
  let saida = null;
  let quadro = null;
  let nivelSuave = 0;

  const cliente = () => window.PedeAquiApiClient;
  const rotas = () => window.PedeAquiApiRoutes;

  /* ══════════════════════════════════════════════════════════════
     Mensagens de falha
     ══════════════════════════════════════════════════════════════ */

  /**
   * O backend devolve os textos sem acento ("Voce ja usou 5 conversas...") e sem
   * campo de código: os três 429 diferentes só se distinguem pelo `detail`.
   * Reescrevo apenas os casos conhecidos, PRESERVANDO o número que vem dentro da
   * frase — ele é a informação, e o app não tem como recalculá-lo. Qualquer
   * texto que eu não reconheça vai para a tela como veio: melhor um acento
   * faltando do que uma mensagem inventada.
   */
  const CONHECIDAS = [
    {
      padrao: /conversas por voz nas ultimas 24 horas/i,
      texto: detalhe => {
        const quantas = (detalhe.match(/\d+/) || [])[0];
        return `Você já usou ${quantas || 'todas as'} conversas por voz nas últimas 24 horas. Tente de novo mais tarde.`;
      }
    },
    {
      padrao: /atingiu o limite do dia/i,
      texto: () => 'O atendimento por voz deste restaurante atingiu o limite de hoje. Tente amanhã.'
    },
    {
      padrao: /nao esta disponivel neste restaurante/i,
      texto: () => 'Este restaurante ainda não atende por voz.'
    },
    {
      padrao: /muitas requisi/i,
      texto: () => 'Foram muitas tentativas seguidas. Espere alguns instantes e tente de novo.'
    },
    {
      padrao: /conta inativa/i,
      texto: () => 'Sua conta está desativada. Fale com o suporte para reativá-la.'
    }
  ];

  function mensagemDaEmissao(erro) {
    const status = Number(erro?.status);
    const detalhe = String(erro?.message || '').trim();

    for (const { padrao, texto } of CONHECIDAS) {
      if (padrao.test(detalhe)) return texto(detalhe);
    }

    if (status === 401) return 'Sua sessão expirou. Entre de novo para conversar por voz.';
    if (status === 404) {
      // Dois 404 diferentes: o restaurante não existe, ou a rota inteira não
      // existe — que é como a plataforma diz que a voz está desligada.
      return /restaurante/i.test(detalhe)
        ? 'Não encontrei este restaurante.'
        : 'O atendimento por voz não está disponível no momento.';
    }
    if (status === 502 || status === 503) {
      return 'Não consegui falar com o serviço de voz agora. Tente de novo em instantes.';
    }
    if (erro?.isTimeout || erro?.isNetworkError) {
      return 'A conexão falhou ao abrir a conversa. Verifique sua internet e tente de novo.';
    }
    return detalhe || 'Não consegui abrir o atendimento por voz agora.';
  }

  function mensagemDoMicrofone(erro) {
    const nome = erro?.name || '';
    if (nome === 'NotAllowedError' || nome === 'PermissionDeniedError' || nome === 'SecurityError') {
      return 'Preciso do microfone para conversar. Autorize o acesso no navegador e tente de novo.';
    }
    if (nome === 'NotFoundError' || nome === 'DevicesNotFoundError') {
      return 'Não encontrei um microfone neste aparelho.';
    }
    if (nome === 'NotReadableError' || nome === 'TrackStartError') {
      return 'O microfone está sendo usado por outro aplicativo. Feche-o e tente de novo.';
    }
    return 'Não consegui abrir o microfone. Tente de novo.';
  }

  /* ══════════════════════════════════════════════════════════════
     Medição de uso

     SÓ MEDIÇÃO. Nada nesta seção muda o rumo da conversa: ela lê o `usage` que
     vem de carona em cada `response.done`, soma, e o total sai UMA vez, no corpo
     do /ended. Uma leitura que estoure não pode derrubar o tratamento do evento
     — é por isso que acumularUso() engole o próprio erro.

     AUSENTE ≠ ZERO. Cada contador nasce `null` e só vira número quando a OpenAI
     manda o primeiro valor daquele campo. Preencher com 0 o que não veio diria
     "houve zero token de áudio", que é uma afirmação — e errada. Campo que
     ninguém reportou simplesmente não entra no corpo.
     ══════════════════════════════════════════════════════════════ */

  function zerarUso() {
    uso = {
      input_audio_tokens: null,
      input_text_tokens: null,
      output_audio_tokens: null,
      output_text_tokens: null,
      cached_tokens: null
    };
    audioAbertoEm = 0;
  }
  zerarUso();

  function somarUso(campo, valor) {
    const numero = Number(valor);
    if (!Number.isFinite(numero)) return;
    // Inteiros, e nunca negativos: o campo é contagem.
    uso[campo] = (uso[campo] ?? 0) + Math.max(0, Math.round(numero));
  }

  function acumularUso(resposta) {
    try {
      const usage = resposta?.usage;
      if (!usage) return;
      const entrada = usage.input_token_details || {};
      const emitidos = usage.output_token_details || {};
      somarUso('input_audio_tokens', entrada.audio_tokens);
      somarUso('input_text_tokens', entrada.text_tokens);
      // Subconjunto da ENTRADA: vai separado, sem somar em nada e sem descontar
      // de nada. Quem decide o que fazer com ele é a cobrança, não o app.
      somarUso('cached_tokens', entrada.cached_tokens);
      somarUso('output_audio_tokens', emitidos.audio_tokens);
      somarUso('output_text_tokens', emitidos.text_tokens);
    } catch (erro) {
      console.warn('[Voz] Não consegui ler o uso de tokens desta resposta:', erro);
    }
  }

  /**
   * O corpo do /ended: `motivo` obrigatório, e os contadores no MESMO nível,
   * todos opcionais. `duration_seconds` conta da abertura do áudio (o mesmo
   * instante em que o teto de duração começa a correr) até aqui.
   */
  function corpoDoFim(motivo) {
    const corpo = {
      motivo: String(motivo || 'encerrado sem motivo declarado').slice(0, MOTIVO_MAX)
    };
    for (const [campo, valor] of Object.entries(uso || {})) {
      if (valor !== null) corpo[campo] = valor;
    }
    if (audioAbertoEm) {
      corpo.duration_seconds = Math.max(0, Math.round((Date.now() - audioAbertoEm) / 1000));
    }
    return corpo;
  }

  /* ══════════════════════════════════════════════════════════════
     Transcrição — SÓ console

     Espelha a bancada do backend: dá para acompanhar a conversa de olho
     enquanto ela acontece.

     NADA DAQUI SAI DA MÁQUINA. Não vai para o nosso backend, não entra no corpo
     do /ended, não é gravado e não aparece na tela — é console.log e mais nada.
     A fala do cliente é o dado mais sensível que este app toca, então o caminho
     dela termina aqui.

     As transcrições chegam de carona em eventos que o canal já entrega; nenhum
     evento é PEDIDO por causa delas, e nenhuma linha desta seção decide nada.

     E SÓ EM DESENVOLVIMENTO. No domínio publicado a fala do cliente não aparece
     em console nenhum — nem no dele, nem numa sessão de suporte por
     compartilhamento de tela.
     ══════════════════════════════════════════════════════════════ */

  // Duas condições, porque "desenvolvimento" tem duas caras: `import.meta.env.DEV`
  // pega o servidor de desenvolvimento, e o host local pega o `vite preview` e o
  // e2e, que rodam o bundle de produção na sua máquina. Nenhuma das duas é
  // verdade no domínio publicado, que é o que importa aqui.
  const DEV = (() => {
    try {
      if (import.meta.env && import.meta.env.DEV) return true;
    } catch {
      // Fora do bundler (um <script> solto): decide só o host.
    }
    return /^(localhost|127\.0\.0\.1|\[::1\])$/.test(window.location.hostname);
  })();

  const VOZES = {
    cliente: { etiqueta: 'cliente', cor: '#1d4ed8' },
    assistente: { etiqueta: 'assistente', cor: '#b4490a' },
    busca: { etiqueta: 'busca', cor: '#15803d' }
  };

  // Etiqueta colorida para distinguir de olho quem falou, sem precisar ler o
  // texto. O prefixo continua sendo "voz ·" para dar um filtro fácil no console.
  function transcrever(quem, ...partes) {
    if (!DEV) return;
    const voz = VOZES[quem];
    console.log(
      `%c voz · ${voz.etiqueta} `,
      `background:${voz.cor};color:#fff;border-radius:3px;font-weight:600`,
      ...partes
    );
  }

  function textoDaTranscricao(valor) {
    return String(valor ?? '').trim() || null;
  }

  /* ══════════════════════════════════════════════════════════════
     As quatro rotas do backend
     ══════════════════════════════════════════════════════════════ */

  function emitirCredencial(restauranteId) {
    return cliente().request(rotas().voiceSession(), {
      method: 'POST',
      body: JSON.stringify({ restaurant_id: restauranteId }),
      // A ÚNICA rota /voice que leva o token do cliente.
      headers: window.PedeAquiCustomerAuth.authHeaders(),
      // A emissão passa pela OpenAI antes de responder: os 8s padrão do cliente
      // cortariam uma emissão perfeitamente normal.
      timeout: 20000
    });
  }

  /**
   * Passo 4. Best-effort do ponto de vista da conversa: se falhar, o áudio
   * continua funcionando. O que se perde é a capacidade de o servidor desligar
   * esta sessão remotamente — e aí o teto de duração daqui vira a única proteção
   * contra uma sessão esquecida. Por isso o fracasso vira log, não exceção.
   */
  async function reportarConectado(sessaoId, callId) {
    try {
      const resposta = await cliente().request(rotas().voiceSessionConnected(sessaoId), {
        method: 'POST',
        body: JSON.stringify({ call_id: callId })
      });
      // `registrado: false` vem com HTTP 200. Testar o status não acusaria nada.
      if (resposta?.registrado !== true) {
        console.warn('[Voz] O backend não reconheceu a sessão ao registrar o call_id.', resposta);
      }
    } catch (erro) {
      console.warn('[Voz] Não consegui registrar o call_id. A conversa segue.', erro);
    }
  }

  /**
   * Passo 7. Sai com keepalive para sobreviver à aba sendo fechada no mesmo
   * instante, e NÃO é aguardado: parar o microfone vem primeiro, sempre.
   * `timeout: 0` desliga o AbortController do cliente — um abort agendado numa
   * página que está morrendo cancelaria justamente o aviso que precisa sair.
   *
   * O corpo cresceu com os contadores, mas continua com poucas centenas de
   * bytes: bem abaixo do teto de 64 kB que os navegadores impõem a um corpo com
   * keepalive, que é o que faria a entrega ser recusada em silêncio.
   */
  function reportarFim(sessaoId, corpo) {
    if (!sessaoId) return;
    try {
      cliente().request(rotas().voiceSessionEnded(sessaoId), {
        method: 'POST',
        body: JSON.stringify(corpo),
        keepalive: true,
        timeout: 0
      }).then(resposta => {
        if (resposta?.encerrado !== true) {
          console.warn('[Voz] O backend não encerrou a sessão (já encerrada ou inexistente).', resposta);
        }
      }).catch(erro => console.warn('[Voz] Falha ao avisar o fim da sessão:', erro));
    } catch (erro) {
      console.warn('[Voz] Falha ao avisar o fim da sessão:', erro);
    }
  }

  function buscarNoCardapio(consulta, precoMaximo) {
    return cliente().request(rotas().voiceSearch(), {
      method: 'POST',
      body: JSON.stringify({
        restaurant_id: sessao?.restauranteId,
        consulta,
        preco_maximo: precoMaximo
      }),
      timeout: 12000
    });
  }

  /* ══════════════════════════════════════════════════════════════
     Canal de dados: fila de resposta ativa e tool call
     ══════════════════════════════════════════════════════════════ */

  /**
   * Descarta em canal fechado. Não é defensivo à toa: a busca no cardápio é
   * assíncrona e pode voltar DEPOIS do encerramento — mandar aí dentro estoura
   * num canal morto.
   */
  function enviar(mensagem) {
    if (canal?.readyState !== 'open') return false;
    try {
      canal.send(JSON.stringify(mensagem));
      return true;
    } catch (erro) {
      console.error('[Voz] Falha ao enviar pelo canal:', erro);
      return false;
    }
  }

  /**
   * A OpenAI aceita UMA resposta em curso por vez; pedir outra antes de a atual
   * fechar devolve `conversation_already_has_active_response`. Então todo pedido
   * passa por aqui: se há resposta ativa, ele espera na fila e sai no
   * `response.done`.
   *
   * `descartavel` é para o pedido que não faz falta se perder a vez — hoje só a
   * saudação de abertura. Sem isso, uma saudação que chegasse atrasada seria
   * dita depois da primeira frase do cliente.
   */
  function pedirResposta(response = null, descartavel = false) {
    if (respostaAtiva) {
      if (!descartavel) fila.push({ response, descartavel });
      return;
    }
    respostaAtiva = true;
    pedidoEmVoo = { response, descartavel };
    const saiu = enviar(response ? { type: 'response.create', response } : { type: 'response.create' });
    if (!saiu) {
      // O canal não estava aberto: desfazer, ou a sessão fica presa achando que
      // há uma resposta em curso que nunca vai fechar.
      respostaAtiva = false;
      pedidoEmVoo = null;
    }
  }

  function escoarFila() {
    if (!fila.length) return;
    const proximo = fila.shift();
    pedirResposta(proximo.response, proximo.descartavel);
  }

  /**
   * A mesma chamada chega por DOIS eventos, com o mesmo call_id e a menos de 1 ms
   * de distância. Os dois são tratados (a API já renomeou esses eventos antes) e
   * a deduplicação marca o id de forma SÍNCRONA, antes de qualquer await — entre
   * um await e o próximo o segundo evento já chegou.
   */
  function receberToolCall(callId, nome, argumentos) {
    if (!callId || atendidas.has(callId)) return;
    atendidas.add(callId);
    if (nome && nome !== FERRAMENTA) {
      console.warn('[Voz] Ferramenta desconhecida pedida pelo modelo:', nome);
      responderToolCall(callId, 'Essa busca não está disponível.');
      return;
    }
    executarBusca(callId, argumentos);
  }

  async function executarBusca(callId, argumentos) {
    // `arguments` é uma STRING JSON, não um objeto.
    let dados = {};
    try {
      dados = JSON.parse(argumentos || '{}') || {};
    } catch (erro) {
      console.error('[Voz] Argumentos da ferramenta não são JSON:', argumentos, erro);
    }

    const consulta = String(dados.consulta || '').trim().slice(0, CONSULTA_MAX);
    const preco = Number(dados.preco_maximo);
    // O contrato aceita null ou um número maior que zero — nada mais.
    const precoMaximo = Number.isFinite(preco) && preco > 0 ? preco : null;

    if (!consulta) {
      transcrever('busca', '→', '(o modelo pediu uma busca sem consulta)');
      responderToolCall(callId, 'A busca falhou.');
      return;
    }

    transcrever('busca', '→', precoMaximo === null
      ? consulta
      : `${consulta} (até R$ ${precoMaximo})`);

    try {
      const resultado = await buscarNoCardapio(consulta, precoMaximo);
      if (encerrado) return;
      // Os cartões saem de `produtos`, do banco. O `resumo` é o que volta para o
      // modelo. São as duas metades da mesma leitura, e é essa separação que
      // impede o assistente de falar um preço e a tela mostrar outro.
      const resumo = String(resultado?.resumo ?? 'Nenhum produto encontrado.');
      tela?.showProducts(resultado?.produtos || []);
      transcrever('busca', '←', resumo);
      responderToolCall(callId, resumo);
    } catch (erro) {
      console.error('[Voz] A busca no cardápio falhou:', erro);
      transcrever('busca', '←', '(a busca falhou)');
      // Nunca deixar a chamada sem resposta: o modelo trava esperando, calado.
      responderToolCall(callId, 'A busca falhou.');
    }
  }

  function responderToolCall(callId, saida) {
    // O item pode ir na hora; só o response.create respeita a fila.
    enviar({
      type: 'conversation.item.create',
      item: { type: 'function_call_output', call_id: callId, output: saida }
    });
    pedirResposta();
  }

  function aoReceberMensagem(evento) {
    let dados;
    try {
      dados = JSON.parse(evento.data);
    } catch {
      return;
    }

    switch (dados?.type) {
      case 'response.created':
        respostaAtiva = true;
        pedidoEmVoo = null;
        tela?.setState('speaking');
        break;

      case 'response.done':
        // A medição vem antes só porque este é o evento que a carrega; ela não
        // decide nada do que vem abaixo.
        acumularUso(dados.response);
        respostaAtiva = false;
        pedidoEmVoo = null;
        tela?.setState('listening');
        escoarFila();
        break;

      // O contador de inatividade zera aqui, e SÓ aqui: o assistente falando não
      // é sinal de que ainda tem alguém do outro lado.
      case 'input_audio_buffer.speech_started':
        reiniciarInatividade();
        break;

      // As duas transcrições. Elas NÃO movem estado: não zeram temporizador, não
      // abrem nem fecham resposta e não vão para lugar nenhum além do console.
      // A de entrada em particular não pode zerar a inatividade — ela chega
      // depois da fala, e quem marca "tem gente aí" é o speech_started acima.
      case 'conversation.item.input_audio_transcription.completed': {
        const dito = textoDaTranscricao(dados.transcript);
        if (dito) transcrever('cliente', dito);
        break;
      }

      case 'response.output_audio_transcript.done': {
        const respondido = textoDaTranscricao(dados.transcript);
        if (respondido) transcrever('assistente', respondido);
        break;
      }

      case 'response.function_call_arguments.done':
        receberToolCall(dados.call_id, dados.name, dados.arguments);
        break;

      case 'response.output_item.done':
        if (dados?.item?.type === 'function_call') {
          receberToolCall(dados.item.call_id, dados.item.name, dados.item.arguments);
        }
        break;

      case 'error':
        tratarErroDaApi(dados.error);
        break;

      default:
        break;
    }
  }

  function tratarErroDaApi(erro) {
    const codigo = erro?.code || '';
    console.error('[Voz] Erro da API de tempo real:', codigo, erro?.message || '');
    // Este erro NÃO derruba a sessão: significa só que o pedido chegou cedo
    // demais. Marca que há resposta ativa e devolve o pedido para a fila.
    if (codigo === 'conversation_already_has_active_response') {
      respostaAtiva = true;
      const perdido = pedidoEmVoo;
      pedidoEmVoo = null;
      if (perdido && !perdido.descartavel) fila.push(perdido);
    }
  }

  /* ══════════════════════════════════════════════════════════════
     Temporizadores e fechamentos automáticos
     ══════════════════════════════════════════════════════════════ */

  function ligarTemporizadores() {
    const limites = sessao?.limites || {};
    const teto = Number(limites.duracao_maxima_s);
    if (Number.isFinite(teto) && teto > 0) {
      tetoTimer = setTimeout(
        () => tela?.end(`teto de ${Math.round(teto)}s atingido`), teto * 1000);
    }
    reiniciarInatividade();

    // Só AGORA, e não durante a montagem: em vários navegadores o diálogo de
    // permissão do microfone tira o foco da janela, e um ouvinte de blur ligado
    // antes disso mataria a sessão antes de ela nascer.
    ouvintes = new AbortController();
    const signal = ouvintes.signal;
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) tela?.end('a aba saiu de vista');
    }, { signal });
    window.addEventListener('blur', () => tela?.end('a janela perdeu o foco'), { signal });
    // A aba sendo fechada com a conversa aberta: é para isto que o /ended leva
    // keepalive.
    window.addEventListener('pagehide', () => tela?.end('a página foi fechada'), { signal });
  }

  function reiniciarInatividade() {
    clearTimeout(avisoTimer);
    clearTimeout(inatividadeTimer);
    avisoTimer = null;
    inatividadeTimer = null;
    if (encerrado) return;

    const limites = sessao?.limites || {};
    const corte = Number(limites.inatividade_s);
    if (!Number.isFinite(corte) || corte <= 0) return;

    const antes = Number(limites.aviso_antes_s);
    if (Number.isFinite(antes) && antes > 0 && antes < corte) {
      // O aviso é FALADO, não escrito: quem está de olho na tela não é o
      // público desta tela.
      avisoTimer = setTimeout(() => {
        avisoTimer = null;
        pedirResposta({ instructions: AVISO_DE_INATIVIDADE });
      }, (corte - antes) * 1000);
    }
    inatividadeTimer = setTimeout(
      () => tela?.end(`silencio por ${Math.round(corte)}s`), corte * 1000);
  }

  function pararTemporizadores() {
    clearTimeout(tetoTimer);
    clearTimeout(avisoTimer);
    clearTimeout(inatividadeTimer);
    tetoTimer = avisoTimer = inatividadeTimer = null;
    ouvintes?.abort();
    ouvintes = null;
  }

  /* ══════════════════════════════════════════════════════════════
     Medidor de nível — é ele que faz a esfera reagir
     ══════════════════════════════════════════════════════════════ */

  function criarAnalisador(stream) {
    const origem = audioCtx.createMediaStreamSource(stream);
    const no = audioCtx.createAnalyser();
    no.fftSize = 512;
    no.smoothingTimeConstant = 0.6;
    origem.connect(no);
    return { no, amostras: new Uint8Array(no.fftSize) };
  }

  function nivelDe(analisador) {
    if (!analisador) return 0;
    analisador.no.getByteTimeDomainData(analisador.amostras);
    let soma = 0;
    for (const amostra of analisador.amostras) {
      const desvio = (amostra - 128) / 128;
      soma += desvio * desvio;
    }
    // Fala normal fica muito abaixo de 1 em RMS; sem o ganho a esfera mal se
    // mexeria.
    return Math.min(1, Math.sqrt(soma / analisador.amostras.length) * 4.2);
  }

  function ligarMedidor() {
    try {
      const Contexto = window.AudioContext || window.webkitAudioContext;
      if (!Contexto || !microfone) return;
      audioCtx = new Contexto();
      // O contexto nasce suspenso até um gesto do usuário — e houve um: o toque
      // que abriu esta tela.
      audioCtx.resume?.().catch(() => {});
      entrada = criarAnalisador(microfone);
      medir();
    } catch (erro) {
      console.warn('[Voz] Sem medidor de nível; a esfera fica só respirando.', erro);
    }
  }

  function medir() {
    quadro = requestAnimationFrame(medir);
    const falando = tela?.state() === 'speaking';
    const alvo = falando
      ? nivelDe(saida)
      : (tela?.isMuted() ? 0 : nivelDe(entrada));
    // Sobe rápido e desce devagar: é assim que o movimento acompanha a sílaba em
    // vez de tremer junto com o ruído de fundo.
    nivelSuave += (alvo - nivelSuave) * (alvo > nivelSuave ? 0.5 : 0.14);
    tela?.setLevel(nivelSuave);
  }

  function pararMedidor() {
    if (quadro) cancelAnimationFrame(quadro);
    quadro = null;
    entrada = null;
    saida = null;
    nivelSuave = 0;
    try {
      audioCtx?.close();
    } catch (erro) {
      console.warn('[Voz] Falha ao fechar o contexto de áudio:', erro);
    }
    audioCtx = null;
  }

  /* ══════════════════════════════════════════════════════════════
     Abertura
     ══════════════════════════════════════════════════════════════ */

  async function permissaoDoMicrofone() {
    try {
      const status = await navigator.permissions?.query({ name: 'microphone' });
      return status?.state || 'prompt';
    } catch {
      // Firefox lança para 'microphone'. Sem resposta, seguimos o caminho normal.
      return 'prompt';
    }
  }

  function pedirMicrofone() {
    if (!navigator.mediaDevices?.getUserMedia) {
      const erro = new Error('getUserMedia indisponível');
      erro.name = 'SecurityError';
      return Promise.reject(erro);
    }
    return navigator.mediaDevices.getUserMedia({ audio: true });
  }

  /**
   * Passos 3 e 5: a oferta vai para a OpenAI, a resposta volta como SDP e o
   * call_id sai do cabeçalho Location.
   */
  async function abrirConexao(credencial) {
    conexao = new RTCPeerConnection();

    const elemento = tela?.audioElement();
    conexao.ontrack = evento => {
      const stream = evento.streams[0];
      if (elemento) elemento.srcObject = stream;
      // A voz do assistente também move a esfera; sem este analisador ela ficaria
      // parada justamente enquanto ele fala.
      try {
        if (audioCtx && stream) saida = criarAnalisador(stream);
      } catch (erro) {
        console.warn('[Voz] Sem medidor na saída de áudio:', erro);
      }
    };

    for (const faixa of microfone.getTracks()) conexao.addTrack(faixa, microfone);

    canal = conexao.createDataChannel(CANAL);
    canal.addEventListener('message', aoReceberMensagem);
    canal.addEventListener('open', () => {
      // O assistente fala primeiro. Descartável: se ele já tiver começado por
      // conta própria, esta saudação perde a vez em vez de virar uma segunda.
      pedirResposta(null, true);
    });

    const oferta = await conexao.createOffer();
    await conexao.setLocalDescription(oferta);

    const resposta = await fetch(OPENAI_CALLS_URL, {
      method: 'POST',
      body: oferta.sdp,
      headers: {
        // O segredo efêmero, e SÓ ele. O token do cliente não passa por aqui.
        Authorization: `Bearer ${credencial.value}`,
        'Content-Type': 'application/sdp'
      }
    });

    if (!resposta.ok) {
      const corpo = await resposta.text().catch(() => '');
      const erro = new Error(`A OpenAI recusou a conexão (${resposta.status}). ${corpo}`.trim());
      erro.status = resposta.status;
      erro.naOpenAI = true;
      throw erro;
    }

    const sdp = await resposta.text();
    // O Location é cabeçalho de outra origem: o navegador só o entrega se a
    // OpenAI o listar em Access-Control-Expose-Headers. Quando não vier, a
    // sessão funciona igual — o que se perde é o desligamento remoto pelo
    // servidor, e aí o teto de duração daqui vira a única proteção.
    const local = resposta.headers.get('Location');
    const callId = local ? local.split('/').filter(Boolean).pop() : null;

    return { sdp, callId };
  }

  function idDoRestaurante() {
    const bruto = String(window.RapidexAssistantChat?.restaurantId?.() || '').trim();
    return UUID.test(bruto) ? bruto : '';
  }

  async function start(api) {
    tela = api;
    if (montando || !encerrado) return;
    montando = true;
    encerrado = false;
    respostaAtiva = false;
    fila = [];
    pedidoEmVoo = null;
    atendidas.clear();
    nivelSuave = 0;
    sessao = null;
    // Contadores nunca atravessam sessões: cada conversa reporta só a si.
    zerarUso();

    try {
      const restauranteId = idDoRestaurante();
      if (!restauranteId) {
        throw Object.assign(new Error('Este restaurante ainda não está pronto para o modo voz.'),
          { semEmissao: true });
      }

      // Antes de gastar uma emissão: se o microfone JÁ está negado, o pedido
      // falharia depois de a cota do dia ter sido consumida. A cota é de cinco
      // conversas por cliente em 24h — não dá para queimar uma num diálogo que
      // a pessoa já recusou. Nos outros estados seguimos a ordem do contrato.
      if (await permissaoDoMicrofone() === 'denied') {
        throw Object.assign(new Error('microfone negado'),
          { name: 'NotAllowedError', semEmissao: true, doMicrofone: true });
      }

      const emissao = await emitirCredencial(restauranteId);
      if (encerrado) return;
      sessao = {
        id: emissao?.sessao_id || '',
        limites: emissao?.limites || {},
        restauranteId
      };

      microfone = await pedirMicrofone().catch(erro => {
        throw Object.assign(erro, { doMicrofone: true });
      });
      // O cliente pode ter desistido enquanto o navegador perguntava.
      if (encerrado) {
        microfone.getTracks().forEach(faixa => faixa.stop());
        microfone = null;
        return;
      }

      const { sdp, callId } = await abrirConexao(emissao.credencial);
      if (encerrado) return;

      // Passo 4 ANTES do passo 5, como no contrato — e sem await: é best-effort
      // e não pode atrasar o início da conversa.
      if (callId) reportarConectado(sessao.id, callId);
      else console.warn('[Voz] A OpenAI não expôs o cabeçalho Location: sessão sem call_id.');

      await conexao.setRemoteDescription({ type: 'answer', sdp });
      if (encerrado) return;

      // Passo 5: a conversa começou. Só agora os temporizadores.
      // O relógio da duração parte daqui — o mesmo instante em que o teto começa
      // a correr, para os dois números falarem da mesma coisa.
      audioAbertoEm = Date.now();
      ligarMedidor();
      ligarTemporizadores();
      tela?.setState('listening');
    } catch (erro) {
      console.error('[Voz] Não consegui abrir a conversa:', erro);
      const motivo = erro?.doMicrofone ? 'o microfone não foi liberado' : 'a conversa não pôde comecar';
      // Desmonta o que já existir e avisa o backend se a sessão chegou a ser
      // emitida — uma sessão aberta no servidor e morta no cliente continua
      // contando.
      stop(motivo);
      tela?.fail(erro?.doMicrofone ? mensagemDoMicrofone(erro) : mensagemDaEmissao(erro));
    } finally {
      montando = false;
    }
  }

  /* ══════════════════════════════════════════════════════════════
     Encerramento — a outra ponta do caminho único
     ══════════════════════════════════════════════════════════════ */

  function fecharCanal() {
    if (!canal) return;
    try {
      canal.removeEventListener('message', aoReceberMensagem);
      canal.close();
    } catch (erro) {
      console.warn('[Voz] Falha ao fechar o canal de dados:', erro);
    }
    canal = null;
  }

  function fecharConexao() {
    if (!conexao) return;
    try {
      conexao.ontrack = null;
      conexao.getSenders?.().forEach(remetente => {
        try {
          remetente.track?.stop();
        } catch { /* a faixa já pode ter ido embora com a conexão */ }
      });
      conexao.close();
    } catch (erro) {
      console.warn('[Voz] Falha ao fechar a conexão:', erro);
    }
    conexao = null;
    const elemento = tela?.audioElement();
    if (elemento) elemento.srcObject = null;
  }

  /**
   * O stop() das faixas. Sem ele o indicador de gravação do navegador continua
   * aceso depois de a conversa acabar, e o microfone continua captando — é a
   * armadilha número três do contrato e a mais fácil de não notar em teste.
   */
  function pararMicrofone() {
    if (!microfone) return;
    microfone.getTracks().forEach(faixa => {
      try {
        faixa.stop();
      } catch (erro) {
        console.warn('[Voz] Falha ao parar uma faixa do microfone:', erro);
      }
    });
    microfone = null;
  }

  /**
   * Chamado SEMPRE pela tela, que é o caminho único de saída. A ordem é a do
   * contrato e não é negociável: temporizadores → canal → conexão → microfone →
   * backend. `encerrado` torna a função idempotente: a tela pode chamá-la de
   * novo quando o cliente fecha o alerta de falha, e não sai um segundo /ended.
   */
  function stop(motivo) {
    if (encerrado) return;
    encerrado = true;
    pararTemporizadores();
    pararMedidor();
    fecharCanal();
    fecharConexao();
    pararMicrofone();
    respostaAtiva = false;
    fila = [];
    pedidoEmVoo = null;
    atendidas.clear();
    const corpo = corpoDoFim(motivo);
    console.log('[Voz] Uso acumulado da sessão:', corpo);
    reportarFim(sessao?.id, corpo);
    sessao = null;
    zerarUso();
  }

  function setMuted(mudo) {
    for (const faixa of microfone?.getAudioTracks?.() || []) faixa.enabled = !mudo;
  }

  window.RapidexAssistantVoice?.setDriver({ start, stop, setMuted });
})();
