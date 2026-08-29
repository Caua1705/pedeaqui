import js from '@eslint/js';
import globals from 'globals';
import prettier from 'eslint-config-prettier';

// Conservative flat config. The app is still a set of browser IIFE globals
// (no ES modules yet), so rules that would force risky refactors are kept as
// warnings, not errors — the build never fails on style.
export default [
  {
    ignores: [
      'dist/**',
      'node_modules/**',
      'playwright-report/**',
      'test-results/**',
      'coverage/**',
      'tests/fixtures/**',
      'scripts/config/maps-config.local.js'
    ]
  },

  js.configs.recommended,

  // Browser app scripts (bundled by Vite; import.meta.env is available).
  {
    files: ['scripts/**/*.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: {
        ...globals.browser,
        // Cross-file globals the app publishes on window and reads by name.
        google: 'readonly'
      }
    },
    rules: {
      eqeqeq: ['error', 'smart'],
      // ERRO desde a limpeza de 29/08/2026. Como warning ele nunca barrou nada:
      // o CI passava com 114 avisos, e entre eles estavam 5 funções mortas, um
      // `submittedOrder` escrito duas vezes e lido nunca, e dois estados
      // (`secondaryCartBottomOffset`, `_assistantReturnNav`) calculados a cada
      // navegação para ninguém. Código morto não se acumula por decisão — ele
      // se acumula porque o aviso rola para fora da tela.
      //
      // `args: 'none'` fica: assinatura de handler é contrato, não uso.
      'no-unused-vars': ['error', { args: 'none', ignoreRestSiblings: true }],
      // Map the remaining XSS surface without breaking the build.
      'no-restricted-syntax': [
        'warn',
        {
          selector: "AssignmentExpression[left.property.name='innerHTML']",
          message:
            'Assigning innerHTML is an XSS sink. Ensure every interpolated value is escaped (esc()).'
        }
      ],
      // `no-empty` continua warning porque catch vazio às vezes É a resposta
      // certa (modo privativo, iframe já fora do DOM) e cada caso pede leitura.
      // Os outros dois viraram erro: inicializador que ninguém lê e código
      // depois de um return não têm caso legítimo, e como aviso ficaram anos
      // rolando para fora da tela junto com os 80 de innerHTML.
      'no-empty': ['warn', { allowEmptyCatch: true }],
      'no-useless-assignment': 'error',
      'no-unreachable': 'error',
      'preserve-caught-error': 'off'
    }
  },

  // Service worker: outro escopo global (self, caches, clients), sem window nem
  // document. Fica FORA do bloco de scripts/ de propósito — se os globais de
  // browser valessem aqui, um `document.` esquecido no worker passaria no lint e
  // só falharia em runtime, onde ninguém está olhando.
  {
    files: ['public/sw.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'script',
      globals: globals.serviceworker
    },
    rules: {
      eqeqeq: ['error', 'smart']
    }
  },

  // Node-side tooling and tests.
  {
    files: [
      '*.config.js',
      'tests/**/*.js',
      'tools/**/*.mjs',
      'tools/**/*.js',
      'playwright.config.js',
      'vitest.config.js'
    ],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      // Tests reference browser globals too: unit tests alias window->globalThis,
      // and E2E page.evaluate/addInitScript callbacks run in the page context.
      globals: { ...globals.node, ...globals.browser }
    },
    rules: {
      eqeqeq: ['error', 'smart'],
      'no-unused-vars': 'error'
    }
  },

  // Vitest globals for unit tests.
  {
    files: ['tests/unit/**/*.js'],
    languageOptions: {
      globals: { ...globals.node, ...globals.vitest }
    }
  },

  prettier
];
