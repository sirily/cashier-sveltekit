import { expect, test } from '@playwright/test';
import { navigateFromDrawer } from './fixtures/navigation';

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
