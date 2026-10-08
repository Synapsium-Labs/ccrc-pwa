/**
 * The Docs L3 adapter (`server/src/docs/ccdsource.ts`), driven through its two ports (spec 2026-10-01):
 * - section 2 (j) row 45 with section 7.10's M7.7: the tri-state cap gate, on EVERY port operation, each answer
 *   decided with zero execs;
 * - row 46: one case per `CcdResult` shape of section 2 (b)'s classification. Checks 1-7 are here; checks 8 and 9
 *   (show integrity and pins, the wire bound) and the second redaction pass are Task 7's cases, appended below;
 * - R14: the agent's refusal word and the client's timeout word are EXTRACTED from their own source and the adapter
 *   is driven with what was extracted, so a word renamed on either side reds this file.
 *
 * A recording `CcdRunner` double answers a scripted `CcdResult` and keeps every argv it was handed. No case runs
 * `ccd`: the three real-runner cases point `cfg.ccdBin` at a stub shell script in a `mkTmp` directory, or at a path
 * that does not exist.
 *
 * Inherited from W1's ledger, carried and not fixed here: MT-2 (ccd cuts stderr before it redacts, so the adapter
 * cannot recover a secret that cut split) and SEC-3 (an externally killed helper orphans git's process group; this
 * wave's lever is `docs-budget.test.ts`'s invariant).
 */
import { describe, it, expect, vi } from 'vitest';
import { chmodSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DOCS_CAP, type CcdArgv } from '../src/ccdargv.js';
import { ccdRunner, type CcdResult, type CcdRunner } from '../src/lifecycle.js';
import { UNMEASURED, realRunner } from '../src/exec.js';
import type { CcrcConfig } from '../src/config.js';
import { ccdDocsFetcher, ccdDocsReader, type CcdDocsDeps } from '../src/docs/ccdsource.js';
import { LISTING_JOB, docsShowPlan } from '../src/docs/policy.js';
import type { DocsShowAsk } from '../src/docs/ports.js';
import type { DocPin, DocsFailureBody } from '../../shared/docs.js';
import { mkTmp } from './tmpHelpers.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const U = UNMEASURED;

/** A recording runner: every argv it is handed, and one scripted answer for all of them. */
function recorder(answer: CcdResult): { run: CcdRunner; calls: string[][] } {
  const calls: string[][] = [];
  return { calls, run: async (argv: CcdArgv) => { calls.push([...argv]); return answer; } };
}
/** A measured, clean exit unless a case says otherwise. */
const res = (over: Partial<CcdResult>): CcdResult =>
  ({ ok: true, stdout: '', stderr: '', killed: false, signal: null, ...over });
const state = (ccdVerbs: string[] | null): { ccdVerbs: string[] | null } => ({ ccdVerbs });
const READY = state(['caps', DOCS_CAP]);
/** One answer line as ccd writes it: one JSON text and one LF. */
const line = (o: Record<string, unknown>): string => `${JSON.stringify(o)}\n`;
const sha256 = (b: Uint8Array): string => createHash('sha256').update(b).digest('hex');

const SHA = 'a'.repeat(40);
const TEXT = '# a\n';
const TEXT_BYTES = Buffer.from(TEXT, 'utf8');
const COMMITTED: DocPin = { kind: 'committed', commit: SHA, servedRef: 'refs/remotes/origin/main', section: 'specs', path: 'a.md' };
const DRAFT_FP = sha256(TEXT_BYTES);
const DRAFT: DocPin = { kind: 'draft', branch: 'ws/a', head: SHA, section: 'specs', path: 'a.md', fp: DRAFT_FP };
const PLAN = docsShowPlan('a.md', undefined);
const ASK: DocsShowAsk = { maxBytes: PLAN.maxBytes, job: PLAN.job, listedBlob: null };
const SRC = { node: 'n', project: 'demo' };

/** A valid show answer for `pin`, its size and sha256 measured over `TEXT`'s bytes, every echo matching the pin. */
function showOk(pin: DocPin, over: Record<string, unknown> = {}): Record<string, unknown> {
  const common = {
    v: 1, verb: 'docs-show', ok: true, elapsedMs: 3, section: pin.section, path: pin.path,
    size: TEXT_BYTES.length, sha256: sha256(TEXT_BYTES), encoding: 'utf8', text: TEXT,
  };
  return pin.kind === 'committed'
    ? { ...common, source: 'committed', commit: pin.commit, blob: 'c'.repeat(40), mode: '100644', onRef: 'contains', ...over }
    : { ...common, source: 'draft', worktree: '/w/a', branch: pin.branch, head: pin.head, fp: pin.fp, ...over };
}
const TREE_OK = { v: 1, verb: 'docs-tree', ok: true, elapsedMs: 4, project: 'demo' };

type Answer = { ok: boolean };
/** Every port operation, with the exact argv its builder must send. */
const OPS: readonly { name: string; call: (d: CcdDocsDeps) => Promise<Answer>; argv: readonly string[] }[] = [
  { name: 'index', call: (d) => ccdDocsReader(d).index({ node: 'n' }), argv: ['docs-index', '--all'] },
  {
    name: 'tree', call: (d) => ccdDocsReader(d).tree(SRC, { kind: 'bare', name: 'main' }),
    argv: ['docs-tree', '--project', 'demo', '--ref', 'main'],
  },
  {
    name: 'show committed', call: (d) => ccdDocsReader(d).show(SRC, COMMITTED, ASK),
    argv: ['docs-show', '--project', 'demo', '--commit', SHA, '--ref', 'refs/remotes/origin/main', '--section', 'specs',
      '--path', 'a.md', '--max-bytes', String(PLAN.maxBytes)],
  },
  {
    name: 'show draft', call: (d) => ccdDocsReader(d).show(SRC, DRAFT, ASK),
    argv: ['docs-show', '--project', 'demo', '--draft-branch', 'ws/a', '--head', SHA, '--section', 'specs',
      '--path', 'a.md', '--fingerprint', DRAFT_FP, '--max-bytes', String(PLAN.maxBytes)],
  },
  { name: 'fetch', call: (d) => ccdDocsFetcher(d).fetch(SRC, 'main'), argv: ['docs-fetch', '--project', 'demo', '--branch', 'main'] },
];

/** One tree call through a recorder answering `answer`. */
async function treeWith(answer: CcdResult): Promise<Answer> {
  return ccdDocsReader({ runCcd: recorder(answer).run, fleetState: READY }).tree(SRC, null);
}

describe('the cap gate, before any exec (row 45, M7.7, spec section 2 (a) and section 7.1)', () => {
  const GATE: readonly (readonly [string, CcdDocsDeps['fleetState'], 'caps-unknown' | 'unsupported'])[] = [
    ['no fleet state at all', undefined, 'caps-unknown'],
    ['ccdVerbs null (not handshaken)', state(null), 'caps-unknown'],
    ["[] (the agent's failed boot read, seeded ?? [])", state([]), 'caps-unknown'],
    ["['x'] (a list that lacks caps measured nothing)", state(['x']), 'caps-unknown'],
    ["['caps'] (a measured pre-Docs ccd)", state(['caps']), 'unsupported'],
    ['the four verb names without docs-v1', state(['caps', 'docs-index', 'docs-tree', 'docs-show', 'docs-fetch']), 'unsupported'],
  ];
  const CASES = OPS.flatMap((op) => GATE.map(([label, fleetState, want]) => [op.name, label, want, op, fleetState] as const));

  it.each(CASES)('%s, %s: %s with zero execs', async (_name, _label, want, op, fleetState) => {
    const rec = recorder(res({ stdout: line(TREE_OK) }));
    expect(await op.call({ runCcd: rec.run, fleetState })).toEqual({ ok: false, failure: want });
    expect(rec.calls).toEqual([]);
  });

  it.each(OPS)('$name: with docs-v1 advertised, exactly one exec, with the builder\'s argv', async (op) => {
    const rec = recorder(res({ ok: false, stderr: 'usage' }));
    await op.call({ runCcd: rec.run, fleetState: READY });
    expect(rec.calls).toEqual([op.argv]);
  });

  it('the default-view tree sends no --ref, and the default-branch fetch no --branch', async () => {
    const rec = recorder(res({ ok: false, stderr: 'usage' }));
    await ccdDocsReader({ runCcd: rec.run, fleetState: READY }).tree(SRC, null);
    await ccdDocsFetcher({ runCcd: rec.run, fleetState: READY }).fetch(SRC, null);
    expect(rec.calls).toEqual([['docs-tree', '--project', 'demo'], ['docs-fetch', '--project', 'demo']]);
  });
});

