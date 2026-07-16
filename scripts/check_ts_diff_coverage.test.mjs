import assert from 'node:assert/strict';
import {
  createDependencies,
  evaluateCoverage,
  parseArguments,
  parseLcov,
  parseUnifiedDiff,
  runCheck,
} from './check_ts_diff_coverage.mjs';

const { describe, it } = process.env.VITEST
  ? await import('vitest')
  : await import('node:test');

describe('parseArguments', () => {
  it('parses thresholds and repeated critical paths', () => {
    const options = parseArguments([
      '--base', 'origin/main',
      '--lcov', 'coverage/lcov.info',
      '--minimum', '82.5',
      '--critical', 'src/services/storage.ts=100',
      '--critical', 'src/App.tsx=90',
    ]);
    assert.equal(options.base, 'origin/main');
    assert.equal(options.lcov, 'coverage/lcov.info');
    assert.equal(options.minimum, 82.5);
    assert.deepEqual([...options.critical], [
      ['src/services/storage.ts', 100],
      ['src/App.tsx', 90],
    ]);
  });

  it('rejects incomplete or invalid arguments', () => {
    const invalid = [
      [[], '--base is required'],
      [['--base', 'main'], '--lcov is required'],
      [['--base'], '--base requires a value'],
      [['--base', '--lcov'], '--base requires a value'],
      [['--wat'], 'unknown argument: --wat'],
      [['--base', 'main', '--lcov', 'x', '--minimum', 'NaN'], '--minimum must be'],
      [['--base', 'main', '--lcov', 'x', '--minimum', '-1'], '--minimum must be'],
      [['--base', 'main', '--lcov', 'x', '--minimum', '101'], '--minimum must be'],
      [['--base', 'main', '--lcov', 'x', '--critical', 'storage.ts'], '--critical requires'],
      [['--base', 'main', '--lcov', 'x', '--critical', '=100'], '--critical requires'],
      [['--base', 'main', '--lcov', 'x', '--critical', 'storage.ts='], '--critical requires'],
      [['--base', 'main', '--lcov', 'x', '--critical', 'storage.ts=nope'], '--critical must be'],
    ];
    for (const [argv, message] of invalid) {
      assert.throws(() => parseArguments(argv), { message: new RegExp(message) });
    }
  });
});

describe('parseUnifiedDiff', () => {
  it('collects TS and TSX added line numbers and ignores other paths', () => {
    const diff = [
      'diff --git a/src/a.ts b/src/a.ts',
      '+++ b/src/a.ts',
      '@@ -1 +2,2 @@',
      'diff --git a/src/b.tsx b/src/b.tsx',
      '+++ b/src/b.tsx',
      '@@ -0,0 +7 @@',
      'diff --git a/src/styles.css b/src/styles.css',
      '+++ b/src/styles.css',
      '@@ -1 +1,3 @@',
      '+++ /dev/null',
      '@@ -1 +0,0 @@',
    ].join('\n');
    assert.deepEqual(
      [...parseUnifiedDiff(diff)].map(([path, lines]) => [path, [...lines]]),
      [['src/a.ts', [2, 3]], ['src/b.tsx', [7]]],
    );
  });

  it('rejects malformed paths and hunks', () => {
    assert.throws(() => parseUnifiedDiff('+++ src/a.ts'), /malformed diff path/);
    assert.throws(() => parseUnifiedDiff('+++ b/src/a.ts\n@@ broken'), /malformed diff hunk/);
  });
});

describe('parseLcov', () => {
  it('parses relative, dot-relative, absolute, duplicate, and checksum DA records', () => {
    const cwd = '/repo';
    const lcov = [
      'SF:src/a.ts',
      'DA:2,0',
      'DA:2,1,checksum',
      'end_of_record',
      'SF:./src/b.tsx',
      'DA:7,2',
      'end_of_record',
      'SF:/repo/src/c.ts',
      'DA:3,1',
      'end_of_record',
      'SF:src\\d.ts',
      'DA:4,1',
    ].join('\n');
    const parsed = parseLcov(lcov, cwd);
    assert.equal(parsed.get('src/a.ts').get(2), 1);
    assert.equal(parsed.get('src/b.tsx').get(7), 2);
    assert.equal(parsed.get('src/c.ts').get(3), 1);
    assert.equal(parsed.get('src/d.ts').get(4), 1);
  });

  it('rejects malformed or unsafe LCOV', () => {
    const invalid = [
      ['', /no source records/],
      ['SF:', /empty SF/],
      ['DA:1,1', /before SF/],
      ['SF:src/a.ts\nDA:nope', /malformed LCOV DA/],
      ['SF:../outside.ts\nDA:1,1', /outside the repository/],
      ['SF:/outside.ts\nDA:1,1', /outside the repository/],
    ];
    for (const [lcov, message] of invalid) {
      assert.throws(() => parseLcov(lcov, '/repo'), message);
    }
  });
});

