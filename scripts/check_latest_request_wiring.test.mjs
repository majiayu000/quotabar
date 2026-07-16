import assert from 'node:assert/strict';
import {
  check_latest_request_wiring,
  read_owner_sources,
} from './check_latest_request_wiring.mjs';

const { it: test } = process.env.VITEST
  ? await import('vitest')
  : await import('node:test');

const paths = {
  app: 'src/App.tsx',
  codex: 'src/components/CodexPanel.tsx',
  cursor: 'src/components/CursorPanel.tsx',
  antigravity: 'src/components/AntigravityPanel.tsx',
  cost: 'src/components/CostSummarySection.tsx',
};

function changed_source(path, from, to) {
  const sources = read_owner_sources();
  const original = sources.get(path);
  assert.equal(typeof original, 'string');
  const parts = original.split(from);
  assert.equal(parts.length, 2, `fixture mutation must match once: ${from}`);
  sources.set(path, `${parts[0]}${to}${parts[1]}`);
  return sources;
}

function rejects_change(path, from, to, message) {
  assert.throws(() => check_latest_request_wiring(changed_source(path, from, to)), message);
}

function accepts_change(path, from, to) {
  assert.doesNotThrow(() => check_latest_request_wiring(changed_source(path, from, to)));
}

test('accepts the exact real owner wiring', () => {
  assert.doesNotThrow(() => check_latest_request_wiring(read_owner_sources()));
});

test('rejects a missing owner source', () => {
  const sources = read_owner_sources();
  sources.delete(paths.app);
  assert.throws(() => check_latest_request_wiring(sources), /source is missing/);
});

test('rejects malformed owner source before structural checks', () => {
  rejects_change(paths.cursor, 'export default function CursorPanel({', 'export default function CursorPanel((', /parse errors/);
});

const import_provenance_fixtures = [
  [
    'fake backend definition',
    "import { backend } from '../services/backend';",
    'const backend = fake_backend;',
    /backend import binding count/,
  ],
  [
    'wrong backend module',
    "import { backend } from '../services/backend';",
    "import { backend } from '../services/fake_backend';",
    /backend import provenance/,
  ],
  [
    'aliased backend import',
    "import { backend } from '../services/backend';",
    "import { backend as backend_alias } from '../services/backend';",
    /backend import provenance/,
  ],
  [
    'fake generation hook definition',
    "import { useLatestRequestGeneration } from '../hooks/use_latest_request_generation';",
    'const useLatestRequestGeneration = fake_hook;',
    /useLatestRequestGeneration import binding count/,
  ],
  [
    'wrong generation hook module',
    "import { useLatestRequestGeneration } from '../hooks/use_latest_request_generation';",
    "import { useLatestRequestGeneration } from '../hooks/fake_generation';",
    /useLatestRequestGeneration import provenance/,
  ],
  [
    'wrong React hook module',
    "import { useEffect, useState, useCallback } from 'react';",
    "import { useEffect, useState, useCallback } from 'fake-react';",
    /useEffect import provenance/,
  ],
];
for (const [name, from, to, message] of import_provenance_fixtures) {
  test(`rejects import provenance bypass: ${name}`, () => {
    rejects_change(paths.cursor, from, to, message);
  });
}

const protected_shadow_fixtures = [
  ['backend variable', '  const backend = fake_backend;'],
  ['generation hook variable', '  const useLatestRequestGeneration = fake_hook;'],
  ['React effect variable', '  const useEffect = fake_effect;'],
  ['React callback parameter', '  function shadow(useCallback) { return useCallback; }'],
  ['backend destructuring binding', '  const { backend } = fake_bindings;'],
  ['generation hook function', '  function useLatestRequestGeneration() { return fake_generation; }'],
  ['React effect named function expression', '  const shadow_holder = function useEffect() {};'],
  ['backend class', '  class backend {}'],
  ['backend named class expression', '  const shadow_holder = class backend {};'],
  ['React effect enum', '  enum useEffect { fake }'],
];
for (const [name, declaration] of protected_shadow_fixtures) {
  test(`rejects protected component shadow: ${name}`, () => {
    rejects_change(
      paths.cursor,
      '  const request_generation = useLatestRequestGeneration();',
      `${declaration}\n  const request_generation = useLatestRequestGeneration();`,
      /protected component binding is shadowed/,
    );
  });
}

