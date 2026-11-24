import babelParser from '@babel/eslint-parser';
import reactHooks from 'eslint-plugin-react-hooks';

// Focused on the correctness class tsc can't see: React hook rules and dependency
// arrays (stale closures, unstable deps that break memoisation). The repo is on
// TypeScript 7, which typescript-eslint does not yet support, so the hook rules —
// which need only syntax, not types — run on the Babel parser. Vendored shadcn UI
// and disposable prototypes are out of scope.
export default [
  {
    ignores: [
      'dist', '.wrangler', 'node_modules', 'test-results', 'playwright-report',
      'worker-configuration.d.ts', 'prototypes', 'src/components/ui',
    ],
  },
  {
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: {
      parser: babelParser,
      parserOptions: {
        requireConfigFile: false,
        babelOptions: {
          presets: [
            '@babel/preset-typescript',
            ['@babel/preset-react', { runtime: 'automatic' }],
          ],
        },
      },
    },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      // Rules-of-hooks violations are real bugs: gate on them.
      'react-hooks/rules-of-hooks': 'error',
      // Dependency arrays surface as warnings — some deviations here are deliberate
      // (stable sub-methods kept out to preserve memoisation). Review, don't block.
      'react-hooks/exhaustive-deps': 'warn',
    },
  },
];
