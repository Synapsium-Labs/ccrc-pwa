// The native Docs reader's HTTP routes (design 2026-10-01, section 3.4, section 3.6, section 6.3-6.5; W3 refinements
// (c), (i), (j), (k) and (l)): L4. `composeDocs` builds one node's reader, fetcher, lanes and caches, once per call
// (never at module scope); `registerDocsReadRoutes` registers the five reads on the docs plugin's own instance, and
// Task 7's `registerDocsRefreshRoute` the refresh. The read registration never receives a fetcher (section 2 (g)'s
// wall 1): its signature takes readers and lanes only. The history read has no cache of its own (rich-docs spec G4):
// it joins a single flight and books the read lane on every request.
//
// Ring (M7.10; the ring guard in `single-definition.test.ts`): this file may import fastify and name `reply`, and it
// DECIDES NOTHING. The query, project and pin verdicts, every key, the show plan, the known size, the shape guard,
// the show bound, the cache verdicts, the cache-hit answer, the file representation and every status are L1's
// (`policy.ts`); the lanes, flights and caches are bookkeeping (`lane.ts`, `cache.ts`). This file applies them in one
// order on every read: the cache, then single-flight, then the read lane (refinement (k)). It quotes no failure word,
// and every failure body it receives is sent as it came, never rebuilt. A log line is `console.warn('ccrc-server:
// ...')`: the server runs `Fastify({ logger: false })`, so the request logger is a silent no-op.
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type {
  DocPin, DocsFailureBody, DocsFolderAddResponse, DocsFolderRemoveResponse, DocsFolderTreeResponse, DocsFoldersLabelsResponse,
  DocsFoldersPathsResponse, DocsHistoryResponse, DocsProjectsResponse, DocsRangeFrameResponse,
  DocsRangePrepareResponse, DocsRefreshFetch, DocsRefSpec, DocsTreeOk, DocsTreeResponse,
} from '../../../shared/docs.js';
import type { AccountGate } from '../accounts/gate.js';
import { DOCS_FOLDERS_CAP } from '../ccdargv.js';
import { docsCaches, type DocsCaches } from './cache.js';
import {
  ccdDocsFetcher, ccdDocsFolderReader, ccdDocsFolderRegistry, ccdDocsReader, type CcdDocsDeps,
} from './ccdsource.js';
import { sendDocsFailure } from './hooks.js';
import {
  docsFetchLane, docsFlights, docsGenerations, docsReadLane, type DocsFetchLane, type DocsFlights, type DocsGenerations,
  type DocsLaneRun, type DocsReadLane,
} from './lane.js';
import {
  DOCS_PRIMARY_NODE, DOCS_REFRESH_SKIPPED, HISTORY_JOB, LISTING_JOB, docsAnswerShape, docsCacheFill, docsCacheHitAnswer,
  docsCacheVerdict, docsFileReply, docsFolderFailureBody, docsFolderFileReply, docsFolderKey, docsFolderLabelRows,
  docsFolderListFlightKey, docsFolderRangeFlightKey, docsFolderRangePlan, docsFolderShowFlightKey, docsFolderTreeBody,
  docsFolderTreeFlightKey, docsIndexCacheable,
  docsIndexFlightKey, docsKnownSize, docsLogDue, docsLogFlightKey, docsNodeKey,
  docsProjectKey, docsRangeAnswerShape, docsRangeFlightKey, docsRangePlan, docsRefreshAnswer, docsRefreshFetchHalf, docsRefreshFlightKey, docsShowBound, docsShowFlightKey,
  docsShowPlan, docsStoredShow, docsTreeEcho, docsTreeFlightKey, fetchBranchFor, folderGateRefusal, folderReadGate,
  folderRemoveGate, parseDocsApiQuery, parseDocsFolderAddBody, parseDocsFolderLabel, parseDocsProjectParam,
  parseDocsRefreshBody, refreshDue, type DocsApiRequest, type DocsFileReply, type DocsFolderFileReply, type DocsJob,
  type DocsListedFile, type DocsRangeFrameAsk, type DocsRefreshHalf, type DocsRefreshRequest, type DocsSignIn,
} from './policy.js';
import type {
  DocsFetchRun, DocsFetcher, DocsFolderFrameRead, DocsFolderId, DocsFolderListRead, DocsFolderPrepareRead, DocsFolderReader,
  DocsFolderRegistry, DocsFolderShowRead, DocsFolderTreeRead, DocsIndexRead, DocsLogRead, DocsRangeFrameRead,
  DocsRangePrepareRead, DocsReader, DocsShowRead, DocsSourceId, DocsTreeRead,
} from './ports.js';

/** One value per fleet node (section 3.12). `primary` is the node every request reads: the API carries no node key,
 *  so a route reads `byNode.get(primary)`. A second node arrives as a second entry, never as a re-key. */
export interface DocsNodes<T> { readonly primary: string; readonly byNode: ReadonlyMap<string, T> }

/** One node's link protection and caches (section 6.3-6.5). `nowMs` is the clock the routes hand the caches, which
 *  hold none. */
export interface DocsNodeLanes {
  read: DocsReadLane;
  fetch: DocsFetchLane;
  flights: DocsFlights;
  gens: DocsGenerations;
  caches: DocsCaches;
  nowMs: () => number;
}

/** What the docs plugin is registered with (section 3.4): the readers, the fetchers and the lanes, per node. */
export interface DocsComposition {
  readers: DocsNodes<DocsReader>;
  fetchers: DocsNodes<DocsFetcher>;
  lanes: DocsNodes<DocsNodeLanes>;
  /** The outside-folder reads (X2 P2.3), and, held apart as the fetchers are, the registry's two writes. */
  folderReaders: DocsNodes<DocsFolderReader>;
  folderRegistries: DocsNodes<DocsFolderRegistry>;
}

