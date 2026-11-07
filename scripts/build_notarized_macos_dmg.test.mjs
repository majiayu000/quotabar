import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const { describe, it } = process.env.VITEST
  ? await import('vitest')
  : await import('node:test');

const SCRIPT = resolve(dirname(fileURLToPath(import.meta.url)), 'build_notarized_macos_dmg.sh');
const DMG_DIR = 'src-tauri/target/release/bundle/dmg';
const DMG = `${DMG_DIR}/QuotaBar.dmg`;

// Each stub appends to calls.log. VALIDATE_EXIT fails `stapler validate` and
// FAILED_STAPLES fails that many `stapler staple` calls.
const STUBS = {
  npm: `echo "npm $*" >> "$STUB_ROOT/calls.log"
[ "\${BUILD_EXIT:-0}" -eq 0 ] || exit "$BUILD_EXIT"
[ "\${BUILD_WITHOUT_DMG:-0}" -eq 1 ] && exit 0
mkdir -p "${DMG_DIR}"
echo original > "${DMG}"
`,
  hdiutil: `echo "hdiutil $1" >> "$STUB_ROOT/calls.log"
case "$1" in
  attach)
    mount=""
    writable=no
    while [ $# -gt 0 ]; do
      [ "$1" = -mountpoint ] && mount="$2"
      [ "$1" = -readwrite ] && writable=yes
      shift
    done
    echo "attach writable=$writable" >> "$STUB_ROOT/calls.log"
    [ "\${EMPTY_DMG:-0}" -eq 1 ] || mkdir -p "$mount/QuotaBar.app"
    ;;
  detach) rm -rf "$2/QuotaBar.app" ;;
  convert)
    output=""
    while [ $# -gt 0 ]; do
      [ "$1" = -o ] && output="$2"
      shift
    done
    echo repacked > "$output"
    ;;
esac
`,
  xcrun: `echo "xcrun $*" >> "$STUB_ROOT/calls.log"
if [ "$2" = validate ]; then
  exit "\${VALIDATE_EXIT:-0}"
fi
count=$(cat "$STUB_ROOT/staples" 2>/dev/null || echo 0)
echo $((count + 1)) > "$STUB_ROOT/staples"
if [ "$count" -lt "\${FAILED_STAPLES:-0}" ]; then
  echo "CloudKit error detail"
  exit 68
fi
echo "stapled"
`,
  codesign: `echo "codesign $*" >> "$STUB_ROOT/calls.log"\n`,
  du: `printf '30\\t%s\\n' "$2"\n`,
  sleep: `echo "sleep $1" >> "$STUB_ROOT/calls.log"\n`,
};

function run(env = {}) {
  const root = mkdtempSync(join(tmpdir(), 'quotabar-dmg-test-'));
  const stubDir = join(root, 'stubs');
  const work = join(root, 'work');
  mkdirSync(stubDir);
  mkdirSync(work);
  for (const [name, body] of Object.entries(STUBS)) {
    writeFileSync(join(stubDir, name), `#!/usr/bin/env bash\n${body}`);
    chmodSync(join(stubDir, name), 0o755);
  }
  try {
    const result = spawnSync('bash', [SCRIPT], {
      cwd: work,
      encoding: 'utf8',
      env: {
        ...process.env,
        APPLE_SIGNING_IDENTITY: 'Test Identity',
        QUOTABAR_SIGNING_KEYCHAIN: 'test.keychain',
        ...env,
        PATH: `${stubDir}:${process.env.PATH}`,
        RUNNER_TEMP: root,
        STUB_ROOT: root,
      },
    });
    const logPath = join(root, 'calls.log');
    const calls = existsSync(logPath) ? readFileSync(logPath, 'utf8').trim().split('\n') : [];
    const count = (prefix) => calls.filter((call) => call.startsWith(prefix)).length;
    const dmgPath = join(work, DMG);
    const dmg = existsSync(dmgPath) ? readFileSync(dmgPath, 'utf8').trim() : null;
    return {
      ...result,
      calls,
      count,
      dmg,
      mountsBalanced: count('hdiutil attach') === count('hdiutil detach'),
    };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

const SLOW = { timeout: 30_000 };

// The script only runs on macOS runners, and spawning stubs through Git Bash on
// Windows is slow enough to time out.
describe('build_notarized_macos_dmg.sh', { skip: process.platform === 'win32' }, () => {
  it('leaves the DMG untouched when Tauri stapled the app', SLOW, () => {
    const result = run();
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.count('npm '), 1);
    assert.equal(result.count('hdiutil convert'), 0);
    assert.equal(result.count('xcrun stapler staple'), 0);
    assert.equal(result.count('codesign'), 0);
    assert.equal(result.dmg, 'original');
    assert.ok(result.mountsBalanced);
  });

  it('staples inside a writable copy without bundling or notarizing again', SLOW, () => {
    const result = run({ VALIDATE_EXIT: '65' });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.count('npm '), 1);
    assert.equal(result.count('hdiutil convert'), 2);
    assert.ok(result.calls.includes('attach writable=yes'));
    assert.equal(result.count('xcrun stapler staple -v'), 1);
    assert.equal(result.dmg, 'repacked');
    assert.match(result.stdout, /::warning::Tauri left the app/);
    assert.ok(result.mountsBalanced);
  });

  it('re-signs the rebuilt DMG with the imported identity', SLOW, () => {
    const result = run({ VALIDATE_EXIT: '65' });
    const signing = result.calls.find((call) => call.startsWith('codesign'));
    assert.ok(signing, 'codesign must run after repacking');
    assert.match(signing, /--keychain test\.keychain/);
    assert.match(signing, /--sign Test Identity/);
    assert.ok(signing.endsWith(DMG));
    assert.ok(result.calls.lastIndexOf('hdiutil convert') < result.calls.indexOf(signing));
  });

  it('retries the staple and logs each stapler error', SLOW, () => {
    const result = run({ VALIDATE_EXIT: '65', FAILED_STAPLES: '2' });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.count('npm '), 1);
    assert.equal(result.count('xcrun stapler staple -v'), 3);
    assert.equal(result.calls.filter((call) => call === 'sleep 30').length, 2);
    assert.equal(result.stdout.match(/CloudKit error detail/g).length, 2);
    assert.equal(result.dmg, 'repacked');
  });

  it('fails without replacing the DMG when stapling never succeeds', SLOW, () => {
    const result = run({ VALIDATE_EXIT: '65', FAILED_STAPLES: '99' });
    assert.notEqual(result.status, 0);
    assert.equal(result.count('xcrun stapler staple -v'), 10);
    assert.equal(result.calls.filter((call) => call === 'sleep 30').length, 9);
    assert.equal(result.count('codesign'), 0);
    assert.equal(result.dmg, 'original');
    assert.match(result.stderr, /after 10 attempts/);
    assert.ok(result.mountsBalanced);
  });

  it('does not continue after a failed Tauri build', SLOW, () => {
    const result = run({ BUILD_EXIT: '101' });
    assert.equal(result.status, 101);
    assert.equal(result.count('npm '), 1);
    assert.equal(result.count('hdiutil attach'), 0);
  });

  it('reports a build that produced no DMG', SLOW, () => {
    const result = run({ BUILD_WITHOUT_DMG: '1' });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /DMG was not produced/);
  });

  it('reports and unmounts a DMG without an app', SLOW, () => {
    const result = run({ EMPTY_DMG: '1' });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /app bundle is missing/);
    assert.ok(result.mountsBalanced);
  });
});
