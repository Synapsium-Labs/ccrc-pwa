import type { FastifyInstance, FastifyReply } from 'fastify';
import {
  isLinearKeyShape, isLinearUuid, type LinearConnectionAnswer, type LinearConnectionView, type LinearDetailsRead,
  type LinearLegacyRow, type LinearTeam, type LinearTeamShown, type LinearWorkspaceView, type LinearWorkspacesAnswer,
} from '../../../shared/linear.js';
import type { RouteRefusal } from '../../../shared/refusal.js';
import { LINEAR_REF_MAX_CHARS } from '../workspaceCreate.js';
import { refuseRoute } from '../refuse.js';
import type { AccountActor } from '../accounts/audit.js';
import { credentialBodyRoute, noStoreRoute, type AccountGate } from '../accounts/gate.js';
import { valueDigestHex } from '../token/files.js';
import { verifyLinearKey, type FetchLike, type LinearKeyCheck } from './client.js';
import {
  keyTailOf, readLinearDetails, readLinearKey, recordLinearCheck, removeLinearConnection,
  withConnectionLock, writeLinearConnection, type LinearKeyRead,
} from './connection.js';
import type { LinearJournal, LinearJournalOp, LinearSettledOutcome } from './journal.js';
import { oneCallOutcome, type LinearRateRefusal, type LinearRateService } from './rate.js';
import { checkLinearKeyThrough, checkLinearSlot, type LinearRefresher } from './refresher.js';
import { resolveName } from './resolve.js';
import {
  LEGACY_SLOT, putLinearSlot, readLinearStore, recordLinearSlotCheck, removeLinearSlot,
  writeLegacyTeams, type LinearFileSlot, type LinearLegacySlot, type LinearSlotRef,
} from './store.js';
import { checkOutcomeOf, linearConnectionView, type KeyMeasure } from './view.js';

export interface LinearRouteOpts {
  /** The config's ccrc dir (`cfg.ccrcDir`), where `linear.key` and `linear.json` live. */
  ccrcDir: string;
  /**
   * The account gate (`accounts/gate.ts`), built by the composition root. REQUIRED, not optional: the
   * connection's two writes take the credential posture through it, and a route file that could be registered
   * without one is a credential write with no gate.
   */
  gate: AccountGate;
  /**
   * The ONE Linear rate service (D-7670, spec §6.7), built by the composition root and passed through by `server.ts`.
   * REQUIRED as the service or `null`, so a direct caller decides. The preview and the Check again ask it on the
   * `request` lane (cookie-gated: reachable with no token while sign-in is unarmed); the Connect, account-gated with a
   * step-up, on the `floor`. Null (a test, a script): the preview's title is the offline one, and the Check again and
   * the Connect answer `linear-unavailable` before any Linear call (D-7684). The GET and the DELETE never call Linear
   * and are unchanged.
   */
  rate: LinearRateService | null;
  /**
   * The ONE background refresher (D-7668, spec §4.3), built by the composition root and passed through by `server.ts`.
   * REQUIRED as the refresher or `null`, as `rate` is. The Check again's key check counts as its slot's refresh, so a
   * miss straight after it does not ask Linear again. Null: the Check again answers `linear-unavailable` before any
   * Linear call (D-7684); no other route here needs it.
   */
  refresher: LinearRefresher | null;
  /** Test seams: the network, the deadline and the clock. Absent in production. */
  fetch?: FetchLike;
  timeoutMs?: number;
  now?: () => number;
}

/** The body bound of the connection's write: a key is at most `LINEAR_KEY_MAX_CHARS` characters, so two kilobytes
 *  holds the whole JSON with room, and a larger body is refused before it is parsed. */
const PUT_BODY_LIMIT = 2048;

/** `no-store` on every answer, and the write's body errors as fixed words (Fastify's own parse error text can quote a
 *  fragment of the body, and on the key's route the body IS the key): the account gate's one spelling of each
 *  (`noStoreRoute`, `credentialBodyRoute`, review 1389 A6). */
const noStore = noStoreRoute;

/** `rate-limited` (429) with its detail and its wait, in the `Retry-After` header and the body (spec §6.7, §6.8). */
const refuseRate = (reply: FastifyReply, detail: LinearRateRefusal, retryAfterS: number): FastifyReply => {
  reply.header('retry-after', String(retryAfterS));
  return refuseRoute(reply, 'rate-limited', { detail, retryAfterS });
};

