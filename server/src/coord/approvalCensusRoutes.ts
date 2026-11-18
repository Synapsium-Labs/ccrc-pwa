import type { FastifyInstance } from 'fastify';
import { noStoreRoute } from '../accounts/gate.js';
import { refuseRoute } from '../refuse.js';
import { APPROVAL_CENSUS_DEFAULT_DAYS, APPROVAL_CENSUS_MAX_DAYS } from '../../../shared/approval-census.js';
import { approvalCensusOf } from './approvalCensus.js';
import type { ApprovalCensusSources } from './questions.js';

/**
 * THE APPROVAL CENSUS'S READ (approvals plan 2026-11-18, §3.1 and Task 1.4): `GET /api/approvals/census?days=N`, the
 * counts of every permission prompt in the last N days (1 to `APPROVAL_CENSUS_MAX_DAYS`, `APPROVAL_CENSUS_DEFAULT_DAYS`
 * when absent) by path, state, release reason, class, thread, deny currency, programme, authority and route, the read
 * prompts PR 6's gate counts, M38, the approval pushes by source, and the redacted rows.
 *
 *  - SESSION-GATED, NO BOX TOKEN. The global auth gate takes it like every PWA-surface read (it is in no EXEMPT table):
 *    the operator's console reads it, and a session's own hand does not. The box-token census lists it as
 *    `APPROVAL_CENSUS_DOORS`. A static path, so Fastify's router prefers it to the box-token lane's `/api/approvals/:id`.
 *  - IT NEVER ANSWERS AN INPUT. Every summary is the stored, masked and redacted one (`approvalCensusOf` cuts it to the
 *    envelope's 200 characters); the unredacted input the questions owner holds for a row's window is never read here.
 *  - A STORE THAT CANNOT BE READ IS SAID SO (`unavailable`), never an empty census: the M38 card shows "unmeasured".
 *
 * L4: it reads the query and the questions owner's sources (`questions.ts#censusSources`: that owner holds the approvals
 * and census rows, so no question-table read happens here) and answers on the reply. Every decision is
 * `approvalCensus.ts` (L1, pure). Not registered here: `server.ts` calls `registerApprovalCensusRoutes`.
 */
export interface ApprovalCensusRouteDeps {
  /** `[fromMs, toMs)`'s sources; undefined when the server has no coordination store. */
  readonly sources: (fromMs: number, toMs: number) => ApprovalCensusSources | undefined;
  readonly wall: () => number;
}

const DAY_MS = 86_400_000;

export function registerApprovalCensusRoutes(app: FastifyInstance, deps: ApprovalCensusRouteDeps): void {
  app.get('/api/approvals/census', { onRequest: noStoreRoute.onRequest }, (req, reply) => {
    const raw = (req.query as Record<string, unknown> | undefined)?.['days'];
    let days = APPROVAL_CENSUS_DEFAULT_DAYS;
    if (raw !== undefined) {
      const n = typeof raw === 'string' && /^[1-9][0-9]{0,2}$/.test(raw) ? Number(raw) : NaN;
      if (!(n >= 1 && n <= APPROVAL_CENSUS_MAX_DAYS)) return refuseRoute(reply, 'bad-request', { why: `days is 1 to ${APPROVAL_CENSUS_MAX_DAYS}` });
      days = n;
    }
    const toMs = deps.wall();
    const fromMs = toMs - days * DAY_MS;
    let read: ApprovalCensusSources | undefined;
    try {
      read = deps.sources(fromMs, toMs + 1);
    } catch (e) {
      return refuseRoute(reply, 'unavailable', { detail: `the approval census cannot be read (${e instanceof Error ? e.message : String(e)})` });
    }
    if (read === undefined) return refuseRoute(reply, 'not-configured', { detail: 'this server has no coordination store' });
    const { approvals, census, pushes } = read;
    if (!approvals.ok) return refuseRoute(reply, 'unavailable', { detail: `the approvals rows cannot be read (${approvals.detail})` });
    if (!census.ok) return refuseRoute(reply, 'unavailable', { detail: `the census rows cannot be read (${census.detail})` });
    return approvalCensusOf({
      days, fromMs, toMs,
      // The deny-currency fact is read once approvals PR 0's column is on the row; until then a row does not say.
      approvals: approvals.rows.map((a) => ({ ...a, denyCurrent: null })),
      census: census.rows,
      pushesBySource: pushes,
    });
  });
}
