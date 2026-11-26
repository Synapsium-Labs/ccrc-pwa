// Overlord W1, the private store (plan w1-private-store.md, Tasks 2 and 3; the floors rule is D-8217's): the cases over the
// Operator Model's deciders, written once here as suite cases over a module. `operator-messages-moves.test.ts` and
// `privacy-journal.test.ts` run them against the real modules, and `mutation-floors.test.ts` runs them against each named
// mutant. The expected words are written out, never read from the code the cases judge.
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { expect } from 'vitest';
import type { MutantSet, SuiteCase } from './mutate.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const MESSAGES_TS = path.join(ROOT, 'server/src/operatorModel/messages.ts');
const PROMPT_BODY_TS = path.join(ROOT, 'server/src/operatorModel/promptBody.ts');

export type OperatorModelDeciders = typeof import('../../src/operatorModel/messages.js');
export type PrivacyJournalModule = typeof import('../../src/operatorModel/privacyJournal.js');
const PRIVACY_TS = path.join(ROOT, 'server/src/operatorModel/privacyJournal.ts');
export const COHERENCE_KEY = 'server/src/operatorModel/privacyJournal.ts#privacyCoherence';
export const PRIVACY_ENTRY_KEY = 'server/src/operatorModel/privacyJournal.ts#privacyJournalEntry';

export const MESSAGE_MOVE_KEY = 'server/src/operatorModel/messages.ts#messageMove';
export const DELIVERY_STAGE_KEY = 'server/src/operatorModel/messages.ts#deliveryStageOf';
export const CAP_TEXT_KEY = 'server/src/operatorModel/messages.ts#capMessageText';
export const NEXT_ID_KEY = 'server/src/operatorModel/messages.ts#nextMessageId';
export const BOOT_SETTLEMENT_KEY = 'server/src/operatorModel/messages.ts#bootSettlement';
export const NUDGE_RECOVERY_KEY = 'server/src/operatorModel/messages.ts#nudgeRecovery';
export const SETTLEMENT_MARK_KEY = 'server/src/operatorModel/messages.ts#settlementMarkOf';
export const PROMPT_TARGET_KEY = 'server/src/operatorModel/messages.ts#promptTargetVerdict';
export const PROMPT_BODY_KEY = 'server/src/operatorModel/promptBody.ts#promptBodyVerdict';
export type PromptBodyModule = typeof import('../../src/operatorModel/promptBody.js');

type State = 'recorded' | 'queued' | 'delivered' | 'picked-up' | 'settled' | 'spent';
type Event = 'queue' | 'deliver' | 'pick-up' | 'settle' | 'spend' | 'unsettle';
type Actor = 'route' | 'mail-lane' | 'hook' | 'acknowledge' | 'citing-door' | 'boot-pass';
const STATES: State[] = ['recorded', 'queued', 'delivered', 'picked-up', 'settled', 'spent'];
const EVENTS: Event[] = ['queue', 'deliver', 'pick-up', 'settle', 'spend', 'unsettle'];
const ACTORS: Actor[] = ['route', 'mail-lane', 'hook', 'acknowledge', 'citing-door', 'boot-pass'];

/** Table 1 of the plan, written out: the next state, `stage` for `unsettle`'s delivery stage, or absent when refused. */
export const TABLE_1: Record<State, Partial<Record<Event, State | 'stage'>>> = {
  recorded: { queue: 'queued', deliver: 'delivered', 'pick-up': 'picked-up', settle: 'settled', spend: 'spent' },
  queued: { deliver: 'delivered', 'pick-up': 'picked-up', settle: 'settled', spend: 'spent' },
  delivered: { 'pick-up': 'picked-up', settle: 'settled', spend: 'spent' },
  'picked-up': { deliver: 'picked-up', settle: 'settled', spend: 'spent' },
  settled: { queue: 'settled', deliver: 'settled', 'pick-up': 'settled', spend: 'spent', unsettle: 'stage' },
  spent: { queue: 'spent', deliver: 'spent', 'pick-up': 'spent' },
};
/** Who may send each event, written out. */
export const EVENT_ACTORS: Record<Event, Actor[]> = {
  queue: ['route', 'boot-pass'], deliver: ['mail-lane', 'boot-pass'], 'pick-up': ['hook'], settle: ['route', 'acknowledge', 'citing-door'],
  spend: ['citing-door', 'boot-pass'], unsettle: ['boot-pass'],
};
const STAMP: Record<Event, string | null> = {
  queue: 'queuedAt', deliver: 'deliveredAt', 'pick-up': 'pickedUpAt', settle: 'settledAt', spend: 'spentAt', unsettle: null,
};
const SETTLED_BY: Partial<Record<Actor, string>> = { route: 'mark', acknowledge: 'acknowledge', 'citing-door': 'cite' };
const NO_STAMPS: { queuedAt: number | null; deliveredAt: number | null; pickedUpAt: number | null } = { queuedAt: null, deliveredAt: null, pickedUpAt: null };

// ---------- messageMove ----------

