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

test('renders detailed direct and transitive findings for CI logs', () => {
	const summary = summarizeAudit(
		result({
			status: 1,
			metadata: { high: 1, moderate: 1 },
			vulnerabilities: {
				'direct-pkg': {
					severity: 'high',
					range: '<2',
					isDirect: true,
					nodes: ['node_modules/direct-pkg'],
					fixAvailable: { name: 'direct-pkg', version: '2.0.0', isSemVerMajor: true },
					via: [
						{
							title: 'Unsafe advisory',
							url: 'https://example.test/advisories/GHSA-1234',
							source: 1243067,
							range: '<2'
						}
					]
				},
				transitive: {
					severity: 'moderate',
					range: '>=1 <3',
					isDirect: false,
					nodes: ['node_modules/a/node_modules/transitive'],
					fixAvailable: false,
					via: [{ title: 'CVE advisory' }]
				}
			}
		})
	);
	const rendered = renderSummary(summary);
	assert.match(rendered, /direct-pkg — high/);
	assert.match(rendered, /GHSA: GHSA-1234/);
	assert.doesNotMatch(rendered, /1243067/);
	assert.match(rendered, /https:\/\/example\.test\/advisories\/GHSA-1234/);
	assert.match(rendered, /Affected versions: <2/);
	assert.match(rendered, /node_modules\/direct-pkg/);
	assert.match(
		rendered,
		/Fix available: npm reports a fix: direct-pkg@2\.0\.0 \(major upgrade\); compatibility is not guaranteed/
	);
	assert.match(rendered, /transitive — moderate/);
	assert.match(rendered, /Fix available: no fix reported/);
	assert.match(rendered, /report-only and do not fail this job/);
});

test('preserves percent characters in advisory text and handles null fixes', () => {
	const rendered = renderSummary(
		summarizeAudit(
			result({
				metadata: { low: 1 },
				vulnerabilities: {
					pkg: {
						severity: 'low',
						isDirect: true,
						fixAvailable: null,
						via: [{ title: '100% safe', url: 'https://example.test/?value=100%25' }]
					}
				}
			})
		)
	);
	assert.match(rendered, /100% safe/);
	assert.match(rendered, /value=100%25/);
	assert.match(rendered, /Fix available: not specified/);
});

test('escapes workflow-command markers in advisory text', () => {
	const rendered = renderSummary(
		summarizeAudit(
			result({
				metadata: { low: 1 },
				vulnerabilities: {
					pkg: { severity: 'low', isDirect: true, via: [{ title: '::error::not a command' }] }
				}
			})
		)
	);
	assert.doesNotMatch(rendered, /::error::/);
});

test('fails closed for command errors, unexpected exit status, invalid JSON, missing metadata, and count mismatch', () => {
	assert.throws(() => summarizeAudit(result({ error: Error('spawn failed') })), /could not run/);
	assert.throws(() => summarizeAudit(result({ status: 2 })), /exit status 2/);
	assert.throws(() => summarizeAudit(result({ stdout: '{not json' })), /invalid JSON/);
	assert.throws(() => summarizeAudit(result({ stdout: '{}' })), /missing metadata/);
	assert.throws(
		() =>
			summarizeAudit(
				result({ stdout: JSON.stringify({ metadata: { vulnerabilities: { high: -1 } } }) })
			),
		/invalid vulnerability counts/
	);
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
