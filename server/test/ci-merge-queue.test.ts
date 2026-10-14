/**
 * The merge queue's half of `.github/workflows/ci.yml` (landing-order stage 2,
 * spec §5.2), on CI test selection's shape (#183). Five properties, each read
 * from the file or from the modules it runs, never trusted to a comment:
 *
 *  1. `merge_group` is a trigger. Without it a queue entry's required checks
 *     never report, and the queue removes the entry at its timeout.
 *  2. A queue run has a concurrency group of its OWN, and nothing cancels it.
 *     GitHub keeps one PENDING run per group and cancels the older one even
 *     with `cancel-in-progress: false`, so a queue run in the shared `refresh`
 *     group (or any group another run shares) could lose its checks.
 *  3. A queue run skips every macOS job and every job that needs one
 *     (`full-suite`), and NOTHING a required check needs mentions
 *     `merge_group` — but for the one step that asks the pipeline question of
 *     a queue run too. The second half is the dangerous one: GitHub reports a
 *     job skipped by `if:` as passing, so a required leg that skipped the
 *     queue would let the queue merge a tree nobody tested.
 *  4. A queue run runs what a pull request runs (operator ruling 2026-09-28):
 *     the header's mode table says so, and `decideMode` agrees for every input.
 *  5. The selector and the verdict agree on which triggers may never answer
 *     `tests: none` — derived from `on:`, so a trigger added to one module's
 *     pull-request arm and not the other's reds here.
 *
 * DERIVED, not listed: "a macOS job" is any job whose block says
 * `runs-on: macos-…`, "needs one" is the transitive `needs:` closure, and the
 * required legs' prerequisites are the closure of the three jobs that carry a
 * required name — so a job CI selection adds later is held to rule 3 without
 * this file learning its name.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { decideMode, modeInvariantViolation } from '../../.github/ci/select.mjs';
import { serverVerdict } from '../../.github/ci/verdict.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const ci = (): string => readFileSync(path.join(ROOT, '.github', 'workflows', 'ci.yml'), 'utf8');

/** The lines of one TOP-LEVEL key's block: everything after `^<key>:` up to the
 *  next line that opens another top-level key. A SECOND block with the same key
 *  is a duplicate YAML key — invalid, and invisible to a reader that stops at
 *  the first — so this refuses one. */
function topBlock(yml: string, key: string): string[] {
  const lines = yml.split('\n');
  const heads = lines.flatMap((l, i) => (l === `${key}:` || l.startsWith(`${key}: `) ? [i] : []));
  expect(heads.length, `ci.yml carries ${heads.length} top-level \`${key}:\` keys`).toBe(1);
  const rest = lines.slice(heads[0]! + 1);
  const end = rest.findIndex((l) => /^[A-Za-z_][\w-]*:/.test(l));
  return end < 0 ? rest : rest.slice(0, end);
}

/** `jobs:` as job id -> that job's lines (every job key at two-space indent). */
function jobs(yml: string): Map<string, string[]> {
  const out = new Map<string, string[]>();
  let cur: string[] | null = null;
  for (const l of topBlock(yml, 'jobs')) {
    const head = /^ {2}([A-Za-z][\w-]*):\s*$/.exec(l);
    if (head) { cur = []; out.set(head[1]!, cur); continue; }
    cur?.push(l);
  }
  expect(out.size, 'parsed no jobs at all').toBeGreaterThan(0);
  return out;
}

/** Every occurrence of a job-level scalar key (four-space indent) — more than
 *  one is a duplicate key. */
function jobKeys(block: string[], key: string): string[] {
  return block.flatMap((l) => { const m = new RegExp(`^ {4}${key}: (.*)$`).exec(l); return m ? [m[1]!] : []; });
}

const needsOf = (block: string[]): string[] => {
  const v = jobKeys(block, 'needs')[0];
  return v === undefined ? [] : v.replace(/^\[|\]$/g, '').split(',').map((s) => s.trim()).filter(Boolean);
};