/** `nowMs`: the clock (default `Date.now`). `readLane`: builds the read lane (default `docsReadLane`); only the
 *  latency test's control passes one, a pass-through lane (refinement (s)). */
export interface DocsComposeOptions {
  nowMs?: () => number;
  readLane?: () => DocsReadLane;
}

/** A single-node map under `DOCS_PRIMARY_NODE`. */
function primaryOnly<T>(value: T): DocsNodes<T> {
  return { primary: DOCS_PRIMARY_NODE, byNode: new Map([[DOCS_PRIMARY_NODE, value]]) };
}

/**
 * Compose one node's Docs (refinement (i)): a reader and a fetcher over the SAME `source` object, never a copy, so
 * a `fleetState` getter on it is read at every call (the link's state object, mutated in place or replaced); and a
 * fresh read lane, fetch lane, flight map, generation counter and cache set. Called once per `buildServer`, so two
 * servers (two tests) share nothing.
 */
export function composeDocs(source: CcdDocsDeps, opts: DocsComposeOptions = {}): DocsComposition {
  return {
    readers: primaryOnly(ccdDocsReader(source)),
    fetchers: primaryOnly(ccdDocsFetcher(source)),
    folderReaders: primaryOnly(ccdDocsFolderReader(source)),
    folderRegistries: primaryOnly(ccdDocsFolderRegistry(source)),
    lanes: primaryOnly<DocsNodeLanes>({
      read: (opts.readLane ?? docsReadLane)(),
      fetch: docsFetchLane(),
      flights: docsFlights(),
      gens: docsGenerations(),
      caches: docsCaches(),
      nowMs: opts.nowMs ?? Date.now,
    }),
  };
}

/** The value a composition holds for `node`. A composition without one is a wiring defect: registration throws,
 *  so no route is ever registered over a missing reader or lane. */
function forNode<T>(nodes: DocsNodes<T>, node: string, what: string): T {
  const value = nodes.byNode.get(node);
  if (value === undefined) throw new Error(`docs routes: no ${what} for node '${node}'`);
  return value;
}

/**
 * The signal that the client left before its answer (refinement (j)): it aborts on the RESPONSE's `close` while the
 * response has not finished, and at once when the response is already destroyed unfinished (the client went while
 * an earlier hook ran). Measured on the response, never on the request stream, whose own `close` means different
 * things on different node versions. Single-flight aborts a flight only when every joiner's signal has aborted.
 */
function clientGone(reply: FastifyReply): AbortSignal {
  const gone = new AbortController();
  const res = reply.raw;
  if (res.destroyed && !res.writableFinished) gone.abort();
  else res.once('close', () => { if (!res.writableFinished) gone.abort(); });
  return gone.signal;
}

/** Every requester of an abandoned job has gone: send nothing, take the reply from Fastify, and end the socket if
 *  it is still open. */
function abandon(reply: FastifyReply): FastifyReply {
  reply.hijack();
  if (!reply.raw.destroyed) reply.raw.destroy();
  return reply;
}

/** A lane run that produced no value: `abandoned` ends the request unanswered; `busy` sends the lane's own body. */
function notRan(reply: FastifyReply, run: Exclude<DocsLaneRun<unknown>, { kind: 'ran' }>): FastifyReply {
  return run.kind === 'abandoned' ? abandon(reply) : sendDocsFailure(reply, run.body);
}

/** A route's query as Fastify's default parser hands it over (an own key per name, an array for a repeated key);
 *  read by L1's parser alone. */
type DocsQuery = Readonly<Record<string, unknown>>;
/** The `:project` parameter, read by L1's parser alone. */
type DocsParams = Readonly<{ project?: unknown }>;
type TreeRequest = Extract<DocsApiRequest, { route: 'tree' }>;
type FileRequest = Extract<DocsApiRequest, { route: 'file' }>;
type HistoryRequest = Extract<DocsApiRequest, { route: 'history' }>;
type RangeRequest = Extract<DocsApiRequest, { route: 'range' }>;

/** An ok index the adapter passed, believed only after `docsAnswerShape`; a believed index fills the node's
 *  micro-cache only when L1's `docsIndexCacheable` says the node's generation is still `gen`, the one its flight
 *  began at: an index begun before a refresh's fetch settled is served to the requests that joined it, never cached
 *  past that refresh (section 6.5). A failure is handed back as it came. */
function believeIndex(at: DocsNodeLanes, node: string, gen: number, got: DocsIndexRead): DocsIndexRead {
  if (!got.ok) return got;
  const shape = docsAnswerShape('docs-index', got.answer);
  if (!shape.ok) {
    console.warn('ccrc-server: docs index answer failed its shape check');
    return shape;
  }
  if (!docsIndexCacheable(gen, at.gens.current(docsNodeKey(node)))) return got;
  at.caches.index.set(node, got.answer, at.nowMs());
  return got;
}

/** An ok tree the adapter passed, believed only after `docsAnswerShape` (refinement (f)) and `docsTreeEcho` (it names
 *  the project the request named): only then does it feed the listing map and the draft size map, and only then may
 *  `refreshDue` read it. A failure is handed back as it came. */