export function messageMoveCases(m: Pick<OperatorModelDeciders, 'messageMove'>): Record<string, SuiteCase> {
  return {
    'every (state, event, actor) triple answers Table 1 and the actor list, and nothing else': () => {
      for (const state of STATES) for (const event of EVENTS) for (const actor of ACTORS) {
        const v = m.messageMove({ state, ...NO_STAMPS }, event, actor);
        const want = TABLE_1[state][event];
        const label = `${state} × ${event} × ${actor}`;
        if (!EVENT_ACTORS[event].includes(actor)) { expect(v, label).toEqual({ ok: false, why: 'actor' }); continue; }
        if (want === undefined) { expect(v, label).toEqual({ ok: false, why: 'move' }); continue; }
        expect(v, label).toEqual({
          ok: true, next: want === 'stage' ? 'recorded' : want, stamp: STAMP[event],
          settledBy: event === 'settle' ? SETTLED_BY[actor] : null, clearSettlement: event === 'unsettle',
        });
      }
    },
    'unsettle returns a settled row to the furthest stage its stamps prove': () => {
      const at = (s: Partial<typeof NO_STAMPS>): unknown => {
        const v = m.messageMove({ state: 'settled', ...NO_STAMPS, ...s }, 'unsettle', 'boot-pass');
        return v.ok ? v.next : v.why;
      };
      expect(at({})).toBe('recorded');
      expect(at({ queuedAt: 1 })).toBe('queued');
      expect(at({ queuedAt: 1, deliveredAt: 2 })).toBe('delivered');
      expect(at({ deliveredAt: 2 })).toBe('delivered');
      expect(at({ pickedUpAt: 3 })).toBe('picked-up');
      expect(at({ queuedAt: 1, deliveredAt: 2, pickedUpAt: 3 })).toBe('picked-up');
    },
    'a state this build does not know is never moved, by any event or actor': () => {
      for (const event of EVENTS) for (const actor of ACTORS) {
        expect(m.messageMove({ state: 'unknown', ...NO_STAMPS }, event, actor)).toEqual({ ok: false, why: 'unknown-state' });
      }
    },
  };
}

// ---------- deliveryStageOf ----------

export function deliveryStageCases(m: Pick<OperatorModelDeciders, 'deliveryStageOf'>): Record<string, SuiteCase> {
  return {
    'every subset of the three stamps answers the furthest stage set': () => {
      for (let bits = 0; bits < 8; bits++) {
        const s = { queuedAt: bits & 1 ? 10 : null, deliveredAt: bits & 2 ? 20 : null, pickedUpAt: bits & 4 ? 30 : null };
        const want = bits & 4 ? 'picked-up' : bits & 2 ? 'delivered' : bits & 1 ? 'queued' : 'recorded';
        expect(m.deliveryStageOf(s), JSON.stringify(s)).toBe(want);
      }
    },
    'a stamp of zero is a stamp': () => {
      expect(m.deliveryStageOf({ queuedAt: 0, deliveredAt: null, pickedUpAt: null })).toBe('queued');
    },
  };
}

// ---------- capMessageText ----------

const sha = (s: string): string => createHash('sha256').update(s, 'utf8').digest('hex');
const bytes = (s: string): number => Buffer.byteLength(s, 'utf8');
const CAP = 16_384;

export function capTextCases(m: Pick<OperatorModelDeciders, 'capMessageText'>): Record<string, SuiteCase> {
  return {
    'under and at the cap: the text unchanged, not cut, hashed as stored': () => {
      for (const t of ['hello', 'x'.repeat(CAP - 1), 'x'.repeat(CAP)]) {
        expect(m.capMessageText(t)).toEqual({ text: t, cut: false, sha256: sha(t) });
      }
    },
    'one byte over: cut, with the mark naming the dropped bytes, inside the cap': () => {
      const t = 'x'.repeat(CAP + 1);
      const r = m.capMessageText(t);
      expect(r.cut).toBe(true);
      expect(bytes(r.text)).toBeLessThanOrEqual(CAP);
      const mark = r.text.match(/ \[cut: (\d+) more bytes\]$/);
      expect(mark).not.toBeNull();
      const kept = r.text.slice(0, r.text.length - mark![0].length);
      expect(kept).toBe('x'.repeat(kept.length));
      expect(Number(mark![1])).toBe(CAP + 1 - kept.length);
      expect(r.sha256).toBe(sha(r.text));
    },
    'a cut never splits a four-byte code point': () => {
      const t = '😀'.repeat(5000);   // 20 000 bytes
      const r = m.capMessageText(t);
      expect(r.cut).toBe(true);
      expect(bytes(r.text)).toBeLessThanOrEqual(CAP);
      const kept = r.text.replace(/ \[cut: \d+ more bytes\]$/, '');
      expect(kept).toBe('😀'.repeat(kept.length / 2));
      expect(r.text).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/);
      expect(Number(r.text.match(/(\d+) more bytes/)![1])).toBe(20_000 - bytes(kept));
    },
    'a cut keeps as much as fits: kept plus mark is within the mark\'s own width of the cap': () => {
      const r = m.capMessageText('é'.repeat(CAP));   // two bytes each
      const markBytes = bytes(r.text.match(/ \[cut: \d+ more bytes\]$/)![0]);
      expect(bytes(r.text)).toBeGreaterThan(CAP - markBytes - 2);
    },
  };
}

// ---------- nextMessageId ----------

export function nextIdCases(m: Pick<OperatorModelDeciders, 'nextMessageId'>): Record<string, SuiteCase> {
  return {
    'both absent: the first id is 1': () => { expect(m.nextMessageId(null, null)).toBe(1); },
    'the store alone, the journal alone': () => {
      expect(m.nextMessageId(7, null)).toBe(8);
      expect(m.nextMessageId(null, 9)).toBe(10);
    },
    'the larger of the two wins, either way round': () => {
      expect(m.nextMessageId(7, 9)).toBe(10);
      expect(m.nextMessageId(9, 7)).toBe(10);
      expect(m.nextMessageId(5, 5)).toBe(6);
    },
  };
}

