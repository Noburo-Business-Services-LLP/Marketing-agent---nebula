// ESLint (flat config) for the web app: typescript-eslint recommended + react-hooks. Errors fail CI; warnings are the
// baseline to clean over time. Baseline and reasons: docs/superpowers/ops/regression-probes.md, "Lint baseline".
import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';

export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**', 'public/**', 'coverage/**', 'scripts/visual-audit/**'] /* browser-injected audit scripts, not app code */ },
  { linterOptions: { reportUnusedDisableDirectives: 'off' } },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx,js,jsx,mjs}'],
    languageOptions: { ecmaVersion: 2023, sourceType: 'module', globals: { ...globals.browser, ...globals.node } },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'no-empty': ['error', { allowEmptyCatch: false }],
      '@typescript-eslint/no-unused-vars': ['warn', { args: 'none', caughtErrors: 'none', ignoreRestSiblings: true }],
      'no-unused-vars': 'off',
      // Baseline: the app has many `any`s (API payloads). Tightened over time; tsc still checks the rest.
      '@typescript-eslint/no-explicit-any': 'warn',
      // Sanitisers strip control characters on purpose.
      'no-control-regex': 'off',
      'no-useless-escape': 'warn',
      'no-irregular-whitespace': ['error', { skipStrings: true, skipTemplates: true, skipRegExps: true, skipComments: true }]
    }
  },
  {
    // Tests read files and print.
    files: ['tests/**'],
    rules: { 'no-console': 'off' }
  }
);
