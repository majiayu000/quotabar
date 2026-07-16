import { readFileSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

function requireValue(argv, index, flag) {
  const value = argv[index + 1];
  if (!value || value.startsWith('--')) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}

function parseThreshold(value, flag) {
  const threshold = Number(value);
  if (!Number.isFinite(threshold) || threshold < 0 || threshold > 100) {
    throw new Error(`${flag} must be a number from 0 to 100`);
  }
  return threshold;
}

export function parseArguments(argv) {
  const options = { base: '', lcov: '', minimum: 80, critical: new Map() };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === '--base') {
      options.base = requireValue(argv, index, flag);
      index += 1;
    } else if (flag === '--lcov') {
      options.lcov = requireValue(argv, index, flag);
      index += 1;
    } else if (flag === '--minimum') {
      options.minimum = parseThreshold(requireValue(argv, index, flag), flag);
      index += 1;
    } else if (flag === '--critical') {
      const rule = requireValue(argv, index, flag);
      const separator = rule.lastIndexOf('=');
      if (separator <= 0 || separator === rule.length - 1) {
        throw new Error('--critical requires path=threshold');
      }
      const path = rule.slice(0, separator);
      options.critical.set(path, parseThreshold(rule.slice(separator + 1), flag));
      index += 1;
    } else {
      throw new Error(`unknown argument: ${flag}`);
    }
  }
  if (!options.base) throw new Error('--base is required');
  if (!options.lcov) throw new Error('--lcov is required');
  return options;
}

export function parseUnifiedDiff(diff) {
  const changedLines = new Map();
  let currentPath = null;
  for (const line of diff.split('\n')) {
    if (line.startsWith('+++ ')) {
      const path = line.slice(4);
      if (path === '/dev/null') {
        currentPath = null;
      } else if (!path.startsWith('b/')) {
        throw new Error(`malformed diff path: ${path}`);
      } else {
        const repoPath = path.slice(2);
        currentPath = repoPath.startsWith('src/') && /\.tsx?$/.test(repoPath)
          ? repoPath
          : null;
      }
      continue;
    }
    if (!line.startsWith('@@')) continue;
    const match = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/.exec(line);
    if (!match) throw new Error(`malformed diff hunk: ${line}`);
    if (!currentPath) continue;
    const start = Number(match[1]);
    const count = match[2] === undefined ? 1 : Number(match[2]);
    const lines = changedLines.get(currentPath) ?? new Set();
    for (let offset = 0; offset < count; offset += 1) {
      lines.add(start + offset);
    }
    changedLines.set(currentPath, lines);
  }
  return changedLines;
}

function normalizeCoveragePath(path, cwd) {
  const normalized = isAbsolute(path) ? relative(cwd, path) : path.replace(/^\.\//, '');
  const portable = normalized.split('\\').join('/');
  if (!portable || portable === '..' || portable.startsWith('../')) {
    throw new Error(`LCOV path is outside the repository: ${path}`);
  }
  return portable;
}

export function parseLcov(lcov, cwd) {
  const coverage = new Map();
  let current = null;
  let sawSource = false;
  for (const line of lcov.split('\n')) {
    if (line.startsWith('SF:')) {
      const source = line.slice(3);
      if (!source) throw new Error('LCOV contains an empty SF record');
      current = normalizeCoveragePath(source, cwd);
      if (!coverage.has(current)) coverage.set(current, new Map());
      sawSource = true;
    } else if (line.startsWith('DA:')) {
      if (!current) throw new Error('LCOV DA record appears before SF');
      const match = /^DA:(\d+),(\d+)(?:,.*)?$/.exec(line);
      if (!match) throw new Error(`malformed LCOV DA record: ${line}`);
      coverage.get(current).set(Number(match[1]), Number(match[2]));
    } else if (line === 'end_of_record') {
      current = null;
    }
  }
  if (!sawSource) throw new Error('LCOV contains no source records');
  return coverage;
}

function summarizePath(path, changedLines, coverage) {
  const pathCoverage = coverage.get(path);
  if (!pathCoverage) throw new Error(`LCOV has no record for changed path: ${path}`);
  let measurable = 0;
  let covered = 0;
  for (const line of changedLines) {
    if (!pathCoverage.has(line)) continue;
    measurable += 1;
    if (pathCoverage.get(line) > 0) covered += 1;
  }
  return { path, measurable, covered };
}

function percentage(summary) {
  return (summary.covered / summary.measurable) * 100;
}

export function evaluateCoverage(changedLines, coverage, minimum, critical) {
  const paths = [];
  for (const [path, lines] of changedLines) {
    paths.push(summarizePath(path, lines, coverage));
  }
  const overall = paths.reduce(
    (total, item) => ({
      measurable: total.measurable + item.measurable,
      covered: total.covered + item.covered,
    }),
    { measurable: 0, covered: 0 },
  );
  if (overall.measurable === 0) throw new Error('diff contains no measurable TypeScript lines');
  const overallPercentage = percentage(overall);
  if (overallPercentage < minimum) {
    throw new Error(`diff coverage ${overallPercentage.toFixed(2)}% is below ${minimum}%`);
  }
  for (const [path, threshold] of critical) {
    const summary = paths.find((item) => item.path === path);
    if (!summary || summary.measurable === 0) {
      throw new Error(`critical path has no measurable changed lines: ${path}`);
    }
    const pathPercentage = percentage(summary);
    if (pathPercentage < threshold) {
      throw new Error(
        `critical path ${path} coverage ${pathPercentage.toFixed(2)}% is below ${threshold}%`,
      );
    }
  }
  return { overall: { ...overall, percentage: overallPercentage }, paths };
}

function ensureGitSuccess(result, operation) {
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${operation} failed: ${String(result.stderr).trim()}`);
  }
  return String(result.stdout);
}

export function createDependencies(spawn, readFile, cwd, writeLine) {
  return {
    cwd,
    verifyBase(base) {
      ensureGitSuccess(
        spawn('git', ['rev-parse', '--verify', `${base}^{commit}`], { encoding: 'utf8', cwd }),
        'git base verification',
      );
    },
    loadDiff(base) {
      return ensureGitSuccess(
        spawn(
          'git',
          ['diff', '--unified=0', '--diff-filter=AM', `${base}...HEAD`, '--', 'src'],
          { encoding: 'utf8', cwd },
        ),
        'git diff',
      );
    },
    loadLcov(path) {
      return readFile(resolve(cwd, path), 'utf8');
    },
    writeLine,
  };
}

export function runCheck(argv, dependencies) {
  const options = parseArguments(argv);
  dependencies.verifyBase(options.base);
  const changedLines = parseUnifiedDiff(dependencies.loadDiff(options.base));
  const coverage = parseLcov(dependencies.loadLcov(options.lcov), dependencies.cwd);
  const report = evaluateCoverage(changedLines, coverage, options.minimum, options.critical);
  dependencies.writeLine(
    `TypeScript diff coverage: ${report.overall.covered}/${report.overall.measurable} ` +
      `(${report.overall.percentage.toFixed(2)}%)`,
  );
  return report;
}

/* node:coverage disable */
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    runCheck(
      process.argv.slice(2),
      createDependencies(spawnSync, readFileSync, process.cwd(), (line) => console.log(line)),
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
/* node:coverage enable */
