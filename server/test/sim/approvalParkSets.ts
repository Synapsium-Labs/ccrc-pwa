// The park's mutant sets (approvals plan 2026-11-18, §3.3 and Tasks 3.1 to 3.3; approvals PR 3; the floors rule is D-8217):
// each L1 decider of server/src/coord/approvalPark.ts, and `decideApprovalLapse`'s and `decideDeferredApprovalPush`'s park
// arms in server/src/coord/questionPolicy.ts, run against every case of `../approvalParkCases.ts` over a mutated copy of
// its module. Registered in mutation-floors.test.ts's MUTANT_SETS, with a floor in mutation-floors.json.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { APPROVAL_LAPSE_PARK_CASES, APPROVAL_PARK_CASES, type ApprovalLapseModule, type ApprovalParkModule } from '../approvalParkCases.js';
import type { MutantSet, SuiteCase } from './mutate.js';

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src/coord');
const PARK_TS = path.join(SRC, 'approvalPark.ts');
const POLICY_TS = path.join(SRC, 'questionPolicy.ts');

const parkSuite = (mod: ApprovalParkModule): Record<string, SuiteCase> =>
  Object.fromEntries(APPROVAL_PARK_CASES.map((c) => [c.name, () => c.run(mod)]));
const lapseSuite = (mod: ApprovalLapseModule): Record<string, SuiteCase> =>
  Object.fromEntries(APPROVAL_LAPSE_PARK_CASES.map((c) => [c.name, () => c.run(mod)]));

export const PARK_WORD_SET: MutantSet<ApprovalParkModule> = {
  modulePath: PARK_TS,
  mutants: [
    { id: 'PW-1 the live lane is not read', old: 'if (!laneLive || !signedIn) return', new: 'if (!signedIn) return' },
    { id: 'PW-2 sign-in is not read (F12)', old: 'if (!laneLive || !signedIn) return', new: 'if (!laneLive) return' },
    { id: 'PW-3 no cap', old: "return slotsTaken >= APPROVAL_PARK_SLOTS ? 'capped' : 'live';", new: "return 'live';" },
    { id: 'PW-4 the cap one late', old: 'slotsTaken >= APPROVAL_PARK_SLOTS', new: 'slotsTaken > APPROVAL_PARK_SLOTS' },
    { id: 'PW-5 a capped word folded into shadow', old: "? 'capped' : 'live'", new: "? 'shadow' : 'live'" },
    { id: 'PW-6 the cap before the lane', old: "  if (!laneLive || !signedIn) return 'shadow';\n  return slotsTaken", new: "  if (slotsTaken >= APPROVAL_PARK_SLOTS) return 'capped';\n  if (!laneLive || !signedIn) return 'shadow';\n  return slotsTaken" },
  ],
  suite: parkSuite,
};

export const PARK_KEY_SET: MutantSet<ApprovalParkModule> = {
  modulePath: PARK_TS,
  mutants: [
    { id: 'PK-1 the run is dropped from the key (F8-d)', old: 'return `${childId}:${runId}:${inputSha256}`;', new: 'return `${childId}:${inputSha256}`;' },
    { id: 'PK-2 the input is dropped from the key', old: 'return `${childId}:${runId}:${inputSha256}`;', new: 'return `${childId}:${runId}`;' },
  ],
  suite: parkSuite,
};

export const CLASS_MEETS_SET: MutantSet<ApprovalParkModule> = {
  modulePath: PARK_TS,
  mutants: [
    { id: 'CM-1 a higher class meets', old: 'return fresh <= 1 && fresh <= rankOf(rulingClass);', new: 'return fresh <= 1;' },
    { id: 'CM-2 forbidden meets', old: 'return fresh <= 1 && fresh <= rankOf(rulingClass);', new: 'return fresh <= rankOf(rulingClass);' },
    { id: 'CM-3 only an equal class meets', old: 'fresh <= rankOf(rulingClass)', new: 'fresh === rankOf(rulingClass)' },
    { id: 'CM-4 an unknown class ranks lowest', old: 'CLASS_RANK[c] as number : 3)', new: 'CLASS_RANK[c] as number : -1)' },
  ],
  suite: parkSuite,
};