test('rejects a shadowed global Promise binding', () => {
  rejects_change(
    paths.codex,
    '  const request_generation = useLatestRequestGeneration();',
    '  const Promise = fake_promise;\n  const request_generation = useLatestRequestGeneration();',
    /global Promise binding is shadowed/,
  );
});

test('rejects a module-scope global Promise binding', () => {
  rejects_change(
    paths.codex,
    "import { useLatestRequestGeneration } from '../hooks/use_latest_request_generation';",
    "import { useLatestRequestGeneration } from '../hooks/use_latest_request_generation';\nfunction Promise() {}",
    /global Promise binding is shadowed/,
  );
});

test('rejects a dummy hook and fake generation object', () => {
  rejects_change(
    paths.cursor,
    '  const request_generation = useLatestRequestGeneration();',
    '  const request_generation = useLatestRequestGeneration();\n  const fake_generation = useLatestRequestGeneration();',
    /hook call count/,
  );
});

test('rejects a hook that is not the exact declarator initializer', () => {
  rejects_change(
    paths.cursor,
    'const request_generation = useLatestRequestGeneration();',
    'const request_generation = true ? useLatestRequestGeneration() : useLatestRequestGeneration();',
    /hook call count/,
  );
});

test('rejects a wrong generation owner binding', () => {
  rejects_change(
    paths.cursor,
    'const request_generation = useLatestRequestGeneration();',
    'const wrong_generation = useLatestRequestGeneration();',
    /owner binding/,
  );
});

test('rejects a generation hook moved outside its owning component', () => {
  const sources = read_owner_sources();
  const original = sources.get(paths.cursor);
  assert.equal(typeof original, 'string');
  const without_binding = original.replace('  const request_generation = useLatestRequestGeneration();\n', '');
  assert.notEqual(without_binding, original);
  const moved_binding = without_binding.replace(
    "import { useLatestRequestGeneration } from '../hooks/use_latest_request_generation';",
    "import { useLatestRequestGeneration } from '../hooks/use_latest_request_generation';\nconst request_generation = useLatestRequestGeneration();",
  );
  assert.notEqual(moved_binding, without_binding);
  sources.set(paths.cursor, moved_binding);
  assert.throws(() => check_latest_request_wiring(sources), /hook call count|owning component/);
});

test('rejects a wrong token in a terminal guard', () => {
  rejects_change(
    paths.cursor,
    '      const data = await backend.getCursorInfo();\n      if (!request_generation.isCurrent(generation)) return;',
    '      const data = await backend.getCursorInfo();\n      if (!request_generation.isCurrent(wrong_generation)) return;',
    /success guard/,
  );
});

test('rejects a guard moved outside the real backend fetch', () => {
  rejects_change(
    paths.cursor,
    '      if (!request_generation.isCurrent(generation)) return;\n      setCursorData(data);',
    '      setCursorData(data);\n      if (!request_generation.isCurrent(generation)) return;',
    /success guard/,
  );
});

test('rejects a wrong owner in the real backend fetch', () => {
  rejects_change(
    paths.app,
    '      const data = await backend.getQuota();\n      if (!claude_request_generation.isCurrent(generation)) return;',
    '      const data = await backend.getQuota();\n      if (!request_generation.isCurrent(generation)) return;',
    /success guard/,
  );
});

test('rejects a dead-code terminal guard', () => {
  rejects_change(
    paths.antigravity,
    '      if (!request_generation.isCurrent(generation)) return;\n      setData(info);',
    '      if (false) { if (!request_generation.isCurrent(generation)) return; }\n      setData(info);',
    /success guard/,
  );
});

test('rejects a current check that does not return', () => {
  rejects_change(
    paths.cursor,
    '      const data = await backend.getCursorInfo();\n      if (!request_generation.isCurrent(generation)) return;',
    '      const data = await backend.getCursorInfo();\n      if (!request_generation.isCurrent(generation)) console.error(generation);',
    /success guard/,
  );
});

test('accepts a fail-closed guard with a one-return block', () => {
  accepts_change(
    paths.cursor,
    '      const data = await backend.getCursorInfo();\n      if (!request_generation.isCurrent(generation)) return;',
    '      const data = await backend.getCursorInfo();\n      if (!request_generation.isCurrent(generation)) { return; }',
  );
});

