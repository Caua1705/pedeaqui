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
      'no-unused-vars': ['warn', { args: 'none', ignoreRestSiblings: true }],
      // Map the remaining XSS surface without breaking the build.
      'no-restricted-syntax': [
        'warn',
        {
          selector: "AssignmentExpression[left.property.name='innerHTML']",
          message:
            'Assigning innerHTML is an XSS sink. Ensure every interpolated value is escaped (esc()).'
        }
      ],
      // Conservative posture: these recommended rules flag pre-existing patterns
      // (intentional empty catches, defensive null inits, dead code after an
      // early return) whose "fix" would be risky churn in this phase. Keep them
      // visible as warnings and list them in the report instead of forcing edits.
      'no-empty': ['warn', { allowEmptyCatch: true }],
      'no-useless-assignment': 'warn',
      'no-unreachable': 'warn',
      'preserve-caught-error': 'off'
    }
  },

  // Node-side tooling and tests.
  {
    files: [
      '*.config.js',
      'tests/**/*.js',
      'playwright.config.js',
      'vitest.config.js'
    ],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: { ...globals.node }
    },
    rules: {
      eqeqeq: ['error', 'smart'],
      'no-unused-vars': 'warn'
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
