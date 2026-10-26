import test from 'node:test';
import assert from 'node:assert/strict';
import { renderSummary, runAudit, summarizeAudit } from './audit-report.mjs';

function result({
	status = 0,
	metadata = {},
	vulnerabilities = {},
	stdout,
	stderr = '',
	error
} = {}) {
	return {
		status,
		stderr,
		error,
		stdout: stdout ?? JSON.stringify({ metadata: { vulnerabilities: metadata }, vulnerabilities })
	};
}

test('summarizes a clean audit', () => {
	const summary = summarizeAudit(result());
	assert.equal(
		Object.values(summary.totals).reduce((a, b) => a + b, 0),
		0
	);
	assert.match(renderSummary(summary), /No known vulnerabilities/);
});

test('accepts npm audit status 1 with complete vulnerability metadata', () => {
	const summary = summarizeAudit(
		result({
			status: 1,
			metadata: { high: 1, moderate: 1 },
			vulnerabilities: {
				'vulnerable-direct': {
					severity: 'high',
					range: '<2',
					isDirect: true,
					via: [{ title: 'A|advisory\nwith details' }]
				},
				transitive: { severity: 'moderate', isDirect: false, via: ['parent'] }
			}
		})
	);
	assert.equal(summary.totals.high, 1);
	assert.equal(summary.vulnerabilities.length, 2);
	const rendered = renderSummary(summary);
	assert.match(rendered, /\| vulnerable-direct \| high \| <2 \| A\\\|advisory with details \|/);
	assert.match(rendered, /### Transitive dependencies/);
	assert.match(rendered, /report-only and do not fail this job/);
});

test('fails closed for command errors, unexpected exit status, invalid JSON, missing metadata, and count mismatch', () => {
	assert.throws(() => summarizeAudit(result({ error: Error('spawn failed') })), /could not run/);
	assert.throws(() => summarizeAudit(result({ status: 2 })), /exit status 2/);
	assert.throws(() => summarizeAudit(result({ stdout: '{not json' })), /invalid JSON/);
	assert.throws(() => summarizeAudit(result({ stdout: '{}' })), /missing metadata/);
	assert.throws(
		() => summarizeAudit(result({ status: 1, metadata: { high: 1 } })),
		/do not match metadata counts/
	);
});

test('invokes npm audit using the lockfile only and the public registry', () => {
	let call;
	const output = runAudit((...args) => {
		call = args;
		return result();
	});
	assert.equal(output.status, 0);
	assert.equal(call[0], 'npm');
	assert.deepEqual(call[1], [
		'audit',
		'--package-lock-only',
		'--json',
		'--registry=https://registry.npmjs.org'
	]);
});
