// The artifact content door's engine (native Docs HTML artifacts X5, plan Task A3.3; spec
// docs/superpowers/specs/2026-11-19-native-docs-html-artifacts-design.md sections 3.4, 4.3 and 5). Ring L4, context C9: it owns the
// queue's timers (a wait, a prepare's wait, a frame's stall deadline and a response's deadline), so it is delivery. It decides
// nothing itself: every verdict (the raw path, the host, the fences, the range, the answers, the headers, the prepare slot, what a
// failed read becomes) is a pure function of `policy.ts`, and this file calls them in the design's order and acts.
//
// It imports no web framework. It talks to the reply through the small `ContentReply` interface below, which `routes.ts` implements
// over the instance's reply, and it imports nothing from the docs plugin: the bytes come through the `ArtifactBytes` port.
//
// WHAT A REQUEST DOES, in order, each refusal a fixed answer that echoes nothing of the request:
//   host, raw path, capability, fetch fences, manifest key, range (the identical 404, 403 or 416); touch; a HEAD answers its head
//   now with no admission; admission (run, wait in the queue for at most `ARTIFACT_QUEUE_WAIT_MS`, or 429); then, running, a second
//   look-up before anything is read, the hour's byte charge, the end subscription, the response deadline, a snapshot for a file
//   above `DOCS_LANE_LARGE_RAW`, and the frames through the sink.
//
// ONE EXIT, ONCE. Every way a running request ends (its last frame, the client's close, a capability's end, either deadline, a
// failed read, a throw) goes through one `terminate`, which clears both timers, unsubscribes, aborts the port's signal, answers or
// destroys, and calls `store.release(ticket)`; only that call frees a slot, and the store frees a ticket once. A throw before the
// head is written is handed back to the route handler, so the instance's own error handler answers its fixed 500 (and logs nothing);
// a throw after the head destroys the socket. Nothing here logs.
import { ARTIFACT_FRAME_STALL_MS, ARTIFACT_RESPONSE_MAX_MS } from '../../../shared/artifacts.js';
import type { ArtifactBytes, ArtifactReadAt } from './ports.js';
import {
  ARTIFACT_PREPARE_RETRY_MS, artifactFramed, budgetSpent, contentAnswer, contentFence, contentHeaders, contentKey,
  contentRequestPath, contentStatus, frameFits, parseRange, prepareFailureAction, prepareSlot, prepareTimeoutAction,
  prepareWaitUntil, queueWaitLeft, readEndVerdict, readFailureAction, responseLength, routeHostOk, secondsLeftOf,
  statusAnswerKind, unsatisfiableAnswer, withPrepareStart, type ReadFailureAction,
} from './policy.js';
import { expiresAt, type ArtifactManifestEntry, type ArtifactStore, type Capability } from './store.js';

/** What the door reads of a request: the raw URL (never the router's decoded parameter), the `Host`, the method, and the header
 *  values the fences and the range need, as they came. */
export interface ContentRequest {
  rawUrl: string;
  host: string | undefined;
  method: 'GET' | 'HEAD';
  dest?: string | string[];
  mode?: string | string[];
  site?: string | string[];
  serviceWorker?: string | string[];
  range?: string;
}

/** The reply as the door sees it. `notFound` and `fixed` answer through the framework (its hardening headers and error handling
 *  apply) and are only for a request that has written no byte. `head` takes the reply over and writes the head on the raw
 *  response; after it `write`, `end` and `destroy` act on the socket. `closed` aborts when the client's connection goes. */
export interface ContentReply {
  readonly closed: AbortSignal;
  notFound(): void;
  fixed(status: number, body: string, headers?: Readonly<Record<string, string>>): void;
  head(status: 200 | 206, headers: Readonly<Record<string, string>>): void;
  /** Whether the socket's buffer took the chunk without filling: false means wait for `onDrain`. */
  write(chunk: Uint8Array): boolean;
  /** Run `f` once at the next drain; answers the unsubscribe. */
  onDrain(f: () => void): () => void;
  end(): void;
  destroy(): void;
  /** Whether the head is written (a byte is out). */
  wrote(): boolean;
}

