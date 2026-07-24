// Google Maps API key resolver — contains NO credential.
//
// The real key is provided at runtime by `maps-config.local.js` (gitignored),
// which must be loaded BEFORE this file. See `maps-config.example.js`.
(function () {
  var key = window.RAPIDEX_MAPS_KEY || '';
  window.RAPIDEX_MAPS_KEY = key;
  // Back-compat: existing callers still read window.GOOGLE_MAPS_API_KEY.
  window.GOOGLE_MAPS_API_KEY = key;
})();
