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

  async function apiFetch(path, options = {}) {
    if (!apiBaseUrl()) throw new Error('API_BASE_URL is not configured.');
    let response;

    try {
      response = await fetch(buildApiUrl(path), {
        ...options,
        headers: {
          'Content-Type': 'application/json',
          ...(options.headers || {})
        }
      });
    } catch (error) {
      if (error?.name === 'AbortError') throw error;
      throw new Error('Não foi possível conectar à API.');
    }

    if (response.status === 204) return null;
    let data = null;
    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('application/json')) data = await response.json();
    else data = await response.text();

    if (!response.ok) {
      const message = data?.detail || data?.message || `API request failed: ${response.status}`;
      const error = new Error(message);
      error.status = response.status;
      error.data = data;
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
