// `server/src/docs/policy.ts`, the native Docs reader's L1 file (design 2026-10-01, section 1's policy row): pure
// decisions that W3's routes and hooks apply and never re-decide. Each task of wave 2 appends its own describes.
//
// Task 2: section 2 row 53's L1 half (`DOCS_FAILURE_HTTP` exhaustive, the `refreshDue` table), M3.9
// (`fetchBranchFor`), M3.10 (`refreshDue` exists only on an ok tree, is false for a local ref, and keeps section
// 2 (g)'s stale and floor rules), the `Retry-After` verdict (spec refinement (p)), the two qualified prefixes
// derived from L0 (refinement (q)), and the file's L1 purity scan (its ring by imports; Task 8's ring guard in
// `single-definition.test.ts` is the cross-file half of M7.10).
//
// The status table below is HAND-TRANSCRIBED from the spec's tables (section 2 (i) and section 3.7), never derived
// from `DOCS_FAILURE_HTTP`: a table read back from the code would agree with any mistake in it.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DOCS_FAILURE_HTTP, DOCS_CAPS_UNKNOWN_RETRY_AFTER_S, DOCS_REF_PREFIXES, docsRetryAfterSeconds, docsRefTarget,
  fetchBranchFor, refreshDue,
} from '../src/docs/policy.js';
import { DOCS_FAILURES } from '../../shared/docs.js';
import type { DocsFailure, DocsFailureBody, DocsFetchFailure, DocsTreeOk } from '../../shared/docs.js';

/** Section 2 (i)'s tables in their order, then section 3.7's four added words. The Argument group's status is its
 *  heading ("Argument (400; ...)"); every other row names its own. 58 rows. */
const SPEC_STATUS: readonly (readonly [word: string, status: number])[] = [
  // Argument (400).
  ['bad-project', 400], ['bad-ref', 400], ['bad-commit', 400], ['bad-section', 400], ['bad-path', 400],
  ['bad-fingerprint', 400],
  // Repository.
  ['unknown-project', 404], ['not-a-git-repo', 422], ['linked-worktree', 422], ['shared-repo', 422],
  ['partial-clone', 422], ['repo-unreadable', 502],
  // Refs.
  ['no-default-branch', 404], ['unresolved-ref', 404], ['ref-not-commit', 422],
  // Objects and paths.
  ['unknown-commit', 404], ['not-a-commit', 422], ['object-missing', 502], ['absent-path', 404], ['not-a-file', 422],
  ['symlink-in-path', 422], ['too-large', 413], ['too-many-entries', 413], ['unreadable-path', 502],
  // Draft pins (show).
  ['worktree-gone', 409], ['ambiguous-worktree', 409], ['untrusted-worktree', 422], ['worktree-moved', 409],
  ['draft-changed', 409],
  // Fetch.
  ['remote-absent', 422], ['remote-branch-absent', 404], ['fetch-auth-failed', 502], ['fetch-rejected-objects', 502],
  ['fetch-transport', 502], ['ref-locked', 409], ['fetch-too-soon', 429], ['fetch-timeout', 504], ['fetch-failed', 502],
  // ccd generic.
  ['git-failed', 502], ['git-timeout', 504], ['helper-unavailable', 503], ['helper-failed', 502],
  // Server-only.
  ['unsupported', 501], ['caps-unknown', 503], ['not-granted', 501], ['link-failed', 503], ['link-timeout', 504],
  ['docs-busy', 503], ['ccd-timeout', 504], ['ccd-killed', 502], ['ccd-fault', 502], ['answer-overflow', 502],
  ['malformed-answer', 502], ['unknown-failure', 502],
  // Section 3.7 (the HTTP layer).
  ['foreign-request', 403], ['bad-query', 400], ['raster-mismatch', 422], ['response-type-refused', 500],
];

