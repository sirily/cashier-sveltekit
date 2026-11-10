import { expect, test } from '@playwright/test';
import { navigateFromDrawer } from './fixtures/navigation';

test('D6 About and Help describe daily use and retain application/update controls', async ({
	page
}) => {
	const pageErrors: string[] = [];
	page.on('pageerror', (error) => pageErrors.push(error.message));
	await page.goto('/about');
	const main = page.getByRole('main');
	await expect(main.getByRole('heading', { name: 'Cashier', exact: true })).toBeVisible();
	await expect(main).toContainText('personal finance assistant for Beancount');
	await expect(main).not.toContainText(/fork|upstream|Experiments|Ledger Import/i);
	await expect(main.locator('a[href="/ledger"], a[href="/ledger/multi"]')).toHaveCount(0);
	await expect(main.getByRole('link', { name: 'GitHub', exact: true })).toHaveAttribute(
		'href',
		'https://github.com/sirily/cashier-sveltekit'
	);
	await expect(main.getByRole('link', { name: 'Cashier contributors' })).toHaveAttribute(
		'href',
		'https://cashier.alensiljak.eu.org'
	);
	await expect(
		main.getByRole('link', { name: 'GNU Affero General Public License v3' })
	).toBeVisible();
	await expect(main.getByRole('heading', { name: 'Version', exact: true })).toBeVisible();
	await expect(main.locator('code')).not.toBeEmpty();
	await main.getByRole('button', { name: 'Check for updates', exact: true }).click();
	await expect(main.getByRole('button', { name: 'Check for updates', exact: true })).toBeEnabled();
	await expect(main).toContainText(
		/latest version|new version is available|Update checking is unavailable|Could not check for updates/
	);
	if (await main.getByRole('button', { name: 'Update', exact: true }).count()) {
		await expect(main.getByRole('button', { name: 'Update', exact: true })).toBeEnabled();
	}

	await main.getByRole('link', { name: 'Help', exact: true }).click();
	await expect(page).toHaveURL('/help');
	await expect(main.getByRole('heading', { name: 'Using Cashier', exact: true })).toBeVisible();
	await expect(main).not.toContainText(/fork|upstream|RustLedger|authoritative/i);
	for (const instruction of [
		'including while offline',
		'Clearing site data removes these local files',
		'Failed or rejected entries stay local',
		'not the journal or downloaded book',
		'excludes the API token',
		'Reload & Validate'
	]) {
		await expect(main).toContainText(instruction);
	}
	for (const [name, path] of [
		['Server Sync', '/sync'],
		['Journal', '/journal'],
		['Reports', '/reports'],
		['Journal export', '/export/journal'],
		['File Storage', '/opfs'],
		['Validation', '/util/validation'],
		['Settings', '/settings'],
		['About', '/about']
	]) {
		await expect(main.getByRole('link', { name, exact: true })).toHaveAttribute('href', path);
	}
	await main.getByRole('link', { name: 'Journal', exact: true }).click();
	await expect(page).toHaveURL('/journal');
	await expect(main.getByText('The device journal is empty')).toBeVisible();
	await page.goBack();
	await expect(page).toHaveURL('/help');
	await main.getByRole('link', { name: 'Validation', exact: true }).click();
	await expect(page).toHaveURL('/util/validation');
	await expect(main.getByRole('link', { name: 'Inspect parsed ledger' })).toBeVisible();
	await page.goBack();
	await main.getByRole('link', { name: 'About', exact: true }).click();
	await expect(page).toHaveURL('/about');
	await expect(main.getByRole('button', { name: 'Check for updates', exact: true })).toBeVisible();
	expect(pageErrors).toEqual([]);
});

for (const fixedClock of [false, true]) {
	test(`drawer navigation waits for ancestor motion and confirms routes; fixed clock=${fixedClock}`, async ({
		page
	}) => {
		await page.setViewportSize({ width: 1280, height: 1000 });
		if (fixedClock) await page.clock.setFixedTime(new Date('2026-10-28T12:00:00Z'));
		await page.goto('/');
		await expect(page.getByText('The device journal is empty')).toBeVisible();
		await page.evaluate(() => {
			const observations = {
				animationsStarted: 0,
				earlyClicks: [] as string[],
				clicks: [] as string[]
			};
			Object.assign(window, { drawerNavigationObservations: observations });
			const sidebar = document.querySelector('aside')!;
			sidebar.addEventListener(
				'click',
				(event) => {
					const summary = (event.target as Element).closest('summary');
					if (!summary) return;
					const list = summary.parentElement!.querySelector('ul')!;
					// Slow the ancestor deliberately: a stable link box alone is not readiness.
					const animation = list.animate(
						[
							{ transform: 'translateY(0)', offset: 0 },
							{ transform: 'translateY(0)', offset: 0.7 },
							{ transform: 'translateY(24px)', offset: 0.85 },
							{ transform: 'translateY(0)', offset: 1 }
						],
						{ duration: 1200 }
					);
					animation.id = 'drawer-expansion-regression';
					observations.animationsStarted++;
				},
				true
			);
			sidebar.addEventListener(
				'pointerdown',
				(event) => {
					const link = (event.target as Element).closest('a');
					if (!link) return;
					observations.clicks.push(link.pathname);
					if (
						link
							.closest('details')
							?.getAnimations({ subtree: true })
							.some(
								(animation) =>
									animation.id === 'drawer-expansion-regression' &&
									animation.playState === 'running'
							)
					) {
						observations.earlyClicks.push(link.pathname);
					}
				},
				true
			);
		});

		for (const [name, path] of [
			['File Storage', '/opfs'],
			['Journal', '/journal'],
			['Reports', '/reports'],
			['Validation', '/util/validation'],
			['File Storage', '/opfs']
		]) {
			await navigateFromDrawer(page, name);
			await expect(page).toHaveURL(path);
		}
		const observations = await page.evaluate(
			() =>
				(
					window as unknown as {
						drawerNavigationObservations: {
							animationsStarted: number;
							earlyClicks: string[];
							clicks: string[];
						};
					}
				).drawerNavigationObservations
		);
		expect(observations.animationsStarted).toBe(3);
		expect(observations.earlyClicks).toEqual([]);
		expect(observations.clicks).toEqual([
			'/opfs',
			'/journal',
			'/reports',
			'/util/validation',
			'/opfs'
		]);
	});
}
