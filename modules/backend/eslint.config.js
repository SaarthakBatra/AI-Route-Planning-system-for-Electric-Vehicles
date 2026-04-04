/**
 * ESLint Flat Configuration for AI Route Planner (Backend Module)
 * Using ESLint v10 standards for consistency and code quality.
 */
module.exports = [
    {
        ignores: ['node_modules/**']
    },
    {
        files: ['**/*.js'],
        languageOptions: {
            ecmaVersion: 2022,
            sourceType: 'commonjs'
        },
        rules: {
            'no-unused-vars': 'warn',
            'no-console': 'off', // Backend uses console for logging currently
            'semi': ['error', 'always'],
            'quotes': ['error', 'single']
        }
    }
];
