import { writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

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
		severity: item.severity,
		range: item.range ?? '',
		isDirect: item.isDirect === true,
		via: (item.via ?? []).map((entry) =>
			typeof entry === 'string' ? entry : (entry.title ?? entry.name ?? 'advisory')
		)
	}));
	if (Object.values(totals).reduce((sum, count) => sum + count, 0) !== vulnerabilities.length)
		throw new Error('npm audit JSON vulnerability details do not match metadata counts');

	return { report, totals, vulnerabilities };
}

const markdown = (value) =>
	String(value)
		.replaceAll('|', '\\|')
		.replace(/[\r\n]+/g, ' ');
const annotation = (value) =>
	String(value)
		.replaceAll('%', '%25')
		.replaceAll('\r', '%0D')
		.replaceAll('\n', '%0A')
		.replaceAll(':', '%3A')
		.replaceAll(',', '%2C');

export function renderSummary(summary) {
	const { totals, vulnerabilities } = summary;
	const total = Object.values(totals).reduce((sum, count) => sum + count, 0);
	const lines = [
		'## Dependency audit',
		'',
		`Registry: ${registry}; production and development dependencies are included.`,
		'',
		`| Severity | Count |`,
		`| --- | ---: |`,
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
		lines.push('', '| Package | Severity | Range | Advisory |', '| --- | --- | --- | --- |');
		for (const item of entries.slice(0, 50))
			lines.push(
				`| ${markdown(item.name)} | ${markdown(item.severity)} | ${markdown(item.range)} | ${markdown(item.via.join(', ') || '—')} |`
			);
		if (entries.length > 50)
			lines.push(
				'',
				`Showing 50 of ${entries.length}; download the full JSON artifact for all findings.`
			);
	}
	lines.push(
		'',
		total
			? '> Vulnerabilities are report-only and do not fail this job. See the JSON artifact for complete audit details.'
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
		const outputPath = process.argv[2];
		if (!outputPath) throw new Error('Usage: node scripts/audit-report.mjs <report-output-path>');
		const result = runAudit();
		const summary = summarizeAudit(result);
		writeFileSync(outputPath, `${JSON.stringify(summary.report, null, 2)}\n`);
		if (process.env.GITHUB_STEP_SUMMARY)
			writeFileSync(process.env.GITHUB_STEP_SUMMARY, `${renderSummary(summary)}\n`);
		const total = Object.values(summary.totals).reduce((sum, count) => sum + count, 0);
		if (total)
			console.log(
				`::warning::${annotation(`npm audit reported ${total} known vulnerabilities; see the summary and audit-report artifact.`)}`
			);
		else console.log('npm audit reported no known vulnerabilities.');
	} catch (error) {
		console.error(error.message);
		process.exitCode = 1;
	}
}
