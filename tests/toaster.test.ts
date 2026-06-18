// @vitest-environment jsdom
import { beforeEach, describe, expect, test, vi } from 'vitest';

import { toaster } from '$lib/toaster-svelte';

describe('DaisyUI toaster', () => {
	beforeEach(() => {
		document.body.innerHTML = '<div id="toast-container"></div>';
		vi.useFakeTimers();
	});

	test('renders message text without interpreting HTML', () => {
		toaster.warning('<img src=x onerror=alert(1)>');

		const toast = document.querySelector('#toast-container .alert');
		expect(toast?.textContent).toBe('<img src=x onerror=alert(1)>');
		expect(toast?.querySelector('img')).toBeNull();

		vi.runOnlyPendingTimers();
		vi.useRealTimers();
	});
});
