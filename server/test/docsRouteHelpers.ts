// Test helpers for the native Docs reader's L4 (design 2026-10-01, section 6.3, section 6.4; W3). Task 4 adds the
// blocking exec double the lane, fetch-lane and single-flight cases drive; Task 6 adds the scripted `CcdRunner`
// over W2's real adapter and `docsApp()`; Task 10 adds `echoPty()` and `passThroughLane()`.
import { createHash } from 'node:crypto';
import Fastify, { type FastifyInstance } from 'fastify';
import type { PtyProcess, PtySpawn } from '../../agent/src/pty.js';
import { DOCS_CAP, type CcdArgv } from '../src/ccdargv.js';
import type { CcdResult, CcdRunner } from '../src/lifecycle.js';
import { installDocsRequestPolicy, installDocsResponsePolicy } from '../src/docs/hooks.js';
import type { DocsLaneRun, DocsReadLane } from '../src/docs/lane.js';
import type { DocsJob } from '../src/docs/policy.js';
import {
  composeDocs, registerDocsReadRoutes, registerDocsRefreshRoute, type DocsComposition, type DocsNodeLanes,
} from '../src/docs/routes.js';
import {
  DOCS_REQUEST_HEADER, DOCS_REQUEST_HEADER_VALUE, type DocPin, type DocsEntry, type DocsIndexOk, type DocsTreeOk,
} from '../../shared/docs.js';

/**
 * A blocking exec double (section 6.10's "blocking doubles", M6.2): every call of `exec` is one started exec, held
 * open until the test settles it by its start index. `started()` counts the calls, so "zero extra execs" is a
 * count that did not move.
 */
export function blocker<T>(): {
  exec: () => Promise<T>;
  started(): number;
  release(i: number, v: T): void;
  fail(i: number, e: Error): void;
} {
  const held: { resolve: (v: T) => void; reject: (e: Error) => void }[] = [];
  return {
    exec: () => new Promise<T>((resolve, reject) => {
      held.push({ resolve, reject });
    }),
    started: () => held.length,
    release: (i, v) => held[i].resolve(v),
    fail: (i, e) => held[i].reject(e),
  };
}

// ===== Task 6: the scripted runner over W2's real adapter, the fixtures, and the app =====

/** What the PWA's `fetch()` sends (section 3.8): the marker, a same-origin site and a non-navigation mode. Built
 *  from L0's constants, never the quoted marker. */
export const PWA_HEADERS: Readonly<Record<string, string>> = {
  [DOCS_REQUEST_HEADER]: DOCS_REQUEST_HEADER_VALUE, 'sec-fetch-site': 'same-origin', 'sec-fetch-mode': 'cors',
};

/** The commit and served ref every fixture tree answers unless a case says otherwise. */
export const FIXTURE_COMMIT = 'a'.repeat(40);
export const FIXTURE_SERVED = 'refs/remotes/origin/main';

/** A measured, clean ccd exit carrying `stdout`. */
export function okRes(stdout: string): CcdResult {
  return { ok: true, stdout, stderr: '', killed: false, signal: null };
}

/** A measured exit that wrote nothing and failed: the adapter answers `ccd-fault {stderrHead}`. */
export function faultRes(stderr = 'usage'): CcdResult {
  return { ok: false, stdout: '', stderr, killed: false, signal: null };
}

/** One answer line as ccd writes it: one JSON text and one LF. */
export function line(o: unknown): string {
  return `${JSON.stringify(o)}\n`;
}

/** The sha256 of `bytes`, lower-case hex: a draft pin's `fp` and every show answer's `sha256`. */
export function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/**
 * A scripted `CcdRunner` (W2's real adapter runs over it): every argv is recorded as a copy, so "zero execs" is
 * `calls` staying empty, and answered by `handler`, which may hold the answer open (a blocking double).
 */
