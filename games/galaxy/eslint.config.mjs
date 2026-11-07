import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import { defineConfig, globalIgnores } from 'eslint/config';
import globals from 'globals';

export default defineConfig([
  globalIgnores(['**/dist/**', '**/node_modules/**', '**/test-results/**', '**/playwright-report/**']),
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },
  {
    files: ['scripts/**/*.mjs', 'packages/*/scripts/**/*.mjs', '**/*.config.{js,mjs,ts}'],
    languageOptions: { globals: globals.node },
  },
  {
    files: ['apps/web/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: reactHooks.configs.recommended.rules,
  },
  {
    // The run simulation must play the same in every JS engine (GDD §18.4): no clocks, no Math.random, and none of the
    // "implementation-approximated" Math functions (they can differ by an ulp between browsers). Use src/math instead.
    files: ['packages/sim/src/**/*.ts'],
    rules: {
      'no-restricted-properties': [
        'error',
        ...['random', 'sin', 'cos', 'tan', 'asin', 'acos', 'atan', 'atan2', 'sinh', 'cosh', 'tanh', 'pow', 'exp', 'expm1', 'log', 'log2', 'log10', 'log1p', 'hypot', 'cbrt'].map(
          (property) => ({ object: 'Math', property, message: 'Not deterministic across JS engines: use packages/sim/src/math.' }),
        ),
      ],
      'no-restricted-globals': [
        'error',
        { name: 'Date', message: 'The simulation has no clock: count ticks.' },
        { name: 'performance', message: 'The simulation has no clock: count ticks.' },
      ],
      'no-restricted-syntax': ['error', { selector: "BinaryExpression[operator='**']", message: 'Exponentiation is not exact across engines: multiply.' }],
    },
  },
]);