function believeTree(at: DocsNodeLanes, src: DocsSourceId, got: DocsTreeRead): DocsTreeRead {
  const node = src.node;
  if (!got.ok) return got;
  const shape = docsAnswerShape('docs-tree', got.answer);
  if (!shape.ok) {
    console.warn('ccrc-server: docs tree answer failed its shape check');
    return shape;
  }
  const echo = docsTreeEcho(got.answer, src.project);
  if (!echo.ok) {
    console.warn('ccrc-server: docs tree answer named another project');
    return echo;
  }
  at.caches.listing.record(node, got.answer, at.nowMs());
  at.caches.draftSizes.record(node, got.answer);
  return got;
}

/** An ok show the adapter passed, believed only after `docsAnswerShape` and `docsShowBound` (refinement (g)); a
 *  believed show fills the blob cache exactly when `docsCacheFill` says so. A failure is handed back as it came. */
function believeShow(at: DocsNodeLanes, node: string, pin: DocPin, listed: { repoKey: string; file: DocsListedFile } |
  undefined, job: DocsJob, got: DocsShowRead): DocsShowRead {
  if (!got.ok) return got;
  const shape = docsAnswerShape('docs-show', got.answer);
  if (!shape.ok) {
    console.warn('ccrc-server: docs show answer failed its shape check');
    return shape;
  }
  const bound = docsShowBound(job, got.bytes);
  if (!bound.ok) {
    console.warn('ccrc-server: docs show answer over the bound the server asked for');
    return bound;
  }
  if (listed !== undefined && docsCacheFill(pin, listed.file)) {
    const answer = docsStoredShow(got.answer, got.bytes);
    at.caches.blobs.set(node, listed.repoKey, listed.file.blob, { answer, bytes: got.bytes });
  }
  return got;
}

/** An ok log the adapter passed, believed only after `docsAnswerShape` (rich-docs spec G4; refinement (f)). A failure is
 *  handed back as it came. Nothing is cached: a log is cheap, and its route answers `no-store` like every JSON. */
function believeLog(got: DocsLogRead): DocsLogRead {
  if (!got.ok) return got;
  const shape = docsAnswerShape('docs-log', got.answer);
  if (!shape.ok) {
    console.warn('ccrc-server: docs log answer failed its shape check');
    return shape;
  }
  return got;
}

/** An ok range prepare the adapter passed, believed only after `docsRangeAnswerShape` (X2 P1). A failure is handed back as
 *  it came. Nothing is cached: a snapshot lives in ccd's own cache, and the route answers `no-store` like every JSON. */
function believeRangePrepare<T extends DocsRangePrepareRead | DocsFolderPrepareRead>(got: T): T | DocsFailureBody {
  if (!got.ok) return got;
  const shape = docsRangeAnswerShape('prepare', got.answer);
  if (!shape.ok) {
    console.warn('ccrc-server: docs range prepare answer failed its shape check');
    return shape;
  }
  return got;
}

/** An ok range frame the adapter passed, believed only after `docsRangeAnswerShape`. A failure is handed back as it came. */
function believeRangeFrame<T extends DocsRangeFrameRead | DocsFolderFrameRead>(got: T): T | DocsFailureBody {
  if (!got.ok) return got;
  const shape = docsRangeAnswerShape('frame', got.answer);
  if (!shape.ok) {
    console.warn('ccrc-server: docs range frame answer failed its shape check');
    return shape;
  }
  return got;
}

/** The two adapter calls of one range read: a project's or a folder's prepare, and its frame of an ask. */
interface RangeCalls {
  prepare: () => Promise<DocsRangePrepareRead | DocsFolderPrepareRead>;
  frame: (ask: DocsRangeFrameAsk) => Promise<DocsRangeFrameRead | DocsFolderFrameRead>;
}

/**
 * One range read (X2 P1, spec 4.3; the folder door shares it, P2.3): join the flight under `key`, book the read lane with
 * the plan's `job`, call the adapter's prepare (`frame` is null) or its frame, believe the answer only after
 * `docsRangeAnswerShape`, and send exactly the fields the PWA reads. Nothing is cached: a snapshot is ccd's own, and the
 * answer is `no-store` like every JSON. `fail` sends a refusal: a project's as it came, a folder's through L1's filter.
 */
async function serveRange(at: DocsNodeLanes, reply: FastifyReply, key: string, job: DocsJob, frame: DocsRangeFrameAsk | null,
  calls: RangeCalls, fail: (reply: FastifyReply, body: DocsFailureBody) => FastifyReply): Promise<FastifyReply> {
  if (frame === null) {
    const run = await at.flights.join(key, clientGone(reply),
      (flight) => at.read.run(job, flight, async () => believeRangePrepare(await calls.prepare())));
    if (run.kind !== 'ran') return notRan(reply, run);
    if (!run.value.ok) return fail(reply, run.value);
    const { snapshot, size, digest } = run.value.answer;
    const prepared: DocsRangePrepareResponse = { ok: true, prepared: { snapshot, size, digest } };
    return reply.send(prepared);
  }
  const run = await at.flights.join(key, clientGone(reply),
    (flight) => at.read.run(job, flight, async () => believeRangeFrame(await calls.frame(frame))));
  if (run.kind !== 'ran') return notRan(reply, run);
  if (!run.value.ok) return fail(reply, run.value);
  const { snapshot, offset, bytesB64, digest, total } = run.value.answer;
  const framed: DocsRangeFrameResponse = { ok: true, frame: { snapshot, offset, bytesB64, digest, total } };
  return reply.send(framed);
}

/**
 * One tree read (section 6.4): join the tree flight of (node, project, ref, the project's CURRENT generation), whose
 * starter books `LISTING_JOB` on the read lane; the answer is believed (and recorded) once, inside the flight, before
 * any joiner sees it. Task 7's refresh reads its tree half through this same function after bumping the generation.
 */
