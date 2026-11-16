/**
 * The Docs L3 adapter's sections gate (rich-docs spec 2026-10-12 G1, M9.3, the server half; docs W5b-1): the sections
 * `vision` and `promise` are named to ccd only on a box whose `ccd caps` lists the sections token, else the adapter
 * answers `unsupported` with zero execs. A new file, so `docs-source.test.ts` stays as it is.
 *
 * A recording `CcdRunner` double keeps every argv it was handed; no case runs `ccd`.
 */
import { describe, it, expect } from 'vitest';
import { DOCS_CAP, DOCS_LOG_CAP, DOCS_SECTIONS_CAP, type CcdArgv } from '../src/ccdargv.js';
import type { CcdResult, CcdRunner } from '../src/lifecycle.js';
import { ccdDocsReader } from '../src/docs/ccdsource.js';
import { HISTORY_JOB, docsShowPlan } from '../src/docs/policy.js';
import type { DocsShowAsk } from '../src/docs/ports.js';
import type { DocPin, DocsLogAsk } from '../../shared/docs.js';

/** A recording runner: every argv it is handed, and one scripted answer for all of them. */
function recorder(answer: CcdResult): { run: CcdRunner; calls: string[][] } {
  const calls: string[][] = [];
  return { calls, run: async (argv: CcdArgv) => { calls.push([...argv]); return answer; } };
}
/** A measured, clean exit unless a case says otherwise. */
const res = (over: Partial<Pick<CcdResult, 'ok' | 'stdout' | 'stderr' | 'killed' | 'signal'>>): CcdResult =>
  ({ ran: true, ok: true, stdout: '', stderr: '', killed: false, signal: null, ...over });
const state = (ccdVerbs: string[] | null): { ccdVerbs: string[] | null } => ({ ccdVerbs });
/** One answer line as ccd writes it: one JSON text and one LF. */
const line = (o: Record<string, unknown>): string => `${JSON.stringify(o)}\n`;

const SHA = 'a'.repeat(40);
const PLAN = docsShowPlan('a.md', undefined);
const ASK: DocsShowAsk = { maxBytes: PLAN.maxBytes, job: PLAN.job, listedBlob: null };
const SRC = { node: 'n', project: 'demo' };
const committed = (section: 'specs' | 'vision' | 'promise'): DocPin =>
  ({ kind: 'committed', commit: SHA, servedRef: 'refs/remotes/origin/main', section, path: 'a.md' });
const draft = (section: 'specs' | 'vision' | 'promise'): DocPin =>
  ({ kind: 'draft', branch: 'ws/a', head: SHA, section, path: 'a.md', fp: 'b'.repeat(64) });

const OLD = state(['caps', DOCS_CAP]);
const NEW = state(['caps', DOCS_CAP, DOCS_SECTIONS_CAP]);
/** A failing exec answer: the cases below look at what was sent, not at how the answer classifies. */
const USAGE = res({ ok: false, stderr: 'usage', stdout: line({ v: 1, ok: false }) });

describe('the sections gate (rich-docs spec G1, M9.3)', () => {
  it('a vision pin without docs-sections-v2 is unsupported, with zero execs', async () => {
    const rec = recorder(USAGE);
    expect(await ccdDocsReader({ runCcd: rec.run, fleetState: OLD }).show(SRC, committed('vision'), ASK))
      .toEqual({ ok: false, failure: 'unsupported' });
    expect(rec.calls).toEqual([]);
  });

  it('a promise draft pin, the same', async () => {
    const rec = recorder(USAGE);
    expect(await ccdDocsReader({ runCcd: rec.run, fleetState: OLD }).show(SRC, draft('promise'), ASK))
      .toEqual({ ok: false, failure: 'unsupported' });
    expect(rec.calls).toEqual([]);
  });

  it('with docs-sections-v2 the vision pin execs once', async () => {
    const rec = recorder(USAGE);
    await ccdDocsReader({ runCcd: rec.run, fleetState: NEW }).show(SRC, committed('vision'), ASK);
    expect(rec.calls).toHaveLength(1);
    expect(rec.calls[0]).toEqual(['docs-show', '--project', 'demo', '--commit', SHA, '--ref', 'refs/remotes/origin/main',
      '--section', 'vision', '--path', 'a.md', '--max-bytes', String(PLAN.maxBytes)]);
  });

  it('a specs pin needs no new token', async () => {
    const rec = recorder(USAGE);
    await ccdDocsReader({ runCcd: rec.run, fleetState: OLD }).show(SRC, committed('specs'), ASK);
    expect(rec.calls).toHaveLength(1);
  });

  it('caps-unknown still answers first', async () => {
    const rec = recorder(USAGE);
    expect(await ccdDocsReader({ runCcd: rec.run, fleetState: state([]) }).show(SRC, committed('vision'), ASK))
      .toEqual({ ok: false, failure: 'caps-unknown' });
    expect(rec.calls).toEqual([]);
  });
});

