import { defineConfig, devices } from '@playwright/test';
const root = process.env.FALCON_E2E_ROOT;
if (!root) throw new Error('Run npm run test:native-e2e to create isolated state');
export default defineConfig({
	testDir: './e2e-native',
	timeout: 90000,
	expect: { timeout: 20000 },
	fullyParallel: false,
	workers: 1,
	maxFailures: 0,
	forbidOnly: !!process.env.CI,
	retries: 0,
	reporter: [
		['list'],
		['html', { outputFolder: 'artifacts/plugin-v4/native-playwright-report', open: 'never' }]
	],
	outputDir: 'artifacts/plugin-v4/native-playwright-results',
	use: {
		baseURL: 'http://127.0.0.1:28982',
		trace: 'off',
		screenshot: 'off',
		video: 'off',
		permissions: ['clipboard-read', 'clipboard-write']
	},
	projects: [
		{
			name: 'desktop',
			use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 1000 } }
		},
		{ name: 'narrow', use: { ...devices['Pixel 7'], viewport: { width: 390, height: 844 } } }
	],
	webServer: {
		command: 'node scripts/native-gateway-harness.mjs',
		url: 'http://127.0.0.1:28982/__fixture/ready',
		timeout: 240000,
		reuseExistingServer: false,
		env: {
			FALCON_E2E_ROOT: root,
			OPENCLAW_STATE_DIR: `${root}/state`,
			OPENCLAW_CONFIG_PATH: `${root}/config.json`
		},
		gracefulShutdown: { signal: 'SIGTERM', timeout: 15000 }
	}
});
