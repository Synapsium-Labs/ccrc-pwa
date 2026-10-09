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

// ===== Task 3 fix round 1: the own-key guard (G8) =====
// `own` is the one reader of a parsed value, and its `Object.hasOwn` guard is what makes an inherited name no key.
// The tree route checks `Object.hasOwn(query, 'ref')` itself before it reads, so these two cases reach the guard on
// the paths that rely on `own` alone: the refresh body's `ref` and `reason`, and the repeated-key scan.
describe('own keys only (the guard behind every parsed value)', () => {
  it('a refresh body whose ref and reason are inherited has neither: ref is the first missing key', () => {
    const inherited = Object.create({ ref: null, reason: 'auto' }) as Record<string, unknown>;
    expect(parseDocsRefreshBody(inherited)).toStrictEqual(badQuery('body', 'ref'));
  });

  it('a tree query whose ref is inherited as an array is not a repeated key: it parses as the default view', () => {
    const inherited = Object.create({ ref: ['a', 'b'] }) as Record<string, unknown>;
    expect(parseDocsApiQuery('tree', inherited)).toStrictEqual({ ok: true, req: { route: 'tree', ref: null } });
  });
});

// ===== Task 4: read-lane admission, wire estimates, cache-control and the response-header verdict =====
// M6.1 (`laneAdmit`, section 6.3's four clauses), M6.4 (a wire estimate reads server facts only, section 6.2),
// section 6.6's browser-cache table (`cacheControlFor`) and section 5.3's onSend hook as an L1 verdict
// (`docsSendPolicy`, refinement (m)). The lane constants are refinement (l)'s; their derived inequalities
// (`showWire(class cap) <= DOCS_LANE_BYTES`, `DOCS_LANE_QUEUE >= DOCS_MAX_IMAGES_PER_PAGE + 2`) are Task 5's
// `docs-budget.test.ts`. Every expected number and string below is written out from the spec, never read back from
// `policy.ts`; the four L0 response headers are read from `shared/docs.ts`, their one home.
//
// Imports sit here for Task 3's reason: no line above this block moves.
import {
  DOCS_CACHE_IMMUTABLE, DOCS_CACHE_NO_STORE, DOCS_JSON_CONTENT_TYPE, DOCS_LANE_BYTES, DOCS_LANE_EXECS,
  DOCS_LANE_LARGE_RAW, DOCS_LANE_MAX_WAIT_MS, DOCS_LANE_QUEUE, LISTING_JOB, cacheControlFor, docsSendPolicy,
  docsShowPlan, laneAdmit, showRawBound, showWire,
  type DocsJob, type DocsSendVerdict, type LaneLoad,
} from '../src/docs/policy.js';
import {
  DOCS_ALLOWED_CONTENT_TYPES, DOCS_CLASS_CAP, DOCS_RESPONSE_HEADERS, type DocContentClass,
} from '../../shared/docs.js';

/** `policy.ts`'s text, for the two source pins below (a constant's own literal, the class-cap lookup). */
const T4_POLICY_SRC = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'docs', 'policy.ts'), 'utf8');

describe('the read-lane constants (refinement (l), section 6.3)', () => {
  it('each has the value the spec gives it', () => {
    expect(DOCS_LANE_EXECS).toBe(2);
    expect(DOCS_LANE_BYTES).toBe(3145728);
    expect(DOCS_LANE_LARGE_RAW).toBe(1048576);
    expect(DOCS_LANE_QUEUE).toBe(32);
    expect(DOCS_LANE_MAX_WAIT_MS).toBe(10000);
  });

  it('each is its own integer literal, never an alias of a neighbour that holds the same number', () => {
    // DOCS_LANE_LARGE_RAW equals DOCS_MAX_LISTING_WIRE_BYTES today; tying them would let a listing-bound change move
    // the lane's large-answer threshold (W1's rule for the caps in shared/docs.ts, section (B)).
    const lines = T4_POLICY_SRC.split('\n');
    for (const line of [
      'export const DOCS_LANE_EXECS = 2;',
      'export const DOCS_LANE_BYTES = 3145728;',
      'export const DOCS_LANE_LARGE_RAW = 1048576;',
      'export const DOCS_LANE_QUEUE = 32;',
      'export const DOCS_LANE_MAX_WAIT_MS = 10000;',
    ]) expect(lines, line).toContain(line);
  });
});

describe("laneAdmit (M6.1): section 6.3's four clauses, in order", () => {
  const load = (execs: number, bytes: number, large: number): LaneLoad => ({ execs, bytes, large });
  const job = (raw: number, wire: number): DocsJob => ({ raw, wire });

  it.each([
    ['an idle lane admits one job over the byte budget and over the large threshold', load(0, 0, 0),
      job(4194304, 5657944), true],
    ['one exec in flight admits a small job (the control for the next row)', load(1, 0, 0), job(1, 65540), true],
    ['execs at DOCS_LANE_EXECS refuse', load(2, 0, 0), job(1, 65540), false],
    ['execs past DOCS_LANE_EXECS refuse', load(3, 0, 0), job(1, 65540), false],
    ['bytes plus wire exactly at DOCS_LANE_BYTES admit', load(1, 3145728 - 65540, 0), job(1, 65540), true],
    ['bytes plus wire one byte over DOCS_LANE_BYTES refuse', load(1, 3145728 - 65539, 0), job(1, 65540), false],
    ['a second answer over 1 MiB refuses', load(1, 0, 1), job(1048577, 1463640), false],
    ['an answer of exactly 1 MiB beside a large one admits (over, not at)', load(1, 0, 1), job(1048576, 1463640), true],
    ['a large answer with no large one running admits', load(1, 0, 0), job(1048577, 1463640), true],
  ] as const)('%s', (_what, l, j, want) => {
    expect(laneAdmit(l, j)).toBe(want);
  });
});

