import js from '@eslint/js';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

const restricted = (files, group, message) => ({
  files,
  rules: { 'no-restricted-imports': ['error', { patterns: [{ group, message }] }] },
});

export default [
  { ignores: [
    '**/.wrangler/**', '**/.worktrees/**', '**/dist/**', '**/node_modules/**',
    '**/coverage/**', 'artifacts/**', '**/*.config.js', '**/*.config.cjs',
  ] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.browser, ...globals.node, ...globals.serviceworker },
    },
    rules: {
      'no-undef': 'off',
      '@typescript-eslint/no-unused-vars': ['error', {
        argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_',
      }],
      '@typescript-eslint/no-explicit-any': 'error',
    },
  },
  {
    files: ['apps/web/src/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'no-restricted-imports': ['error', { patterns: [{
        group: ['**/apps/api/src/**', '**/api/src/**'],
        message: 'The web may only consume the public query-types contract.',
      }] }],
    },
  },
  restricted(['packages/query-types/**/*.{ts,tsx}'],
    ['*cloudflare*', 'hono', 'hono/**', '**/apps/**', '**/scripts/**'],
    'Shared contracts must remain transport- and app-independent.'),
  restricted(['apps/api/src/routes/*.{ts,tsx}'],
    ['**/db/**', '**/cisapi/**', '**/transforms/**'],
    'Routes are transport adapters; call application services.'),
  restricted(['scripts/**/*.{ts,tsx}'], ['**/apps/api/src/**'],
    'Scripts use public or Cloudflare boundaries, not API internals.'),
  restricted(['apps/api/src/dto/*.{ts,tsx}'],
    ['**/*repository*', '*cloudflare*', 'hono', 'hono/**'],
    'DTO mappers do not execute repositories or transport logic.'),
  restricted(['apps/api/src/**/*-repository.ts'],
    ['**/dto/**', '**/search-response*', '**/search-result-presentation*'],
    'Repositories remain independent from public presentation.'),
];