export function scripted(handler: (argv: string[]) => CcdResult | Promise<CcdResult>): {
  run: CcdRunner;
  calls: string[][];
} {
  const calls: string[][] = [];
  return {
    calls,
    run: async (argv: CcdArgv) => {
      const copy = [...argv];
      calls.push(copy);
      return handler(copy);
    },
  };
}

/** A committed listing row: exactly the three facts, no draft. */
export function committedEntry(path: string, blob: string, size: number | null,
  kind: 'file' | 'exec' | 'symlink' | 'submodule' = 'file'): DocsEntry {
  return { section: 'specs', path, committed: { kind, blob, size }, draft: null };
}

/** A draft-only row: no committed facts, an untracked file with `fp` and `size` as given. */
export function draftEntry(path: string, fp: string | null, size: number | null): DocsEntry {
  return { section: 'specs', path, committed: null, draft: { state: 'untracked', kind: 'file', size, fp, trust: 'hash' } };
}

/** A complete ok tree of `demo` at `FIXTURE_COMMIT`, served from `FIXTURE_SERVED`, with an origin remote and no
 *  stamp (so `refreshDue` is true) and no entries; `over` replaces top-level fields. It passes `docsAnswerShape`. */
export function treeOk(over: Partial<DocsTreeOk> = {}): DocsTreeOk {
  return {
    v: 1, verb: 'docs-tree', ok: true, elapsedMs: 5, project: 'demo',
    repo: { key: 'f'.repeat(32), objectFormat: 'sha1', shallow: false },
    github: { state: 'named', slug: 'example-org/example-repo' },
    ref: {
      requested: null, served: FIXTURE_SERVED, name: 'main', side: 'origin', commit: FIXTURE_COMMIT,
      via: 'default:origin-head', tried: [], relation: 'equal', counterpart: null,
    },
    mainCheckout: { path: '/tmp/example', branch: 'main', head: FIXTURE_COMMIT },
    sections: [], entries: [], unlisted: { count: 0, byReason: {} },
    drafts: { state: 'none', branch: 'main', skipped: [] },
    freshness: { remote: 'origin', trackedRef: FIXTURE_SERVED, stamp: null, fetchHead: null },
    ...over,
  };
}

/** A complete ok index: one ready project `demo`; `over` replaces top-level fields. It passes `docsAnswerShape`. */
export function indexOk(over: Partial<DocsIndexOk> = {}): DocsIndexOk {
  return {
    v: 1, verb: 'docs-index', ok: true, elapsedMs: 2, unlisted: 0, duplicates: [],
    projects: [{ project: 'demo', state: 'ready', github: { state: 'none' } }],
    ...over,
  };
}

/**
 * The ccd line of a valid show answer for `pin` carrying `bytes`, base64-encoded: its `size` and `sha256` measured
 * over the bytes and every pin echo matching, so W2's check 8 passes (a draft pin's `fp` must be `sha256Hex(bytes)`).
 * A committed answer carries `blob` `'b'.repeat(40)` and `onRef: 'contains'`; `over` replaces any field.
 */
export function showLine(pin: DocPin, bytes: Uint8Array, over: Record<string, unknown> = {}): string {
  const common = {
    v: 1, verb: 'docs-show', ok: true, elapsedMs: 3, section: pin.section, path: pin.path,
    size: bytes.byteLength, sha256: sha256Hex(bytes), encoding: 'base64', b64: Buffer.from(bytes).toString('base64'),
  };
  return line(pin.kind === 'committed'
    ? { ...common, source: 'committed', commit: pin.commit, blob: 'b'.repeat(40), mode: '100644', onRef: 'contains', ...over }
    : { ...common, source: 'draft', worktree: '/tmp/example', branch: pin.branch, head: pin.head, fp: pin.fp, ...over });
}

/** The one node's lanes and caches of a composition (the primary node's). */
export function nodeLanes(docs: DocsComposition): DocsNodeLanes {
  const at = docs.lanes.byNode.get(docs.lanes.primary);
  if (at === undefined) throw new Error('docsRouteHelpers: the composition has no primary lanes');
  return at;
}

