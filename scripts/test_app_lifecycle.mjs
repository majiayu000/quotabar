import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, test } from 'node:test';

function fixture(t, { installed = true, built = true } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'quotabar-lifecycle-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const apps = join(root, 'Applications');
  const scripts = join(root, 'scripts');
  const bin = join(root, 'bin');
  const events = join(root, 'events');
  for (const directory of [apps, scripts, bin]) mkdirSync(directory);
  writeFileSync(events, '');
  // Redirect only the fixed installation root; execute the actual shell scripts.
  for (const name of ['run_app.sh', 'stop_app.sh', 'install_app.sh', 'reinstall_and_run.sh']) {
    const source = readFileSync(new URL(name, import.meta.url), 'utf8');
    writeFileSync(join(scripts, name), source.replaceAll('/Applications', apps), { mode: 0o755 });
  }
  const installedApp = join(apps, 'QuotaBar.app');
  const builtApp = join(root, 'src-tauri/target/release/bundle/macos/QuotaBar.app');
  for (const [path, enabled, version] of [[installedApp, installed, 'old'], [builtApp, built, 'new']]) {
    if (!enabled) continue;
    mkdirSync(join(path, 'Contents/MacOS'), { recursive: true });
    writeFileSync(join(path, 'Contents/MacOS/quotabar'), version, { mode: 0o755 });
  }
  if (installed) writeFileSync(join(installedApp, 'obsolete.txt'), 'old resource');
  const commands = {
    pkill: 'echo "pkill $*" >> "$EVENTS"\nexit "${PKILL_STATUS:-0}"',
    pgrep: `echo "pgrep $*" >> "$EVENTS"
count=0
if [[ -f "$COUNTER" ]]; then read -r count < "$COUNTER"; fi
echo "$((count + 1))" > "$COUNTER"
if [[ -n "\${PGREP_STATUS:-}" ]]; then exit "$PGREP_STATUS"; fi
if ((count < \${RUNNING_CHECKS:-0})); then exit 0; fi
exit 1`,
    sleep: 'echo sleep >> "$EVENTS"',
    open: 'echo "open $*" >> "$EVENTS"\nexit "${OPEN_STATUS:-0}"',
    ditto: `echo ditto >> "$EVENTS"
if [[ "\${DITTO_FAIL:-0}" == 1 ]]; then
  mkdir -p "$2"
  echo partial > "$2/partial.txt"
  exit 8
fi
exec /usr/bin/ditto "$@"`,
    mv: `echo "mv $*" >> "$EVENTS"
if [[ "\${MOVE_FAIL:-0}" == 1 && "$1" == *"/.quotabar-install."*"/QuotaBar.app" ]]; then exit 9; fi
if [[ "\${RESTORE_FAIL:-0}" == 1 && "$1" == *"/previous.app" ]]; then exit 10; fi
exec /bin/mv "$@"`,
  };
  for (const [name, body] of Object.entries(commands)) {
    writeFileSync(join(bin, name), `#!/bin/bash\nset -eu\n${body}\n`, { mode: 0o755 });
  }
  return {
    root, apps, installedApp, builtApp,
    events: () => readFileSync(events, 'utf8').trim().split('\n').filter(Boolean),
    version: () => readFileSync(join(installedApp, 'Contents/MacOS/quotabar'), 'utf8'),
    run(name, env = {}) {
      return spawnSync('/bin/bash', [join(scripts, name)], {
        encoding: 'utf8', timeout: 10000,
        env: { ...process.env, PATH: `${bin}:/usr/bin:/bin`, EVENTS: events, COUNTER: join(root, 'counter'), ...env },
      });
    },
  };
}

