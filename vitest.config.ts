import { mergeConfig } from 'vitest/config';

import viteConfig from './vite.config';

export default mergeConfig(viteConfig, {
	test: {
		exclude: ['node_modules/**', 'dist/**', 'build/**', '.svelte-kit/**', 'tests/ui/**']
	}
});
