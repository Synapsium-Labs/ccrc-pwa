// Routing spec 2026-09-14 §4 — the two references the coordinator skill ships
// for routing. Both are PROSE a model follows, so both get the skill tests'
// mechanism: harvest the words that matter and pin them to the code that owns
// them, in both directions where there is a second side.
//
// `routing-matrix.md` is spec §3's table. Its class words are pinned to
// `shared/models.mjs`'s CLASSES and its effort words to ccd's own ROUTE_EFFORTS
// (harvested from `ccd/ccd`, the record's validator): a matrix cell naming a
// class or an effort the record would refuse is a rule the mechanism can never
// apply.
//
// `review-panel.md` is the held-out panel (spec §2, §8 row 13). The mutation it
// reds on: route the panel through the routing fields — an `agent()` call whose
// `model:`/`effort:` is a variable, absent, or anything but the literals.
import { describe, it, expect, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CLASSES } from '../../shared/models.mjs';
import { mkTmp, removeTmpFixtures } from './tmpHelpers.js';

afterEach(removeTmpFixtures);

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const refs = path.join(root, 'ccd/coordinator-skill/references');
const matrix = readFileSync(path.join(refs, 'routing-matrix.md'), 'utf8');
const panel = readFileSync(path.join(refs, 'review-panel.md'), 'utf8');

/** ccd's effort vocabulary, harvested — `worker-skill.test.ts`'s `replayCeiling`
 *  idiom: the validator WRITES this list, and a doc naming a level the
 *  validator refuses is a rule that can never fire. */
const ROUTE_EFFORTS = ((): string[] => {
  const ccd = readFileSync(path.join(root, 'ccd/ccd'), 'utf8');
  const m = /^ROUTE_EFFORTS="([^"]+)"$/m.exec(ccd);
  if (!m) throw new Error('ccd/ccd declares no ROUTE_EFFORTS — the record vocabulary moved');
  return m[1]!.split(' ');
})();

const cap = (s: string): string => s[0]!.toUpperCase() + s.slice(1);

