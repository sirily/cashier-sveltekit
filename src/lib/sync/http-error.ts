/** Never include response bodies, URLs, or headers in HTTP failure diagnostics. */
export function syncHttpError(status: number, operation: string): Error {
	const detail =
		status === 401
			? 'Authentication failed. Check the API token in Server Sync settings and retry.'
			: status === 403
				? 'Access denied. Check the API token and server permissions, then retry.'
				: status === 503
					? 'Server unavailable. Check server configuration (including its API token) and retry.'
					: 'The server request failed. Check server availability and retry.';
	return new Error(`${operation}: HTTP ${status}. ${detail}`);
}
