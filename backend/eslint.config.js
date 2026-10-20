import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**', 'test-results/**', 'playwright-report/**'] },
  js.configs.recommended,
  ...tseslint.configs.strict,
  {
    languageOptions: { globals: { console: 'readonly', process: 'readonly', Buffer: 'readonly' } },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      'no-console': 'off', // server logs go to stdout; nothing personal is logged
    },
  },
  { files: ['tests/**', 'scripts/**'], rules: { 'no-console': 'off', 'no-empty-pattern': 'off' } },
);
