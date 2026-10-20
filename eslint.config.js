// Catches mistakes that tests can miss: names that don't exist, unused code, duplicate keys…
//   npm run lint
import globals from 'globals';

const bugs = {
  'no-undef': 'error', 'no-dupe-keys': 'error', 'no-dupe-args': 'error', 'no-dupe-else-if': 'error', 'no-duplicate-case': 'error',
  'no-unreachable': 'error', 'no-self-assign': 'error', 'no-const-assign': 'error', 'no-unsafe-finally': 'error', 'use-isnan': 'error',
  'valid-typeof': 'error', 'no-redeclare': 'error', 'no-func-assign': 'error', 'no-import-assign': 'error', 'no-unsafe-negation': 'error',
  'no-sparse-arrays': 'error', 'no-compare-neg-zero': 'error', 'no-cond-assign': ['error', 'except-parens'],
};
export default [
  { ignores: ['node_modules/**', 'functions/node_modules/**', 'dist*/**', 'marketing/**', 'ref/**', 'tools/board-overrides.js', 'coverage/**'] },
  {
    files: ['src/**/*.js'],
    languageOptions: { ecmaVersion: 2023, sourceType: 'module', globals: { ...globals.browser, google: 'readonly', gapi: 'readonly' } },
    rules: { ...bugs, 'no-unused-vars': ['error', { args: 'none', caughtErrors: 'none', varsIgnorePattern: '^_', ignoreRestSiblings: true }] },
  },
  {
    files: ['functions/**/*.js', 'functions/**/*.mjs', 'tools/**/*.mjs', 'tools/**/*.js', 'tests/**/*.mjs', 'eslint.config.js', 'vite.config.js'],
    languageOptions: { ecmaVersion: 2023, sourceType: 'module', globals: { ...globals.node, ...globals.browser } },
    rules: { ...bugs, 'no-unused-vars': ['error', { args: 'none', caughtErrors: 'none', varsIgnorePattern: '^_', ignoreRestSiblings: true }] },
  },
  // The generated board (v13 + tools/board-overrides.js), a classic script sharing globals with the page.
  {
    files: ['public/board/board.js'],
    languageOptions: { ecmaVersion: 2023, sourceType: 'script', globals: { ...globals.browser, TT: 'readonly', XLSX: 'readonly' } },
    rules: { ...bugs, 'no-unused-vars': ['error', { vars: 'local', args: 'none', caughtErrors: 'none' }] },
  },
  // Browser tests and tools run code inside the page (page.evaluate), where the board's names exist.
  { files: ['tests/**/*.mjs', 'tools/marketing/**', 'tools/perf/**'], rules: { 'no-undef': 'off' } },
];
