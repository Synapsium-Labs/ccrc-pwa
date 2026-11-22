// The fixed-line mail table's deciders: their cases and mutant sets (Overlord W1, inbox piece, question 8). As in
// `overlordInboxSets.ts`, each function's cases are written ONCE here, as suite cases over the module:
// `fixed-line-mail.test.ts` runs them against the real `coord/envelope.ts`, and `mutation-floors.test.ts` against each
// textual mutant.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect } from 'vitest';
import { operatorMessageSubject } from '../../../shared/operatorMessages.js';
import { INBOX_WAKE_SUBJECT } from '../../../shared/overlordInbox.js';
import { SPOT_PROBE_SUBJECT } from '../../src/continuity/renewalFeed.js';
import type { DesignationFact } from '../../src/roleOf.js';
import type { MutantSet, SuiteCase } from './mutate.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const L1 = path.join(ROOT, 'server/src/coord/envelope.ts');

export type EnvelopeModule = typeof import('../../src/coord/envelope.js');

const OVERLORD = 'lane-a-project-a';
const OTHER = 'lane-b-project-a';
const designated = { kind: 'designated', sessionId: OVERLORD } as const;
const mailTo = (toId: string, fromId: string, subject: string) => ({ fromId, subject, toId });

// ------------------------------------------------------------------------------------------------------ fixedLineMailOf

export function fixedLineMailOfCases(m: EnvelopeModule): Record<string, SuiteCase> {
  return {
    'answers each row for its mail to the designated session': () => {
      expect(m.fixedLineMailOf(mailTo(OVERLORD, 'operator', operatorMessageSubject(7)), designated)).toMatchObject({ name: 'operator-message', firstDelivery: 'message-delivered' });
      expect(m.fixedLineMailOf(mailTo(OVERLORD, 'operator', SPOT_PROBE_SUBJECT), designated)).toMatchObject({ name: 'spot-probe', firstDelivery: 'none' });
      expect(m.fixedLineMailOf(mailTo(OVERLORD, 'operator', INBOX_WAKE_SUBJECT), designated)).toMatchObject({ name: 'inbox-wake', firstDelivery: 'none' });
    },

    'answers generic for the spot-probe notice and the wake to any other session, and for either subject from another sender': () => {
      for (const subject of [SPOT_PROBE_SUBJECT, INBOX_WAKE_SUBJECT]) {
        expect(m.fixedLineMailOf(mailTo(OTHER, 'operator', subject), designated)).toBe('generic');
        expect(m.fixedLineMailOf(mailTo(OVERLORD, OTHER, subject), designated)).toBe('generic');
        expect(m.fixedLineMailOf(mailTo(OTHER, 'operator', subject), { kind: 'not-designated' })).toBe('generic');
      }
    },

    'answers generic for every other mail': () => {
      expect(m.fixedLineMailOf(mailTo(OVERLORD, 'operator', 'handover'), designated)).toBe('generic');
      expect(m.fixedLineMailOf(mailTo(OVERLORD, OTHER, 'hi'), designated)).toBe('generic');
      expect(m.fixedLineMailOf(mailTo(OVERLORD, 'operator', 'operator-message:not-a-number'), designated)).toBe('generic');
    },

    'answers generic for every designatedOnly row under an unmeasured designation, and keeps the operator message\'s row': () => {
      const only = m.FIXED_LINE_MAIL.filter((r) => r.designatedOnly);
      expect(only.map((r) => r.name).sort()).toEqual(['inbox-wake', 'spot-probe']);
      for (const subject of [SPOT_PROBE_SUBJECT, INBOX_WAKE_SUBJECT]) {
        expect(m.fixedLineMailOf(mailTo(OVERLORD, 'operator', subject), { kind: 'unmeasured' })).toBe('generic');
      }
      expect(m.fixedLineMailOf(mailTo(OVERLORD, 'operator', operatorMessageSubject(7)), { kind: 'unmeasured' })).toMatchObject({ name: 'operator-message' });
    },

    'the operator message\'s row answers whoever the designation names, never a session\'s own check': () => {
      const subject = operatorMessageSubject(7);
      expect(m.fixedLineMailOf(mailTo(OVERLORD, 'operator', subject), { kind: 'not-designated' })).toMatchObject({ name: 'operator-message' });
      expect(m.fixedLineMailOf(mailTo(OTHER, 'operator', subject), designated)).toMatchObject({ name: 'operator-message' });
    },

    'a designatedOnly row answers only for the very session the designation names, from the mail\'s recipient and not its sender': () => {
      const other = { kind: 'designated', sessionId: OTHER } as const;
      for (const subject of [SPOT_PROBE_SUBJECT, INBOX_WAKE_SUBJECT]) {
        expect(m.fixedLineMailOf(mailTo(OVERLORD, 'operator', subject), other), 'designated is another session').toBe('generic');
        expect(m.fixedLineMailOf(mailTo(OTHER, 'operator', subject), other), 'designated is the recipient').toMatchObject({ name: expect.any(String) });
        // the sender is the designated session, the recipient is not
        expect(m.fixedLineMailOf(mailTo(OTHER, OVERLORD, subject), designated), 'the sender is designated').toBe('generic');
      }
    },

    'names each row once, and a row that matches a mail is the only one that does': () => {
      expect(m.FIXED_LINE_MAIL.map((r) => r.name)).toEqual(['operator-message', 'spot-probe', 'inbox-wake']);
      for (const x of [{ fromId: 'operator', subject: operatorMessageSubject(1) }, { fromId: 'operator', subject: SPOT_PROBE_SUBJECT }, { fromId: 'operator', subject: INBOX_WAKE_SUBJECT }]) {
        expect(m.FIXED_LINE_MAIL.filter((r) => r.matches(x))).toHaveLength(1);
      }
    },

    'the spot-probe row needs both the operator sender and its subject': () => {
      const spot = m.FIXED_LINE_MAIL.find((r) => r.name === 'spot-probe')!;
      expect(spot.matches({ fromId: 'operator', subject: SPOT_PROBE_SUBJECT })).toBe(true);
      expect(spot.matches({ fromId: OTHER, subject: SPOT_PROBE_SUBJECT })).toBe(false);
      expect(spot.matches({ fromId: 'operator', subject: 'handover' })).toBe(false);
    },

    'the wake row matches the wake subject from the operator and nothing else': () => {
      const wake = m.FIXED_LINE_MAIL.find((r) => r.name === 'inbox-wake')!;
      expect(wake.matches({ fromId: 'operator', subject: INBOX_WAKE_SUBJECT })).toBe(true);
      expect(wake.matches({ fromId: 'operator', subject: 'handover' })).toBe(false);
      expect(wake.matches({ fromId: OTHER, subject: INBOX_WAKE_SUBJECT })).toBe(false);
    },
  };
}

