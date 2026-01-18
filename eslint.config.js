import eslint from '@eslint/js';
import tseslint from '@typescript-eslint/eslint-plugin';
import tsparser from '@typescript-eslint/parser';
import prettier from 'eslint-plugin-prettier';
import prettierConfig from 'eslint-config-prettier';
import jest from 'eslint-plugin-jest';
import simpleImportSort from 'eslint-plugin-simple-import-sort';
import unusedImports from 'eslint-plugin-unused-imports';

export default [
    // Ignore patterns
    {
        ignores: ['dist/', 'node_modules/', 'coverage/', '.eslintrc.cjs'],
    },

    // Base ESLint recommended rules
    eslint.configs.recommended,

    // TypeScript files configuration
    {
        files: ['**/*.ts'],
        languageOptions: {
            parser: tsparser,
            parserOptions: {
                project: ['./tsconfig.eslint.json', './tsconfig.json'],
                tsconfigRootDir: import.meta.dirname,
                sourceType: 'module',
                ecmaVersion: 2022,
            },
            globals: {
                // Node.js globals (extended)
                process: 'readonly',
                __dirname: 'readonly',
                __filename: 'readonly',
                Buffer: 'readonly',
                console: 'readonly',
                module: 'readonly',
                require: 'readonly',
                exports: 'readonly',
                global: 'readonly',
                setTimeout: 'readonly',
                clearTimeout: 'readonly',
                setInterval: 'readonly',
                clearInterval: 'readonly',
                fetch: 'readonly',
                NodeJS: 'readonly',
                // ES2022 globals
                Promise: 'readonly',
                Symbol: 'readonly',
                WeakMap: 'readonly',
                WeakSet: 'readonly',
                Map: 'readonly',
                Set: 'readonly',
                Proxy: 'readonly',
                Reflect: 'readonly',
                AbortController: 'readonly',
                FormData: 'readonly',
                Blob: 'readonly',
                File: 'readonly',
                ReadableStream: 'readonly',
            },
        },
        plugins: {
            '@typescript-eslint': tseslint,
            'simple-import-sort': simpleImportSort,
            'unused-imports': unusedImports,
            prettier,
            jest,
        },
        rules: {
            // Prettier integration
            'prettier/prettier': 'error',

            // Simple import sort
            'simple-import-sort/imports': 'error',
            'simple-import-sort/exports': 'error',

            // Unused imports auto-fix
            'no-unused-vars': 'off', // Turn off base rule
            '@typescript-eslint/no-unused-vars': 'off', // Turn off TS rule in favor of unused-imports
            'unused-imports/no-unused-imports': 'error',
            'unused-imports/no-unused-vars': [
                'warn',
                {
                    vars: 'all',
                    varsIgnorePattern: '^_',
                    args: 'after-used',
                    argsIgnorePattern: '^_',
                },
            ],

            // TypeScript specific rules
            '@typescript-eslint/explicit-function-return-type': 'off',
            '@typescript-eslint/explicit-module-boundary-types': 'off',
            '@typescript-eslint/no-explicit-any': 'warn',
            '@typescript-eslint/prefer-nullish-coalescing': [
                'warn',
                {
                    ignoreConditionalTests: true,
                    ignoreMixedLogicalExpressions: true,
                },
            ],
            '@typescript-eslint/prefer-optional-chain': 'error',
            '@typescript-eslint/no-floating-promises': 'error',
            '@typescript-eslint/await-thenable': 'error',
            '@typescript-eslint/no-misused-promises': 'error',
            '@typescript-eslint/require-await': 'warn', // Downgraded to warn because of false positives
            '@typescript-eslint/no-unnecessary-type-assertion': 'error',
            '@typescript-eslint/prefer-as-const': 'error',
            '@typescript-eslint/no-non-null-assertion': 'warn',
            '@typescript-eslint/consistent-type-imports': [
                'error',
                { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
            ],
            '@typescript-eslint/consistent-type-exports': 'error',
            '@typescript-eslint/no-import-type-side-effects': 'error',

            // NestJS specific rules - loosened for better DX
            '@typescript-eslint/explicit-member-accessibility': [
                'warn',
                {
                    accessibility: 'explicit',
                    overrides: {
                        accessors: 'explicit',
                        constructors: 'off',
                        methods: 'explicit',
                        properties: 'off',
                        parameterProperties: 'off',
                    },
                },
            ],

            // Jest specific rules
            'jest/no-disabled-tests': 'warn',
            'jest/no-focused-tests': 'error',
            'jest/no-identical-title': 'error',
            'jest/prefer-to-have-length': 'warn',
            'jest/valid-expect': 'error',
            'jest/expect-expect': 'error',
            'jest/no-done-callback': 'error',
            'jest/valid-describe-callback': 'error',

            // General rules
            'no-console': 'warn',
            'no-debugger': 'error',
            'prefer-const': 'error',
            'no-var': 'error',
            'no-undef': 'error',
            'no-control-regex': 'off', // Allow control regex (common in some validation logic)
        },
    },

    // Test files override
    {
        files: ['**/*.spec.ts', '**/*.test.ts', 'test/**/*.ts'],
        languageOptions: {
            globals: {
                // Jest globals
                jest: 'readonly',
                describe: 'readonly',
                it: 'readonly',
                test: 'readonly',
                expect: 'readonly',
                beforeAll: 'readonly',
                beforeEach: 'readonly',
                afterAll: 'readonly',
                afterEach: 'readonly',
            },
        },
        rules: {
            '@typescript-eslint/no-unsafe-assignment': 'off',
            '@typescript-eslint/no-unsafe-member-access': 'off',
            '@typescript-eslint/no-unsafe-call': 'off',
            '@typescript-eslint/no-unsafe-argument': 'off',
            '@typescript-eslint/no-unsafe-return': 'off',
            '@typescript-eslint/no-explicit-any': 'off',
            '@typescript-eslint/explicit-member-accessibility': 'off',
            '@typescript-eslint/require-await': 'off', // Completely off for tests
            'no-console': 'off',
        },
    },

    // Prettier config (must be last to override other configs)
    prettierConfig,
];
