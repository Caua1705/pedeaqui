(function () {
  /**
   * Normalização do `detail` de erro da API.
   *
   * O `detail` NÃO tem um formato só. Hoje, na mesma API, ele chega em três
   * formas diferentes:
   *
   *   1. string   — `{"detail": "cupom expirado"}` (HTTPException do FastAPI)
   *   2. array    — `{"detail": [{loc, msg, type}]}` (HTTPValidationError, 422)
   *   3. objeto   — erro estruturado da rota de pagamento (`code`/`retryable`)
   *
   * Interpolar qualquer um dos dois últimos direto numa mensagem produz
   * "[object Object]" na tela do cliente. Este módulo é o único lugar que sabe
   * ler as três formas, e é por ele que TODA mensagem de erro da API passa.
   *
   * Regra central: quando não há texto legível, devolvemos '' — nunca
   * `String(objeto)`. Uma string vazia deixa o chamador cair no fallback dele,
   * que é uma frase escrita em português; "[object Object]" não deixa.
   */

  // Chaves que carregam texto humano, em ordem de preferência. `msg` é a do
  // ValidationError do FastAPI; as outras aparecem em erros de aplicação.
  const TEXT_KEYS = ['message', 'msg', 'detail', 'description', 'error'];

  function isPlainObject(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
  }

  /**
   * @param {unknown} detail  o `detail` cru vindo do corpo da resposta
   * @returns {string} texto legível, ou '' quando não há nenhum
   */
  function detailText(detail, depth = 0) {
    if (detail == null) return '';
    // Guarda contra estrutura auto-referente/aninhada demais: um `detail` que
    // aponta para si mesmo não pode virar recursão infinita na tela de erro.
    if (depth > 3) return '';

    if (typeof detail === 'string') return detail.trim();
    if (typeof detail === 'number' || typeof detail === 'boolean') return String(detail);

    if (Array.isArray(detail)) {
      return detail
        .map(entry => detailText(entry, depth + 1))
        .filter(Boolean)
        .join('; ');
    }

    if (isPlainObject(detail)) {
      for (const key of TEXT_KEYS) {
        const text = detailText(detail[key], depth + 1);
        if (text) return text;
      }
      // Objeto sem campo de texto (ex.: só `code`/`retryable`): quem chama
      // escreve a frase. Não existe texto aqui para mostrar.
      return '';
    }

    return '';
  }

  /**
   * Mensagem de erro pronta para tela, a partir do erro lançado pelo api-client.
   * @param {any} error
   * @param {string} fallback frase em português usada quando não há texto útil
   */
  function errorMessage(error, fallback = '') {
    const fromDetail = detailText(error?.detail ?? error?.data?.detail);
    if (fromDetail) return fromDetail;
    const fromBody = detailText(error?.data?.message);
    if (fromBody) return fromBody;
    // `error.message` só serve se não for o texto técnico que o api-client
    // gera quando não havia detail nenhum.
    const raw = String(error?.message || '').trim();
    if (raw && !/^API request failed:/.test(raw)) return raw;
    return fallback;
  }

  /**
   * Lê o erro estruturado da rota de pagamento.
   *
   * ⚠️ O schema `PaymentErrorDetail` NÃO está publicado no OpenAPI da API
   * (`GET /openapi.json` declara só 200 e 422/HTTPValidationError para
   * `POST /orders/{token}/payment`). Os nomes dos campos vieram do backend, não
   * do contrato, e a lista de `code` não é conhecida.
   *
   * Por isso aqui não há nenhuma tabela de códigos: um `code` que não
   * conhecemos não pode virar mensagem errada nem tela quebrada. O que decide o
   * que o cliente vê é o `retryable`, e o `code` só é exibido como referência
   * para o cliente citar ao restaurante.
   *
   * @returns {{code: string, retryable: boolean, text: string, structured: boolean}}
   */
  function paymentErrorInfo(error) {
    const detail = error?.detail ?? error?.data?.detail;
    const structured = isPlainObject(detail);
    const code = structured ? String(detail.code ?? '').trim() : '';

    return {
      code,
      retryable: resolveRetryable(structured ? detail.retryable : undefined, error),
      text: detailText(detail),
      structured
    };
  }

  /**
   * `retryable` manda quando vem como booleano de verdade. Sem ele, decidimos
   * pelo transporte: falha de rede/servidor pode ser transitória, recusa 4xx
   * não é. O desconhecido cai em NÃO retentável de propósito — oferecer um
   * botão que só vai falhar de novo é pior do que orientar a resolver de outro
   * jeito.
   */
  function resolveRetryable(flag, error) {
    if (typeof flag === 'boolean') return flag;
    if (error?.isTimeout || error?.isNetworkError) return true;
    const status = Number(error?.status);
    if (Number.isFinite(status) && status >= 500) return true;
    return false;
  }

  window.PedeAquiApiError = {
    detailText,
    errorMessage,
    paymentErrorInfo
  };
})();
