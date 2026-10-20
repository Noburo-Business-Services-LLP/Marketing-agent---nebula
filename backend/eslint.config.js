'use strict';
// ESLint (flat config) for the API. Errors fail CI; warnings are allowed (they are the baseline to clean over time).
// Baseline and the reasons behind each rule: docs/superpowers/ops/regression-probes.md, "Lint baseline".
const js = require('@eslint/js');
const globals = require('globals');

module.exports = [
  { ignores: ['node_modules/**', 'storage/**', 'temp/**', 'assets/**', 'music/**', 'tone-audio/**', 'designed-pdf-test-output/**', 'data/**'] },
  js.configs.recommended,
  {
    files: ['**/*.js'],
    languageOptions: { ecmaVersion: 2023, sourceType: 'commonjs', globals: { ...globals.node } },
    rules: {
      'no-empty': ['error', { allowEmptyCatch: false }],
      'no-unused-vars': ['warn', { args: 'none', caughtErrors: 'none', ignoreRestSiblings: true }],
      'no-console': 'warn',
      // Sanitisers strip control characters on purpose.
      'no-control-regex': 'off',
      // Baseline: stray escapes in old regexes. Harmless, cleaned up when a line is touched.
      'no-useless-escape': 'warn',
      // Prompt text and the BOM test in uploadSafety contain these characters on purpose (strings and regexes only).
      'no-irregular-whitespace': ['error', { skipStrings: true, skipTemplates: true, skipRegExps: true, skipComments: true }]
    }
  },
  {
    // Scripts and tests print on purpose.
    files: ['scripts/**', 'tests/**', 'seed*.js', '**/*.test.js'],
    rules: { 'no-console': 'off' }
  },
  {
    files: ['tests/**', '**/*.test.js'],
    languageOptions: { globals: { ...globals.node } }
  }
];
