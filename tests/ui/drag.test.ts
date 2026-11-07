import { expect, test } from '@playwright/test';
import { buildDragReorderHarness } from '../drag-reorder-harness';

// Exercise the live component with a reactive parent, without a production test route.
let bundle: string;

test.beforeAll(async () => {
	const result = await buildDragReorderHarness();
	bundle = result.outputFiles[0].text;
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
	await page.evaluate('window.mountDrag()');
	await expect(page.getByTestId('parent-order')).toHaveText('a,b,c');
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
	await expect(page.getByTestId('parent-order')).toHaveText('b,c,a');
	await page.mouse.up();
	await expect(rows.nth(2)).toHaveAttribute('data-original', 'a');
	await expect(page.locator('div.pointer-events-none')).toHaveCount(0);
	expect(await page.evaluate('window.dragResult')).toEqual(['b', 'c', 'a']);
	await expect(page.getByTestId('parent-order')).toHaveText('b,c,a');
	expect(errors).toEqual([]);
});
