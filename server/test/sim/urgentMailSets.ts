// `urgentSenderVerdict`'s oracle and mutant set (mid-turn mail PR 2, plan Task 2.3). Its cases are written ONCE here, as
// suite cases over a module: `urgent-mail-rule.test.ts` runs them against the real module, and `mutation-floors.test.ts`
// runs them against each textual mutant (D-8217's every-run floors).
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect } from 'vitest';
import type { UrgentFacts } from '../../src/coord/urgentMail.js';
import type { MutantSet, SuiteCase } from './mutate.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

export type UrgentMailModule = typeof import('../../src/coord/urgentMail.js');

const COORD = 'lane-a-coordinator';
const WORKER = 'lane-a-worker';
const OVERLORD = 'lane-a-overlord';
/** The run `COORD` claims and `WORKER` works on. */
const RUN = 11;
/** A run of another coordinator that `WORKER` also works on. */
const OTHER_RUN = 12;
/** A run `COORD` claims that `WORKER` does not work on. */
const COORD_OTHER_RUN = 13;

/** `COORD` to the worker of run `RUN`, which `COORD` claims, naming `RUN`, with nobody designated. Each case overrides a
 *  field. */
const base = (over: Partial<UrgentFacts> = {}): UrgentFacts => ({
  senderId: COORD, recipientId: WORKER, runId: RUN, recipientWorksOn: [OTHER_RUN, RUN], senderClaims: [RUN, COORD_OTHER_RUN],
  recipientClaims: [], designation: { kind: 'not-designated' }, outstanding: false, ...over,
});
/** The designated Overlord to `COORD`, which claims run `RUN`, naming `RUN`. */
const overlord = (over: Partial<UrgentFacts> = {}): UrgentFacts => base({
  senderId: OVERLORD, recipientId: COORD, recipientWorksOn: [], senderClaims: [], recipientClaims: [RUN],
  designation: { kind: 'designated', sessionId: OVERLORD }, ...over,
});

export function urgentSenderVerdictCases(m: UrgentMailModule): Record<string, SuiteCase> {
  const allowed = (f: UrgentFacts, role: 'coordinator' | 'overlord') =>
    expect(m.urgentSenderVerdict(f)).toEqual({ kind: 'allowed', role });
  const code = (f: UrgentFacts) => {
    const v = m.urgentSenderVerdict(f);
    return v.kind === 'refused' ? v.code : `allowed:${v.role}`;
  };
  return {
    'a coordinator to the worker (or reviewer) of the run it names, which it claims: allowed, as coordinator': () => {
      allowed(base(), 'coordinator');
      allowed(base({ recipientWorksOn: [RUN], senderClaims: [RUN] }), 'coordinator');
    },
    'the coordinator names no run, or a run the recipient does not work on, or one it does not claim: urgent-wrong-run': () => {
      expect(code(base({ runId: null }))).toBe('urgent-wrong-run');
      expect(code(base({ runId: COORD_OTHER_RUN }))).toBe('urgent-wrong-run');
      expect(code(base({ runId: OTHER_RUN }))).toBe('urgent-wrong-run');
      expect(code(base({ runId: 99 }))).toBe('urgent-wrong-run');
    },
    'the wrong-run refusal names the runs that would do': () => {
      const v = m.urgentSenderVerdict(base({ runId: null }));
      expect(v).toMatchObject({ kind: 'refused', code: 'urgent-wrong-run' });
      expect(v.kind === 'refused' ? v.detail : '').toContain(`run ${RUN}`);
    },
    "a coordinator of none of the recipient's runs, a peer, or a session with no binding: urgent-not-allowed": () => {
      expect(code(base({ senderClaims: [COORD_OTHER_RUN], runId: COORD_OTHER_RUN }))).toBe('urgent-not-allowed');
      expect(code(base({ senderClaims: [] }))).toBe('urgent-not-allowed');
      expect(code(base({ recipientWorksOn: [] }))).toBe('urgent-not-allowed');
    },
    'a terminal run is no binding: the binding answers only open runs, so its worker works on nothing': () => {
      expect(code(base({ recipientWorksOn: [OTHER_RUN] }))).toBe('urgent-not-allowed');
    },
    'the designated Overlord to a coordinator, naming a run it claims: allowed, as overlord': () => {
      allowed(overlord(), 'overlord');
    },
    'the Overlord naming no run or another one: urgent-wrong-run; to a session that claims nothing: urgent-not-allowed': () => {
      expect(code(overlord({ runId: null }))).toBe('urgent-wrong-run');
      expect(code(overlord({ runId: OTHER_RUN }))).toBe('urgent-wrong-run');
      expect(code(overlord({ recipientClaims: [] }))).toBe('urgent-not-allowed');
    },
    'a session that is not the designated one, writing to a coordinator: urgent-not-allowed': () => {
      expect(code(overlord({ designation: { kind: 'designated', sessionId: 'lane-c-overlord' } }))).toBe('urgent-not-allowed');
      expect(code(overlord({ designation: { kind: 'not-designated' } }))).toBe('urgent-not-allowed');
    },
    'an unreadable fact is urgent-unmeasured, never urgent-not-allowed or urgent-wrong-run': () => {
      expect(code(base({ recipientWorksOn: 'unmeasured' }))).toBe('urgent-unmeasured');
      expect(code(base({ senderClaims: 'unmeasured' }))).toBe('urgent-unmeasured');
      expect(code(base({ runId: null, designation: { kind: 'unmeasured' } }))).toBe('urgent-unmeasured');
      expect(code(overlord({ recipientClaims: 'unmeasured' }))).toBe('urgent-unmeasured');
    },
    'a fact that cannot change the answer does not make it unmeasured': () => {
      allowed(base({ designation: { kind: 'unmeasured' }, recipientClaims: 'unmeasured' }), 'coordinator');
      allowed(overlord({ recipientWorksOn: 'unmeasured', senderClaims: 'unmeasured' }), 'overlord');
      expect(code(base({ senderClaims: [], recipientClaims: 'unmeasured' }))).toBe('urgent-not-allowed');
    },
    'a sender that qualifies both ways for the named run is stored as coordinator': () => {
      allowed(overlord({ recipientWorksOn: [RUN], senderClaims: [RUN] }), 'coordinator');
    },
    'a session never marks its own mail urgent': () => {
      expect(code(base({ recipientId: COORD, recipientClaims: [RUN], designation: { kind: 'designated', sessionId: COORD } })))
        .toBe('urgent-not-allowed');
    },
    'an allowed sender with an urgent mail to the same recipient still outstanding: urgent-outstanding': () => {
      expect(code(base({ outstanding: true }))).toBe('urgent-outstanding');
      expect(code(overlord({ outstanding: true }))).toBe('urgent-outstanding');
    },
    'a refused sender hears the rule, not the outstanding mail': () => {
      expect(code(base({ senderClaims: [], outstanding: true }))).toBe('urgent-not-allowed');
      expect(code(base({ runId: null, outstanding: true }))).toBe('urgent-wrong-run');
      expect(code(base({ recipientWorksOn: 'unmeasured', outstanding: true }))).toBe('urgent-unmeasured');
    },
  };
}

