import { expect, test, type Page } from '@playwright/test';

const lotBook = `option "operating_currency" "USD"
2000-01-01 open Assets:Investments:ABC ABC
2000-01-01 open Assets:Bank USD

2025-01-02 * "Broker" "First lot"
  Assets:Investments:ABC   2 ABC {10 USD}
  Assets:Bank           -20 USD

2025-01-03 * "Broker" "Second lot"
  Assets:Investments:ABC   3 ABC {15 USD}
  Assets:Bank           -45 USD
`;

async function seedGroups(page: Page, accounts: string[], book?: string) {
	await page.goto('/');
	await expect(page.getByText('The device journal is empty')).toBeVisible();
	await page.evaluate(
		async ({ accounts, book }) => {
			if (book !== undefined) {
				const root = await navigator.storage.getDirectory();
				const handle = await root.getFileHandle('main.bean', { create: true });
				const writer = await handle.createWritable();
				await writer.write(book);
				await writer.close();
			}
			const db = await new Promise<IDBDatabase>((resolve, reject) => {
				const request = indexedDB.open('Cashier');
				request.onsuccess = () => resolve(request.result);
				request.onerror = () => reject(request.error);
			});
			try {
				await new Promise<void>((resolve, reject) => {
					const transaction = db.transaction('settings', 'readwrite');
					for (const [key, value] of Object.entries({
						userBookFilename: 'main.bean',
						currency: 'USD',
						accountGroups: [{ title: 'Configured group', accounts }]
					})) {
						transaction.objectStore('settings').put({ key, value: JSON.stringify(value) });
					}
					transaction.oncomplete = () => resolve();
					transaction.onerror = () => reject(transaction.error);
				});
			} finally {
				db.close();
			}
		},
		{ accounts, book }
	);
}

for (const route of ['/', '/accounts/groups']) {
	test(`sums two lots of the same commodity on ${route}`, async ({ page }) => {
		await seedGroups(page, ['Assets:Investments:ABC'], lotBook);
		await page.goto(route);
		const group = page.locator('article.card').filter({ hasText: 'Configured group' }).last();
		await expect(group.locator('data')).toHaveText('5 ABC');
		await group.getByRole('button', { name: /ABC/ }).click();
		await expect(page).toHaveURL('/accounts/account-xacts/Assets%3AInvestments%3AABC');
		await expect(page.getByText('Broker | Second lot')).toBeVisible();
	});

	test(`distinguishes a missing book from an empty group on ${route}`, async ({ page }) => {
		await seedGroups(page, ['Assets:Bank']);
		await page.goto(route);
		const group = page.locator('article.card').filter({ hasText: 'Configured group' }).last();
		await expect(group.getByRole('alert')).toContainText('Selected book missing: main.bean');
		await expect(group.getByText('No accounts added')).toHaveCount(0);
		await expect(group.locator('data')).toHaveCount(0);
	});
}

test('a new installation can manage and edit groups without opening an unsaved group', async ({
	page
}) => {
	await page.goto('/');
	const manage = page.getByRole('main').getByRole('link', { name: 'Account Groups', exact: true });
	await expect(manage).toBeVisible();
	await expect(page.getByText('No groups configured.', { exact: false })).toBeVisible();
	await expect(page.getByRole('button', { name: 'Group settings' })).toHaveCount(0);
	expect(
		await page.evaluate(async () => {
			const db = await new Promise<IDBDatabase>((resolve, reject) => {
				const request = indexedDB.open('Cashier');
				request.onsuccess = () => resolve(request.result);
				request.onerror = () => reject(request.error);
			});
			try {
				return await new Promise((resolve, reject) => {
					const request = db.transaction('settings').objectStore('settings').get('accountGroups');
					request.onsuccess = () => resolve(request.result);
					request.onerror = () => reject(request.error);
				});
			} finally {
				db.close();
			}
		})
	).toBeUndefined();
	await manage.click();
	await expect(page).toHaveURL('/accounts/groups');
	const cash = page.locator('article.card').filter({ hasText: 'Cash Accounts' });
	await expect(cash.getByText('No accounts added')).toBeVisible();
	await cash.getByRole('button', { name: 'Group settings' }).click();
	await expect(page).toHaveURL('/accounts/groups/0');
	await expect(page.getByText('Cash Accounts', { exact: true })).toBeVisible();
});
