import svelte from 'eslint-plugin-svelte';
import tsParser from '@typescript-eslint/parser';
import tseslintPlugin from '@typescript-eslint/eslint-plugin';
import svelteConfig from './svelte.config.js';

// Note: JS/TS linting is handled by oxlint (see package.json lint script).
// This ESLint config only covers Svelte template linting via eslint-plugin-svelte.

export default [
	{
		ignores: [
			'build/',
			'.svelte-kit/',
			'dist/',
			'node_modules/',
			'package/',
			'.env',
			'.env.*',
			'!.env.example',
			'pnpm-lock.yaml',
			'package-lock.json',
			'yarn.lock'
		]
	},
	...svelte.configs['flat/recommended'],
	{
		files: ['src/**/*.svelte'],
		// Existing findings pending cleanup; keep them visible without blocking adoption.
		rules: {
			'svelte/no-navigation-without-resolve': 'warn',
			'svelte/require-each-key': 'warn',
			'svelte/prefer-svelte-reactivity': 'warn',
			'svelte/no-dom-manipulating': 'warn',
			'svelte/no-dupe-style-properties': 'warn',
			'svelte/no-unused-svelte-ignore': 'warn'
		},
		plugins: {
			'@typescript-eslint': tseslintPlugin
		},
		languageOptions: {
			parserOptions: {
				parser: tsParser,
				extraFileExtensions: ['.svelte'],
				svelteConfig
			}
		}
	}
];