export function readTree(reader: DocsReader, at: DocsNodeLanes, src: DocsSourceId, ref: DocsRefSpec | null,
  signal: AbortSignal): Promise<DocsLaneRun<DocsTreeRead>> {
  const gen = at.gens.current(docsProjectKey(src.node, src.project));
  return at.flights.join(docsTreeFlightKey(src.node, src.project, ref, gen), signal,
    (flight) => at.read.run(LISTING_JOB, flight, async () => believeTree(at, src, await reader.tree(src, ref))));
}

/** A believed tree's 200 body: the tree as ccd answered it, and L1's `refreshDue` over it. */
function treeResponse(tree: DocsTreeOk): DocsTreeResponse {
  return { ok: true, tree, refreshDue: refreshDue(tree) };
}

/** Send L1's file representation: a refusal as its failure body, JSON as it is (the response policy makes it
 *  `no-store`), raster bytes with L1's MIME type and `Cache-Control`, exactly those bytes. */
function sendFile(reply: FastifyReply, out: DocsFileReply | DocsFolderFileReply): FastifyReply {
  if (out.kind === 'refuse') return sendDocsFailure(reply, out.body);
  if (out.kind === 'json') return reply.send(out.body);
  return reply.code(200).type(out.mime).header('cache-control', out.cacheControl)
    .send(Buffer.from(out.bytes.buffer, out.bytes.byteOffset, out.bytes.byteLength));
}

/**
 * The docs reads (section 3.4; the range read, X2 P1), on the docs plugin's own instance, each with `exposeHeadRoute: false`
 * (refinement (c): a HEAD would run the whole GET for a discarded body), and an `onClose` that closes every node's
 * read and fetch lane, so a closing server answers every queued job `docs-busy` instead of leaving it to its wait.
 * Each handler parses `:project` and the query with L1's parsers (a refusal is sent before any exec), probes its
 * cache, joins its flight, and books the read lane; every failure body is sent verbatim. The history read has no
 * cache to probe: it goes straight to its flight and the read lane.
 */
export function registerDocsReadRoutes(app: FastifyInstance, readers: DocsNodes<DocsReader>,
  lanes: DocsNodes<DocsNodeLanes>): void {
  const node = readers.primary;
  const reader = forNode(readers, node, 'reader');
  const at = forNode(lanes, node, 'lanes');

  app.addHook('onClose', async () => {
    for (const each of lanes.byNode.values()) {
      each.read.close();
      each.fetch.close();
    }
  });

  app.get('/api/docs/projects', { exposeHeadRoute: false }, async (req, reply) => {
    const q = parseDocsApiQuery('projects', req.query as DocsQuery);
    if (!q.ok) return sendDocsFailure(reply, q);
    const hit = at.caches.index.get(node, at.nowMs());
    if (hit !== undefined) {
      const cached: DocsProjectsResponse = { ok: true, index: hit.index, cacheAgeMs: hit.ageMs };
      return reply.send(cached);
    }
    const gen = at.gens.current(docsNodeKey(node));
    const run = await at.flights.join(docsIndexFlightKey(node, gen), clientGone(reply),
      (flight) => at.read.run(LISTING_JOB, flight,
        async () => believeIndex(at, node, gen, await reader.index({ node }))));
    if (run.kind !== 'ran') return notRan(reply, run);
    if (!run.value.ok) return sendDocsFailure(reply, run.value);
    const fresh: DocsProjectsResponse = { ok: true, index: run.value.answer, cacheAgeMs: null };
    return reply.send(fresh);
  });

  app.get('/api/docs/:project/tree', { exposeHeadRoute: false }, async (req, reply) => {
    const p = parseDocsProjectParam((req.params as DocsParams).project);
    if (!p.ok) return sendDocsFailure(reply, p);
    const q = parseDocsApiQuery('tree', req.query as DocsQuery);
    if (!q.ok) return sendDocsFailure(reply, q);
    const { ref } = q.req as TreeRequest;
    const run = await readTree(reader, at, { node, project: p.project }, ref, clientGone(reply));
    if (run.kind !== 'ran') return notRan(reply, run);
    if (!run.value.ok) return sendDocsFailure(reply, run.value);
    return reply.send(treeResponse(run.value.answer));
  });

  app.get('/api/docs/:project/history', { exposeHeadRoute: false }, async (req, reply) => {
    const p = parseDocsProjectParam((req.params as DocsParams).project);
    if (!p.ok) return sendDocsFailure(reply, p);
    const q = parseDocsApiQuery('history', req.query as DocsQuery);
    if (!q.ok) return sendDocsFailure(reply, q);
    const { ask } = q.req as HistoryRequest;
    const src: DocsSourceId = { node, project: p.project };
    const run = await at.flights.join(docsLogFlightKey(node, src.project, ask), clientGone(reply),
      (flight) => at.read.run(HISTORY_JOB, flight, async () => believeLog(await reader.log(src, ask))));
    if (run.kind !== 'ran') return notRan(reply, run);
    if (!run.value.ok) return sendDocsFailure(reply, run.value);
    const body: DocsHistoryResponse = { ok: true, log: run.value.answer };
    return reply.send(body);
  });

  // X2 P1 (spec 4.3): one file read in frames. The query parser and `docsRangePlan` refuse before any exec; a prepare and a
  // frame each join their own flight and book the read lane with the plan's job. Nothing is cached here: the snapshot is
  // ccd's own, and the answer is `no-store` like every JSON.
  app.get('/api/docs/:project/range', { exposeHeadRoute: false }, async (req, reply) => {
    const p = parseDocsProjectParam((req.params as DocsParams).project);
    if (!p.ok) return sendDocsFailure(reply, p);
    const q = parseDocsApiQuery('range', req.query as DocsQuery);
    if (!q.ok) return sendDocsFailure(reply, q);
    const plan = docsRangePlan((q.req as RangeRequest).query);
    if (!plan.ok) return sendDocsFailure(reply, plan);
    const { target, frame, job } = plan;
    const src: DocsSourceId = { node, project: p.project };
    return serveRange(at, reply, docsRangeFlightKey(node, src.project, target, frame), job, frame, {
      prepare: () => reader.range.prepare(src, target),
      frame: (ask) => reader.range.frame(src, target, ask),
    }, sendDocsFailure);
  });

  app.get('/api/docs/:project/file', { exposeHeadRoute: false }, async (req, reply) => {
    const p = parseDocsProjectParam((req.params as DocsParams).project);
    if (!p.ok) return sendDocsFailure(reply, p);
    const q = parseDocsApiQuery('file', req.query as DocsQuery);
    if (!q.ok) return sendDocsFailure(reply, q);
    const { pin } = q.req as FileRequest;
    const src: DocsSourceId = { node, project: p.project };
    const listed = pin.kind === 'committed'
      ? at.caches.listing.lookup(node, src.project, pin.commit, pin.section, pin.path) : undefined;
    const draftSize = pin.kind === 'draft' ? at.caches.draftSizes.get(node, pin.fp) : undefined;
    const plan = docsShowPlan(pin.path, docsKnownSize(pin, listed?.file, draftSize));
    if (pin.kind === 'committed' && listed !== undefined) {
      const ageMs = at.caches.listing.servedRefAgeMs(node, src.project, pin.commit, pin.servedRef, at.nowMs());
      const hit = docsCacheVerdict(listed.file, ageMs).eligible
        ? at.caches.blobs.get(node, listed.repoKey, listed.file.blob) : undefined;
      if (hit !== undefined) {
        return sendFile(reply,
          docsFileReply(pin, docsCacheHitAnswer(hit.answer, pin, listed.file.blob), hit.bytes, 'cache'));
      }
    }
    const ask = { maxBytes: plan.maxBytes, job: plan.job, listedBlob: listed?.file.blob ?? null };
    const run = await at.flights.join(docsShowFlightKey(node, src.project, pin, plan.maxBytes), clientGone(reply),
      (flight) => at.read.run(plan.job, flight,
        async () => believeShow(at, node, pin, listed, plan.job, await reader.show(src, pin, ask))));
    if (run.kind !== 'ran') return notRan(reply, run);
    if (!run.value.ok) return sendDocsFailure(reply, run.value);
    return sendFile(reply, docsFileReply(pin, run.value.answer, run.value.bytes, 'ccd'));
  });
}