describe('DOCS_FAILURE_HTTP (row 53, L1 half): every word has the status the spec gives it', () => {
  const words = SPEC_STATUS.map(([w]) => w);

  it('the transcribed table is whole: 58 distinct words, exactly the vocabulary, in both directions', () => {
    expect(SPEC_STATUS).toHaveLength(58);
    expect(new Set(words).size, 'a word transcribed twice').toBe(58);
    expect([...words].sort()).toEqual(Object.keys(DOCS_FAILURES).sort());
  });

  it('the policy table holds exactly the vocabulary: no word missing, no extra key', () => {
    expect(Object.keys(DOCS_FAILURE_HTTP).sort()).toEqual(Object.keys(DOCS_FAILURES).sort());
  });

  it.each(SPEC_STATUS)("'%s' answers %i", (word, status) => {
    expect(DOCS_FAILURE_HTTP[word as DocsFailure]).toBe(status);
  });

  it('every status is a failure status: success is 200 only, so no 2xx and no 3xx (section 3.7)', () => {
    const FAILURE_STATUSES = [400, 403, 404, 409, 413, 422, 429, 500, 501, 502, 503, 504];
    for (const [word, status] of Object.entries(DOCS_FAILURE_HTTP)) {
      expect(FAILURE_STATUSES, `${word} answers ${status}`).toContain(status);
    }
  });

  it('ref-locked is a 409 of its own, never folded into the 502 of a failed fetch (section 3.7)', () => {
    expect(DOCS_FAILURE_HTTP['ref-locked']).toBe(409);
    expect(DOCS_FAILURE_HTTP['fetch-failed']).toBe(502);
  });
});

describe('docsRetryAfterSeconds: the Retry-After header, or none (spec refinement (p))', () => {
  const body = (failure: DocsFailure, extra: Partial<DocsFailureBody> = {}): DocsFailureBody =>
    ({ ok: false, failure, ...extra });

  it('caps-unknown answers 5 s (section 3.7: 503, Retry-After: 5)', () => {
    expect(DOCS_CAPS_UNKNOWN_RETRY_AFTER_S).toBe(5);
    expect(docsRetryAfterSeconds(body('caps-unknown'))).toBe(5);
  });

  it.each([[2000, 2], [5000, 5], [2001, 3]])('docs-busy with retryAfterMs %i answers %i s, rounded up', (ms, s) => {
    expect(docsRetryAfterSeconds(body('docs-busy', { lane: 'read', retryAfterMs: ms }))).toBe(s);
  });

  it('docs-busy without retryAfterMs answers null: no header, never a guessed wait', () => {
    expect(docsRetryAfterSeconds(body('docs-busy', { lane: 'fetch' }))).toBeNull();
  });

  it("fetch-too-soon's wait rides its body only (section 2 (i) names no header), and ref-locked has none", () => {
    expect(docsRetryAfterSeconds(body('fetch-too-soon', { retryAfterMs: 4000 }))).toBeNull();
    expect(docsRetryAfterSeconds(body('ref-locked', { lockAgeMs: 1000 }))).toBeNull();
  });

  it('every other word answers null even when its body carries a retryAfterMs', () => {
    for (const word of Object.keys(DOCS_FAILURES) as DocsFailure[]) {
      if (word === 'caps-unknown' || word === 'docs-busy') continue;
      expect(docsRetryAfterSeconds(body(word, { retryAfterMs: 2000 })), word).toBeNull();
    }
  });
});

describe('the qualified prefixes are derived from L0, and docsRefTarget reads a ref spec (refinement (q))', () => {
  it('DOCS_REF_PREFIXES is the local prefix, then the origin prefix', () => {
    expect(DOCS_REF_PREFIXES).toEqual(['refs/heads/', 'refs/remotes/origin/']);
  });

  it.each([
    [{ kind: 'bare', name: 'main' }, { side: 'bare', branch: 'main' }],
    [{ kind: 'bare', name: 'ws/a' }, { side: 'bare', branch: 'ws/a' }],
    [{ kind: 'qualified', ref: 'refs/heads/main' }, { side: 'local', branch: 'main' }],
    [{ kind: 'qualified', ref: 'refs/heads/ws/a' }, { side: 'local', branch: 'ws/a' }],
    [{ kind: 'qualified', ref: 'refs/remotes/origin/b' }, { side: 'origin', branch: 'b' }],
    [{ kind: 'qualified', ref: 'refs/remotes/origin/a/b' }, { side: 'origin', branch: 'a/b' }],
  ] as const)('%j targets %j', (spec, target) => {
    expect(docsRefTarget(spec)).toEqual(target);
  });

  it('refuses a qualified spec in neither grammar rather than guessing a side', () => {
    // `parseDocsRef` never builds one; a hand-built spec is a caller's bug, so it throws instead of answering.
    expect(() => docsRefTarget({ kind: 'qualified', ref: 'refs/tags/v1' })).toThrow(/neither qualified prefix/);
  });
});

