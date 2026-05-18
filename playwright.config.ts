import type { PlaywrightTestConfig } from '@playwright/test';

const config: PlaywrightTestConfig = {
	webServer: {
		command: 'npm run build && npm run preview -- --host 127.0.0.1',
		port: 4173
	},
	testDir: 'tests/ui'
};

export default config;