// ---------- privacyCoherence ----------

export function privacyCoherenceCases(m: Pick<PrivacyJournalModule, 'privacyCoherence'>): Record<string, SuiteCase> {
  const read = (highestId: number | null) => ({ kind: 'read' as const, highestId });
  return {
    'equal highest ids: coherent': () => {
      expect(m.privacyCoherence(read(5), 5)).toEqual({ verdict: 'coherent', highestId: 5 });
    },
    'the journal one ahead (a crash between the append and the commit, or a store restored alone): coherent': () => {
      expect(m.privacyCoherence(read(6), 5)).toEqual({ verdict: 'coherent', highestId: 6 });
      expect(m.privacyCoherence(read(6), null)).toEqual({ verdict: 'coherent', highestId: 6 });
    },
    'the journal one behind: re-anchor behind, at the store\'s highest': () => {
      expect(m.privacyCoherence(read(4), 5)).toEqual({ verdict: 're-anchor', reason: 'behind', highestId: 5 });
    },
    'a journal that names no id beside rows: re-anchor behind': () => {
      expect(m.privacyCoherence(read(null), 5)).toEqual({ verdict: 're-anchor', reason: 'behind', highestId: 5 });
    },
    'an empty journal and no rows: coherent, nothing named': () => {
      expect(m.privacyCoherence(read(null), null)).toEqual({ verdict: 'coherent', highestId: null });
    },
    'absent with no rows: fresh; absent beside rows: re-anchor missing': () => {
      expect(m.privacyCoherence({ kind: 'absent' }, null)).toEqual({ verdict: 'fresh' });
      expect(m.privacyCoherence({ kind: 'absent' }, 3)).toEqual({ verdict: 're-anchor', reason: 'missing', highestId: 3 });
    },
    'refused: refuse, with its own code and detail, whatever the store holds': () => {
      for (const s of [null, 1, 9]) {
        expect(m.privacyCoherence({ kind: 'refused', code: 'digest-mismatch', detail: 'line 2' }, s))
          .toEqual({ verdict: 'refuse', code: 'digest-mismatch', detail: 'line 2' });
      }
    },
  };
}

// ---------- privacyJournalEntry ----------

export function privacyEntryCases(m: Pick<PrivacyJournalModule, 'privacyJournalEntry' | 'PrivacyJournalError'>): Record<string, SuiteCase> {
  const refused = (raw: unknown): string => {
    try { m.privacyJournalEntry(raw); return 'accepted'; } catch (err) {
      return err instanceof m.PrivacyJournalError ? err.code : `other: ${String(err)}`;
    }
  };
  return {
    'each kind is accepted with its exact keys, rebuilt': () => {
      expect(m.privacyJournalEntry({ at: 2, id: 1, kind: 'privacy-message-issued' })).toEqual({ kind: 'privacy-message-issued', id: 1, at: 2 });
      expect(m.privacyJournalEntry({ kind: 'privacy-anchor', highestId: 4, reason: 'missing', at: 0 }))
        .toEqual({ kind: 'privacy-anchor', highestId: 4, reason: 'missing', at: 0 });
    },
    'an extra key is unknown-key, a missing one bad-field': () => {
      expect(refused({ kind: 'privacy-message-issued', id: 1, at: 2, text: 'x' })).toBe('unknown-key');
      expect(refused({ kind: 'privacy-message-issued', id: 1 })).toBe('bad-field');
      expect(refused({ kind: 'privacy-anchor', highestId: 1, at: 2 })).toBe('bad-field');
    },
    'a non-positive or non-integer id is bad-field': () => {
      for (const id of [0, -1, 1.5, '1', null]) expect(refused({ kind: 'privacy-message-issued', id, at: 2 })).toBe('bad-field');
      for (const highestId of [0, -2]) expect(refused({ kind: 'privacy-anchor', highestId, reason: 'behind', at: 2 })).toBe('bad-field');
    },
    'a negative or non-integer time is bad-field': () => {
      for (const at of [-1, 0.5, '2']) expect(refused({ kind: 'privacy-message-issued', id: 1, at })).toBe('bad-field');
    },
    'an unknown kind or reason is bad-field': () => {
      expect(refused({ kind: 'lease-carrier-seen', id: 1, at: 2 })).toBe('bad-field');
      expect(refused({ kind: 'privacy-anchor', highestId: 1, reason: 'lost', at: 2 })).toBe('bad-field');
      expect(refused(['privacy-anchor'])).toBe('bad-field');
    },
  };
}

// ---------- bootSettlement and nudgeRecovery (Task 6) ----------

const NA = { kind: 'not-applicable' } as const;
const UNMEAS = { kind: 'unmeasured', why: 'x' } as const;
const meas = (...ids: number[]) => ({ kind: 'measured', cited: new Set(ids) }) as const;
const VIEW = {} as never;
const designated = (sessionId: string, term = 1) => ({ kind: 'designated', sessionId, term, row: VIEW }) as const;
const NOT_DESIGNATED = { kind: 'not-designated', row: null } as const;
const UNMEASURED_DESIGNATION = { kind: 'unmeasured', why: 'fixture' } as const;