// ── the history read (rich-docs spec G4, M9.7, M9.9; docs W5b-1) ───────────────────────────────────────────────────
/** A box whose ccd lists the history token, with and without the sections token. */
const LOG_ONLY = state(['caps', DOCS_LOG_CAP]);
const LOG_AND_SECTIONS = state(['caps', DOCS_LOG_CAP, DOCS_SECTIONS_CAP]);
const LOG_ASK: DocsLogAsk = { commit: SHA, section: 'specs', path: 'a.md' };
/** ccd's ok line for `LOG_ASK`, with `over` replacing top-level fields. */
const logLine = (over: Record<string, unknown> = {}): string => line({
  v: 1, verb: 'docs-log', ok: true, elapsedMs: 3, commit: SHA, section: 'specs', path: 'a.md',
  entries: [{ sha: SHA, parent: null, date: '2026-11-01T10:00:00+00:00', author: 'Ann', subject: 'Add a' }],
  truncated: false, ...over,
});

describe('the log read (rich-docs spec G4)', () => {
  it('a list without docs-log-v1 is unsupported, with zero execs', async () => {
    // The old docs token alone is not the history token (M9.9).
    const rec = recorder(res({ stdout: logLine() }));
    expect(await ccdDocsReader({ runCcd: rec.run, fleetState: OLD }).log(SRC, LOG_ASK))
      .toEqual({ ok: false, failure: 'unsupported' });
    expect(rec.calls).toEqual([]);
  });

  it("with docs-log-v1 the argv is exactly the builder's 9 tokens", async () => {
    const rec = recorder(res({ stdout: logLine() }));
    const out = await ccdDocsReader({ runCcd: rec.run, fleetState: LOG_ONLY }).log(SRC, LOG_ASK);
    expect(rec.calls).toEqual([['docs-log', '--project', 'demo', '--commit', SHA, '--section', 'specs', '--path', 'a.md']]);
    expect(rec.calls[0]).toHaveLength(9);
    expect(out).toEqual({ ok: true, answer: JSON.parse(logLine()) });
  });

  it('a log of a vision doc without docs-sections-v2 is unsupported, with zero execs', async () => {
    const rec = recorder(res({ stdout: logLine({ section: 'vision' }) }));
    expect(await ccdDocsReader({ runCcd: rec.run, fleetState: LOG_ONLY }).log(SRC, { ...LOG_ASK, section: 'vision' }))
      .toEqual({ ok: false, failure: 'unsupported' });
    expect(rec.calls).toEqual([]);
  });

  it('a log of a vision doc with docs-sections-v2 execs once', async () => {
    const rec = recorder(res({ stdout: logLine({ section: 'vision' }) }));
    const out = await ccdDocsReader({ runCcd: rec.run, fleetState: LOG_AND_SECTIONS })
      .log(SRC, { ...LOG_ASK, section: 'vision' });
    expect(rec.calls).toHaveLength(1);
    expect(out.ok).toBe(true);
  });

  it('caps-unknown still answers first', async () => {
    const rec = recorder(res({ stdout: logLine() }));
    expect(await ccdDocsReader({ runCcd: rec.run, fleetState: state([]) }).log(SRC, LOG_ASK))
      .toEqual({ ok: false, failure: 'caps-unknown' });
    expect(rec.calls).toEqual([]);
  });

  it.each([
    ['path', { path: 'b.md' }],
    ['section', { section: 'plans' }],
    ['commit', { commit: 'b'.repeat(40) }],
  ])('an answer for another path, section or commit is malformed-answer {why:pin}: the %s', async (_what, over) => {
    const rec = recorder(res({ stdout: logLine(over) }));
    expect(await ccdDocsReader({ runCcd: rec.run, fleetState: LOG_ONLY }).log(SRC, LOG_ASK))
      .toEqual({ ok: false, failure: 'malformed-answer', why: 'pin' });
  });

  it('a ccd failure line is carried verbatim', async () => {
    const rec = recorder(res({ stdout: line({ v: 1, verb: 'docs-log', ok: false, elapsedMs: 2,
      failure: 'unknown-commit', detail: 'no such commit' }) }));
    expect(await ccdDocsReader({ runCcd: rec.run, fleetState: LOG_ONLY }).log(SRC, LOG_ASK))
      .toEqual({ ok: false, failure: 'unknown-commit', detail: 'no such commit' });
  });

  it("an answer over HISTORY_JOB's wire is malformed-answer {why:oversize}", async () => {
    const pad = 'x'.repeat(HISTORY_JOB.wire);
    const rec = recorder(res({ stdout: logLine({ pad }) }));
    expect(await ccdDocsReader({ runCcd: rec.run, fleetState: LOG_ONLY }).log(SRC, LOG_ASK))
      .toEqual({ ok: false, failure: 'malformed-answer', why: 'oversize' });
  });

  it('an answer of exactly the wire bound is within it', async () => {
    const base = Buffer.byteLength(logLine({ pad: '' }));
    const rec = recorder(res({ stdout: logLine({ pad: 'x'.repeat(HISTORY_JOB.wire - base) }) }));
    expect((await ccdDocsReader({ runCcd: rec.run, fleetState: LOG_ONLY }).log(SRC, LOG_ASK)).ok).toBe(true);
  });
});