export const PARK_OPEN_SET: MutantSet<ApprovalParkModule> = {
  modulePath: PARK_TS,
  mutants: [
    { id: 'PO-1 a void park is open', old: 'return !park.void && (park.horizon === null', new: 'return (park.horizon === null' },
    { id: 'PO-2 the horizon is inclusive', old: 'now < park.horizon);', new: 'now <= park.horizon);' },
    { id: 'PO-3 no horizon closes it', old: '(park.horizon === null || now < park.horizon)', new: '(park.horizon !== null && now < park.horizon)' },
    { id: 'PO-4 the horizon is an hour', old: 'parkedAt + APPROVAL_PARK_HORIZON_MS;', new: 'parkedAt + APPROVAL_PARK_HORIZON_MS / 2;' },
  ],
  suite: parkSuite,
};

export const PARK_RECORD_SET: MutantSet<ApprovalParkModule> = {
  modulePath: PARK_TS,
  mutants: [
    { id: 'PR-1 a held row is recorded on', old: "if (row.state !== 'parked' || park === null", new: 'if (park === null' },
    { id: 'PR-2 a closed park takes a ruling', old: ' || park === null || !parkOpen(park, now)) return \'hook-gone\';', new: ' || park === null) return \'hook-gone\';' },
    { id: 'PR-3 a second ruling replaces an unspent one (T8-4)', old: "  if (parkHasUnspentRuling(park)) return 'park-ruled';\n", new: '' },
    { id: 'PR-4 a spent ruling blocks (F5)', old: 'park.ruling !== null && !park.ruling.spent;', new: 'park.ruling !== null;' },
    { id: 'PR-5 a coordinator deny does not stop an allow (F3)', old: "  if (park.coordDenied) return 'coordinator-denied';\n", new: '' },
    { id: 'PR-6 a deny is checked like an allow', old: "  if (verdict === 'deny') return null;\n  if (park.coordDenied)", new: '  if (park.coordDenied)' },
    { id: 'PR-7 a forbidden row may be allowed', old: "  if (row.class === 'forbidden') return 'guard-forbidden';\n  if (authority", new: '  if (authority' },
    { id: 'PR-8 the coordinator allows a non-current row', old: "    if (!row.denyCurrent) return 'deny-not-current';\n    if (row.class !== 'ordinary')", new: "    if (row.class !== 'ordinary')" },
    { id: 'PR-9 the coordinator allows escalate', old: "    if (row.class !== 'ordinary') return 'guard-escalate';\n    return null;", new: '    return null;' },
    { id: 'PR-10 the operator allows an unknown class', old: "return row.class === 'ordinary' || row.class === 'escalate' ? null : 'guard-escalate';", new: 'return null;' },
    { id: 'PR-11 the operator is held to the coordinator rule', old: "  if (authority === 'coordinator') {\n    if (!row.denyCurrent)", new: '  if (true) {\n    if (!row.denyCurrent)' },
  ],
  suite: parkSuite,
};

