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

// ===== Task 3: the API query, :project and refresh-body parsers, and request provenance =====
// M3.4's L1 half (section 3.4 "Parameter rules", refinement (n)) and section 3.8's three provenance clauses
// (refinement (o)). W3's `docs-routes.test.ts` carries M3.4's other half: the same refusals reach no exec. Every
// expected body below is written out by hand from the spec; none is read back from `policy.ts`.
//
// This task's imports sit here, beside its describes, rather than in the block at the top: everything above keeps
// its line number, and Task 2's W2-T2-M14 row cites `docs-policy.test.ts(242,7)`. ES module imports are hoisted, so
// placement changes nothing at run time.
import type { IncomingHttpHeaders } from 'node:http';
import {
  docsProvenance, parseDocsApiQuery, parseDocsProjectParam, parseDocsRefreshBody,
  type DocsApiRoute, type DocsHeaderBag,
} from '../src/docs/policy.js';
import { DOCS_REQUEST_HEADER, DOCS_REQUEST_HEADER_VALUE, docsApi, type DocPin } from '../../shared/docs.js';

/** A query decoded as Fastify's default parser decodes it (fast-querystring 1.1.2, measured in W1's ledger, Task 5):
 *  form-style, so a bare `+` is a space and `%2B` a plus, and a repeated key folds to an array of its values. */
function form(search: string): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {};
  for (const [key, value] of new URLSearchParams(search)) {
    const had = Object.hasOwn(out, key) ? out[key] : undefined;
    out[key] = had === undefined ? value : Array.isArray(had) ? [...had, value] : [had, value];
  }
  return out;
}

const T3_COMMIT = 'a'.repeat(40);
const T3_HEAD = 'b'.repeat(40);
const T3_FP = 'c'.repeat(64);
/** A complete committed pin and a complete draft pin, in docsApi's key order. */
const COMMITTED_Q = `commit=${T3_COMMIT}&servedRef=refs/remotes/origin/main&section=specs&path=a.md`;
const DRAFT_Q = `branch=ws/a&head=${T3_HEAD}&section=plans&path=dir/b.md&fp=${T3_FP}`;
const COMMITTED_PIN: DocPin =
  { kind: 'committed', commit: T3_COMMIT, servedRef: 'refs/remotes/origin/main', section: 'specs', path: 'a.md' };
const DRAFT_PIN: DocPin =
  { kind: 'draft', branch: 'ws/a', head: T3_HEAD, section: 'plans', path: 'dir/b.md', fp: T3_FP };

const badQuery = (why: 'unknown' | 'repeated' | 'pin-shape' | 'body', key?: string): DocsFailureBody =>
  key === undefined ? { ok: false, failure: 'bad-query', why } : { ok: false, failure: 'bad-query', key, why };
const refusal = (failure: DocsFailure): DocsFailureBody => ({ ok: false, failure });

