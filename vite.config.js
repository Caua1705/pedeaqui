import { defineConfig } from 'vite';
import { resolve } from 'node:path';
import { viteStaticCopy } from 'vite-plugin-static-copy';

// Multi-page build. Both HTML files are entry points; each pulls in a single
// module entry that side-effect-imports the app scripts in their original order
// (see scripts/entry-restaurant.js). Vite then bundles, minifies and hashes the
// output, which replaces the manual ?v=N cache-busting the HTML used before.
export default defineConfig({
  // Served at domain root (Vercel), same as today.
  base: '/',

  plugins: [
    // The app loads a few images by string path at runtime
    // (e.g. 'assets/brand/rapi-mascot.png' built in JS), so Vite's module graph
    // never sees them. Copy the whole assets/ tree verbatim into the build so
    // those runtime paths keep resolving exactly as before.
    viteStaticCopy({
      targets: [{ src: 'assets/**/*', dest: 'assets' }]
    })
  ],

  build: {
    outDir: 'dist',
    emptyOutDir: true,
    // Hashed filenames per Vite defaults ([name]-[hash]); this is what
    // supersedes the hand-incremented ?v=N query strings.
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, 'index.html'),
        restaurant: resolve(import.meta.dirname, 'restaurant.html')
      }
    }
  },

  server: {
    port: 4174,
    host: '127.0.0.1'
  },
  preview: {
    port: 4174,
    host: '127.0.0.1'
  }
});
