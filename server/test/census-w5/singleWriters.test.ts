// W5's non-account single-writer census, held two ways (D-7071; ARCH-72, Task C5d; plan
// 2026-10-27-consolidation-w5-ccd-helpers.md; spec K16): a FIXTURE tree, so each query counts what it claims and passes
// over what it must not (a read, a comparison, a type, an initialiser; a writer's own staged temp), and the REAL tree.
// `ccdVerbsWriters()`'s writers REPORT, as `accountMarkers.test.ts` (C5a) does (`reportRow.ts#expectReportRow`): 3 at
// base, C5j takes them to 1 (`fleetstate.ts#recordCcdVerbs`) and lands the exact may-only-shrink pin in its ratchet
// commit; the row holds only that every name is a base site or that target, each once (C5j Step 3 adds the target beside
// the three before the callers move, 4; a writer under any other name reds).
// Its 2 initialisers, and `usageSidecarDeleters()` 2 (C5k pins them by name, may only shrink; OA-C13 ruled (b)), are
// pinned by name now: nothing in the series moves them.
import { afterEach, describe, expect, it } from 'vitest';
import { appendFileSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ccdVerbsWriters, usageSidecarDeleters, type WriterSite } from './singleWriters.js';
import { expectReportRow } from './reportRow.js';

const show = (name: string, sites: readonly WriterSite[]): void => {
  console.log(`census ${name}: ${sites.length}\n${sites.map((s) => `  ${s.name}  (${s.file}:${s.line}  ${s.text.trim()})`).join('\n')}`);
};

let roots: string[] = [];
afterEach(() => { for (const r of roots) rmSync(r, { recursive: true, force: true }); roots = []; });
const tree = (files: Record<string, string>): string => {
  const t = mkdtempSync(path.join(tmpdir(), 'w5-writers-'));
  roots.push(t);
  for (const [rel, body] of Object.entries(files)) {
    const p = path.join(t, rel);
    mkdirSync(path.dirname(p), { recursive: true });
    writeFileSync(p, body, { mode: 0o755 });
  }
  return t;
};

describe('ccdVerbsWriters: assignments to FleetState.ccdVerbs under server/src (D-7071)', () => {
  it('FIXTURE: an assignment is a writer, named by its enclosing symbol; a read, a comparison, a type, an arrow property and an initialiser are not', () => {
    const t = tree({
      'server/src/a.ts': [
        'export interface S { ccdVerbs: string[] | null; }',
        'export class C {',
        '  private state = { connected: false, ccdVerbs: null };',
        '  onFrame(f: { ccdVerbs?: unknown }): void {',
        '    this.state.ccdVerbs = Array.isArray(f.ccdVerbs) ? (f.ccdVerbs as string[]) : null;',
        '  }',
        '  same(): boolean { return this.state.ccdVerbs === null; }',
        '}',
        'export const deps = { ccdVerbs: () => null };',
      ].join('\n'),
      'server/src/b.ts': 'export function make(s: { ccdVerbs: string[] | null }) {\n  return (v: string[]) => { s.ccdVerbs = v; };\n}\n',
    });
    const r = ccdVerbsWriters(t);
    expect(r.writers.map((s) => `${s.name}:${s.line}`)).toEqual(['a.ts#onFrame:5', 'b.ts#make:2']);
    expect(r.initialisers.map((s) => `${s.name}:${s.line}`)).toEqual(['a.ts#C:3']);
  });

  it('REAL: writers by name (3 at base, `remote/client.ts#onReady`, `refreshcaps.ts#makeRefreshCaps` and the local-mode closure at index.ts\'s module level; 1 at C5j, `fleetstate.ts#recordCcdVerbs`, pinned in late-census.test.ts); the 2 initialisers pinned apart', () => {
    const r = ccdVerbsWriters();
    show('ccdVerbsWriters', r.writers);
    show('ccdVerbsWriters (initialisers, not writers)', r.initialisers);
    expectReportRow('ccdVerbsWriters', r.writers.map((s) => s.name),
      ['index.ts#(module)', 'refreshcaps.ts#makeRefreshCaps', 'remote/client.ts#onReady'], ['fleetstate.ts#recordCcdVerbs'], 1);
    expect(r.writers.map((s) => s.name), 'C5j reached its target').toEqual(['fleetstate.ts#recordCcdVerbs']);
    expect(r.initialisers.map((s) => s.file).sort()).toEqual(['server/src/index.ts', 'server/src/remote/client.ts']);
  });
});