const URGENT_SENDER_SET: MutantSet<UrgentMailModule> = {
  modulePath: path.join(ROOT, 'server/src/coord/urgentMail.ts'),
  mutants: [
    { id: 'U1', old: 'if (names(f.recipientWorksOn) && names(f.senderClaims))', new: 'if (names(f.recipientWorksOn))' },
    { id: 'U2', old: 'if (names(f.recipientWorksOn) && names(f.senderClaims))', new: 'if (names(f.senderClaims))' },
    { id: 'U3', old: "return { kind: 'allowed', role: 'coordinator' };", new: "return { kind: 'allowed', role: 'overlord' };" },
    { id: 'U4', old: "d.kind === 'designated' && d.sessionId === f.senderId", new: "d.kind === 'designated'" },
    { id: 'U5', old: 'if (asOverlord && names(f.recipientClaims))', new: 'if (asOverlord)' },
    { id: 'U6', old: "    return refused('urgent-unmeasured', `the runs ${f.recipientId} works on, or the runs ${f.senderId} claims, could not be read`);",
      new: "    return refused('urgent-not-allowed', `the runs ${f.recipientId} works on, or the runs ${f.senderId} claims, could not be read`);" },
    { id: 'U7', old: "return refused('urgent-unmeasured', 'the Overlord designation could not be read');",
      new: "return refused('urgent-not-allowed', 'the Overlord designation could not be read');" },
    { id: 'U8', old: "if (asOverlord && recipientClaims === 'unmeasured') {", new: "if (recipientClaims === 'unmeasured') {" },
    { id: 'U9', old: 'if (f.senderId === f.recipientId) {', new: 'if (false) {' },
    { id: 'U10', old: "if (worksOn === 'unmeasured' || claims === 'unmeasured') {", new: 'if (false) {' },
    { id: 'U11', old: "if (d.kind === 'unmeasured') {", new: 'if (false) {' },
    { id: 'U12', old: "if (v.kind === 'allowed' && f.outstanding) {", new: 'if (false) {' },
    { id: 'U13', old: "if (v.kind === 'allowed' && f.outstanding) {", new: 'if (f.outstanding) {' },
    { id: 'U14', old: "if (v.kind === 'allowed' && f.outstanding) {", new: "if (v.kind === 'allowed') {" },
    { id: 'U15', old: 'f.runId !== null && ids.includes(f.runId)', new: 'ids.length > 0' },
    { id: 'U16', old: "return refused('urgent-wrong-run',", new: "return refused('urgent-not-allowed'," },
    { id: 'U17', old: 'if (runs.length > 0) {', new: 'if (false) {' },
    { id: 'U18', old: 'const runs = asOverlord && recipientClaims !== \'unmeasured\' ? [...shared, ...recipientClaims] : shared;',
      new: 'const runs = shared;' },
    { id: 'U19', old: 'const shared = worksOn.filter((id) => claims.includes(id));', new: 'const shared = worksOn;' },
  ],
  suite: urgentSenderVerdictCases,
};

/** This piece's sets, keyed as `mutation-floors.json` keys them (`<file>#<decider>`). */
export const URGENT_MAIL_MUTANT_SETS: Record<string, MutantSet<never>> = {
  'server/src/coord/urgentMail.ts#urgentSenderVerdict': URGENT_SENDER_SET as MutantSet<never>,
};
