// The fixed-line mail table's deciders: their cases and mutant sets (Overlord W1, inbox piece, question 8). As in
// `overlordInboxSets.ts`, each function's cases are written ONCE here, as suite cases over the module:
// `fixed-line-mail.test.ts` runs them against the real `coord/envelope.ts`, and `mutation-floors.test.ts` against each
// textual mutant.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect } from 'vitest';
import { operatorMessageSubject } from '../../../shared/operatorMessages.js';
import { INBOX_WAKE_SUBJECT } from '../../../shared/overlordInbox.js';
import { providerRetrySubject } from '../../../shared/provider-retry.js';
import { SPOT_PROBE_SUBJECT } from '../../src/continuity/renewalFeed.js';
import type { DesignationFact } from '../../src/roleOf.js';
import type { MutantSet, SuiteCase } from './mutate.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const L1 = path.join(ROOT, 'server/src/coord/envelope.ts');

export type EnvelopeModule = typeof import('../../src/coord/envelope.js');
/** The gate's module: the card hold lives beside step 8, the one home of its words. */
type GateModule = typeof import('../../src/coord/overlordGate.js');
const GATE_TS = path.join(ROOT, 'server/src/coord/overlordGate.ts');

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

    'the timer row (Overlord W1): a mail from timer whose MAIL ROW is to overlord, delivered to the designated session; never a session-keyed timer mail': () => {
      const role = (deliveredTo: string, mailToId: string) => ({ fromId: 'timer', subject: 'timer: 2 due (4, 5)', toId: deliveredTo, mailToId });
      expect(m.fixedLineMailOf(role(OVERLORD, 'overlord'), designated)).toMatchObject({ name: 'timer', firstDelivery: 'none', hold: 'card', designatedOnly: true });
      expect(m.fixedLineMailOf(role(OVERLORD, OVERLORD), designated), 'a session-keyed timer mail to the designated session').toBe('generic');
      expect(m.fixedLineMailOf(role(OTHER, 'overlord'), designated), 'delivered to another session').toBe('generic');
      expect(m.fixedLineMailOf(role(OTHER, OTHER), designated)).toBe('generic');
      expect(m.fixedLineMailOf({ ...role(OVERLORD, 'overlord'), fromId: 'operator' }, designated), 'another sender').toBe('generic');
      expect(m.fixedLineMailOf({ fromId: 'timer', subject: 'timer: 1 due (4)', toId: OVERLORD }, designated), 'no mail row recipient').toBe('generic');
    },

    'the report row (W2, request ids A): a session\'s mail whose MAIL ROW is to overlord, held until acked and record-only, to whatever session it is delivered': () => {
      const report = (deliveredTo: string, mailToId: string, fromId = 'coord-a') => ({ fromId, subject: 'progress on 7', toId: deliveredTo, mailToId });
      for (const d of [designated, { kind: 'not-designated' } as const, { kind: 'designated', sessionId: OTHER } as const]) {
        expect(m.fixedLineMailOf(report(OVERLORD, 'overlord'), d), 'delivered to the bound session, or a body retired since').toMatchObject({ name: 'overlord-report', hold: 'acked', push: 'record-only', designatedOnly: false });
        expect(m.fixedLineMailOf(report('overlord', 'overlord'), d), 'delivered to the role, no body bound').toMatchObject({ name: 'overlord-report' });
      }
      expect(m.fixedLineMailOf(report(OVERLORD, OVERLORD), designated), 'raw session-id mail to the bound body (RI19)').toBe('generic');
      expect(m.fixedLineMailOf(report(OTHER, OTHER), designated), 'a peer mail').toBe('generic');
      for (const role of ['timer', 'operator', 'coordinator']) {
        expect(m.FIXED_LINE_MAIL.filter((r) => r.matches({ fromId: role, subject: 'x', mailToId: 'overlord' })).map((r) => r.name), role).not.toContain('overlord-report');
      }
      const origin = { fromId: 'coord-a', subject: 'progress on 7', toId: 'overlord' };
      expect(m.heldUntilAcked(OVERLORD, origin, designated)).toBe(true);
      expect(m.heldUntilAcked(OTHER, origin, { kind: 'unmeasured' })).toBe(true);
      expect(m.heldUntilAcked(OVERLORD, { ...origin, fromId: 'timer', subject: 'timer: 1 due (4)' }, designated), 'the timer line holds for the card, not here').toBe(false);
      expect(m.heldUntilAcked(OVERLORD, { ...origin, toId: OVERLORD }, designated)).toBe(false);
      expect(m.heldUntilAcked(OVERLORD, null, designated)).toBe(false);
      // the stall watch's read of the same hold: delivery ids, each found by its mail id; a delivery whose mail is not read holds nothing
      const heldMail = [{ id: 10, ...origin }, { id: 11, fromId: 'coord-a', subject: 'peer news', toId: OTHER }];
      const heldDeliveries = [{ id: 100, mailId: 11, toId: OTHER }, { id: 101, mailId: 10, toId: OVERLORD }, { id: 102, mailId: 99, toId: OVERLORD }];
      expect([...m.heldDeliveryIdsOf(heldMail, heldDeliveries)]).toEqual([101]);
      expect([...m.heldDeliveryIdsOf([], heldDeliveries)]).toEqual([]);
      // the mail sweep's due list less the held: a held report is left out, every other row passes in its order, a row whose mail
      // is not found is kept (no report), an empty list is empty, and the rows are the caller's own objects
      const origins = { mailOrigin: (mailId: number) => heldMail.find((x) => x.id === mailId) ?? null };
      const due = [{ id: 103, mailId: 99, toId: OVERLORD, extra: 'c' }, { id: 101, mailId: 10, toId: OVERLORD, extra: 'a' },
        { id: 100, mailId: 11, toId: OTHER, extra: 'b' }];
      const kept = m.notHeldUntilAcked(due, origins);
      expect(kept.map((d) => d.id)).toEqual([103, 100]);
      expect(kept[0]).toBe(due[0]);
      expect(m.notHeldUntilAcked([], origins)).toEqual([]);
      expect(m.notHeldUntilAcked(due.filter((d) => d.id !== 101), origins).map((d) => d.id)).toEqual([103, 100]);
      expect(m.fixedLinePushOf({ fromId: 'coord-a', subject: 'x', mailToId: 'overlord' })).toBe('record-only');
      for (const x of [{ fromId: 'timer', subject: 'timer: 1 due (4)', mailToId: 'overlord' }, { fromId: 'coord-a', subject: 'x', mailToId: OTHER },
        { fromId: 'operator', subject: operatorMessageSubject(1), mailToId: OVERLORD }]) expect(m.fixedLinePushOf(x)).toBeUndefined();
      expect(m.renderReportHeldLine().startsWith('ccrc-mail: you have new mail. ')).toBe(true);
    },

    'answers generic for every other mail': () => {
      expect(m.fixedLineMailOf(mailTo(OVERLORD, 'operator', 'handover'), designated)).toBe('generic');
      expect(m.fixedLineMailOf(mailTo(OVERLORD, OTHER, 'hi'), designated)).toBe('generic');
      expect(m.fixedLineMailOf(mailTo(OVERLORD, 'operator', 'operator-message:not-a-number'), designated)).toBe('generic');
    },

    'answers generic for every designatedOnly row under an unmeasured designation, and keeps the operator message\'s row': () => {
      const only = m.FIXED_LINE_MAIL.filter((r) => r.designatedOnly);
      expect(only.map((r) => r.name).sort()).toEqual(['inbox-wake', 'spot-probe', 'timer']);
      expect(m.fixedLineMailOf({ ...mailTo(OVERLORD, 'timer', 'timer: 1 due (4)'), mailToId: 'overlord' }, { kind: 'unmeasured' })).toBe('generic');
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
      expect(m.FIXED_LINE_MAIL.map((r) => r.name)).toEqual(['operator-message', 'spot-probe', 'inbox-wake', 'provider-retry', 'timer', 'overlord-report']);
      expect(m.FIXED_LINE_MAIL.filter((r) => r.matches({ fromId: 'timer', subject: 'timer: 1 due (4)', mailToId: 'overlord' })).map((r) => r.name)).toStrictEqual(['timer']);
      // Only the timer row waits for the card (C62): the other rows each name a door that itself refuses card-unread. Only the
      // report row holds until acked and says record-only (request ids A); every other row reads both as absent, today's.
      expect(m.FIXED_LINE_MAIL.filter((r) => r.hold === 'card').map((r) => r.name)).toStrictEqual(['timer']);
      expect(m.FIXED_LINE_MAIL.filter((r) => r.hold === 'acked').map((r) => r.name)).toStrictEqual(['overlord-report']);
      expect(m.FIXED_LINE_MAIL.filter((r) => r.push !== undefined).map((r) => [r.name, r.push])).toStrictEqual([['overlord-report', 'record-only']]);
      expect(m.FIXED_LINE_MAIL.filter((r) => r.hold !== undefined).map((r) => r.name)).toStrictEqual(['timer', 'overlord-report']);
      for (const x of [{ fromId: 'operator', subject: providerRetrySubject(1_800_000_000_000) }, { fromId: 'operator', subject: operatorMessageSubject(1) }, { fromId: 'operator', subject: SPOT_PROBE_SUBJECT }, { fromId: 'operator', subject: INBOX_WAKE_SUBJECT }]) {
        expect(m.FIXED_LINE_MAIL.filter((r) => r.matches(x))).toHaveLength(1);
      }
    },

    'the provider-retry row and the timer row never take each other\'s mail, whichever recipient the mail row names': () => {
      const names = (x: { fromId: string; subject: string; mailToId?: string }) => m.FIXED_LINE_MAIL.filter((r) => r.matches(x)).map((r) => r.name);
      const retry = providerRetrySubject(1_800_000_000_000);
      // A provider-retry mail is the operator sender's: even addressed to the role, it is the provider-retry row's alone.
      expect(names({ fromId: 'operator', subject: retry, mailToId: 'overlord' })).toStrictEqual(['provider-retry']);
      // The timer sender's mail to the role is the timer row's alone, even under a provider-retry subject.
      expect(names({ fromId: 'timer', subject: retry, mailToId: 'overlord' })).toStrictEqual(['timer']);
      // And the timer sender's mail to a session, with that subject, is neither's: the generic nudge.
      expect(names({ fromId: 'timer', subject: retry, mailToId: OVERLORD })).toStrictEqual([]);
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
    // Overlord W1, the Overlord's timers (question 3): the timer row.
    { id: 'F20 the timer row matched on the sender alone', old: "m.fromId === TIMER_MAIL_SENDER && m.mailToId === OVERLORD_IDENTITY", new: 'm.fromId === TIMER_MAIL_SENDER' },
    { id: 'F21 the timer row open to every session', old: "m.mailToId === OVERLORD_IDENTITY, designatedOnly: true,", new: 'm.mailToId === OVERLORD_IDENTITY, designatedOnly: false,' },
    { id: 'F22 the timer row types before the card', old: "firstDelivery: 'none', hold: 'card',", new: "firstDelivery: 'none'," },
    // Overlord W2, request ids A: the report row.
    { id: 'F25 the report row types its line', old: "firstDelivery: 'none', hold: 'acked',", new: "firstDelivery: 'none'," },
    { id: 'F26 the report row pushes', old: "hold: 'acked', push: 'record-only',", new: "hold: 'acked'," },
    { id: 'F27 the report row only for the designated session', old: "!MAIL_ROLE_IDS.has(m.fromId), designatedOnly: false,", new: "!MAIL_ROLE_IDS.has(m.fromId), designatedOnly: true," },
    { id: 'F28 the report row takes a role sender', old: "m.mailToId === OVERLORD_IDENTITY && !MAIL_ROLE_IDS.has(m.fromId)", new: 'm.mailToId === OVERLORD_IDENTITY' },
    { id: 'F29 the report row matched on the delivery', old: "m.mailToId === OVERLORD_IDENTITY && !MAIL_ROLE_IDS.has(m.fromId)", new: '!MAIL_ROLE_IDS.has(m.fromId)' },
    { id: 'F30 the report row holds until the card', old: "hold: 'acked', push:", new: "hold: 'card', push:" },
    { id: 'F31 the sweep holds nothing', old: "return row !== 'generic' && row.hold === 'acked';", new: 'return false;' },
    { id: 'F32 the sweep holds the card row too', old: "return row !== 'generic' && row.hold === 'acked';", new: "return row !== 'generic' && row.hold !== undefined;" },
    { id: 'F33 the sweep holds every fixed line', old: "return row !== 'generic' && row.hold === 'acked';", new: "return row !== 'generic';" },
    { id: 'F34 no mail held as the report', old: '  if (origin === null) return false;\n', new: '  if (origin === null) return true;\n' },
    { id: 'F35 the hold read off the delivery', old: "subject: origin.subject, toId, mailToId: origin.toId }", new: 'subject: origin.subject, toId, mailToId: toId }' },
    { id: 'F36 no push word', old: 'return FIXED_LINE_MAIL.find((r) => r.matches(m))?.push;', new: 'return undefined;' },
    { id: 'F37 the stall read holds every delivery', old: ".filter((d) => heldUntilAcked(d.toId, mail.find((m) => m.id === d.mailId) ?? null, { kind: 'not-designated' }))", new: '.filter(() => true)' },
    { id: 'F38 the stall read finds the mail by the delivery id', old: 'mail.find((m) => m.id === d.mailId) ?? null', new: 'mail.find((m) => m.id === d.id) ?? null' },
    { id: 'F39 the stall read holds a delivery whose mail is unread', old: 'mail.find((m) => m.id === d.mailId) ?? null', new: 'mail.find((m) => m.id === d.mailId) ?? mail[0] ?? null' },
    { id: 'F40 the stall read names the mail id', old: '    .map((d) => d.id));', new: '    .map((d) => d.mailId));' },
    { id: 'F41 the sweep filter keeps the held', old: "return due.filter((d) => !heldUntilAcked(d.toId, origins.mailOrigin(d.mailId), { kind: 'not-designated' }));", new: 'return [...due];' },
    { id: 'F42 the sweep filter keeps only the held', old: "return due.filter((d) => !heldUntilAcked(d.toId, origins.mailOrigin(d.mailId),", new: "return due.filter((d) => heldUntilAcked(d.toId, origins.mailOrigin(d.mailId)," },
    { id: 'F43 the sweep filter reads the delivery id as the mail id', old: 'origins.mailOrigin(d.mailId), { kind', new: 'origins.mailOrigin((d as unknown as { id: number }).id), { kind' },
    { id: 'F44 the sweep filter drops a row whose mail is not found', old: "return due.filter((d) => !heldUntilAcked(d.toId, origins.mailOrigin(d.mailId), { kind: 'not-designated' }));", new: "return due.filter((d) => origins.mailOrigin(d.mailId) !== null && !heldUntilAcked(d.toId, origins.mailOrigin(d.mailId), { kind: 'not-designated' }));" },
    { id: 'F45 the sweep filter reorders', old: "return due.filter((d) => !heldUntilAcked(", new: "return [...due].reverse().filter((d) => !heldUntilAcked(" },
    { id: 'F24 the timer row never matched', old: "m.fromId === TIMER_MAIL_SENDER && m.mailToId === OVERLORD_IDENTITY", new: 'false' },
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

// ---------------------------------------------------------------------------------------------------- fixedLineReplayOf

export function fixedLineReplayOfCases(m: EnvelopeModule): Record<string, SuiteCase> {
  const nudge = (toId: string, fromId: string, subject: string) => m.mailNudgeOf(toId, { fromId, subject, body: '' }, designated, 0);
  const spot = nudge(OVERLORD, 'operator', SPOT_PROBE_SUBJECT);
  const generic = nudge(OVERLORD, OTHER, 'status');
  const message = nudge(OVERLORD, 'operator', operatorMessageSubject(7));
  return {
    'a fixed line delivered once and not acked is ack-only (review 3389 F1)': () => {
      expect(m.fixedLineReplayOf(spot, 1)).toBe('ack-only');
      expect(m.fixedLineReplayOf({ firstDelivery: 'none' }, 0)).toBe('ack-only');
    },
    'a first delivery is typed': () => {
      expect(m.fixedLineReplayOf(spot, null)).toBe('type');
    },
    'a generic nudge and an operator message are typed, replayed or not': () => {
      for (const n of [generic, message]) {
        expect(m.fixedLineReplayOf(n, 1)).toBe('type');
        expect(m.fixedLineReplayOf(n, null)).toBe('type');
      }
    },
  };
}

const FIXED_LINE_REPLAY_OF_SET: MutantSet<EnvelopeModule> = {
  modulePath: L1,
  mutants: [
    { id: 'R1 every replay typed', old: "nudge.firstDelivery === 'none' && deliveredAt !== null ? 'ack-only' : 'type'", new: "'type'" },
    { id: 'R2 every delivery ack-only', old: "nudge.firstDelivery === 'none' && deliveredAt !== null ? 'ack-only' : 'type'", new: "'ack-only'" },
    { id: 'R3 a first delivery ack-only', old: "nudge.firstDelivery === 'none' && deliveredAt !== null ?", new: "nudge.firstDelivery === 'none' ?" },
    { id: 'R4 any replay ack-only', old: "nudge.firstDelivery === 'none' && deliveredAt !== null ?", new: 'deliveredAt !== null ?' },
    { id: 'R5 the delivery test inverted', old: 'deliveredAt !== null ?', new: 'deliveredAt === null ?' },
    { id: 'R6 a delivery at time zero read as never delivered', old: 'deliveredAt !== null ?', new: 'deliveredAt ?' },
  ],
  suite: fixedLineReplayOfCases,
};

// ------------------------------------------------------------------------- the timer line and its hold (Overlord W1)

export function timerLineCases(m: EnvelopeModule): Record<string, SuiteCase> {
  const nudge = (subject: string) => m.mailNudgeOf(OVERLORD, { fromId: 'timer', subject, body: 'the notes', toId: 'overlord' }, designated, 0);
  return {
    'the line counts the timers from the subject, names the list door, and never ccrc-api or a note': () => {
      expect(m.renderTimerFiredLine('timer: 3 due (4, 5, 6)')).toBe('ccrc-mail: you have new mail. 3 of your timers came due: read them with your timer list door.');
      expect(m.renderTimerFiredLine('timer: 12 due (1, 2, …)')).toContain('12 of your timers came due');
      expect(m.renderTimerFiredLine('something else')).toBe('ccrc-mail: you have new mail. Your timers came due: read them with your timer list door.');
      expect(m.renderTimerFiredLine('timer: 0 due ()')).not.toContain('0 of');
      for (const subject of ['timer: 3 due (4, 5, 6)', 'x']) expect(m.renderTimerFiredLine(subject)).not.toContain('ccrc-api');
      expect(nudge('timer: 1 due (4)').line).not.toContain('the notes');
    },
    'the role\'s timer mail types its own line, acked on first delivery, waiting for the card; a session-keyed one keeps the generic nudge': () => {
      expect(nudge('timer: 1 due (4)')).toStrictEqual({ line: m.renderTimerFiredLine('timer: 1 due (4)'), operatorMessageId: null, firstDelivery: 'none', hold: 'card' });
      const keyed = m.mailNudgeOf(OVERLORD, { fromId: 'timer', subject: 'timer: 1 due (4)', body: '', toId: OVERLORD }, designated, 0);
      expect(keyed).toStrictEqual({ line: m.renderMailNudge(OVERLORD), operatorMessageId: null });
      expect(m.mailNudgeOf(OVERLORD, { fromId: 'operator', subject: SPOT_PROBE_SUBJECT, body: '' }, designated, 0).hold).toBeUndefined();
    },
  };
}

export function cardHoldVerdictCases(m: Pick<GateModule, 'cardHoldVerdict'>): Record<string, SuiteCase> {
  return {
    'delivers only on read-current; none and read-stale hold card-unread; unmeasured holds unmeasured': () => {
      expect(m.cardHoldVerdict('read-current')).toStrictEqual({ deliver: true });
      expect(m.cardHoldVerdict('read-stale')).toStrictEqual({ deliver: false, why: 'card-unread' });
      expect(m.cardHoldVerdict('none')).toStrictEqual({ deliver: false, why: 'card-unread' });
      expect(m.cardHoldVerdict({ kind: 'unmeasured', why: 'x' })).toStrictEqual({ deliver: false, why: 'unmeasured' });
    },
  };
}

const TIMER_LINE_SET: MutantSet<EnvelopeModule> = {
  modulePath: L1,
  mutants: [
    { id: 'T1 no count', old: "${n === undefined ? 'Your timers' : `${n} of your timers`}", new: 'Your timers' },
    { id: 'T2 a zero counted', old: '/^timer: ([1-9][0-9]*) due/', new: '/^timer: ([0-9]+) due/' },
    { id: 'T3 the generic head lost', old: "return `${INJECTED_PROMPTS['mail-nudge'].text} ${n === undefined", new: "return `${n === undefined" },
    { id: 'T4 the hold not carried', old: "...(row.hold === undefined ? {} : { hold: row.hold })", new: '' },
    { id: 'T5 the timer row matched on the delivery', old: "mailToId: origin.toId, toId }", new: 'mailToId: toId, toId }' },
  ],
  suite: timerLineCases,
};

const CARD_HOLD_SET: MutantSet<GateModule> = {
  modulePath: GATE_TS,
  mutants: [
    { id: 'C1 a stale card delivers', old: "if (card === 'read-current') return { deliver: true };", new: "if (card !== 'none' && typeof card !== 'object') return { deliver: true };" },
    { id: 'C2 unmeasured read as unread', old: "why: typeof card === 'object' ? 'unmeasured' : 'card-unread'", new: "why: 'card-unread'" },
    { id: 'C3 every card delivers', old: "if (card === 'read-current') return { deliver: true };", new: 'return { deliver: true };' },
  ],
  suite: cardHoldVerdictCases,
};

/** This piece's sets, keyed as `mutation-floors.json` keys them (`<file>#<decider>`). */
export const FIXED_LINE_MAIL_MUTANT_SETS: Record<string, MutantSet<never>> = {
  'server/src/coord/envelope.ts#fixedLineMailOf': FIXED_LINE_MAIL_OF_SET as MutantSet<never>,
  'server/src/coord/envelope.ts#sweepDesignationOf': SWEEP_DESIGNATION_OF_SET as MutantSet<never>,
  'server/src/coord/envelope.ts#fixedLineReplayOf': FIXED_LINE_REPLAY_OF_SET as MutantSet<never>,
  'server/src/coord/envelope.ts#renderTimerFiredLine': TIMER_LINE_SET as MutantSet<never>,
  'server/src/coord/overlordGate.ts#cardHoldVerdict': CARD_HOLD_SET as MutantSet<never>,
};