test('rejects a terminal guard with the wrong prefix operator', () => {
  rejects_change(
    paths.cursor,
    '      const data = await backend.getCursorInfo();\n      if (!request_generation.isCurrent(generation)) return;',
    '      const data = await backend.getCursorInfo();\n      if (+request_generation.isCurrent(generation)) return;',
    /success guard/,
  );
});

test('rejects a terminal guard with extra token arguments', () => {
  rejects_change(
    paths.cursor,
    '      const data = await backend.getCursorInfo();\n      if (!request_generation.isCurrent(generation)) return;',
    '      const data = await backend.getCursorInfo();\n      if (!request_generation.isCurrent(generation, generation)) return;',
    /success guard/,
  );
});

test('rejects a catch whose first statement is not the current-token guard', () => {
  rejects_change(
    paths.codex,
    '    } catch (err) {\n      if (!request_generation.isCurrent(generation)) return;',
    '    } catch (err) {\n      console.error(err);\n      if (!request_generation.isCurrent(generation)) return;',
    /catch guard/,
  );
});

test('rejects a missing current finally guard', () => {
  rejects_change(
    paths.codex,
    '    } finally {\n      if (request_generation.isCurrent(generation)) {',
    '    } finally {\n      setLoading(false);\n      if (request_generation.isCurrent(generation)) {',
    /finally must contain one current guard/,
  );
});

const malformed_finally_fixtures = [
  ['guard with else', '      if (request_generation.isCurrent(generation)) { setLoading(false); } else { setLoading(false); }'],
  ['wrong current owner', '      if (wrong_generation.isCurrent(generation)) { setLoading(false); }'],
  ['non-block body', '      if (request_generation.isCurrent(generation)) setLoading(false);'],
  ['multiple body statements', '      if (request_generation.isCurrent(generation)) { setLoading(false); setLoading(false); }'],
  ['non-expression body', '      if (request_generation.isCurrent(generation)) { return; }'],
  ['wrong setter', '      if (request_generation.isCurrent(generation)) { setOtherLoading(false); }'],
  ['missing argument', '      if (request_generation.isCurrent(generation)) { setLoading(); }'],
  ['wrong argument', '      if (request_generation.isCurrent(generation)) { setLoading(true); }'],
];
for (const [name, replacement] of malformed_finally_fixtures) {
  test(`rejects malformed finally loading guard: ${name}`, () => {
    rejects_change(
      paths.codex,
      '      if (request_generation.isCurrent(generation)) {\n        setLoading(false);\n      }',
      replacement,
      /finally loading guard/,
    );
  });
}

const malformed_start_fixtures = [
  ['not a declaration', '    request_generation.begin();'],
  ['not const', '    let generation = request_generation.begin();'],
  ['multiple declarations', '    const generation = request_generation.begin(), extra = 0;'],
  ['wrong token name', '    const wrong_generation = request_generation.begin();'],
  ['missing initializer', '    const generation;'],
  ['identifier call', '    const generation = begin();'],
  ['non-identifier owner', '    const generation = getGeneration().begin();'],
  ['wrong owner', '    const generation = wrong_generation.begin();'],
  ['begin with argument', '    const generation = request_generation.begin(1);'],
];
for (const [name, replacement] of malformed_start_fixtures) {
  test(`rejects malformed generation start: ${name}`, () => {
    rejects_change(
      paths.cursor,
      '    const generation = request_generation.begin();',
      replacement,
      /must begin/,
    );
  });
}

test('rejects a wrong backend await mapping', () => {
  rejects_change(paths.cursor, 'backend.getCursorInfo()', 'backend.getQuota()', /backend call count|await mapping/);
});

const attached_alias_call_fixtures = [
  [
    'direct',
    paths.cursor,
    'backend.getCursorInfo()',
    'backend.getCursorInfo(backend_alias.getCursorInfo())',
  ],
  [
    'Promise.all array',
    paths.codex,
    'backend.getCodexInfo()',
    'backend.getCodexInfo(backend_alias.getCodexInfo())',
  ],
  [
    'sources.map callback',
    paths.cost,
    'backend.getCostOverview(item, force)',
    'backend.getCostOverview(item, force, backend_alias.getCostOverview(item, force))',
  ],
];
for (const [name, path, from, to] of attached_alias_call_fixtures) {
  test(`rejects an attached backend alias call in ${name}`, () => {
    rejects_change(path, from, to, /backend call arguments/);
  });
}

