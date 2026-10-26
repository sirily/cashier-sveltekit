import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
	semver,
	packageVersion,
	planRc,
	planFinal,
	checkImage,
	imageStatus,
	finishFinal
} from './release.mjs';

const commit = 'a'.repeat(40),
	parent = 'b'.repeat(40),
	mergeParent = 'd'.repeat(40),
	digest = `sha256:${'c'.repeat(64)}`;
const version = '1.0.0',
	repo = 'owner/repository',
	image = 'ghcr.io/owner/repository';
const baseEnv = {
	GITHUB_REPOSITORY: repo,
	GITHUB_REF: 'refs/heads/main',
	GITHUB_REF_NAME: 'main',
	GITHUB_EVENT_NAME: 'push',
	GITHUB_SHA: commit,
	RELEASE_SHA: commit,
	RELEASE_TAG: version,
	RELEASE_IMAGE: image,
	IMAGE_DIGEST: digest,
	GH_TOKEN: 'test-token'
};
const pr = {
	merged_at: '2026-01-01T00:00:00Z',
	base: { ref: 'main', repo: { full_name: repo } },
	head: { ref: `releases/${version}`, sha: parent, repo: { full_name: repo } },
	merge_commit_sha: commit
};
const manifest = {
	annotations: {
		'org.opencontainers.image.revision': commit,
		'org.opencontainers.image.source': `https://github.com/${repo}`,
		'org.opencontainers.image.version': version
	},
	manifests: [
		{ platform: { os: 'linux', architecture: 'amd64' } },
		{ platform: { os: 'linux', architecture: 'arm64' } }
	]
};
const output = () => {
	const values = [];
	return {
		values,
		write: (value) => {
			values.push(value);
			return true;
		}
	};
};
function withOutput(fn) {
	const old = process.stdout.write,
		result = output();
	process.stdout.write = result.write;
	try {
		fn();
	} finally {
		process.stdout.write = old;
	}
	return result.values.join('');
}
function fixture() {
	const cwd = mkdtempSync(path.join(tmpdir(), 'release-test-'));
	writeFileSync(path.join(cwd, 'package.json'), JSON.stringify({ version }));
	writeFileSync(
		path.join(cwd, 'package-lock.json'),
		JSON.stringify({ version, packages: { '': { version } } })
	);
	return { cwd, clean: () => rmSync(cwd, { recursive: true, force: true }) };
}
function makeRunner({
	tags = [],
	imagePresent = true,
	latestPresent = true,
	moved = false,
	moveAfterFirstMain = false,
	releaseExists = false,
	tagType = 'commit',
	tagSha = commit,
	manifestValue = manifest,
	associatedPrs = [pr]
} = {}) {
	const calls = [];
	let mainReads = 0;
	const runner = (command, args) => {
		calls.push([command, args]);
		if (command === 'gh' && args[0] === 'api') {
			const endpoint = args[1];
			if (endpoint === `repos/${repo}/git/ref/heads/main`) {
				mainReads++;
				return JSON.stringify({
					object: { sha: moved || (moveAfterFirstMain && mainReads > 1) ? parent : commit }
				});
			}
			if (endpoint === `repos/${repo}/commits/${commit}/pulls`)
				return JSON.stringify([associatedPrs]);
			if (endpoint === `repos/${repo}/git/matching-refs/tags/v`)
				return JSON.stringify(tags.map((tag) => ({ ref: `refs/tags/v${tag}` })));
			if (endpoint === `repos/${repo}/git/refs`) return '{}';
			if (endpoint === `repos/${repo}/git/ref/tags/v${version}`)
				return JSON.stringify({ object: { type: tagType, sha: tagSha } });
		}
		if (command === 'gh' && args[0] === 'release') {
			if (args[1] === 'view' && releaseExists) return 'ok';
			if (args[1] === 'create' && releaseExists) throw Error('release already exists');
			if (args[1] === 'view') throw Error('release not found (404)');
			return 'created';
		}
		if (command === 'docker' && args.includes('inspect')) {
			const raw = args.includes('--raw');
			if (raw) return JSON.stringify(manifestValue);
			if (args.at(-1).endsWith(':latest') && !latestPresent) throw Error('manifest unknown');
			if (args.at(-1).endsWith(`:${version}`) && !imagePresent) throw Error('manifest unknown');
			return `Digest: ${digest}`;
		}
		if (command === 'docker' && args.includes('create')) return 'created';
		throw Error(`unexpected ${command} ${args.join(' ')}`);
	};
	return { runner, calls };
}

