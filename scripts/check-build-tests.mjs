import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkBuild } from './check-build.mjs';

function createLogger() {
	const messages = [];
	return {
		messages,
		warn: (...args) => messages.push(['warn', ...args]),
		warnOnce: (...args) => messages.push(['warnOnce', ...args]),
		error: (...args) => messages.push(['error', ...args])
	};
}

test('returns success when the build has no warnings', async () => {
	const logger = createLogger();
	const output = { warn() {}, error() {} };
	const exitCode = await checkBuild(async () => {}, logger, output);

	assert.equal(exitCode, 0);
	assert.equal(logger.messages.length, 0);
});

test('reports Vite warnings and returns failure after the build completes', async () => {
	const logger = createLogger();
	const outputMessages = [];
	const output = {
		warn: (...args) => outputMessages.push(['warn', ...args]),
		error: (...args) => outputMessages.push(['error', ...args])
	};
	let buildCompleted = false;
	const exitCode = await checkBuild(
		async (buildLogger) => {
			buildLogger.warn('plugin warning');
			buildLogger.warnOnce('adapter warning');
			buildCompleted = true;
		},
		logger,
		output
	);

	assert.equal(buildCompleted, true);
	assert.equal(exitCode, 1);
	assert.deepEqual(logger.messages, [
		['warn', 'plugin warning'],
		['warnOnce', 'adapter warning']
	]);
	assert.equal(outputMessages[0][0], 'error');
	assert.match(outputMessages[0][1], /2 warnings/);
});

test('counts console warnings and restores console after the build', async () => {
	const logger = createLogger();
	const outputMessages = [];
	const output = {
		warn: (...args) => outputMessages.push(['warn', ...args]),
		error: (...args) => outputMessages.push(['error', ...args])
	};
	const originalWarn = output.warn;
	const exitCode = await checkBuild(async () => output.warn('adapter fallback'), logger, output);

	assert.equal(exitCode, 1);
	assert.deepEqual(outputMessages[0], ['warn', 'adapter fallback']);
	assert.equal(output.warn, originalWarn);
	assert.equal(logger.warn.name, 'warn');
});

test('the CLI fails for warnings during builder initialization', () => {
	const directory = mkdtempSync(join(tmpdir(), 'check-build-cli-'));
	try {
		copyFileSync(new URL('./check-build.mjs', import.meta.url), join(directory, 'check-build.mjs'));
		const vite = join(directory, 'node_modules', 'vite');
		mkdirSync(vite, { recursive: true });
		writeFileSync(
			join(vite, 'package.json'),
			JSON.stringify({ type: 'module', exports: './index.js' })
		);
		writeFileSync(
			join(vite, 'index.js'),
			`
			export function createLogger() {
							return { warn: (...args) => console.warn(...args), warnOnce: (...args) => console.warn(...args) };
						}
			export async function createBuilder({ customLogger }) {
				customLogger.warn('configuration warning');
				return { async buildApp() {} };
			}
		`
		);
		const execution = spawnSync(process.execPath, [join(directory, 'check-build.mjs')], {
			encoding: 'utf8'
		});
		assert.equal(execution.status, 1);
		assert.match(execution.stderr, /configuration warning/);
		assert.match(execution.stderr, /Build completed with/);
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
});

test('propagates build errors and restores console', async () => {
	const logger = createLogger();
	const output = { warn() {}, error() {} };
	const originalWarn = output.warn;
	await assert.rejects(
		checkBuild(
			async () => {
				throw new Error('build failed');
			},
			logger,
			output
		),
		/build failed/
	);
	assert.equal(output.warn, originalWarn);
});
