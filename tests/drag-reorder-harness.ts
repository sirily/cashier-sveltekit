import { build } from 'esbuild-wasm';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compile } from 'svelte/compiler';

const root = fileURLToPath(new URL('../', import.meta.url));

// Share the browser fixture's compilation with a unit check without adding a production route.
export function buildDragReorderHarness() {
	return build({
		absWorkingDir: root,
		stdin: {
			contents: `
				import { mount } from 'svelte';
				import ReorderHarness from 'drag-reorder-harness';
				window.mountDrag = () => mount(ReorderHarness, { target: document.body });`,
			resolveDir: root
		},
		bundle: true,
		write: false,
		metafile: true,
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
						// Match production callers: a reactive parent owns the bound array.
						contents: compile(
							`<script>
								import Reorder from '#lib/components/DragReorderList.svelte';
								let items = $state([
									{ id: 'a', label: 'Same' },
									{ id: 'b', label: 'Same' },
									{ id: 'c', label: 'Last' }
								]);
							</script>
							<output data-testid="parent-order">{items.map((item) => item.id).join(',')}</output>
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
}
