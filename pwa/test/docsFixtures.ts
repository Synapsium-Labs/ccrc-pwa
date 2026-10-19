// Docs W5 part 1 fixtures (Task 5): a tree answer built from placeholders only (project `demo`, branches `main` and
// `ws/a`, a checkout at `/repo/demo`), the page a URL parses to, and loaders whose every call is a spy. Later Docs
// tests build on these; nothing here reaches a server.
import { vi, type Mock } from 'vitest';
import {
  DOC_SECTION_SLUGS, DOC_SECTIONS, parseDocsPage,
  type DocsEntry, type DocsFailureBody, type DocsFileResponse, type DocsPageLocation, type DocsRefreshFetch,
  type DocsRefreshResponse, type DocsTreeOk, type DocsTreeResponse, type DraftsFacts,
} from '../../shared/docs';
import type {
  DocsFileAnswer, DocsIndexAnswer, DocsLoaders, DocsRasterAnswer, DocsRefreshLoaderAnswer, DocsTreeAnswer,
} from '../src/docs/failures';

export const COMMIT_A = 'a'.repeat(40);
export const COMMIT_B = 'b'.repeat(40);
export const BLOB_1 = '1'.repeat(40);
export const BLOB_2 = '2'.repeat(40);
export const FP_1 = 'f'.repeat(64);
export const SERVED = 'refs/remotes/origin/main';

/** A committed regular file of 100 bytes, no draft. */
export function entry(section: DocsEntry['section'], path: string, over: Partial<DocsEntry> = {}): DocsEntry {
  return { section, path, committed: { kind: 'file', blob: BLOB_1, size: 100 }, draft: null, ...over };
}

/** A draft overlaying `entry`: a regular file with a fingerprint (opens as a draft in a ref view). */
export function draftOf(state: NonNullable<DocsEntry['draft']>['state'],
  over: Partial<NonNullable<DocsEntry['draft']>> = {}): NonNullable<DocsEntry['draft']> {
  return { state, kind: 'file', size: 120, fp: FP_1, trust: 'status', ...over };
}

/** The main checkout holding `main` at `head`, its HEAD equal to the served commit unless `baseEqual` says not. */
export function holder(head = COMMIT_A, baseEqual = true): DraftsFacts {
  return {
    state: 'holder', branch: 'main', worktree: { path: '/repo/demo', head, class: 'main' }, baseEqual, base: null,
    caveats: [], opaque: [],
  };
}

export interface TreeOver {
  readonly commit?: string;
  readonly entries?: DocsEntry[];
  readonly drafts?: DraftsFacts;
}

export function treeOk(over: TreeOver = {}): DocsTreeOk {
  const commit = over.commit ?? COMMIT_A;
  return {
    v: 1, verb: 'docs-tree', ok: true, elapsedMs: 5, project: 'demo',
    repo: { key: '0'.repeat(32), objectFormat: 'sha1', shallow: false },
    github: { state: 'named', slug: 'example-org/example-repo' },
    ref: {
      requested: null, served: SERVED, name: 'main', side: 'origin', commit, via: 'default:origin-head', tried: [],
      relation: 'equal', counterpart: null,
    },
    mainCheckout: { path: '/repo/demo', branch: 'main', head: commit },
    sections: DOC_SECTION_SLUGS.map((slug) => ({ slug, path: DOC_SECTIONS[slug], state: 'present', count: 1 })),
    entries: over.entries ?? [entry('specs', 'a.md'), entry('specs', 'b.md', { committed: { kind: 'file', blob: BLOB_2, size: 100 } })],
    unlisted: { count: 0, byReason: {} },
    drafts: over.drafts ?? { state: 'none', branch: 'main', skipped: [] },
    freshness: { remote: 'origin', trackedRef: SERVED, stamp: null, fetchHead: null },
  };
}

export function treeResponse(tree: DocsTreeOk = treeOk(), refreshDue = false): DocsTreeResponse {
  return { ok: true, tree, refreshDue };
}

export const okTree = (tree: DocsTreeOk = treeOk(), refreshDue = false): DocsTreeAnswer =>
  ({ s: 'ok', value: treeResponse(tree, refreshDue) });

/** A failure body for `word` with any context (an unknown word is allowed: it is kept whole). */
export const bodyOf = (word: string, ctx: Record<string, unknown> = {}): DocsFailureBody =>
  ({ ok: false, failure: word, ...ctx }) as unknown as DocsFailureBody;

export const failedAnswer = (word: string, ctx: Record<string, unknown> = {}): { s: 'failed'; body: DocsFailureBody } =>
  ({ s: 'failed', body: bodyOf(word, ctx) });

