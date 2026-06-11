import js from '@eslint/js';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default [
  {
    ignores: [
      '**/.wrangler/**',
      '**/.worktrees/**',
      '**/dist/**',
      '**/node_modules/**',
      '**/coverage/**',
      '**/*.config.js',
      '**/*.config.cjs',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        ...globals.browser,
        ...globals.node,
        ...globals.serviceworker,
      },
    },
    rules: {
      'no-undef': 'off',
      '@typescript-eslint/no-unused-vars': ['error', {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        caughtErrorsIgnorePattern: '^_',
      }],
      '@typescript-eslint/no-explicit-any': 'error',
    },
  },
  {
    files: ['apps/web/src/**/*.{ts,tsx}'],
    plugins: {
      'react-hooks': reactHooks,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'no-restricted-imports': ['error', {
        patterns: [{
          group: ['**/apps/api/src/**', '**/api/src/**'],
          message: 'The web may only consume the public query-types contract.',
        }],
      }],
    },
  },
  {
    files: ['packages/query-types/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [{
          group: [
            '*cloudflare*',
            'hono',
            'hono/**',
            '**/apps/**',
            '**/scripts/**',
          ],
          message: 'query-types must remain transport-independent and app-independent.',
        }],
      }],
    },
  },
  {
    files: ['apps/api/src/routes/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [{
          group: [
            '**/db/**',
            '**/cisapi/**',
            '**/transforms/**',
            '**/ranking/**',
            '**/search-filters*',
            '**/search-hybrid*',
            '**/search-retrieval*',
            '**/search-fusion*',
            '**/search-loaders*',
            '**/search-requirements*',
          ],
          message: 'Routes are transport adapters; call application services instead.',
        }],
      }],
    },
  },
  {
    files: ['scripts/**/*.{ts,tsx}'],
    ignores: [
      'scripts/workflows/historical-sync-workflow.ts',
      'scripts/__tests__/historical-sync.test.ts',
    ],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [{
          group: ['**/apps/api/src/**'],
          message: 'Operational scripts must use public contracts or explicit application workflows.',
        }],
      }],
    },
  },
  {
    files: [
      'apps/api/src/services/search-retrieval*.ts',
      'apps/api/src/services/search-lane-query*.ts',
      'apps/api/src/services/search-hybrid*.ts',
      'apps/api/src/services/search-fusion*.ts',
    ],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [{
          group: [
            '**/search-response-dto*',
            '**/dto/course*',
            '**/search-ui*',
          ],
          message: 'Executable retrieval must remain independent from public presentation.',
        }],
      }],
    },
  },
  {
    files: ['apps/api/src/services/ranking/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [{
          group: [
            '**/http/**',
            '**/routes/**',
            '**/dto/**',
            '**/search-response*',
            '**/search-ui*',
            '**/search-chip*',
            '**/search-hint-label*',
            '**/search-result-presentation*',
          ],
          message: 'Ranking policy must remain independent from transport and presentation.',
        }],
      }],
    },
  },
  {
    files: ['apps/api/src/dto/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [{
          group: ['**/*repository*', '*cloudflare*', 'hono', 'hono/**'],
          message: 'DTO mappers map data; they do not execute repositories or transport logic.',
        }],
      }],
    },
  },
  {
    files: ['apps/api/src/**/*-repository.ts'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [{
          group: [
            '**/dto/**',
            '**/search-response*',
            '**/search-ui*',
            '**/search-chip*',
            '**/search-result-presentation*',
          ],
          message: 'Repositories must remain independent from public presentation.',
        }],
      }],
    },
  },
];