describe('parseDocsApiQuery (M3.4, L1 half): a docs API query, parsed or refused before any exec', () => {
  type Row = readonly [what: string, route: DocsApiRoute, search: string, want: unknown];
  const ROWS: readonly Row[] = [
    // projects: no query keys at all.
    ['projects, no keys', 'projects', '', { ok: true, req: { route: 'projects' } }],
    ['projects, an unknown key', 'projects', 'x=1', badQuery('unknown', 'x')],
    ['projects, ref (only the tree takes one)', 'projects', 'ref=main', badQuery('unknown', 'ref')],
    // tree: ref, bare or qualified.
    ['tree, no ref: the default view', 'tree', '', { ok: true, req: { route: 'tree', ref: null } }],
    ['tree, a bare ref', 'tree', 'ref=main', { ok: true, req: { route: 'tree', ref: { kind: 'bare', name: 'main' } } }],
    ['tree, a local qualified ref', 'tree', 'ref=refs/heads/main',
      { ok: true, req: { route: 'tree', ref: { kind: 'qualified', ref: 'refs/heads/main' } } }],
    ['tree, an origin qualified ref', 'tree', 'ref=refs/remotes/origin/ws/a',
      { ok: true, req: { route: 'tree', ref: { kind: 'qualified', ref: 'refs/remotes/origin/ws/a' } } }],
    ['tree, a repeated ref', 'tree', 'ref=a&ref=b', badQuery('repeated', 'ref')],
    ['tree, an empty ref', 'tree', 'ref=', refusal('bad-ref')],
    ['tree, a ref starting with a dash', 'tree', 'ref=-x', refusal('bad-ref')],
    ['tree, a ref with ..', 'tree', 'ref=a..b', refusal('bad-ref')],
    ['tree, a node key (section 3.12 reserves it)', 'tree', 'node=a', badQuery('unknown', 'node')],
    ['tree, a node key beside a good ref', 'tree', 'ref=main&node=a', badQuery('unknown', 'node')],
    // file: a whole pin of one kind.
    ['file, a complete committed pin', 'file', COMMITTED_Q, { ok: true, req: { route: 'file', pin: COMMITTED_PIN } }],
    ['file, a complete draft pin', 'file', DRAFT_Q, { ok: true, req: { route: 'file', pin: DRAFT_PIN } }],
    ['file, a committed pin in another key order', 'file',
      `path=a.md&section=specs&servedRef=refs/remotes/origin/main&commit=${T3_COMMIT}`,
      { ok: true, req: { route: 'file', pin: COMMITTED_PIN } }],
    ['file, a committed pin served from a local ref', 'file',
      `commit=${T3_COMMIT}&servedRef=refs/heads/main&section=specs&path=a.md`,
      { ok: true, req: { route: 'file', pin: { ...COMMITTED_PIN, servedRef: 'refs/heads/main' } } }],
    ['file, a complete committed pin plus branch: mixed', 'file', `${COMMITTED_Q}&branch=main`, badQuery('pin-shape')],
    ['file, a complete draft pin plus commit: mixed', 'file', `${DRAFT_Q}&commit=${T3_COMMIT}`, badQuery('pin-shape')],
    ['file, commit and branch only: mixed and incomplete', 'file',
      `commit=${T3_COMMIT}&branch=main&section=specs&path=a.md`, badQuery('pin-shape')],
    ['file, a committed pin missing path', 'file',
      `commit=${T3_COMMIT}&servedRef=refs/remotes/origin/main&section=specs`, badQuery('pin-shape')],
    ['file, a committed pin missing section', 'file',
      `commit=${T3_COMMIT}&servedRef=refs/remotes/origin/main&path=a.md`, badQuery('pin-shape')],
    ['file, a committed pin missing servedRef', 'file', `commit=${T3_COMMIT}&section=specs&path=a.md`,
      badQuery('pin-shape')],
    ['file, a draft pin missing fp', 'file', `branch=ws/a&head=${T3_HEAD}&section=plans&path=dir/b.md`,
      badQuery('pin-shape')],
    ['file, no pin keys at all', 'file', 'section=specs&path=a.md', badQuery('pin-shape')],
    ['file, no keys at all', 'file', '', badQuery('pin-shape')],
    // Keys the server derives or reserves are unknown, never ignored.
    ['file, a client size', 'file', `${COMMITTED_Q}&size=1`, badQuery('unknown', 'size')],
    ['file, a client maxBytes', 'file', `${COMMITTED_Q}&maxBytes=1`, badQuery('unknown', 'maxBytes')],
    ['file, a node key', 'file', `${COMMITTED_Q}&node=a`, badQuery('unknown', 'node')],
    ['file, a ref key (the pin carries servedRef)', 'file', `${COMMITTED_Q}&ref=main`, badQuery('unknown', 'ref')],
    // Value faults, one at a time.
    ['file, a bare servedRef (qualified only: it is ref.served)', 'file',
      `commit=${T3_COMMIT}&servedRef=main&section=specs&path=a.md`, refusal('bad-ref')],
    ['file, a qualified draft branch (bare only)', 'file',
      `branch=refs/heads/main&head=${T3_HEAD}&section=plans&path=dir/b.md&fp=${T3_FP}`, refusal('bad-ref')],
    ['file, a short commit', 'file', 'commit=abc&servedRef=refs/remotes/origin/main&section=specs&path=a.md',
      refusal('bad-commit')],
    ['file, an upper-case commit', 'file',
      `commit=${'A'.repeat(40)}&servedRef=refs/remotes/origin/main&section=specs&path=a.md`, refusal('bad-commit')],
    ['file, a short head', 'file', `branch=ws/a&head=abc&section=plans&path=dir/b.md&fp=${T3_FP}`,
      refusal('bad-commit')],
    ['file, an unknown section', 'file',
      `commit=${T3_COMMIT}&servedRef=refs/remotes/origin/main&section=notes&path=a.md`, refusal('bad-section')],
    ['file, a short fp', 'file', `branch=ws/a&head=${T3_HEAD}&section=plans&path=dir/b.md&fp=abc`,
      refusal('bad-fingerprint')],
    ['file, a 40-hex fp (a fingerprint is 64)', 'file',
      `branch=ws/a&head=${T3_HEAD}&section=plans&path=dir/b.md&fp=${'c'.repeat(40)}`, refusal('bad-fingerprint')],
    // Precedence: unknown > repeated > pin-shape > values, values in ccd's argv order.
    ['precedence: an unknown key beats a repeated one', 'tree', 'zz=1&ref=a&ref=b', badQuery('unknown', 'zz')],
    ['precedence: the first unknown key in code-unit order, not arrival order', 'tree', 'zz=1&aa=1',
      badQuery('unknown', 'aa')],
    ['precedence: a repeated key beats pin-shape', 'file', 'commit=a&commit=b&branch=x', badQuery('repeated', 'commit')],
    ["precedence: the first repeated key in the route's key order, not arrival order", 'file',
      `path=a.md&path=b.md&commit=${T3_COMMIT}&commit=${T3_COMMIT}`, badQuery('repeated', 'commit')],
    ['precedence: pin-shape beats a bad value', 'file',
      `commit=abc&servedRef=refs/remotes/origin/main&section=specs&path=a.md&head=${T3_HEAD}`, badQuery('pin-shape')],
    ['precedence: committed, commit before path', 'file',
      'commit=abc&servedRef=refs/remotes/origin/main&section=specs&path=../a.md', refusal('bad-commit')],
    ['precedence: committed, servedRef before section', 'file',
      `commit=${T3_COMMIT}&servedRef=main&section=notes&path=a.md`, refusal('bad-ref')],
    ['precedence: committed, section before path', 'file',
      `commit=${T3_COMMIT}&servedRef=refs/remotes/origin/main&section=notes&path=../a.md`, refusal('bad-section')],
    ['precedence: draft, branch before head', 'file',
      `branch=refs/heads/main&head=abc&section=plans&path=dir/b.md&fp=${T3_FP}`, refusal('bad-ref')],
    ['precedence: draft, head before fp', 'file', `branch=ws/a&head=abc&section=plans&path=dir/b.md&fp=abc`,
      refusal('bad-commit')],
    ['precedence: draft, path before fp', 'file', `branch=ws/a&head=${T3_HEAD}&section=plans&path=a//b.md&fp=abc`,
      refusal('bad-path')],
  ];

  it.each(ROWS)('%s', (_what, route, search, want) => {
    expect(parseDocsApiQuery(route, form(search))).toStrictEqual(want);
  });

  it.each([
    ['a parent step', '../a.md'],
    ['an empty component', 'a//b.md'],
    ['a trailing slash', 'a/'],
    ['an empty path', ''],
    ['a format character (U+202E)', '‮.md'],
  ])('file, %s in path is bad-path', (_what, bad) => {
    const search = new URLSearchParams(
      { commit: T3_COMMIT, servedRef: 'refs/remotes/origin/main', section: 'specs', path: bad }).toString();
    expect(parseDocsApiQuery('file', form(search))).toStrictEqual(refusal('bad-path'));
  });

  const ROUND_TRIP_PATHS = ['a b.md', 'a+b.md', 'c%d.md', 'dir/e.md', 'café/ü.md'];

  it.each(ROUND_TRIP_PATHS)('docsApi.file round-trips the path %j, committed and draft', (p) => {
    for (const pin of [{ ...COMMITTED_PIN, path: p }, { ...DRAFT_PIN, path: p }] satisfies DocPin[]) {
      const search = new URL(docsApi.file('demo', pin), 'http://example.invalid').search;
      expect(parseDocsApiQuery('file', form(search))).toStrictEqual({ ok: true, req: { route: 'file', pin } });
    }
  });

  it('docsApi.tree round-trips a bare and a qualified ref', () => {
    for (const ref of [{ kind: 'bare', name: 'ws/a' }, { kind: 'qualified', ref: 'refs/remotes/origin/main' }] as const) {
      const search = new URL(docsApi.tree('demo', ref), 'http://example.invalid').search;
      expect(parseDocsApiQuery('tree', form(search))).toStrictEqual({ ok: true, req: { route: 'tree', ref } });
    }
  });

  it('a hand-typed bare + arrives as a space (form decoding), so it names a different path: documented, not refused', () => {
    expect(parseDocsApiQuery('file', form(`commit=${T3_COMMIT}&servedRef=refs/remotes/origin/main&section=specs&path=a+b.md`)))
      .toStrictEqual({ ok: true, req: { route: 'file', pin: { ...COMMITTED_PIN, path: 'a b.md' } } });
  });

  it('reads own keys only: a null-prototype record parses, an inherited key is no key', () => {
    const bare = Object.assign(Object.create(null) as Record<string, unknown>, { ref: 'main' });
    expect(parseDocsApiQuery('tree', bare)).toStrictEqual(
      { ok: true, req: { route: 'tree', ref: { kind: 'bare', name: 'main' } } });
    const inherited = Object.create({ ref: 'main' }) as Record<string, unknown>;
    expect(parseDocsApiQuery('tree', inherited)).toStrictEqual({ ok: true, req: { route: 'tree', ref: null } });
  });
});

