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
import { describe, it, expect } from 'vitest';
import { chmodSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DOCS_CAP, type CcdArgv } from '../src/ccdargv.js';
import { ccdRunner, type CcdResult, type CcdRunner } from '../src/lifecycle.js';
import { UNMEASURED, realRunner } from '../src/exec.js';
import type { CcrcConfig } from '../src/config.js';
import { ccdDocsFetcher, ccdDocsReader, type CcdDocsDeps } from '../src/docs/ccdsource.js';
import { docsShowPlan } from '../src/docs/policy.js';
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
