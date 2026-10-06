// Child-reclamation wave 5 (spec §5.9): the sweep's verdicts, its attention list
// and a request's `feedQuiet` are what the run chip and the feed SAY. None of
// them may decide a reclaim — whether a child is asked, licensed past its defer
// ceiling, ordered or paced. As a red suite: every CODE reader of each, in all
// of server/src, is in a named allowlist, so a decision that starts reading one
// is a red here before it is a reclaim nobody licensed.
//
// Code only (`codeOnly`, shared with child-reclaim-chip-source.test.ts): a
// sentence ABOUT a field is not a read of it, and several docstrings name these.
// Each allowlist names EXPRESSIONS, not whole lines: every code occurrence of
// the name must sit inside an instance of an allowed expression, and the
// instances are counted. So a new read anywhere — a second one on an allowed
// line included — reds, while a neighbouring edit that touches no read (another
// field after it in the same object literal, say) does not.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { codeOnly } from './sourceScan.js';

const srcRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src');

/** Every `.ts` under server/src, recursively. */
const sources = (dir = srcRoot): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) return sources(full);
    return /\.ts$/.test(e.name) ? [full] : [];
  });

/** One `<file>: <code line>` per OCCURRENCE of `re` in server/src's code,
 *  sorted — a line that mentions the name twice is listed twice. */
const codeHits = (re: RegExp): string[] =>
  sources().flatMap((f) => codeOnly(readFileSync(f, 'utf8')).split('\n').flatMap((l) =>
    [...l.matchAll(new RegExp(re.source, 'g'))].map(() => `${path.relative(srcRoot, f)}: ${l.trim()}`))).sort();

/** `code`'s occurrences of `name`, against the `allowed` expressions: one
 *  `<label>: <expression>` per instance of an allowed expression that holds an
 *  occurrence, and one `<label>: NOT ALLOWED <line>` per occurrence that no
 *  allowed instance holds. Sorted. */
const coverage = (label: string, code: string, name: RegExp, allowed: readonly string[]): string[] => {
  const g = new RegExp(name.source, 'g');
  const held = new Set<number>();
  const out: string[] = [];
  for (const e of allowed) {
    for (let at = code.indexOf(e); at !== -1; at = code.indexOf(e, at + 1)) {
      const inside = [...e.matchAll(g)].map((m) => at + m.index);
      if (inside.length === 0) continue;
      for (const i of inside) held.add(i);
      out.push(`${label}: ${e}`);
    }
  }
  for (const m of code.matchAll(g)) {
    if (held.has(m.index)) continue;
    const from = code.lastIndexOf('\n', m.index) + 1;
    const to = code.indexOf('\n', m.index);
    out.push(`${label}: NOT ALLOWED ${code.slice(from, to === -1 ? undefined : to).trim()}`);
  }
  return out.sort();
};

/** `coverage` over every file in server/src, labelled by its path there. */
const expressionHits = (name: RegExp, allowed: readonly string[]): string[] =>
  sources().flatMap((f) => coverage(path.relative(srcRoot, f), codeOnly(readFileSync(f, 'utf8')), name, allowed)).sort();

/** `FleetWatcher.sweepChildReclaim`, whole: from its signature to its closing
 *  brace, code only. */
const sweepChildReclaimLines = (): string[] => {
  const lines = codeOnly(readFileSync(path.join(srcRoot, 'watch.ts'), 'utf8')).split('\n');
  const start = lines.findIndex((l) => l.startsWith('  async sweepChildReclaim('));
  const end = lines.findIndex((l, i) => i > start && l === '  }');
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  return lines.slice(start, end + 1);
};