describe('parseDocsProjectParam: a :project failing the grammar is bad-project (section 3.4)', () => {
  it.each(['demo', 'a.b_c-1', '_x', 'x'.repeat(100)])('%j is a project', (p) => {
    expect(parseDocsProjectParam(p)).toStrictEqual({ ok: true, project: p });
  });

  it.each([
    ['a leading dash', '-x'], ['dot-dot', '..'], ['dot', '.'], ['a leading dot', '.a'], ['empty', ''],
    ['a slash', 'a/b'], ['101 characters', 'x'.repeat(101)], ['an array', ['demo']], ['undefined', undefined],
    ['a number', 7],
  ])('%s is bad-project', (_what, p) => {
    expect(parseDocsProjectParam(p)).toStrictEqual(refusal('bad-project'));
  });
});

describe('parseDocsRefreshBody: exactly {ref, reason} (section 3.4, refinement (n))', () => {
  it.each([
    [{ ref: null, reason: 'auto' }, { ref: null, reason: 'auto' }],
    [{ ref: 'main', reason: 'manual' }, { ref: { kind: 'bare', name: 'main' }, reason: 'manual' }],
    [{ reason: 'auto', ref: 'refs/heads/ws/a' }, { ref: { kind: 'qualified', ref: 'refs/heads/ws/a' }, reason: 'auto' }],
  ])('%j parses', (body, req) => {
    expect(parseDocsRefreshBody(body)).toStrictEqual({ ok: true, req });
  });

  it.each([
    ['a string (Fastify parses text/plain too)', 'x'],
    ['an empty array', []],
    ['an array holding a good body', [{ ref: null, reason: 'auto' }]],
    ['null', null],
    ['a number', 7],
    ['a boolean', true],
    ['undefined (no body)', undefined],
  ])('%s is bad-query body', (_what, body) => {
    expect(parseDocsRefreshBody(body)).toStrictEqual(badQuery('body'));
  });

  it.each([
    ['an empty object: ref is checked first', {}, badQuery('body', 'ref')],
    ['ref missing', { reason: 'auto' }, badQuery('body', 'ref')],
    ['reason missing', { ref: null }, badQuery('body', 'reason')],
    ['an extra key', { ref: null, reason: 'auto', x: 1 }, badQuery('unknown', 'x')],
    ['reason later', { ref: null, reason: 'later' }, badQuery('body', 'reason')],
    ['reason in upper case', { ref: null, reason: 'AUTO' }, badQuery('body', 'reason')],
    ['ref a number', { ref: 7, reason: 'auto' }, badQuery('body', 'ref')],
    ['ref an array', { ref: ['main'], reason: 'auto' }, badQuery('body', 'ref')],
    ['ref outside both grammars', { ref: 'a..b', reason: 'auto' }, refusal('bad-ref')],
    ['ref empty', { ref: '', reason: 'auto' }, refusal('bad-ref')],
    ['precedence: a bad reason beats a bad ref string', { ref: 'a..b', reason: 'later' }, badQuery('body', 'reason')],
    ['precedence: an extra key beats a bad shape', { ref: 7, x: 1 }, badQuery('unknown', 'x')],
    ['precedence: the first extra key in code-unit order', { zz: 1, aa: 1, ref: null, reason: 'auto' },
      badQuery('unknown', 'aa')],
  ])('%s', (_what, body, want) => {
    expect(parseDocsRefreshBody(body)).toStrictEqual(want);
  });
});

