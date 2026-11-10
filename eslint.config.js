// @ts-check
import { builtinModules } from 'node:module';
import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import globals from 'globals';
import tseslint from 'typescript-eslint';

/** Node-Builtins mit und ohne `node:`-Präfix. */
const nodeBuiltins = [...builtinModules, ...builtinModules.map((m) => `node:${m}`)];

/** Pakete, die nie von `packages/*` importiert werden dürfen (Abhängigkeitsregel, ARCHITECTURE §5). */
const appImports = ['@rdw/server', '@rdw/server/*', '@rdw/web', '@rdw/web/*'];

/** Laufzeitumgebungsneutrale Pakete: kein Node, keine Datenbank, keine Apps. */
const pureRestrictions = {
  paths: nodeBuiltins.map((name) => ({
    name,
    message: 'game-core und protocol sind laufzeitneutral (Browser und Server): keine Node-Module.',
  })),
  patterns: [
    {
      group: ['pg', 'pg-*', 'kysely', 'kysely/*', '@rdw/db', '@rdw/db/*', ...appImports],
      message: 'game-core und protocol dürfen weder Datenbank noch Apps importieren.',
    },
    {
      group: ['../../*'],
      message: 'Keine relativen Importe über Paketgrenzen; Paketnamen (@rdw/…) verwenden.',
    },
  ],
};

export default tseslint.config(
  {
    ignores: ['**/node_modules/**', '**/dist/**', '**/coverage/**', 'docs/**', 'content/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: {
          allowDefaultProject: ['eslint.config.js'],
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/switch-exhaustiveness-check': 'error',
      eqeqeq: ['error', 'always'],
    },
  },
  // Abhängigkeitsregel: Pakete importieren nie Apps.
  {
    files: ['packages/**/*.ts', 'tools/**/*.ts'],
    rules: {
      'no-restricted-imports': ['error', { patterns: [{ group: appImports }] }],
    },
  },
  // protocol: rein, darf game-core nicht kennen.
  {
    files: ['packages/protocol/src/**/*.ts'],
    rules: {
      'no-restricted-imports': 'off',
      '@typescript-eslint/no-restricted-imports': [
        'error',
        {
          paths: pureRestrictions.paths,
          patterns: [
            ...pureRestrictions.patterns,
            {
              group: ['@rdw/game-core', '@rdw/game-core/*'],
              message: 'protocol steht unter game-core.',
            },
          ],
        },
      ],
    },
  },
  // game-core: rein; von protocol nur Typen.
  {
    files: ['packages/game-core/src/**/*.ts'],
    rules: {
      'no-restricted-imports': 'off',
      '@typescript-eslint/no-restricted-imports': [
        'error',
        {
          paths: [
            ...pureRestrictions.paths,
            {
              name: '@rdw/protocol',
              message: 'game-core hängt nur von protocol-Typen ab (import type).',
              allowTypeImports: true,
            },
          ],
          patterns: [
            ...pureRestrictions.patterns,
            { group: ['zod', 'zod/*'], message: 'Validierung gehört nach protocol.' },
          ],
        },
      ],
    },
  },
  // Client: läuft im Browser, kennt weder Node noch Datenbank noch Server-Code.
  {
    files: ['apps/web/src/**/*.{ts,tsx}'],
    languageOptions: { globals: globals.browser },
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: nodeBuiltins.map((name) => ({
            name,
            message: 'Der Client läuft im Browser: keine Node-Module.',
          })),
          patterns: [
            {
              group: [
                'pg',
                'pg-*',
                'kysely',
                'kysely/*',
                '@rdw/db',
                '@rdw/db/*',
                '@rdw/server',
                '@rdw/server/*',
                '@rdw/content-tools',
                '@rdw/content-tools/*',
              ],
              message: 'Der Client spricht nur über die HTTP-API mit dem Server (ARCHITECTURE §5).',
            },
          ],
        },
      ],
    },
  },
  {
    files: [
      '**/*.js',
      'apps/server/**/*.ts',
      'apps/web/e2e/**/*.ts',
      'apps/web/vite.config.ts',
      'packages/db/**/*.ts',
      'tools/**/*.ts',
      '**/test/**/*.ts',
      '*.config.ts',
    ],
    languageOptions: { globals: globals.node },
  },
  {
    files: ['**/test/**/*.ts'],
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  },
  prettier,
);
