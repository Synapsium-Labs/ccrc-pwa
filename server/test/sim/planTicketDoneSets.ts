// The programme work map WM1's mutant sets (D-8727): `runMustNameTicket`, `parsePlanTicketDone`, `ticketDoneVerdict` and
// `landedFactOf` in `server/src/coord/planPolicy.ts`, each run against every case of `../planTicketDoneCases.ts` loaded
// over the mutated copy. Registered in mutation-floors.test.ts's MUTANT_SETS, with a floor each in mutation-floors.json.
// The brief's red checks: the ticket-required rule (TR-*), each evidence check (EV-*, LF-*), the body's closed shape and
// its one evidence key (BD-*), and the evidence-already-stored rule with its auto-ticket exception (ST-*).
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TICKET_DONE_CASES, type PlanPolicyModule } from '../planTicketDoneCases.js';
import type { MutantSet, SuiteCase } from './mutate.js';

const POLICY_TS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src/coord/planPolicy.ts');
export const RUN_MUST_NAME_TICKET_KEY = 'server/src/coord/planPolicy.ts#runMustNameTicket';
export const PARSE_TICKET_DONE_KEY = 'server/src/coord/planPolicy.ts#parsePlanTicketDone';
export const TICKET_DONE_VERDICT_KEY = 'server/src/coord/planPolicy.ts#ticketDoneVerdict';
export const LANDED_FACT_KEY = 'server/src/coord/planPolicy.ts#landedFactOf';

const suite = (m: PlanPolicyModule): Record<string, SuiteCase> =>
  Object.fromEntries(TICKET_DONE_CASES.map((c) => [c.name, () => c.run(m)]));
const set = (mutants: MutantSet<PlanPolicyModule>['mutants']): MutantSet<PlanPolicyModule> => ({ modulePath: POLICY_TS, mutants, suite });

export const RUN_MUST_NAME_TICKET_SET = set([
  // The rule removed whole, then each of its four conditions.
  { id: 'TR-1', old: "  return tickets.some((t) => t.state === 'open' && t.runId === null && !isAutoTicketKey(t.key));\n}", new: '  return false;\n}' },
  { id: 'TR-2', old: '  if (!phased) return false;\n  return tickets.some(', new: '  return tickets.some(' },
  { id: 'TR-3', old: "tickets.some((t) => t.state === 'open' && t.runId === null && !isAutoTicketKey(t.key))", new: 'tickets.some((t) => t.runId === null && !isAutoTicketKey(t.key))' },
  { id: 'TR-4', old: "tickets.some((t) => t.state === 'open' && t.runId === null && !isAutoTicketKey(t.key))", new: "tickets.some((t) => t.state === 'open' && !isAutoTicketKey(t.key))" },
  { id: 'TR-5', old: "tickets.some((t) => t.state === 'open' && t.runId === null && !isAutoTicketKey(t.key))", new: "tickets.some((t) => t.state === 'open' && t.runId === null)" },
]);

export const PARSE_TICKET_DONE_SET = set([
  { id: 'BD-1', old: "  const x = closed(body, ['ticket', 'evidence'], 'body');\n  if (x) return verbBad(x);", new: '' },
  { id: 'BD-2', old: "  if (keys.length !== 1) return verbBad('evidence names exactly one of runId or pr');", new: "  if (keys.length === 0) return verbBad('evidence names exactly one of runId or pr');" },
  { id: 'BD-3', old: '!Number.isSafeInteger(v) || (v as number) < 1)', new: '!Number.isSafeInteger(v))' },
  { id: 'BD-4', old: '!Number.isSafeInteger(v) || (v as number) < 1)', new: "typeof v !== 'number' || (v as number) < 1)" },
  { id: 'BD-5', old: "  if (!isPlanKey(body.ticket)) return verbBad('ticket is not a plan key');\n  const ev = body.evidence;", new: '  const ev = body.evidence;' },
]);

