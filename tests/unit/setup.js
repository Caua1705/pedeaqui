// The app scripts are browser IIFEs that assign to `window`. Alias it to
// globalThis (with a crypto shim) so importing them under Node exposes their
// public API on globalThis for the unit tests.
if (!globalThis.window) {
  globalThis.window = globalThis;
}
if (!globalThis.crypto) {
  globalThis.crypto = (await import('node:crypto')).webcrypto;
}