describe('routing-matrix.md — spec §3, pinned to the vocabularies the mechanism enforces', () => {
  const rows = matrix.split('\n').filter((l) => l.startsWith('| ') && !l.startsWith('| Work shape') && !l.startsWith('|---'));

  it('carries the five-column table with at least the nine shapes the spec names', () => {
    expect(matrix).toContain('| Work shape | Main loop | Subagents | Workflow mode | Why |');
    expect(rows.length).toBeGreaterThanOrEqual(9);
    for (const r of rows) expect(r.split('|').length - 2, `a row is not five cells: ${r.slice(0, 60)}`).toBe(5);
  });

  it('every class word in a Main loop or Subagents cell is a CLASSES member, capitalised', () => {
    const allowed = new Set(CLASSES.map(cap));
    for (const r of rows) {
      const cells = r.split('|').slice(1, -1).map((c) => c.trim());
      for (const cell of [cells[1]!, cells[2]!]) {
        for (const m of cell.matchAll(/\b([A-Z][a-z]+) · /g)) {
          expect(allowed.has(m[1]!), `${m[1]} is not a model class (${cell})`).toBe(true);
        }
      }
    }
  });

  it('every effort word after a `·` is one ccd\'s ROUTE_EFFORTS admits', () => {
    for (const m of matrix.matchAll(/ · `?([a-z]+)`?/g)) {
      expect(ROUTE_EFFORTS.includes(m[1]!), `${m[1]} is not a ROUTE_EFFORTS level`).toBe(true);
    }
    expect([...matrix.matchAll(/ · /g)].length).toBeGreaterThanOrEqual(12);
  });

  it('every row is spec §3\'s row byte for byte — one table, two homes', () => {
    // This file's own header calls the matrix "spec §3's table" and nothing
    // measured it. The two copies are hand-edited, in two trees, so a one-sided
    // amendment is invisible until a coordinator reads the reference and finds
    // it disagreeing with the spec it is supposed to be a copy of.
    const spec = readFileSync(
      path.join(root, 'docs/superpowers/specs/2026-09-14-effort-model-routing-design.md'), 'utf8');
    for (const r of rows) {
      expect(spec, `a matrix row the spec does not carry: ${r.slice(0, 70)}…`).toContain(r);
    }
  });

  it('the worker row names the compaction threshold a wave\'s route carries (slice 6, Task 5)', () => {
    // `compact` is the fifth writable field and the only one whose VALUE the
    // matrix has to supply: ccd reads the number, the coordinator picks it, and
    // the matrix is where it picks it from (clause 13). A row that names the
    // model and the effort but not the threshold leaves that field to taste.
    const worker = rows.find((r) => r.startsWith("| Worker executing a spec'd plan"));
    expect(worker, 'the worker row is gone from the matrix').toBeDefined();
    expect(worker).toContain('`compact 40`');
  });

  it('states the floors the mechanism relies on, in the spec\'s words', () => {
    expect(matrix).toContain('Fable is never a fan-out worker');
    expect(matrix).toContain('`max` is never a default');
    expect(matrix).toContain('every workflow agent');
    expect(matrix).toContain('Haiku 4.5 accepts no effort level');
  });

  it('names no route and no destructive verb (it joins the coordinator corpus)', () => {
    expect(matrix).not.toMatch(/\b(GET|POST) \/api\//);
    for (const v of ['ws-reap', 'ws-rm', 'ws-gc']) expect(matrix).not.toContain(v);
  });
});

describe('review-panel.md — the held-out panel, model and effort LITERAL on every agent() call', () => {
  const blocks = [...panel.matchAll(/```js\n([\s\S]*?)\n```/g)].map((m) => m[1]!);

  it('ships exactly one fenced js script, and it parses as a Workflow script', () => {
    expect(blocks.length).toBe(1);
    // A Workflow script runs inside an async function (top-level `return` and
    // `await` are legal there; `export const meta` is hoisted by the runner),
    // so a bare `node --check` on the block rejects the `return`. Wrap it the
    // way the runner does — measured: the unwrapped block fails on
    // "Illegal return statement", the wrapped one passes.
    const wrapped = 'async function __wf(args, agent, pipeline, parallel, log, phase) {\n' +
      blocks[0]!.replace(/^export const meta/m, 'const meta') + '\n}\n';
    const tmp = path.join(mkTmp('ccrc-panel-'), 'panel.mjs');
    writeFileSync(tmp, wrapped);
    expect(() => execFileSync(process.execPath, ['--check', tmp], { stdio: 'pipe' })).not.toThrow();
  });

  it('every agent() call carries model and effort as string literals, opus or sonnet, high', () => {
    const script = blocks[0]!;
    // Each call's options object precedes its `schema:` key (the script's own
    // ordering: label, phase, model, effort, schema), so the text between
    // `agent(` and the next `schema:` is that call's option list.
    const calls = script.split('agent(').slice(1);
    expect(calls.length).toBeGreaterThanOrEqual(2);
    for (const c of calls) {
      const at = c.indexOf('schema:');
      expect(at, `an agent() call without a schema: ${c.slice(0, 80)}`).toBeGreaterThan(0);
      const opts = c.slice(0, at);
      expect(opts, `an agent() call without a literal model: ${opts.slice(0, 80)}`).toMatch(/model: '(opus|sonnet)'/);
      expect(opts, `an agent() call without a literal effort: ${opts.slice(0, 80)}`).toMatch(/effort: 'high'/);
    }
    // lenses on opus, refuters on sonnet — both present
    expect(script).toMatch(/phase: 'Lenses'[^\n]*model: 'opus'/);
    expect(script).toMatch(/phase: 'Refute'[^\n]*model: 'sonnet'/);
    // never a computed model — the mutation that would route the panel through the fields
    expect(script).not.toMatch(/model: (?!')/);
    expect(script).not.toMatch(/effort: (?!')/);
  });

  it('never names Fable, and never inherits: the prose says so and the script obeys', () => {
    expect(panel.toLowerCase()).not.toContain('fable');
    expect(panel).toContain('unverified, never as approval');
    for (const lens of ['correctness', 'spec conformance', 'does-it-reproduce']) expect(panel).toContain(lens);
    expect(panel).toContain('majority');
  });

  it('names no route and no destructive verb (it joins the coordinator corpus)', () => {
    expect(panel).not.toMatch(/\b(GET|POST) \/api\//);
    for (const v of ['ws-reap', 'ws-rm', 'ws-gc']) expect(panel).not.toContain(v);
  });
});
