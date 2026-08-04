(function () {
  function config() {
    return window.APP_CONFIG || {};
  }

  function apiBaseUrl() {
    return String(config().API_BASE_URL || '').replace(/\/+$/, '');
  }

  function buildApiUrl(path) {
    const normalizedPath = path.startsWith('/') ? path : '/' + path;
    return apiBaseUrl() + normalizedPath;
  }

  // Every request is bounded: without this a hung API leaves the UI stuck on the
  // loader forever, because the promise never settles.
  const DEFAULT_TIMEOUT_MS = 8000;

  function timeoutError(url, method, timeoutMs) {
    const error = new Error('A conexão com o servidor demorou demais. Tente novamente.');
    error.name = 'TimeoutError';
    error.isTimeout = true;
    error.url = url;
    error.method = method;
    error.timeoutMs = timeoutMs;
    return error;
  }

  function networkError() {
    const error = new Error('Não foi possível conectar à API.');
    error.name = 'NetworkError';
    error.isNetworkError = true;
    return error;
  }

  async function apiFetch(path, options = {}) {
    if (!apiBaseUrl()) throw new Error('API_BASE_URL is not configured.');
    let response;
    const url = buildApiUrl(path);
    const method = String(options.method || 'GET').toUpperCase();

    // `timeout` is ours, not fetch's — pull it out of the options we forward.
    const { timeout, signal: callerSignal, ...fetchOptions } = options;
    const timeoutMs = Number.isFinite(timeout) ? timeout : DEFAULT_TIMEOUT_MS;

    const controller = new AbortController();
    let timedOut = false;
    const timer = timeoutMs > 0
      ? setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs)
      : null;

    // A caller-supplied signal (e.g. the Rapi chat cancel button) still wins.
    const onCallerAbort = () => controller.abort();
    if (callerSignal) {
      if (callerSignal.aborted) controller.abort();
      else callerSignal.addEventListener('abort', onCallerAbort);
    }
    const cleanup = () => {
      if (timer) clearTimeout(timer);
      if (callerSignal) callerSignal.removeEventListener('abort', onCallerAbort);
    };

    let data = null;
    try {
      response = await fetch(url, {
        ...fetchOptions,
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          ...(options.headers || {})
        }
      });

      if (response.status === 204) return null;
      const contentType = response.headers.get('content-type') || '';
      if (contentType.includes('application/json')) data = await response.json();
      else data = await response.text();
    } catch (error) {
      if (timedOut) throw timeoutError(url, method, timeoutMs);
      if (error?.name === 'AbortError') throw error;
      // Body already arrived: this is a parse error, not a transport failure.
      if (response) throw error;
      throw networkError();
    } finally {
      cleanup();
    }

    if (!response.ok) {
      // Never log the request body: it carries e-mail, phone, CPF and password.
      console.error(`[API ${response.status}] ${method} ${url}`);
      // `detail` chega como string, array (422) OU objeto (erro estruturado da
      // rota de pagamento). Interpolar os dois últimos direto viraria
      // "[object Object]" na tela — quem sabe ler as três formas é o
      // PedeAquiApiError. O `detail` cru continua no erro, intacto, para quem
      // precisa dos campos (ver `paymentErrorInfo`).
      const detailText = window.PedeAquiApiError?.detailText?.(data?.detail) ?? '';
      const message = detailText || (typeof data?.message === 'string' ? data.message : '')
        || `API request failed: ${response.status}`;
      const error = new Error(message);
      error.status = response.status;
      error.data = data;
      error.detail = data?.detail;
      throw error;
    }

    return data;
  }

  function apiGet(path) {
    return apiFetch(path, { method: 'GET' });
  }

  function apiPost(path, body) {
    return apiFetch(path, { method: 'POST', body: JSON.stringify(body) });
  }

  function apiPatch(path, body) {
    return apiFetch(path, { method: 'PATCH', body: JSON.stringify(body) });
  }

  async function getLocalJson(path) {
    const response = await fetch(path);
    if (!response.ok) throw new Error(`Local fallback not found: ${path}`);
    return response.json();
  }

  window.buildApiUrl = buildApiUrl;
  window.apiFetch = apiFetch;
  window.apiGet = apiGet;
  window.apiPost = apiPost;
  window.apiPatch = apiPatch;
  window.PedeAquiApiClient = {
    get: apiGet,
    post: apiPost,
    patch: apiPatch,
    request: apiFetch,
    getLocalJson,
    buildUrl: buildApiUrl,
    buildApiUrl,
    apiFetch,
    apiGet,
    apiPost,
    apiPatch
  };
})();