export function bootSettlementCases(m: Pick<OperatorModelDeciders, 'bootSettlement'>): Record<string, SuiteCase> {
  return {
    'a row that is not settled is kept under every read': () => {
      for (const state of ['recorded', 'queued', 'delivered', 'picked-up', 'spent'] as const)
        for (const c of [NA, UNMEAS, meas(4), meas()]) expect(m.bootSettlement({ id: 4, state, settledBy: null }, c)).toBe('keep');
    },
    'acknowledge and mark stay settled under every read': () => {
      for (const settledBy of ['acknowledge', 'mark'] as const)
        for (const c of [NA, UNMEAS, meas(4), meas()]) expect(m.bootSettlement({ id: 4, state: 'settled', settledBy }, c)).toBe('keep');
    },
    'cite: unsettle only on a measured read that does not cite it; keep when it does': () => {
      const row = { id: 4, state: 'settled', settledBy: 'cite' } as const;
      expect(m.bootSettlement(row, meas(4))).toBe('keep');
      expect(m.bootSettlement(row, meas(5))).toBe('unsettle');
      expect(m.bootSettlement(row, meas())).toBe('unsettle');
    },
    'cite under not-applicable reads unjudged, never unsettle': () => {
      expect(m.bootSettlement({ id: 4, state: 'settled', settledBy: 'cite' }, NA)).toBe('unjudged');
    },
    'cite under an unmeasured read reads unjudged, never unsettle': () => {
      expect(m.bootSettlement({ id: 4, state: 'settled', settledBy: 'cite' }, UNMEAS)).toBe('unjudged');
    },
    'a settlement this build cannot name is unjudged, never unsettled': () => {
      expect(m.bootSettlement({ id: 4, state: 'settled', settledBy: 'unknown' }, meas())).toBe('unjudged');
      expect(m.bootSettlement({ id: 4, state: 'settled', settledBy: null }, meas())).toBe('unjudged');
    },
  };
}

export function nudgeRecoveryCases(m: Pick<OperatorModelDeciders, 'nudgeRecovery'>): Record<string, SuiteCase> {
  const S = 'lane-a-project-a';
  const OTHER = 'lane-b-project-a';
  return {
    'a mail that exists links, whoever is designated': () => {
      expect(m.nudgeRecovery({ sessionId: S }, true, designated(S))).toBe('link');
      expect(m.nudgeRecovery({ sessionId: S }, true, designated(OTHER))).toBe('link');
      expect(m.nudgeRecovery({ sessionId: S }, true, NOT_DESIGNATED)).toBe('link');
    },
    'no mail and the row\'s own session designated queues': () => {
      expect(m.nudgeRecovery({ sessionId: S }, false, designated(S))).toBe('queue');
    },
    'no mail and another session, or none, designated waits': () => {
      expect(m.nudgeRecovery({ sessionId: S }, false, designated(OTHER))).toBe('wait');
      expect(m.nudgeRecovery({ sessionId: S }, false, NOT_DESIGNATED)).toBe('wait');
    },
    'an unmeasured designation is unjudged, with or without a mail': () => {
      expect(m.nudgeRecovery({ sessionId: S }, true, UNMEASURED_DESIGNATION)).toBe('unjudged');
      expect(m.nudgeRecovery({ sessionId: S }, false, UNMEASURED_DESIGNATION)).toBe('unjudged');
    },
    'the session is compared whatever the term': () => {
      expect(m.nudgeRecovery({ sessionId: S }, false, designated(S, 99))).toBe('queue');
    },
  };
}

// ---------- settlementMarkOf and promptTargetVerdict (Task 5) ----------

export function settlementMarkCases(m: Pick<OperatorModelDeciders, 'settlementMarkOf'>): Record<string, SuiteCase> {
  return {
    'a whole message that is /icommand, or I command in any letter case with one space, marks': () => {
      for (const t of ['/icommand', 'I command', 'i COMMAND', 'I Command', 'i command']) expect(m.settlementMarkOf(t), t).toBe('mark');
    },
    'spaces and newlines around the whole message do not matter': () => {
      for (const t of ['  /icommand', '/icommand  ', ' I command ', '\nI command\n', '\t/icommand\t']) expect(m.settlementMarkOf(t), JSON.stringify(t)).toBe('mark');
    },
    'two spaces, a tail, a head or a substring are an ordinary message': () => {
      for (const t of ['I  command', '/icommand now', 'I command you', 'please, I command', 'I command.', 'and /icommand', 'Icommand', '/ICOMMAND now', '']) {
        expect(m.settlementMarkOf(t), JSON.stringify(t)).toBe('none');
      }
    },
    'another line in the message is an ordinary message': () => {
      expect(m.settlementMarkOf('I command\nand more')).toBe('none');
      expect(m.settlementMarkOf('hello\n/icommand')).toBe('none');
    },
  };
}