export const SIGNING_SET: MutantSet<ApprovalParkModule> = {
  modulePath: PARK_TS,
  mutants: [
    { id: 'SG-1 no claimant check at signing (the heir, F8-b)', old: "  if (f.authority === 'coordinator' && f.claimantNow !== f.ruler) return 'parent-changed';\n", new: '' },
    { id: 'SG-2 the claimant checked for an allow only', old: "  if (f.authority === 'coordinator' && f.claimantNow !== f.ruler) return 'parent-changed';\n  if (f.verdict === 'deny') return null;", new: "  if (f.verdict === 'deny') return null;\n  if (f.authority === 'coordinator' && f.claimantNow !== f.ruler) return 'parent-changed';" },
    { id: 'SG-3 the operator checked against the claimant', old: "if (f.authority === 'coordinator' && f.claimantNow !== f.ruler)", new: 'if (f.claimantNow !== f.ruler)' },
    { id: 'SG-4 a deny is guarded', old: "  if (f.verdict === 'deny') return null;\n  if (f.parkDenied)", new: '  if (f.parkDenied)' },
    { id: 'SG-5 the key\'s deny is not final', old: "  if (f.parkDenied) return 'coordinator-denied';\n", new: '' },
    { id: 'SG-6 a fresh forbidden is signed', old: "f.rowClass === 'forbidden' || f.freshClass === 'forbidden'", new: "f.rowClass === 'forbidden'" },
    { id: 'SG-7 a stored forbidden is signed', old: "f.rowClass === 'forbidden' || f.freshClass === 'forbidden'", new: "f.freshClass === 'forbidden'" },
    { id: 'SG-8 the row\'s deny currency unread', old: "    if (!f.rowDenyCurrent) return 'deny-not-current';\n", new: '' },
    { id: 'SG-9 no re-check of deny currency at signing (F2 carry)', old: "    if (f.denyStandingNow !== 'unread' && f.denyStandingNow !== 'current') return 'deny-not-current';\n", new: '' },
    { id: 'SG-10 an unread standing refuses (the absent-read path changes)', old: "f.denyStandingNow !== 'unread' && f.denyStandingNow !== 'current'", new: "f.denyStandingNow !== 'current'" },
    { id: 'SG-11 history counts as current', old: "f.denyStandingNow !== 'unread' && f.denyStandingNow !== 'current'", new: "f.denyStandingNow === 'none'" },
    { id: 'SG-12 the fresh class is not checked', old: "f.rowClass === 'ordinary' && f.freshClass === 'ordinary' ? null", new: "f.rowClass === 'ordinary' ? null" },
    { id: 'SG-13 the stored class is not checked', old: "f.rowClass === 'ordinary' && f.freshClass === 'ordinary' ? null", new: "f.freshClass === 'ordinary' ? null" },
    { id: 'SG-14 the operator is held to ordinary', old: "const known = (c: string): boolean => c === 'ordinary' || c === 'escalate';", new: "const known = (c: string): boolean => c === 'ordinary';" },
    { id: 'SG-15 the operator signs any class', old: "return known(f.rowClass) && known(f.freshClass) ? null : 'guard-escalate';", new: 'return null;' },
    { id: 'SG-16 the operator held to deny currency', old: "  if (f.authority === 'coordinator') {\n    if (!f.rowDenyCurrent)", new: '  if (true) {\n    if (!f.rowDenyCurrent)' },
  ],
  suite: parkSuite,
};

export const FETCHED_SET: MutantSet<ApprovalParkModule> = {
  modulePath: PARK_TS,
  mutants: [
    { id: 'FA-1 always recorded (F2-a)', old: 'return now <= expiresAt - graceMs;', new: 'return true;' },
    { id: 'FA-2 no grace', old: 'return now <= expiresAt - graceMs;', new: 'return now <= expiresAt;' },
    { id: 'FA-3 the grace edge excluded', old: 'return now <= expiresAt - graceMs;', new: 'return now < expiresAt - graceMs;' },
  ],
  suite: parkSuite,
};

export const PARKED_VIEW_SET: MutantSet<ApprovalParkModule> = {
  modulePath: PARK_TS,
  mutants: [
    { id: 'PV-1 every state is listed', old: ".filter((r) => r.state === 'parked' && (r.park === null || parkOpen(r.park, now)))", new: '.filter((r) => r.park === null || parkOpen(r.park, now))' },
    { id: 'PV-2 a closed park is listed', old: ".filter((r) => r.state === 'parked' && (r.park === null || parkOpen(r.park, now)))", new: ".filter((r) => r.state === 'parked')" },
    { id: 'PV-3 newest first', old: '.sort((a, b) => a.id - b.id);', new: '.sort((a, b) => b.id - a.id);' },
    { id: 'PV-4 a spent ruling shown', old: 'ruled: r.park !== null && parkHasUnspentRuling(r.park) && r.park.ruling !== null', new: 'ruled: r.park !== null && r.park.ruling !== null' },
    { id: 'PV-5 the input withheld', old: 'input: r.inputRedacted,', new: 'input: null,' },
  ],
  suite: parkSuite,
};

