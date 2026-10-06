// Child-reclamation wave 5 (spec §5.9): the sweep's verdicts, its attention list
// and a request's `feedQuiet` are what the run chip and the feed SAY. None of
// them may decide a reclaim — whether a child is asked, licensed past its defer
// ceiling, ordered or paced. As a red suite: every CODE reader of each, in all
// of server/src, is in a named allowlist, so a decision that starts reading one
// is a red here before it is a reclaim nobody licensed.
//
// Code only (`codeOnly`, shared with child-reclaim-chip-source.test.ts): a
// sentence ABOUT a field is not a read of it, and several docstrings name these.
// Each allowlist is the exact code line, so a second read written ON an allowed
// line changes that line and reds as surely as a new one.
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

const REDUCTION =
  'watch.ts: if (this.childReclaimJudged !== null) this.childReclaimJudged = childReclaimKeptVerdicts(this.childReclaimJudged);';

describe('the sweep’s verdicts are read by no decision (spec §5.9)', () => {
  it('(a) the verdict map has its declaration, accessor, two reductions, one assignment, the attention write and the chip route', () => {
    expect(codeHits(/\bchildReclaimJudged\b|\bcurrentChildReclaimVerdicts\(/)).toEqual([
      // routes.ts `composeChildReclaim`: the chip's inputs, display only.
      'coord/routes.ts: verdicts: watcher?.currentChildReclaimVerdicts() ?? null,',
      // The declaration.
      'watch.ts: private childReclaimJudged: ReadonlyMap<string, ChildReclaimSweepVerdict> | null = null;',
      // The accessor, `currentChildReclaimVerdicts`.
      'watch.ts: currentChildReclaimVerdicts(): ReadonlyMap<string, ChildReclaimSweepVerdict> | null {',
      'watch.ts: return this.childReclaimJudged;',
      // The two reductions to the kept verdicts, on a pass that judged nothing
      // (the failed read; the switches): one line each, three mentions each.
      REDUCTION, REDUCTION, REDUCTION,
      REDUCTION, REDUCTION, REDUCTION,
      // The one assignment, after the judging loop.
      'watch.ts: this.childReclaimJudged = judged;',
      // `childReclaimPublishAttention`, the attention list's one write.
      'watch.ts: const verdicts = this.childReclaimJudged ?? new Map<string, ChildReclaimSweepVerdict>();',
    ].sort());
  });

  it('(b) across the whole of sweepChildReclaim, the local `judged` is declared, set per child and assigned — nothing else', () => {
    const body = sweepChildReclaimLines();
    // The slice reaches the decisions this pin protects: the ask order, the
    // ceiling licence and the request's feed state are all inside it.
    expect(body.some((l) => l.includes('childReclaimAskOrder(due)'))).toBe(true);
    expect(body.some((l) => l.includes('licensed: childReclaimDeferExpired('))).toBe(true);
    expect(body.some((l) => l.includes('feedQuiet: childReclaimFeedQuiet('))).toBe(true);
    const mentions = body.flatMap((l) => [...l.matchAll(/\bjudged\b/g)].map(() => l.trim()));
    expect(mentions).toEqual([
      'const judged = new Map<string, ChildReclaimSweepVerdict>();',
      'judged.set(r.id, v);',
      'this.childReclaimJudged = judged;',
    ]);
  });

  it('(c) the attention list is read only by the coord frame and the feedQuiet call site', () => {
    expect(codeHits(/\bchildReclaimAttentionList\b/)).toEqual([
      // The declaration.
      'watch.ts: private childReclaimAttentionList: readonly ChildReclaimAttention[] = [];',
      // `emitCoord`: the coord frame's two arms (unmeasurable, measured).
      'watch.ts: childReclaimAttention: this.childReclaimAttentionList }',
      'watch.ts: childReclaimAttention: this.childReclaimAttentionList };',
      // `sweepChildReclaim`: what the feed already says, for a request's `feedQuiet`.
      'watch.ts: feedQuiet: childReclaimFeedQuiet(entry, this.childReclaimAttentionList, r.id),',
      // `childReclaimPublishAttention`: its one write.
      'watch.ts: this.childReclaimAttentionList = childReclaimAttentionWithKept(mirrorArms, kept, verdicts);',
    ].sort());
  });

  it('(d) a request’s feedQuiet is read only by childReclaimFeedSkips', () => {
    // Every code mention, not only `.feedQuiet`, so a destructured read is seen too.
    expect(codeHits(/\bfeedQuiet\b/)).toEqual([
      // `ChildReclaimRequest`'s field.
      'coord/childReclaim.ts: readonly feedQuiet: ChildReclaimFeedQuiet;',
      // `childReclaimFeedSkips`: the two reads.
      "coord/childReclaim.ts: if (o.kind === 'deferred') return req.feedQuiet.deferWhy === o.why;",
      "coord/childReclaim.ts: if (o.kind === 'failed') return o.token !== null && req.feedQuiet.failureToken === o.token;",
      // The two writers: the close path's request, and the sweep's.
      'coord/close.ts: feedQuiet: CHILD_RECLAIM_FEED_QUIET_NONE } : null,',
      'watch.ts: feedQuiet: childReclaimFeedQuiet(entry, this.childReclaimAttentionList, r.id),',
    ].sort());
  });
});
