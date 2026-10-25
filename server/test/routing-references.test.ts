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
import { ROUTE_DEFAULT_BY_KIND, routeDefaultFor } from '../../shared/route-defaults.js';
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

  it('the worker row puts the per-task reviewer on Sonnet high, not Opus (D-6797)', () => {
    // The held-out panel is the gate, so the per-task reviewer inside a wave
    // is the cheaper rung; the panel's judgement lenses stay on Opus high.
    const worker = rows.find((r) => r.startsWith("| Worker executing a spec'd plan"))!;
    expect(worker).toContain('Sonnet · high per-task reviewer');
    expect(worker).not.toContain('Opus · high per-task reviewer');
    expect(matrix).toContain('Opus · high review lenses');
  });

  it('the table the server fills an unrouted dispatch from IS the matrix\'s two rows (D-6794)', () => {
    // One table, two homes: `shared/route-defaults.ts` is what the server writes, the matrix is what the
    // coordinator reads. Each row is parsed back into the route words and compared whole, so a one-sided edit
    // (a class, an effort, the subagent class, the workflow mode or the compaction threshold) reds here.
    const rowFields = (start: string): Record<string, string> => {
      const row = rows.find((r) => r.startsWith(start));
      expect(row, `the matrix lost its row: ${start}`).toBeDefined();
      const cells = row!.split('|').slice(1, -1).map((c) => c.trim());
      const main = /^([A-Z][a-z]+) · (\w+)/.exec(cells[1]!)!;
      const sub = /^([A-Z][a-z]+) · /.exec(cells[2]!)!;
      return {
        class: main[1]!.toLowerCase(), effort: main[2]!, subagent: sub[1]!.toLowerCase(),
        workflow: /^On\b/.test(cells[3]!) ? 'on' : 'off', compact: /`compact (\d+)`/.exec(cells[4]!)![1]!,
      };
    };
    expect(ROUTE_DEFAULT_BY_KIND.work).toEqual(rowFields("| Worker executing a spec'd plan"));
    expect(ROUTE_DEFAULT_BY_KIND.review).toEqual(rowFields('| Review session main loop'));
    expect(routeDefaultFor('unknown')).toBeNull();
  });

  it('workflows are enabled only where clause 19 can launch one, every worker-facing row is off, and no row names ultracode', () => {
    // `Workflow mode` is the `enableWorkflows` setting the route's `workflow` field composes, so `Off` would make a
    // clause-19 workflow impossible to launch at all. Enabled is therefore the review run (its held-out panel), the
    // coordinator and the brainstorm row (a short, self-contained, time-capped workflow under coordinator clause 19);
    // a worker never launches one (worker clause 19), so the worker, bulk and whole-branch rows are off. `ultracode`
    // is xhigh plus STANDING workflow orchestration, the default clause 19 abolishes, so no row may name it.
    const wf = (r: string): string => r.split('|').slice(1, -1).map((c) => c.trim())[3]!;
    const enabled = ['| Coordinator: opens the program', '| Brainstorm, spec, architecture', '| Review session main loop'];
    const on = rows.filter((r) => /^On\b/.test(wf(r)));
    expect(on.map((r) => enabled.find((e) => r.startsWith(e)) ?? r.slice(0, 40)), 'the rows with workflows enabled')
      .toEqual(enabled);
    for (const start of ["| Worker executing a spec'd plan", '| Bulk independent work', '| Whole-branch review pass']) {
      const row = rows.find((r) => r.startsWith(start));
      expect(row, `the matrix lost its row: ${start}`).toBeDefined();
      expect(wf(row!), `${start} must run with workflows off (worker clause 19)`).toMatch(/^Off\b/);
    }
    for (const start of ['| Coordinator: opens the program', '| Brainstorm, spec, architecture']) {
      const cell = wf(rows.find((r) => r.startsWith(start))!);
      expect(cell, `${start}: enabled only for a clause-19 workflow`).toContain('clause 19');
      expect(cell).toContain('never standing orchestration');
    }
    for (const r of rows) expect(r, `a row still routes to ultracode: ${r.slice(0, 60)}`).not.toContain('ultracode');
    const bulk = rows.find((r) => r.startsWith('| Bulk independent work'))!;
    expect(bulk).toContain('more worker waves the coordinator dispatches');
    const branch = rows.find((r) => r.startsWith('| Whole-branch review pass'))!;
    expect(branch).toContain('a review run');
  });

  it('ccd\'s ROUTE_COORDINATOR_ROW, the default every operator spawn gets, IS the matrix\'s coordinator row', () => {
    // One row, two homes, like `shared/route-defaults.ts` above: the matrix is what the coordinator reads, and
    // `ROUTE_COORDINATOR_ROW` in `ccd/ccd` is what `_route_seed_default` writes onto an operator spawn. A matrix row
    // saying `high` over a spawn that still types `ultracode` is the gap this pins shut (coordinator clause 19).
    const ccd = readFileSync(path.join(root, 'ccd/ccd'), 'utf8');
    const m = /^ROUTE_COORDINATOR_ROW="([^"]+)"/m.exec(ccd);
    expect(m, 'ccd/ccd declares no ROUTE_COORDINATOR_ROW').not.toBeNull();
    const spawned = Object.fromEntries(m![1]!.split(' ').map((kv) => kv.split('=') as [string, string]));
    const row = rows.find((r) => r.startsWith('| Coordinator: opens the program'));
    expect(row, 'the matrix lost its coordinator row').toBeDefined();
    const cells = row!.split('|').slice(1, -1).map((c) => c.trim());
    const main = /^([A-Z][a-z]+) · (\w+)/.exec(cells[1]!)!;
    // The cell opens with the bare class (its Agent-tool subagents run at the session's effort, so it names none).
    const sub = /^([A-Z][a-z]+)\b/.exec(cells[2]!);
    expect(sub, 'the coordinator row\'s Subagents cell must open with its subagent class').not.toBeNull();
    expect(CLASSES.map(cap), `${sub![1]} is not a model class`).toContain(sub![1]!);
    expect(spawned).toEqual({
      class: main[1]!.toLowerCase(), effort: main[2]!, subagent: sub![1]!.toLowerCase(),
      workflow: /^On\b/.test(cells[3]!) ? 'on' : 'off',
    });
  });

  it('a session with no routing record is typed the coordinator row\'s effort, never ultracode (SPAWN_EFFORT)', () => {
    const ccd = readFileSync(path.join(root, 'ccd/ccd'), 'utf8');
    const spawnEffort = /^SPAWN_EFFORT="([^"]*)"/m.exec(ccd)?.[1];
    const coordEffort = /^ROUTE_COORDINATOR_ROW="[^"]*\beffort=(\w+)/m.exec(ccd)?.[1];
    expect(spawnEffort, 'ccd/ccd declares no SPAWN_EFFORT').toBeDefined();
    expect(spawnEffort).not.toBe('ultracode');
    expect(spawnEffort).toBe(coordEffort);
  });

  it('reaches a subagent effort below the main loop through more workers, never a worker\'s Workflow', () => {
    const flat = matrix.replace(/\s+/g, ' ');
    expect(flat).not.toContain('is reached through a Workflow call, or accepts the session\'s effort');
    expect(flat).toContain('never through a worker\'s Workflow');
    expect(flat).toContain('more workers dispatched at that effort');
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

  it('caps each lens at its 8 most severe findings, in the schema and in the prompt (D-6796)', () => {
    const script = blocks[0]!;
    expect(script).toMatch(/findings: \{ type: 'array', maxItems: 8,/);
    // every lens prompt carries the cap, not just one of them
    expect(script.match(/8 most severe/g)?.length).toBe(3);
    expect(panel).toContain('8 most severe');
  });

  it('keeps 3 refuters for critical and important, gives a minor 1, and returns a minor as advisory (D-6796)', () => {
    const script = blocks[0]!;
    expect(script).toMatch(/f\.severity === 'minor' \? 1 : 3/);
    expect(script).toMatch(/return \{ confirmed, advisory, refuted, unexamined, unverifiedLenses \}/);
    // the advisory bucket is the minor survivors; confirmed never holds a minor
    expect(script).toMatch(/const advisory = [^\n]*'minor'/);
    expect(script).toMatch(/const confirmed = [^\n]*!== 'minor'/);
    expect(panel).toContain('advisory');
    expect(panel.replace(/\s+/g, ' ')).toContain('never fails a wave alone');
  });

  it('keeps the 2-of-3 kill rule for critical and important, and kills a minor on one refutation (D-6796)', async () => {
    const run = async (severity: string, votes: Array<{ refuted: boolean } | null>) => {
      const body = blocks[0]!.replace(/^export const meta/m, 'const meta');
      const fn = new Function('args', 'agent', 'pipeline', 'parallel', 'log', 'phase',
        `return (async () => {\n${body}\n})()`);
      let v = 0;
      const agent = async (_p: string, o: { phase: string }) =>
        o.phase === 'Lenses' ? { findings: [{ file: 'a.ts', claim: 'c', severity }] } : (votes[v++] ?? null);
      const pipeline = async (items: unknown[], s1: (x: unknown) => Promise<unknown>, s2: (r: unknown, x: unknown) => Promise<unknown>) =>
        Promise.all(items.map(async (x) => s2(await s1(x), x)));
      const parallel = (fs: Array<() => Promise<unknown>>) => Promise.all(fs.map((f) => f()));
      return fn({ repo: 'r', base: 'b', tip: 't', plan: 'p', spec: 's', wave: 1 }, agent, pipeline, parallel, () => {}, () => {}) as Promise<
        { confirmed: unknown[]; advisory: unknown[]; refuted: unknown[] }>;
    };
    // two refuters die, the one left votes refuted: stays confirmed (the main rule: refuted < 2)
    const one = await run('critical', [null, null, { refuted: true }]);
    expect(one.confirmed.length).toBe(1);
    expect(one.refuted.length).toBe(0);
    // two of three refute: dropped
    const two = await run('important', [{ refuted: true }, { refuted: true }, { refuted: false }]);
    expect(two.refuted.length).toBe(1);
    // a minor with its single refuter refuting is dropped; surviving it is advisory only
    expect((await run('minor', [{ refuted: true }])).refuted.length).toBe(1);
    const adv = await run('minor', [{ refuted: false }]);
    expect(adv.advisory.length).toBe(1);
    expect(adv.confirmed.length).toBe(0);
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