/** Split an expression at its TOP level (outside parentheses) on `op`. */
function topLevel(expr: string, op: ' && ' | ' || '): string[] {
  const parts: string[] = [];
  let depth = 0; let start = 0;
  for (let i = 0; i < expr.length; i++) {
    const c = expr[i];
    if (c === '(') depth++;
    else if (c === ')') depth--;
    else if (depth === 0 && expr.startsWith(op, i)) { parts.push(expr.slice(start, i)); start = i + op.length; i += op.length - 1; }
  }
  parts.push(expr.slice(start));
  return parts.map((p) => p.trim());
}

const SKIP = "github.event_name != 'merge_group'";
const ALLOW_LIST = /^github\.event_name == '[a-z_]+'(?: \|\| github\.event_name == '[a-z_]+')*$/;

/** Whether a job-level `if:` keeps a `merge_group` run out: either the skip is
 *  one of its TOP-LEVEL conjuncts and it has no top-level `||` (a disjunct
 *  would route around the conjunct), or it is a pure event allow-list that does
 *  not name `merge_group`. */
function skipsQueue(cond: string | undefined): boolean {
  if (cond === undefined) return false;
  if (topLevel(cond, ' || ').length > 1) return ALLOW_LIST.test(cond) && !cond.includes('merge_group');
  return topLevel(cond, ' && ').includes(SKIP);
}

const onKeys = (): string[] => topBlock(ci(), 'on').flatMap((l) => { const m = /^ {2}([a-z_]+):/.exec(l); return m ? [m[1]!] : []; });

/** The ONE place the required closure may name the event: `select`'s pipeline
 *  check, a STEP (never a job-level condition), which asks a queue run the
 *  pull request's question against the queue's base (rule 4). */
const PIPELINE_STEP_LINES = [
  "        if: github.event_name == 'pull_request' || github.event_name == 'merge_group'",
  "          BASE: ${{ github.event_name == 'merge_group' && github.event.merge_group.base_sha || format('origin/{0}', github.base_ref) }}",
];

