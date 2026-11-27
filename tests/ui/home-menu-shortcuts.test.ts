import { expect, test, type Page } from '@playwright/test';
import { navigateFromDrawer } from './fixtures/navigation';
import { waitForOfflineControl } from './fixtures/offline';

async function openHomeMenu(page: Page, label: string) {
	const main = page.getByRole('main');
	await main.locator('.dropdown > button').click();
	await main.getByRole('link', { name: label, exact: true }).click();
}

test('Reports has the same five destinations on Home and the standalone page', async ({ page }) => {
	await page.goto('/');
	await openHomeMenu(page, 'Home Settings');
	const main = page.getByRole('main');
	await main.getByRole('checkbox', { name: 'Reports', exact: true }).check();
	await main.getByRole('button', { name: 'Save Home Settings' }).click();
	const onHome = main.locator('article.card').filter({
		has: page.getByRole('link', { name: 'Reports', exact: true })
	});
	const destinations = [
		['Queries', '/reports/query'],
		['Transaction Search', '/reports/tx-search'],
		['Assets', '/reports/assets'],
		['Expenses', '/reports/expenses'],
		['Income vs Expenses', '/reports/income-expense']
	] as const;
	for (const [name, href] of destinations) {
		await expect(onHome.getByRole('link', { name, exact: true })).toHaveAttribute('href', href);
	}
	await onHome.getByRole('link', { name: 'Queries', exact: true }).click();
	await expect(page).toHaveURL('/reports/query');
	await page.goBack();
	await onHome.getByRole('link', { name: 'Reports', exact: true }).click();
	await expect(page).toHaveURL('/reports');
	for (const [name, href] of destinations) {
		await expect(main.getByRole('link', { name, exact: true })).toHaveAttribute('href', href);
	}
});