const measure = (k: LinearKeyRead): KeyMeasure =>
  k.kind === 'key' ? { kind: 'key', digest: valueDigestHex(k.key) } : { kind: k.kind };

/**
 * `GET /api/linear/resolve?ref=<text>`: the PREVIEW read. It tells the new-session
 * sheet what a pasted name would become, and the real title when Linear can be
 * asked, before the operator commits to a slug they cannot change.
 *
 * Session-gated like every PWA read (it is NOT in `auth/gate.ts`'s EXEMPT table)
 * and carries no box token. L4: it validates the query and replies; the answer
 * itself is `resolve.ts`'s (shared with the create route), the grammar is
 * `shared/slug.ts`, and every failure arm degrades to the offline title with its
 * fixed word as `reason`. The key is read at use time from its file, so a key
 * connected a moment ago is used on the next request.
 *
 * The one thing it writes is the 401 marker: a Linear `unauthorised` marks the
 * connection rejected (`markLinearRejected`, which compares digests so a key
 * replaced meanwhile is never condemned), so Settings tells the truth next time it
 * is opened. That write failing never changes the answer. Linear's response text,
 * the key and the digest never reach this reply or a log line.
 *
 * THE CONNECTION'S ROUTES (named workspaces S4b, design §5.1) are in this file too,
 * so `auth-gate.test.ts`'s scanner reads all of them. None is exempt and none takes
 * the box token. `GET` and `POST …/check` are session reads and acts; `PUT` and
 * `DELETE` put and remove a credential, so they take the account gate with a
 * step-up (D-5511, D-5512): refused while auth is unarmed, from an insecure origin,
 * and without a recent step-up. All four answer `Cache-Control: no-store`.
 */