// ===== Task 7: the refresh (section 3.4's refresh flow, section 6.4; refinement (m)) =====

/** What one refresh flight's fetch half came to: L1's verdict over the fetch (`refuse`, or a `half` to carry), or
 *  `abandoned`: every requester left before the fetch started, so no fetch ran and nothing settled. */
type RefreshFetchOutcome = DocsRefreshHalf | { kind: 'abandoned' };

/** An ok fetch the adapter passed, believed only after `docsAnswerShape` (refinement (f); W2's carry names the fetch
 *  answer too): one nested past the bound would throw at reply serialisation. A failure is handed back as it came. */
function believeFetch(got: DocsFetchRun): DocsFetchRun {
  if (!got.ok) return got;
  const shape = docsAnswerShape('docs-fetch', got.answer);
  if (!shape.ok) {
    console.warn('ccrc-server: docs fetch answer failed its shape check');
    return shape;
  }
  return got;
}

/** A refresh's fetch half has settled, ran, failed or skipped (refinement (m)): bump the project's generation, so
 *  the tree read that follows starts a NEW flight and never joins one begun before the fetch (section 3.4, section
 *  6.4); bump the node's generation, so no index begun before the fetch is joined or cached after it; and drop the
 *  node's index micro-cache (section 6.5). */
function fetchSettled(at: DocsNodeLanes, src: DocsSourceId): void {
  at.gens.bump(docsProjectKey(src.node, src.project));
  at.gens.bump(docsNodeKey(src.node));
  at.caches.index.drop(src.node);
}

/**
 * One refresh flight's fetch half (section 6.4: a refresh joins by (node, project, branch)): book the project's
 * fetch-lane key, believe the answer, and take L1's verdict (`docsRefreshFetchHalf`) over the answer or over the
 * lane's own `docs-busy` body. A half that settled is marked HERE, inside the flight, once per fetch and before any
 * joiner reads its tree, so every joiner of one fetch reads the same new generation. A refusal settles nothing.
 */
async function fetchHalf(fetcher: DocsFetcher, at: DocsNodeLanes, src: DocsSourceId, branch: string | null,
  flight: AbortSignal): Promise<RefreshFetchOutcome> {
  const run = await at.fetch.run(docsProjectKey(src.node, src.project), flight,
    async () => believeFetch(await fetcher.fetch(src, branch)));
  if (run.kind === 'abandoned') return run;
  const half = docsRefreshFetchHalf(run.kind === 'busy' ? run.body : run.value);
  if (half.kind === 'half') fetchSettled(at, src);
  return half;
}

/** The tree half of a refresh's 200 (section 3.5's `DocsRefreshResponse.tree`): a believed tree's response, or the
 *  failure body as it came, the read lane's own `docs-busy` included (a body here, never a status). */
function treeHalf(run: Exclude<DocsLaneRun<DocsTreeRead>, { kind: 'abandoned' }>): DocsTreeResponse | DocsFailureBody {
  if (run.kind === 'busy') return run.body;
  return run.value.ok ? treeResponse(run.value.answer) : run.value;
}