describe('wire estimates read server facts only (M6.4, section 6.2)', () => {
  it.each([
    ['an unknown size is the class cap', 2097152, undefined, 2097152],
    ['a listed size lowers it', 2097152, 100, 100],
    ['a listed size of 0 is a fact, not an unknown', 2097152, 0, 0],
    ['a listed size over the cap never raises it', 2097152, 5000000, 2097152],
    ['a listed size equal to the cap is the cap', 2097152, 2097152, 2097152],
  ] as const)('showRawBound: %s', (_what, cap, size, want) => {
    expect(showRawBound(cap, size)).toBe(want);
  });

  it.each([
    [0, 65536], [1, 65540], [3, 65540], [4, 65544], [1000, 66872], [1048576, 1463640], [2097152, 2861740],
    [4194304, 5657944],
  ] as const)('showWire(%i) = %i: 4 * ceil(raw / 3) plus the 64 KiB envelope', (raw, wire) => {
    expect(showWire(raw)).toBe(wire);
  });

  it('LISTING_JOB is the framed listing bound on both sides, and frozen: one shared object, never a caller\'s', () => {
    expect(LISTING_JOB).toStrictEqual({ raw: 1048576, wire: 1048576 });
    expect(Object.isFrozen(LISTING_JOB)).toBe(true);
  });

  it.each([
    ['a.md', undefined, { cls: 'markdown', maxBytes: 2097152, job: { raw: 2097152, wire: 2861740 } }],
    ['a.png', 1000, { cls: 'raster', maxBytes: 2097152, job: { raw: 1000, wire: 66872 } }],
    ['dir/b.svg', 5000000, { cls: 'svg', maxBytes: 2097152, job: { raw: 2097152, wire: 2861740 } }],
    ['a.html', 0, { cls: 'html', maxBytes: 2097152, job: { raw: 0, wire: 65536 } }],
    ['a.json', 3, { cls: 'text', maxBytes: 2097152, job: { raw: 3, wire: 65540 } }],
    ['a.pdf', undefined, { cls: 'other', maxBytes: 2097152, job: { raw: 2097152, wire: 2861740 } }],
  ] as const)('docsShowPlan(%j, %j)', (p, size, want) => {
    expect(docsShowPlan(p, size)).toStrictEqual(want);
  });

  it("docsShowPlan's --max-bytes is the path's class cap, for every class", () => {
    const byClass: readonly (readonly [string, DocContentClass])[] = [
      ['a.md', 'markdown'], ['a.png', 'raster'], ['a.svg', 'svg'], ['a.html', 'html'], ['a.txt', 'text'],
      ['a.pdf', 'other'],
    ];
    for (const [p, cls] of byClass) expect(docsShowPlan(p, undefined).maxBytes, p).toBe(DOCS_CLASS_CAP[cls]);
  });

  it('reads the cap through DOCS_CLASS_CAP[cls]: the class caps are equal today, so no value tells them apart', () => {
    expect(T4_POLICY_SRC.split('\n')).toContain('  const maxBytes = DOCS_CLASS_CAP[cls];');
  });

  it('a size sent by the client never reaches an estimate: the query refuses it, and a parsed pin carries none', () => {
    expect(parseDocsApiQuery('file', form(`${COMMITTED_Q}&size=1`))).toStrictEqual(badQuery('unknown', 'size'));
    expect(parseDocsApiQuery('file', form(`${COMMITTED_Q}&maxBytes=1`))).toStrictEqual(badQuery('unknown', 'maxBytes'));
    const parsed = parseDocsApiQuery('file', form(COMMITTED_Q));
    if (!parsed.ok || parsed.req.route !== 'file') throw new Error('the complete committed pin did not parse');
    expect(Object.keys(parsed.req.pin).sort()).toEqual(['commit', 'kind', 'path', 'section', 'servedRef']);
    expect(docsShowPlan(parsed.req.pin.path, undefined).job).toStrictEqual({ raw: 2097152, wire: 2861740 });
  });
});

describe("cacheControlFor (section 6.6, section 5.2): immutable only for a committed pin's raster", () => {
  it('the two values are the spec strings', () => {
    expect(DOCS_CACHE_IMMUTABLE).toBe('private, max-age=31536000, immutable');
    expect(DOCS_CACHE_NO_STORE).toBe('no-store');
  });

  it.each([
    ['committed', 'raster', 'private, max-age=31536000, immutable'],
    ['committed', 'markdown', 'no-store'],
    ['committed', 'svg', 'no-store'],
    ['committed', 'html', 'no-store'],
    ['committed', 'text', 'no-store'],
    ['committed', 'other', 'no-store'],
    ['draft', 'raster', 'no-store'],
    ['draft', 'markdown', 'no-store'],
    ['draft', 'svg', 'no-store'],
    ['draft', 'html', 'no-store'],
    ['draft', 'text', 'no-store'],
    ['draft', 'other', 'no-store'],
  ] as const)('a %s pin of class %s: %s', (kind, cls, want) => {
    expect(cacheControlFor(kind === 'committed' ? COMMITTED_PIN : DRAFT_PIN, cls)).toBe(want);
  });
});