export function registerLinearRoutes(app: FastifyInstance, opts: LinearRouteOpts): void {
  const now = opts.now ?? Date.now;
  const net = { fetch: opts.fetch, timeoutMs: opts.timeoutMs, now };

  app.get('/api/linear/resolve', noStore, async (req, reply) => {
    const q: unknown = req.query;
    const ref = typeof q === 'object' && q !== null && 'ref' in q ? q.ref : undefined;
    if (typeof ref !== 'string') return refuseRoute(reply, 'bad-ref');
    if (ref.length > LINEAR_REF_MAX_CHARS) return refuseRoute(reply, 'ref-too-long');
    return resolveName(ref, { ccrcDir: opts.ccrcDir, rate: opts.rate, ...net, now });
  });

  /** The section's state, from two fresh reads. Never the key. */
  const currentView = async (): Promise<LinearConnectionView> => {
    const [key, details] = await Promise.all([readLinearKey(opts.ccrcDir), readLinearDetails(opts.ccrcDir)]);
    return linearConnectionView(measure(key), details);
  };
  const answer = (connection: LinearConnectionView): LinearConnectionAnswer => ({ ok: true, connection });

  app.get('/api/linear/connection', noStore, async () => answer(await currentView()));

  // THE BODY ERRORS TOO. A parse error (400) or an oversize body (413) answers from the route's error handler BEFORE any
  // handler or gate runs, so the `no-store` they set never reaches it: the `onRequest` hook runs first of all, and carries
  // the header on those answers. The gate still sets it, harmlessly, for the refusals it makes.
  const write = credentialBodyRoute(PUT_BODY_LIMIT);

  app.put('/api/linear/connection', write, async (req, reply) => {
    // The gate first: before the body is read, before Linear is asked. Every answer of this route, its refusals and
    // its success alike, carries `no-store` (`account-gate.test.ts`, and this route's own test).
    if (!opts.gate(req, reply, { cap: null, stepUp: true }).pass) return reply;
    const body: unknown = req.body;
    const key = typeof body === 'object' && body !== null && 'key' in body ? body.key : undefined;
    if (typeof key !== 'string') return refuseRoute(reply, 'bad-request');
    // BEFORE any call: a key that fails the shape rule would be stored differently from how it was verified, or
    // make `fetch` throw on a header and be reported as unreachable.
    if (!isLinearKeyShape(key)) return refuseRoute(reply, 'bad-key');

    // The rate service before Linear (spec §6.7): the Connect is an account-gated key act, so it spends the floor of
    // the legacy slot, the one this key becomes, and never the request lane a tokenless caller can reach.
    const rate = opts.rate;
    if (rate === null) return refuseRoute(reply, 'linear-unavailable');
    const ask = rate.take({ lane: 'floor', slot: LEGACY_SLOT, calls: 1 });
    if (!ask.ok) return refuseRate(reply, ask.detail, ask.retryAfterS);
    const v = await verifyLinearKey(key, net);
    rate.settle(ask.grant, oneCallOutcome(v));
    if (!v.ok) {
      // One literal word per arm (`refusal-status.test.ts` reads each from its call), never Linear's text.
      switch (v.reason) {
        case 'unauthorised': return refuseRoute(reply, 'key-rejected');
        case 'forbidden': return refuseRoute(reply, 'key-forbidden');
        case 'timeout': return refuseRoute(reply, 'timeout');
        case 'malformed': return refuseRoute(reply, 'malformed');
        case 'unreachable': return refuseRoute(reply, 'unreachable');
        // Linear's own refusal over its limit (spec §6.7, §6.8): `rate-limited` `linear`, with the wait it gave.
        case 'rate-limited': return refuseRate(reply, 'linear', v.retryAfterS);
      }
    }

    try {
      await withConnectionLock(opts.ccrcDir, () => writeLinearConnection(opts.ccrcDir, key, {
        org: v.org, user: v.user, keyTail: keyTailOf(key), keyDigest: v.keyDigest, checkedAt: now(), outcome: 'ok',
      }));
    } catch {
      return refuseRoute(reply, 'write-failed');
    }
    return answer(await currentView());
  });

  app.post('/api/linear/connection/check', noStore, async (_req, reply) => {
    // No rate service or no refresher, no Linear call: before any other work (D-7684).
    const { rate, refresher } = opts;
    if (rate === null || refresher === null) return refuseRoute(reply, 'linear-unavailable');
    const key = await readLinearKey(opts.ccrcDir);
    // Nothing to check, and the view says which kind of nothing (not connected, or unreadable, or unusable).
    if (key.kind !== 'key') return refuseRoute(reply, 'not-connected', { connection: await currentView() });

    // The §4.1 key check (spec §3.4): its query asks what the v1 record shows and also the workspace and its teams, a
    // page at a time, the key read again from `linear.key` before each page. The request lane: this route is
    // cookie-gated, so a tokenless caller on an unarmed box can reach it (spec §6.7).
    const checked = await checkLinearSlot({ ccrcDir: opts.ccrcDir, slot: LEGACY_SLOT, lane: 'request', rate, ...net });
    if (checked.kind === 'refused') return refuseRate(reply, checked.detail, checked.retryAfterS);
    const v = checked.check;
    // A check that reached Linear is this slot's refresh: its window starts again (spec §4.3).
    if (v.pagesSent > 0) refresher.checked(LEGACY_SLOT);
    // The key was gone, or replaced, when a page was due: nothing the check found describes the key now stored, so
    // nothing is recorded, and the answer is the pair as it now is (a Connect that landed meanwhile wins).
    if (!v.ok && v.reason === 'key-changed') return answer(await currentView());
    try {
      // Recorded only if the key checked is still the stored one: a Connect that landed while Linear was being
      // asked wins, and its record is the answer below.
      await recordLinearCheck(
        opts.ccrcDir, v.keyDigest, v.ok ? 'ok' : checkOutcomeOf(v.reason), v.ok ? { org: v.org, user: v.user } : null, now(),
      );
    } catch {
      return refuseRoute(reply, 'write-failed');
    }
    // What the check learned beyond the v1 record goes to `linear/legacy-teams.json`, under the lock and by the same
    // digest rule, and never into the pair. Learning it is not this route's answer, which stays the pair's view, so a
    // failure to write it is a fixed line and the answer below.
    const ws = v.ok ? v.workspace : null;
    if (ws !== null) {
      await writeLegacyTeams(opts.ccrcDir, v.keyDigest, {
        workspaceId: ws.id, name: ws.name, urlKey: ws.urlKey, teams: ws.teams, teamsAt: now(),
      }).catch(() => { console.warn('ccrc-server: linear: could not record what the legacy key reaches'); });
    }
    return answer(await currentView());
  });

  // DELETE reads no body, but a client may send one: it gets the same fixed-word refusal and bound as the PUT, never
  // Fastify's own parser text.
  app.delete('/api/linear/connection', write, async (req, reply) => {
    if (!opts.gate(req, reply, { cap: null, stepUp: true }).pass) return reply;
    try {
      await withConnectionLock(opts.ccrcDir, () => removeLinearConnection(opts.ccrcDir));
    } catch {
      return refuseRoute(reply, 'write-failed');
    }
    return answer(await currentView());
  });
}

