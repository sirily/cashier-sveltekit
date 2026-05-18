import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, expect, test } from 'vitest';

const root = process.cwd();
const routesRoot = join(root, 'src', 'routes');
const sourceRoots = [join(root, 'src', 'routes'), join(root, 'src', 'lib', 'components')];
const routeParamPattern = /\[\[?([^\]=]+)(?:=[^\]]+)?\]?\]/g;
const hrefPattern = /(?:href|targetNav)="(\/[^"#?]*)"/g;
const gotoPattern = /goto\(\s*['`](\/[^'`?#]*)['`]/g;

function walkFiles(dir: string, predicate: (file: string) => boolean): string[] {
	return readdirSync(dir).flatMap((entry) => {
		const path = join(dir, entry);
		const stat = statSync(path);
		if (stat.isDirectory()) return walkFiles(path, predicate);
		return predicate(path) ? [path] : [];
	});
}

function routeFromPage(file: string): string {
	const dir = relative(routesRoot, file).split(sep).slice(0, -1).join('/');
	const route = '/' + dir.replace(routeParamPattern, (_, name: string) => `:${name}`);
	return route.replace(/\/+/g, '/');
}

function normalizeRoute(route: string): string {
	return route === '/' ? route : route.replace(/\/$/, '');
}

function routeExists(route: string, routes: Set<string>): boolean {
	const normalized = normalizeRoute(route);
	if (routes.has(normalized)) return true;
	const routeSegments = normalized.split('/').filter(Boolean);
	return [...routes].some((candidate) => {
		const candidateSegments = candidate.split('/').filter(Boolean);
		// Exact match with params
		if (
			candidateSegments.length === routeSegments.length &&
			candidateSegments.every((segment, index) => segment.startsWith(':') || segment === routeSegments[index])
		) {
			return true;
		}
		// Optional trailing param (e.g., /scx-editor/:id matches /scx-editor)
		if (
			candidateSegments.length === routeSegments.length + 1 &&
			candidateSegments[candidateSegments.length - 1].startsWith(':') &&
			candidateSegments.slice(0, -1).every((segment, index) => segment === routeSegments[index])
		) {
			return true;
		}
		return false;
	});
}

describe('visible route inventory', () => {
	test('internal visible navigation targets existing pages', () => {
		const pageFiles = walkFiles(routesRoot, (file) => file.endsWith('+page.svelte'));
		const routes = new Set(pageFiles.map((file) => normalizeRoute(routeFromPage(file))));
		const sourceFiles = sourceRoots.flatMap((dir) =>
			walkFiles(dir, (file) => file.endsWith('.svelte') || file.endsWith('.ts'))
		);

		const targets = sourceFiles.flatMap((file) => {
			const text = readFileSync(file, 'utf8');
			return [...text.matchAll(hrefPattern), ...text.matchAll(gotoPattern)]
				.map((match) => match[1])
				.filter((target) => target !== '/' && !target.includes('+'))
				.filter((target) => !text.includes(`${target}/`))
				.map((target) => ({ file: relative(root, file), target: normalizeRoute(target) }));
		});

		const missing = targets.filter(({ target }) => !routeExists(target, routes));

		expect(missing).toEqual([]);
	});
});
