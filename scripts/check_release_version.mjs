import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const releaseManifestPaths = [
  'package.json',
  'package-lock.json',
  'src-tauri/tauri.conf.json',
  'src-tauri/Cargo.toml',
  'src-tauri/Cargo.lock',
];

const semanticVersionPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

function requireSemanticVersion(version, context) {
  if (typeof version !== 'string' || !semanticVersionPattern.test(version)) {
    throw new Error(`${context} must be a semantic version`);
  }
  return version;
}

export function parseReleaseArguments(argv) {
  if (argv.length === 0) return { expected: null };
  if (argv[0] !== '--expected') throw new Error(`unknown argument: ${argv[0]}`);
  if (argv.length < 2 || argv[1].startsWith('--')) {
    throw new Error('--expected requires a value');
  }
  if (argv.length > 2) throw new Error(`unknown argument: ${argv[2]}`);
  return { expected: requireSemanticVersion(argv[1], '--expected') };
}

function requireSource(sources, path) {
  const source = sources.get(path);
  if (typeof source !== 'string') throw new Error(`${path} source is missing`);
  return source;
}

function parseJson(source, path) {
  try {
    return JSON.parse(source);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${path} contains invalid JSON: ${message}`);
  }
}

function packageTomlVersion(source) {
  const header = /^\[package\]\s*$/m.exec(source);
  if (header === null) throw new Error('src-tauri/Cargo.toml has no [package] section');
  const remainder = source.slice(header.index + header[0].length);
  const nextSection = remainder.search(/^\[/m);
  const section = nextSection === -1 ? remainder : remainder.slice(0, nextSection);
  const matches = [...section.matchAll(/^version\s*=\s*"([^"]+)"\s*$/gm)];
  if (matches.length !== 1) {
    throw new Error('src-tauri/Cargo.toml must contain exactly one package version');
  }
  return matches[0][1];
}

function cargoLockVersion(source) {
  const packageBlocks = source.split(/^\[\[package\]\]\s*$/m).slice(1);
  const matching = packageBlocks.filter((block) => /^name\s*=\s*"quotabar"\s*$/m.test(block));
  if (matching.length !== 1) {
    throw new Error('src-tauri/Cargo.lock must contain exactly one quotabar package');
  }
  const versions = [...matching[0].matchAll(/^version\s*=\s*"([^"]+)"\s*$/gm)];
  if (versions.length !== 1) {
    throw new Error('src-tauri/Cargo.lock must contain exactly one quotabar version');
  }
  return versions[0][1];
}

function manifestVersions(sources) {
  const packageJson = parseJson(requireSource(sources, 'package.json'), 'package.json');
  const packageLock = parseJson(requireSource(sources, 'package-lock.json'), 'package-lock.json');
  const tauriConfig = parseJson(
    requireSource(sources, 'src-tauri/tauri.conf.json'),
    'src-tauri/tauri.conf.json',
  );
  return new Map([
    ['package.json', packageJson.version],
    ['package-lock.json', packageLock.version],
    ['package-lock.json packages root', packageLock.packages?.['']?.version],
    ['src-tauri/tauri.conf.json', tauriConfig.version],
    ['src-tauri/Cargo.toml', packageTomlVersion(requireSource(sources, 'src-tauri/Cargo.toml'))],
    ['src-tauri/Cargo.lock', cargoLockVersion(requireSource(sources, 'src-tauri/Cargo.lock'))],
  ]);
}

export function validateReleaseVersions(sources, expected = null) {
  const versions = manifestVersions(sources);
  const reference = requireSemanticVersion(versions.get('package.json'), 'package.json version');
  for (const [path, version] of versions) {
    requireSemanticVersion(version, `${path} version`);
    if (version !== reference) {
      throw new Error(`version mismatch in ${path}: expected ${reference}, found ${version}`);
    }
  }
  if (expected !== null && reference !== expected) {
    throw new Error(`expected ${expected}, found ${reference}`);
  }
  return reference;
}

export function readReleaseManifestSources(cwd = process.cwd()) {
  return new Map(releaseManifestPaths.map((path) => [
    path,
    readFileSync(resolve(cwd, path), 'utf8'),
  ]));
}

/* node:coverage disable */
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const { expected } = parseReleaseArguments(process.argv.slice(2));
    const version = validateReleaseVersions(readReleaseManifestSources(), expected);
    console.log(`Release manifests agree on ${version}`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
/* node:coverage enable */