/**
 * The refresh (section 3.4's refresh flow; refinement (m)): the ONLY docs registration that receives a fetcher
 * (section 2 (g)'s wall 1). In order:
 * 1. `:project` and the body through L1's parsers (`parseDocsProjectParam`, `parseDocsRefreshBody`): a refusal is
 *    sent with its own status before any exec. A `text/plain` body reaches the handler as a string and is refused
 *    here; a body Fastify itself refuses is answered by the plugin's error handler (Task 3).
 * 2. `fetchBranchFor(ref)`: `skipped` (a local ref) settles at once with no exec; `fetch` joins the refresh flight
 *    of (node, project, branch), whose starter books the fetch lane (`fetchHalf`). A refusal before any exec (the
 *    gate's `caps-unknown` or `unsupported`, the fetch lane's `docs-busy`) is the whole answer, with its own status
 *    and `Retry-After`; `abandoned` ends the request unanswered.
 * 3. A failed half logs `ccrc-server: docs <reason> refresh of <project> failed: <word>` when `docsLogDue` says so
 *    for that word; `reason` changes nothing else.
 * 4. The tree half: `readTree` at the generation the settle bumped, so it never joins a flight begun before the
 *    fetch; the index micro-cache is dropped again once it completes.
 * 5. L1's `docsRefreshAnswer` over the two halves: a skipped fetch whose tree half was refused before any exec is
 *    the whole answer, with that word's own status and `Retry-After` (no exec ran at all); otherwise 200 `{ok: true,
 *    fetch, tree}`: each half carries its own word, and a failed fetch never replaces the listing.
 */
export function registerDocsRefreshRoute(app: FastifyInstance, readers: DocsNodes<DocsReader>,
  fetchers: DocsNodes<DocsFetcher>, lanes: DocsNodes<DocsNodeLanes>): void {
  const node = readers.primary;
  const reader = forNode(readers, node, 'reader');
  const fetcher = forNode(fetchers, node, 'fetcher');
  const at = forNode(lanes, node, 'lanes');
  const lastLogged = new Map<string, number>();

  const logFailed = (reason: DocsRefreshRequest['reason'], project: string, failure: DocsFailureBody): void => {
    const now = at.nowMs();
    if (!docsLogDue(lastLogged.get(failure.failure), now)) return;
    lastLogged.set(failure.failure, now);
    console.warn(`ccrc-server: docs ${reason} refresh of ${project} failed: ${failure.failure}`);
  };

  app.post('/api/docs/:project/refresh', async (req, reply) => {
    const p = parseDocsProjectParam((req.params as DocsParams).project);
    if (!p.ok) return sendDocsFailure(reply, p);
    const body = parseDocsRefreshBody(req.body);
    if (!body.ok) return sendDocsFailure(reply, body);
    const { ref, reason } = body.req;
    const src: DocsSourceId = { node, project: p.project };
    const gone = clientGone(reply);
    const plan = fetchBranchFor(ref);
    let fetch: DocsRefreshFetch;
    if (plan.kind === 'skipped') {
      fetchSettled(at, src);
      fetch = DOCS_REFRESH_SKIPPED;
    } else {
      const fetched = await at.flights.join(docsRefreshFlightKey(node, src.project, plan.branch), gone,
        (flight) => fetchHalf(fetcher, at, src, plan.branch, flight));
      if (fetched.kind === 'abandoned') return abandon(reply);
      if (fetched.kind === 'refuse') return sendDocsFailure(reply, fetched.body);
      fetch = fetched.fetch;
    }
    if (fetch.state === 'failed') logFailed(reason, src.project, fetch.failure);
    const tree = await readTree(reader, at, src, ref, gone);
    at.caches.index.drop(node);
    if (tree.kind === 'abandoned') return abandon(reply);
    const answer = docsRefreshAnswer(fetch, treeHalf(tree));
    if (answer.kind === 'refuse') return sendDocsFailure(reply, answer.body);
    return reply.send(answer.body);
  });
}

// ===== X2 P2.3: the outside-folder doors (spec 4.1 and 7) =====

/** What the folder READ doors need of the composition root: the sign-in state (`dark` or `armed`, read per request so a test
 *  or a re-arm is seen) and whether a request carries a session. Readers only: this file imports no coordination module and
 *  measures nothing itself. */
export interface DocsFolderReadDeps {
  signIn: () => DocsSignIn;
  hasSession: (req: FastifyRequest) => boolean;
}

/** What the registry doors (Add and Remove) need: the same two, and the account gate the Add door asks, with its step-up. */
export interface DocsFolderRegistryDeps extends DocsFolderReadDeps {
  gate: AccountGate;
}

/** A refusal as a folder door sends it: L1's `docsFolderFailureBody` over the body, so only the word and the structured
 *  fields leave, and no free text (`detail`, `stderrHead`, `cause`, ...) that could carry a path. */
function sendFolderFailure(reply: FastifyReply, body: DocsFailureBody): FastifyReply {
  return sendDocsFailure(reply, docsFolderFailureBody(body));
}

/** The `:label` parameter, read by L1's parser alone. */
type FolderParams = Readonly<{ label?: unknown }>;
type FolderFileRequest = Extract<DocsApiRequest, { route: 'folder-file' }>;
type FolderRangeRequest = Extract<DocsApiRequest, { route: 'folder-range' }>;

/** An ok folder tree is already held to its shape and its label by the adapter; nothing more is believed here. A folder show
 *  the adapter passed, believed only after `docsAnswerShape` and `docsShowBound`, as a project show is. Log lines name the
 *  label only, never a path. A failure is handed back as it came. */
