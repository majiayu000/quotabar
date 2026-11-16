import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('README ccstats SDK version', () => {
  it('names the ccstats version that Cargo.toml depends on', () => {
    const manifest = readFileSync(new URL('../src-tauri/Cargo.toml', import.meta.url), 'utf8');
    const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8');
    const dependency = /^ccstats\s*=\s*(?:"|\{[^}\n]*\bversion\s*=\s*")([^"]+)"/m.exec(manifest)?.[1];
    const documented = /published ccstats\s+(\S+)\s+SDK from crates\.io/.exec(readme)?.[1];
    expect(dependency).toBeDefined();
    expect(documented).toBe(dependency);
  });
});