describe('fetchBranchFor (M3.9): what a refresh fetches for the requested ref (section 3.4, section 2 (g) Flow)', () => {
  it('null (the default view) fetches with no --branch', () => {
    expect(fetchBranchFor(null)).toEqual({ kind: 'fetch', branch: null });
  });

  it.each([
    [{ kind: 'bare', name: 'b' }, 'b'],
    [{ kind: 'bare', name: 'ws/a' }, 'ws/a'],
    [{ kind: 'qualified', ref: 'refs/remotes/origin/b' }, 'b'],
    [{ kind: 'qualified', ref: 'refs/remotes/origin/a/b' }, 'a/b'],
  ] as const)('%j fetches --branch %s', (spec, branch) => {
    expect(fetchBranchFor(spec)).toEqual({ kind: 'fetch', branch });
  });

  it('a local ref is skipped, local-ref: a fetch cannot move it', () => {
    expect(fetchBranchFor({ kind: 'qualified', ref: 'refs/heads/b' })).toEqual({ kind: 'skipped', why: 'local-ref' });
    expect(fetchBranchFor({ kind: 'qualified', ref: 'refs/heads/ws/a' })).toEqual({ kind: 'skipped', why: 'local-ref' });
  });
});

describe('refreshDue (M3.10, row 53 L1 half): section 2 (g) "Stale on open", exactly', () => {
  type Stamp = NonNullable<DocsTreeOk['freshness']['stamp']>;
  const SHA = 'a'.repeat(40);
  /** A minimal ok tree, valid by type, placeholders only: the default view of `demo`, origin present, never fetched. */
  const BASE: DocsTreeOk = {
    v: 1, verb: 'docs-tree', ok: true, elapsedMs: 1, project: 'demo',
    repo: { key: 'b'.repeat(32), objectFormat: 'sha1', shallow: false },
    github: { state: 'none' },
    ref: {
      requested: null, served: 'refs/remotes/origin/main', name: 'main', side: 'origin', commit: SHA,
      via: 'default:origin-head', tried: [], relation: 'equal', counterpart: null,
    },
    mainCheckout: { path: '/srv/demo', branch: 'main', head: SHA },
    sections: [],
    entries: [],
    unlisted: { count: 0, byReason: {} },
    drafts: { state: 'none', branch: 'main', skipped: [] },
    freshness: { remote: 'origin', trackedRef: 'refs/remotes/origin/main', stamp: null, fetchHead: null },
  };
  const treeWith = (o: { requested?: string | null; remote?: 'origin' | null; stamp?: Stamp | null }): DocsTreeOk => ({
    ...BASE,
    ref: { ...BASE.ref, requested: o.requested !== undefined ? o.requested : BASE.ref.requested },
    freshness: {
      ...BASE.freshness,
      remote: o.remote !== undefined ? o.remote : BASE.freshness.remote,
      stamp: o.stamp !== undefined ? o.stamp : BASE.freshness.stamp,
    },
  });
  const stampAt = (lastOutcome: Stamp['lastOutcome'], attemptAgeMs: number): Stamp => ({
    okAgeMs: lastOutcome === 'ok' ? attemptAgeMs : null, attemptAgeMs, lastOutcome,
    okCommit: lastOutcome === 'ok' ? SHA : null,
  });

  /** Every outcome a stamp can record, and the wait the spec gives it. Typed by the vocabulary, so a new
   *  `DocsFetchFailure` does not compile here until it is placed. */
  const WAIT: Record<'ok' | DocsFetchFailure, 'stale' | 'floor'> = {
    'ok': 'stale',
    'remote-branch-absent': 'stale',
    'fetch-timeout': 'floor',
    'fetch-rejected-objects': 'floor',
    'fetch-auth-failed': 'floor',
    'ref-locked': 'floor',
    'fetch-transport': 'floor',
    'fetch-failed': 'floor',
  };
  // The spec's numbers, written out: 600 000 (DOCS_STALE_MS) and 60 000 (DOCS_RETRY_FLOOR_MS).
  const BOUNDARY = { stale: 600000, floor: 60000 } as const;

  it.each([
    ['a local ref with no stamp', false, treeWith({ requested: 'refs/heads/main', stamp: null })],
    ['a local ref with a long-stale stamp', false,
      treeWith({ requested: 'refs/heads/ws/a', stamp: stampAt('ok', 6000000) })],
    ['no origin remote, no stamp', false, treeWith({ remote: null, stamp: null })],
    ['no origin remote, a long-stale stamp', false,
      treeWith({ remote: null, stamp: stampAt('fetch-transport', 6000000) })],
    ['the default view, never fetched', true, treeWith({ requested: null, stamp: null })],
    ['a bare ref, never fetched', true, treeWith({ requested: 'main', stamp: null })],
    ['a bare ref that merely contains the local prefix, never fetched', true,
      treeWith({ requested: 'ws/refs/heads/a', stamp: null })],
    ['an origin ref, never fetched', true, treeWith({ requested: 'refs/remotes/origin/main', stamp: null })],
  ] as const)('%s: due %s', (_what, due, tree) => {
    expect(refreshDue(tree)).toBe(due);
  });

  const BOUNDARY_ROWS = (Object.keys(WAIT) as ('ok' | DocsFetchFailure)[]).flatMap((outcome) => {
    const edge = BOUNDARY[WAIT[outcome]];
    return [[outcome, edge - 1, false], [outcome, edge, true]] as const;
  });

  it.each(BOUNDARY_ROWS)("a last outcome of '%s' attempted %i ms ago is due: %s", (outcome, age, due) => {
    expect(refreshDue(treeWith({ stamp: stampAt(outcome, age) }))).toBe(due);
  });

  it.each([
    ['a bare ref', 'ws/a'],
    ['an origin ref', 'refs/remotes/origin/ws/a'],
  ] as const)('%s keeps the same stale and floor boundaries as the default view', (_what, requested) => {
    expect(refreshDue(treeWith({ requested, stamp: stampAt('ok', 599999) }))).toBe(false);
    expect(refreshDue(treeWith({ requested, stamp: stampAt('ok', 600000) }))).toBe(true);
    expect(refreshDue(treeWith({ requested, stamp: stampAt('fetch-transport', 59999) }))).toBe(false);
    expect(refreshDue(treeWith({ requested, stamp: stampAt('fetch-transport', 60000) }))).toBe(true);
  });

  it('exists only on an ok tree: a failure body is a compile error (checked by typecheck-tests)', () => {
    const failure: DocsFailureBody = { ok: false, failure: 'unresolved-ref' };
    // Never called: the proof is the compile error below, which `typecheck-tests` reds on if it disappears (TS2578).
    const wouldCall = (): boolean =>
      // @ts-expect-error -- refreshDue takes DocsTreeOk only, so an unresolved ref can never be due.
      refreshDue(failure);
    expect(typeof wouldCall).toBe('function');
  });
});