// ---------------------------------------------------------------------------
// THE SETTINGS ROUTES FOR WORKSPACE KEYS (#1444, spec §10.1, §7; plan task LK11, D-7741). Registered in this file BESIDE
// the four `/api/linear/connection` routes above, which stay exactly as they are, so `auth-gate.test.ts`'s scanner reads
// all nine. None is exempt and none takes the box token; all four answer `Cache-Control: no-store`.
//
//   GET    /api/linear/workspaces            a session read: the slots and the legacy row, never a key or a digest
//   POST   /api/linear/workspaces            {key, replace?}: the account gate (`cap: null`) with a step-up
//   POST   /api/linear/workspaces/:id/check  the account gate (`cap: null`), no step-up: it writes only the record
//   DELETE /api/linear/workspaces/:id        the account gate (`cap: null`) with a step-up
//
// EVERY ACT ON A SLOT KEY IS JOURNALED (spec §7): its `linear_events` row (`key-add`, `key-replace`, `key-check`,
// `key-remove`) carries the actor the gate minted, and is written `pending` after the gate and the body's own checks
// and BEFORE any file is touched or Linear is asked. A journal that cannot take the row refuses the act with
// `journal-unavailable`; an absent journal, rate service or refresher (D-7684) refuses an act that needs it with
// `linear-unavailable` straight after the gate, with no row. Each Linear call goes through the one rate service on the
// `floor` lane, and each page of a check reads the key again from its file.
// ---------------------------------------------------------------------------

export interface LinearWorkspaceRouteOpts {
  /** The config's ccrc dir (`cfg.ccrcDir`): the slots live in its `linear/`, the legacy pair beside it. */
  ccrcDir: string;
  /** The account gate, as `LinearRouteOpts.gate`: REQUIRED, so no key act can be registered without one. */
  gate: AccountGate;
  /** The ONE rate service (spec §6.7), REQUIRED as the service or `null` (D-7684): null refuses add, replace and check. */
  rate: LinearRateService | null;
  /** The ONE background refresher (spec §4.3, §4.4), REQUIRED as the refresher or `null`: an add, a replace and a check
   *  count as their slot's teams refresh and queue its directory, so null refuses those three. */
  refresher: LinearRefresher | null;
  /** The ONE write journal (D-7671, spec §7), REQUIRED as the journal or `null`: every key act writes its row first, so
   *  null refuses all three acts. The list never needs it. */
  journal: LinearJournal | null;
  /** D-8405: told when a key act has just learned a workspace's teams (an add, a replace, an `ok` check), so the
   *  automatic team link runs then rather than at the next sweep. Never awaited; absent: nothing is told. */
  onTeamsLearned?: () => void;
  /** Test seams: the network, the deadline and the clock. Absent in production. */
  fetch?: FetchLike;
  timeoutMs?: number;
  now?: () => number;
}

/**
 * The bucket an add's key check is charged to (D-7741). Its floor is the account-gated key acts' lane (spec §6.7), but
 * the slot it would be charged to is named by the key's workspace, which only the check's own answer tells. So the
 * pasted key's pages go to this one bucket, the floor of a slot that is no workspace's: Linear's ids are version-4
 * UUIDs, and this is the nil UUID. It holds no key and no file is named by it. A Linear 429 on an add closes it, and
 * not the workspace's slot: a known limit, since an add is an operator's act behind a step-up.
 */
export const LINEAR_ADD_SLOT: LinearSlotRef = Object.freeze({ source: 'file', id: '00000000-0000-0000-0000-000000000000' } as const);

/** The words of a failed key check, one literal per arm, never Linear's text: as the Connect answers them. */
function keyCheckWord(reason: Exclude<LinearKeyCheck, { ok: true }>['reason']): RouteRefusal {
  switch (reason) {
    case 'unauthorised': return 'key-rejected';
    case 'forbidden': return 'key-forbidden';
    case 'timeout': return 'timeout';
    case 'malformed': return 'malformed';
    case 'unreachable': return 'unreachable';
    case 'rate-limited': return 'rate-limited';
    // The key was gone, or replaced, when a page was due: what the check found describes no stored key.
    case 'key-changed': return 'not-connected';
  }
}