/** The word the agent refuses an ungranted argv with: the `fail(req.id, '<w>')` on its one `isExecAllowed(` line. */
function agentRefusalWord(): string {
  const src = readFileSync(path.join(ROOT, 'agent/src/server.ts'), 'utf8');
  const words = src.split('\n').filter((l) => l.includes('isExecAllowed('))
    .flatMap((l) => [...l.matchAll(/fail\(req\.id, '([a-z-]+)'\)/g)].map((m) => m[1]!));
  expect(words, "agent/src/server.ts: one fail(req.id, '<w>') on the isExecAllowed( line").toHaveLength(1);
  return words[0]!;
}

/** The word the client's own request wait rejects with: the `reject(new Error('<w>'))` inside its one timer. */
function clientTimeoutWord(): string {
  const src = readFileSync(path.join(ROOT, 'server/src/remote/client.ts'), 'utf8');
  const words = [...src.matchAll(/const timer = setTimeout\(\(\) => \{[^}]*?reject\(new Error\('([a-z-]+)'\)\);/g)]
    .map((m) => m[1]!);
  expect(words, "server/src/remote/client.ts: one reject(new Error('<w>')) in the request timer").toHaveLength(1);
  return words[0]!;
}

describe('check 1: the transport catch, both halves unmeasured (row 46, R14)', () => {
  const transport = (stderr: string): CcdResult => ({ ok: false, stdout: '', stderr, killed: U, signal: U });

  it("the agent's own refusal word is not-granted, after exactly one exec (section 7.1, C3)", async () => {
    const rec = recorder(transport(agentRefusalWord()));
    expect(await ccdDocsReader({ runCcd: rec.run, fleetState: READY }).tree(SRC, null))
      .toEqual({ ok: false, failure: 'not-granted' });
    expect(rec.calls).toHaveLength(1);
  });

  it("the client's own wait word is link-timeout", async () => {
    expect(await treeWith(transport(clientTimeoutWord()))).toEqual({ ok: false, failure: 'link-timeout' });
  });

  it('any other transport message is link-failed, carrying it as cause', async () => {
    expect(await treeWith(transport('disconnected'))).toEqual({ ok: false, failure: 'link-failed', cause: 'disconnected' });
  });

  it('the cause is cut to 512 bytes (refinement (f): redacted and cut the same way as stderr)', async () => {
    expect(await treeWith(transport('x'.repeat(2048)))).toEqual({ ok: false, failure: 'link-failed', cause: 'x'.repeat(512) });
  });

  it('the cause is redacted', async () => {
    expect(await treeWith(transport('connect https://u:tok@example.invalid/x')))
      .toEqual({ ok: false, failure: 'link-failed', cause: 'connect https://***@example.invalid/x' });
  });

  it('an OK answer whose halves are unmeasured (an older agent) is parsed, not read as a transport failure', async () => {
    expect(await treeWith({ ok: true, stdout: line(TREE_OK), stderr: '', killed: U, signal: U }))
      .toEqual({ ok: true, answer: TREE_OK });
    expect(await treeWith({ ok: true, stdout: '', stderr: '', killed: U, signal: U }))
      .toEqual({ ok: false, failure: 'malformed-answer', why: 'parse' });
  });

  it('a NOT-ok answer with stdout and unmeasured halves is a cut answer, not a transport failure', async () => {
    expect(await treeWith({ ok: false, stdout: 'partial', stderr: '', killed: U, signal: U }))
      .toEqual({ ok: false, failure: 'answer-overflow' });
  });
});

describe('checks 2-5: how ccd ended (row 46)', () => {
  it('the runner deadline fired: ccd-timeout', async () => {
    expect(await treeWith(res({ ok: false, killed: true, signal: 'SIGTERM' }))).toEqual({ ok: false, failure: 'ccd-timeout' });
  });

  it('a measured signal without the deadline: ccd-killed {signal}', async () => {
    expect(await treeWith(res({ ok: false, killed: false, signal: 'SIGKILL' })))
      .toEqual({ ok: false, failure: 'ccd-killed', signal: 'SIGKILL' });
  });

  it('not ok with stdout (a cut answer): answer-overflow', async () => {
    expect(await treeWith(res({ ok: false, stdout: 'partial' }))).toEqual({ ok: false, failure: 'answer-overflow' });
  });

  it("not ok, empty stdout: ccd-fault {stderrHead}, and no code (CcdResult carries none)", async () => {
    const out = await treeWith(res({ ok: false, stderr: 'usage: ccd docs-tree --project P [--ref R]' }));
    expect(out).toEqual({ ok: false, failure: 'ccd-fault', stderrHead: 'usage: ccd docs-tree --project P [--ref R]' });
    expect(out).not.toHaveProperty('code');
  });

  it('stderrHead is at most 512 bytes, cut back to a UTF-8 boundary', async () => {
    const stderr = `${'x'.repeat(511)}€${'y'.repeat(3486)}`; // the euro sign's 3 bytes sit at offsets 511-513
    expect(Buffer.byteLength(stderr)).toBe(4000);
    const out = (await treeWith(res({ ok: false, stderr }))) as DocsFailureBody;
    expect(out.failure).toBe('ccd-fault');
    expect(out.stderrHead).toBe('x'.repeat(511));
    expect(Buffer.byteLength(out.stderrHead!)).toBeLessThanOrEqual(512);
  });

  it('stderr is redacted BEFORE it is cut, so a secret straddling the cut leaves no fragment', async () => {
    const stderr = `${'e'.repeat(500)} https://u:${'k'.repeat(40)}@example.invalid/x`;
    const out = (await treeWith(res({ ok: false, stderr }))) as DocsFailureBody;
    expect(out.stderrHead).toBe(`${'e'.repeat(500)} https://***`);
    expect(out.stderrHead).not.toContain('u:k');
  });
});

describe('check 6: exactly one JSON line, with the envelope (row 46)', () => {
  const ROWS: readonly (readonly [string, 'parse' | 'schema', string])[] = [
    ['an empty stdout', 'parse', ''],
    ['not JSON', 'parse', 'not json\n'],
    ['two lines', 'parse', line(TREE_OK) + line(TREE_OK)],
    ['no trailing LF', 'parse', JSON.stringify(TREE_OK)],
    ['a blank second line', 'parse', `${line(TREE_OK)} \n`],
    ['an array', 'schema', '[]\n'],
    ['JSON null', 'schema', 'null\n'],
    ['v 2', 'schema', line({ ...TREE_OK, v: 2 })],
    ["verb 'docs-show' answering a tree call", 'schema', line({ ...TREE_OK, verb: 'docs-show' })],
    ["ok 'yes' beside a ccd word", 'schema', line({ v: 1, verb: 'docs-tree', ok: 'yes', elapsedMs: 1, failure: 'git-failed' })],
    ['ok:false without a failure word', 'schema', line({ v: 1, verb: 'docs-tree', ok: false, elapsedMs: 1 })],
  ];

  it.each(ROWS)('%s: malformed-answer {why: %s}', async (_label, why, stdout) => {
    expect(await treeWith(res({ stdout }))).toEqual({ ok: false, failure: 'malformed-answer', why });
  });
});

describe('check 7 and the verbatim rebuild (row 46, refinement (j))', () => {
  const failLine = (verb: string, failure: string, ctx: Record<string, unknown> = {}): string =>
    line({ v: 1, verb, ok: false, elapsedMs: 9, failure, ...ctx });

  it('a word outside the vocabulary is unknown-failure {word}, never mapped onto a known word', async () => {
    expect(await treeWith(res({ stdout: failLine('docs-tree', 'no-such-word') })))
      .toEqual({ ok: false, failure: 'unknown-failure', word: 'no-such-word' });
  });

  it('a SERVER-only word sent by ccd is unknown-failure too', async () => {
    expect(await treeWith(res({ stdout: failLine('docs-tree', 'docs-busy', { lane: 'read' }) })))
      .toEqual({ ok: false, failure: 'unknown-failure', word: 'docs-busy' });
  });

  it('the word is redacted, then cut to 512 bytes: a 2 KiB word, and a secret straddling the cut', async () => {
    expect(await treeWith(res({ stdout: failLine('docs-tree', 'w'.repeat(2048)) })))
      .toEqual({ ok: false, failure: 'unknown-failure', word: 'w'.repeat(512) });
    const straddling = `${'w'.repeat(500)} https://u:${'k'.repeat(40)}@example.invalid/x`;
    expect(await treeWith(res({ stdout: failLine('docs-tree', straddling) })))
      .toEqual({ ok: false, failure: 'unknown-failure', word: `${'w'.repeat(500)} https://***` });
  });

  it('a ccd word keeps exactly its line, minus v, verb and elapsedMs', async () => {
    const ctx = { detail: 'no such ref', tried: [{ ref: 'refs/heads/b', result: 'absent' }], suggest: 'main' };
    expect(await treeWith(res({ stdout: failLine('docs-tree', 'unresolved-ref', ctx) })))
      .toEqual({ ok: false, failure: 'unresolved-ref', ...ctx });
  });

  it.each([
    ['absent (unmeasured)', {}],
    ['null (the lock already went)', { lockAgeMs: null }],
    ['a number (its age)', { lockAgeMs: 1200 }],
  ] as const)('ref-locked with lockAgeMs %s keeps that state (D-4158)', async (_label, ctx) => {
    const rec = recorder(res({ stdout: failLine('docs-fetch', 'ref-locked', ctx) }));
    const out = await ccdDocsFetcher({ runCcd: rec.run, fleetState: READY }).fetch(SRC, null);
    expect(out).toStrictEqual({ ok: false, failure: 'ref-locked', ...ctx });
  });

  it('linked-worktree with branch null keeps null (contract F4: detached OR unmeasured)', async () => {
    expect(await treeWith(res({ stdout: failLine('docs-tree', 'linked-worktree', { owner: '/w/a', branch: null }) })))
      .toStrictEqual({ ok: false, failure: 'linked-worktree', owner: '/w/a', branch: null });
  });

  // The partial-clone word pair (W1 ledger): a commit missing from a partial clone answers `git-failed {step:'cat-file'}`
  // on git 2.43 and `unknown-commit` on git 2.55. Both are carried verbatim and neither is mapped onto the other.
  it.each([
    ['git-failed {step: cat-file, rc: 128} (git 2.43)', 'git-failed', { step: 'cat-file', rc: 128 }],
    ['unknown-commit (git 2.55)', 'unknown-commit', {}],
  ] as const)('a show failure line %s is carried verbatim, its word never mapped', async (_label, failure, ctx) => {
    expect(await showRaw(COMMITTED, failLine('docs-show', failure, ctx)))
      .toStrictEqual({ ok: false, failure, ...ctx });
  });

  it('an ok index keeps unwalked absent when ccd sent none, and 3 when it sent 3 (D-4157)', async () => {
    const index = { v: 1, verb: 'docs-index', ok: true, elapsedMs: 5, unlisted: 0, duplicates: [], projects: [] };
    const indexWith = async (stdout: string): Promise<Answer> =>
      ccdDocsReader({ runCcd: recorder(res({ stdout })).run, fleetState: READY }).index({ node: 'n' });
    expect(await indexWith(line(index))).toStrictEqual({ ok: true, answer: index });
    expect(await indexWith(line({ ...index, unwalked: 3 }))).toStrictEqual({ ok: true, answer: { ...index, unwalked: 3 } });
  });
});

describe('show: the answer and its decoded bytes (integrity, pins and size are Task 7\'s)', () => {
  const showWith = async (pin: DocPin, answer: Record<string, unknown>): Promise<Answer> =>
    ccdDocsReader({ runCcd: recorder(res({ stdout: line(answer) })).run, fleetState: READY }).show(SRC, pin, ASK);

  it('a committed utf8 answer carries the answer and the UTF-8 of its text', async () => {
    const answer = showOk(COMMITTED);
    expect(await showWith(COMMITTED, answer)).toEqual({ ok: true, answer, bytes: TEXT_BYTES });
  });

  it('a draft base64 answer carries the decoded bytes', async () => {
    const answer = showOk(DRAFT, { encoding: 'base64', b64: TEXT_BYTES.toString('base64') });
    delete answer.text;
    expect(await showWith(DRAFT, answer)).toEqual({ ok: true, answer, bytes: TEXT_BYTES });
  });

  it.each([
    ['utf8 carrying b64 instead of text', { text: undefined, b64: TEXT_BYTES.toString('base64') }],
    ["encoding 'hex'", { encoding: 'hex' }],
    ['base64 carrying text but no b64', { encoding: 'base64' }],
  ] as const)('%s: malformed-answer {why: schema}', async (_label, over) => {
    expect(await showWith(COMMITTED, showOk(COMMITTED, over))).toEqual({ ok: false, failure: 'malformed-answer', why: 'schema' });
  });
});

describe('the real local runner, measured on this node (row 46, Q4)', () => {
  /** A stub script in a fresh tmp dir, as the ccdBin of a real `ccdRunner(realRunner, ...)`. Never ccd. */
  function stubReader(body: string | null): ReturnType<typeof ccdDocsReader> {
    const dir = mkTmp('docs-source-');
    const bin = path.join(dir, body === null ? 'absent' : 'stub');
    if (body !== null) {
      writeFileSync(bin, `#!/bin/sh\n${body}\n`);
      chmodSync(bin, 0o755);
    }
    return ccdDocsReader({ runCcd: ccdRunner(realRunner, { ccdBin: bin } as CcrcConfig), fleetState: READY });
  }

  it('a 9 MiB stdout past the 8 MiB exec buffer is answer-overflow (check 4)', async () => {
    expect(await stubReader("head -c 9437184 /dev/zero | tr '\\000' x\nexit 0").tree(SRC, null))
      .toEqual({ ok: false, failure: 'answer-overflow' });
  });

  it("a usage line on stderr and exit 1 is ccd-fault {stderrHead} (an old ccd's answer)", async () => {
    expect(await stubReader("echo 'usage: ccd docs-tree --project P [--ref R]' >&2\nexit 1").tree(SRC, null))
      .toEqual({ ok: false, failure: 'ccd-fault', stderrHead: 'usage: ccd docs-tree --project P [--ref R]\n' });
  });

  it('a ccdBin that does not exist is ccd-fault', async () => {
    const out = (await stubReader(null).tree(SRC, null)) as DocsFailureBody;
    expect(out.failure).toBe('ccd-fault');
  });
});

// ---- Task 7: check 8 (show integrity and pins), check 9 (the wire bound), the second redaction pass ----

/** One show call through a recorder answering `stdout` verbatim, with `ask` (default `ASK`). */
async function showRaw(pin: DocPin, stdout: string, ask: DocsShowAsk = ASK): Promise<Answer> {
  return ccdDocsReader({ runCcd: recorder(res({ stdout })).run, fleetState: READY }).show(SRC, pin, ask);
}
/** The body `malformed-answer {why}`. */
const malformed = (why: string): Answer => ({ ok: false, failure: 'malformed-answer', why } as Answer);
/** A base64 show answer for `pin`: `showOk`'s fields, with `b64` in place of `text`. */
function b64Ok(pin: DocPin, b64: string, over: Record<string, unknown> = {}): Record<string, unknown> {
  const answer = showOk(pin, { encoding: 'base64', b64, ...over });
  delete answer.text;
  return answer;
}
const B64 = TEXT_BYTES.toString('base64'); // 'IyBhCg==': canonical, with two padding characters

describe('check 8: show integrity, pins and onRef (row 46, spec section 2 (b))', () => {
  /** A draft pin whose fp is not the sha256 of `TEXT`'s bytes. */
  const DRAFT_F: DocPin = { kind: 'draft', branch: 'ws/a', head: SHA, section: 'specs', path: 'a.md', fp: 'f'.repeat(64) };

  it('a canonical base64 committed answer is ok, carrying its decoded bytes', async () => {
    const answer = b64Ok(COMMITTED, B64);
    expect(await showRaw(COMMITTED, line(answer))).toEqual({ ok: true, answer, bytes: TEXT_BYTES });
  });

  const ROWS: readonly (readonly [string, DocPin, Record<string, unknown>, 'integrity' | 'pin' | 'schema'])[] = [
    ['a tampered sha256', COMMITTED, showOk(COMMITTED, { sha256: 'b'.repeat(64) }), 'integrity'],
    ['a size one over the bytes', COMMITTED, showOk(COMMITTED, { size: TEXT_BYTES.length + 1 }), 'integrity'],
    ['a size one under the bytes', DRAFT, showOk(DRAFT, { size: TEXT_BYTES.length - 1 }), 'integrity'],
    ['base64 without its padding', COMMITTED, b64Ok(COMMITTED, B64.replace(/=+$/, '')), 'integrity'],
    ['base64 with a stray character', COMMITTED, b64Ok(COMMITTED, `${B64.slice(0, 4)}*${B64.slice(4)}`), 'integrity'],
    ['base64 with stray bits in its last character', COMMITTED, b64Ok(COMMITTED, B64.replace('Cg==', 'Ch==')), 'integrity'],
    ['a commit that is not the pin', COMMITTED, showOk(COMMITTED, { commit: 'b'.repeat(40) }), 'pin'],
    ['a section that is not the pin', COMMITTED, showOk(COMMITTED, { section: 'plans' }), 'pin'],
    ['a path that is not the pin', COMMITTED, showOk(COMMITTED, { path: 'b.md' }), 'pin'],
    ["source 'draft' answering a committed pin", COMMITTED, showOk(COMMITTED, { source: 'draft' }), 'pin'],
    ["source 'committed' answering a draft pin", DRAFT, showOk(DRAFT, { source: 'committed' }), 'pin'],
    ['a draft branch that is not the pin', DRAFT, showOk(DRAFT, { branch: 'ws/b' }), 'pin'],
    ['a draft head that is not the pin', DRAFT, showOk(DRAFT, { head: 'b'.repeat(40) }), 'pin'],
    ['a draft fp that is its sha256 but not the pin', DRAFT_F, showOk(DRAFT_F, { fp: DRAFT_FP }), 'pin'],
    ['a committed answer without onRef', COMMITTED, showOk(COMMITTED, { onRef: undefined }), 'schema'],
    ["a committed answer with onRef 'maybe'", COMMITTED, showOk(COMMITTED, { onRef: 'maybe' }), 'schema'],
    // The own-key guard (`Object.hasOwn`): an inherited name is no word. `in` would accept all three.
    ["onRef 'toString' (inherited from Object.prototype)", COMMITTED, showOk(COMMITTED, { onRef: 'toString' }), 'schema'],
    ["onRef 'constructor' (inherited from Object.prototype)", COMMITTED, showOk(COMMITTED, { onRef: 'constructor' }), 'schema'],
    // JSON.parse defines `__proto__` as an OWN key, as a real answer line's would arrive.
    ["onRef '__proto__'", COMMITTED, JSON.parse(line(showOk(COMMITTED, { onRef: '__proto__' }))) as Record<string, unknown>, 'schema'],
    // Integrity is decided before the pin echo: a tampered sha256 AND a wrong path echo is integrity.
    ['a tampered sha256 and a wrong path echo at once', COMMITTED, showOk(COMMITTED, { sha256: 'b'.repeat(64), path: 'b.md' }), 'integrity'],
  ];

  it.each(ROWS)('%s: malformed-answer {why}', async (_label, pin, answer, why) => {
    expect(await showRaw(pin, line(answer))).toEqual(malformed(why));
  });

  it('a draft whose fp echoes its pin but is not its sha256: pin', async () => {
    expect(await showRaw(DRAFT_F, line(showOk(DRAFT_F)))).toEqual(malformed('pin'));
  });

  it("a committed blob is held to the listing's when the server holds one, and to nothing when it holds none", async () => {
    const answer = showOk(COMMITTED); // blob 'c' x 40
    expect(await showRaw(COMMITTED, line(answer), { ...ASK, listedBlob: 'b'.repeat(40) })).toEqual(malformed('pin'));
    expect(await showRaw(COMMITTED, line(answer), { ...ASK, listedBlob: 'c'.repeat(40) }))
      .toEqual({ ok: true, answer, bytes: TEXT_BYTES });
    expect(await showRaw(COMMITTED, line(answer), { ...ASK, listedBlob: null }))
      .toEqual({ ok: true, answer, bytes: TEXT_BYTES });
  });

  it.each(['contains', 'not-contained', 'unmeasured'])("onRef '%s' is ok", async (onRef) => {
    const answer = showOk(COMMITTED, { onRef });
    expect(await showRaw(COMMITTED, line(answer))).toEqual({ ok: true, answer, bytes: TEXT_BYTES });
  });

  // Docs W2 fix round 1, F1: the onRef test is type-checked. Each answer is a real ccd LINE (JSON text), so the value
  // arrives as a real answer's would; a coerced key (`['contains']` -> 'contains') or a throwing one is a defect.
  it('onRef as an array holding a word is schema, not ok (the key is not coerced)', async () => {
    expect(await showRaw(COMMITTED, line(showOk(COMMITTED, { onRef: ['contains'] })))).toEqual(malformed('schema'));
  });

  it('onRef as an object with a toString key is schema, and show() resolves (the promise rejects only on a defect)', async () => {
    const out = showRaw(COMMITTED, line(showOk(COMMITTED, { onRef: { toString: 1 } })));
    await expect(out).resolves.toEqual(malformed('schema'));
  });
});

/** `console.warn` spied and silenced for one call: the call's answer and every warn call's arguments. */
async function watchingWarn(run: () => Promise<Answer>): Promise<{ out: Answer; warned: unknown[][] }> {
  const spy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  try {
    const out = await run();
    return { out, warned: spy.mock.calls.map((args) => [...args]) };
  } finally {
    spy.mockRestore();
  }
}

/** `o` as one answer line of exactly `bytes` bytes, padded through a `pad` key (ccd's keys ride through verbatim). */
function lineOf(o: Record<string, unknown>, bytes: number): string {
  const bare = Buffer.byteLength(line({ ...o, pad: '' }));
  const out = line({ ...o, pad: 'x'.repeat(bytes - bare) });
  expect(Buffer.byteLength(out)).toBe(bytes);
  return out;
}

describe("check 9: the job's declared wire bound (row 46, M6.5, spec section 6.2)", () => {
  const WARN = 'ccrc-server: docs answer over its declared bound';
  const INDEX_OK = { v: 1, verb: 'docs-index', ok: true, elapsedMs: 5, unlisted: 0, duplicates: [], projects: [] };
  const FETCH_OK = {
    v: 1, verb: 'docs-fetch', ok: true, elapsedMs: 7, branch: 'main', trackedRef: 'refs/remotes/origin/main',
    defaultVia: 'origin/HEAD', before: null, after: SHA, moved: 'unchanged', stamp: 'written',
  };
  const runWith = (stdout: string): CcdDocsDeps => ({ runCcd: recorder(res({ stdout })).run, fleetState: READY });
  const LISTINGS: readonly (readonly [string, Record<string, unknown>, (d: CcdDocsDeps) => Promise<Answer>])[] = [
    ['index', INDEX_OK, (d) => ccdDocsReader(d).index({ node: 'n' })],
    ['tree', TREE_OK, (d) => ccdDocsReader(d).tree(SRC, null)],
    ['fetch', FETCH_OK, (d) => ccdDocsFetcher(d).fetch(SRC, null)],
  ];

  it('a show answer of exactly ask.job.wire bytes passes; one byte over is oversize, logged once', async () => {
    const answer = showOk(COMMITTED);
    const stdout = line(answer);
    const wire = (n: number): DocsShowAsk => ({ ...ASK, job: { raw: PLAN.job.raw, wire: n } });
    const at = await watchingWarn(() => showRaw(COMMITTED, stdout, wire(Buffer.byteLength(stdout))));
    expect(at.out).toEqual({ ok: true, answer, bytes: TEXT_BYTES });
    expect(at.warned).toEqual([]);
    const over = await watchingWarn(() => showRaw(COMMITTED, stdout, wire(Buffer.byteLength(stdout) - 1)));
    expect(over.out).toEqual(malformed('oversize'));
    expect(over.warned).toEqual([[WARN]]);
  });

  it.each(LISTINGS)('%s: an ok answer of exactly LISTING_JOB.wire bytes passes; one byte over is oversize, logged once',
    async (_name, ok, call) => {
      const at = await watchingWarn(() => call(runWith(lineOf(ok, LISTING_JOB.wire))));
      expect(at.out.ok).toBe(true);
      expect(at.warned).toEqual([]);
      const over = await watchingWarn(() => call(runWith(lineOf(ok, LISTING_JOB.wire + 1))));
      expect(over.out).toEqual(malformed('oversize'));
      expect(over.warned).toEqual([[WARN]]);
    });

  it('a ccd failure line one byte over the bound is oversize too; at the bound it is carried', async () => {
    const failure = { v: 1, verb: 'docs-tree', ok: false, elapsedMs: 9, failure: 'git-failed', step: 'cat-file', rc: 128 };
    const at = await watchingWarn(() => treeWith(res({ stdout: lineOf(failure, LISTING_JOB.wire) })));
    expect((at.out as DocsFailureBody).failure).toBe('git-failed');
    expect(at.warned).toEqual([]);
    const over = await watchingWarn(() => treeWith(res({ stdout: lineOf(failure, LISTING_JOB.wire + 1) })));
    expect(over.out).toEqual(malformed('oversize'));
    expect(over.warned).toEqual([[WARN]]);
  });

  it('check 8 wins over check 9: a tampered sha256 one byte over its bound is integrity, and nothing is logged', async () => {
    const stdout = line(showOk(COMMITTED, { sha256: 'b'.repeat(64) }));
    const ask: DocsShowAsk = { ...ASK, job: { raw: PLAN.job.raw, wire: Buffer.byteLength(stdout) - 1 } };
    const out = await watchingWarn(() => showRaw(COMMITTED, stdout, ask));
    expect(out.out).toEqual(malformed('integrity'));
    expect(out.warned).toEqual([]);
  });

  it('check 7 wins over check 9: an unknown word over the bound stays unknown-failure, and nothing is logged', async () => {
    const unknown = { v: 1, verb: 'docs-tree', ok: false, elapsedMs: 9, failure: 'no-such-word' };
    const out = await watchingWarn(() => treeWith(res({ stdout: lineOf(unknown, LISTING_JOB.wire + 1) })));
    expect(out.out).toEqual({ ok: false, failure: 'unknown-failure', word: 'no-such-word' });
    expect(out.warned).toEqual([]);
  });
});

describe('the second redaction pass: every string leaf of a failure body but failure (row 62, L3 half)', () => {
  const failLine = (verb: string, failure: string, ctx: Record<string, unknown>): string =>
    line({ v: 1, verb, ok: false, elapsedMs: 9, failure, ...ctx });
  /** One call of the port operation that runs `verb`, through a recorder answering `stdout`. */
  const callVerb = (verb: string, stdout: string): Promise<Answer> => {
    const deps: CcdDocsDeps = { runCcd: recorder(res({ stdout })).run, fleetState: READY };
    if (verb === 'docs-fetch') return ccdDocsFetcher(deps).fetch(SRC, null);
    if (verb === 'docs-show') return ccdDocsReader(deps).show(SRC, COMMITTED, ASK);
    return ccdDocsReader(deps).tree(SRC, null);
  };
  const TOKEN = `gho_${'A'.repeat(24)}`;

  const PLANTED: readonly (readonly [string, string, string, Record<string, unknown>, Record<string, unknown>])[] = [
    ['git-failed, in stderrHead and detail', 'docs-tree', 'git-failed',
      { step: 'cat-file', rc: 128, stderrHead: 'fatal: https://u:tok@example.invalid/x', detail: 'GET /?access_token=abc&x=1' },
      { step: 'cat-file', rc: 128, stderrHead: 'fatal: https://***@example.invalid/x', detail: 'GET /?access_token=***&x=1' }],
    ['fetch-transport, an Authorization line in detail', 'docs-fetch', 'fetch-transport',
      { detail: 'fetching\nAuthorization: Bearer x\ndone' },
      { detail: 'fetching\nAuthorization: ***\ndone' }],
    ['linked-worktree, a gho_ token in owner', 'docs-tree', 'linked-worktree',
      { owner: `/w/${TOKEN}`, branch: 'main' },
      { owner: '/w/gho_***', branch: 'main' }],
    ['ambiguous-worktree, a token inside a candidates entry', 'docs-show', 'ambiguous-worktree',
      { candidates: ['/w/a?token=abc', '/w/b'] },
      { candidates: ['/w/a?token=***', '/w/b'] }],
    ['unresolved-ref, a token inside a tried entry', 'docs-tree', 'unresolved-ref',
      { tried: [{ ref: 'refs/heads/a?token=abc', result: 'absent' }], suggest: 'main' },
      { tried: [{ ref: 'refs/heads/a?token=***', result: 'absent' }], suggest: 'main' }],
  ];

  it.each(PLANTED)('a planted unredacted ccd line, %s: redacted, failure untouched', async (_label, verb, failure, sent, want) => {
    expect(await callVerb(verb, failLine(verb, failure, sent))).toStrictEqual({ ok: false, failure, ...want });
  });

  it('a server-made body carrying an untrusted string is redacted: unknown-failure {word}', async () => {
    expect(await treeWith(res({ stdout: failLine('docs-tree', 'x?token=abc', {}) })))
      .toStrictEqual({ ok: false, failure: 'unknown-failure', word: 'x?token=***' });
  });

  it('idempotent: a line ccd already redacted comes back unchanged', async () => {
    const ctx = {
      step: 'fetch', rc: 128, stderrHead: 'fatal: https://***@example.invalid/x',
      detail: 'GET /?access_token=***&x=1\nAuthorization: ***', owner: '/w/gho_***',
    };
    expect(await treeWith(res({ stdout: failLine('docs-tree', 'git-failed', ctx) })))
      .toStrictEqual({ ok: false, failure: 'git-failed', ...ctx });
  });

  it('an ok answer is never rewritten: a tree entry path holding ?token=abc comes back as ccd sent it', async () => {
    const tree = { ...TREE_OK, entries: [{ path: 'a?token=abc.md' }] };
    expect(await treeWith(res({ stdout: line(tree) }))).toStrictEqual({ ok: true, answer: tree });
  });
});

describe('the second redaction pass bounds its depth (final-review I1)', () => {
  const nested = (depth: number, leaf = '"s"'): string => `${'['.repeat(depth)}${leaf}${']'.repeat(depth)}`;
  /** A known-word failure line carrying `x` as the raw JSON text `rawX`, ccd's real body shape. */
  const failWith = (rawX: string): string =>
    `{"v":1,"verb":"docs-tree","ok":false,"elapsedMs":1,"failure":"git-failed","step":"cat-file","x":${rawX}}\n`;

  it('a known-word failure line nested 10 000 deep answers malformed-answer {why: schema} and does not reject', async () => {
    const out = await treeWith(res({ stdout: failWith(nested(10_000)) }));
    expect(out).toStrictEqual({ ok: false, failure: 'malformed-answer', why: 'schema' });
  });

  it('the deepest legitimate context is carried: tried[i].ref, redacted, and a leaf at depth 8 (the bound)', async () => {
    const tried = [{ ref: 'refs/heads/a?token=abc', result: 'absent' }];
    expect(await treeWith(res({ stdout: line({ v: 1, verb: 'docs-tree', ok: false, elapsedMs: 1, failure: 'git-failed', tried }) })))
      .toStrictEqual({ ok: false, failure: 'git-failed', tried: [{ ref: 'refs/heads/a?token=***', result: 'absent' }] });
    // the string sits at depth 8: seven arrays under the key
    expect(await treeWith(res({ stdout: failWith(nested(7, '"a?token=abc"')) })))
      .toStrictEqual({ ok: false, failure: 'git-failed', step: 'cat-file', x: [[[[[[['a?token=***']]]]]]] });
  });

  it('one level past the bound is the schema word, not a carried body', async () => {
    expect(await treeWith(res({ stdout: failWith(nested(8, '"a?token=abc"')) })))
      .toStrictEqual({ ok: false, failure: 'malformed-answer', why: 'schema' });
  });
});

// ---- Docs W2 fix round 1, F2: refinement (g)'s one reader of `killed` and `signal`, as a mechanism ----

/** Whether a `/` met in code, with `before` the current line so far (comments and literals already blanked), starts a
 *  regex literal rather than a division: after `(`, `,`, `=`, `:`, `[`, `!`, `&`, `|`, `?`, `{`, `}`, `;`, an operator
 *  that cannot end an operand, a keyword that precedes an expression (`return`, `typeof`, ...), or at line start. */
function startsRegex(before: string): boolean {
  const b = before.trimEnd();
  if (b === '') return true;
  const last = b[b.length - 1]!;
  if ('(,=:[!&|?{};'.includes(last)) return true;
  if ('<>+-*%~^'.includes(last)) return !/(?:\+\+|--)$/.test(b);
  return /(?:^|[^\w$.])(?:return|typeof|void|throw|case|delete|in|of|else|yield|await)$/.test(b);
}

/**
 * Source with comments and the insides of '...', "..." and `...` literals and /regex/ literals blanked, newlines kept
 * so a line number and every offset survive. Three states beyond the line and block comments:
 *  - a template literal blanks its text but keeps each `${...}` expression AS CODE (`${res.killed}` is a real read),
 *    counting braces so `${ {a: 1}.a }` ends at its own `}`, and entering the template state again for a template
 *    nested in an expression;
 *  - a regex literal starts where a `/` cannot be division ({@link startsRegex}), and ends at its own unescaped `/`
 *    outside a `[...]` class, so a `/*`, `//` or quote inside one opens nothing;
 *  - a '...' or "..." string ends at its quote or its line.
 */
function blankCommentsAndStrings(text: string): string {
  const blank = (ch: string): string => (ch === '\n' ? '\n' : ' ');
  const braces: number[] = [];
  let template = false;
  let out = '';
  let i = 0;
  while (i < text.length) {
    const c = text[i]!;
    if (template) {
      if (c === '\\') {
        out += ' '; i++;
        if (i < text.length) { out += blank(text[i]!); i++; }
      } else if (c === '`') {
        out += c; i++; template = false;
      } else if (c === '$' && text[i + 1] === '{') {
        out += '${'; i += 2; braces.push(0); template = false;
      } else { out += blank(c); i++; }
      continue;
    }
    const two = text.slice(i, i + 2);
    if (two === '//') {
      while (i < text.length && text[i] !== '\n') { out += ' '; i++; }
    } else if (two === '/*') {
      const end = text.indexOf('*/', i + 2);
      const stop = end === -1 ? text.length : end + 2;
      for (; i < stop; i++) out += blank(text[i]!);
    } else if (c === '`') {
      out += c; i++; template = true;
    } else if (c === "'" || c === '"') {
      out += c; i++;
      while (i < text.length && text[i] !== c && text[i] !== '\n') {
        if (text[i] === '\\') { out += ' '; i++; }
        out += ' '; i++;
      }
      if (i < text.length && text[i] === c) { out += c; i++; }
    } else if (c === '/' && startsRegex(out.slice(out.lastIndexOf('\n') + 1))) {
      out += c; i++;
      let inClass = false;
      while (i < text.length && text[i] !== '\n') {
        const r = text[i]!;
        if (r === '\\') {
          out += ' '; i++;
          if (i < text.length && text[i] !== '\n') { out += ' '; i++; }
        } else if (!inClass && r === '/') {
          out += r; i++;
          break;
        } else {
          if (r === '[') inClass = true;
          else if (r === ']') inClass = false;
          out += ' '; i++;
        }
      }
    } else if (c === '{') {
      if (braces.length > 0) braces[braces.length - 1]!++;
      out += c; i++;
    } else if (c === '}') {
      out += c; i++;
      if (braces.length > 0) {
        if (braces[braces.length - 1] === 0) { braces.pop(); template = true; }
        else braces[braces.length - 1]!--;
      }
    } else { out += c; i++; }
  }
  return out;
}

/** The scanned files that import `lifecycle.js` (a static `import` or `export ... from`, a bare `import 'x'`, or a
 *  dynamic `import('x')`), found in code only, never in a comment or a string; `lifecycle.ts` itself always counts. */
function lifecycleImporters(files: readonly { name: string; text: string }[]): string[] {
  return files.filter(({ name, text }) => importsLifecycle(name, text)).map((f) => f.name).sort();
}
function importsLifecycle(name: string, text: string): boolean {
  if (name.endsWith('lifecycle.ts')) return true;
  const blanked = blankCommentsAndStrings(text);
  // Offsets agree between `blanked` and `text`, so the opening quote found in code names the specifier in the source.
  for (const m of blanked.matchAll(/(?:^[ \t]*(?:import|export)\b[^;'"`]*?\bfrom\s*|^[ \t]*import\s*(?=['"])|\bimport\s*\(\s*)(['"])/gm)) {
    const open = m.index + m[0].length - 1;
    const close = text.indexOf(text[open]!, open + 1);
    if (close !== -1 && /(?:^|\/)lifecycle\.js$/.test(text.slice(open + 1, close))) return true;
  }
  return false;
}

/** The scanned files that may import `lifecycle.js`: a `.signal` read is a problem only in these (a `CcdResult`'s half),
 *  so another module's `AbortSignal` is not. A new importer reds the scan until it is named here. */
const LIFECYCLE_IMPORTERS = ['src/docs/ccdsource.ts', 'src/lifecycle.ts'] as const;

/** The lines (0-based, inclusive) of the function whose declaration matches `decl`, to the first later line that is
 *  a closing brace at the declaration's own indentation; null when there is no such declaration. */
function bodyOf(lines: readonly string[], decl: RegExp): [number, number] | null {
  const start = lines.findIndex((l) => decl.test(l));
  if (start === -1) return null;
  const indent = /^\s*/.exec(lines[start]!)![0];
  const end = lines.findIndex((l, n) => n > start && l.startsWith(`${indent}}`) && l.slice(indent.length + 1).trim() === '');
  return end === -1 ? null : [start, end];
}

/** `ccd()`'s two lines, `killed: r.killed === undefined ? UNMEASURED : r.killed` and the same for `signal`: each reads
 *  its half twice (the absence test, then the value), so four reads, sorted. A fifth, or a missing one, reds. */
const CCD_PIN = ['r.killed', 'r.killed', 'r.signal', 'r.signal'] as const;

/**
 * Every `.killed` / `.signal` PROPERTY READ across the docs adapter's files and `lifecycle.ts`, held to refinement (g):
 * `CcdResult`'s two halves have ONE reader, `ccdEnding`, so they are never interpreted twice where the readings could
 * drift apart. Allowed: any read inside `ccdEnding`'s body; inside `ccd()`'s body exactly `CCD_PIN`'s four, off `r`
 * (the Runner's `ExecResult`, read to BUILD the `CcdResult`, not a `CcdResult`); and exactly one `ending.signal` in
 * `docs/ccdsource.ts` alone, the reader's own `CcdEnding` output, and only while that file binds `ending` once, as
 * `const ending = ccdEnding(`, and never assigns it again (otherwise every `ending.signal` read is a problem). Every
 * other read is named as `file:line: receiver.prop`; `res.k`, `res!.k` and `(res).k` all name receiver `res`. A comment,
 * a string, a type member and an object-literal key (`killed:`) are not property reads, and are blanked or never
 * match, because the rule is about who interprets a measured result and a declaration interprets nothing. The floor
 * (at least one of each read inside `ccdEnding`) and the `ccd()` pin (exactly the four) are also reported as problems,
 * so the scan cannot pass on nothing.
 *
 * Scope: a `.signal` read is checked only in a scanned file that imports `lifecycle.js` (`lifecycle.ts` itself counts),
 * because `signal` is also an `AbortSignal`'s name (`w.signal`, `controller.signal`) and only a `CcdResult` carries the
 * half this rule is about; the set of such files is pinned in `LIFECYCLE_IMPORTERS`, so a new importer reds until it is
 * named. `.killed` is checked in every scanned file. A receiver is an identifier (with `!` or `?.`), a parenthesised
 * identifier, any `)` or `]` (a call or an element access, with or without a `!`), or, on a line that starts with
 * `.killed`, `?.killed` or `.signal`, the identifier that ends the line before; the name printed for a `)` or `]`
 * receiver is that bracket.
 *
 * DELIBERATELY NOT CAUGHT, and no more than this:
 *  - bracket access (`res['killed']`, also through an alias key) and destructuring (`const { killed } = res`);
 *  - for `.signal`, a `CcdResult` that reaches a file which never imports `lifecycle.js`, through an inferred type
 *    (a function result the file never names): the scope rule cannot see it;
 *  - a regex literal the blanker takes for a division, because it follows `)`, `]` or an identifier (`if (x) /'/.test(s)`),
 *    and a division at the start of a line, which it takes for a regex. A text guard stops at the ordinary spellings,
 *    and these are named here instead of chased.
 */
function oneReaderProblems(files: readonly { name: string; text: string }[]): string[] {
  const problems: string[] = [];
  const inEnding = { killed: 0, signal: 0 };
  const inCcd: string[] = [];
  let sawEnding = false;
  let sawCcd = false;
  for (const { name, text } of files) {
    const lines = blankCommentsAndStrings(text).split('\n');
    const importer = importsLifecycle(name, text);
    if (importer && !(LIFECYCLE_IMPORTERS as readonly string[]).includes(name)) {
      problems.push(`scope: ${name} imports lifecycle.js and is not in the pinned importer set [${LIFECYCLE_IMPORTERS.join(', ')}]`);
    }
    const ending = name.endsWith('lifecycle.ts') ? bodyOf(lines, /^export function ccdEnding\b/) : null;
    const ccdBody = name.endsWith('lifecycle.ts') ? bodyOf(lines, /^export (?:async )?function ccd\(/) : null;
    sawEnding ||= ending !== null;
    sawCcd ||= ccdBody !== null;
    // `ending.signal` is the reader's output only in ccdsource.ts, bound once by ccdEnding( and never reassigned.
    const isAdapter = name.endsWith('docs/ccdsource.ts');
    const bindings = lines.filter((l) => /\b(?:const|let|var)\s+ending\b/.test(l));
    const assigns = lines.filter((l) => /(?<![\w$.])ending\s*=(?![=>])/.test(l));
    const endingBound = isAdapter && bindings.length === 1 && /\bconst ending = ccdEnding\(/.test(bindings[0]!) && assigns.length === 1;
    const endingReads: string[] = [];
    const read = (n: number, receiver: string, prop: 'killed' | 'signal'): void => {
      if (prop === 'signal' && !importer) return;
      if (ending && n >= ending[0] && n <= ending[1]) { inEnding[prop]++; return; }
      if (ccdBody && n >= ccdBody[0] && n <= ccdBody[1] && receiver === 'r') { inCcd.push(`${receiver}.${prop}`); return; }
      if (receiver === 'ending' && prop === 'signal' && endingBound) { endingReads.push(`${name}:${n + 1}`); return; }
      problems.push(`${name}:${n + 1}: ${receiver}.${prop}`);
    };
    lines.forEach((l, n) => {
      for (const m of l.matchAll(/(?:\(\s*([A-Za-z_$][\w$]*)\s*\)|([A-Za-z_$][\w$]*)|(\))|(\]))\s*!?\s*\??\.\s*(killed|signal)\b/g)) {
        read(n, m[1] ?? m[2] ?? m[3] ?? m[4]!, m[5] as 'killed' | 'signal');
      }
      // A member chain broken across lines: this line starts with the property, the receiver ends the line before.
      const lead = /^\s*\??\.\s*(killed|signal)\b/.exec(l);
      if (lead) {
        const before = lines.slice(0, n).reverse().find((x) => x.trim() !== '') ?? '';
        const tail = /([A-Za-z_$][\w$]*|\)|\])\s*!?\s*$/.exec(before);
        read(n, tail ? tail[1]! : '?', lead[1] as 'killed' | 'signal');
      }
    });
    if (isAdapter && endingBound && endingReads.length !== 1) {
      problems.push(`pin: ${name} reads ending.signal ${endingReads.length} times, wanted exactly 1`);
    }
    if (isAdapter && !endingBound) {
      problems.push(`${name}: ending must be bound once, by const ending = ccdEnding(, and never reassigned`);
    }
  }
  if (!sawEnding) problems.push('lifecycle.ts: no ccdEnding body found');
  if (!sawCcd) problems.push('lifecycle.ts: no ccd() body found');
  if (inEnding.killed < 1 || inEnding.signal < 1) {
    problems.push(`floor: ccdEnding holds ${inEnding.killed} .killed and ${inEnding.signal} .signal reads, wanted at least one of each`);
  }
  if (inCcd.slice().sort().join() !== CCD_PIN.join()) {
    problems.push(`pin: ccd() reads [${inCcd.slice().sort().join(', ')}] off its ExecResult, wanted exactly [${CCD_PIN.join(', ')}]`);
  }
  return problems;
}