function believeFolderShow(label: string, job: DocsJob, got: DocsFolderShowRead): DocsFolderShowRead {
  if (!got.ok) return got;
  const shape = docsAnswerShape('docs-folder-read', got.answer);
  if (!shape.ok) {
    console.warn(`ccrc-server: docs folder ${label} show answer failed its shape check`);
    return shape;
  }
  const bound = docsShowBound(job, got.bytes);
  if (!bound.ok) {
    console.warn(`ccrc-server: docs folder ${label} show answer over the bound the server asked for`);
    return bound;
  }
  return got;
}

/**
 * The five outside-folder READ doors (X2 P2.3; spec 4.1 and 7), on the docs plugin's own instance, so the marker header check
 * and the response policy apply. It takes the readers and the lanes and NO registry: no read handler has a write in scope
 * (the type wall `docs-folder-routes.test.ts` pins, as row 49 pins `registerDocsReadRoutes`). Like every docs handler this
 * one decides nothing: the label and the queries and the range plan are L1's, and the sign-in verdict is L1's
 * `folderReadGate`, asked FIRST on every door (the two listings and the three folder reads), so a dark box or a request
 * without a session is refused before any exec. NO answer, error body or log line carries a folder's absolute path but
 * `GET /api/docs-folders/paths`: bodies are built from known fields (L1), refusals carry no free text, and log lines name
 * the label only.
 */
export function registerDocsFolderReadRoutes(app: FastifyInstance, readers: DocsNodes<DocsFolderReader>,
  lanes: DocsNodes<DocsNodeLanes>, deps: DocsFolderReadDeps): void {
  const node = readers.primary;
  const folders = forNode(readers, node, 'folder reader');
  const at = forNode(lanes, node, 'lanes');
  const registryKey = docsFolderKey(node, '');

  /** The folder read gate, asked first: `null` lets the door go on, otherwise the refusal is already sent. */
  const refusedRead = (req: FastifyRequest, reply: FastifyReply): FastifyReply | null => {
    const verdict = folderReadGate(deps.signIn(), deps.hasSession(req));
    if (verdict === 'allow') return null;
    return sendFolderFailure(reply, folderGateRefusal(verdict));
  };

  /** One listing of the registry, through its own flight and the read lane. */
  const listed = async (reply: FastifyReply): Promise<Exclude<DocsLaneRun<DocsFolderListRead>, { kind: 'abandoned' }> | null> => {
    const gen = at.gens.current(registryKey);
    const run = await at.flights.join(docsFolderListFlightKey(node, gen), clientGone(reply),
      (flight) => at.read.run(LISTING_JOB, flight, () => folders.list({ node })));
    if (run.kind === 'abandoned') {
      abandon(reply);
      return null;
    }
    return run;
  };

  app.get('/api/docs-folders', { exposeHeadRoute: false }, async (req, reply) => {
    const refused = refusedRead(req, reply);
    if (refused !== null) return refused;
    const q = parseDocsApiQuery('folder-list', req.query as DocsQuery);
    if (!q.ok) return sendFolderFailure(reply, q);
    const run = await listed(reply);
    if (run === null) return reply;
    if (run.kind === 'busy') return sendFolderFailure(reply, run.body);
    if (!run.value.ok) return sendFolderFailure(reply, run.value);
    const body: DocsFoldersLabelsResponse = { ok: true, folders: docsFolderLabelRows(run.value.answer.folders) };
    return reply.send(body);
  });

  // The ONE door whose answer carries an absolute path: Settings' Docs folders section, which names it by `docsApi`.
  app.get('/api/docs-folders/paths', { exposeHeadRoute: false }, async (req, reply) => {
    const refused = refusedRead(req, reply);
    if (refused !== null) return refused;
    const q = parseDocsApiQuery('folder-list', req.query as DocsQuery);
    if (!q.ok) return sendFolderFailure(reply, q);
    const run = await listed(reply);
    if (run === null) return reply;
    if (run.kind === 'busy') return sendFolderFailure(reply, run.body);
    if (!run.value.ok) return sendFolderFailure(reply, run.value);
    const body: DocsFoldersPathsResponse = { ok: true, folders: run.value.answer.folders };
    return reply.send(body);
  });

  app.get('/api/docs-folders/:label/tree', { exposeHeadRoute: false }, async (req, reply) => {
    const refused = refusedRead(req, reply);
    if (refused !== null) return refused;
    const l = parseDocsFolderLabel((req.params as FolderParams).label);
    if (!l.ok) return sendFolderFailure(reply, l);
    const q = parseDocsApiQuery('folder-tree', req.query as DocsQuery);
    if (!q.ok) return sendFolderFailure(reply, q);
    const id: DocsFolderId = { node, label: l.label };
    const gen = at.gens.current(docsFolderKey(node, id.label));
    const run = await at.flights.join(docsFolderTreeFlightKey(node, id.label, gen), clientGone(reply),
      (flight) => at.read.run(LISTING_JOB, flight, (): Promise<DocsFolderTreeRead> => folders.tree(id)));
    if (run.kind !== 'ran') return notRan(reply, run);
    if (!run.value.ok) return sendFolderFailure(reply, run.value);
    const body: DocsFolderTreeResponse = { ok: true, tree: docsFolderTreeBody(run.value.answer) };
    return reply.send(body);
  });

  app.get('/api/docs-folders/:label/file', { exposeHeadRoute: false }, async (req, reply) => {
    const refused = refusedRead(req, reply);
    if (refused !== null) return refused;
    const l = parseDocsFolderLabel((req.params as FolderParams).label);
    if (!l.ok) return sendFolderFailure(reply, l);
    const q = parseDocsApiQuery('folder-file', req.query as DocsQuery);
    if (!q.ok) return sendFolderFailure(reply, q);
    const { ask } = q.req as FolderFileRequest;
    const id: DocsFolderId = { node, label: l.label };
    const plan = docsShowPlan(ask.path, undefined);
    const gen = at.gens.current(docsFolderKey(node, id.label));
    const run = await at.flights.join(docsFolderShowFlightKey(node, id.label, ask, plan.maxBytes, gen), clientGone(reply),
      (flight) => at.read.run(plan.job, flight,
        async () => believeFolderShow(id.label, plan.job, await folders.show(id, ask, { maxBytes: plan.maxBytes, job: plan.job }))));
    if (run.kind !== 'ran') return notRan(reply, run);
    if (!run.value.ok) return sendFolderFailure(reply, run.value);
    return sendFile(reply, docsFolderFileReply(run.value.answer, run.value.bytes));
  });

  app.get('/api/docs-folders/:label/range', { exposeHeadRoute: false }, async (req, reply) => {
    const refused = refusedRead(req, reply);
    if (refused !== null) return refused;
    const l = parseDocsFolderLabel((req.params as FolderParams).label);
    if (!l.ok) return sendFolderFailure(reply, l);
    const q = parseDocsApiQuery('folder-range', req.query as DocsQuery);
    if (!q.ok) return sendFolderFailure(reply, q);
    const plan = docsFolderRangePlan((q.req as FolderRangeRequest).query);
    if (!plan.ok) return sendFolderFailure(reply, plan);
    const { target, frame, job } = plan;
    const id: DocsFolderId = { node, label: l.label };
    const gen = at.gens.current(docsFolderKey(node, id.label));
    return serveRange(at, reply, docsFolderRangeFlightKey(node, id.label, target, frame, gen), job, frame, {
      prepare: () => folders.range.prepare(id, target),
      frame: (ask) => folders.range.frame(id, target, ask),
    }, sendFolderFailure);
  });
}

