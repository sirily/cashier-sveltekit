// Same-origin invalidation hint only. The receiving tab reloads from IndexedDB and OPFS.
const channelName = 'cashier:book-selection';
let channel: BroadcastChannel | undefined;

function openChannel(): BroadcastChannel | undefined {
	if (typeof window === 'undefined' || typeof window.BroadcastChannel !== 'function') return;
	try {
		return new window.BroadcastChannel(channelName);
	} catch {
		// The notification channel may be unavailable in a restricted browsing context.
		return undefined;
	}
}

/** The root layout owns the receiving channel for this document. */
export function observeBookSelectionChanges(onChange: () => void): () => void {
	const listener = (event: MessageEvent<unknown>) => {
		if (event.data === 'changed') onChange();
	};
	const current = (channel ??= openChannel());
	current?.addEventListener('message', listener);
	return () => {
		current?.removeEventListener('message', listener);
		current?.close();
		if (channel === current) channel = undefined;
	};
}

/** Send only after a durable change, using the same channel so the sender is not notified. */
export function notifyBookSelectionChanged(): void {
	const sender = channel ?? openChannel();
	try {
		sender?.postMessage('changed');
	} catch {
		// An unavailable notification channel must not turn a durable save into a failure.
	} finally {
		if (sender !== channel) sender?.close();
	}
}