describe('policy.ts is L1: pure, and imports shared/docs.ts alone (M7.10, this file\'s half)', () => {
  const SRC = readFileSync(
    path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'docs', 'policy.ts'), 'utf8');
  /** Comments blanked, positions preserved (`coord-caps-policy.test.ts`'s helper): the file's header names what it
   *  refuses, and prose is not code. */
  const code = (): string => SRC
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/\/\/[^\n]*/g, (m) => m.replace(/[^\n]/g, ' '));

  it('the scan is over real code, not an empty string', () => {
    expect(code()).toContain('export const DOCS_FAILURE_HTTP');
    expect(code().replace(/\s/g, '').length).toBeGreaterThan(400);
  });

  it('has no clock and no timer', () => {
    expect(code()).not.toMatch(/\bDate\s*\.\s*now\s*\(|\bnew\s+Date\b|\bperformance\s*\.\s*now/);
    expect(code()).not.toMatch(/\bset(?:Timeout|Interval|Immediate)\b/);
  });

  it('has no node builtin, no require, no dynamic import and no Buffer', () => {
    expect(code()).not.toMatch(/(['"])node:/);
    expect(code()).not.toMatch(/\brequire\s*\(|\bimport\s*\(/);
    expect(code()).not.toMatch(/\bBuffer\b/);
  });

  it('has no fastify, no reply and no console: an L1 verdict neither answers HTTP nor logs', () => {
    expect(code()).not.toMatch(/fastify/i);
    expect(code()).not.toMatch(/\breply\b/);
    expect(code()).not.toMatch(/\bconsole\b/);
  });

  it('every import specifier is ../../../shared/docs.js, and there is at least one', () => {
    const specifiers = [...code().matchAll(/\bfrom\s*(['"])([^'"]+)\1|\bimport\s*(['"])([^'"]+)\3/g)]
      .map((m) => m[2] ?? m[4]);
    expect(specifiers.length, 'no import found: the scan is over nothing').toBeGreaterThan(0);
    for (const s of specifiers) expect(s).toBe('../../../shared/docs.js');
  });
});
