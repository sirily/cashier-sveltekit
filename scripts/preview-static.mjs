import { createServer } from 'node:http';
import sirv from 'sirv';

const host = '127.0.0.1';
const port = 4173;
const staticFiles = sirv('build', {
	extensions: ['html'],
	single: '200.html',
	ignores: false,
	setHeaders(response, pathname) {
		if (pathname.startsWith('/_app/immutable/')) {
			response.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
		} else {
			response.setHeader('Cache-Control', 'no-cache');
		}
	}
});

const server = createServer((request, response) => {
	staticFiles(request, response, () => {
		response.statusCode = 404;
		response.end();
	});
});

server.listen(port, host, () => {
	console.log(`Serving adapter-static build at http://${host}:${port}`);
});
