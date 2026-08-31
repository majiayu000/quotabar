import assert from 'node:assert/strict';

import {
  parseReleaseArguments,
  validateReleaseVersions,
} from './check_release_version.mjs';

const { describe, it } = process.env.VITEST
  ? await import('vitest')
  : await import('node:test');

function matchingSources(version = '0.4.1') {
  return new Map([
    ['package.json', JSON.stringify({ version })],
    ['package-lock.json', JSON.stringify({ version, packages: { '': { version } } })],
    ['src-tauri/tauri.conf.json', JSON.stringify({ version })],
    ['src-tauri/Cargo.toml', `[package]\nname = "quotabar"\nversion = "${version}"\n`],
    ['src-tauri/Cargo.lock', `[[package]]\nname = "quotabar"\nversion = "${version}"\n`],
  ]);
}

describe('parseReleaseArguments', () => {
  it('accepts an optional expected semantic version', () => {
    assert.deepEqual(parseReleaseArguments([]), { expected: null });
    assert.deepEqual(parseReleaseArguments(['--expected', '0.4.1']), { expected: '0.4.1' });
  });

  it('rejects unknown, missing, and malformed arguments', () => {
    assert.throws(() => parseReleaseArguments(['--wat']), /unknown argument/);
    assert.throws(() => parseReleaseArguments(['--expected']), /requires a value/);
    assert.throws(() => parseReleaseArguments(['--expected', 'v0.4.1']), /semantic version/);
  });
});

describe('validateReleaseVersions', () => {
  it('returns the shared version from every release manifest', () => {
    assert.equal(validateReleaseVersions(matchingSources()), '0.4.1');
  });

  it('accepts the matching expected version', () => {
    assert.equal(validateReleaseVersions(matchingSources(), '0.4.1'), '0.4.1');
  });

  it('rejects a mismatched manifest or expected version', () => {
    const sources = matchingSources();
    sources.set('src-tauri/tauri.conf.json', JSON.stringify({ version: '0.4.0' }));
    assert.throws(() => validateReleaseVersions(sources), /version mismatch.*tauri\.conf\.json/s);
    assert.throws(
      () => validateReleaseVersions(matchingSources(), '0.4.2'),
      /expected 0\.4\.2, found 0\.4\.1/,
    );
  });

  it('rejects missing, malformed, and ambiguous version fields', () => {
    const missing = matchingSources();
    missing.delete('package-lock.json');
    assert.throws(() => validateReleaseVersions(missing), /source is missing/);

    const malformed = matchingSources();
    malformed.set('package.json', '{');
    assert.throws(() => validateReleaseVersions(malformed), /invalid JSON/);

    const ambiguous = matchingSources();
    ambiguous.set(
      'src-tauri/Cargo.toml',
      '[package]\nname = "quotabar"\nversion = "0.4.1"\nversion = "0.4.2"\n',
    );
    assert.throws(() => validateReleaseVersions(ambiguous), /exactly one package version/);
  });
});
