// Google Maps API key resolver — contains NO credential.
//
// The key comes from Vite env at build/dev time (VITE_MAPS_KEY in .env, which is
// gitignored — see .env.example). window.RAPIDEX_MAPS_KEY is kept as a runtime
// fallback for backward compatibility with the Fase 0 maps-config.local.js setup.
(function () {
  var envKey = '';
  try {
    envKey = (import.meta.env && import.meta.env.VITE_MAPS_KEY) || '';
  } catch (error) {
    envKey = '';
  }
  var key = envKey || window.RAPIDEX_MAPS_KEY || '';
  window.RAPIDEX_MAPS_KEY = key;
  // Back-compat: existing callers still read window.GOOGLE_MAPS_API_KEY.
  window.GOOGLE_MAPS_API_KEY = key;
})();