export interface ContentDeps {
  cfg: { artifactOrigin: string; contentOrigin: string; artifactHost: string; contentHost: string };
  store: ArtifactStore;
  bytes: ArtifactBytes;
  now: () => number;
}

/** The door: one call per request. It resolves when the request is over, and rejects only for a throw before the head was written. */
export type ContentDoor = (req: ContentRequest, reply: ContentReply) => Promise<void>;

type QueueOutcome = 'run' | 'dead' | 'timeout' | 'gone';
interface Waiter { ticket: number; settle(o: QueueOutcome): void }

/** How a shared prepare ended: a snapshot, a failure word, a wait that ran out, the last joiner leaving (`gone`), or the capability
 *  having ended while it tried (`dead`: its joiners answer as for an end). */
type PrepareResult =
  | { kind: 'ok'; snapshot: string } | { kind: 'failed'; error: string } | { kind: 'timeout' } | { kind: 'gone' } | { kind: 'dead' };

/** One prepare of one capability's entry, shared by every request that needs its snapshot. `deadline` is the latest of the joiners'
 *  own deadlines, so the prepare keeps trying while any joiner can still use its answer; `stop` aborts it when the last joiner has
 *  left; `alive` asks whether the capability still lives (a look-up by its token), before each start and each retry. */
interface PrepareFlight {
  deadline: number;
  refs: number;
  stop: AbortController;
  alive: () => boolean;
  settled: Promise<PrepareResult>;
}

type Answer = { status: number; body: string; headers: Record<string, string> };
type Ending =
  | { kind: 'complete' } | { kind: 'not-found' } | { kind: 'answer'; answer: Answer } | { kind: 'destroy' }
  | { kind: 'throw'; error: unknown };

/** Resolve after `ms`, or at once when `signal` aborts, or when a waker in `wake` is called. */
function pause(ms: number, signal: AbortSignal, wake?: Set<() => void>): Promise<void> {
  return new Promise((resolve) => {
    const done = (): void => {
      clearTimeout(timer);
      signal.removeEventListener('abort', done);
      wake?.delete(done);
      resolve();
    };
    const timer = setTimeout(done, Math.max(0, ms));
    if (signal.aborted) { done(); return; }
    signal.addEventListener('abort', done, { once: true });
    wake?.add(done);
  });
}

