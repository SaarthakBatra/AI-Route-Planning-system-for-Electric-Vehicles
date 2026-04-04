/**
 * ESLint Flat Configuration for AI Route Planner (Cache Module)
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
            'no-console': 'off', // Diagnostic module uses console for health checks
            'semi': ['error', 'always'],
            'quotes': ['error', 'single'],
            'indent': ['error', 4]
        }
    }
];
