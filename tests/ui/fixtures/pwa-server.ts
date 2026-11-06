import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';

const previewOrigin = 'http://127.0.0.1:4173';

export class PwaPreviewProxy {
	private server: Server | undefined;
	private workerVersion = 'baseline';

	async start(): Promise<string> {
		this.server = createServer((request, response) => void this.handle(request, response));
		await new Promise<void>((resolve, reject) => {
			this.server!.once('error', reject);
			this.server!.listen(0, '127.0.0.1', resolve);
		});
		const address = this.server.address();
		if (!address || typeof address === 'string')
			throw new Error('PWA proxy did not bind a TCP port');
		return `http://127.0.0.1:${address.port}`;
	}

	setWorkerVersion(version: string) {
		this.workerVersion = version;
	}

	async close(): Promise<void> {
		if (!this.server) return;
		const server = this.server;
		this.server = undefined;
		await new Promise<void>((resolve, reject) =>
			server.close((error) => (error ? reject(error) : resolve()))
		);
	}

	private async handle(request: IncomingMessage, response: ServerResponse) {
		try {
			const path = request.url ?? '/';
			const requestHeaders = new Headers(request.headers as HeadersInit);
			requestHeaders.delete('host');
			requestHeaders.delete('connection');
			requestHeaders.delete('content-length');
			if (path.split('?')[0] === '/service-worker.js') {
				requestHeaders.delete('if-none-match');
				requestHeaders.delete('if-modified-since');
			}
			const body =
				request.method === 'GET' || request.method === 'HEAD'
					? undefined
					: await new Promise<Buffer>((resolve, reject) => {
							const chunks: Buffer[] = [];
							request.on('data', (chunk: Buffer) => chunks.push(chunk));
							request.on('end', () => resolve(Buffer.concat(chunks)));
							request.on('error', reject);
						});
			const upstreamBody = body?.buffer.slice(
				body.byteOffset,
				body.byteOffset + body.byteLength
			) as ArrayBuffer | undefined;
			const upstream = await fetch(new URL(path, previewOrigin), {
				method: request.method,
				headers: requestHeaders,
				...(upstreamBody ? { body: upstreamBody } : {})
			});
			const headers = new Headers(upstream.headers);
			headers.delete('content-length');
			headers.delete('content-encoding');
			headers.delete('transfer-encoding');
			headers.delete('connection');
			if (path.split('?')[0] === '/service-worker.js') {
				headers.set('cache-control', 'no-cache, no-store, must-revalidate');
				response.writeHead(upstream.status, Object.fromEntries(headers.entries()));
				response.end(`${await upstream.text()}\n// pwa-test-worker-${this.workerVersion}\n`);
				return;
			}
			response.writeHead(upstream.status, Object.fromEntries(headers.entries()));
			if (request.method === 'HEAD') response.end();
			else response.end(Buffer.from(await upstream.arrayBuffer()));
		} catch {
			response.writeHead(502, { 'content-type': 'text/plain' });
			response.end('PWA preview proxy failed');
		}
	}
}