export const TICKET_DONE_VERDICT_SET = set([
  // The ticket's own state (F21's words).
  { id: 'EV-1', old: "  if (ticketIsHeld(t)) return refuse('plan-runs-open',", new: "  if (false) return refuse('plan-runs-open'," },
  { id: 'EV-2', old: "  if (t.state !== 'open') return refuse('plan-bad-body',", new: "  if (false) return refuse('plan-bad-body'," },
  // { runId }: each check removed.
  { id: 'EV-3', old: "    if (r === null) return refuse('evidence-unverified', `no run ${ev.runId}`);", new: "    if (r === null) return { ok: true };" },
  { id: 'EV-4', old: "    if (r.program !== f.program || r.kind !== 'work') return refuse(", new: "    if (r.kind !== 'work') return refuse(" },
  { id: 'EV-5', old: "    if (r.program !== f.program || r.kind !== 'work') return refuse(", new: '    if (r.program !== f.program) return refuse(' },
  { id: 'EV-6', old: "    if (r.state !== 'done') return refuse('evidence-unverified',", new: "    if (false) return refuse('evidence-unverified'," },
  { id: 'EV-7', old: '    if (r.ticketId !== null && r.ticketId !== t.id && !(r.ticketKey !== null && isAutoTicketKey(r.ticketKey))) {', new: '    if (false) {' },
  { id: 'EV-7b', old: '    if (r.ticketId !== null && r.ticketId !== t.id && !(r.ticketKey !== null && isAutoTicketKey(r.ticketKey))) {', new: '    if (r.ticketId !== null && r.ticketId !== t.id) {' },
  { id: 'EV-7c', old: '    if (r.ticketId !== null && r.ticketId !== t.id && !(r.ticketKey !== null && isAutoTicketKey(r.ticketKey))) {', new: '    if (r.ticketId !== null && !(r.ticketKey !== null && isAutoTicketKey(r.ticketKey))) {' },
  // { pr }: each landing-line answer removed.
  { id: 'EV-8', old: "    if (l === null || l.kind === 'no-entry') {", new: '    if (l === null) {' },
  { id: 'EV-9', old: "    if (l.kind === 'unreadable') return refuse(", new: "    if (false) return refuse(" },
  { id: 'EV-10', old: "    if (l.kind === 'unlanded') return refuse(", new: "    if (false) return refuse(" },
  // F2: the evidence-already-stored rule, its auto-ticket exception, and a pull request being one project's.
  { id: 'ST-1', old: '  if (taken !== undefined) return refuse(', new: '  if (false) return refuse(' },
  { id: 'ST-2', old: "  const ownAuto = 'runId' in ev && f.run !== null ? f.run.ticketId : null;", new: '  const ownAuto = null;' },
  { id: 'ST-3', old: " && s.evidence.pr === ev.pr && s.project === t.project));", new: ' && s.evidence.pr === ev.pr));' },
  { id: 'ST-4', old: "    'runId' in ev ? 'runId' in s.evidence && s.evidence.runId === ev.runId", new: "    'runId' in ev ? 'runId' in s.evidence" },
]);

export const LANDED_FACT_SET = set([
  { id: 'LF-1', old: "  return mine.some((e) => e.state === 'landed') ? { kind: 'landed' }", new: "  return mine[mine.length - 1]!.state === 'landed' ? { kind: 'landed' }" },
  { id: 'LF-2', old: '  const mine = entries.filter((e) => e.pr === pr);', new: '  const mine = entries;' },
  { id: 'LF-3', old: "  if (mine.length === 0) return { kind: 'no-entry' };", new: '' },
]);

export const PLAN_TICKET_DONE_MUTANT_SETS: Record<string, MutantSet<never>> = {
  [RUN_MUST_NAME_TICKET_KEY]: RUN_MUST_NAME_TICKET_SET as MutantSet<never>,
  [PARSE_TICKET_DONE_KEY]: PARSE_TICKET_DONE_SET as MutantSet<never>,
  [TICKET_DONE_VERDICT_KEY]: TICKET_DONE_VERDICT_SET as MutantSet<never>,
  [LANDED_FACT_KEY]: LANDED_FACT_SET as MutantSet<never>,
};
