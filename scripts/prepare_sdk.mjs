import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const vendor = resolve(root, 'vendor');
const archive = resolve(vendor, 'ccstats-sdk.tar.gz');
const manifest = resolve(vendor, 'ccstats-sdk.json');
const destination = resolve(vendor, 'ccstats');
const digest = () => createHash('sha256').update(readFileSync(archive)).digest('hex');
const args = process.argv.slice(2);
if (args.length > 1 || args.length === 1 && args[0] !== '--update') throw new Error('Usage: node scripts/prepare_sdk.mjs [--update]');

mkdirSync(vendor, { recursive: true });
if (args[0] === '--update') {
  const sdk = resolve(root, '../ccstats');
  // Deliberately snapshot library sources, CLI tests and license, without either old UI.
  execFileSync('tar', ['-czf', archive, '-C', sdk, 'Cargo.toml', 'Cargo.lock', 'README.md', 'LICENSE', 'src', 'tests'], { stdio: 'inherit', env: { ...process.env, COPYFILE_DISABLE: '1' } });
  writeFileSync(manifest, JSON.stringify({
    source: 'https://github.com/majiayu000/ccstats',
    baseCommit: execFileSync('git', ['-C', sdk, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    includesWorkingTreeChanges: execFileSync('git', ['-C', sdk, 'status', '--porcelain'], { encoding: 'utf8' }).trim().length > 0,
    sha256: digest(),
  }, null, 2) + '\n');
}
const expected = JSON.parse(readFileSync(manifest, 'utf8'));
if (digest() !== expected.sha256) throw new Error('ccstats SDK archive checksum mismatch');
// This ignored directory is generated; edit the ccstats repository and run sdk:update.
rmSync(destination, { recursive: true, force: true });
mkdirSync(destination, { recursive: true });
execFileSync('tar', ['-xzf', archive, '-C', destination], { stdio: 'inherit' });
console.log(`Prepared ccstats SDK ${expected.sha256.slice(0, 12)} from the checked-in source archive.`);