/**
 * The folder REGISTRY doors, Add and Remove (X2 P2.3; spec 4.1 and 7), registered apart from the reads: this function holds the
 * registry and no reader, the read one holds the readers and no registry. Both run in the FETCH lane, keyed by the folder's
 * generation key (`docsFolderKey`): one write per label at a time, two at once across labels, eight waiting, the wait
 * bounded, as the refresh door's fetch is bounded (the one existing lane that bounds a ccd write; a lane of its own would be
 * a second mechanism for the same job). Each write bumps its label's generation and the registry's BEFORE it execs and after
 * it settles, whatever the outcome (ok, refused, or a throw), so a read flight begun before a write is never joined by a
 * read begun after it.
 * - Add: a widening. The account gate first (dark, an insecure origin, no session, no cap, and the step-up, in its own
 *   order), then the body through L1, then the verb. A refusal body never echoes the path.
 * - Remove: a narrowing, so it works while sign-in is dark and asks no account gate; L1's `folderRemoveGate` still holds an
 *   armed box to a session. The label check applies.
 */
export function registerDocsFolderRegistryRoutes(app: FastifyInstance, registries: DocsNodes<DocsFolderRegistry>,
  lanes: DocsNodes<DocsNodeLanes>, deps: DocsFolderRegistryDeps): void {
  const node = registries.primary;
  const registry = forNode(registries, node, 'folder registry');
  const at = forNode(lanes, node, 'lanes');
  const registryKey = docsFolderKey(node, '');

  /** One write of `label`'s registry entry in the fetch lane, its generations bumped around it. */
  const written = <T>(reply: FastifyReply, label: string, write: () => Promise<T>): Promise<DocsLaneRun<T>> => {
    const bump = (): void => {
      at.gens.bump(docsFolderKey(node, label));
      at.gens.bump(registryKey);
    };
    return at.fetch.run(docsFolderKey(node, label), clientGone(reply), async () => {
      bump();
      try {
        return await write();
      } finally {
        bump();
      }
    });
  };

  app.post('/api/docs-folders', async (req, reply) => {
    if (!deps.gate(req, reply, { cap: DOCS_FOLDERS_CAP, stepUp: true }).pass) return reply;
    const body = parseDocsFolderAddBody(req.body);
    if (!body.ok) return sendFolderFailure(reply, body);
    const { label, path } = body.req;
    const run = await written(reply, label, () => registry.add({ node }, label, path));
    if (run.kind !== 'ran') return notRan(reply, run);
    if (!run.value.ok) return sendFolderFailure(reply, run.value);
    const sent: DocsFolderAddResponse = { ok: true, label: run.value.answer.label };
    return reply.send(sent);
  });

  app.delete('/api/docs-folders/:label', async (req, reply) => {
    const gate = folderRemoveGate(deps.signIn(), deps.hasSession(req));
    if (gate !== 'allow') return sendFolderFailure(reply, folderGateRefusal(gate));
    const l = parseDocsFolderLabel((req.params as FolderParams).label);
    if (!l.ok) return sendFolderFailure(reply, l);
    const q = parseDocsApiQuery('folder-remove', req.query as DocsQuery);
    if (!q.ok) return sendFolderFailure(reply, q);
    const run = await written(reply, l.label, () => registry.remove({ node }, l.label));
    if (run.kind !== 'ran') return notRan(reply, run);
    if (!run.value.ok) return sendFolderFailure(reply, run.value);
    const sent: DocsFolderRemoveResponse = { ok: true, label: run.value.answer.label, removed: true };
    return reply.send(sent);
  });
}