describe('macOS app lifecycle', { skip: process.platform !== 'darwin' }, () => {
  test('opens only the installed bundle', (t) => {
    const f = fixture(t);
    assert.equal(f.run('run_app.sh').status, 0);
    assert.deepEqual(f.events(), [`open ${f.installedApp}`]);
  });

  test('missing installed app fails without launching a local build', (t) => {
    const f = fixture(t, { installed: false });
    const binary = join(f.root, 'src-tauri/target/release/quotabar');
    writeFileSync(binary, '#!/bin/sh\necho local >> "$EVENTS"\n', { mode: 0o755 });
    const result = f.run('run_app.sh');
    assert.equal(result.status, 1);
    assert.match(result.stderr, /not installed/);
    assert.deepEqual(f.events(), []);
  });

  test('launch errors propagate', (t) => {
    const f = fixture(t);
    assert.equal(f.run('run_app.sh', { OPEN_STATUS: '7' }).status, 7);
  });

  test('no running installed app is a successful no-op', (t) => {
    const f = fixture(t);
    assert.equal(f.run('stop_app.sh', { PKILL_STATUS: '1' }).status, 0);
    assert.equal(f.events().length, 1);
  });

  test('signal errors propagate instead of reporting success', (t) => {
    const f = fixture(t);
    const result = f.run('stop_app.sh', { PKILL_STATUS: '3' });
    assert.equal(result.status, 3);
    assert.match(result.stderr, /Failed to signal/);
    assert.doesNotMatch(result.stdout, /Stopped/);
  });

  test('process matching targets only the installed executable', (t) => {
    const f = fixture(t);
    assert.equal(f.run('stop_app.sh').status, 0);
    const pattern = f.events()[0].slice('pkill -TERM -f '.length).replace('[[:space:]]', '\\s');
    const matcher = new RegExp(pattern);
    assert.ok(matcher.test(`${f.installedApp}/Contents/MacOS/quotabar`));
    assert.ok(matcher.test(`${f.installedApp}/Contents/MacOS/quotabar --example`));
    assert.equal(matcher.test(`${f.installedApp}/Contents/MacOS/quotabar-helper`), false);
    assert.equal(matcher.test(`echo ${f.installedApp}/Contents/MacOS/quotabar`), false);
    assert.equal(matcher.test(`${f.root}/src-tauri/target/release/quotabar`), false);
  });

  test('waits for exit and reports process lookup failures', (t) => {
    const f = fixture(t);
    assert.equal(f.run('stop_app.sh', { RUNNING_CHECKS: '2' }).status, 0);
    assert.equal(f.events().filter((event) => event === 'sleep').length, 2);
    assert.equal(f.run('stop_app.sh', { PGREP_STATUS: '2' }).status, 2);
  });

  test('missing build fails before stopping or launching anything', (t) => {
    const f = fixture(t, { built: false });
    const result = f.run('reinstall_and_run.sh');
    assert.equal(result.status, 1);
    assert.match(result.stderr, /App bundle not found/);
    assert.deepEqual(f.events(), []);
    assert.equal(f.version(), 'old');
  });

  test('partial staging failure leaves the old app untouched and running', (t) => {
    const f = fixture(t);
    assert.equal(f.run('reinstall_and_run.sh', { DITTO_FAIL: '1' }).status, 8);
    assert.deepEqual(f.events(), ['ditto']);
    assert.equal(f.version(), 'old');
    assert.deepEqual(readdirSync(f.apps), ['QuotaBar.app']);
  });

  test('stop failure prevents replacement and launch', (t) => {
    const f = fixture(t);
    assert.equal(f.run('reinstall_and_run.sh', { PKILL_STATUS: '3' }).status, 3);
    assert.equal(f.version(), 'old');
    assert.equal(f.events().some((event) => /^(mv|open) /.test(event)), false);
    assert.deepEqual(readdirSync(f.apps), ['QuotaBar.app']);
  });

  test('timeout preserves the old bundle and never launches', (t) => {
    const f = fixture(t);
    const result = f.run('reinstall_and_run.sh', { PGREP_STATUS: '0' });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Timed out/);
    assert.equal(f.events().filter((event) => event === 'sleep').length, 50);
    assert.equal(f.events().some((event) => /^(mv|open) /.test(event)), false);
    assert.equal(f.version(), 'old');
  });

  test('replacement removes obsolete files and follows stage-stop-wait-install-launch order', (t) => {
    const f = fixture(t);
    const result = f.run('reinstall_and_run.sh', { RUNNING_CHECKS: '2' });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(f.version(), 'new');
    assert.deepEqual(readdirSync(f.installedApp), ['Contents']);
    assert.deepEqual(readdirSync(f.apps), ['QuotaBar.app']);
    const events = f.events();
    assert.equal(events[0], 'ditto');
    assert.match(events[1], /^pkill /);
    const lastCheck = events.findLastIndex((event) => event.startsWith('pgrep '));
    assert.equal(events.filter((event) => event === 'sleep').length, 2);
    assert.ok(events.findIndex((event) => event.startsWith('mv ')) > lastCheck);
    assert.equal(events.at(-1), `open ${f.installedApp}`);
  });

  test('first installation works without a previous bundle', (t) => {
    const f = fixture(t, { installed: false });
    assert.equal(f.run('install_app.sh', { PKILL_STATUS: '1' }).status, 0);
    assert.equal(f.version(), 'new');
    assert.deepEqual(readdirSync(f.apps), ['QuotaBar.app']);
  });

  test('failed replacement restores the old bundle and does not launch', (t) => {
    const f = fixture(t);
    assert.equal(f.run('reinstall_and_run.sh', { MOVE_FAIL: '1' }).status, 9);
    assert.equal(f.version(), 'old');
    assert.ok(readdirSync(f.installedApp).includes('obsolete.txt'));
    assert.deepEqual(readdirSync(f.apps), ['QuotaBar.app']);
    assert.equal(f.events().some((event) => event.startsWith('open ')), false);
  });

  test('failed restore retains the previous bundle and reports its path', (t) => {
    const f = fixture(t);
    const result = f.run('reinstall_and_run.sh', { MOVE_FAIL: '1', RESTORE_FAIL: '1' });
    assert.equal(result.status, 9);
    const stage = readdirSync(f.apps).find((name) => name.startsWith('.quotabar-install.'));
    assert.ok(stage);
    const previous = join(f.apps, stage, 'previous.app');
    assert.equal(readFileSync(join(previous, 'Contents/MacOS/quotabar'), 'utf8'), 'old');
    assert.ok(result.stderr.includes(previous));
  });
});
