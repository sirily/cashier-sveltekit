import { spawnSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';

const registry = 'https://registry.npmjs.org';
const severities = ['critical', 'high', 'moderate', 'low', 'info'];

export function summarizeAudit(result) {
	if (result.error) throw new Error(`npm audit could not run: ${result.error.message}`);
	if (result.status !== 0 && result.status !== 1)
		throw new Error(
			`npm audit failed with exit status ${result.status}: ${result.stderr || 'no details'}`
		);

	let report;
	try {
		report = JSON.parse(result.stdout);
	} catch {
		throw new Error('npm audit returned invalid JSON');
	}
	if (!report || typeof report !== 'object' || !report.metadata?.vulnerabilities)
		throw new Error('npm audit JSON is missing metadata.vulnerabilities');

	const totals = Object.fromEntries(
		severities.map((severity) => [severity, report.metadata.vulnerabilities[severity] ?? 0])
	);
	if (Object.values(totals).some((count) => !Number.isInteger(count) || count < 0))
		throw new Error('npm audit JSON contains invalid vulnerability counts');

	const vulnerabilities = Object.entries(report.vulnerabilities ?? {}).map(([name, item]) => ({
		name,
		severity: item.severity ?? 'unknown',
		range: item.range ?? 'not provided',
		isDirect: item.isDirect === true,
		nodes: item.nodes ?? [],
		fixAvailable: item.fixAvailable,
		via: (item.via ?? []).map((entry) =>
			typeof entry === 'string'
				? { title: entry }
				: {
						title: entry.title ?? entry.name ?? 'Advisory',
						range: entry.range,
						url: entry.url
					}
		)
	}));
	if (Object.values(totals).reduce((sum, count) => sum + count, 0) !== vulnerabilities.length)
		throw new Error('npm audit JSON vulnerability details do not match metadata counts');

	return { totals, vulnerabilities };
}

const safeText = (value) =>
	String(value)
		.replace(/::/g, ': :')
		.replace(/[\r\n]+/g, ' ');

export function renderSummary(summary) {
	const { totals, vulnerabilities } = summary;
	const total = Object.values(totals).reduce((sum, count) => sum + count, 0);
	const lines = [
		'## Dependency audit',
		'',
		`Registry: ${registry}; production and development dependencies are included.`,
		'',
		'| Severity | Count |',
		'| --- | ---: |',
		...severities.map((severity) => `| ${severity} | ${totals[severity]} |`),
		`| **Total** | **${total}** |`
	];

	for (const direct of [true, false]) {
		const entries = vulnerabilities.filter((item) => item.isDirect === direct);
		lines.push('', `### ${direct ? 'Direct' : 'Transitive'} dependencies`);
		if (!entries.length) {
			lines.push('', 'No vulnerabilities found.');
			continue;
		}
		for (const item of entries) {
			lines.push('', `#### ${safeText(item.name)} — ${safeText(item.severity)}`);
			lines.push(`- Affected versions: ${safeText(item.range)}`);
			lines.push(
				`- Dependency path(s): ${item.nodes.length ? item.nodes.map(safeText).join(', ') : direct ? 'direct dependency' : 'transitive dependency'}`
			);
			const fix = item.fixAvailable;
			if (fix === false) lines.push('- Fix available: no fix reported');
			else if (fix == null) lines.push('- Fix available: not specified');
			else if (fix === true)
				lines.push('- Fix available: npm reports a fix; compatibility is not guaranteed');
			else {
				const packageVersion = [fix.name, fix.version].filter(Boolean).join('@');
				const majorNote = fix.isSemVerMajor ? ' (major upgrade)' : '';
				lines.push(
					`- Fix available: npm reports a fix${packageVersion ? `: ${safeText(packageVersion)}` : ''}${majorNote}; compatibility is not guaranteed`
				);
			}
			for (const advisory of item.via) {
				lines.push(`- Advisory: ${safeText(advisory.title)}`);
				const ghsa = advisory.url?.match(/GHSA-[0-9A-Za-z-]+/i)?.[0];
				if (ghsa) lines.push(`- GHSA: ${safeText(ghsa)}`);
				if (advisory.range) lines.push(`- Advisory affected range: ${safeText(advisory.range)}`);
				if (advisory.url) lines.push(`- Link: ${safeText(advisory.url)}`);
			}
		}
	}
	lines.push(
		'',
		total
			? '> Findings are report-only and do not fail this job. Full details are shown here in the CI logs.'
			: '> No known vulnerabilities were reported.'
	);
	return lines.join('\n');
}

export function runAudit(runner = spawnSync) {
	return runner('npm', ['audit', '--package-lock-only', '--json', `--registry=${registry}`], {
		encoding: 'utf8',
		maxBuffer: 20 * 1024 * 1024
	});
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
	try {
		const summary = summarizeAudit(runAudit());
		const rendered = renderSummary(summary);
		console.log(rendered);
		if (process.env.GITHUB_STEP_SUMMARY)
			appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${rendered}\n`);
		const total = Object.values(summary.totals).reduce((sum, count) => sum + count, 0);
		if (total)
			console.log(
				`::warning::${safeText(`npm audit reported ${total} known vulnerabilities; see details above.`).replaceAll('%', '%25')}`
			);
	} catch (error) {
		console.error(error.message);
		process.exitCode = 1;
	}
}
