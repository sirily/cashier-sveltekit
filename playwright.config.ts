import type { PlaywrightTestConfig } from '@playwright/test';

const config: PlaywrightTestConfig = {
	use: {
		baseURL: 'http://127.0.0.1:4173',
		trace: 'retain-on-failure'
	},
	webServer: {
		command: 'npm run build && npm run preview:static',
		port: 4173
	},
	testDir: 'tests/ui'
};

export default config;