export function promptTargetCases(m: Pick<OperatorModelDeciders, 'promptTargetVerdict'>): Record<string, SuiteCase> {
  const S = 'lane-a-project-a';
  const OTHER = 'lane-b-project-a';
  const word = (v: ReturnType<OperatorModelDeciders['promptTargetVerdict']>) => (v.kind === 'refuse' ? `refuse ${v.word}` : v.kind);
  return {
    'an unmeasured designation refuses every prompt, the Overlord\'s id or another, with or without a term': () => {
      for (const id of [S, OTHER]) for (const body of [{}, { overlordTerm: 1 }, { overlordTerm: 'x' }]) {
        expect(word(m.promptTargetVerdict(UNMEASURED_DESIGNATION, id, body)), `${id} ${JSON.stringify(body)}`).toBe('refuse unmeasured');
      }
    },
    'the designated session with no term, or its own term, is recorded at its term': () => {
      expect(m.promptTargetVerdict(designated(S, 3), S, {})).toEqual({ kind: 'record', term: 3 });
      expect(m.promptTargetVerdict(designated(S, 3), S, { overlordTerm: 3 })).toEqual({ kind: 'record', term: 3 });
      expect(m.promptTargetVerdict(designated(S, 0), S, { overlordTerm: 0 })).toEqual({ kind: 'record', term: 0 });
    },
    'a term that is not the designation\'s refuses stale-designation, typing and recording nothing': () => {
      expect(word(m.promptTargetVerdict(designated(S, 3), S, { overlordTerm: 2 }))).toBe('refuse stale-designation');
      expect(word(m.promptTargetVerdict(designated(S, 3), S, { overlordTerm: 4 }))).toBe('refuse stale-designation');
    },
    'a retired designation\'s old session, or a rebound one\'s, with a term refuses stale-designation': () => {
      expect(word(m.promptTargetVerdict(NOT_DESIGNATED, S, { overlordTerm: 1 }))).toBe('refuse stale-designation');
      expect(word(m.promptTargetVerdict(designated(OTHER, 2), S, { overlordTerm: 1 }))).toBe('refuse stale-designation');
      expect(word(m.promptTargetVerdict(designated(OTHER, 1), S, { overlordTerm: 1 }))).toBe('refuse stale-designation');
    },
    'the pending body of a designate, or of a rebind, is renewing with or without a term; the bound session and any other are not': () => {
      const pending = (sessionId: string, kind: 'designate' | 'rebind') => ({ sessionId, kind, deadlineAt: 9, since: 1, actor: 'x', generation: null });
      const pendingOnly = { kind: 'not-designated', row: { bound: null, pending: pending(S, 'designate'), term: 1 } } as never;
      const rebind = { kind: 'designated', sessionId: OTHER, term: 2, row: { bound: { sessionId: OTHER, generation: 'g' }, pending: pending(S, 'rebind'), term: 2 } } as never;
      for (const body of [{}, { overlordTerm: 1 }]) {
        expect(word(m.promptTargetVerdict(pendingOnly, S, body)), `designate ${JSON.stringify(body)}`).toBe('refuse renewing');
        expect(word(m.promptTargetVerdict(rebind, S, body)), `rebind ${JSON.stringify(body)}`).toBe('refuse renewing');
      }
      expect(m.promptTargetVerdict(pendingOnly, OTHER, {})).toEqual({ kind: 'type' });
      expect(m.promptTargetVerdict(rebind, OTHER, {})).toEqual({ kind: 'record', term: 2 });
    },
    'any other session with no term is typed to, as today; so is every session when nobody is designated': () => {
      expect(m.promptTargetVerdict(designated(OTHER, 2), S, {})).toEqual({ kind: 'type' });
      expect(m.promptTargetVerdict(NOT_DESIGNATED, S, {})).toEqual({ kind: 'type' });
    },
    'offRecord true on what would be typed refuses bad-request; on the designated session it records; only true counts (the chat, question 4)': () => {
      expect(word(m.promptTargetVerdict(designated(OTHER, 2), S, { offRecord: true }))).toBe('refuse bad-request');
      expect(word(m.promptTargetVerdict(NOT_DESIGNATED, S, { offRecord: true }))).toBe('refuse bad-request');
      expect(m.promptTargetVerdict(designated(S, 2), S, { offRecord: true })).toEqual({ kind: 'record', term: 2 });
      for (const v of ['yes', 1, false, null]) expect(m.promptTargetVerdict(designated(OTHER, 2), S, { offRecord: v }), String(v)).toEqual({ kind: 'type' });
    },
    'a term present but not a non-negative safe integer is bad-request': () => {
      for (const t of [-1, 1.5, '1', null, Number.NaN, Number.MAX_SAFE_INTEGER + 2, {}, true]) {
        expect(word(m.promptTargetVerdict(designated(S, 1), S, { overlordTerm: t })), String(t)).toBe('refuse bad-request');
      }
    },
  };
}

// ---------- promptBodyVerdict (Task 5, review 2550 F6) ----------