describe('docsProvenance: section 3.8\'s three clauses, in order (refinement (o))', () => {
  const MARKER = { [DOCS_REQUEST_HEADER]: DOCS_REQUEST_HEADER_VALUE };

  it.each([
    ['navigate with a same-origin site and the marker', { 'sec-fetch-mode': 'navigate', 'sec-fetch-site': 'same-origin', ...MARKER },
      { ok: false, why: 'navigation' }],
    ['navigate with no site and the marker', { 'sec-fetch-mode': 'navigate', ...MARKER }, { ok: false, why: 'navigation' }],
    ['cors from a cross-site page, with the marker', { 'sec-fetch-mode': 'cors', 'sec-fetch-site': 'cross-site', ...MARKER },
      { ok: false, why: 'site', site: 'cross-site' }],
    ['a same-site sibling, with the marker', { 'sec-fetch-site': 'same-site', ...MARKER },
      { ok: false, why: 'site', site: 'same-site' }],
    ['a user-initiated load (none), with the marker', { 'sec-fetch-site': 'none', ...MARKER },
      { ok: false, why: 'site', site: 'none' }],
    ['an empty site is present and not same-origin', { 'sec-fetch-site': '', ...MARKER }, { ok: false, why: 'site', site: '' }],
    ['a doubled same-origin site reads as its join, never as same-origin',
      { 'sec-fetch-site': ['same-origin', 'same-origin'], ...MARKER },
      { ok: false, why: 'site', site: 'same-origin, same-origin' }],
    ['the PWA: cors, same-origin, the marker', { 'sec-fetch-mode': 'cors', 'sec-fetch-site': 'same-origin', ...MARKER },
      { ok: true }],
    ['a browser that sends no Sec-Fetch-*, with the marker', { ...MARKER }, { ok: true }],
    ['no marker', { 'sec-fetch-site': 'same-origin' }, { ok: false, why: 'marker' }],
    ['no headers at all', {}, { ok: false, why: 'marker' }],
    ['the marker 0', { [DOCS_REQUEST_HEADER]: '0' }, { ok: false, why: 'marker' }],
    ['an empty marker', { [DOCS_REQUEST_HEADER]: '' }, { ok: false, why: 'marker' }],
    ['a doubled marker reads as its join', { [DOCS_REQUEST_HEADER]: ['1', '1'] }, { ok: false, why: 'marker' }],
    ['navigation beats site and marker', { 'sec-fetch-mode': 'navigate', 'sec-fetch-site': 'cross-site' },
      { ok: false, why: 'navigation' }],
    ['site beats marker', { 'sec-fetch-site': 'cross-site' }, { ok: false, why: 'site', site: 'cross-site' }],
    ['a long site is carried cut to 64 characters', { 'sec-fetch-site': 'x'.repeat(200), ...MARKER },
      { ok: false, why: 'site', site: 'x'.repeat(64) }],
  ] as const)('%s', (_what, headers, want) => {
    // toStrictEqual: `site` must be ABSENT on navigation and marker refusals, not present and undefined.
    expect(docsProvenance(headers)).toStrictEqual(want);
  });

  it("takes node's IncomingHttpHeaders as it is (checked by typecheck-tests)", () => {
    const incoming: IncomingHttpHeaders = { 'sec-fetch-site': 'same-origin', [DOCS_REQUEST_HEADER]: DOCS_REQUEST_HEADER_VALUE };
    const bag: DocsHeaderBag = incoming;
    expect(docsProvenance(bag)).toStrictEqual({ ok: true });
  });
});
