import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vitest/config';

export default defineConfig({
	plugins: [sveltekit()],
	resolve: { conditions: ['browser'] },
	test: {
		setupFiles: ['./tests/setup.ts'],
		exclude: ['node_modules/**', 'dist/**', 'build/**', '.svelte-kit/**', 'tests/ui/**']
	}
});