/** How a key act's row ends for a refusal word: `refused` for an answer that refused the act (Linear's verdict on the
 *  key, a slot already there, the rate service), `failed` for one that could not be completed (Linear not answering,
 *  a write that failed). */
const REFUSED_WORDS: ReadonlySet<RouteRefusal> = new Set<RouteRefusal>([
  'workspace-exists', 'key-rejected', 'key-forbidden', 'rate-limited', 'not-connected',
]);
const settledOf = (word: RouteRefusal): LinearSettledOutcome => (REFUSED_WORDS.has(word) ? 'refused' : 'failed');

const teamsShown = (teams: readonly LinearTeam[]): LinearTeamShown[] => teams.map((t) => ({ key: t.key, name: t.name }));

/** One slot's row: today's view of its key and record, and what the record learned for the key now stored. Never the
 *  key and never the digest: the record's digest decides the state here and goes no further. */
function workspaceView(slot: LinearFileSlot): LinearWorkspaceView {
  const rec = slot.record;
  const details: LinearDetailsRead = rec.kind !== 'details' ? rec : {
    kind: 'details',
    details: {
      org: rec.details.name, user: rec.details.user, keyTail: rec.details.keyTail, keyDigest: rec.details.keyDigest,
      checkedAt: rec.details.checkedAt, outcome: rec.details.outcome,
    },
  };
  const view = linearConnectionView(slot.key, details);
  const current = slot.key.kind === 'key' && rec.kind === 'details' && rec.details.keyDigest === slot.key.digest ? rec.details : null;
  const base = { id: slot.id, name: current?.name ?? null, urlKey: current?.urlKey ?? null, teams: teamsShown(current?.teams ?? []) };
  if ('keyTail' in view) return { ...base, ...view };
  return { ...base, user: null, keyTail: null, checkedAt: null, ...view };
}

function legacyRow(l: LinearLegacySlot): LinearLegacyRow {
  const w = l.workspace;
  return { view: l.view, workspace: w === null ? null : { name: w.name, urlKey: w.urlKey, teams: teamsShown(w.teams) }, superseded: l.superseded };
}

