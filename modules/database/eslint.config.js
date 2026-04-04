/**
 * ESLint Flat Configuration for AI Route Planner (Database Module)
 * Using ESLint v10 standards for consistency across modules.
 */
module.exports = [
    {
        ignores: ['node_modules/**']
    },
    {
        files: ['**/*.js'],
        languageOptions: {
            ecmaVersion: 2022,
            sourceType: 'commonjs',
            globals: {
                require: 'readonly',
                module: 'readonly',
                __dirname: 'readonly',
                process: 'readonly',
                console: 'readonly',
                describe: 'readonly',
                it: 'readonly',
                expect: 'readonly',
                jest: 'readonly',
                beforeEach: 'readonly'
            }
        },
        rules: {
            'no-unused-vars': 'warn',
            'no-console': 'off', // Database uses console for diagnostics
            'semi': ['error', 'always'],
            'quotes': ['error', 'single']
        }
    }
];