test('rejects a wrong sources.map callback parameter', () => {
  rejects_change(
    paths.cost,
    'sources.map((item) => backend.getCostOverview(item, force))',
    'sources.map((wrong_item) => backend.getCostOverview(item, force))',
    /callback parameter/,
  );
});

test('rejects a malformed direct effect callback', () => {
  rejects_change(
    paths.cost,
    '  useEffect(() => {',
    '  useEffect(not_a_callback);\n  useEffect(() => {',
    /callback must be a block arrow function/,
  );
});

test('rejects a duplicate expected backend method outside the owner target', () => {
  rejects_change(
    paths.cursor,
    '  const request_generation = useLatestRequestGeneration();',
    '  void backend.getCursorInfo();\n  const request_generation = useLatestRequestGeneration();',
    /component call count/,
  );
});

test('rejects a nested dead compliant target in place of the direct owner target', () => {
  rejects_change(
    paths.cursor,
    '  const fetchData = useCallback(async () => {',
    `  if (false) {
    const fetchData = useCallback(async () => {
      const generation = request_generation.begin();
      try {
        const data = await backend.getCursorInfo();
        if (!request_generation.isCurrent(generation)) return;
        void data;
      } catch (err) {
        if (!request_generation.isCurrent(generation)) return;
        void err;
      } finally {
        if (request_generation.isCurrent(generation)) { setLoading(false); }
      }
    }, []);
  }
  const unsafeFetchData = useCallback(async () => {`,
    /target count is not one/,
  );
});

test('rejects an expected backend call that is not awaited', () => {
  rejects_change(
    paths.cursor,
    'const data = await backend.getCursorInfo();',
    'const data = (backend.getCursorInfo(), await Promise.resolve({ connected: true }));',
    /backend call owner/,
  );
});

test('rejects an identifier await operand with an attached backend call', () => {
  rejects_change(
    paths.cursor,
    'const data = await backend.getCursorInfo();',
    'const data = await getData(backend.getCursorInfo());',
    /backend call owner/,
  );
});

test('rejects an expected backend call discarded inside the await operand', () => {
  rejects_change(
    paths.cursor,
    'const data = await backend.getCursorInfo();',
    'const data = await (backend.getCursorInfo(), Promise.resolve({ connected: true }));',
    /directly await/,
  );
});

test('rejects a Codex backend call discarded inside a Promise.all array element', () => {
  rejects_change(
    paths.codex,
    '        backend.getCodexInfo(),',
    '        (backend.getCodexInfo(), Promise.resolve({ connected: true })),',
    /array elements must be direct backend calls/,
  );
});

test('rejects a Cost backend call discarded inside the sources.map callback', () => {
  rejects_change(
    paths.cost,
    'sources.map((item) => backend.getCostOverview(item, force))',
    'sources.map((item) => (backend.getCostOverview(item, force), Promise.resolve(null)))',
    /map callback must directly return a backend call/,
  );
});

test('rejects a missing Cost lane invalidation', () => {
  rejects_change(paths.cost, '      daily_generation.invalidate();\n', '', /invalidate both lanes/);
});

test('rejects a Cost invalidation outside the owning cleanup', () => {
  rejects_change(
    paths.cost,
    '      daily_generation.invalidate();',
    '      if (false) daily_generation.invalidate();',
    /invalidate both lanes/,
  );
});

test('accepts unrelated direct cleanup work without counting it as invalidation', () => {
  accepts_change(
    paths.cost,
    '      daily_generation.invalidate();\n      if (interval !== undefined) {',
    '      daily_generation.invalidate();\n      clearInterval(0);\n      if (interval !== undefined) {',
  );
});

test('rejects a missing Antigravity interval zero branch', () => {
  rejects_change(paths.antigravity, '    if (autoRefreshIntervalMs <= 0) return;\n', '', /interval zero guard/);
});

test('rejects an Antigravity interval zero branch after setInterval', () => {
  rejects_change(
    paths.antigravity,
    '    if (autoRefreshIntervalMs <= 0) return;\n    const interval = setInterval(fetchData, autoRefreshIntervalMs);',
    '    const interval = setInterval(fetchData, autoRefreshIntervalMs);\n    if (autoRefreshIntervalMs <= 0) return;',
    /interval zero guard/,
  );
});