export function createContentDoor(deps: ContentDeps): ContentDoor {
  const { cfg, store, bytes, now } = deps;
  /** The waiting requests of the whole box, in arrival order. */
  const queue: Waiter[] = [];
  /** The prepares in progress, by capability id and manifest key. */
  const flights = new Map<string, PrepareFlight>();
  /** The artifact prepare slot's state: whether one runs, and when the recent ones started. */
  const slot = { running: false, starts: [] as number[] };
  const slotWaiters = new Set<() => void>();

  /** Whenever a slot frees (a running ticket released, a capability ended), give each waiting request its turn in arrival order. */
  function pump(): void {
    for (const w of [...queue]) {
      const r = store.promote(w.ticket);
      if (r.kind === 'run') w.settle('run');
      // A spent or unknown ticket still owes its request an answer: it is the identical 404, never a request left hanging.
      else if (r.kind === 'dead' || r.kind === 'gone') w.settle('dead');
    }
  }

  /** Wait in the box-wide queue for a turn. It ends in `run` (it now holds a slot), `dead` (its capability ended), `timeout` (its
   *  wait ran out) or `gone` (its client left). Any end but `run` frees the queue place with `release`. */
  function waitInQueue(ticket: number, id: string, arrival: number, gone: AbortSignal): Promise<QueueOutcome> {
    return new Promise((resolve) => {
      let settled = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      let unsubscribe = (): void => {};
      const onGone = (): void => settle('gone');
      const w: Waiter = { ticket, settle };
      function settle(o: QueueOutcome): void {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        unsubscribe();
        gone.removeEventListener('abort', onGone);
        const i = queue.indexOf(w);
        if (i >= 0) queue.splice(i, 1);
        if (o !== 'run') store.release(ticket);
        resolve(o);
      }
      queue.push(w);
      timer = setTimeout(() => settle('timeout'), queueWaitLeft(arrival, now()));
      gone.addEventListener('abort', onGone, { once: true });
      if (gone.aborted) { settle('gone'); return; }
      unsubscribe = store.onEnd(id, () => settle('dead'));
      if (settled) unsubscribe();
    });
  }

  /** Wait for the prepare slot (one at a time, three a minute) until the flight's deadline. */
  async function acquireSlot(flight: PrepareFlight): Promise<'got' | 'timeout' | 'gone' | 'dead'> {
    for (;;) {
      if (flight.stop.signal.aborted) return 'gone';
      const t = now();
      if (t >= flight.deadline) return 'timeout';
      const s = prepareSlot(slot, t);
      if (s.kind === 'start') {
        // A capability that has ended spends none of the minute's starts.
        if (!flight.alive()) return 'dead';
        slot.running = true;
        slot.starts = withPrepareStart(slot.starts, t);
        return 'got';
      }
      const left = flight.deadline - t;
      await pause(s.until === null ? left : Math.min(left, s.until - t), flight.stop.signal, s.until === null ? slotWaiters : undefined);
    }
  }

  /** The one prepare of `entry` for a capability: it waits for the slot, asks the port, and asks again after `prepare-busy`, all
   *  until the flight's deadline. A snapshot is recorded in the store the moment it answers, whether or not anyone still waits. */
  async function runFlight(flight: PrepareFlight, id: string, key: string, at: ArtifactReadAt, entry: ArtifactManifestEntry):
    Promise<PrepareResult> {
    for (;;) {
      // Before each try, and so before each retry after `prepare-busy`: a capability that has ended is not prepared for.
      if (!flight.alive()) return { kind: 'dead' };
      const got = await acquireSlot(flight);
      if (got !== 'got') return { kind: got };
      let answer;
      try {
        answer = await bytes.prepare(at, entry, flight.stop.signal);
      } finally {
        slot.running = false;
        for (const wake of [...slotWaiters]) wake();
      }
      if (answer.ok) {
        store.recordSnapshot(id, key, answer.snapshot);
        return { kind: 'ok', snapshot: answer.snapshot };
      }
      if (prepareFailureAction(answer.error, false).kind !== 'retry') return { kind: 'failed', error: answer.error };
      if (now() + ARTIFACT_PREPARE_RETRY_MS >= flight.deadline) return { kind: 'timeout' };
      await pause(ARTIFACT_PREPARE_RETRY_MS, flight.stop.signal);
    }
  }

  /** Join the capability's prepare of this entry, starting it if none runs, with this request's own deadline. */
  async function joinFlight(
    id: string, token: string, key: string, at: ArtifactReadAt, entry: ArtifactManifestEntry, deadline: number, life: AbortSignal,
  ): Promise<PrepareResult> {
    const fk = `${id}\u0000${key}`;
    let flight = flights.get(fk);
    // A flight whose last joiner has left is stopping: it answers `gone` to anyone who joins it, so a new request starts its own.
    if (flight !== undefined && flight.stop.signal.aborted) flight = undefined;
    if (flight === undefined) {
      const stop = new AbortController();
      const made: PrepareFlight = {
        deadline, refs: 0, stop, alive: () => store.lookup(token) !== null, settled: Promise.resolve({ kind: 'gone' }),
      };
      made.settled = runFlight(made, id, key, at, entry).finally(() => { if (flights.get(fk) === made) flights.delete(fk); });
      // Every joiner may leave before it settles, and a throw must not become an unhandled rejection of its own.
      made.settled.catch(() => {});
      flights.set(fk, made);
      flight = made;
    }
    flight.refs++;
    flight.deadline = Math.max(flight.deadline, deadline);
    const local = new AbortController();
    const timeout = pause(deadline - now(), AbortSignal.any([life, local.signal])).then((): PrepareResult =>
      (life.aborted ? { kind: 'gone' } : { kind: 'timeout' }));
    try {
      return await Promise.race([flight.settled, timeout]);
    } finally {
      local.abort();
      flight.refs--;
      if (flight.refs === 0) flight.stop.abort();
    }
  }

  /** One request that holds a slot. Resolves when it is over; rejects only for a throw before the head was written. */
  function runRequest(
    reply: ContentReply, token: string, key: string, entry: ArtifactManifestEntry,
    range: { start: number; end: number } | null, ticket: number, arrival: number,
  ): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const life = new AbortController();
      const port = new AbortController();
      const total = responseLength(range, entry.size);
      let over = false;
      let sent = 0;
      let live: Capability | null = null;
      let respTimer: ReturnType<typeof setTimeout> | undefined;
      let stallTimer: ReturnType<typeof setTimeout> | undefined;
      let unsubEnd = (): void => {};
      const onGone = (): void => terminate({ kind: 'destroy' });

      function terminate(e: Ending): void {
        if (over) return;
        over = true;
        clearTimeout(respTimer);
        clearTimeout(stallTimer);
        unsubEnd();
        reply.closed.removeEventListener('abort', onGone);
        life.abort();
        port.abort();
        try {
          if (e.kind === 'throw') {
            // Before the head: hand the throw to the route handler. After it nothing can be answered: cut the socket.
            if (reply.wrote()) reply.destroy();
          } else if (e.kind === 'complete') reply.end();
          else if (e.kind === 'destroy' || reply.wrote()) reply.destroy();
          else if (e.kind === 'not-found') reply.notFound();
          else reply.fixed(e.answer.status, e.answer.body, e.answer.headers);
        } finally {
          store.release(ticket);
          pump();
        }
        if (e.kind === 'throw' && !reply.wrote()) reject(e.error);
        else resolve();
      }

      const ending = (s: 404 | 409 | 503): Ending => {
        const kind = statusAnswerKind(s);
        return kind === 'not-found' ? { kind: 'not-found' } : { kind: 'answer', answer: contentAnswer(kind) };
      };

      const startedAt = now();
      const secondsLeft = (c: Capability): number => secondsLeftOf(expiresAt(c), now());
      const status = contentStatus(range);
      const headersFor = (c: Capability): Record<string, string> => contentHeaders({
        key, entry, range, contentOrigin: cfg.contentOrigin, artifactOrigin: cfg.artifactOrigin, token, origins: c.origins,
        windows: c.windows, secondsLeft: secondsLeft(c),
      });

      /** Wait for the socket to drain what was written, for at most `ARTIFACT_FRAME_STALL_MS`; past it the socket is destroyed. */
      const drained = (): Promise<void> => new Promise<void>((done) => {
        let off = (): void => {};
        const finish = (): void => { clearTimeout(stallTimer); off(); life.signal.removeEventListener('abort', finish); done(); };
        off = reply.onDrain(finish);
        stallTimer = setTimeout(() => terminate({ kind: 'destroy' }), ARTIFACT_FRAME_STALL_MS);
        if (life.signal.aborted) finish();
        else life.signal.addEventListener('abort', finish, { once: true });
      });

      /** The port's sink: write the head with the first frame, write the frame, wait for the drain, and before the next frame is
       *  read look the capability up again: a dead one cuts the response and no further frame is read. */
      const sink = async (frame: Uint8Array): Promise<'next' | 'stop'> => {
        if (over) return 'stop';
        if (!frameFits(sent, frame.length, total)) { terminate({ kind: 'destroy' }); return 'stop'; }
        // The hour's budget is charged for what is written, frame by frame, and `charge` answers three words. `dead` is a
        // capability that has ended (the identical 404 before a byte, a cut socket after one); `over-budget` is a spent hour (the
        // 429 before any byte, a cut socket short of `Content-Length` after one). A count `charge` refuses throws: the frame's
        // length is always whole, so that is a defect, and it goes where any throw of the sink goes: the real port turns it into an
        // unreadable read (the identical 404 before a byte, a cut socket after), and a port that lets it through reaches
        // `flow`'s catch (the instance's fixed 500 before a byte, a cut socket after).
        const charged = store.charge(live!.id, frame.length);
        if (charged !== 'ok') {
          terminate(reply.wrote() ? { kind: 'destroy' } : charged === 'dead' ? { kind: 'not-found' } : { kind: 'answer', answer: contentAnswer('too-many') });
          return 'stop';
        }
        if (!reply.wrote()) reply.head(status, headersFor(live!));
        const room = reply.write(frame);
        sent += frame.length;
        if (!room) {
          await drained();
          if (over) return 'stop';
        }
        if (sent < total && store.lookup(token) === null) { terminate({ kind: 'destroy' }); return 'stop'; }
        return 'next';
      };

      /** The entry's snapshot: the recorded one, else the capability's shared prepare. `null` means the request is already over. */
      const snapshotOf = async (c: Capability, at: ArtifactReadAt, kind: 'first' | 'again'): Promise<string | null> => {
        // A request that is over (ended, its client gone, a deadline) spends none of the minute's prepare starts.
        if (over) return null;
        const have = c.snapshots.get(key);
        if (have !== undefined) return have;
        const until = prepareWaitUntil(kind, arrival, startedAt, now());
        const got = await joinFlight(c.id, token, key, at, entry, until, life.signal);
        if (over) return null;
        if (got.kind === 'ok') return got.snapshot;
        if (got.kind === 'gone') { terminate({ kind: 'destroy' }); return null; }
        if (got.kind === 'dead') { terminate({ kind: 'not-found' }); return null; }
        if (got.kind === 'timeout') {
          terminate(prepareTimeoutAction(reply.wrote()) === 'destroy' ? { kind: 'destroy' } : { kind: 'answer', answer: contentAnswer('wait-out') });
          return null;
        }
        const act = prepareFailureAction(got.error, reply.wrote());
        terminate(act.kind === 'status' ? ending(act.status) : { kind: 'destroy' });
        return null;
      };

      const flow = async (c: Capability): Promise<void> => {
        const at: ArtifactReadAt = { project: c.project, pin: c.pin, ref: c.ref, section: c.section, path: key };
        if (total === 0) {
          reply.head(status, headersFor(c));
          terminate({ kind: 'complete' });
          return;
        }
        let snapshot: string | null = null;
        if (artifactFramed(entry)) {
          snapshot = await snapshotOf(c, at, 'first');
          if (snapshot === null) return;
        }
        let reprepared = false;
        for (;;) {
          // After a prepare, and before the read it was for: look the capability up, so a read is never started for one that ended
          // while it waited (recording the snapshot would have refused, but nothing may rest on that side effect).
          if (snapshot !== null && store.lookup(token) === null) { terminate({ kind: 'not-found' }); return; }
          const from = (range === null ? 0 : range.start) + sent;
          const to = range === null ? entry.size - 1 : range.end;
          const answer = await bytes.read(at, entry, { start: from, end: to }, snapshot, sink, port.signal);
          if (over) return;
          if (answer.ok) {
            terminate({ kind: readEndVerdict(sent, total) });
            return;
          }
          const act: ReadFailureAction = readFailureAction(answer.error, reply.wrote(), reprepared);
          if (act.kind === 'status') { terminate(ending(act.status)); return; }
          if (act.kind === 'destroy') { terminate({ kind: 'destroy' }); return; }
          // The snapshot expired: forget it (only if it is still the stale one), prepare once more, read on from the next unsent byte.
          reprepared = true;
          if (store.lookup(token)?.snapshots.get(key) === snapshot) store.recordSnapshot(c.id, key, null);
          snapshot = await snapshotOf(c, at, 'again');
          if (snapshot === null) return;
        }
      };

      // ---- running: the second look-up, the hour's charge, the end subscription, the deadline ----
      if (reply.closed.aborted) { terminate({ kind: 'destroy' }); return; }
      reply.closed.addEventListener('abort', onGone, { once: true });
      live = store.lookup(token);
      if (live === null) { terminate({ kind: 'not-found' }); return; }
      // Refused only when the hour's budget is already spent: what is served is charged frame by frame in the sink.
      if (budgetSpent(live, now())) { terminate({ kind: 'answer', answer: contentAnswer('too-many') }); return; }
      unsubEnd = store.onEnd(live.id, () => terminate({ kind: 'not-found' }));
      if (over) { unsubEnd(); return; }
      respTimer = setTimeout(() => terminate({ kind: 'answer', answer: contentAnswer('wait-out') }), ARTIFACT_RESPONSE_MAX_MS);
      flow(live).catch((error: unknown) => terminate({ kind: 'throw', error }));
    });
  }

  return async (req, reply) => {
    if (!routeHostOk('content', req.host, cfg)) { reply.notFound(); return; }
    const path = contentRequestPath(req.rawUrl);
    if (path === null) { reply.notFound(); return; }
    const c = deps.store.lookup(path.token);
    if (c === null) { reply.notFound(); return; }
    const fence = contentFence({ dest: req.dest, mode: req.mode, site: req.site, serviceWorker: req.serviceWorker }, c.windows);
    if (fence === 'refused') {
      const a = contentAnswer('forbidden');
      reply.fixed(a.status, a.body, a.headers);
      return;
    }
    const key = contentKey(c.dir, path.rel);
    const entry = c.manifest.get(key);
    if (entry === undefined) { reply.notFound(); return; }
    const asked = parseRange(req.range, entry.size);
    if (asked.kind === 'unsatisfiable') {
      const a = unsatisfiableAnswer(entry.size);
      reply.fixed(a.status, a.body, a.headers);
      return;
    }
    const range = asked.kind === 'one' ? { start: asked.start, end: asked.end } : null;
    store.touch(c.id);
    if (req.method === 'HEAD') {
      const live = store.lookup(path.token);
      if (live === null) { reply.notFound(); return; }
      reply.head(contentStatus(range), contentHeaders({
        key, entry, range, contentOrigin: cfg.contentOrigin, artifactOrigin: cfg.artifactOrigin, token: path.token,
        origins: live.origins, windows: live.windows, secondsLeft: secondsLeftOf(expiresAt(live), now()),
      }));
      reply.end();
      return;
    }
    const arrival = now();
    const admitted = store.admit(c.id);
    if (admitted.kind === 'dead') { reply.notFound(); return; }
    if (admitted.kind === 'full') {
      const a = contentAnswer('too-many');
      reply.fixed(a.status, a.body, a.headers);
      return;
    }
    if (admitted.kind === 'wait') {
      const outcome = await waitInQueue(admitted.ticket, c.id, arrival, reply.closed);
      if (outcome === 'dead') { reply.notFound(); return; }
      if (outcome === 'timeout') {
        // A wait that ran out for a capability that has ended meanwhile (nothing announces a passphrase change) is the identical 404.
        if (store.lookup(path.token) === null) { reply.notFound(); return; }
        const a = contentAnswer('wait-out');
        reply.fixed(a.status, a.body, a.headers);
        return;
      }
      if (outcome === 'gone') { reply.destroy(); return; }
    }
    await runRequest(reply, path.token, key, entry, range, admitted.ticket, arrival);
  };
}
