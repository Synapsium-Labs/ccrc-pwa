/**
 * What a typed or pasted workspace name BECOMES: its kind, its slug and its display title, with Linear asked for
 * the real title when the name is a ticket and a key is connected.
 *
 * ONE OWNER of that answer, shared by the two callers that must never disagree: the PREVIEW read
 * (`GET /api/linear/resolve`, `routes.ts`) and the CREATE (`POST /api/projects/:project/workspaces`, `server.ts`).
 * If each composed it, the title the operator saw in the sheet could differ from the one the board shows after Start.
 *
 * L3: it reads the slot store and a key file and calls Linear, and decides nothing the grammar (`shared/slug.ts`, L0),
 * the router (`route.ts`, L1) or the title format (`title.ts`, L1) has not already decided. The ticket's title is asked
 * through the slot that holds its team (spec 2026-10-31 §6.10, #1444), the legacy `linear.key` among them. It never rejects, every Linear failure arm degrades to the
 * offline title carrying its fixed word as `reason`, and neither the key, its digest nor Linear's text leaves it.
 */
import type { LinearFailure, ResolveAnswer } from '../../../shared/linear.js';
import { deriveWorkspaceSlug, offlineTitle, sanitizeTitle, type LinearRef } from '../../../shared/slug.js';
import { lookupLinearIssue, type FetchLike, type LinearLookup } from './client.js';
import { clearLinearVerdict, markLinearRejected } from './connection.js';
import { oneCallOutcome, type LinearRateService } from './rate.js';
import { routableSlots, routeLinear } from './route.js';
import {
  LEGACY_SLOT, clearLinearSlotVerdict, markLinearSlotRejected, readLinearSlotKey, readLinearStore,
  type LinearSlotRef, type LinearStoreRead,
} from './store.js';
import { ticketTitle } from './title.js';

export interface ResolveDeps {
  /** The config's ccrc dir (`cfg.ccrcDir`), where `linear.key` and the slot store `linear/` live. */
  ccrcDir: string;
  /**
   * The ONE Linear rate service (D-7670, spec §6.7), asked before the lookup on the routed slot's `request` lane: all three callers
   * start it from a cookie-gated request. REQUIRED as the service or `null`, so a caller decides: null (a test, a
   * script) is the offline title with no Linear call (D-7684), as a refused take is.
   */
  rate: LinearRateService | null;
  /** Test seams: the network, the deadline and the clock. Absent in production. */
  fetch?: FetchLike;
  timeoutMs?: number;
  now?: () => number;
}

/** The display title of an accepted name and where it came from; `reason` is the Linear failure arm on an offline fallback. */
export interface ResolvedTitle { title: string; source: 'linear' | 'offline'; reason?: LinearFailure }

/**
 * The title for a name, given the Linear `ticket` it names (null for a plain one). Linear's when the name is a ticket, a
 * key is connected and Linear answers; otherwise the offline title. Always sanitised and within `WS_TITLE_MAX_BYTES`, so
 * ccd's `--title` refusals cannot be reached by a lookup.
 *
 * THE TICKET IS A PARAMETER, NOT DERIVED HERE, because the two callers read a name differently: a create's name was
 * accepted by the slug grammar (`deriveWorkspaceSlug`, whose `ticket` is this), and a rename's was not asked to be (a
 * rename never changes the slug, so a title the grammar refuses is still a title, and its ticket is `parseLinearRef`'s).
 */