/** Poll `cond` across event-loop turns until it holds, or throw naming `label` after `ms` of wall time. It yields
 *  with `setImmediate`, so a case that fakes `setTimeout` never stalls it, and I/O progresses between polls. */
export async function until(cond: () => boolean, label: string, ms = 5000): Promise<void> {
  const deadline = performance.now() + ms;
  while (!cond()) {
    if (performance.now() > deadline) throw new Error(`until: ${label} did not happen within ${ms} ms`);
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
}

/**
 * A bare Fastify with the docs plugin mounted exactly as `server.ts` will mount it (section 3.4), over a
 * composition built from `run` and a fleet state whose `ccdVerbs` is `verbs` (default: `caps` and the docs cap;
 * `null`: not handshaken). `state` is the object the adapter reads, so a case mutates it in place. `root` runs on the
 * root instance before the plugin is registered, where `installGate` sits in `buildServer`; `GET /api/other` is a
 * route outside the plugin. `nowMs` is both the routes' and the provenance log's clock; `readLane` the latency
 * test's control lane.
 */
export async function docsApp(o: {
  run: CcdRunner;
  verbs?: string[] | null;
  nowMs?: () => number;
  readLane?: () => DocsReadLane;
  root?: (app: FastifyInstance) => void;
}): Promise<{ app: FastifyInstance; state: { ccdVerbs: string[] | null }; docs: DocsComposition }> {
  const state = { ccdVerbs: o.verbs === undefined ? ['caps', DOCS_CAP] : o.verbs };
  const docs = composeDocs({ runCcd: o.run, fleetState: state }, { nowMs: o.nowMs, readLane: o.readLane });
  const app = Fastify({ logger: false });
  o.root?.(app);
  app.get('/api/other', async () => ({ ok: true }));
  await app.register(async (app) => {
    installDocsRequestPolicy(app, o.nowMs);
    installDocsResponsePolicy(app);
    registerDocsReadRoutes(app, docs.readers, docs.lanes);
    registerDocsRefreshRoute(app, docs.readers, docs.fetchers, docs.lanes);
  });
  return { app, state, docs };
}

// ===== Task 10: the latency test's echo pty and its control lane (section 6.8; refinement (s)) =====

/**
 * An agent-side pty (`AgentOpts.spawnPty`) that echoes: every `write` is emitted back to its data listeners, as the
 * same string, on the next turn of the event loop (`setImmediate`), so an echo's round trip is the link's and the
 * event loop's, never a terminal's. `kill` silences it and emits no exit; `resize` is a no-op. No node-pty, no tmux.
 */
export function echoPty(): PtySpawn {
  return () => {
    const data = new Set<(d: string) => void>();
    const exit = new Set<() => void>();
    const proc: PtyProcess = {
      onData: (listener) => {
        data.add(listener);
        return { dispose: () => { data.delete(listener); } };
      },
      onExit: (listener) => {
        exit.add(listener);
        return { dispose: () => { exit.delete(listener); } };
      },
      write: (d) => {
        setImmediate(() => {
          for (const listener of data) listener(d);
        });
      },
      resize: () => undefined,
      kill: () => {
        data.clear();
        exit.clear();
      },
    };
    return proc;
  };
}

/**
 * The latency test's CONTROL lane (section 6.8, M6.12's mutation; refinement (s)): a `DocsReadLane` that runs every
 * job at once, with no FIFO, no budget and no refusal, so every show's answer is on the link together. Passed to
 * `composeDocs` as its `readLane` option; nothing else differs between the control and the real run.
 */
export function passThroughLane(): DocsReadLane {
  return {
    async run<T>(_job: DocsJob, _signal: AbortSignal, exec: () => Promise<T>): Promise<DocsLaneRun<T>> {
      return { kind: 'ran', value: await exec() };
    },
    load: () => ({ execs: 0, bytes: 0, large: 0, queued: 0 }),
    close: () => undefined,
  };
}