test('accepts strict stable semantic versions only', () => {
	assert.equal(semver('1.2.3'), '1.2.3');
	for (const invalid of ['01.2.3', '1.02.3', 'v1.2.3', '1.2', '1.2.3-rc.1'])
		assert.throws(() => semver(invalid), /Invalid release version/);
});
test('packageVersion rejects mismatches in package and either lockfile version', () => {
	const f = fixture();
	try {
		assert.equal(packageVersion(f.cwd), version);
		for (const change of [
			['package.json', { version: '2.0.0' }],
			['package-lock.json', { version: '2.0.0', packages: { '': { version } } }],
			['package-lock.json', { version, packages: { '': { version: '2.0.0' } } }]
		]) {
			writeFileSync(path.join(f.cwd, change[0]), JSON.stringify(change[1]));
			assert.throws(() => packageVersion(f.cwd), /package.json and both package-lock.json/);
			writeFileSync(path.join(f.cwd, 'package.json'), JSON.stringify({ version }));
			writeFileSync(
				path.join(f.cwd, 'package-lock.json'),
				JSON.stringify({ version, packages: { '': { version } } })
			);
		}
	} finally {
		f.clean();
	}
});
test('plan-rc requires a validated matching release branch and allowed event', () => {
	const fixturePackage = fixture();
	const env = {
		...baseEnv,
		GITHUB_EVENT_NAME: 'push',
		GITHUB_REF_NAME: `releases/${version}`,
		GITHUB_REF: `refs/heads/releases/${version}`,
		GITHUB_RUN_NUMBER: '19'
	};
	try {
		const result = withOutput(() => planRc(env, () => version));
		assert.match(result, /tag=1\.0\.0-rc\.19/);
		assert.throws(
			() => planRc({ ...env, GITHUB_EVENT_NAME: 'pull_request' }, () => version),
			/RC plan requires/
		);
		assert.throws(
			() => planRc({ ...env, GITHUB_REF: 'refs/heads/releases/1x0x0' }, () => version),
			/RC plan requires/
		);
	} finally {
		fixturePackage.clean();
	}
});
test('plan-final accepts a squash-merged release whose PR head differs from the merge SHA', () => {
	const fixturePackage = fixture();
	const squashPr = { ...pr, head: { ...pr.head, sha: mergeParent } };
	const { runner, calls } = makeRunner({ associatedPrs: [squashPr] });
	try {
		const result = withOutput(() =>
			planFinal(baseEnv, runner, () => packageVersion(fixturePackage.cwd))
		);
		assert.match(result, /eligible=true/);
		assert.ok(
			calls.every(
				([, args]) =>
					!args.includes('repos') || (typeof args[1] === 'string' && args[1].startsWith('repos/'))
			)
		);
		assert.equal(
			calls.some(([, args]) => args[1] === `repos/${repo}/git/commits/${commit}`),
			false,
			'eligibility must not depend on merge-commit parents'
		);
	} finally {
		fixturePackage.clean();
	}
});
test('plan-final rejects PRs that are unmerged, target another base, come from forks, use another branch, or name another merge SHA', () => {
	const fixturePackage = fixture();
	const invalidPrs = [
		{ ...pr, merged_at: null },
		{ ...pr, base: { ...pr.base, ref: 'develop' } },
		{ ...pr, head: { ...pr.head, repo: { full_name: 'fork/repository' } } },
		{ ...pr, head: { ...pr.head, ref: 'feature/release' } },
		{ ...pr, merge_commit_sha: parent }
	];
	try {
		for (const invalidPr of invalidPrs) {
			const { runner } = makeRunner({ associatedPrs: [invalidPr] });
			const result = withOutput(() =>
				planFinal(baseEnv, runner, () => packageVersion(fixturePackage.cwd))
			);
			assert.match(result, /eligible=false/);
		}
		for (const env of [
			{ ...baseEnv, GITHUB_REF: 'refs/heads/releases/1.0.0' },
			{ ...baseEnv, GITHUB_EVENT_NAME: 'pull_request' }
		]) {
			const { runner, calls } = makeRunner();
			const result = withOutput(() => planFinal(env, runner));
			assert.match(result, /eligible=false/);
			assert.equal(
				calls.some(([, args]) => args[1]?.endsWith('/pulls')),
				false
			);
		}
	} finally {
		fixturePackage.clean();
	}
});
test('plan-final skips ordinary main pushes', () => {
	const seen = [];
	const runner = (command, args) => {
		seen.push([command, args]);
		return JSON.stringify({ object: { sha: commit } });
	};
	const result = withOutput(() => planFinal(baseEnv, runner));
	assert.equal(seen[0][1][1], `repos/${repo}/git/ref/heads/main`);
	assert.match(result, /eligible=false/);
});
test('image inspection fetches and validates immutable digest metadata', () => {
	const seen = [];
	const result = checkImage(
		{ image, tag: version, sha: commit, version, repo },
		(command, args) => {
			seen.push(args);
			return args.includes('--raw') ? JSON.stringify(manifest) : `Digest: ${digest}`;
		}
	);
	assert.deepEqual(result, { exists: true, digest });
	assert.equal(seen[1].at(-1), `${image}@${digest}`);
});
test('image status distinguishes missing manifests from authorization failures', () => {
	const input = { image, tag: version, sha: commit, version, repo };
	assert.deepEqual(
		checkImage(input, () => {
			throw Error('manifest unknown');
		}),
		{ exists: false }
	);
	assert.throws(
		() =>
			checkImage(input, () => {
				throw Error('unauthorized');
			}),
		/unauthorized/
	);
});
test('image metadata collision and missing platforms fail closed', () => {
	const input = { image, tag: version, sha: commit, version, repo };
	assert.throws(
		() =>
			checkImage(input, (_, args) =>
				args.includes('--raw')
					? JSON.stringify({ ...manifest, manifests: [] })
					: `Digest: ${digest}`
			),
		/missing required platforms/
	);
	assert.throws(
		() =>
			checkImage({ ...input, sha: parent }, (_, args) =>
				args.includes('--raw') ? JSON.stringify(manifest) : `Digest: ${digest}`
			),
		/tag collision/
	);
});
test('image status checks RC annotation against the full tag', () => {
	const rcTag = `${version}-rc.19`,
		env = { ...baseEnv, RELEASE_TAG: rcTag };
	const rcManifest = {
		...manifest,
		annotations: { ...manifest.annotations, 'org.opencontainers.image.version': rcTag }
	};
	const { runner } = makeRunner({ manifestValue: rcManifest });
	const result = withOutput(() =>
		assert.deepEqual(imageStatus(env, runner), { exists: true, digest })
	);
	assert.match(result, /exists=true/);
});
test('image status permits an exact final Git-tag retry only with its existing image', () => {
	const { runner } = makeRunner({ tags: [version] });
	assert.deepEqual(imageStatus(baseEnv, runner), { exists: true, digest });
});
test('image status blocks missing final image for an existing tag and rejects a conflicting tag', () => {
	const missing = makeRunner({ tags: [version], imagePresent: false });
	assert.throws(() => imageStatus(baseEnv, missing.runner), /image .* is missing/i);
	const conflict = makeRunner({ tags: [version], tagSha: parent });
	assert.throws(() => imageStatus(baseEnv, conflict.runner), /Refusing existing Git tag/);
	assert.equal(
		conflict.calls.some(([, args]) => args[0] === 'docker'),
		false
	);
});
test('manifest absence is recognized only on the initial tag lookup', () => {
	assert.throws(
		() =>
			checkImage({ image, tag: version, sha: commit, version, repo }, (_, args) => {
				if (!args.includes('--raw')) return `Digest: ${digest}`;
				throw Error('manifest unknown');
			}),
		/manifest unknown/
	);
});
test('finish-final creates a Git tag, release, and latest only for a verified new final', () => {
	const f = fixture(),
		{ runner, calls } = makeRunner();
	try {
		finishFinal(baseEnv, runner, () => packageVersion(f.cwd));
		assert.ok(
			calls.some(
				([cmd, args]) =>
					cmd === 'gh' &&
					args[1] === `repos/${repo}/git/refs` &&
					args.includes(`ref=refs/tags/v${version}`)
			)
		);
		assert.ok(
			calls.some(([cmd, args]) => cmd === 'gh' && args[0] === 'release' && args[1] === 'create')
		);
		assert.ok(calls.some(([cmd, args]) => cmd === 'docker' && args.includes(`${image}:latest`)));
	} finally {
		f.clean();
	}
});
test('finish-final accepts squash merge SHA independently of the release branch head SHA', () => {
	const f = fixture();
	const squashPr = { ...pr, head: { ...pr.head, sha: mergeParent } };
	const { runner, calls } = makeRunner({ associatedPrs: [squashPr] });
	try {
		finishFinal(baseEnv, runner, () => packageVersion(f.cwd));
		assert.ok(calls.some(([cmd, args]) => cmd === 'gh' && args[1] === `repos/${repo}/git/refs`));
	} finally {
		f.clean();
	}
});
test('finish-final permits an exact existing commit tag without recreating it or the release', () => {
	const f = fixture(),
		{ runner, calls } = makeRunner({ tags: [version], releaseExists: true });
	try {
		finishFinal(baseEnv, runner, () => packageVersion(f.cwd));
		assert.equal(
			calls.filter(
				([cmd, args]) =>
					cmd === 'gh' && args[1] === `repos/${repo}/git/refs` && args.includes('POST')
			).length,
			0
		);
		assert.equal(
			calls.filter(([cmd, args]) => cmd === 'gh' && args[0] === 'release' && args[1] === 'create')
				.length,
			0
		);
		assert.ok(calls.some(([cmd, args]) => cmd === 'docker' && args.includes(`${image}:latest`)));
	} finally {
		f.clean();
	}
});
test('finish-final rejects a conflicting existing tag, newer version, and moved main without writes', () => {
	const f = fixture();
	try {
		for (const [options, pattern] of [
			[{ tags: [version] }, /existing Git tag/],
			[{ tags: ['1.10.0'] }, /newer final version/],
			[{ moved: true }, /not current main/]
		]) {
			const { runner: baseRunner, calls } = makeRunner(options);
			const runner =
				options.tags?.[0] === version
					? (command, args, opts) => {
							if (command === 'gh' && args[1] === `repos/${repo}/git/ref/tags/v${version}`)
								return JSON.stringify({ object: { type: 'tag', sha: parent } });
							return baseRunner(command, args, opts);
						}
					: baseRunner;
			assert.throws(() => finishFinal(baseEnv, runner, () => packageVersion(f.cwd)), pattern);
			assert.equal(
				calls.some(([cmd, args]) => cmd === 'gh' && args[1] === `repos/${repo}/git/refs`),
				false
			);
		}
	} finally {
		f.clean();
	}
});
test('finish-final rejects wrong package version, image digest, and image tag collisions', () => {
	const f = fixture();
	try {
		const { runner } = makeRunner();
		assert.throws(() => finishFinal(baseEnv, runner, () => '2.0.0'), /package metadata/);
		assert.throws(
			() =>
				finishFinal({ ...baseEnv, IMAGE_DIGEST: 'sha256:bad' }, runner, () =>
					packageVersion(f.cwd)
				),
			/digest/
		);
		assert.throws(
			() => finishFinal({ ...baseEnv, RELEASE_TAG: '2.0.0' }, runner, () => packageVersion(f.cwd)),
			/matching merged release PR/
		);
	} finally {
		f.clean();
	}
});
test('finish-final stops before updating latest if main moves after creating the release', () => {
	const f = fixture(),
		{ runner, calls } = makeRunner({ moveAfterFirstMain: true });
	try {
		assert.throws(
			() => finishFinal(baseEnv, runner, () => packageVersion(f.cwd)),
			/main moved before updating latest/
		);
		assert.ok(
			calls.some(([cmd, args]) => cmd === 'gh' && args[0] === 'release' && args[1] === 'create')
		);
		assert.equal(
			calls.some(([cmd, args]) => cmd === 'docker' && args.includes(`${image}:latest`)),
			false
		);
	} finally {
		f.clean();
	}
});
test('finish-final fails closed on auth/network image errors and does not publish ordinary main', () => {
	const { runner } = makeRunner();
	assert.throws(
		() =>
			finishFinal(
				baseEnv,
				(command, args) => {
					if (command === 'docker') throw Error('unauthorized');
					return runner(command, args);
				},
				() => version
			),
		/unauthorized/
	);
	assert.throws(
		() => finishFinal({ ...baseEnv, GITHUB_EVENT_NAME: 'schedule' }, runner, () => version),
		/not current main/
	);
});
