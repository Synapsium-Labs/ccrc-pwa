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
const OTHER_COORD = 'lane-b-coordinator';
const WORKER = 'lane-a-worker';
const OVERLORD = 'lane-a-overlord';

/** A worker of one open run `COORD` claims, sent mail by `COORD`, with nobody designated. Each case overrides a field. */
const base = (over: Partial<UrgentFacts> = {}): UrgentFacts => ({
  senderId: COORD, recipientId: WORKER, recipientClaimants: [COORD], recipientClaimsOpenRun: false,
  designation: { kind: 'not-designated' }, ...over,
});

export function urgentSenderVerdictCases(m: UrgentMailModule): Record<string, SuiteCase> {
  const allowed = (f: UrgentFacts, role: 'coordinator' | 'overlord') =>
    expect(m.urgentSenderVerdict(f)).toEqual({ kind: 'allowed', role });
  const code = (f: UrgentFacts) => {
    const v = m.urgentSenderVerdict(f);
    return v.kind === 'refused' ? v.code : `allowed:${v.role}`;
  };
  return {
    'a coordinator to the worker (or reviewer) of a run it claims: allowed, as coordinator': () => {
      allowed(base(), 'coordinator');
      allowed(base({ recipientClaimants: [OTHER_COORD, COORD] }), 'coordinator');
    },
    "a coordinator to another coordinator's worker, a peer, or a session with no binding: not allowed": () => {
      expect(code(base({ recipientClaimants: [OTHER_COORD] }))).toBe('urgent-not-allowed');
      expect(code(base({ recipientClaimants: [] }))).toBe('urgent-not-allowed');
    },
    'a terminal run is no binding: the binding answers only open runs, so its worker reads no claimant': () => {
      expect(code(base({ recipientClaimants: [] }))).toBe('urgent-not-allowed');
    },
    'the designated Overlord to a session that claims a non-terminal run: allowed, as overlord': () => {
      allowed(base({ senderId: OVERLORD, recipientId: COORD, recipientClaimants: [],
        recipientClaimsOpenRun: true, designation: { kind: 'designated', sessionId: OVERLORD } }), 'overlord');
    },
    'the Overlord to a session that claims nothing: not allowed': () => {
      expect(code(base({ senderId: OVERLORD, recipientClaimants: [], recipientClaimsOpenRun: false,
        designation: { kind: 'designated', sessionId: OVERLORD } }))).toBe('urgent-not-allowed');
    },
    'a session that is not the designated one, writing to a coordinator: not allowed': () => {
      expect(code(base({ senderId: OVERLORD, recipientId: COORD, recipientClaimants: [], recipientClaimsOpenRun: true,
        designation: { kind: 'designated', sessionId: 'lane-c-overlord' } }))).toBe('urgent-not-allowed');
      expect(code(base({ senderId: OVERLORD, recipientId: COORD, recipientClaimants: [], recipientClaimsOpenRun: true,
        designation: { kind: 'not-designated' } }))).toBe('urgent-not-allowed');
    },
    'an unreadable fact is urgent-unmeasured, never urgent-not-allowed': () => {
      expect(code(base({ recipientClaimants: 'unmeasured' }))).toBe('urgent-unmeasured');
      expect(code(base({ recipientClaimants: [], designation: { kind: 'unmeasured' } }))).toBe('urgent-unmeasured');
      expect(code(base({ senderId: OVERLORD, recipientId: COORD, recipientClaimants: [],
        recipientClaimsOpenRun: 'unmeasured', designation: { kind: 'designated', sessionId: OVERLORD } })))
        .toBe('urgent-unmeasured');
    },
    'a fact that cannot change the answer does not make it unmeasured': () => {
      allowed(base({ designation: { kind: 'unmeasured' }, recipientClaimsOpenRun: 'unmeasured' }), 'coordinator');
      allowed(base({ senderId: OVERLORD, recipientId: COORD, recipientClaimants: 'unmeasured',
        recipientClaimsOpenRun: true, designation: { kind: 'designated', sessionId: OVERLORD } }), 'overlord');
      expect(code(base({ recipientClaimants: [], recipientClaimsOpenRun: 'unmeasured' }))).toBe('urgent-not-allowed');
    },
    'a sender that qualifies both ways is stored as coordinator when it claims the recipient run': () => {
      allowed(base({ senderId: OVERLORD, recipientId: COORD, recipientClaimants: [OVERLORD],
        recipientClaimsOpenRun: true, designation: { kind: 'designated', sessionId: OVERLORD } }), 'coordinator');
    },
    'a session never marks its own mail urgent': () => {
      expect(code(base({ senderId: COORD, recipientId: COORD, recipientClaimants: [COORD], recipientClaimsOpenRun: true,
        designation: { kind: 'designated', sessionId: COORD } }))).toBe('urgent-not-allowed');
    },
  };
}

const URGENT_SENDER_SET: MutantSet<UrgentMailModule> = {
  modulePath: path.join(ROOT, 'server/src/coord/urgentMail.ts'),
  mutants: [
    { id: 'U1', old: "claimants !== 'unmeasured' && claimants.includes(f.senderId)", new: "claimants !== 'unmeasured'" },
    { id: 'U2', old: "return { kind: 'allowed', role: 'coordinator' };", new: "return { kind: 'allowed', role: 'overlord' };" },
    { id: 'U3', old: "d.kind === 'designated' && d.sessionId === f.senderId", new: "d.kind === 'designated'" },
    { id: 'U4', old: "asOverlord && f.recipientClaimsOpenRun === true", new: 'asOverlord' },
    { id: 'U5', old: "return refused('urgent-unmeasured', `the runs ${f.recipientId} works on could not be read`);",
      new: "return refused('urgent-not-allowed', `the runs ${f.recipientId} works on could not be read`);" },
    { id: 'U6', old: "return refused('urgent-unmeasured', 'the Overlord designation could not be read');",
      new: "return refused('urgent-not-allowed', 'the Overlord designation could not be read');" },
    { id: 'U7', old: "if (asOverlord && f.recipientClaimsOpenRun === 'unmeasured') {", new: "if (f.recipientClaimsOpenRun === 'unmeasured') {" },
    { id: 'U8', old: 'if (f.senderId === f.recipientId) {', new: 'if (false) {' },
    { id: 'U9', old: "if (claimants === 'unmeasured') {", new: 'if (false) {' },
    { id: 'U10', old: "if (d.kind === 'unmeasured') {", new: 'if (false) {' },
  ],
  suite: urgentSenderVerdictCases,
};

/** This piece's sets, keyed as `mutation-floors.json` keys them (`<file>#<decider>`). */
export const URGENT_MAIL_MUTANT_SETS: Record<string, MutantSet<never>> = {
  'server/src/coord/urgentMail.ts#urgentSenderVerdict': URGENT_SENDER_SET as MutantSet<never>,
};