export const LAPSE_PARK_SET: MutantSet<ApprovalLapseModule> = {
  modulePath: POLICY_TS,
  mutants: [
    { id: 'LP-1 a live word lapses', old: "return row.parkWord === 'live' ? 'park' : row.parkWord === 'shadow' ? 'shadow-park' : 'lapse';", new: "return row.parkWord === 'shadow' ? 'shadow-park' : 'lapse';" },
    { id: 'LP-2 any word parks', old: "row.parkWord === 'live' ? 'park'", new: "row.parkWord !== null && row.parkWord !== undefined ? 'park'" },
    { id: 'LP-3 the shadow records nothing', old: "row.parkWord === 'shadow' ? 'shadow-park' : 'lapse'", new: "'lapse'" },
    { id: 'LP-4 a parked row is never staled', old: "if (row.state === 'parked') return park === null || park.void || (park.horizon !== null && now >= park.horizon) ? 'stale' : 'none';", new: "if (row.state === 'parked') return 'none';" },
    { id: 'LP-5 a void park is not staled', old: 'park === null || park.void || (park.horizon', new: 'park === null || (park.horizon' },
    { id: 'LP-6 a missing park is not staled', old: 'park === null || park.void || (park.horizon !== null && now >= park.horizon)', new: 'park !== null && (park.void || (park.horizon !== null && now >= park.horizon))' },
    { id: 'LP-7 the horizon one late', old: 'now >= park.horizon) ? \'stale\'', new: 'now > park.horizon) ? \'stale\'' },
    { id: 'LP-8 a parked row lapses at the ceiling', old: "  if (row.state === 'parked') return park", new: "  if (row.state === 'parked' && now >= ceiling) return 'stale';\n  if (row.state === 'parked') return park" },
    { id: 'LP-9 no last-poll move (F2)', old: "&& now >= row.notifyAt + graceMs && now < ceiling) return 'park';", new: "&& false) return 'park';" },
    { id: 'LP-10 the last poll ignores fetchedAt', old: "row.fetchedAt === null && row.parkWord === 'live'", new: "row.parkWord === 'live'" },
    { id: 'LP-11 the last poll ignores the word (historical and shadow rows move)', old: "row.fetchedAt === null && row.parkWord === 'live'", new: 'row.fetchedAt === null' },
    { id: 'LP-12 the last poll ignores the grace', old: 'now >= row.notifyAt + graceMs && now < ceiling', new: 'now >= row.notifyAt && now < ceiling' },
    { id: 'LP-13 the last poll ignores the ceiling', old: 'now >= row.notifyAt + graceMs && now < ceiling', new: 'now >= row.notifyAt + graceMs' },
    { id: 'LP-14 the deferred push keeps a parked entry', old: "  if (mine.some((x) => x.state === 'parked')) return 'drop';\n", new: '' },
  ],
  suite: lapseSuite,
};

export const APPROVAL_PARK_MUTANT_SETS: Record<string, MutantSet<never>> = {
  'server/src/coord/approvalPark.ts#parkWordAt': PARK_WORD_SET as MutantSet<never>,
  'server/src/coord/approvalPark.ts#parkKeyOf': PARK_KEY_SET as MutantSet<never>,
  'server/src/coord/approvalPark.ts#classMeets': CLASS_MEETS_SET as MutantSet<never>,
  'server/src/coord/approvalPark.ts#parkOpen': PARK_OPEN_SET as MutantSet<never>,
  'server/src/coord/approvalPark.ts#parkRecordRefusal': PARK_RECORD_SET as MutantSet<never>,
  'server/src/coord/approvalPark.ts#signingRefusal': SIGNING_SET as MutantSet<never>,
  'server/src/coord/approvalPark.ts#fetchedAtRecordable': FETCHED_SET as MutantSet<never>,
  'server/src/coord/approvalPark.ts#parkedApprovalViewOf': PARKED_VIEW_SET as MutantSet<never>,
  'server/src/coord/questionPolicy.ts#decideApprovalLapse': LAPSE_PARK_SET as MutantSet<never>,
};