describe("docsSendPolicy (section 5.3's onSend hook as an L1 verdict, refinement (m))", () => {
  const H: Readonly<Record<string, string>> = DOCS_RESPONSE_HEADERS;
  const NO_STORE = { ...H, 'cache-control': 'no-store' };
  const IMMUTABLE = 'private, max-age=31536000, immutable';
  const JSON_CT = 'application/json; charset=utf-8';

  it('the JSON content type is the spec string, and an allowed one (the refusal answers in it)', () => {
    expect(DOCS_JSON_CONTENT_TYPE).toBe('application/json; charset=utf-8');
    expect(DOCS_ALLOWED_CONTENT_TYPES).toContain(DOCS_JSON_CONTENT_TYPE);
  });

  it.each([
    ['a 200 JSON answer with no cache-control gets no-store', 200, JSON_CT, undefined, NO_STORE],
    ['a 200 JSON answer whose route set no-store keeps it (no override)', 200, JSON_CT, 'no-store', H],
    ['a 200 committed PNG keeps its immutable header', 200, 'image/png', IMMUTABLE, H],
    ['a 200 JPEG keeps its header', 200, 'image/jpeg', IMMUTABLE, H],
    ['a 200 GIF keeps its header', 200, 'image/gif', IMMUTABLE, H],
    ['a 200 WebP keeps its header', 200, 'image/webp', IMMUTABLE, H],
    ['a 200 PNG with no cache-control gets no-store', 200, 'image/png', undefined, NO_STORE],
    ['a 404 failure is no-store even when immutable was set', 404, JSON_CT, IMMUTABLE, NO_STORE],
    ["the gate's 401 gets no-store", 401, JSON_CT, undefined, NO_STORE],
    ['a 403 foreign-request gets no-store over a set value', 403, JSON_CT, 'no-store', NO_STORE],
    ['a 503 docs-busy gets no-store', 503, JSON_CT, undefined, NO_STORE],
    ['any status but 200 is no-store: a 206 PNG', 206, 'image/png', IMMUTABLE, NO_STORE],
  ] as const)('%s', (_what, status, ct, cc, headers) => {
    expect(docsSendPolicy(status, ct, cc)).toStrictEqual({ kind: 'pass', headers });
  });

  const refused = (contentType: string): DocsSendVerdict => ({
    kind: 'refuse',
    status: 500,
    headers: { ...H, 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
    remove: ['content-length', 'content-disposition'],
    body: { ok: false, failure: 'response-type-refused' },
    contentType,
  });

  it.each([
    'text/html', 'text/html; charset=utf-8', 'image/svg+xml', 'application/xml', 'text/xml', 'text/plain',
    'application/octet-stream', 'application/json', 'application/json; charset=UTF-8', 'image/PNG', '',
  ])('content type %j is refused: 500 response-type-refused, whatever the status', (ct) => {
    expect(docsSendPolicy(200, ct, undefined)).toStrictEqual(refused(ct));
    expect(docsSendPolicy(404, ct, IMMUTABLE)).toStrictEqual(refused(ct));
  });

  it('a refused content type is carried cut to 80 characters, the length the log line quotes', () => {
    expect(docsSendPolicy(200, 'x'.repeat(200), undefined)).toStrictEqual(refused('x'.repeat(80)));
  });

  it('never writes into the L0 table, and answers a fresh header object each time', () => {
    const a = docsSendPolicy(404, JSON_CT, undefined);
    const b = docsSendPolicy(404, JSON_CT, undefined);
    expect(Object.keys(DOCS_RESPONSE_HEADERS).sort()).toEqual([
      'content-security-policy', 'cross-origin-resource-policy', 'referrer-policy', 'x-content-type-options',
    ]);
    if (a.kind !== 'pass' || b.kind !== 'pass') throw new Error('a JSON 404 was refused');
    expect(a.headers).not.toBe(b.headers);
    expect(a.headers).not.toBe(DOCS_RESPONSE_HEADERS);
  });
});

// ===== W3 Task 1: the routes' L1, part 1 =====
// The fetch-lane, cache, index and log constants (W3 refinement (b), section 6.4, section 6.5), the docs-busy,
// foreign-request and body-error bodies (section 3.7, section 3.8; refinements (e), (h)), the refusal-log cadence
// (refinement (o)), the refresh's fetch half (refinement (m)), the hardened Retry-After (W2's carry) and the
// node-first keys (refinement (p), section 3.12; M3.13's L1 half). Every expected value below is written out from the
// spec, never read back from `policy.ts`; a qualified ref is built from `DOCS_REF_PREFIXES`, never typed.
//
// Imports sit here for W2 Task 3's reason: no line above this block moves.
import {
  DOCS_CACHE_BYTES, DOCS_DEFECT_MESSAGE, DOCS_DRAFT_SIZE_ENTRIES, DOCS_FETCH_BUSY_RETRY_MS, DOCS_FETCH_GLOBAL,
  DOCS_FETCH_MAX_WAIT_MS, DOCS_FETCH_QUEUE, DOCS_INDEX_CACHE_MS, DOCS_LISTING_MAP_ENTRIES, DOCS_LISTING_PROVENANCE_MS,
  DOCS_PRIMARY_NODE, DOCS_READ_BUSY_RETRY_MS, DOCS_REFRESH_SKIPPED, DOCS_REFUSAL_LOG_MS, docsBlobKey,
  docsBodyErrorVerdict, docsBusyBody, docsDraftSizeKey, docsForeignRequestBody, docsIndexCacheable, docsIndexFlightKey,
  docsListingKey, docsLogDue, docsNodeKey, docsProjectKey, docsRefreshAnswer, docsRefreshFetchHalf,
  docsRefreshFlightKey, docsShowFlightKey, docsTreeFlightKey,
  type DocsBodyError, type DocsLaneName, type DocsProvenance, type DocsRefreshAnswer, type DocsRefreshHalf,
} from '../src/docs/policy.js';
import {
  DOCS_STALE_MS, docsRefText, type DocsFetchOk, type DocsRefSpec, type DocsTreeResponse,
} from '../../shared/docs.js';

describe('W3 T1: the fetch-lane, cache, index and log constants (refinement (b), section 6.4, section 6.5)', () => {
  const lines = T4_POLICY_SRC.split('\n');

  it('each has the value the spec gives it', () => {
    expect(DOCS_READ_BUSY_RETRY_MS).toBe(2000);
    expect(DOCS_FETCH_GLOBAL).toBe(2);
    expect(DOCS_FETCH_QUEUE).toBe(8);
    expect(DOCS_FETCH_MAX_WAIT_MS).toBe(20000);
    expect(DOCS_FETCH_BUSY_RETRY_MS).toBe(5000);
    expect(DOCS_CACHE_BYTES).toBe(64 * 1024 * 1024);
    expect(DOCS_LISTING_MAP_ENTRIES).toBe(50000);
    expect(DOCS_INDEX_CACHE_MS).toBe(30000);
    expect(DOCS_DRAFT_SIZE_ENTRIES).toBe(10000);
    expect(DOCS_REFUSAL_LOG_MS).toBe(60000);
  });

  it('each numeric constant is its own integer literal, on exactly one line', () => {
    for (const line of [
      'export const DOCS_READ_BUSY_RETRY_MS = 2000;',
      'export const DOCS_FETCH_GLOBAL = 2;',
      'export const DOCS_FETCH_QUEUE = 8;',
      'export const DOCS_FETCH_MAX_WAIT_MS = 20000;',
      'export const DOCS_FETCH_BUSY_RETRY_MS = 5000;',
      'export const DOCS_CACHE_BYTES = 67108864;',
      'export const DOCS_LISTING_MAP_ENTRIES = 50000;',
      'export const DOCS_INDEX_CACHE_MS = 30000;',
      'export const DOCS_DRAFT_SIZE_ENTRIES = 10000;',
      'export const DOCS_REFUSAL_LOG_MS = 60000;',
    ]) expect(lines.filter((l) => l === line), line).toHaveLength(1);
  });

  it('DOCS_LISTING_PROVENANCE_MS is DOCS_STALE_MS by definition (section 6.5): derived, never a literal of its own', () => {
    expect(DOCS_LISTING_PROVENANCE_MS).toBe(600000);
    expect(DOCS_LISTING_PROVENANCE_MS).toBe(DOCS_STALE_MS);
    expect(lines.filter((l) => l === 'export const DOCS_LISTING_PROVENANCE_MS = DOCS_STALE_MS;')).toHaveLength(1);
  });

  it('DOCS_PRIMARY_NODE is the one node value: a non-empty string with no NUL (section 3.12)', () => {
    expect(typeof DOCS_PRIMARY_NODE).toBe('string');
    expect(DOCS_PRIMARY_NODE.length).toBeGreaterThan(0);
    expect(DOCS_PRIMARY_NODE.includes(String.fromCharCode(0))).toBe(false);
    expect(lines.filter((l) => l === "export const DOCS_PRIMARY_NODE = 'primary';")).toHaveLength(1);
  });
});

describe('W3 T1: docsBusyBody, the one docs-busy producer (section 6.3, section 6.4, section 3.7)', () => {
  it.each([
    ['read', { ok: false, failure: 'docs-busy', lane: 'read', retryAfterMs: 2000 }, 2],
    ['fetch', { ok: false, failure: 'docs-busy', lane: 'fetch', retryAfterMs: 5000 }, 5],
  ] as const)('the %s lane answers %j, Retry-After %i s, status 503', (lane, want, seconds) => {
    const name: DocsLaneName = lane;
    expect(docsBusyBody(name)).toStrictEqual(want);
    expect(docsRetryAfterSeconds(docsBusyBody(name))).toBe(seconds);
    expect(DOCS_FAILURE_HTTP[docsBusyBody(name).failure]).toBe(503);
  });

  it("answers a fresh object each call, so no caller can change another caller's body", () => {
    expect(docsBusyBody('read')).not.toBe(docsBusyBody('read'));
  });
});

describe("W3 T1: docsRetryAfterSeconds is finite and positive or absent (refinement (h), W2's carry)", () => {
  const busy = (retryAfterMs: number): DocsFailureBody =>
    ({ ok: false, failure: 'docs-busy', lane: 'read', retryAfterMs });

  it.each([NaN, Infinity, -Infinity, -5000, -1, 0, -0])('docs-busy with retryAfterMs %s sends no header', (ms) => {
    expect(docsRetryAfterSeconds(busy(ms))).toBeNull();
  });

  it.each([[0.5, 1], [1, 1], [999, 1], [1000, 1], [1001, 2], [2000, 2], [5000, 5]] as const)(
    'docs-busy with retryAfterMs %s answers %i s, rounded up', (ms, seconds) => {
      expect(docsRetryAfterSeconds(busy(ms))).toBe(seconds);
    });

  it('docs-busy with no retryAfterMs at all sends no header', () => {
    expect(docsRetryAfterSeconds({ ok: false, failure: 'docs-busy', lane: 'fetch' })).toBeNull();
  });

  it('caps-unknown is 5 s whatever its body carries', () => {
    for (const retryAfterMs of [NaN, -1, 0, 9000]) {
      expect(docsRetryAfterSeconds({ ok: false, failure: 'caps-unknown', retryAfterMs }), String(retryAfterMs)).toBe(5);
    }
  });

  it("fetch-too-soon's wait still rides its body only: no header", () => {
    expect(docsRetryAfterSeconds({ ok: false, failure: 'fetch-too-soon', retryAfterMs: 9000 })).toBeNull();
  });
});

describe('W3 T1: docsForeignRequestBody, the 403 for a refused provenance verdict (section 3.7, section 3.8)', () => {
  type Refused = Exclude<DocsProvenance, { ok: true }>;
  const ROWS: readonly (readonly [what: string, verdict: Refused, want: DocsFailureBody])[] = [
    ['navigation', { ok: false, why: 'navigation' }, { ok: false, failure: 'foreign-request', why: 'navigation' }],
    ['marker', { ok: false, why: 'marker' }, { ok: false, failure: 'foreign-request', why: 'marker' }],
    ['site, cross-site', { ok: false, why: 'site', site: 'cross-site' },
      { ok: false, failure: 'foreign-request', why: 'site', site: 'cross-site' }],
    ['site, an empty value', { ok: false, why: 'site', site: '' },
      { ok: false, failure: 'foreign-request', why: 'site', site: '' }],
  ];

  it.each(ROWS)('%s', (_what, verdict, want) => {
    const body = docsForeignRequestBody(verdict);
    expect(body).toStrictEqual(want);
    expect(Object.hasOwn(body, 'site'), 'site rides only a verdict that carries one').toBe(Object.hasOwn(want, 'site'));
    expect(Object.hasOwn(body, 'verdict'), 'never a verdict key: no login overlay').toBe(false);
    expect(DOCS_FAILURE_HTTP[body.failure]).toBe(403);
  });

  it("carries docsProvenance's own refusals: a bare request is marker, a sibling is site", () => {
    const marker = docsProvenance({});
    const site = docsProvenance({ 'sec-fetch-site': 'same-site' });
    if (marker.ok || site.ok) throw new Error('docsProvenance admitted a request with no marker');
    expect(docsForeignRequestBody(marker)).toStrictEqual({ ok: false, failure: 'foreign-request', why: 'marker' });
    expect(docsForeignRequestBody(site))
      .toStrictEqual({ ok: false, failure: 'foreign-request', why: 'site', site: 'same-site' });
  });
});

describe('W3 T1: docsBodyErrorVerdict, a refused request body (refinement (e))', () => {
  const BODY: DocsBodyError = { kind: 'body', body: { ok: false, failure: 'bad-query', why: 'body' } };

  it.each([
    'FST_ERR_CTP_INVALID_JSON_BODY', 'FST_ERR_CTP_EMPTY_JSON_BODY', 'FST_ERR_CTP_BODY_TOO_LARGE',
    'FST_ERR_CTP_INVALID_MEDIA_TYPE', 'FST_ERR_CTP_INVALID_CONTENT_LENGTH',
  ])('%s is bad-query {why:body}, status 400', (code) => {
    const v = docsBodyErrorVerdict(code);
    expect(v).toStrictEqual(BODY);
    if (v.kind !== 'body') throw new Error('not a body verdict');
    expect(DOCS_FAILURE_HTTP[v.body.failure]).toBe(400);
  });

  it.each([
    ['FST_ERR_BAD_URL'], ['FST_ERR_NOT_FOUND'], ['ERR_X'], [''], ['fst_err_ctp_invalid_json_body'],
    ['X_FST_ERR_CTP_INVALID_JSON_BODY'], [undefined], [null], [42], [{ code: 'FST_ERR_CTP_BODY_TOO_LARGE' }],
  ])('%j is a defect: re-thrown to the default handler', (code) => {
    expect(docsBodyErrorVerdict(code)).toStrictEqual({ kind: 'defect' });
  });

  it('answers a fresh body each call', () => {
    const a = docsBodyErrorVerdict('FST_ERR_CTP_BODY_TOO_LARGE');
    const b = docsBodyErrorVerdict('FST_ERR_CTP_BODY_TOO_LARGE');
    if (a.kind !== 'body' || b.kind !== 'body') throw new Error('not a body verdict');
    expect(a.body).not.toBe(b.body);
  });

  it("a defect's 500 carries DOCS_DEFECT_MESSAGE, fixed text naming no path and no stderr", () => {
    expect(DOCS_DEFECT_MESSAGE).toBe('docs route defect');
  });
});

describe('W3 T1: docsLogDue, at most one refusal line a minute per reason (refinement (o), section 3.8)', () => {
  it.each([
    ['never logged, at time 0', undefined, 0, true],
    ['never logged, later', undefined, 123456, true],
    ['one ms short of a minute', 0, 59999, false],
    ['exactly a minute', 0, 60000, true],
    ['a minute after a later line', 1000, 61000, true],
    ['one ms short after a later line', 1000, 60999, false],
    ['the same instant', 5000, 5000, false],
  ] as const)('%s', (_what, last, now, want) => {
    expect(docsLogDue(last, now)).toBe(want);
  });
});

describe("W3 T1: docsRefreshFetchHalf, the refresh's fetch half (refinement (m), section 3.4)", () => {
  const fail = (failure: DocsFailure, extra: Partial<DocsFailureBody> = {}): DocsFailureBody =>
    ({ ok: false, failure, ...extra });
  const PRE_EXEC: readonly DocsFailure[] = ['caps-unknown', 'unsupported', 'docs-busy'];

  it.each([
    ['caps-unknown', fail('caps-unknown')],
    ['unsupported', fail('unsupported')],
    ['docs-busy', fail('docs-busy', { lane: 'fetch', retryAfterMs: 5000 })],
  ] as const)('%s ends the request with its own status: refuse, carrying the body itself', (_word, body) => {
    const half: DocsRefreshHalf = docsRefreshFetchHalf(body);
    expect(half).toStrictEqual({ kind: 'refuse', body });
    if (half.kind !== 'refuse') throw new Error('not a refusal');
    expect(half.body).toBe(body);
  });

  it.each([
    ['fetch-too-soon with its wait', fail('fetch-too-soon', { retryAfterMs: 9000 })],
    ['remote-branch-absent', fail('remote-branch-absent', { branch: 'ws/a' })],
    ['ref-locked, the lock already gone (null)', fail('ref-locked', { lockAgeMs: null })],
    ['ref-locked, unmeasured (ABSENT)', fail('ref-locked')],
    ['link-failed', fail('link-failed', { cause: 'closed' })],
    ['not-granted', fail('not-granted')],
    ['malformed-answer', fail('malformed-answer', { why: 'schema' })],
  ] as const)('%s is a failed half carrying its body verbatim', (_what, body) => {
    const half = docsRefreshFetchHalf(body);
    expect(half).toStrictEqual({ kind: 'half', fetch: { state: 'failed', failure: body } });
    if (half.kind !== 'half' || half.fetch.state !== 'failed') throw new Error('not a failed half');
    expect(half.fetch.failure).toBe(body);
  });

  it('absent stays absent and null stays null: ref-locked\'s lockAgeMs as ccd said it', () => {
    const absent = docsRefreshFetchHalf(fail('ref-locked'));
    const gone = docsRefreshFetchHalf(fail('ref-locked', { lockAgeMs: null }));
    if (absent.kind !== 'half' || absent.fetch.state !== 'failed') throw new Error('not a failed half');
    if (gone.kind !== 'half' || gone.fetch.state !== 'failed') throw new Error('not a failed half');
    expect(Object.hasOwn(absent.fetch.failure, 'lockAgeMs')).toBe(false);
    expect(gone.fetch.failure.lockAgeMs).toBeNull();
  });

  it('every word but the three pre-exec ones is a failed half, never a refusal', () => {
    for (const word of Object.keys(DOCS_FAILURES) as DocsFailure[]) {
      expect(docsRefreshFetchHalf(fail(word)).kind, word).toBe(PRE_EXEC.includes(word) ? 'refuse' : 'half');
    }
  });

  it('an ok run is a ran half carrying the answer itself', () => {
    const answer: DocsFetchOk = {
      v: 1, verb: 'docs-fetch', ok: true, elapsedMs: 12, branch: 'main', trackedRef: DOCS_REF_PREFIXES[1] + 'main',
      before: null, after: 'a'.repeat(40), moved: 'created', stamp: 'written',
    };
    const half = docsRefreshFetchHalf({ ok: true, answer });
    expect(half).toStrictEqual({ kind: 'half', fetch: { state: 'ran', answer } });
    if (half.kind !== 'half' || half.fetch.state !== 'ran') throw new Error('not a ran half');
    expect(half.fetch.answer).toBe(answer);
  });

  it('DOCS_REFRESH_SKIPPED is the local-ref half, frozen', () => {
    expect(DOCS_REFRESH_SKIPPED).toStrictEqual({ state: 'skipped', why: 'local-ref' });
    expect(Object.isFrozen(DOCS_REFRESH_SKIPPED)).toBe(true);
  });
});

describe("W3 T1: docsRefreshAnswer, a refresh that ran no exec at all (refinement (m), section 3.4)", () => {
  const fail = (failure: DocsFailure, extra: Partial<DocsFailureBody> = {}): DocsFailureBody =>
    ({ ok: false, failure, ...extra });
  const TREE: DocsTreeResponse = { ok: true, tree: {} as DocsTreeOk, refreshDue: false };
  const RAN = { state: 'ran', answer: {} as DocsFetchOk } as const;
  const FAILED = { state: 'failed', failure: fail('fetch-too-soon', { retryAfterMs: 9000 }) } as const;
  const PRE_EXEC: readonly DocsFailure[] = ['caps-unknown', 'unsupported', 'docs-busy'];

  it.each([
    ['caps-unknown', fail('caps-unknown')],
    ['unsupported', fail('unsupported')],
    ['docs-busy', fail('docs-busy', { lane: 'read', retryAfterMs: 2000 })],
  ] as const)('a skipped fetch and a %s tree half: no exec ran, so refuse, carrying the body itself', (_word, body) => {
    const out: DocsRefreshAnswer = docsRefreshAnswer(DOCS_REFRESH_SKIPPED, body);
    expect(out).toStrictEqual({ kind: 'refuse', body });
    if (out.kind !== 'refuse') throw new Error('not a refusal');
    expect(out.body).toBe(body);
  });

  it.each([
    ['an ok tree', TREE],
    ['a tree that failed after its exec (unresolved-ref)', fail('unresolved-ref')],
    ['not-granted (the agent refused an exec it was sent)', fail('not-granted')],
  ] as const)('a skipped fetch and %s: send the 200 {ok, fetch: skipped, tree}', (_what, tree) => {
    expect(docsRefreshAnswer(DOCS_REFRESH_SKIPPED, tree))
      .toStrictEqual({ kind: 'send', body: { ok: true, fetch: { state: 'skipped', why: 'local-ref' }, tree } });
  });

  it.each([['a ran fetch', RAN], ['a failed fetch', FAILED]] as const)(
    '%s made an exec: a pre-exec tree word rides the 200 as the tree half', (_what, fetch) => {
      for (const word of PRE_EXEC) {
        const tree = fail(word);
        expect(docsRefreshAnswer(fetch, tree), word).toStrictEqual({ kind: 'send', body: { ok: true, fetch, tree } });
      }
    });

  it('a skipped fetch: every word but the three pre-exec ones rides the 200, never a refusal', () => {
    for (const word of Object.keys(DOCS_FAILURES) as DocsFailure[]) {
      expect(docsRefreshAnswer(DOCS_REFRESH_SKIPPED, fail(word)).kind, word)
        .toBe(PRE_EXEC.includes(word) ? 'refuse' : 'send');
    }
  });
});

describe("W3 T1: docsIndexCacheable, a micro-cache fill only at the flight's own generation (section 6.5)", () => {
  it.each([
    ['no refresh since the flight began', 0, 0, true],
    ['no refresh since, at a later generation', 3, 3, true],
    ['a refresh settled after the flight began', 0, 1, false],
    ['three refreshes settled after it began', 2, 5, false],
  ] as const)('%s', (_what, atStart, now, want) => {
    expect(docsIndexCacheable(atStart, now)).toBe(want);
  });
});

describe('W3 T1: the node-first keys (refinement (p), section 3.12, section 6.4, section 6.5; M3.13 L1 half)', () => {
  const NUL = String.fromCharCode(0);
  const N = DOCS_PRIMARY_NODE;
  const OTHER = 'other-node';
  const BARE_A: DocsRefSpec = { kind: 'bare', name: 'a' };
  const LOCAL_A: DocsRefSpec = { kind: 'qualified', ref: DOCS_REF_PREFIXES[0] + 'a' };
  const MAIN: DocsRefSpec = { kind: 'bare', name: 'main' };
  const REPO = 'r'.repeat(64);
  const BLOB = 'b'.repeat(40);

  it('every key is its kind tag, the node, then its fields, joined by NUL and nothing else', () => {
    expect(docsIndexFlightKey('n', 0).split(NUL)).toEqual(['index', 'n', '0']);
    expect(docsIndexFlightKey('n', 4).split(NUL)).toEqual(['index', 'n', '4']);
    expect(docsNodeKey('n').split(NUL)).toEqual(['node', 'n']);
    expect(docsTreeFlightKey('n', 'demo', null, 0).split(NUL)).toEqual(['tree', 'n', 'demo', '', '0']);
    expect(docsTreeFlightKey('n', 'demo', LOCAL_A, 3).split(NUL))
      .toEqual(['tree', 'n', 'demo', docsRefText(LOCAL_A), '3']);
    expect(docsShowFlightKey('n', 'demo', COMMITTED_PIN, 2097152).split(NUL)).toEqual([
      'show', 'n', 'demo', 'committed', T3_COMMIT, COMMITTED_PIN.servedRef, 'specs', 'a.md', '2097152',
    ]);
    expect(docsShowFlightKey('n', 'demo', DRAFT_PIN, 2097152).split(NUL)).toEqual([
      'show', 'n', 'demo', 'draft', 'ws/a', T3_HEAD, 'plans', 'dir/b.md', T3_FP, '2097152',
    ]);
    expect(docsRefreshFlightKey('n', 'demo', null).split(NUL)).toEqual(['refresh', 'n', 'demo', '']);
    expect(docsRefreshFlightKey('n', 'demo', 'main').split(NUL)).toEqual(['refresh', 'n', 'demo', 'main']);
    expect(docsProjectKey('n', 'demo').split(NUL)).toEqual(['project', 'n', 'demo']);
    expect(docsBlobKey('n', REPO, BLOB).split(NUL)).toEqual(['blob', 'n', REPO, BLOB]);
    expect(docsListingKey('n', 'demo', T3_COMMIT).split(NUL)).toEqual(['listing', 'n', 'demo', T3_COMMIT]);
    expect(docsDraftSizeKey('n', T3_FP).split(NUL)).toEqual(['fp', 'n', T3_FP]);
  });

  it.each([
    ['index', (node: string) => docsIndexFlightKey(node, 0)],
    ['node', (node: string) => docsNodeKey(node)],
    ['tree', (node: string) => docsTreeFlightKey(node, 'demo', MAIN, 0)],
    ['show', (node: string) => docsShowFlightKey(node, 'demo', COMMITTED_PIN, 2097152)],
    ['refresh', (node: string) => docsRefreshFlightKey(node, 'demo', 'main')],
    ['project', (node: string) => docsProjectKey(node, 'demo')],
    ['blob', (node: string) => docsBlobKey(node, REPO, BLOB)],
    ['listing', (node: string) => docsListingKey(node, 'demo', T3_COMMIT)],
    ['fp', (node: string) => docsDraftSizeKey(node, T3_FP)],
  ] as const)('the %s key changes when ONLY its node changes (M3.13: no entry is shared across nodes)', (_k, key) => {
    expect(key(N)).not.toBe(key(OTHER));
  });

  it('a tree key tells the default view, a bare ref, a local ref and the generation apart', () => {
    const keys = [
      docsTreeFlightKey(N, 'demo', null, 0),
      docsTreeFlightKey(N, 'demo', MAIN, 0),
      docsTreeFlightKey(N, 'demo', BARE_A, 0),
      docsTreeFlightKey(N, 'demo', LOCAL_A, 0),
      docsTreeFlightKey(N, 'demo', null, 1),
    ];
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('a generation bump alone makes a new tree flight (section 6.4: a refresh never joins an older tree)', () => {
    expect(docsTreeFlightKey(N, 'demo', MAIN, 0)).not.toBe(docsTreeFlightKey(N, 'demo', MAIN, 1));
  });

  it('a node generation bump alone makes a new index flight (section 6.5: a GET after a refresh never joins an older index)', () => {
    expect(docsIndexFlightKey(N, 0)).not.toBe(docsIndexFlightKey(N, 1));
    expect(docsNodeKey(N)).not.toBe(docsProjectKey(N, ''));
    expect(docsNodeKey(N)).not.toBe(docsIndexFlightKey(N, 0));
  });

  it('a show key tells a committed pin from a draft pin with the same section and path, and N apart', () => {
    const committed: DocPin = { ...COMMITTED_PIN, section: 'plans', path: 'dir/b.md' };
    expect(docsShowFlightKey(N, 'demo', committed, 2097152))
      .not.toBe(docsShowFlightKey(N, 'demo', DRAFT_PIN, 2097152));
    expect(docsShowFlightKey(N, 'demo', COMMITTED_PIN, 1)).not.toBe(docsShowFlightKey(N, 'demo', COMMITTED_PIN, 2));
  });

  it('a refresh key tells the default branch from a named one', () => {
    expect(docsRefreshFlightKey(N, 'demo', null)).not.toBe(docsRefreshFlightKey(N, 'demo', 'main'));
  });

  it('no field can shift into its neighbour: adjacent fields split differently give different keys', () => {
    const pairs: readonly (readonly [string, string])[] = [
      [docsTreeFlightKey(N, 'ab', { kind: 'bare', name: 'c' }, 0),
        docsTreeFlightKey(N, 'a', { kind: 'bare', name: 'bc' }, 0)],
      [docsShowFlightKey(N, 'demo', { ...COMMITTED_PIN, path: 'a.md1' }, 2),
        docsShowFlightKey(N, 'demo', { ...COMMITTED_PIN, path: 'a.md' }, 12)],
      [docsRefreshFlightKey(N, 'ab', 'c'), docsRefreshFlightKey(N, 'a', 'bc')],
      [docsProjectKey('n1', 'demo'), docsProjectKey('n', '1demo')],
      [docsBlobKey(N, 'a', 'bc'), docsBlobKey(N, 'ab', 'c')],
      [docsListingKey(N, 'ab', 'c'), docsListingKey(N, 'a', 'bc')],
      [docsDraftSizeKey('na', 'b'), docsDraftSizeKey('n', 'ab')],
    ];
    for (const [a, b] of pairs) expect(a).not.toBe(b);
  });

  it('the kind tag alone tells two kinds over the same fields apart', () => {
    const same = [
      docsBlobKey(N, 'demo', 'c'), docsListingKey(N, 'demo', 'c'), docsRefreshFlightKey(N, 'demo', 'c'),
    ];
    expect(new Set(same).size).toBe(3);
    expect(docsProjectKey(N, 'demo')).not.toBe(docsDraftSizeKey(N, 'demo'));
  });
});
