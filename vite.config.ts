import { sveltekit } from '@sveltejs/kit/vite';
import adapter from '@sveltejs/adapter-static';
import tailwindcss from '@tailwindcss/vite';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { defineConfig } from 'vite';
import type { UserConfig } from 'vite';

const BUILD_TIMESTAMP = new Date().toISOString();

function staticRevisions(): Record<string, string> {
	const root = path.resolve(import.meta.dirname, 'static');
	const result: Record<string, string> = {};
	const walk = (dir: string) => {
		for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
			const full = path.join(dir, entry.name);
			if (entry.isDirectory()) walk(full);
			else {
				const url = '/' + path.relative(root, full).split(path.sep).join('/');
				result[url] = crypto
					.createHash('sha1')
					.update(fs.readFileSync(full))
					.digest('hex')
					.slice(0, 12);
			}
		}
	};
	if (fs.existsSync(root)) walk(root);
	return result;
}

const manifest = {
	id: '/',
	name: 'Cashier',
	short_name: 'cashier',
	description: 'Mobile app for Ledger-cli',
	categories: ['personal finance'],
	start_url: '/',
	orientation: 'portrait',
	theme_color: '#076461',
	background_color: '#000000',
	display: 'standalone',
	scope: '/',
	prefer_related_applications: false,
	icons: [
		{ src: 'icons/icon-16.png', sizes: '16x16', type: 'image/png' },
		{ src: 'icons/icon-32.png', sizes: '32x32', type: 'image/png' },
		{ src: 'icons/icon-64.png', sizes: '64x64', type: 'image/png' },
		{ src: 'icons/favicon-96x96.png', sizes: '96x96', type: 'image/png' },
		{ src: 'icons/apple-icon-120x120.png', sizes: '120x120', type: 'image/png' },
		{ src: 'icons/favicon-128x128.png', sizes: '128x128', type: 'image/png' },
		{ src: 'icons/apple-icon-152x152.png', sizes: '152x152', type: 'image/png' },
		{ src: 'icons/apple-icon-167x167.png', sizes: '167x167', type: 'image/png' },
		{ src: 'icons/apple-icon-180x180.png', sizes: '180x180', type: 'image/png' },
		{ src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
		{ src: 'icons/icon-256x256.png', sizes: '256x256', type: 'image/png' },
		{ src: 'icons/icon-384x384.png', sizes: '384x384', type: 'image/png' },
		{ src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
		{ src: 'icons/maskable-icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
	]
};

const config: UserConfig = defineConfig({
	define: {
		__BUILD_TIMESTAMP__: JSON.stringify(BUILD_TIMESTAMP),
		__STATIC_REVISIONS__: JSON.stringify(staticRevisions())
	},
	server: {
		host: '0.0.0.0',
		fs: { allow: ['..', path.resolve(import.meta.dirname, '..', '..', '..', 'node_modules')] }
	},
	build: { sourcemap: false },
	plugins: [
		tailwindcss(),
		sveltekit({
			adapter: adapter({ fallback: 'index.html' }),
			serviceWorker: { register: false },
			prerender: { entries: ['*'] }
		}),
		{
			name: 'cashier-pwa-manifest',
			apply: 'build',
			generateBundle() {
				this.emitFile({
					type: 'asset',
					fileName: 'manifest.webmanifest',
					source: JSON.stringify(manifest)
				});
			}
		}
	]
});

export default config;
