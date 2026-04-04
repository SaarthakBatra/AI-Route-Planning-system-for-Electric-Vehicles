/**
 * ESLint Flat Configuration for AI Route Planner (Frontend Module)
 */
const globals = require('globals');

module.exports = [
    {
        // Global ignores
        ignores: ['node_modules/**']
    },
    {
        // Browser-side application logic
        files: ['app.js'],
        languageOptions: {
            ecmaVersion: 2022,
            sourceType: 'script',
            globals: {
                ...globals.browser,
                'L': 'readonly', // Leaflet global
                'module': 'readonly' // For the conditional export check at the bottom
            }
        },
        rules: {
            'no-unused-vars': ['warn', { 'argsIgnorePattern': '^_' }],
            'no-console': 'off',
            'semi': ['error', 'always'],
            'quotes': ['error', 'single'],
            'no-undef': 'error'
        }
    },
    {
        // Node.js environments (configuration files)
        files: ['eslint.config.js'],
        languageOptions: {
            ecmaVersion: 2022,
            sourceType: 'commonjs',
            globals: {
                ...globals.node
            }
        },
        rules: {
            'no-console': 'off',
            'semi': ['error', 'always'],
            'quotes': ['error', 'single']
        }
    }
];