// --------------------------------------------------------------------------------------------------- sweepDesignationOf

export function sweepDesignationOfCases(m: EnvelopeModule): Record<string, SuiteCase> {
  const row = (over: Partial<Extract<DesignationFact, { kind: 'row' }>> = {}): DesignationFact =>
    ({ kind: 'row', live: null, pending: null, pendingKind: null, term: 1, ...over });
  return {
    'an unmeasured read is unmeasured, never not-designated and never designated': () => {
      expect(m.sweepDesignationOf('unmeasured')).toEqual({ kind: 'unmeasured' });
    },
    'no row is not designated': () => {
      expect(m.sweepDesignationOf({ kind: 'none' })).toEqual({ kind: 'not-designated' });
    },
    'a row with a live binding is designated, naming the live session': () => {
      expect(m.sweepDesignationOf(row({ live: OVERLORD }))).toEqual({ kind: 'designated', sessionId: OVERLORD });
      expect(m.sweepDesignationOf(row({ live: OVERLORD, pending: OTHER, pendingKind: 'designate', term: 4 }))).toEqual({ kind: 'designated', sessionId: OVERLORD });
    },
    'a row with no live binding is not designated, though a session is pending': () => {
      expect(m.sweepDesignationOf(row())).toEqual({ kind: 'not-designated' });
      expect(m.sweepDesignationOf(row({ pending: OTHER, pendingKind: 'designate' }))).toEqual({ kind: 'not-designated' });
      expect(m.sweepDesignationOf(row({ pending: OTHER, pendingKind: 'rebind', term: 3 }))).toEqual({ kind: 'not-designated' });
    },
  };
}

// ----------------------------------------------------------------------------------------------------------- the mutants

