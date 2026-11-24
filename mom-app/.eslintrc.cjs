// The mom app is plain browser scripts (no bundler); keep it out of the bot's airbnb/node lint rules.
module.exports = {
  root: true,
  env: { browser: true, es2022: true },
  parserOptions: { ecmaVersion: 'latest', sourceType: 'script' },
  globals: { App: 'writable', Core: 'readonly', BRAND: 'readonly', module: 'readonly' },
  rules: {},
  overrides: [
    // the unit and API tests (jest) are ES modules run by Node, not browser scripts
    { files: ['tests/**/*.test.js', 'tests/fake-redis.js'], parserOptions: { sourceType: 'module' }, env: { node: true, jest: true } },
  ],
};