export function promptBodyCases(m: Pick<PromptBodyModule, 'promptBodyVerdict'>): Record<string, SuiteCase> {
  const KEY = 'send-key-0123456789abcdef';
  const word = (v: ReturnType<PromptBodyModule['promptBodyVerdict']>) => (v.kind === 'refuse' ? `refuse ${v.word}` : v.kind);
  return {
    'a good body is ok, with its text and its key, or no key': () => {
      expect(m.promptBodyVerdict({ text: 'hello' }, undefined)).toEqual({ kind: 'ok', text: 'hello', key: null });
      expect(m.promptBodyVerdict({ text: 'hello', attachments: [] }, KEY)).toEqual({ kind: 'ok', text: 'hello', key: KEY });
    },
    'any attachment but an empty list is bad-attachment': () => {
      for (const attachments of [['/x/y.png'], [''], 'x', 7, null, {}]) {
        expect(word(m.promptBodyVerdict({ text: 'hello', attachments }, KEY)), JSON.stringify(attachments)).toBe('refuse bad-attachment');
      }
    },
    'text that is not a non-empty string is bad-request': () => {
      for (const text of [undefined, '', 7, null, ['a']]) expect(word(m.promptBodyVerdict({ text }, undefined)), String(text)).toBe('refuse bad-request');
    },
    'a sendKey that is present and malformed is bad-request, with its detail': () => {
      for (const key of ['short', 'a'.repeat(65), 'has space 0123456789abcdef', 12345678901234567, null, '']) {
        const v = m.promptBodyVerdict({ text: 'hello' }, key);
        expect(word(v), String(key)).toBe('refuse bad-request');
        expect(v.kind === 'refuse' ? v.detail : '', String(key)).toContain('sendKey');
      }
    },
    'the order is attachments, then text, then the key': () => {
      expect(word(m.promptBodyVerdict({ text: '', attachments: ['x'] }, 'bad'))).toBe('refuse bad-attachment');
      expect(m.promptBodyVerdict({ text: '', attachments: [] }, 'bad')).toEqual({ kind: 'refuse', word: 'bad-request' });
      expect(m.promptBodyVerdict({ text: 'hello' }, 'bad')).toMatchObject({ kind: 'refuse', word: 'bad-request', detail: expect.stringContaining('sendKey') });
    },
  };
}

export const MESSAGE_MOVE_SET: MutantSet<OperatorModelDeciders> = {
  modulePath: MESSAGES_TS,
  suite: messageMoveCases,
  mutants: [
    { id: 'MM1 actor ignored', old: 'if (!MESSAGE_EVENT_ACTORS[event].includes(actor)) return', new: 'if (false) return' },
    { id: 'MM2 unsettle to recorded always', old: "const next = target === 'delivery-stage' ? deliveryStageOf(row) : target;", new: "const next = target === 'delivery-stage' ? 'recorded' : target;" },
    { id: 'MM3 unknown moves', old: "if (row.state === 'unknown') return { ok: false, why: 'unknown-state' };", new: "if (row.state === 'unknown') return { ok: false, why: 'move' };" },
    { id: 'MM4 no settledBy', old: "const settledBy = event === 'settle' ?", new: "const settledBy = event === 'spend' ?" },
    { id: 'MM5 unsettle keeps settlement', old: "clearSettlement: event === 'unsettle'", new: 'clearSettlement: false' },
  ],
};
export const DELIVERY_STAGE_SET: MutantSet<OperatorModelDeciders> = {
  modulePath: MESSAGES_TS,
  suite: deliveryStageCases,
  mutants: [
    { id: 'DS1 picked-up ignored', old: "if (s.pickedUpAt !== null) return 'picked-up';", new: '' },
    { id: 'DS2 delivered read before picked-up', old: "if (s.pickedUpAt !== null) return 'picked-up';\n  if (s.deliveredAt !== null) return 'delivered';", new: "if (s.deliveredAt !== null) return 'delivered';\n  if (s.pickedUpAt !== null) return 'picked-up';" },
    { id: 'DS3 truthy stamp', old: "if (s.queuedAt !== null) return 'queued';", new: "if (s.queuedAt) return 'queued';" },
  ],
};
export const CAP_TEXT_SET: MutantSet<OperatorModelDeciders> = {
  modulePath: MESSAGES_TS,
  suite: capTextCases,
  mutants: [
    { id: 'CT1 cut by characters', old: 'const b = utf8Bytes(ch);', new: 'const b = ch.length;' },
    { id: 'CT2 at the cap is cut', old: 'if (total <= maxBytes) return', new: 'if (total < maxBytes) return' },
    { id: 'CT3 mark outside the cap', old: 'const budget = maxBytes - utf8Bytes(cutMark(total));', new: 'const budget = maxBytes;' },
    { id: 'CT4 hash of the input', old: 'return { text: stored, cut: true, sha256: sha256Of(stored) };', new: 'return { text: stored, cut: true, sha256: sha256Of(text) };' },
  ],
};
export const NEXT_ID_SET: MutantSet<OperatorModelDeciders> = {
  modulePath: MESSAGES_TS,
  suite: nextIdCases,
  mutants: [
    { id: 'NI1 journal ignored', old: 'Math.max(storeHighest ?? 0, journalHighest ?? 0) + 1', new: '(storeHighest ?? 0) + 1' },
    { id: 'NI2 store ignored', old: 'Math.max(storeHighest ?? 0, journalHighest ?? 0) + 1', new: '(journalHighest ?? 0) + 1' },
    { id: 'NI3 min', old: 'Math.max(storeHighest ?? 0, journalHighest ?? 0) + 1', new: 'Math.min(storeHighest ?? 0, journalHighest ?? 0) + 1' },
  ],
};