describe('ci.yml and the merge queue (landing-order stage 2, on CI selection\'s shape)', () => {
  it('triggers on merge_group, beside pull_request', () => {
    const on = onKeys();
    expect(on, 'ci.yml no longer triggers on pull_request').toContain('pull_request');
    expect(on, 'ci.yml does not trigger on merge_group — a queue entry would never get its required checks')
      .toContain('merge_group');
  });

  it('gives a queue run a concurrency group of its own, and never cancels one', () => {
    const block = topBlock(ci(), 'concurrency');
    const group = block.find((l) => l.startsWith('  group: ')) ?? '';
    // Run-unique: `github.run_id` is unique per run. An arm keyed on the ref,
    // the sha or the mode could be shared, and a shared group drops pending runs.
    expect(group, 'a merge_group run has no group of its own — it falls through to a shared one')
      .toContain("github.event_name == 'merge_group' && format('queue-{0}', github.run_id)");
    // …and it is taken BEFORE the shared push-to-main group can be reached.
    expect(group.indexOf("format('queue-{0}', github.run_id)"), 'the queue arm sits after the shared refresh arm')
      .toBeLessThan(group.indexOf("'refresh'"));
    expect(block, 'cancel-in-progress must be the pull_request event and nothing wider — a cancelled queue run removes the entry')
      .toContain("  cancel-in-progress: ${{ github.event_name == 'pull_request' }}");
  });

  it('keeps every macOS job, and every job that needs one, off a queue run — and no required prerequisite mentions merge_group', () => {
    const all = jobs(ci());
    const isMac = (b: string[]): boolean => b.some((l) => /^ {4}runs-on: macos-/.test(l));
    // Guard the guard: a reader that parsed no macOS job makes the loop vacuous.
    const macs = [...all].filter(([, b]) => isMac(b)).map(([n]) => n);
    expect(macs.length, 'parsed no macOS job at all — this test went blind').toBeGreaterThan(0);
    // Every job that needs a macOS job, transitively (full-suite needs test-macos).
    const needsMac = (id: string, seen = new Set<string>()): boolean => {
      if (seen.has(id)) return false; seen.add(id);
      return needsOf(all.get(id) ?? []).some((n) => macs.includes(n) || needsMac(n, seen));
    };
    const offQueue = [...all.keys()].filter((id) => macs.includes(id) || needsMac(id));
    expect(offQueue, 'full-suite no longer needs a macOS leg — re-derive this rule').toContain('full-suite');
    for (const id of offQueue) {
      const conds = jobKeys(all.get(id)!, 'if');
      expect(conds.length, `job \`${id}\` carries ${conds.length} job-level if: keys`).toBeLessThanOrEqual(1);
      expect(skipsQueue(conds[0]), `job \`${id}\` runs on a merge_group run: ${conds[0] ?? '(no if:)'}`).toBe(true);
    }
    // The required legs and everything they need: none may mention merge_group,
    // because a required leg skipped by `if:` reads as PASSING to the queue.
    const req = new Set<string>();
    const walk = (id: string): void => { if (req.has(id)) return; req.add(id); needsOf(all.get(id) ?? []).forEach(walk); };
    ['server', 'test', 'build-pwa'].forEach(walk);
    expect([...req].sort()).toEqual(['build-pwa', 'select', 'server', 'server-shard', 'server-typecheck', 'test']);
    for (const id of req) {
      const code = (all.get(id) ?? []).filter((l) => !/^\s*#/.test(l) && !PIPELINE_STEP_LINES.includes(l)).join('\n');
      expect(code, `\`${id}\` mentions merge_group — a required leg skipped by if: reports as PASSING, and the queue would merge an untested tree`)
        .not.toContain('merge_group');
    }
  });

  it('runs what a pull request runs: the mode table has the row, and decideMode agrees for every input', () => {
    const header = ci().split('\n').filter((l) => l.startsWith('#'));
    const row = (ev: string): string | undefined => header.map((l) => new RegExp(`^#   ${ev}\\s{2,}(\\w+)`).exec(l)?.[1]).find(Boolean);
    expect(row('merge_group'), 'the header mode table has no merge_group row').toBeDefined();
    expect(row('merge_group')).toBe(row('pull_request'));
    expect(row('merge_group')).toBe(decideMode({ event: 'merge_group', fullGreen: false }).tests);
    for (const inputMode of [undefined, 'full', 'rebuild']) {
      for (const fullGreen of [false, true]) {
        expect(decideMode({ event: 'merge_group', inputMode, fullGreen }), `inputMode=${inputMode} fullGreen=${fullGreen}`)
          .toEqual(decideMode({ event: 'pull_request', inputMode, fullGreen }));
      }
    }
  });

  it('the selector and the verdict agree on which triggers may never answer tests: none', () => {
    const events = onKeys();
    expect(events.length, 'parsed no triggers').toBeGreaterThan(0);
    for (const event of events) {
      const neverNone = [undefined, 'full', 'rebuild'].every((inputMode) =>
        [false, true].every((fullGreen) => decideMode({ event, inputMode, fullGreen }).tests !== 'none'));
      expect(modeInvariantViolation(event, undefined, 'none') !== null, `${event}: select.mjs's invariant disagrees with decideMode`)
        .toBe(neverNone);
      const v = serverVerdict({ select: 'success', typecheck: '', shards: '', tests: 'none', count: '', event });
      expect(v.ok, `${event}: verdict.mjs reads tests: none as ${v.ok ? 'green' : 'red'}, decideMode says it ${neverNone ? 'can never' : 'can'} happen`)
        .toBe(!neverNone);
    }
  });
});
