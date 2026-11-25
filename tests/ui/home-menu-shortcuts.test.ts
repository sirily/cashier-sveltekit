import { expect, test, type Page } from '@playwright/test';

async function openHomeMenu(page: Page, label: string) {
	const main = page.getByRole('main');
	await main.locator('.dropdown > button').click();
	await main.getByRole('link', { name: label, exact: true }).click();
}

test('menu shortcuts can be selected, reordered with built-in cards, and removed', async ({
	page
}) => {
	await page.setViewportSize({ width: 1280, height: 1000 });
	await page.goto('/');
	const main = page.getByRole('main');
	await expect(main.getByText('Device Journal', { exact: true })).toBeVisible();
	const drawerLinks = await page.locator('aside a').allTextContents();

	await openHomeMenu(page, 'Home Settings');
	await expect(page).toHaveURL('/home-settings');
	const options = main.locator('fieldset label');
	await expect(options).toHaveText([
		'Account Groups',
		'Journal',
		...drawerLinks
			.map((name) => name.trim())
			.filter((name) => !['Home', 'My Accounts', 'Journal'].includes(name))
	]);
	for (const label of ['Reports', 'Calculator']) {
		const checkbox = main.getByRole('checkbox', { name: label, exact: true });
		await expect(checkbox).not.toBeChecked();
		await checkbox.check();
	}
	await main.getByRole('button', { name: 'Save Home Settings' }).click();
	await expect(page).toHaveURL('/');
	const cards = main.locator('section.container > .card');
	const reports = cards.filter({ has: page.getByRole('link', { name: 'Reports', exact: true }) });
	await expect(main.locator('section.container > a.card')).toHaveText(['Calculator']);
	await expect(reports.locator('section a')).toHaveText([
		'Queries',
		'Transaction Search',
		'Assets',
		'Expenses',
		'Income vs Expenses'
	]);

	await openHomeMenu(page, 'Reorder Cards');
	await expect(page).toHaveURL('/home-reorder');
	const rows = main.getByRole('listitem');
	await expect(rows).toHaveText(['Account Groups', 'Journal', 'Reports', 'Calculator']);
	const handle = rows.last().getByRole('button', { name: 'Drag to reorder' });
	const from = (await handle.boundingBox())!;
	const to = (await rows.first().getByRole('button', { name: 'Drag to reorder' }).boundingBox())!;
	await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
	await page.mouse.down();
	await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 5 });
	await page.mouse.up();
	await expect(rows).toHaveText(['Calculator', 'Account Groups', 'Journal', 'Reports']);
	await main.getByRole('button', { name: 'Save Card Order' }).click();
	await expect(page).toHaveURL('/');
	await page.reload();
	await expect(cards).toHaveCount(4);
	await expect(cards.nth(0)).toHaveText('Calculator');
	await expect(cards.nth(1)).toContainText('Account Groups');
	await expect(cards.nth(2)).toContainText('Device Journal');
	await expect(cards.nth(3)).toContainText('Reports');
	await reports.getByRole('link', { name: 'Queries', exact: true }).click();
	await expect(page).toHaveURL('/reports/query');
	await page.goBack();

	await openHomeMenu(page, 'Home Settings');
	await main.getByRole('checkbox', { name: 'Reports', exact: true }).uncheck();
	await main.getByRole('button', { name: 'Save Home Settings' }).click();
	await expect(page).toHaveURL('/');
	await expect(reports).toHaveCount(0);
	await expect(main.locator('section.container > a.card')).toHaveText(['Calculator']);
	await expect(page.locator('aside a[href="/reports"]')).toHaveCount(1);
});