export function registerLinearWorkspaceRoutes(app: FastifyInstance, opts: LinearWorkspaceRouteOpts): void {
  const now = opts.now ?? Date.now;
  const net = { fetch: opts.fetch, timeoutMs: opts.timeoutMs, now };

  /** The list, from fresh reads. A slot directory that cannot be listed still shows the legacy pair, unlearned. */
  const listAnswer = async (): Promise<LinearWorkspacesAnswer> => {
    const store = await readLinearStore(opts.ccrcDir);
    if (store.kind === 'listed') {
      return { ok: true, store: 'ok', workspaces: store.slots.map(workspaceView), legacy: store.legacy === null ? null : legacyRow(store.legacy) };
    }
    const [key, details] = await Promise.all([readLinearKey(opts.ccrcDir), readLinearDetails(opts.ccrcDir)]);
    const legacy = key.kind === 'absent' ? null : { view: linearConnectionView(measure(key), details), workspace: null, superseded: false };
    return { ok: true, store: 'unreadable', workspaces: [], legacy };
  };

  /** A key act's journal row: written `pending` now, before the act touches a file or calls Linear, and ended once. */
  const beginAct = (journal: LinearJournal, op: LinearJournalOp, actor: AccountActor, workspaceId: string | null) => {
    const w = journal.pending({ op, sessionId: null, sessionUuid: null, actor, workspaceId, teamKey: null, target: null, fields: [] });
    if (!w.ok) return null;
    let open = true;
    const end = (outcome: LinearSettledOutcome, code?: RouteRefusal): void => {
      if (!open) return;
      open = false;
      journal.settle(w.id, outcome, code);
    };
    return {
      ok: (body: LinearWorkspacesAnswer): LinearWorkspacesAnswer => { end('ok'); return body; },
      refuse: (reply: FastifyReply, word: RouteRefusal, extra: Record<string, unknown> = {}): FastifyReply => {
        end(settledOf(word), word);
        return refuseRoute(reply, word, extra);
      },
      /** `rate-limited` with its wait, in the header and the body (spec §6.8). */
      refuseRate: (reply: FastifyReply, detail: LinearRateRefusal, retryAfterS: number): FastifyReply => {
        end('refused', 'rate-limited');
        return refuseRate(reply, detail, retryAfterS);
      },
      end,
    };
  };

  /**
   * The stored slot a request's `:id` names, found in the directory's own listing: its files are then named by the id the
   * listing read, never by the request's text, which is only compared with it. `unreadable` when the directory cannot be
   * listed; null when no `.key` there has this id.
   */
  const storedSlot = async (id: string): Promise<LinearFileSlot | null | 'unreadable'> => {
    const store = await readLinearStore(opts.ccrcDir);
    if (store.kind !== 'listed') return 'unreadable';
    return store.slots.find((x) => x.id === id) ?? null;
  };

  app.get('/api/linear/workspaces', noStore, async () => listAnswer());

  // The body errors answer before any handler or gate runs, so `no-store` rides the `onRequest` hook (as on the PUT).
  const write = credentialBodyRoute(PUT_BODY_LIMIT);

  app.post('/api/linear/workspaces', write, async (req, reply) => {
    // The gate first: before the body is read, before Linear is asked.
    const passed = opts.gate(req, reply, { cap: null, stepUp: true });
    if (!passed.pass) return reply;
    const { rate, refresher, journal } = opts;
    if (rate === null || refresher === null || journal === null) return refuseRoute(reply, 'linear-unavailable');
    const body: unknown = req.body;
    if (typeof body !== 'object' || body === null || Array.isArray(body)) return refuseRoute(reply, 'bad-request');
    const key = 'key' in body ? body.key : undefined;
    const replace = 'replace' in body ? body.replace : undefined;
    if (typeof key !== 'string' || (replace !== undefined && typeof replace !== 'boolean')) return refuseRoute(reply, 'bad-request');
    // BEFORE any call: a key that fails the shape rule would be stored differently from how it was verified.
    if (!isLinearKeyShape(key)) return refuseRoute(reply, 'bad-key');

    const act = beginAct(journal, replace === true ? 'key-replace' : 'key-add', passed.actor, null);
    if (act === null) return refuseRoute(reply, 'journal-unavailable');

    // The §4.1 key check of the PASTED key, on the floor (D-7741: the add's own bucket, as its workspace is not yet
    // known). The key is held only for this request, as the Connect holds it, and is written below or not at all.
    const checked = await checkLinearKeyThrough(async () => ({ kind: 'key', key }), { slot: LINEAR_ADD_SLOT, lane: 'floor', rate, ...net });
    if (checked.kind === 'refused') return act.refuseRate(reply, checked.detail, checked.retryAfterS);
    const v = checked.check;
    if (!v.ok) {
      if (v.reason === 'rate-limited') return act.refuseRate(reply, 'linear', v.retryAfterS);
      return act.refuse(reply, keyCheckWord(v.reason));
    }
    // A slot is named by its workspace, and a partial team list could route a team to the wrong one: an answer that
    // did not name the workspace whole stores nothing.
    const ws = v.workspace;
    if (ws === null) {
      const more = checked.moreRefused;
      return more === undefined ? act.refuse(reply, 'malformed') : act.refuseRate(reply, more.detail, more.retryAfterS);
    }
    const at = now();
    let put: Awaited<ReturnType<typeof putLinearSlot>>;
    try {
      put = await putLinearSlot(opts.ccrcDir, key, {
        workspaceId: ws.id, name: ws.name, urlKey: ws.urlKey, user: v.user, teams: ws.teams, teamsAt: at,
        keyTail: keyTailOf(key), keyDigest: v.keyDigest, checkedAt: at, outcome: 'ok',
      }, { replace: replace === true });
    } catch {
      return act.refuse(reply, 'write-failed');
    }
    if (put === 'exists') {
      // The card then asks "Replace the key for <name>?" and sends the request again with `replace: true` (spec §10.1).
      act.end('refused', 'workspace-exists');
      return refuseRoute(reply, 'workspace-exists', { workspace: { id: ws.id, name: ws.name, urlKey: ws.urlKey } });
    }
    // This check is the slot's teams refresh, and its directory is filled in the background (spec §4.3, §4.4).
    const ref: LinearSlotRef = { source: 'file', id: ws.id };
    refresher.checked(ref);
    refresher.queueDirectory(ref);
    opts.onTeamsLearned?.();
    const answer = await listAnswer();
    return act.ok(put === 'added' ? { ...answer, added: ws.id } : { ...answer, replaced: ws.id });
  });

  app.post('/api/linear/workspaces/:id/check', write, async (req, reply) => {
    // The gate without a step-up: a check writes only the record, never the key (spec §10.1).
    const passed = opts.gate(req, reply, { cap: null });
    if (!passed.pass) return reply;
    const { rate, refresher, journal } = opts;
    if (rate === null || refresher === null || journal === null) return refuseRoute(reply, 'linear-unavailable');
    const id = (req.params as { id?: unknown }).id;
    // Before anything reads the disk: only a workspace id names a slot's files.
    if (!isLinearUuid(id)) return refuseRoute(reply, 'bad-request');
    const act = beginAct(journal, 'key-check', passed.actor, id);
    if (act === null) return refuseRoute(reply, 'journal-unavailable');

    // The slot as the directory lists it, its key measured (its kind and digest, never the key itself): the check reads
    // the key again from its file, before each page.
    const slot = await storedSlot(id);
    if (slot === 'unreadable' || slot === null || slot.key.kind !== 'key') {
      // Nothing to check: the slot is not there, or its key file has no usable key (the list says which).
      const { store, workspaces, legacy } = await listAnswer();
      return act.refuse(reply, 'not-connected', { store, workspaces, legacy });
    }
    const ref: LinearSlotRef = { source: 'file', id: slot.id };
    // The §4.1 key check of the STORED key on the slot's floor, the key read again from its file before each page.
    const checked = await checkLinearSlot({ ccrcDir: opts.ccrcDir, slot: ref, lane: 'floor', rate, ...net });
    if (checked.kind === 'refused') return act.refuseRate(reply, checked.detail, checked.retryAfterS);
    const v = checked.check;
    if (v.pagesSent > 0) refresher.checked(ref);
    // The key was gone, or replaced, when a page was due: nothing is recorded, and the answer is the list as it is now.
    if (!v.ok && v.reason === 'key-changed') {
      act.end('refused', 'not-connected');
      return listAnswer();
    }
    const at = now();
    // An answer naming another workspace is no answer for this slot: nothing is recorded for it.
    if (v.ok && v.workspace !== null && v.workspace.id !== slot.id) return act.refuse(reply, 'malformed');
    try {
      // Recorded only while the slot's key still has the digest that was checked (the digest rule).
      const learned = v.ok && v.workspace !== null
        ? { name: v.workspace.name, urlKey: v.workspace.urlKey, user: v.user, teams: v.workspace.teams, teamsAt: at } : null;
      await recordLinearSlotCheck(opts.ccrcDir, slot.id, v.keyDigest, v.ok ? 'ok' : checkOutcomeOf(v.reason), learned, at);
    } catch {
      return act.refuse(reply, 'write-failed');
    }
    if (v.ok) {
      refresher.queueDirectory(ref);
      opts.onTeamsLearned?.();
      return act.ok(await listAnswer());
    }
    // A check is answered with the list whatever Linear said, as the Check again is: the row says what it found.
    const word = keyCheckWord(v.reason);
    act.end(settledOf(word), word);
    return listAnswer();
  });

  app.delete('/api/linear/workspaces/:id', write, async (req, reply) => {
    const passed = opts.gate(req, reply, { cap: null, stepUp: true });
    if (!passed.pass) return reply;
    const { journal } = opts;
    // A remove calls no Linear: only the journal is needed.
    if (journal === null) return refuseRoute(reply, 'linear-unavailable');
    const id = (req.params as { id?: unknown }).id;
    if (!isLinearUuid(id)) return refuseRoute(reply, 'bad-request');
    const act = beginAct(journal, 'key-remove', passed.actor, id);
    if (act === null) return refuseRoute(reply, 'journal-unavailable');
    try {
      // A slot that is not there is removed already. One that is: the key FIRST, then the record, inside the lock, so the
      // next call that reads the slot finds no key (spec §9). Its files are named by the id the listing read.
      const slot = await storedSlot(id);
      if (slot === 'unreadable') return act.refuse(reply, 'write-failed');
      if (slot !== null) await removeLinearSlot(opts.ccrcDir, slot.id);
    } catch {
      return act.refuse(reply, 'write-failed');
    }
    return act.ok(await listAnswer());
  });
}
