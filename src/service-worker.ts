/// <reference lib="webworker" />
import { assets, immutable } from '$app/manifest';
import {
	cleanupOutdatedCaches,
	createHandlerBoundToURL,
	precacheAndRoute
} from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';

declare const self: ServiceWorkerGlobalScope;
declare const __STATIC_REVISIONS__: Record<string, string>;
declare const __BUILD_TIMESTAMP__: string;

const SHELL = '/index.html';
const MANIFEST = '/manifest.webmanifest';
const toUrl = ({ path }: { path: string }) => (path.startsWith('/') ? path : `/${path}`);
const build = immutable.map(toUrl);
const files = assets.map(toUrl);

function hash(input: string): string {
	let value = 5381;
	for (let i = 0; i < input.length; i++) value = ((value << 5) + value + input.charCodeAt(i)) | 0;
	return (value >>> 0).toString(36);
}

const revision = hash(build.join('|'));
precacheAndRoute([
	...build.map((url) => ({ url, revision: url.includes('/immutable/') ? null : revision })),
	...files.map((url) => ({ url, revision: __STATIC_REVISIONS__[url] ?? revision })),
	{ url: MANIFEST, revision: __STATIC_REVISIONS__[MANIFEST] ?? revision },
	{ url: SHELL, revision }
]);
cleanupOutdatedCaches();
registerRoute(new NavigationRoute(createHandlerBoundToURL(SHELL)));

self.addEventListener('message', (event) => {
	if (event.data?.type === 'SKIP_WAITING') void self.skipWaiting();
	if (event.data?.type === 'GET_BUILD_TIMESTAMP') event.ports[0]?.postMessage(__BUILD_TIMESTAMP__);
});
