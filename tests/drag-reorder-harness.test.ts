import { expect, test } from 'vitest';
import { buildDragReorderHarness } from './drag-reorder-harness';

test('the retained browser harness compiles the live reorder component', async () => {
	const result = await buildDragReorderHarness();
	const components = Object.keys(result.metafile.inputs).filter((filename) =>
		filename.startsWith('src/lib/components/')
	);
	expect(components).toEqual(['src/lib/components/DragReorderList.svelte']);
	expect(result.errors).toEqual([]);
	expect(result.warnings).toEqual([]);
	expect(result.outputFiles[0].text).toContain('mountDrag');
});