test('content cards can be selected, reordered with built-in cards, and removed', async ({
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
	const cards = main.getByRole('region', { name: 'Home cards' }).locator(':scope > article');
	const reports = cards.filter({
		has: page.getByRole('heading', { name: 'Reports', exact: true })
	});
	const calculator = cards.filter({
		has: page.getByRole('heading', { name: 'Calculator', exact: true })
	});
	await expect(calculator.getByRole('button', { name: '=', exact: true })).toBeVisible();
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
	await expect(cards.getByRole('heading', { level: 2 })).toHaveText([
		'Calculator',
		'Account Groups',
		'Device Journal',
		'Reports'
	]);
	await reports.getByRole('link', { name: 'Queries', exact: true }).click();
	await expect(page).toHaveURL('/reports/query');
	await page.goBack();

	await openHomeMenu(page, 'Home Settings');
	await main.getByRole('checkbox', { name: 'Reports', exact: true }).uncheck();
	await main.getByRole('button', { name: 'Save Home Settings' }).click();
	await expect(page).toHaveURL('/');
	await expect(reports).toHaveCount(0);
	await expect(cards.getByRole('heading', { level: 2 })).toHaveText([
		'Calculator',
		'Account Groups',
		'Device Journal'
	]);
	await expect(calculator.getByRole('button', { name: '=', exact: true })).toBeVisible();
	await expect(page.locator('aside a[href="/reports"]')).toHaveCount(1);
	await navigateFromDrawer(page, 'Reports');
	await expect(page).toHaveURL('/reports');
});

async function seedCardBook(page: Page, extraBookText = '') {
	await page.goto('/');
	await expect(page.getByRole('main').getByText('The device journal is empty')).toBeVisible();
	await page.evaluate(async (extraBookText) => {
		const main =
			'option "operating_currency" "EUR"\n2000-01-01 open Assets:Investments:Fund FUND\n2000-01-01 open Assets:Cash EUR\n2000-01-01 open Expenses:Food EUR\n2025-01-01 price FUND 15 EUR\n2025-01-01 * "Broker" "Buy fund"\n  Assets:Investments:Fund  2 FUND {10 EUR}\n  Assets:Cash  -20 EUR\n';
		const local =
			'2025-01-02 ! "Local cafe" "Device draft"\n  Expenses:Food  2 EUR\n  Assets:Cash  -2 EUR\n';
		const root = await navigator.storage.getDirectory();
		for (const [path, content] of Object.entries({
			'main.bean': main + extraBookText,
			'cashier.bean': local,
			'allocation.toml':
				'[Allocation]\nallocation = 100\n[Allocation.Equity]\nallocation = 100\nsymbols = ["FUND"]\n'
		})) {
			const file = await root.getFileHandle(path, { create: true });
			const writer = await file.createWritable();
			await writer.write(content);
			await writer.close();
		}
		const db = await new Promise<IDBDatabase>((resolve, reject) => {
			const open = indexedDB.open('Cashier');
			open.onsuccess = () => resolve(open.result);
			open.onerror = () => reject(open.error);
		});
		try {
			await new Promise<void>((resolve, reject) => {
				const tx = db.transaction('settings', 'readwrite');
				for (const [key, value] of Object.entries({
					userBookFilename: 'main.bean',
					currency: 'EUR',
					dateFormat: 'YYYY-MM-DD',
					ledgerCacheEnabled: false,
					'aa.definition': 'allocation.toml',
					'aa.rootAccount': 'Assets:Investments',
					accountGroups: [{ title: 'Configured group', accounts: ['Assets:Cash'] }]
				}))
					tx.objectStore('settings').put({ key, value: JSON.stringify(value) });
				tx.oncomplete = () => resolve();
				tx.onerror = () => reject(tx.error);
			});
		} finally {
			db.close();
		}
	}, extraBookText);
	await page.reload();
	await expect(page.getByRole('main').getByText('Local cafe', { exact: true })).toBeVisible();
}

for (const width of [390, 1280]) {
	test('all 16 Home cards have usable content at ' + width + 'px', async ({ page }) => {
		await page.setViewportSize({ width, height: 844 });
		await page.addLocatorHandler(
			page.locator('.toast').filter({ hasText: 'App ready to work offline' }),
			async (toast) => {
				await toast.getByRole('button', { name: 'Close', exact: true }).click();
			}
		);
		await seedCardBook(page);
		await openHomeMenu(page, 'Home Settings');
		const main = page.getByRole('main');
		const options = main.getByRole('checkbox');
		await expect(options).toHaveCount(16);
		for (const option of await options.all()) await option.check();
		await main.getByRole('button', { name: 'Save Home Settings' }).click();
		await expect(page).toHaveURL('/');
		const region = main.getByRole('region', { name: 'Home cards' });
		const cards = region.locator(':scope > article');
		await expect(cards).toHaveCount(16);
		const card = (name: string) =>
			cards.filter({ has: page.getByRole('heading', { name, exact: true, level: 2 }) });

		await expect(card('Account Groups').getByText('Configured group')).toBeVisible();
		await expect(
			card('Device Journal').getByRole('img', { name: 'Incomplete entry' })
		).toBeVisible();
		await expect(card('Reports').getByRole('link', { name: 'Queries', exact: true })).toBeVisible();
		await card('Account Tree')
			.getByRole('button', { name: 'Collapse', exact: true })
			.first()
			.click();
		await expect(card('Account Tree').getByRole('link', { name: 'Cash', exact: true })).toHaveCount(
			0
		);
		await card('Account Tree').getByRole('button', { name: 'Expand', exact: true }).first().click();
		await expect(
			card('Account Tree').getByRole('link', { name: 'Cash', exact: true })
		).toBeVisible();
		await card('Accounts').getByRole('searchbox').fill('Cash');
		await expect(card('Accounts').getByRole('listitem')).toHaveCount(1);
		await expect(card('Accounts').getByRole('link', { name: /Assets:Cash/ })).toBeVisible();
		await expect(
			card('Asset Allocation').getByRole('link', { name: 'Equity', exact: true })
		).toBeVisible();
		if (width < 1024)
			await card('Asset Allocation').getByRole('button', { name: 'Allocation values' }).click();
		await expect(
			card('Asset Allocation').getByRole('cell', { name: '30.00', exact: true }).first()
		).toBeVisible();
		await card('Payees').getByRole('searchbox').fill('Local cafe');
		await expect(card('Payees').getByRole('listitem')).toHaveText(['Local cafe']);
		await expect(card('Server Sync')).toContainText('No synchronization results yet.');
		await expect(card('Backup').getByRole('textbox', { name: 'Backup filename' })).toHaveValue(
			/^cashier-backup_/
		);
		await expect(
			card('File Storage').getByRole('button', { name: 'main.bean', exact: true })
		).toBeVisible();
		await expect(card('Serialization')).toContainText(/Ledger loaded/);
		const calculator = card('Calculator');
		for (const key of ['2', '+', '3', '='])
			await calculator.getByRole('button', { name: key, exact: true }).click();
		await expect(calculator.getByRole('status', { name: 'Calculator result' })).toHaveText('5');
		await expect(
			card('Validation').getByRole('link', { name: 'Inspect parsed ledger' })
		).toHaveAttribute('href', '/ledger/multi');
		await expect(card('Validation')).toContainText('All clear!');
		await expect(card('Help').getByRole('heading', { name: 'Using Cashier' })).toBeVisible();
		await expect(card('About').locator('code')).not.toHaveText('');
		await expect(card('Settings')).toContainText('allocation.toml');
		await expect(card('Settings')).toContainText('YYYY-MM-DD');
		await expect(main.locator('.navbar')).toHaveCount(1);
		await expect
			.poll(() => main.evaluate((element) => element.scrollWidth <= element.clientWidth))
			.toBe(true);
		const create = main.getByRole('button', { name: 'New transaction', exact: true });
		const sync = main.getByRole('button', { name: 'Synchronize', exact: true });
		await create.click({ trial: true });
		await sync.click({ trial: true });
	});
}

async function selectHomeCards(page: Page, names: string[]) {
	await openHomeMenu(page, 'Home Settings');
	const main = page.getByRole('main');
	for (const name of names) await main.getByRole('checkbox', { name, exact: true }).check();
	await main.getByRole('button', { name: 'Save Home Settings' }).click();
	await expect(page).toHaveURL('/');
}

function homeCard(page: Page, name: string) {
	return page
		.getByRole('region', { name: 'Home cards' })
		.locator(':scope > article')
		.filter({
			has: page.getByRole('heading', { name, exact: true, level: 2 })
		});
}

async function seedSecondBook(page: Page) {
	await seedCardBook(page);
	await page.evaluate(async (content) => {
		const root = await navigator.storage.getDirectory();
		const file = await root.getFileHandle('second.bean', { create: true });
		const writer = await file.createWritable();
		await writer.write(content);
		await writer.close();
	}, 'option "operating_currency" "EUR"\n2000-01-01 open Assets:NewCash EUR\n2000-01-01 open Assets:Cash EUR\n2000-01-01 open Expenses:Food EUR\n2025-01-01 * "Second book" "Current data"\n  Assets:NewCash  99 EUR\n  Assets:Cash  -99 EUR\n');
	await selectHomeCards(page, ['Account Tree', 'Accounts', 'Settings']);
}

async function saveSecondBook(page: Page) {
	await homeCard(page, 'Settings').getByRole('link', { name: 'Settings', exact: true }).click();
	await page.getByRole('main').getByRole('button', { name: 'Select', exact: true }).first().click();
	await page.getByRole('button', { name: 'second.bean', exact: true }).click();
	await page.getByRole('main').locator('button.fixed').click();
	await expect(page).toHaveURL('/settings');
	await expect(page.getByRole('main').getByText('second.bean', { exact: true })).toBeVisible();
	await page.getByRole('main').locator('button.fixed').click();
	await expect(page).toHaveURL('/');
}

test('changing the selected book refreshes the warm Home ledger in the same document', async ({
	page
}) => {
	await page.setViewportSize({ width: 1280, height: 900 });
	await seedSecondBook(page);
	const tree = homeCard(page, 'Account Tree');
	const accounts = homeCard(page, 'Accounts');
	const settings = homeCard(page, 'Settings');
	await expect(tree.getByRole('link', { name: 'Investments', exact: true })).toBeVisible();
	await expect(accounts.getByRole('link', { name: /Assets:Investments:Fund/ })).toBeVisible();
	await expect(settings.getByText('main.bean', { exact: true })).toBeVisible();
	await page.evaluate(() => Reflect.set(window, 'testWarmBookSwitch', true));

	await saveSecondBook(page);
	await expect(settings.getByText('second.bean', { exact: true })).toBeVisible();
	await expect(
		tree.getByRole('link', { name: 'NewCash', exact: true }).locator('..')
	).toContainText('99 EUR');
	await expect(accounts.getByRole('link', { name: /Assets:NewCash/ })).toBeVisible();
	await expect(accounts.getByRole('link', { name: /Assets:Investments:Fund/ })).toHaveCount(0);
	expect(await page.evaluate(() => Reflect.get(window, 'testWarmBookSwitch'))).toBe(true);
});

test('changing the book refreshes an already-open Home in another tab without navigation', async ({
	page,
	context
}) => {
	await page.setViewportSize({ width: 1280, height: 900 });
	await seedSecondBook(page);
	await selectHomeCards(page, ['Asset Allocation']);
	const tree = homeCard(page, 'Account Tree');
	await expect(tree.getByRole('link', { name: 'Investments', exact: true })).toBeVisible();
	await page.evaluate(() => Reflect.set(window, 'testCrossTabBookSwitch', true));
	const before = await snapshotCardStorage(page);
	const other = await context.newPage();
	const detail = await context.newPage();
	try {
		await other.goto('/');
		await detail.goto('/');
		await homeCard(detail, 'Asset Allocation')
			.getByRole('link', { name: 'Equity', exact: true })
			.click();
		await expect(detail.getByRole('main')).toContainText(
			'Assets:Investments:Fund, 2 FUND — 30.00 EUR'
		);
		await saveSecondBook(other);
		await expect(detail.getByRole('main')).toContainText('The local book changed.');
		await expect(detail.getByRole('main')).not.toContainText('Assets:Investments:Fund, 2 FUND');
		await expect(homeCard(page, 'Settings')).toContainText('second.bean');
		await expect(
			tree.getByRole('link', { name: 'NewCash', exact: true }).locator('..')
		).toContainText('99 EUR');
		await expect(tree.getByRole('link', { name: 'Investments', exact: true })).toHaveCount(0);
		await expect(
			homeCard(page, 'Accounts').getByRole('link', { name: /Assets:NewCash/ })
		).toBeVisible();
		expect(await page.evaluate(() => Reflect.get(window, 'testCrossTabBookSwitch'))).toBe(true);
		expect((await snapshotCardStorage(page)).files).toEqual(before.files);
	} finally {
		await Promise.all([other.close(), detail.close()]);
	}
});

test('the Journal card reports syntax errors instead of a confirmed empty journal', async ({
	page
}) => {
	await seedCardBook(page);
	await page.evaluate(async (source) => {
		const file = await (await navigator.storage.getDirectory()).getFileHandle('cashier.bean');
		const writer = await file.createWritable();
		await writer.write(source);
		await writer.close();
	}, '2025-99-99 * "Bad date"\n  Assets:Cash 1 EUR\n  Expenses:Food -1 EUR\n');
	await page.reload();
	const journal = homeCard(page, 'Device Journal');
	await expect(journal.getByRole('alert')).toContainText(/Invalid journal source.*invalid date/i);
	await expect(journal.getByText('The device journal is empty')).toHaveCount(0);
});

test('Home Account Tree marks available balances incomplete when a book include is missing', async ({
	page
}) => {
	await seedCardBook(page, '\ninclude "missing-part.bean"\n');
	await selectHomeCards(page, ['Account Tree']);
	const tree = homeCard(page, 'Account Tree');
	const warning = tree.getByRole('alert');
	await expect(warning).toContainText('Account balances are incomplete.');
	await warning.getByText('Book diagnostics', { exact: true }).click();
	await expect(warning.getByText(/missing-part\.bean/)).toBeVisible();
	await expect(tree.getByRole('link', { name: 'Open Ledger Validation' })).toHaveAttribute(
		'href',
		'/util/validation'
	);
	await expect(tree.getByRole('link', { name: 'Cash', exact: true })).toBeVisible();
	await expect(tree.getByText('No accounts in the local book.')).toHaveCount(0);
});

test('Home account links do not initialize the journal when only hovered', async ({ page }) => {
	await page.setViewportSize({ width: 1280, height: 900 });
	await seedCardBook(page);
	await selectHomeCards(page, ['Account Tree', 'Accounts']);
	const treeLink = homeCard(page, 'Account Tree').getByRole('link', { name: 'Cash', exact: true });
	const listLink = homeCard(page, 'Accounts').getByRole('link', { name: /Assets:Cash/ });
	await expect(treeLink).toBeVisible();
	await expect(listLink).toBeVisible();
	await page.evaluate(async () =>
		(await navigator.storage.getDirectory()).removeEntry('cashier.bean')
	);
	for (const link of [treeLink, listLink]) {
		await expect(link).toHaveAttribute('data-sveltekit-preload-data', 'off');
		await link.hover();
	}
	await expect(page).toHaveURL('/');
	const stored = await snapshotCardStorage(page);
	expect(stored.files).not.toHaveProperty('cashier.bean');
	await treeLink.click();
	await expect(page).toHaveURL('/accounts/account-xacts/Assets%3ACash');
});

async function snapshotCardStorage(page: Page) {
	return page.evaluate(async () => {
		const root = await navigator.storage.getDirectory();
		const files: Record<string, number[]> = {};
		for await (const [name, handle] of root.entries()) {
			if (handle.kind === 'file') {
				const file = await (handle as FileSystemFileHandle).getFile();
				files[name] = [...new Uint8Array(await file.arrayBuffer())];
			}
		}
		const db = await new Promise<IDBDatabase>((resolve, reject) => {
			const open = indexedDB.open('Cashier');
			open.onsuccess = () => resolve(open.result);
			open.onerror = () => reject(open.error);
		});
		try {
			const settings = await new Promise<unknown[]>((resolve, reject) => {
				const request = db.transaction('settings').objectStore('settings').getAll();
				request.onsuccess = () => resolve(request.result);
				request.onerror = () => reject(request.error);
			});
			return {
				files,
				settings,
				databases: (await indexedDB.databases()).map(({ name }) => name).sort()
			};
		} finally {
			db.close();
		}
	});
}

test('the installed production PWA opens previously unused card bodies offline and isolates a failed ledger read', async ({
	page,
	context
}) => {
	await seedCardBook(page);
	await waitForOfflineControl(page);
	await openHomeMenu(page, 'Home Settings');
	const options = page.getByRole('main').getByRole('checkbox');
	await expect(options).toHaveCount(16);
	for (const option of await options.all()) await option.check();
	await context.addInitScript(() => {
		const post = Worker.prototype.postMessage;
		Worker.prototype.postMessage = function (
			this: Worker,
			message: unknown,
			options?: StructuredSerializeOptions | Transferable[]
		) {
			const request = message as { type?: string; bql?: string; id: number } | null;
			// Delay only the Payees query; the remaining cards use the real WASM worker.
			if (
				request?.type === 'query' &&
				request.bql?.includes('DISTINCT COALESCE(payee, narration)')
			) {
				const fail = () =>
					this.dispatchEvent(
						new MessageEvent('message', {
							data: { id: request.id, type: 'error', message: 'Test payee query failure' }
						})
					);
				window.addEventListener('test-fail-payee-query', fail, { once: true });
				return;
			}
			Reflect.apply(post, this, options === undefined ? [message] : [message, options]);
		};
	});
	const requests: string[] = [];
	context.on('request', (request) => {
		if (new URL(request.url()).pathname.startsWith('/api/')) requests.push(request.url());
	});
	// Confirm the layout while isolated from the network; none of the full section pages were visited.
	await context.setOffline(true);
	await page.getByRole('button', { name: 'Save Home Settings' }).click();
	await expect(page).toHaveURL('/');
	const before = await snapshotCardStorage(page);
	const offline = await context.newPage();
	try {
		const response = await offline.goto(new URL('/', page.url()).href);
		expect(response?.fromServiceWorker()).toBe(true);
		const cards = offline.getByRole('region', { name: 'Home cards' }).locator(':scope > article');
		await expect(cards).toHaveCount(16);
		const card = (name: string) =>
			cards.filter({ has: offline.getByRole('heading', { name, exact: true, level: 2 }) });
		const payees = card('Payees');
		await expect(payees.getByRole('status')).toHaveText('Loading payees…');
		await expect(card('Device Journal').getByText('Local cafe', { exact: true })).toBeVisible();
		await expect(
			card('Account Tree').getByRole('link', { name: 'Cash', exact: true })
		).toBeVisible();
		await expect(
			card('Asset Allocation').getByRole('link', { name: 'Equity', exact: true })
		).toBeVisible();
		await expect(
			card('File Storage').getByRole('button', { name: 'main.bean', exact: true })
		).toBeVisible();
		await expect(card('Validation').getByText('All clear!', { exact: true })).toBeVisible();
		await expect(card('Settings')).toContainText('allocation.toml');
		const calculator = card('Calculator');
		for (const key of ['6', '×', '7', '='])
			await calculator.getByRole('button', { name: key, exact: true }).click();
		await expect(calculator.getByRole('status', { name: 'Calculator result' })).toHaveText('42');
		await offline.evaluate(() => window.dispatchEvent(new Event('test-fail-payee-query')));
		await expect(payees.getByRole('alert')).toContainText('Test payee query failure');
		await expect(offline.getByRole('main').getByRole('alert')).toHaveCount(1);
		await calculator.getByRole('button', { name: 'AC', exact: true }).click();
		await expect(calculator.getByRole('status', { name: 'Calculator result' })).toHaveText('0');
		expect(await snapshotCardStorage(offline)).toEqual(before);
		expect(requests).toEqual([]);
	} finally {
		await offline.close();
		await context.setOffline(false);
	}
});