export async function resolveTitle(ref: string, ticket: LinearRef | null, deps: ResolveDeps): Promise<ResolvedTitle> {
  // `offlineTitle` is null for a name the slug grammar refuses (a rename's title may be one); the trimmed text is the operator's own.
  const offline = sanitizeTitle(offlineTitle(ref) ?? ref.trim());
  if (ticket === null) return { title: offline, source: 'offline' };

  // 1. THE STORE, ROUTED (spec §6.10, §4.2). The ticket's prefix picks the slot that holds its team, against the teams
  // the slots have recorded. A miss is never refreshed here, so a create never waits on Linear for teams.
  const slot = routeTicket(await readLinearStore(deps.ccrcDir), ticket);
  if (slot === null) return { title: offline, source: 'offline', reason: 'not-configured' };

  // 3. The routed slot's key, read now from its file. No usable key: `not-configured`, answered with no call, so
  // nothing is asked of the rate service either.
  const key = await readLinearSlotKey(deps.ccrcDir, slot);
  const net = { fetch: deps.fetch, timeoutMs: deps.timeoutMs };
  let look: LinearLookup;
  if (key.kind !== 'key') {
    look = await lookupLinearIssue(ticket, key, net);
  } else {
    // 2. THE RATE SERVICE before the call (spec §6.7), on the routed slot's request lane. Absent, or refusing (the lane
    // is spent, or the slot is closed after Linear's own rate limit): the offline title, and nothing calls Linear.
    const rate = deps.rate;
    if (rate === null) return { title: offline, source: 'offline', reason: 'rate-limited' };
    const ask = rate.take({ lane: 'request', slot, calls: 1 });
    if (!ask.ok) return { title: offline, source: 'offline', reason: 'rate-limited' };
    look = await lookupLinearIssue(ticket, key, net);
    // One call made; Linear's own `rate-limited` closes the slot for the wait it carried.
    rate.settle(ask.grant, oneCallOutcome(look));
  }
  // 4. The verdicts are aimed at the ROUTED slot, by its id and the digest the lookup used: a file slot's own record,
  // and for the legacy slot today's legacy calls. Their failing never changes the answer.
  const at = (deps.now ?? Date.now)();
  if (look.ok) {
    // A success with this key refutes a stale 401/403 mark against it (design §5.1).
    const digest = look.keyDigest;
    await (slot.source === 'legacy' ? clearLinearVerdict(deps.ccrcDir, digest, at) : clearLinearSlotVerdict(deps.ccrcDir, slot.id, digest, at))
      .catch(() => { console.warn('ccrc-server: linear: could not clear a stale key verdict'); });
    // Composed, then sanitised AGAIN: the lookup's title fits the cap alone, and `ENG-1234 - ` in front of it may
    // push the whole past it.
    return { title: sanitizeTitle(ticketTitle(look.identifier, look.title)), source: 'linear' };
  }
  if (look.reason === 'unauthorised') {
    // The 401 marker (design §5.1), and ONLY a 401's: a 403 (`forbidden`) is Linear refusing this request, not a verdict
    // on the key, and falls through to the offline title unmarked. Both markers compare digests, so a key replaced
    // meanwhile is never condemned.
    const digest = look.keyDigest;
    await (slot.source === 'legacy' ? markLinearRejected(deps.ccrcDir, digest, at) : markLinearSlotRejected(deps.ccrcDir, slot.id, digest, at))
      .catch(() => {
        // Fixed words only: the error can carry a path, and the digest and key stay out of the line.
        console.warn('ccrc-server: linear: could not record a rejected key');
      });
  }
  return { title: offline, source: 'offline', reason: look.reason };
}

/**
 * The slot a ticket's title is asked through (spec §6.10 steps 1 and 5), or null for none. Routed by its prefix
 * against the recorded teams, the legacy slot among them once learned (§3.4). When routing finds no slot (none, an
 * unknown team, or an ambiguous one), the legacy key is the fallback ONLY while its workspace is not yet learned, as
 * on `main`; once learned, it answers for its own teams and no others. A store that cannot be listed keeps `main`'s
 * behaviour: the legacy key.
 */
function routeTicket(store: LinearStoreRead, ticket: LinearRef): LinearSlotRef | null {
  if (store.kind !== 'listed') return LEGACY_SLOT;
  const routed = routeLinear(routableSlots(store), { kind: 'issue', prefix: ticket.key, workspace: null });
  if (routed.kind === 'slot') return routed.slot.ref;
  return store.legacy !== null && store.legacy.workspace === null ? LEGACY_SLOT : null;
}

/** The caller has checked `ref` is a string within `LINEAR_REF_MAX_CHARS`. */
export async function resolveName(ref: string, deps: ResolveDeps): Promise<ResolveAnswer> {
  const ask = deriveWorkspaceSlug(ref);
  if (ask.kind === 'auto') return { kind: 'auto', slug: null, title: null, source: 'offline' };
  if (ask.kind === 'refused') {
    return { kind: 'refused', slug: null, title: null, source: 'offline', reason: ask.reason };
  }
  const t = await resolveTitle(ref, ask.ticket, deps);
  return {
    kind: 'named', slug: ask.slug, title: t.title, source: t.source, ...(t.reason === undefined ? {} : { reason: t.reason }),
  };
}
