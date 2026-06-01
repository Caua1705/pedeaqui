(function () {
  function config() {
    return window.APP_CONFIG || {};
  }

  function apiBaseUrl() {
    return String(config().API_BASE_URL || '').replace(/\/+$/, '');
  }

  function buildUrl(path) {
    const normalizedPath = path.startsWith('/') ? path : '/' + path;
    return apiBaseUrl() + normalizedPath;
  }

  async function request(path, options = {}) {
    if (!apiBaseUrl()) throw new Error('API_BASE_URL is not configured.');
    const response = await fetch(buildUrl(path), {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(options.headers || {})
      }
    });

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

  function get(path) {
    return request(path, { method: 'GET' });
  }

  function post(path, body) {
    return request(path, { method: 'POST', body: JSON.stringify(body) });
  }

  async function getLocalJson(path) {
    const response = await fetch(path);
    if (!response.ok) throw new Error(`Local fallback not found: ${path}`);
    return response.json();
  }

  window.PedeAquiApiClient = { get, post, request, getLocalJson, buildUrl };
})();