const FIXED_LINE_MAIL_OF_SET: MutantSet<EnvelopeModule> = {
  modulePath: L1,
  mutants: [
    { id: 'F1 no row answered generic', old: "if (row === undefined) return 'generic';", new: '' },
    { id: 'F2 the designatedOnly check dropped', old: 'if (row.designatedOnly && !(', new: 'if (false && !(' },
    { id: 'F3 every row held to the designation', old: 'if (row.designatedOnly && !(', new: 'if (!(' },
    { id: 'F4 the designation test negated', old: 'if (row.designatedOnly && !(', new: 'if (row.designatedOnly && (' },
    { id: 'F5 the wrong session compared', old: 'designated.sessionId === m.toId', new: 'designated.sessionId === m.fromId' },
    { id: 'F6 any recipient accepted', old: 'designated.sessionId === m.toId', new: 'true' },
    { id: 'F7 a designated session of any kind taken', old: "designated.kind === 'designated' && designated.sessionId === m.toId", new: "designated.kind !== 'not-designated' || designated.sessionId === m.toId" },
    { id: 'F8 a held row answered with the row', old: "m.toId)) return 'generic';", new: 'm.toId)) return row;' },
    { id: 'F9 a matched row answered generic', old: '  return row;\n}', new: "  return 'generic';\n}" },
    { id: 'F10 the operator message row held to the designation', old: 'matches: isOperatorMessageMail, designatedOnly: false', new: 'matches: isOperatorMessageMail, designatedOnly: true' },
    { id: 'F11 the spot-probe row open to every session', old: 'm.subject === SPOT_PROBE_SUBJECT, designatedOnly: true', new: 'm.subject === SPOT_PROBE_SUBJECT, designatedOnly: false' },
    { id: 'F12 the wake row open to every session', old: 'matches: isInboxWakeMail, designatedOnly: true', new: 'matches: isInboxWakeMail, designatedOnly: false' },
    { id: 'F13 the spot-probe notice matched from any sender', old: 'm.fromId === OPERATOR_MESSAGE_SENDER && m.subject === SPOT_PROBE_SUBJECT', new: 'm.subject === SPOT_PROBE_SUBJECT' },
    { id: 'F14 the spot-probe row matched on any operator mail', old: 'm.fromId === OPERATOR_MESSAGE_SENDER && m.subject === SPOT_PROBE_SUBJECT', new: 'm.fromId === OPERATOR_MESSAGE_SENDER' },
    { id: 'F15 the wake row never matched', old: 'matches: isInboxWakeMail,', new: 'matches: () => false,' },
    { id: 'F16 the operator message row never matched', old: 'matches: isOperatorMessageMail,', new: 'matches: () => false,' },
    { id: 'F17 the operator message first delivery lost', old: "designatedOnly: false, firstDelivery: 'message-delivered'", new: "designatedOnly: false, firstDelivery: 'none'" },
    { id: 'F18 the spot-probe first delivery moves a message', old: "designatedOnly: true, firstDelivery: 'none',\n    line: () => renderSpotProbeLine()", new: "designatedOnly: true, firstDelivery: 'message-delivered',\n    line: () => renderSpotProbeLine()" },
    { id: 'F19 the wake first delivery moves a message', old: "matches: isInboxWakeMail, designatedOnly: true, firstDelivery: 'none'", new: "matches: isInboxWakeMail, designatedOnly: true, firstDelivery: 'message-delivered'" },
  ],
  suite: fixedLineMailOfCases,
};

const SWEEP_DESIGNATION_OF_SET: MutantSet<EnvelopeModule> = {
  modulePath: L1,
  mutants: [
    { id: 'D1 an unmeasured designation read as none', old: "if (d === 'unmeasured') return { kind: 'unmeasured' };", new: "if (d === 'unmeasured') return { kind: 'not-designated' };" },
    { id: 'D2 an unmeasured designation read as designated', old: "if (d === 'unmeasured') return { kind: 'unmeasured' };", new: "if (d === 'unmeasured') return { kind: 'designated', sessionId: '' };" },
    { id: 'D3 an unmeasured designation unchecked', old: "  if (d === 'unmeasured') return { kind: 'unmeasured' };\n", new: '' },
    { id: 'D4 a null live binding read as designated', old: 'd.kind === \'row\' && d.live !== null ?', new: "d.kind === 'row' ?" },
    { id: 'D5 no row read as designated', old: 'd.kind === \'row\' && d.live !== null ?', new: 'd.live !== null ?' },
    { id: 'D6 the test inverted', old: 'd.kind === \'row\' && d.live !== null ?', new: "d.kind === 'row' && d.live === null ?" },
    { id: 'D7 a pending session read as designated', old: 'd.kind === \'row\' && d.live !== null ?', new: "d.kind === 'row' && (d.live !== null || d.pending !== null) ?" },
    { id: 'D8 the pending session named', old: "sessionId: d.live }", new: "sessionId: d.pending ?? d.live }" },
    { id: 'D9 the designated answer carries no session', old: "{ kind: 'designated', sessionId: d.live }", new: "{ kind: 'designated', sessionId: '' }" },
    { id: 'D10 the not-designated answer carries unmeasured', old: ": { kind: 'not-designated' };\n}", new: ": { kind: 'unmeasured' };\n}" },
  ],
  suite: sweepDesignationOfCases,
};

/** This piece's sets, keyed as `mutation-floors.json` keys them (`<file>#<decider>`). */
export const FIXED_LINE_MAIL_MUTANT_SETS: Record<string, MutantSet<never>> = {
  'server/src/coord/envelope.ts#fixedLineMailOf': FIXED_LINE_MAIL_OF_SET as MutantSet<never>,
  'server/src/coord/envelope.ts#sweepDesignationOf': SWEEP_DESIGNATION_OF_SET as MutantSet<never>,
};