export function fileResponse(text = '# A'): DocsFileResponse {
  return {
    ok: true, contentClass: 'markdown', from: 'ccd',
    show: {
      v: 1, verb: 'docs-show', ok: true, elapsedMs: 3, source: 'committed', section: 'specs', path: 'a.md',
      size: text.length, sha256: 'c'.repeat(64), encoding: 'utf8', text,
    },
  };
}

export const okFile = (text = '# A'): DocsFileAnswer => ({ s: 'ok', value: fileResponse(text) });

export const RAN: DocsRefreshFetch = {
  state: 'ran',
  answer: {
    v: 1, verb: 'docs-fetch', ok: true, elapsedMs: 40, branch: 'main', trackedRef: SERVED, before: COMMIT_A,
    after: COMMIT_A, moved: 'unchanged', stamp: 'written',
  },
};

export function okRefresh(fetch: DocsRefreshFetch = RAN,
  tree: DocsTreeResponse | DocsFailureBody = treeResponse()): DocsRefreshLoaderAnswer {
  const value: DocsRefreshResponse = { ok: true, fetch, tree };
  return { s: 'ok', value };
}

/** A fetch failure inside an ok refresh answer. */
export const fetchFailed = (word: string, ctx: Record<string, unknown> = {}): DocsRefreshFetch =>
  ({ state: 'failed', failure: bodyOf(word, ctx) });

export interface FakeLoaders {
  readonly loaders: DocsLoaders;
  readonly projects: Mock<() => Promise<DocsIndexAnswer>>;
  readonly tree: Mock<DocsLoaders['tree']>;
  readonly file: Mock<DocsLoaders['file']>;
  readonly raster: Mock<DocsLoaders['raster']>;
  readonly refresh: Mock<DocsLoaders['refresh']>;
}

/** Spies that answer `tree`, `file` and `refresh` by default; a test queues others with `mockResolvedValueOnce`. */
export function fakeLoaders(answers: {
  tree?: DocsTreeAnswer; file?: DocsFileAnswer; refresh?: DocsRefreshLoaderAnswer;
} = {}): FakeLoaders {
  const projects = vi.fn(async (): Promise<DocsIndexAnswer> => ({ s: 'unreachable' }));
  const tree = vi.fn(async (): Promise<DocsTreeAnswer> => answers.tree ?? okTree());
  const file = vi.fn(async (): Promise<DocsFileAnswer> => answers.file ?? okFile());
  const raster = vi.fn(async (): Promise<DocsRasterAnswer> => ({ s: 'unreachable' }));
  const refresh = vi.fn(async (): Promise<DocsRefreshLoaderAnswer> => answers.refresh ?? okRefresh());
  return { loaders: { projects, tree, file, raster, refresh }, projects, tree, file, raster, refresh };
}

/** A `file` loader that never answers but rejects with an AbortError when its signal aborts, as `fetch` does (opt-in:
 *  `f.file.mockImplementationOnce(rejectsOnAbort)`; the default fakes ignore the signal). */
export const rejectsOnAbort: DocsLoaders['file'] = (_project, _pin, signal) =>
  new Promise<DocsFileAnswer>((_resolve, reject) => {
    signal?.addEventListener('abort', () => { reject(new DOMException('The operation was aborted.', 'AbortError')); });
  });

/** The location a Docs URL parses to; throws on a URL that does not parse (a fixture defect). */
export function pageAt(url: string): DocsPageLocation {
  const q = url.indexOf('?');
  const parsed = parseDocsPage(q < 0 ? url : url.slice(0, q), q < 0 ? '' : url.slice(q));
  if (!parsed.ok) throw new Error(`fixture URL ${url} does not parse: ${parsed.why}`);
  return parsed.loc;
}

/** Runs `run` with the process's unhandled-rejection listeners swapped for one that records, then puts them back and
 *  answers what was recorded. For a test of a loader that rejects: the hook lets that rejection surface (nothing
 *  handles it), and the runner would otherwise fail the whole run on it. Real timers only. */
export async function recordingRejections(run: () => Promise<void>): Promise<unknown[]> {
  const seen: unknown[] = [];
  const saved = process.listeners('unhandledRejection');
  process.removeAllListeners('unhandledRejection');
  const mine = (reason: unknown): void => { seen.push(reason); };
  process.on('unhandledRejection', mine);
  try {
    await run();
    await new Promise<void>((r) => { setTimeout(r, 0); });
  } finally {
    process.removeListener('unhandledRejection', mine);
    for (const l of saved) process.on('unhandledRejection', l);
  }
  return seen;
}