describe('evaluateCoverage', () => {
  const changed = new Map([
    ['src/a.ts', new Set([1, 2, 3])],
    ['src/b.ts', new Set([5])],
  ]);
  const coverage = new Map([
    ['src/a.ts', new Map([[1, 1], [2, 0]])],
    ['src/b.ts', new Map([[5, 1]])],
  ]);

  it('calculates measurable overall and critical path coverage', () => {
    const result = evaluateCoverage(
      changed,
      coverage,
      60,
      new Map([['src/b.ts', 100]]),
    );
    assert.deepEqual(result.overall, { measurable: 3, covered: 2, percentage: (2 / 3) * 100 });
    assert.equal(result.paths.length, 2);
  });

  it('fails closed for missing paths, no measurable lines, and thresholds', () => {
    assert.throws(
      () => evaluateCoverage(new Map([['src/missing.ts', new Set([1])]]), coverage, 0, new Map()),
      /no record for changed path/,
    );
    assert.throws(
      () => evaluateCoverage(new Map([['src/a.ts', new Set([99])]]), coverage, 0, new Map()),
      /no measurable TypeScript lines/,
    );
    assert.throws(() => evaluateCoverage(changed, coverage, 90, new Map()), /below 90%/);
    assert.throws(
      () => evaluateCoverage(changed, coverage, 0, new Map([['src/missing.ts', 100]])),
      /critical path has no measurable/,
    );
    assert.throws(
      () => evaluateCoverage(changed, coverage, 0, new Map([['src/a.ts', 100]])),
      /critical path src\/a.ts coverage 50.00% is below 100%/,
    );
  });
});

describe('dependencies and end-to-end check', () => {
  it('uses array git arguments and reads LCOV relative to cwd', () => {
    const calls = [];
    const spawn = (command, args, options) => {
      calls.push({ command, args, options });
      return { status: 0, stdout: args[0] === 'diff' ? 'diff-output' : 'base-output', stderr: '' };
    };
    const reads = [];
    const dependencies = createDependencies(
      spawn,
      (path, encoding) => {
        reads.push({ path, encoding });
        return 'lcov-output';
      },
      '/repo',
      () => undefined,
    );
    dependencies.verifyBase('origin/main');
    assert.equal(dependencies.loadDiff('origin/main'), 'diff-output');
    assert.equal(dependencies.loadLcov('coverage/lcov.info'), 'lcov-output');
    assert.deepEqual(calls[0].args, ['rev-parse', '--verify', 'origin/main^{commit}']);
    assert.deepEqual(calls[1].args, [
      'diff', '--unified=0', '--diff-filter=AM', 'origin/main...HEAD', '--', 'src',
    ]);
    assert.deepEqual(reads, [{ path: '/repo/coverage/lcov.info', encoding: 'utf8' }]);
  });

  it('reports git process errors and non-zero status', () => {
    const processError = new Error('spawn failed');
    const errorDependencies = createDependencies(
      () => ({ error: processError, status: null, stdout: '', stderr: '' }),
      () => '',
      '/repo',
      () => undefined,
    );
    assert.throws(() => errorDependencies.verifyBase('main'), processError);

    const failedDependencies = createDependencies(
      () => ({ status: 1, stdout: '', stderr: 'bad ref\n' }),
      () => '',
      '/repo',
      () => undefined,
    );
    assert.throws(() => failedDependencies.loadDiff('main'), /git diff failed: bad ref/);
  });

  it('runs the complete checker and emits a summary', () => {
    const output = [];
    const dependencies = {
      cwd: '/repo',
      verifyBase: (base) => assert.equal(base, 'origin/main'),
      loadDiff: (base) => {
        assert.equal(base, 'origin/main');
        return '+++ b/src/a.ts\n@@ -0,0 +1,2 @@';
      },
      loadLcov: (path) => {
        assert.equal(path, 'coverage/lcov.info');
        return 'SF:src/a.ts\nDA:1,1\nDA:2,1\nend_of_record';
      },
      writeLine: (line) => output.push(line),
    };
    const report = runCheck(
      ['--base', 'origin/main', '--lcov', 'coverage/lcov.info', '--critical', 'src/a.ts=100'],
      dependencies,
    );
    assert.equal(report.overall.percentage, 100);
    assert.deepEqual(output, ['TypeScript diff coverage: 2/2 (100.00%)']);
  });
});