export const COHERENCE_SET: MutantSet<PrivacyJournalModule> = {
  modulePath: PRIVACY_TS,
  suite: privacyCoherenceCases,
  mutants: [
    { id: 'PC1 behind is coherent', old: 'journal.highestId < storeHighestId', new: 'journal.highestId < storeHighestId - 1' },
    { id: 'PC2 empty beside rows is coherent', old: '(journal.highestId === null || journal.highestId < storeHighestId)', new: '(journal.highestId !== null && journal.highestId < storeHighestId)' },
    { id: 'PC3 absent beside rows is fresh', old: "return storeHighestId === null ? { verdict: 'fresh' } :", new: "return true ? { verdict: 'fresh' } :" },
    { id: 'PC4 refused folded into absent', old: "if (journal.kind === 'refused') return { verdict: 'refuse', code: journal.code, detail: journal.detail };", new: "if (journal.kind === 'refused') return { verdict: 'fresh' };" },
    { id: 'PC5 equal is behind', old: 'journal.highestId < storeHighestId)', new: 'journal.highestId <= storeHighestId)' },
  ],
};
export const PRIVACY_ENTRY_SET: MutantSet<PrivacyJournalModule> = {
  modulePath: PRIVACY_TS,
  suite: privacyEntryCases,
  mutants: [
    { id: 'PE1 zero id', old: 'Number.isSafeInteger(v) && v >= 1 ?', new: 'Number.isSafeInteger(v) && v >= 0 ?' },
    { id: 'PE2 extra keys', old: "chainedExactKeys(PRIVACY_JOURNAL_FORMAT, raw, ENTRY_KEYS[kind], `a ${kind} entry`);", new: '' },
    { id: 'PE3 any reason', old: "if (reason !== 'missing' && reason !== 'behind') return", new: 'if (false) return' },
    { id: 'PE4 negative time', old: 'Number.isSafeInteger(v) && v >= 0 ?', new: 'Number.isSafeInteger(v) ?' },
  ],
};

export const BOOT_SETTLEMENT_SET: MutantSet<OperatorModelDeciders> = {
  modulePath: MESSAGES_TS,
  suite: bootSettlementCases,
  mutants: [
    { id: 'BS1 unmeasured read unsettles', old: "if (cites.kind !== 'measured') return 'unjudged';", new: "if (cites.kind === 'not-applicable') return 'unjudged';" },
    { id: 'BS2 not-applicable unsettles', old: "if (cites.kind !== 'measured') return 'unjudged';", new: "if (cites.kind === 'unmeasured') return 'unjudged'; if (cites.kind !== 'measured') return 'unsettle';" },
    { id: 'BS3 mark unsettled', old: "row.settledBy === 'acknowledge' || row.settledBy === 'mark'", new: "row.settledBy === 'acknowledge'" },
    { id: 'BS4 unsettled kept as settled', old: "if (row.state !== 'settled') return 'keep';", new: "if (row.state !== 'settled') return 'unsettle';" },
    { id: 'BS5 cited row unsettled', old: "cites.cited.has(row.id) ? 'keep' : 'unsettle'", new: "cites.cited.has(row.id) ? 'unsettle' : 'keep'" },
    { id: 'BS6 unnamed settlement unsettles', old: "if (row.settledBy !== 'cite') return 'unjudged';", new: "if (row.settledBy !== 'cite') return 'unsettle';" },
  ],
};
export const NUDGE_RECOVERY_SET: MutantSet<OperatorModelDeciders> = {
  modulePath: MESSAGES_TS,
  suite: nudgeRecoveryCases,
  mutants: [
    { id: 'NR1 queues when a mail exists', old: "if (found) return 'link';", new: "if (found) return 'queue';" },
    { id: 'NR2 session ignored', old: "designation.kind === 'designated' && designation.sessionId === row.sessionId ?", new: "designation.kind === 'designated' ?" },
    { id: 'NR3 unmeasured designation folded to wait', old: "if (designation.kind === 'unmeasured') return 'unjudged';", new: "if (designation.kind === 'unmeasured') return 'wait';" },
    { id: 'NR4 term compared', old: "designation.sessionId === row.sessionId ?", new: "designation.sessionId === row.sessionId && designation.term === 1 ?" },
    { id: 'NR5 mail ignored', old: "if (found) return 'link';", new: '' },
  ],
};