describe('ccdVerbsWriters\' REPORT bound, held by mutants of the real server/src (D-7071; `reportRow.ts#expectReportRow`)', () => {
  const BASE = ['index.ts#(module)', 'refreshcaps.ts#makeRefreshCaps', 'remote/client.ts#onReady'];
  const TARGET = ['fleetstate.ts#recordCcdVerbs'];
  const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src');
  /** A tree holding every real `server/src` file that names `ccdVerbs` (the query reads no other). */
  const realTree = (): string => {
    const files: Record<string, string> = {};
    for (const rel of readdirSync(SRC, { recursive: true }) as string[]) {
      if (!/\.tsx?$/.test(rel)) continue;
      const text = readFileSync(path.join(SRC, rel), 'utf8');
      if (text.includes('ccdVerbs')) files[path.join('server/src', rel)] = text;
    }
    return tree(files);
  };
  const SETTER = '\nexport function recordCcdVerbs(state: { ccdVerbs: string[] | null }, verbs: string[] | null): boolean {\n'
    + '  state.ccdVerbs = verbs;\n  return true;\n}\n';

  it('the copied tree reports what the live query reports', () => {
    expect(ccdVerbsWriters(realTree()).writers.map((s) => s.name).sort()).toEqual(ccdVerbsWriters().writers.map((s) => s.name).sort());
  });

  it('GREEN: C5j Step 3\'s tree, `recordCcdVerbs` added before the callers move (4 at the base), still reports', () => {
    const t = realTree();
    // Planted only where the tree does not define it yet: at the base this is C5j Step 3's tree, after it the live tree.
    if (!ccdVerbsWriters(t).writers.some((s) => TARGET.includes(s.name))) appendFileSync(path.join(t, 'server/src/fleetstate.ts'), SETTER);
    const names = ccdVerbsWriters(t).writers.map((s) => s.name);
    expect(names).toEqual(expect.arrayContaining(TARGET));
    expectReportRow('ccdVerbsWriters', names, BASE, TARGET, 1);
  });

  it('RED: a fourth writer under a new name', () => {
    const t = realTree();
    writeFileSync(path.join(t, 'server/src/poke.ts'), 'export function poke(s: { ccdVerbs: string[] | null }): void {\n  s.ccdVerbs = [];\n}\n');
    const names = ccdVerbsWriters(t).writers.map((s) => s.name);
    expect(names).toContain('poke.ts#poke');
    expect(() => expectReportRow('ccdVerbsWriters', names, BASE, TARGET, 1)).toThrow(/neither a base site nor the plan's target/);
  });
});

describe('usageSidecarDeleters: the functions that remove a usage sidecar (D-7071)', () => {
  it('FIXTURE: a bash rm of a usage/ path and a python body removing under "usage" are deleters; a writer\'s own staged temp is reported apart; other removals are neither', () => {
    const t = tree({
      'ccd/ccd': '#!/usr/bin/env bash\npurge() {\n  rm -f -- "$REG/usage/$1.json" 2>/dev/null || :\n}\nother() { rm -f "$REG/$1.uuid"; }\n',
      'ccd/writer.sh': 'usage_tmp="$dir/.$id.$$.tmp"\nprintf x > "$usage_tmp" && mv -f "$usage_tmp" "$usage_file" || rm -f "$usage_tmp"\n',
      'ccd/sweep.py': 'import os\ndef reap(reg):\n    d = os.path.join(reg, "usage")\n    os.remove(os.path.join(d, "x.json"))\n\ndef tidy(p):\n    os.remove(p)\n',
    });
    const r = usageSidecarDeleters(t);
    expect(r.deleters.map((s) => s.name)).toEqual(['ccd/ccd#purge', 'ccd/sweep.py#reap']);
    expect(r.stagedTempCleanup.map((s) => s.name)).toEqual(['ccd/writer.sh#<top-level>']);
  });

  it('REAL: 2, `ccd/ccd#_usage_purge` and `ccd/ccd-usage-sweep.py#reap_orphans`; the statusline\'s staged-temp cleanup reported apart', () => {
    const r = usageSidecarDeleters();
    show('usageSidecarDeleters', r.deleters);
    show('usageSidecarDeleters (staged-temp cleanup, not a deleter)', r.stagedTempCleanup);
    expect(r.deleters.map((s) => s.name)).toEqual(['ccd/ccd#_usage_purge', 'ccd/ccd-usage-sweep.py#reap_orphans']);
    expect(r.stagedTempCleanup.map((s) => s.name)).toEqual(['ccd/statusline-command.sh#<top-level>']);
  });
});
