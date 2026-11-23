module.exports = {
  env: {
    commonjs: true,
    es2021: true,
    node: true,
  },
  extends: 'airbnb',
  overrides: [
    {
      // Service worker of the travel page.
      files: ['web/travel-sw.js'],
      env: { serviceworker: true, browser: true, node: false },
      rules: { 'no-restricted-globals': 'off' },
    },
    {
      // Browser scripts for the travel page (web/travel.html): d3 and topojson come from web/vendor/.
      files: [
        'web/travel-app.js',
        'web/travel-data.js',
        'web/travel-geo.js',
        'web/travel-map.js',
      ],
      env: {
        browser: true,
        node: false,
      },
      globals: {
        d3: 'readonly',
        topojson: 'readonly',
        Sortable: 'readonly',
      },
      rules: {
        // Data tables and short UI handlers read better on one line.
        'object-curly-newline': 'off',
        'object-property-newline': 'off',
        'newline-per-chained-call': 'off',
        'no-use-before-define': ['error', { functions: false }],
      },
    },
    {
      files: [
        'config/index.js',
      ],
      rules: {
        'max-len': 'off',
      },
    },
  ],
  parserOptions: {
    ecmaVersion: 'latest',
  },
  rules: {
    'import/extensions': ['error', 'always', { ignorePackages: true }],
    'no-console': 'off',
    'no-param-reassign': 'off',
    'no-unused-vars': 'off',
    'max-len': 'off',
  },
};