export const PROMPT_BODY_SET: MutantSet<PromptBodyModule> = {
  modulePath: PROMPT_BODY_TS,
  suite: promptBodyCases,
  mutants: [
    { id: 'PB1 attachments allowed', old: "if (body.attachments !== undefined && !(Array.isArray(body.attachments) && body.attachments.length === 0)) {", new: 'if (false) {' },
    { id: 'PB2 any array allowed', old: 'Array.isArray(body.attachments) && body.attachments.length === 0', new: 'Array.isArray(body.attachments)' },
    { id: 'PB3 attachment word is bad-request', old: "return { kind: 'refuse', word: 'bad-attachment' };", new: "return { kind: 'refuse', word: 'bad-request' };" },
    { id: 'PB4 empty text allowed', old: "typeof body.text !== 'string' || body.text.length === 0", new: "typeof body.text !== 'string'" },
    { id: 'PB5 non-string text allowed', old: "typeof body.text !== 'string' || body.text.length === 0", new: 'body.text === undefined || body.text.length === 0' },
    { id: 'PB6 malformed key allowed', old: 'if (key !== undefined && !isSendKey(key)) {', new: 'if (false) {' },
    { id: 'PB7 null key allowed', old: 'if (key !== undefined && !isSendKey(key)) {', new: 'if (key !== undefined && key !== null && !isSendKey(key)) {' },
    { id: 'PB8 key without its detail', old: "detail: 'sendKey: 16 to 64 characters of A-Z a-z 0-9 _ -'", new: "detail: 'bad'" },
    { id: 'PB9 text before attachments', old: "if (body.attachments !== undefined && !(Array.isArray(body.attachments) && body.attachments.length === 0)) {", new: "if (typeof body.text !== 'string' || body.text.length === 0) return { kind: 'refuse', word: 'bad-request' };\n  if (body.attachments !== undefined && !(Array.isArray(body.attachments) && body.attachments.length === 0)) {" },
    { id: 'PB10 key before text', old: "if (typeof body.text !== 'string' || body.text.length === 0) return { kind: 'refuse', word: 'bad-request' };", new: "if (key !== undefined && !isSendKey(key)) return { kind: 'refuse', word: 'bad-request', detail: 'sendKey' };\n  if (typeof body.text !== 'string' || body.text.length === 0) return { kind: 'refuse', word: 'bad-request' };" },
  ],
};
export const SETTLEMENT_MARK_SET: MutantSet<OperatorModelDeciders> = {
  modulePath: MESSAGES_TS,
  suite: settlementMarkCases,
  mutants: [
    { id: 'SM1 substring matches', old: "return t === '/icommand' || /^i command$/i.test(t) ? 'mark' : 'none';", new: "return t.includes('/icommand') || /i command/i.test(t) ? 'mark' : 'none';" },
    { id: 'SM2 case-sensitive', old: '/^i command$/i.test(t)', new: '/^I command$/.test(t)' },
    { id: 'SM3 any run of spaces', old: '/^i command$/i.test(t)', new: '/^i +command$/i.test(t)' },
    { id: 'SM4 untrimmed', old: 'const t = text.trim();', new: 'const t = text;' },
    { id: 'SM5 a prefix matches', old: "t === '/icommand' ||", new: "t.startsWith('/icommand') ||" },
  ],
};
export const PROMPT_TARGET_SET: MutantSet<OperatorModelDeciders> = {
  modulePath: MESSAGES_TS,
  suite: promptTargetCases,
  mutants: [
    { id: 'PT1 unmeasured types', old: "if (designation.kind === 'unmeasured') return { kind: 'refuse', word: 'unmeasured', detail: designation.why };", new: "if (designation.kind === 'unmeasured') return { kind: 'type' };" },
    { id: 'PT2 unmeasured folded into not-designated', old: "if (designation.kind === 'unmeasured') return { kind: 'refuse', word: 'unmeasured', detail: designation.why };", new: "if (designation.kind === 'unmeasured') return { kind: 'refuse', word: 'stale-designation', detail: designation.why };" },
    { id: 'PT3 stale term types', old: "if (term !== undefined && !(bound && designation.term === term)) {\n    return { kind: 'refuse', word: 'stale-designation',", new: "if (term !== undefined && !(bound && designation.term === term)) {\n    return { kind: 'type' }; return { kind: 'refuse', word: 'stale-designation'," },
    { id: 'PT4 term ignored', old: 'designation.term === term', new: 'true' },
    { id: 'PT5 session ignored', old: "designation.kind === 'designated' && designation.sessionId === sessionId", new: "designation.kind === 'designated'" },
    { id: 'PT6 malformed term allowed', old: "Number.isSafeInteger(term) && term >= 0", new: 'true' },
    { id: 'PT7 negative term allowed', old: 'Number.isSafeInteger(term) && term >= 0', new: 'Number.isSafeInteger(term)' },
    { id: 'PT8 designated session typed', old: "return bound ? { kind: 'record', term: designation.term } : { kind: 'type' };", new: "return { kind: 'type' };" },
    { id: 'PT9 other session recorded', old: "return bound ? { kind: 'record', term: designation.term } : { kind: 'type' };", new: "return designation.kind === 'designated' ? { kind: 'record', term: designation.term } : { kind: 'type' };" },
    { id: 'PT10 pending body typed', old: "if (fact !== 'unmeasured' && designationFactOf(sessionId, fact) === 'pending') {", new: 'if (false) {' },
    { id: 'PT11 pending word is unmeasured', old: "return { kind: 'refuse', word: 'renewing',", new: "return { kind: 'refuse', word: 'unmeasured'," },
    { id: 'PT13 offRecord on a typed prompt types', old: '  if (!bound && body.offRecord === true) return', new: '  if (false) return' },
    { id: 'PT14 any offRecord value counts', old: '!bound && body.offRecord === true', new: '!bound && body.offRecord !== undefined' },
    { id: 'PT12 pending read for any session', old: "designationFactOf(sessionId, fact) === 'pending'", new: "designationFactOf(sessionId, fact) !== 'none'" },
  ],
};

export const OPERATOR_MODEL_MUTANT_SETS: Record<string, MutantSet<never>> = {
  [MESSAGE_MOVE_KEY]: MESSAGE_MOVE_SET as MutantSet<never>,
  [DELIVERY_STAGE_KEY]: DELIVERY_STAGE_SET as MutantSet<never>,
  [CAP_TEXT_KEY]: CAP_TEXT_SET as MutantSet<never>,
  [NEXT_ID_KEY]: NEXT_ID_SET as MutantSet<never>,
  [BOOT_SETTLEMENT_KEY]: BOOT_SETTLEMENT_SET as MutantSet<never>,
  [NUDGE_RECOVERY_KEY]: NUDGE_RECOVERY_SET as MutantSet<never>,
  [SETTLEMENT_MARK_KEY]: SETTLEMENT_MARK_SET as MutantSet<never>,
  [PROMPT_TARGET_KEY]: PROMPT_TARGET_SET as MutantSet<never>,
  [PROMPT_BODY_KEY]: PROMPT_BODY_SET as MutantSet<never>,
  [COHERENCE_KEY]: COHERENCE_SET as MutantSet<never>,
  [PRIVACY_ENTRY_KEY]: PRIVACY_ENTRY_SET as MutantSet<never>,
};
