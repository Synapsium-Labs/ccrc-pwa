// THE OPERATOR DOOR'S `approval-<n>` ARM (approvals plan 2026-11-18, §3.3.2, F3-a; approvals PR 3). Ring L4, context C6
// (operator questions): the arm's front ladder after the door has parsed the id, then the questions owner's core. It lives in
// the approvals lane's own file because the door it joins (`POST /api/questions/:id/answer`) is registered in the held route
// file: that door's one added arm (item 486's packet, H3) hands an `approval-<n>` id to this handler before its
// `kind-mismatch` answer, with the account gate reaching the door's wiring. The park's lane stays gated until PR 3v.
//
// The ladder: the account gate first, WITH ITS STEP-UP (it answers `auth-off` while sign-in is dark, as the gate's other
// step-up doors do, and an unfresh session is asked to step up); then the body, `{kind: 'approval', verdict, reason?}`, where
// the reason is one line of at most `APPROVAL_REASON_MAX_CHARS` and defaults to a sentence that says where it was ruled; then
// the core (`Questions#operatorRuleApproval`), which records the ruling on the row's park as authority `operator` and nudges
// the child; the row's principal is `operator`, as a pane answer's is. NOTHING here reaches a press function: the
// operator's ruling is signed at the child's retry, never answered by pressing a menu (routing spec §6.2, T3-3).
import type { FastifyReply, FastifyRequest } from 'fastify';
import { APPROVAL_REASON_MAX_CHARS, ASK_OPERATOR_PRINCIPAL } from '../../../shared/api.js';
import type { AccountGate } from '../accounts/gate.js';
import { refuseRoute } from '../refuse.js';
import type { Questions } from './questions.js';

/** The reason recorded when the operator gives none. */
export const OPERATOR_PARK_DEFAULT_REASON = 'ruled by the operator on Waiting on you';

/** What the arm reads: the account gate (with its step-up) and the questions owner's core. */
export interface ApprovalOperatorArmDeps {
  readonly gate: AccountGate;
  readonly questions: Pick<Questions, 'operatorRuleApproval'>;
}

/** The body, read: `kind` must be `approval`, `verdict` `allow` or `deny`, and `reason`, when given, one line of 1 to
 *  `APPROVAL_REASON_MAX_CHARS` characters. Null for anything else. */
export function readOperatorApprovalBody(body: unknown): { verdict: 'allow' | 'deny'; reason: string } | null {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return null;
  const b = body as Record<string, unknown>;
  if (b['kind'] !== 'approval' || (b['verdict'] !== 'allow' && b['verdict'] !== 'deny')) return null;
  const reason = b['reason'];
  if (reason === undefined) return { verdict: b['verdict'], reason: OPERATOR_PARK_DEFAULT_REASON };
  if (typeof reason !== 'string' || reason.trim() === '' || reason.length > APPROVAL_REASON_MAX_CHARS || /[\r\n]/.test(reason)) return null;
  return { verdict: b['verdict'], reason: reason.trim() };
}

/** The arm, for an `approval-<n>` id the door has parsed. Answers through the reply the gate or the core decided. */
export async function approvalOperatorArm(
  req: FastifyRequest, reply: FastifyReply, id: number, deps: ApprovalOperatorArmDeps,
): Promise<FastifyReply> {
  const g = deps.gate(req, reply, { cap: null, stepUp: true });
  if (!g.pass) return reply;
  const read = readOperatorApprovalBody(req.body);
  if (read === null) {
    return refuseRoute(reply, 'bad-request', { detail: `kind approval, verdict allow or deny, and an optional one-line reason of at most ${APPROVAL_REASON_MAX_CHARS} characters` });
  }
  const a = deps.questions.operatorRuleApproval({ id, verdict: read.verdict, reason: read.reason, by: ASK_OPERATOR_PRINCIPAL });
  return reply.code(a.status).send(a.body);
}