describe('refinement (g): killed and signal have one reader, ccdEnding', () => {
  const SERVER_SRC = path.join(ROOT, 'server', 'src');
  const real = (): { name: string; text: string }[] =>
    [...readdirSync(path.join(SERVER_SRC, 'docs')).filter((f) => f.endsWith('.ts')).sort().map((f) => `docs/${f}`), 'lifecycle.ts']
      .map((name) => ({ name: `src/${name}`, text: readFileSync(path.join(SERVER_SRC, name), 'utf8') }));
  const withPlanted = (file: string, before: string, planted: string): { name: string; text: string }[] =>
    real().map((f) => {
      if (f.name !== file) return f;
      expect(f.text, `${file}: the anchor line to plant before`).toContain(before);
      return { ...f, text: f.text.replace(before, `${planted}\n${before}`) };
    });
  const PLANT_IN_CLASSIFY = "  if (res.killed === true) return fail('ccd-timeout');";
  const CLASSIFY_ANCHOR = '  const ending = ccdEnding(res);';

  it('the docs files and lifecycle.ts read them nowhere else (a floor inside ccdEnding, exactly the four CCD_PIN reads in ccd())', () => {
    const files = real();
    expect(files.map((f) => f.name)).toContain('src/docs/ccdsource.ts');
    expect(oneReaderProblems(files)).toEqual([]);
  });

  it('CONTROL: a second reader planted in classify() is named exactly', () => {
    const files = withPlanted('src/docs/ccdsource.ts', CLASSIFY_ANCHOR, PLANT_IN_CLASSIFY);
    const planted = files.find((f) => f.name === 'src/docs/ccdsource.ts')!.text;
    const line = planted.split('\n').findIndex((l) => l === PLANT_IN_CLASSIFY) + 1;
    expect(oneReaderProblems(files)).toEqual([`src/docs/ccdsource.ts:${line}: res.killed`]);
  });

  it('CONTROL: a non-null assertion and a parenthesised receiver are readers too', () => {
    for (const [spelling, receiver] of [['res!.killed', 'res.killed'], ['(res).signal', 'res.signal']] as const) {
      const planted = `  if (${spelling}) return fail('ccd-timeout');`;
      const files = withPlanted('src/docs/ccdsource.ts', CLASSIFY_ANCHOR, planted);
      const line = files.find((f) => f.name === 'src/docs/ccdsource.ts')!.text.split('\n').findIndex((l) => l === planted) + 1;
      expect(oneReaderProblems(files)).toEqual([`src/docs/ccdsource.ts:${line}: ${receiver}`]);
    }
  });

  it('CONTROL: an `ending` rebound to a CcdResult in classify() loses the allowance, and every ending.signal read is named', () => {
    const planted = '  { const ending = res; if (ending.signal) return fail(\'ccd-killed\'); }';
    const files = withPlanted('src/docs/ccdsource.ts', CLASSIFY_ANCHOR, planted);
    const text = files.find((f) => f.name === 'src/docs/ccdsource.ts')!.text.split('\n');
    const plantedLine = text.findIndex((l) => l === planted) + 1;
    const realLine = text.findIndex((l) => l.includes("ending.signal })")) + 1;
    expect(oneReaderProblems(files)).toEqual([
      `src/docs/ccdsource.ts:${plantedLine}: ending.signal`,
      `src/docs/ccdsource.ts:${realLine}: ending.signal`,
      'src/docs/ccdsource.ts: ending must be bound once, by const ending = ccdEnding(, and never reassigned',
    ]);
  });

  it('CONTROL: a second ending.signal read in the adapter reds the exactly-one pin', () => {
    const files = withPlanted('src/docs/ccdsource.ts', "  if (ending.kind === 'deadline')", '  const s2 = ending.signal;');
    expect(oneReaderProblems(files)).toEqual(['pin: src/docs/ccdsource.ts reads ending.signal 2 times, wanted exactly 1']);
  });

  it('CONTROL: ending.signal outside ccdsource.ts, in a file that imports lifecycle.js, is a reader', () => {
    const files = withPlanted('src/lifecycle.ts', '  const ending = ccdEnding(r);', '  const s = ending.signal;');
    const line = files.find((f) => f.name === 'src/lifecycle.ts')!.text.split('\n').findIndex((l) => l === '  const s = ending.signal;') + 1;
    expect(oneReaderProblems(files)).toEqual([`src/lifecycle.ts:${line}: ending.signal`]);
  });

  it('CONTROL: a third read planted inside ccd() reds the ccd() pin', () => {
    const files = withPlanted('src/lifecycle.ts', '  return {\n    ok: r.code === 0', '  const k = r.killed;');
    expect(oneReaderProblems(files)).toEqual(['pin: ccd() reads [r.killed, r.killed, r.killed, r.signal, r.signal] off its ExecResult, wanted exactly [r.killed, r.killed, r.signal, r.signal]']);
  });

  it('CONTROL: a ccdEnding that reads neither half, or only one, fails the floor', () => {
    const edit = (f: { name: string; text: string }, re: RegExp, to: string): { name: string; text: string } =>
      f.name === 'src/lifecycle.ts' ? { ...f, text: f.text.replace(re, to) } : f;
    const bodyRe = /(export function ccdEnding[^\n]*\n)[\s\S]*?\n\}\n/;
    const none = real().map((f) => edit(f, bodyRe, "$1  return { kind: 'exited' };\n}\n"));
    expect(oneReaderProblems(none)).toEqual(['floor: ccdEnding holds 0 .killed and 0 .signal reads, wanted at least one of each']);
    const noKilled = real().map((f) => edit(f, /  if \(r\.killed === true\) return \{ kind: 'deadline' \};\n/, ''));
    expect(oneReaderProblems(noKilled)).toEqual(['floor: ccdEnding holds 0 .killed and 3 .signal reads, wanted at least one of each']);
  });

  // ---- Docs W2 fix round 2 ----
  const lineOf = (files: { name: string; text: string }[], file: string, exact: string): number =>
    files.find((f) => f.name === file)!.text.split('\n').findIndex((l) => l === exact) + 1;
  const CLASSIFY = 'src/docs/ccdsource.ts';
  const READER_NEXT = "  if (res.killed === true) return fail('ccd-timeout');";
  // After the `ending` binding: a literal that swallowed the binding line is caught by the binding pin, which is not the hole.
  const AFTER_BINDING = "  if (!res.ok && res.stdout !== '') return fail('answer-overflow');";

  describe('SCOPE: a .signal read is a problem only in a scanned file that imports lifecycle.js', () => {
    const W3_LANE = [
      "import { laneAdmit } from './policy.js';",
      'export function lane(w: { signal: AbortSignal }, found: { controller: AbortController }, f: { controller: AbortController }): void {',
      '  void laneAdmit; void w.signal; void found.controller.signal; void f.controller.signal;',
      '}',
    ].join('\n');
    it('CONTROL: a file under the docs glob with no lifecycle import and the three W3 AbortSignal reads passes clean', () => {
      expect(oneReaderProblems([...real(), { name: 'src/docs/lane.ts', text: W3_LANE }])).toEqual([]);
    });
    it('CONTROL: the same file with an import from lifecycle.js and a res.signal read reds, and the new importer is named by the pin', () => {
      const text = ["import { ccdEnding } from '../lifecycle.js';", 'export function lane(res: unknown): void {', '  void ccdEnding; const g = res.signal; void g;', '}'].join('\n');
      const line = 3;
      expect(oneReaderProblems([...real(), { name: 'src/docs/lane.ts', text }])).toEqual([
        'scope: src/docs/lane.ts imports lifecycle.js and is not in the pinned importer set [src/docs/ccdsource.ts, src/lifecycle.ts]',
        `src/docs/lane.ts:${line}: res.signal`,
      ]);
    });
    it('CONTROL: an import spelled over several lines, or as export-from or a dynamic import, still makes a file an importer', () => {
      for (const imp of ["import {\n  ccdEnding,\n} from '../lifecycle.js';", "export { ccdEnding } from '../lifecycle.js';", "const m = await import('../lifecycle.js');"]) {
        const probs = oneReaderProblems([...real(), { name: 'src/docs/lane.ts', text: `${imp}\nconst g = res.signal;` }]);
        expect(probs[0], imp).toMatch(/^scope: src\/docs\/lane\.ts imports lifecycle\.js/);
      }
    });
    it('CONTROL: .killed stays checked in a file that imports nothing', () => {
      const files = withPlanted('src/docs/policy.ts', 'export ', '  const k = res.killed;');
      const line = lineOf(files, 'src/docs/policy.ts', '  const k = res.killed;');
      expect(oneReaderProblems(files)).toEqual([`src/docs/policy.ts:${line}: res.killed`]);
    });
    it('NEAR-MISS: a comment or a string naming lifecycle.js does not make a file an importer', () => {
      const text = ["// import { ccdEnding } from '../lifecycle.js';", "const s = \"import x from '../lifecycle.js'\";", 'const g = w.signal;'].join('\n');
      expect(oneReaderProblems([...real(), { name: 'src/docs/lane.ts', text }])).toEqual([]);
    });
    it('PIN: today exactly ccdsource.ts and lifecycle.ts are the scanned files that import lifecycle.js', () => {
      expect(lifecycleImporters(real())).toEqual(['src/docs/ccdsource.ts', 'src/lifecycle.ts']);
    });
  });

  describe('F1: the blanker keeps a template expression as code, and blanks a regex literal', () => {
    it('CONTROL: a /* inside a template literal does not swallow the reader on the next line', () => {
      const planted = ['  const glob = `${res.stderr}/*.md`; void glob;', READER_NEXT].join('\n');
      const files = withPlanted(CLASSIFY, AFTER_BINDING, planted);
      expect(oneReaderProblems(files)).toEqual([`${CLASSIFY}:${lineOf(files, CLASSIFY, READER_NEXT)}: res.killed`]);
    });
    it('CONTROL: a /* inside a regex literal does not swallow the reader on the next line', () => {
      const planted = ["  const trimmed = res.stderr.replace(/\\/*$/, '');", READER_NEXT].join('\n');
      const files = withPlanted(CLASSIFY, AFTER_BINDING, planted);
      expect(oneReaderProblems(files)).toEqual([`${CLASSIFY}:${lineOf(files, CLASSIFY, READER_NEXT)}: res.killed`]);
    });
    it('CONTROL: a ${...} expression is code, so a read inside it is named (nested braces and nested templates too)', () => {
      for (const planted of [
        '  const a = `x ${res.killed} y`;',
        '  const a = `x ${ { k: 1 }.k + (res.killed ? 1 : 0) } y`;',
        '  const a = `x ${ `inner ${res.killed} text` } y`;',
        '  const a = `x ${ `inner ${ `deep ${res.killed}` }` } y`;',
      ]) {
        const files = withPlanted(CLASSIFY, CLASSIFY_ANCHOR, planted);
        expect(oneReaderProblems(files), planted).toEqual([`${CLASSIFY}:${lineOf(files, CLASSIFY, planted)}: res.killed`]);
      }
    });
    it('blanker: template text is blanked, ${} is kept, and a quote, //, or /* in template text opens nothing', () => {
      expect(blankCommentsAndStrings("a`it's // /* ${b} ${ {c:`d`}.c } \\` e`f")).toBe('a`           ${b} ${ {c:` `}.c }     `f');
      expect(blankCommentsAndStrings('x`a\nb`y')).toBe('x` \n `y');
    });
    it('blanker: regex literals start where a slash cannot be division, honour escapes and character classes, and end at their own slash', () => {
      expect(blankCommentsAndStrings("x(/a'b/)")).toBe('x(/   /)');
      expect(blankCommentsAndStrings('x = /a\\/b/g')).toBe('x = /    /g');
      expect(blankCommentsAndStrings('x = /[/*]/;')).toBe('x = /    /;');
      expect(blankCommentsAndStrings('return /"/.test(s)')).toBe('return / /.test(s)');
      expect(blankCommentsAndStrings('f(a, /\'/, b)')).toBe('f(a, / /, b)');
      expect(blankCommentsAndStrings('if (!/\'/.test(s)) {}')).toBe('if (!/ /.test(s)) {}');
      expect(blankCommentsAndStrings('/x\'y/.test(s)')).toBe('/   /.test(s)');
    });
    it("blanker: a slash after an operand is division, not a regex", () => {
      // `a / b / 'c'` would blank ` b ` as a regex; the string after it must still be the only blanked span
      expect(blankCommentsAndStrings("const q = a / b / 'cc';")).toBe("const q = a / b / '  ';");
      expect(blankCommentsAndStrings("const q = (a + 1) / 2 + x[0] / 'dd'.length;")).toBe("const q = (a + 1) / 2 + x[0] / '  '.length;");
    });
  });

  describe('F2: wider receivers', () => {
    it('CONTROL: an element-access receiver is a reader (all[0].killed, all[0]!.killed, rs[0].signal)', () => {
      for (const [spelling, receiver] of [['all[0].killed', '].killed'], ['all[0]!.killed', '].killed'], ['rs[0].signal', '].signal']] as const) {
        const planted = `  if (${spelling}) return fail('ccd-timeout');`;
        const files = withPlanted(CLASSIFY, CLASSIFY_ANCHOR, planted);
        expect(oneReaderProblems(files), spelling).toEqual([`${CLASSIFY}:${lineOf(files, CLASSIFY, planted)}: ${receiver}`]);
      }
    });
    it('CONTROL: a non-null assertion after a call or an index is a reader (id(res)!.killed, [res].at(0)!.killed)', () => {
      for (const [spelling, receiver] of [['id(res)!.killed', 'res.killed'], ['[res].at(0)!.killed', ').killed']] as const) {
        const planted = `  if (${spelling}) return fail('ccd-timeout');`;
        const files = withPlanted(CLASSIFY, CLASSIFY_ANCHOR, planted);
        expect(oneReaderProblems(files), spelling).toEqual([`${CLASSIFY}:${lineOf(files, CLASSIFY, planted)}: ${receiver}`]);
      }
    });
    it('CONTROL: a member chain broken across lines is a reader (.killed, ?.killed, .signal on a line of its own)', () => {
      for (const [line2, prop] of [['    .killed', 'killed'], ['    ?.killed', 'killed'], ['    .signal', 'signal']] as const) {
        const planted = ['  const k = res', line2, '    ;'].join('\n');
        const files = withPlanted(CLASSIFY, CLASSIFY_ANCHOR, planted);
        expect(oneReaderProblems(files), line2).toEqual([`${CLASSIFY}:${lineOf(files, CLASSIFY, line2)}: res.${prop}`]);
      }
    });
    it('CONTROL: a regex literal holding a quote no longer blanks the reader behind it on the same line', () => {
      const planted = "  if (/[\"']/.test(res.stderr) || res.killed === true) return fail('ccd-timeout');";
      const files = withPlanted(CLASSIFY, CLASSIFY_ANCHOR, planted);
      expect(oneReaderProblems(files)).toEqual([`${CLASSIFY}:${lineOf(files, CLASSIFY, planted)}: res.killed`]);
    });
    it('NEAR-MISS: a spread and a leading-dot number are not readers', () => {
      const planted = ['  const a = [...rest, .5];', '  const c = { ...signalOpts };'].join('\n');
      expect(oneReaderProblems(withPlanted(CLASSIFY, CLASSIFY_ANCHOR, planted))).toEqual([]);
    });
  });

  describe('F3: ccdEnding is located only by its function form', () => {
    it('CONTROL: ccdEnding rewritten as a const arrow answers "no ccdEnding body found" (never an over-long body)', () => {
      const files = real().map((f) => {
        if (f.name !== 'src/lifecycle.ts') return f;
        const arrow = f.text
          .replace('export function ccdEnding(r: CcdResult): CcdEnding {', 'export const ccdEnding = (r: CcdResult): CcdEnding => {')
          .replace("  return { kind: 'exited' };\n}\n", "  return { kind: 'exited' };\n};\n");
        expect(arrow, 'the const-form rewrite applied').not.toBe(f.text);
        return { ...f, text: arrow };
      });
      expect(oneReaderProblems(files)).toContain('lifecycle.ts: no ccdEnding body found');
    });
  });

  it('NEAR-MISS: a comment, a string, a type member, an object key and ending.signal are not readers', () => {
    const planted = [
      '  // if (res.killed === true) return fail("x");',
      '  /* res.signal',
      '     res.killed */',
      "  const msg = 'res.killed and res.signal';",
      '  const key = { killed: false, signal: null };',
      '  type T = { killed: boolean; signal: string | null };',
    ].join('\n');
    expect(oneReaderProblems(withPlanted('src/docs/ccdsource.ts', CLASSIFY_ANCHOR, planted))).toEqual([]);
  });
});
