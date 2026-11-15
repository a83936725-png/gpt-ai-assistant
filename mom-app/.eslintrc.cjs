// The mom app is plain browser scripts (no bundler); keep it out of the bot's airbnb/node lint rules.
module.exports = {
  root: true,
  env: { browser: true, es2022: true },
  parserOptions: { ecmaVersion: 'latest', sourceType: 'script' },
  globals: { App: 'writable', Core: 'readonly', BRAND: 'readonly', module: 'readonly' },
  rules: {},
};