describe('the sweep’s verdicts are read by no decision (spec §5.9)', () => {
  it('(a) the verdict map has its declaration, accessor, two reductions, one assignment, the attention write and the chip route', () => {
    const DECLARATION = 'private childReclaimJudged: ReadonlyMap<string, ChildReclaimSweepVerdict> | null = null';
    const ACCESSOR = 'currentChildReclaimVerdicts(): ReadonlyMap<string, ChildReclaimSweepVerdict> | null';
    const ACCESSOR_READ = 'return this.childReclaimJudged';
    const REDUCTION =
      'if (this.childReclaimJudged !== null) this.childReclaimJudged = childReclaimKeptVerdicts(this.childReclaimJudged)';
    const ASSIGNMENT = 'this.childReclaimJudged = judged';
    const PUBLISH = 'this.childReclaimJudged ?? new Map<string, ChildReclaimSweepVerdict>()';
    const ROUTE = 'verdicts: watcher?.currentChildReclaimVerdicts() ?? null';
    expect(expressionHits(/\bchildReclaimJudged\b|\bcurrentChildReclaimVerdicts\(/,
      [DECLARATION, ACCESSOR, ACCESSOR_READ, REDUCTION, ASSIGNMENT, PUBLISH, ROUTE])).toEqual([
      // routes.ts `composeChildReclaim`: the chip's inputs, display only.
      `coord/routes.ts: ${ROUTE}`,
      `watch.ts: ${DECLARATION}`,
      // The accessor, `currentChildReclaimVerdicts`.
      `watch.ts: ${ACCESSOR}`,
      `watch.ts: ${ACCESSOR_READ}`,
      // The two reductions to the kept verdicts, on a pass that judged nothing
      // (the failed read; the switches).
      `watch.ts: ${REDUCTION}`, `watch.ts: ${REDUCTION}`,
      // The one assignment, after the judging loop.
      `watch.ts: ${ASSIGNMENT}`,
      // `childReclaimPublishAttention`, the attention list's one write.
      `watch.ts: ${PUBLISH}`,
    ].sort());
  });

  it('(b) across the whole of sweepChildReclaim, the local `judged` is declared, set per child and assigned — nothing else', () => {
    const body = sweepChildReclaimLines();
    // The slice reaches the decisions this pin protects: the ask order, the
    // ceiling licence and the request's feed state are all inside it.
    expect(body.some((l) => l.includes('childReclaimAskOrder(due)'))).toBe(true);
    expect(body.some((l) => l.includes('licensed: childReclaimDeferExpired('))).toBe(true);
    expect(body.some((l) => l.includes('feedQuiet: childReclaimFeedQuiet('))).toBe(true);
    const DECLARED = 'const judged = new Map<string, ChildReclaimSweepVerdict>()';
    const SET = 'judged.set(r.id, v)';
    const ASSIGNED = 'this.childReclaimJudged = judged';
    expect(coverage('sweepChildReclaim', body.join('\n'), /\bjudged\b/, [DECLARED, SET, ASSIGNED])).toEqual([
      `sweepChildReclaim: ${DECLARED}`, `sweepChildReclaim: ${SET}`, `sweepChildReclaim: ${ASSIGNED}`,
    ].sort());
  });

  it('(c) the attention list is read only by the coord frame and the feedQuiet call site', () => {
    const DECLARATION = 'private childReclaimAttentionList: readonly ChildReclaimAttention[]';
    const FRAME = 'childReclaimAttention: this.childReclaimAttentionList';
    const FEED_QUIET = 'childReclaimFeedQuiet(entry, this.childReclaimAttentionList, r.id)';
    const WRITE = 'this.childReclaimAttentionList = childReclaimAttentionWithKept(mirrorArms, kept, verdicts)';
    expect(expressionHits(/\bchildReclaimAttentionList\b/, [DECLARATION, FRAME, FEED_QUIET, WRITE])).toEqual([
      `watch.ts: ${DECLARATION}`,
      // `emitCoord`: the coord frame's two arms (unmeasurable, measured).
      `watch.ts: ${FRAME}`, `watch.ts: ${FRAME}`,
      // `sweepChildReclaim`: what the feed already says, for a request's `feedQuiet`.
      `watch.ts: ${FEED_QUIET}`,
      // `childReclaimPublishAttention`: its one write.
      `watch.ts: ${WRITE}`,
    ].sort());
  });

  it('(d) a request’s feedQuiet is read only by childReclaimFeedSkips', () => {
    // Every code mention, not only `.feedQuiet`, so a destructured read is seen too.
    const FIELD = 'readonly feedQuiet: ChildReclaimFeedQuiet';
    const SKIPS_DEFER = 'req.feedQuiet.deferWhy === o.why';
    const SKIPS_FAILURE = 'req.feedQuiet.failureToken === o.token';
    const CLOSE_WRITE = 'feedQuiet: CHILD_RECLAIM_FEED_QUIET_NONE';
    const SWEEP_WRITE = 'feedQuiet: childReclaimFeedQuiet(entry, this.childReclaimAttentionList, r.id)';
    expect(expressionHits(/\bfeedQuiet\b/, [FIELD, SKIPS_DEFER, SKIPS_FAILURE, CLOSE_WRITE, SWEEP_WRITE])).toEqual([
      // `ChildReclaimRequest`'s field.
      `coord/childReclaim.ts: ${FIELD}`,
      // `childReclaimFeedSkips`: the two reads.
      `coord/childReclaim.ts: ${SKIPS_DEFER}`,
      `coord/childReclaim.ts: ${SKIPS_FAILURE}`,
      // The two writers: the close path's request, and the sweep's.
      `coord/close.ts: ${CLOSE_WRITE}`,
      `watch.ts: ${SWEEP_WRITE}`,
    ].sort());
  });

  // (c) names the field; this names the PUBLISHED frame's copy of it, which a
  // decision could read through `currentCoord()` instead. Measured: server/src
  // reads it as a property nowhere — the frame literal names it only as a key —
  // so the allowed set is empty. A property read, a bracketed one, and a
  // one-line destructure are each a read.
  it('(e) the published coord frame’s attention list is read by nothing in server/src', () => {
    expect(codeHits(
      /\.childReclaimAttention\b|\[\s*['"`]childReclaimAttention['"`]\s*\]|\{[^{}\n]*\bchildReclaimAttention\b[^{}\n]*\}\s*=(?!=)/,
    )).toEqual([]);
  });
});
