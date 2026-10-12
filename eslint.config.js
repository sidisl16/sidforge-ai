const globals = require('globals');

module.exports = [{
  ignores: ['node_modules/**', 'coverage/**', 'package-lock.json']
}, {
  files: ['**/*.js'],
  languageOptions: { ecmaVersion: 2022, sourceType: 'commonjs', globals: globals.node },
  rules: { 'no-unused-vars': ['error', { argsIgnorePattern: '^_' }], 'no-console': 'error', 'semi': ['error', 'always'] }
}];
