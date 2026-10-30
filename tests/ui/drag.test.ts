import { expect, test } from '@playwright/test';
import { build } from 'esbuild-wasm';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compile } from 'svelte/compiler';

// Exercise the otherwise unrouted demo without adding a production test route.
const root = fileURLToPath(new URL('../../', import.meta.url));
let bundle: string;

test.beforeAll(async () => {
	const result = await build({
		absWorkingDir: root,
		stdin: {
			contents: `
				import { mount } from 'svelte';
				import CrossList from './src/lib/components/DragListReorder.svelte';
				import ReorderHarness from 'drag-reorder-harness';
				window.mountDrag = (crossList) => mount(crossList ? CrossList : ReorderHarness, {
					target: document.body
				});`,
			resolveDir: root
		},
		bundle: true,
		write: false,
		format: 'iife',
		conditions: ['browser'],
		plugins: [
			{
				name: 'drag-components',
				setup(builder) {
					builder.onResolve({ filter: /^drag-reorder-harness$/ }, () => ({
						path: 'DragReorderHarness.svelte',
						namespace: 'drag-harness'
					}));
					builder.onLoad({ filter: /.*/, namespace: 'drag-harness' }, () => ({
						// Match every production caller: stateful parent with bind:items.
						// A plain mount() array changes raw objects into proxies on first write.
						contents: compile(
							`<script>
								import Reorder from '#lib/components/DragReorderList.svelte';
								let items = $state([
									{ id: 'a', label: 'Same' },
									{ id: 'b', label: 'Same' },
									{ id: 'c', label: 'Last' }
								]);
							</script>
							<Reorder bind:items getLabel={(item) => item.label}
								ondragend={(updated) => { window.dragResult = updated.map((item) => item.id); }} />`,
							{ filename: 'DragReorderHarness.svelte', generate: 'client', dev: true }
						).js.code,
						loader: 'js',
						resolveDir: root
					}));
					builder.onResolve({ filter: /^#lib\// }, ({ path: name }) => ({
						path: path.join(root, 'src/lib', name.slice(5))
					}));
					builder.onLoad({ filter: /\.svelte$/ }, async ({ path: filename }) => ({
						contents: compile(await readFile(filename, 'utf8'), {
							filename,
							generate: 'client',
							dev: true
						}).js.code,
						loader: 'js'
					}));
				}
			}
		]
	});
	bundle = result.outputFiles[0].text;
});

test('cross-list preview stays visible, follows the pointer and disappears on drop', async ({
	page
}) => {
	const errors: string[] = [];
	page.on('pageerror', (error) => errors.push(error.message));
	await page.setViewportSize({ width: 1000, height: 1200 });
	await page.setContent('<style>body { margin: 60px; }</style>');
	await page.addScriptTag({ content: bundle });
	await page.evaluate('window.mountDrag(true)');

	const source = page.getByText('Task A', { exact: true });
	const target = page.getByText('Task Z', { exact: true });
	const start = (await source.boundingBox())!;
	const end = (await target.boundingBox())!;
	const x = start.x + 30;
	const y = start.y + 20;
	await page.mouse.move(x, y);
	await page.mouse.down();
	const preview = page.locator('[data-drag-preview]');
	await expect(preview).toBeVisible();
	await expect(preview).toHaveText('Task A!!');
	const initial = (await preview.boundingBox())!;
	expect(initial.x).toBeCloseTo(start.x, 0);
	expect(initial.y).toBeCloseTo(start.y, 0);

	const destX = end.x + 30;
	const destY = end.y + 20;
	await page.mouse.move(destX, destY, { steps: 12 });
	await expect(preview).toHaveText('Task A!!');
	const moved = (await preview.boundingBox())!;
	expect(moved.x - initial.x).toBeCloseTo(destX - x, 0);
	expect(moved.y - initial.y).toBeCloseTo(destY - y, 0);
	// This appears only after the item has entered the other list.
	await expect(page.getByText('Drag here!', { exact: true })).toBeVisible();
	await page.mouse.up();
	await expect(preview).toHaveCount(0);
	await expect(source).toBeVisible();
	expect((await source.boundingBox())!.x).toBeCloseTo(end.x, 0);
	await expect(page.getByText('Drag here!', { exact: true })).toHaveCount(0);

	// A second drag proves cleanup did not leave a stale preview or active drag.
	await source.hover();
	await page.mouse.down();
	await expect(preview).toHaveText('Task A!!');
	await page.mouse.up();
	await expect(preview).toHaveCount(0);
	expect(errors).toEqual([]);
});

test('equal labels keep distinct row identities through pointer reorder and drop', async ({
	page
}) => {
	const errors: string[] = [];
	page.on('pageerror', (error) => errors.push(error.message));
	await page.setContent(
		'<style>[data-item] { height: 52px; } .pointer-events-none { position: fixed; pointer-events: none; }</style>'
	);
	await page.addScriptTag({ content: bundle });
	await page.evaluate('window.mountDrag(false)');
	const rows = page.getByRole('listitem');
	await expect(rows).toHaveCount(3);
	// DOM identity must move with the object, not with its (nonunique) label or index.
	await rows.first().evaluate((element) => element.setAttribute('data-original', 'a'));
	const handle = rows.first().getByRole('button', { name: 'Drag to reorder' });
	const start = (await handle.boundingBox())!;
	await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2);
	await page.mouse.down();
	await expect(page.locator('div.pointer-events-none')).toBeVisible();
	await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2 + 104, {
		steps: 10
	});
	await page.mouse.up();
	await expect(rows.nth(2)).toHaveAttribute('data-original', 'a');
	await expect(page.locator('div.pointer-events-none')).toHaveCount(0);
	expect(await page.evaluate('window.dragResult')).toEqual(['b', 'c', 'a']);
	expect(errors).toEqual([]);
});
