// The request record's deciders' cases (Overlord W2 request record plan, Task A2). Written ONCE here, as suite cases over a module:
// `overlord-requests-policy.test.ts` runs them against the real module, and `sim/requestSets.ts` runs them against each textual
// mutant (the every-run floors of D-8217). The expectations are spelled out here independently of the table and the derived lists
// in `shared/overlordRequests.ts`, so a wrong row there is a red case, never a mirrored one.
import { expect } from 'vitest';
import type { RequestActor, RequestColumn, RequestMove, RequestMoveReason, RequestState } from '../../shared/overlordRequests.js';
import type { SuiteCase } from './sim/mutate.js';

export type RequestsModule = typeof import('../src/coord/overlordRequests.js');
type M = RequestsModule;
type Ctx = Parameters<M['nextRequestState']>[3];
type Verdict = ReturnType<M['nextRequestState']>;
type Fact = Parameters<M['citationVerdict']>[0]['facts'] extends ReadonlyMap<number, infer F> ? F : never;

const HOUR = 3_600_000;
const NOW = 1_800_000_000_000;

// ------------------------------------------------------------------------------------------------------ the expectations

const STATES: readonly RequestState[] = [
  'received', 'routed', 'in-progress', 'blocked', 'declined', 'needs-you', 'done-unverified', 'done', 'failed', 'dropped',
];
const ACTORS: readonly RequestActor[] = ['overlord', 'owner', 'server', 'operator'];
const ROUTED_NEEDS: readonly RequestState[] = ['received', 'routed', 'in-progress', 'blocked', 'declined'];

// Table 4, spelled out again (the transitions test holds its own copy of the same rows against the L0 table).
const ROWS: Record<RequestMove, { actor: RequestActor; from: readonly RequestState[]; to: RequestState }> = {
  open: { actor: 'overlord', from: [], to: 'received' },
  route: { actor: 'overlord', from: ['received'], to: 'routed' },
  're-relay': { actor: 'overlord', from: ['routed'], to: 'routed' },
  'route-elsewhere': { actor: 'overlord', from: ['declined', 'needs-you'], to: 'routed' },
  drop: { actor: 'overlord', from: ['received', 'declined', 'needs-you'], to: 'dropped' },
  escalate: { actor: 'overlord', from: ['received', 'declined'], to: 'needs-you' },
  acknowledge: { actor: 'owner', from: ['routed'], to: 'in-progress' },
  counter: { actor: 'owner', from: ['routed'], to: 'routed' },
  decline: { actor: 'owner', from: ['routed'], to: 'declined' },
  block: { actor: 'owner', from: ['in-progress'], to: 'blocked' },
  fail: { actor: 'owner', from: ['in-progress'], to: 'failed' },
  close: { actor: 'server', from: ['in-progress', 'done-unverified'], to: 'done' },
  'close-unowned': { actor: 'server', from: ['received'], to: 'done' },
  'close-unverified': { actor: 'server', from: ['in-progress'], to: 'done-unverified' },
  'start-parent': { actor: 'server', from: ['received'], to: 'in-progress' },
  'close-parent': { actor: 'server', from: ['in-progress', 'needs-you'], to: 'done' },
  'resume-parent': { actor: 'server', from: ['needs-you'], to: 'in-progress' },
  unblock: { actor: 'server', from: ['blocked'], to: 'in-progress' },
  'needs-you': { actor: 'server', from: ROUTED_NEEDS, to: 'needs-you' },
  'relay-held': { actor: 'server', from: ['received', 'declined', 'needs-you'], to: 'needs-you' },
  answer: { actor: 'operator', from: ['needs-you'], to: 'in-progress' },
  'answer-recorded': { actor: 'operator', from: ['needs-you'], to: 'needs-you' },
  take: { actor: 'operator', from: ['routed', 'in-progress', 'blocked'], to: 'needs-you' },
  'hand-back-routed': { actor: 'operator', from: ['needs-you'], to: 'routed' },
  'hand-back-in-progress': { actor: 'operator', from: ['needs-you'], to: 'in-progress' },
  'hand-back-blocked': { actor: 'operator', from: ['needs-you'], to: 'blocked' },
  confirm: { actor: 'operator', from: ['done-unverified'], to: 'done' },
  withdraw: {
    actor: 'operator', from: ['received', 'routed', 'in-progress', 'blocked', 'declined', 'needs-you', 'done-unverified'], to: 'dropped',
  },
};
const MOVES = Object.keys(ROWS) as RequestMove[];
const HAND_BACKS: readonly RequestMove[] = ['hand-back-routed', 'hand-back-in-progress', 'hand-back-blocked'];

const COLUMNS: readonly RequestColumn[] = ['owner', 'doneTest', 'expectedPaths', 'dependsOn', 'takenFrom', 'closeNote', 'counters'];
const FIELDS: Record<RequestMove, readonly RequestColumn[]> = {
  open: [], route: ['owner', 'doneTest', 'expectedPaths'], 're-relay': ['owner', 'doneTest', 'expectedPaths'],
  'route-elsewhere': ['owner', 'doneTest', 'expectedPaths'], drop: ['closeNote'], escalate: [], acknowledge: [], counter: ['counters'],
  decline: [], block: ['dependsOn'], fail: ['closeNote'], close: ['closeNote'], 'close-unowned': ['closeNote'], 'close-unverified': [],
  'start-parent': [], 'close-parent': ['closeNote'], 'resume-parent': [], unblock: [], 'needs-you': [], 'relay-held': [], answer: [],
  'answer-recorded': [], take: [], 'hand-back-routed': [], 'hand-back-in-progress': [], 'hand-back-blocked': [],
  confirm: ['closeNote'], withdraw: ['closeNote'],
};
const REASONS: Record<RequestMoveReason, readonly RequestMove[]> = {
  'needs-start': ['escalate'], 'needs-proposal': ['escalate'], 'unnamed-widening': ['escalate', 'relay-held'], dropped: ['drop'],
  'outside-goals': ['decline'], 'goal-conflict': ['decline'], impossible: ['decline'], duplicate: ['decline'],
  'two-counters': ['needs-you'], 'two-silent-nudges': ['needs-you'], 'due-unarmed': ['needs-you'], 'off-before-ack': ['needs-you'],
  'off-after-decline': ['needs-you'], restore: ['needs-you'], 'child-ended': ['needs-you'], 'dependency-ended': ['needs-you'],
  'operator-took-it': ['take'], 'widening-unclear': ['relay-held'], 'quote-private-name': ['relay-held'],
  'quote-unchecked': ['relay-held'],
};
const REASON_WORDS = Object.keys(REASONS) as RequestMoveReason[];
const reasonsOf = (m: RequestMove): RequestMoveReason[] => REASON_WORDS.filter((r) => REASONS[r].includes(m));

/** A context under which `move` meets none of the guards after its `from` and actor: acknowledged, answered, no child, the fields it
 *  must set and the first reason it may carry; a hand back holds the state it returns to. */
const neutral = (move: RequestMove, over: Partial<Ctx> = {}): Ctx => ({
  answered: true, takenFrom: HAND_BACKS.includes(move) ? ROWS[move].to : null, ownerAcknowledged: true, openChildren: 0, hasChildren: false,
  fields: move === 'drop' ? ['closeNote'] : [], reason: reasonsOf(move)[0] ?? null, ...over,
});
const base = (over: Partial<Ctx> = {}): Ctx => ({
  answered: true, takenFrom: null, ownerAcknowledged: true, openChildren: 0, hasChildren: false, fields: [], reason: null, ...over,
});
const refused = (why: string): Verdict => ({ ok: false, why } as Verdict);
const ok = (to: RequestState): Verdict => ({ ok: true, to });

// ----------------------------------------------------------------------------------------------------- nextRequestState

export function nextRequestStateCases(m: M): Record<string, SuiteCase> {
  const next = m.nextRequestState;
  return {
    'the refusal words are the twelve, in the order they are read': () => {
      expect([...m.REQUEST_MOVE_REFUSALS]).toEqual([
        'taken', 'not-answered', 'not-from', 'wrong-actor', 'not-taken-from', 'not-acknowledged', 'has-open-children', 'has-children',
        'field-not-allowed', 'field-required', 'reason-required', 'reason-not-allowed',
      ]);
    },

    'the cube: every state x move x actor under a neutral context answers from its row, never from a helper': () => {
      for (const state of STATES) {
        for (const move of MOVES) {
          for (const actor of ACTORS) {
            const ctx = neutral(move);
            const row = ROWS[move];
            let want: Verdict;
            if (actor === 'overlord' && ctx.takenFrom !== null) want = refused('taken');
            else if (!row.from.includes(state)) want = refused('not-from');
            else if (actor !== row.actor) want = refused('wrong-actor');
            else want = ok(row.to);
            expect(next(state, move, actor, ctx), `${state} ${move} ${actor}`).toEqual(want);
          }
        }
      }
    },

    'the cube again with nobody holding the row: an Overlord move is read by its from, its actor, then the rest': () => {
      for (const state of STATES) {
        for (const move of MOVES.filter((x) => !HAND_BACKS.includes(x))) {
          for (const actor of ACTORS) {
            const row = ROWS[move];
            const want = !row.from.includes(state) ? refused('not-from') : actor !== row.actor ? refused('wrong-actor') : ok(row.to);
            expect(next(state, move, actor, neutral(move)), `${state} ${move} ${actor}`).toEqual(want);
          }
        }
      }
    },

    'the row of each move: it is honoured from every state it names and answers its `to`': () => {
      for (const move of MOVES) {
        for (const state of ROWS[move].from) expect(next(state, move, ROWS[move].actor, neutral(move)), `${move} ${state}`).toEqual(ok(ROWS[move].to));
      }
    },

    'open always answers not-from here (the insert asks openMoveVerdict), for every state and actor': () => {
      for (const state of STATES) for (const actor of ACTORS) expect(next(state, 'open', actor, neutral('open')), `${state} ${actor}`).toEqual(refused('not-from'));
    },

    // Guard 1: a taken row.
    'guard 1: an Overlord move on a taken row is taken, before its from and its actor are read': () => {
      const held = base({ takenFrom: 'routed' });
      expect(next('in-progress', 'escalate', 'overlord', { ...held, reason: 'needs-start' })).toEqual(refused('taken'));  // not from
      expect(next('routed', 'acknowledge', 'overlord', held)).toEqual(refused('taken'));                                   // wrong actor
      expect(next('received', 'close-unowned', 'overlord', held)).toEqual(refused('taken'));
      expect(next('needs-you', 'drop', 'overlord', { ...held, fields: ['closeNote'], reason: 'dropped' })).toEqual(refused('taken'));
      for (const move of MOVES.filter((x) => ROWS[x].actor === 'overlord')) {
        for (const state of STATES) expect(next(state, move, 'overlord', { ...neutral(move), takenFrom: 'blocked' }), `${state} ${move}`).toEqual(refused('taken'));
      }
    },
    'guard 1: it is read for every state the row may have been taken from': () => {
      for (const taken of ['routed', 'in-progress', 'blocked'] as const) {
        expect(next('needs-you', 'route-elsewhere', 'overlord', base({ takenFrom: taken, fields: [] })), taken).toEqual(refused('taken'));
      }
    },
    'guard 1: it is the Overlord only: the operator, the server and an owner on a taken row go on to their own guards': () => {
      const held = base({ takenFrom: 'in-progress' });
      expect(next('needs-you', 'answer-recorded', 'operator', held)).toEqual(ok('needs-you'));
      expect(next('needs-you', 'hand-back-in-progress', 'operator', held)).toEqual(ok('in-progress'));
      expect(next('needs-you', 'withdraw', 'operator', { ...held, fields: ['closeNote'] })).toEqual(ok('dropped'));
      expect(next('needs-you', 'close-parent', 'server', held)).toEqual(ok('done'));
      expect(next('needs-you', 'resume-parent', 'server', held)).toEqual(ok('in-progress'));
      expect(next('routed', 'acknowledge', 'owner', held)).toEqual(ok('in-progress'));
    },
    'guard 1 comes before guard 2: a taken and unanswered needs-you row is taken': () => {
      expect(next('needs-you', 'drop', 'overlord', base({ takenFrom: 'routed', answered: false }))).toEqual(refused('taken'));
    },

    // Guard 2: an unanswered needs-you row.
    'guard 2: an Overlord move on an unanswered needs-you row is not-answered, before its from, its actor and its other guards': () => {
      const open = base({ answered: false });
      expect(next('needs-you', 'escalate', 'overlord', { ...open, reason: 'needs-start' })).toEqual(refused('not-answered')); // not from needs-you
      expect(next('needs-you', 'close', 'overlord', open)).toEqual(refused('not-answered'));                                  // wrong actor
      expect(next('needs-you', 'drop', 'overlord', { ...open, fields: ['closeNote'], reason: 'dropped' })).toEqual(refused('not-answered'));
      expect(next('needs-you', 'route-elsewhere', 'overlord', { ...open, hasChildren: true })).toEqual(refused('not-answered'));
      expect(next('needs-you', 'drop', 'overlord', { ...open, openChildren: 2 })).toEqual(refused('not-answered'));
      for (const move of MOVES.filter((x) => ROWS[x].actor === 'overlord')) {
        expect(next('needs-you', move, 'overlord', { ...neutral(move), answered: false }), move).toEqual(refused('not-answered'));
      }
    },
    'guard 2: it reads the answer once it is given, and only on a needs-you row': () => {
      const answered = base({ answered: true, fields: ['closeNote'], reason: 'dropped' });
      expect(next('needs-you', 'drop', 'overlord', answered)).toEqual(ok('dropped'));
      expect(next('needs-you', 'route-elsewhere', 'overlord', base({ answered: true }))).toEqual(ok('routed'));
      for (const state of STATES.filter((s) => s !== 'needs-you')) {
        expect(next(state, 'drop', 'overlord', { ...answered, answered: false }), state).toEqual(
          ROWS.drop.from.includes(state) ? ok('dropped') : refused('not-from'),
        );
      }
    },
    'guard 2: it is the Overlord only': () => {
      const open = base({ answered: false });
      expect(next('needs-you', 'answer-recorded', 'operator', open)).toEqual(ok('needs-you'));
      expect(next('needs-you', 'close-parent', 'server', open)).toEqual(ok('done'));
      expect(next('needs-you', 'resume-parent', 'server', open)).toEqual(ok('in-progress'));
      expect(next('needs-you', 'withdraw', 'operator', { ...open, fields: ['closeNote'] })).toEqual(ok('dropped'));
    },

    // Guards 3 and 4.
    'guard 3 before 4: a move off its from is not-from whoever makes it; on its from and the wrong actor it is wrong-actor': () => {
      expect(next('received', 'acknowledge', 'overlord', base())).toEqual(refused('not-from'));
      expect(next('routed', 'acknowledge', 'overlord', base())).toEqual(refused('wrong-actor'));
      expect(next('routed', 'acknowledge', 'operator', base())).toEqual(refused('wrong-actor'));
      expect(next('routed', 'acknowledge', 'server', base())).toEqual(refused('wrong-actor'));
      expect(next('done', 'close', 'owner', base())).toEqual(refused('not-from'));
      expect(next('in-progress', 'close', 'owner', base({ fields: ['closeNote'] }))).toEqual(refused('wrong-actor'));
    },
    'a terminal state has no exit for any move or actor': () => {
      for (const state of ['done', 'failed', 'dropped'] as const) {
        for (const move of MOVES) {
          for (const actor of ACTORS) {
            expect(next(state, move, actor, neutral(move, { takenFrom: null })), `${state} ${move} ${actor}`).toEqual(refused('not-from'));
          }
        }
      }
    },

    // Guard 5: a hand back returns to the state the take left.
    'guard 5: a hand back is honoured only for the state the take left': () => {
      for (const move of HAND_BACKS) {
        for (const taken of [null, 'routed', 'in-progress', 'blocked'] as const) {
          const want = taken === ROWS[move].to ? ok(ROWS[move].to) : refused('not-taken-from');
          expect(next('needs-you', move, 'operator', base({ takenFrom: taken })), `${move} ${String(taken)}`).toEqual(want);
        }
      }
    },
    'guard 5 comes after from and actor: a hand back off needs-you is not-from, by an owner it is wrong-actor': () => {
      expect(next('routed', 'hand-back-routed', 'operator', base({ takenFrom: null }))).toEqual(refused('not-from'));
      expect(next('needs-you', 'hand-back-routed', 'owner', base({ takenFrom: null }))).toEqual(refused('wrong-actor'));
      expect(next('needs-you', 'hand-back-routed', 'server', base({ takenFrom: 'blocked' }))).toEqual(refused('wrong-actor'));
    },
    'guard 5 is the hand backs only: every other move answers whatever takenFrom holds': () => {
      for (const move of MOVES.filter((x) => !HAND_BACKS.includes(x) && ROWS[x].actor !== 'overlord' && x !== 'open')) {
        for (const taken of [null, 'routed', 'blocked'] as const) {
          expect(next(ROWS[move].from[0]!, move, ROWS[move].actor, neutral(move, { takenFrom: taken })), `${move} ${String(taken)}`).toEqual(ok(ROWS[move].to));
        }
      }
    },

    // Guard 6: the owner acknowledged.
    'guard 6: an answer needs an acknowledged owner; answer-recorded does not': () => {
      expect(next('needs-you', 'answer', 'operator', base({ ownerAcknowledged: true }))).toEqual(ok('in-progress'));
      expect(next('needs-you', 'answer', 'operator', base({ ownerAcknowledged: false }))).toEqual(refused('not-acknowledged'));
      expect(next('needs-you', 'answer-recorded', 'operator', base({ ownerAcknowledged: false }))).toEqual(ok('needs-you'));
      expect(next('needs-you', 'hand-back-routed', 'operator', base({ ownerAcknowledged: false, takenFrom: 'routed' }))).toEqual(ok('routed'));
    },
    'guard 6 comes after from, actor and takenFrom': () => {
      expect(next('routed', 'answer', 'operator', base({ ownerAcknowledged: false }))).toEqual(refused('not-from'));
      expect(next('needs-you', 'answer', 'owner', base({ ownerAcknowledged: false }))).toEqual(refused('wrong-actor'));
      expect(next('needs-you', 'answer', 'overlord', base({ ownerAcknowledged: false, answered: false }))).toEqual(refused('not-answered'));
    },

    // Guard 7: an open child ends nothing and hands nothing off.
    'guard 7: close-unowned, drop and escalate with an open child are has-open-children': () => {
      expect(next('received', 'close-unowned', 'server', base({ openChildren: 1, fields: ['closeNote'] }))).toEqual(refused('has-open-children'));
      expect(next('received', 'drop', 'overlord', base({ openChildren: 1, fields: ['closeNote'], reason: 'dropped' }))).toEqual(refused('has-open-children'));
      expect(next('received', 'escalate', 'overlord', base({ openChildren: 3, reason: 'needs-start' }))).toEqual(refused('has-open-children'));
      expect(next('declined', 'escalate', 'overlord', base({ openChildren: 1, reason: 'needs-proposal' }))).toEqual(refused('has-open-children'));
      expect(next('declined', 'drop', 'overlord', base({ openChildren: 1, fields: ['closeNote'], reason: 'dropped' }))).toEqual(refused('has-open-children'));
      expect(next('received', 'close-unowned', 'server', base({ openChildren: 0, fields: ['closeNote'] }))).toEqual(ok('done'));
    },
    'guard 7 comes before the fields and the reason, and after from and actor': () => {
      expect(next('received', 'drop', 'overlord', base({ openChildren: 1 }))).toEqual(refused('has-open-children'));           // no closeNote, no reason
      expect(next('received', 'escalate', 'overlord', base({ openChildren: 1, fields: ['owner'] }))).toEqual(refused('has-open-children'));
      expect(next('routed', 'escalate', 'overlord', base({ openChildren: 1 }))).toEqual(refused('not-from'));
      expect(next('received', 'close-unowned', 'overlord', base({ openChildren: 1 }))).toEqual(refused('wrong-actor'));
    },
    'guard 7 reads the open count only: the other moves answer whatever it holds': () => {
      for (const move of MOVES.filter((x) => !['close-unowned', 'drop', 'escalate', 'open'].includes(x))) {
        const row = ROWS[move];
        const want = ok(row.to);
        expect(next(row.from[0]!, move, row.actor, neutral(move, { openChildren: 4 })), move).toEqual(want);
      }
    },

    // Guard 8: the relay moves on a request that has any child.
    'guard 8: route, re-relay and route-elsewhere on a request with any child are has-children': () => {
      const relay: RequestColumn[] = ['owner', 'doneTest'];
      expect(next('received', 'route', 'overlord', base({ hasChildren: true, fields: relay }))).toEqual(refused('has-children'));
      expect(next('routed', 're-relay', 'overlord', base({ hasChildren: true, fields: relay }))).toEqual(refused('has-children'));
      expect(next('declined', 'route-elsewhere', 'overlord', base({ hasChildren: true, fields: relay }))).toEqual(refused('has-children'));
      expect(next('needs-you', 'route-elsewhere', 'overlord', base({ hasChildren: true, fields: relay }))).toEqual(refused('has-children'));
      expect(next('received', 'route', 'overlord', base({ hasChildren: false, fields: relay }))).toEqual(ok('routed'));
    },
    'guard 8 is the ended children too: hasChildren with no open child still refuses': () => {
      expect(next('received', 'route', 'overlord', base({ hasChildren: true, openChildren: 0 }))).toEqual(refused('has-children'));
    },
    'guard 8 comes after guard 7, and before the fields: a relay with a child and a stray field is has-children': () => {
      expect(next('received', 'route', 'overlord', base({ hasChildren: true, fields: ['closeNote'] }))).toEqual(refused('has-children'));
      expect(next('received', 'route', 'owner', base({ hasChildren: true }))).toEqual(refused('wrong-actor'));
      expect(next('routed', 'route', 'overlord', base({ hasChildren: true }))).toEqual(refused('not-from'));
    },
    'guard 8 is the three relay moves only: every other move answers whatever hasChildren holds': () => {
      for (const move of MOVES.filter((x) => !['route', 're-relay', 'route-elsewhere', 'open'].includes(x))) {
        const row = ROWS[move];
        expect(next(row.from[0]!, move, row.actor, neutral(move, { hasChildren: true })), move).toEqual(ok(row.to));
      }
    },

    // Guard 9: the fields.
    'guard 9: each move may set its own columns and no other': () => {
      for (const move of MOVES.filter((x) => x !== 'open')) {
        const row = ROWS[move];
        for (const col of COLUMNS) {
          const fields = [...new Set<RequestColumn>([...neutral(move).fields, col])];
          const want = FIELDS[move].includes(col) ? ok(row.to) : refused('field-not-allowed');
          expect(next(row.from[0]!, move, row.actor, neutral(move, { fields })), `${move} ${col}`).toEqual(want);
        }
        const all = FIELDS[move];
        expect(next(row.from[0]!, move, row.actor, neutral(move, { fields: all })), `${move} all`).toEqual(ok(row.to));
      }
    },
    'guard 9: a field that is not allowed beside one that is still refuses, and refuses before field-required': () => {
      expect(next('received', 'route', 'overlord', base({ fields: ['owner', 'closeNote'] }))).toEqual(refused('field-not-allowed'));
      expect(next('received', 'drop', 'overlord', base({ fields: ['owner'], reason: 'dropped' }))).toEqual(refused('field-not-allowed')); // lacks closeNote too
      expect(next('received', 'drop', 'overlord', base({ fields: ['closeNote', 'owner'], reason: 'dropped' }))).toEqual(refused('field-not-allowed'));
      expect(next('declined', 'decline', 'owner', base({ fields: [] }))).toEqual(refused('not-from'));
    },
    'guard 9: drop requires closeNote, and no other move requires a field': () => {
      expect(next('received', 'drop', 'overlord', base({ fields: [], reason: 'dropped' }))).toEqual(refused('field-required'));
      expect(next('received', 'drop', 'overlord', base({ fields: ['closeNote'], reason: 'dropped' }))).toEqual(ok('dropped'));
      for (const move of MOVES.filter((x) => x !== 'drop' && x !== 'open')) {
        const row = ROWS[move];
        expect(next(row.from[0]!, move, row.actor, neutral(move, { fields: [] })), move).toEqual(ok(row.to));
      }
    },
    'guard 9 comes before guard 10: a stray field on a move needing a reason is field-not-allowed, a missing close note is field-required': () => {
      expect(next('received', 'escalate', 'overlord', base({ fields: ['owner'], reason: null }))).toEqual(refused('field-not-allowed'));
      expect(next('received', 'drop', 'overlord', base({ fields: [], reason: null }))).toEqual(refused('field-required'));
    },

    // Guard 10: the reasons.
    'guard 10: a move with reasons must carry one of them': () => {
      for (const move of MOVES.filter((x) => reasonsOf(x).length > 0)) {
        const row = ROWS[move];
        expect(next(row.from[0]!, move, row.actor, neutral(move, { reason: null })), `${move} none`).toEqual(refused('reason-required'));
      }
    },
    'guard 10: a reason outside the move\'s words is reason-not-allowed, for every move and every word': () => {
      for (const move of MOVES.filter((x) => x !== 'open')) {
        const row = ROWS[move];
        for (const word of REASON_WORDS) {
          const want = REASONS[word].includes(move) ? ok(row.to) : refused('reason-not-allowed');
          expect(next(row.from[0]!, move, row.actor, neutral(move, { reason: word })), `${move} ${word}`).toEqual(want);
        }
      }
    },
    'guard 10: a move with no reasons given any reason is reason-not-allowed, and without one it is ok': () => {
      expect(next('routed', 'acknowledge', 'owner', base({ reason: 'impossible' }))).toEqual(refused('reason-not-allowed'));
      expect(next('routed', 'acknowledge', 'owner', base({ reason: null }))).toEqual(ok('in-progress'));
      expect(next('needs-you', 'answer-recorded', 'operator', base({ reason: 'restore' }))).toEqual(refused('reason-not-allowed'));
      expect(next('received', 'route', 'overlord', base({ reason: 'dropped' }))).toEqual(refused('reason-not-allowed'));
    },
    'guard 10: the escalate door\'s three reasons, and the decline door\'s four': () => {
      for (const r of ['needs-start', 'needs-proposal', 'unnamed-widening'] as const) {
        expect(next('received', 'escalate', 'overlord', base({ reason: r })), r).toEqual(ok('needs-you'));
      }
      for (const r of ['outside-goals', 'goal-conflict', 'impossible', 'duplicate'] as const) {
        expect(next('routed', 'decline', 'owner', base({ reason: r })), r).toEqual(ok('declined'));
      }
      expect(next('received', 'escalate', 'overlord', base({ reason: 'impossible' }))).toEqual(refused('reason-not-allowed'));
    },

    // Every guard's own message at the end of the order.
    'a valid move carries nothing else: it answers ok with the row\'s `to`': () => {
      expect(next('received', 'route', 'overlord', base({ fields: ['owner', 'doneTest', 'expectedPaths'] }))).toEqual(ok('routed'));
      expect(next('in-progress', 'block', 'owner', base({ fields: ['dependsOn'] }))).toEqual(ok('blocked'));
      expect(next('routed', 'counter', 'owner', base({ fields: ['counters'] }))).toEqual(ok('routed'));
      expect(next('done-unverified', 'confirm', 'operator', base({ fields: ['closeNote'] }))).toEqual(ok('done'));
    },

    // Monotonicity: a worse fact never turns a refusal into an ok.
    'monotonicity: answered to false, ownerAcknowledged to false, openChildren up and hasChildren to true never turn a refusal into ok': () => {
      let seen = 0;
      const escaped: string[] = [];
      const worse: readonly ((c: Ctx) => Ctx)[] = [
        (c) => ({ ...c, answered: false }), (c) => ({ ...c, ownerAcknowledged: false }),
        (c) => ({ ...c, openChildren: c.openChildren + 1 }), (c) => ({ ...c, hasChildren: true }),
      ];
      for (const answered of [true, false]) {
        for (const takenFrom of [null, 'routed', 'in-progress', 'blocked'] as const) {
          for (const ownerAcknowledged of [true, false]) {
            for (const openChildren of [0, 2]) {
              for (const hasChildren of [false, true]) {
                for (const fields of [[], ['closeNote']] as RequestColumn[][]) {
                  for (const reason of [null, 'dropped', 'needs-start', 'impossible'] as const) {
                    const ctx: Ctx = { answered, takenFrom, ownerAcknowledged, openChildren, hasChildren, fields, reason };
                    for (const state of STATES) {
                      for (const move of MOVES) {
                        for (const actor of ACTORS) {
                          const was = next(state, move, actor, ctx);
                          if (was.ok) continue;
                          for (const w of worse) {
                            if (next(state, move, actor, w(ctx)).ok) escaped.push(`${state} ${move} ${actor} ${JSON.stringify(ctx)}`);
                            seen++;
                          }
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
      expect(escaped.slice(0, 5)).toEqual([]);
      expect(seen).toBeGreaterThan(100_000);
    },
    'monotonicity: each worse fact does turn some ok into a refusal (the property is not vacuous)': () => {
      expect(next('needs-you', 'drop', 'overlord', base({ answered: true, fields: ['closeNote'], reason: 'dropped' })).ok).toBe(true);
      expect(next('needs-you', 'drop', 'overlord', base({ answered: false, fields: ['closeNote'], reason: 'dropped' })).ok).toBe(false);
      expect(next('needs-you', 'answer', 'operator', base({ ownerAcknowledged: true })).ok).toBe(true);
      expect(next('needs-you', 'answer', 'operator', base({ ownerAcknowledged: false })).ok).toBe(false);
      expect(next('received', 'escalate', 'overlord', base({ openChildren: 0, reason: 'needs-start' })).ok).toBe(true);
      expect(next('received', 'escalate', 'overlord', base({ openChildren: 1, reason: 'needs-start' })).ok).toBe(false);
      expect(next('received', 'route', 'overlord', base({ hasChildren: false })).ok).toBe(true);
      expect(next('received', 'route', 'overlord', base({ hasChildren: true })).ok).toBe(false);
    },
  };
}

// ------------------------------------------------------------------------------------------------------------- openMoveVerdict

export function openMoveVerdictCases(m: M): Record<string, SuiteCase> {
  return {
    'the Overlord opens a request, which is received; no other actor may': () => {
      expect(m.openMoveVerdict('overlord')).toEqual({ ok: true, to: 'received' });
      for (const actor of ['owner', 'server', 'operator'] as const) expect(m.openMoveVerdict(actor), actor).toEqual({ ok: false, why: 'wrong-actor' });
    },
  };
}

// ---------------------------------------------------------------------------------------------------------- followUpAfterMove

const CLOCKED: readonly RequestState[] = ['received', 'routed', 'in-progress', 'declined'];

export function followUpAfterMoveCases(m: M): Record<string, SuiteCase> {
  const at = NOW;
  return {
    'every target state, with and without a promise: a clocked state gets an hour on or the promise, every other none': () => {
      for (const to of STATES) {
        expect(m.followUpAfterMove({ to, openChildren: 0, at, promiseAt: null }), `${to} no promise`).toBe(CLOCKED.includes(to) ? at + HOUR : null);
        expect(m.followUpAfterMove({ to, openChildren: 0, at, promiseAt: at + 5_000 }), `${to} promise`).toBe(CLOCKED.includes(to) ? at + 5_000 : null);
      }
    },
    'a parent with an open child has no clock, whatever its state and promise': () => {
      for (const to of STATES) {
        for (const openChildren of [1, 2]) {
          for (const promiseAt of [null, at + 5_000]) expect(m.followUpAfterMove({ to, openChildren, at, promiseAt }), `${to} ${openChildren}`).toBeNull();
        }
      }
    },
    'the clock is an hour on from the move\'s own time, and a promise of zero is a promise': () => {
      expect(m.followUpAfterMove({ to: 'routed', openChildren: 0, at: 1_000, promiseAt: null })).toBe(1_000 + HOUR);
      expect(m.followUpAfterMove({ to: 'received', openChildren: 0, at: 0, promiseAt: null })).toBe(HOUR);
      expect(m.followUpAfterMove({ to: 'received', openChildren: 0, at: 1_000, promiseAt: 0 })).toBe(0);
    },
    'needs-you, done-unverified, blocked and the terminal states carry no clock even with a promise': () => {
      for (const to of ['needs-you', 'done-unverified', 'blocked', 'done', 'failed', 'dropped'] as const) {
        expect(m.followUpAfterMove({ to, openChildren: 0, at, promiseAt: at + 1 }), to).toBeNull();
      }
    },
  };
}

// ----------------------------------------------------------------------------------------------------- parentClockAfterChildMove

export function parentClockAfterChildMoveCases(m: M): Record<string, SuiteCase> {
  return {
    'a parent left with no open child in a clocked state gets an hour on; every other parent state none': () => {
      for (const parentState of STATES) {
        expect(m.parentClockAfterChildMove({ parentState, openChildrenAfter: 0, at: NOW }), parentState).toBe(CLOCKED.includes(parentState) ? NOW + HOUR : null);
      }
    },
    'a parent that still has an open child gets none, in every state': () => {
      for (const parentState of STATES) {
        for (const openChildrenAfter of [1, 2, 7]) expect(m.parentClockAfterChildMove({ parentState, openChildrenAfter, at: NOW }), `${parentState} ${openChildrenAfter}`).toBeNull();
      }
    },
    'the clock is an hour on from the child move\'s time': () => {
      expect(m.parentClockAfterChildMove({ parentState: 'in-progress', openChildrenAfter: 0, at: 5_000 })).toBe(5_000 + HOUR);
      expect(m.parentClockAfterChildMove({ parentState: 'received', openChildrenAfter: 0, at: 0 })).toBe(HOUR);
    },
  };
}

// ------------------------------------------------------------------------------------------------------- answeredSinceNeedsYou

type Moves = Parameters<M['answeredSinceNeedsYou']>[0];
const mv = (move: string, toState: string): Moves[number] => ({ move, toState });
const ENTER = mv('needs-you', 'needs-you');
const ANSWER = mv('answer-recorded', 'needs-you');

export function answeredSinceNeedsYouCases(m: M): Record<string, SuiteCase> {
  const a = m.answeredSinceNeedsYou;
  return {
    'no moves, and moves that never entered needs-you, answer false': () => {
      expect(a([])).toBe(false);
      expect(a([mv('open', 'received'), mv('route', 'routed'), mv('acknowledge', 'in-progress')])).toBe(false);
      expect(a([ANSWER])).toBe(false);
      expect(a([ANSWER, ANSWER])).toBe(false);
    },
    'an entry with no answer after it is false; an answer after the last entry is true': () => {
      expect(a([mv('open', 'received'), mv('escalate', 'needs-you')])).toBe(false);
      expect(a([mv('open', 'received'), mv('escalate', 'needs-you'), ANSWER])).toBe(true);
      expect(a([mv('routed', 'routed'), mv('acknowledge', 'in-progress'), mv('take', 'needs-you'), ANSWER])).toBe(true);
      expect(a([mv('acknowledge', 'in-progress'), ENTER, ANSWER])).toBe(true);
    },
    'each entering move is an entry: escalate, needs-you and take': () => {
      for (const word of ['escalate', 'needs-you', 'take']) {
        expect(a([mv(word, 'needs-you')]), word).toBe(false);
        expect(a([mv(word, 'needs-you'), ANSWER]), word).toBe(true);
        expect(a([mv(word, 'needs-you'), ANSWER, mv(word, 'needs-you')]), word).toBe(false);
      }
    },
    'a move entering needs-you after an answer withdraws it, and a later answer gives it back (F9)': () => {
      expect(a([ENTER, ANSWER, mv('take', 'needs-you')])).toBe(false);
      expect(a([ENTER, ANSWER, mv('take', 'needs-you'), ANSWER])).toBe(true);
      expect(a([ENTER, ANSWER, ENTER, ANSWER, ENTER])).toBe(false);
    },
    'the answer-recorded self-loop is never an entry: a second answer leaves it answered': () => {
      expect(a([ENTER, ANSWER, ANSWER])).toBe(true);
      expect(a([ENTER, ANSWER, mv('answer-recorded', 'needs-you'), ANSWER])).toBe(true);
    },
    'an entry is read by its move word, not by the toState it carries': () => {
      expect(a([mv('escalate', 'received'), ANSWER])).toBe(true);
      expect(a([ENTER, ANSWER, mv('take', 'routed')])).toBe(false);
      expect(a([mv('route', 'needs-you')])).toBe(false);
      // a known move that does not enter, even when its toState says needs-you, is not an entry
      expect(a([ENTER, ANSWER, mv('answer-recorded', 'needs-you')])).toBe(true);
    },
    'a move word this build does not know that reached needs-you is an entry (fail closed); one that did not is not': () => {
      expect(a([ENTER, ANSWER, mv('a-later-move', 'needs-you')])).toBe(false);
      expect(a([ENTER, ANSWER, mv('a-later-move', 'routed')])).toBe(true);
      expect(a([mv('a-later-move', 'needs-you'), ANSWER])).toBe(true);
      expect(a([mv('a-later-move', 'needs-you')])).toBe(false);
      expect(a([mv('a-later-move', 'routed'), ANSWER])).toBe(false);
      expect(a([mv('', 'needs-you')])).toBe(false);
      expect(a([ENTER, ANSWER, mv('constructor', 'needs-you')])).toBe(false);
    },
    'only an answer-recorded answers: another known move after an entry, whatever its toState, does not': () => {
      expect(a([ENTER, mv('acknowledge', 'in-progress')])).toBe(false);
      expect(a([ENTER, mv('route', 'needs-you')])).toBe(false);
      expect(a([ENTER, mv('answer', 'in-progress')])).toBe(false);
      expect(a([ENTER, mv('a-later-move', 'needs-you')])).toBe(false);
    },
    'moves that leave needs-you or do not touch it are not entries': () => {
      expect(a([ENTER, ANSWER, mv('acknowledge', 'in-progress')])).toBe(true);
      expect(a([ENTER, ANSWER, mv('route-elsewhere', 'routed')])).toBe(true);
    },
  };
}

// ---------------------------------------------------------------------------------------------------------- closeUnownedVerdict

export function closeUnownedVerdictCases(m: M): Record<string, SuiteCase> {
  const v = m.closeUnownedVerdict;
  return {
    'the act kinds that leave a request closable are its own open-request': () => {
      expect([...m.CLOSE_UNOWNED_ACT_KINDS]).toEqual(['open-request']);
    },
    'a received request with no child and only its own open-request closes': () => {
      expect(v({ state: 'received', actKindsOnIt: [], openChildren: 0 })).toBe('allow');
      expect(v({ state: 'received', actKindsOnIt: ['open-request'], openChildren: 0 })).toBe('allow');
      expect(v({ state: 'received', actKindsOnIt: ['open-request', 'open-request'], openChildren: 0 })).toBe('allow');
    },
    'any other state is not-received, before children and acts are read': () => {
      for (const state of STATES.filter((s) => s !== 'received')) {
        expect(v({ state, actKindsOnIt: [], openChildren: 0 }), state).toBe('not-received');
        expect(v({ state, actKindsOnIt: ['relay'], openChildren: 2 }), `${state} both`).toBe('not-received');
      }
    },
    'an open child is has-open-children, before the acts are read': () => {
      expect(v({ state: 'received', actKindsOnIt: [], openChildren: 1 })).toBe('has-open-children');
      expect(v({ state: 'received', actKindsOnIt: ['open-request'], openChildren: 5 })).toBe('has-open-children');
      expect(v({ state: 'received', actKindsOnIt: ['relay'], openChildren: 1 })).toBe('has-open-children');
    },
    'an act that is not the request\'s own open is has-acts, wherever it stands in the list': () => {
      expect(v({ state: 'received', actKindsOnIt: ['relay'], openChildren: 0 })).toBe('has-acts');
      expect(v({ state: 'received', actKindsOnIt: ['open-request', 'relay'], openChildren: 0 })).toBe('has-acts');
      expect(v({ state: 'received', actKindsOnIt: ['relay', 'open-request'], openChildren: 0 })).toBe('has-acts');
      expect(v({ state: 'received', actKindsOnIt: ['open-request', 'open-request', 'drop-request'], openChildren: 0 })).toBe('has-acts');
      expect(v({ state: 'received', actKindsOnIt: [''], openChildren: 0 })).toBe('has-acts');
    },
  };
}

// ------------------------------------------------------------------------------------------------------------- citationVerdict

type CiteInput = Parameters<M['citationVerdict']>[0];
const okFact = (over: Partial<Extract<Fact, { read: 'ok' }>> = {}): Fact =>
  ({ read: 'ok', state: 'recorded', at: NOW - HOUR, sha256: 'h', hashMatches: true, ...over });
const facts = (entries: readonly (readonly [number, Fact])[]): ReadonlyMap<number, Fact> => new Map(entries);
const cite = (over: Partial<CiteInput>): CiteInput => ({ root: true, rootCites: null, now: NOW, ids: [], facts: new Map(), ...over });
const refusal = (word: string, detail: string, id: number | null, why: string | null = null) => ({ kind: 'refused', word, detail, id, why });

export function citationVerdictCases(m: M): Record<string, SuiteCase> {
  const v = m.citationVerdict;
  return {
    'no ids is ok with no cites, for a root and a child': () => {
      expect(v(cite({}))).toEqual({ kind: 'ok', cites: [] });
      expect(v(cite({ root: false, rootCites: new Set() }))).toEqual({ kind: 'ok', cites: [] });
    },
    'row 1: more than eight ids is too-large, before any repeat or read': () => {
      const ids = [1, 2, 3, 4, 5, 6, 7, 8, 9];
      expect(v(cite({ ids }))).toEqual(refusal('too-large', 'too-many', null));
      expect(v(cite({ ids: [1, 1, 1, 1, 1, 1, 1, 1, 1] }))).toEqual(refusal('too-large', 'too-many', null));
      expect(v(cite({ root: false, ids }))).toEqual(refusal('too-large', 'too-many', null));
    },
    'row 1: exactly eight ids is within the bound': () => {
      const ids = [1, 2, 3, 4, 5, 6, 7, 8];
      const r = v(cite({ ids, facts: facts(ids.map((i) => [i, okFact({ sha256: `h${i}` })] as const)) }));
      expect(r).toEqual({ kind: 'ok', cites: ids.map((i) => ({ messageId: i, sha256: `h${i}`, root: true })) });
    },
    'row 2: a repeated id is bad-request naming it, before any read': () => {
      expect(v(cite({ ids: [4, 5, 4] }))).toEqual(refusal('bad-request', 'repeated', 4));
      expect(v(cite({ ids: [4, 4] }))).toEqual(refusal('bad-request', 'repeated', 4));
      expect(v(cite({ ids: [1, 2, 3, 2, 1] }))).toEqual(refusal('bad-request', 'repeated', 2));
      expect(v(cite({ ids: [7, 7], facts: facts([[7, { read: 'unmeasured', why: 'x' }]]) }))).toEqual(refusal('bad-request', 'repeated', 7));
    },
    'row 3: an unmeasured read is unmeasured with its reason, never absent': () => {
      expect(v(cite({ ids: [1, 2], facts: facts([[1, okFact()], [2, { read: 'unmeasured', why: 'store busy' }]]) })))
        .toEqual(refusal('unmeasured', 'unread', 2, 'store busy'));
      expect(v(cite({ ids: [1], facts: facts([[1, { read: 'unmeasured', why: 'locked' }]]) }))).toEqual(refusal('unmeasured', 'unread', 1, 'locked'));
    },
    'row 3: an id with no fact at all is unmeasured too, never absent': () => {
      const r = v(cite({ ids: [1, 2], facts: facts([[1, okFact()]]) }));
      expect(r).toMatchObject({ kind: 'refused', word: 'unmeasured', detail: 'unread', id: 2 });
      expect(typeof (r as { why: unknown }).why).toBe('string');
      expect(v(cite({ ids: [9], facts: new Map() }))).toMatchObject({ word: 'unmeasured', detail: 'unread', id: 9 });
    },
    'row 3 comes before row 4: an unmeasured id after an absent one still answers unmeasured, and the other way round': () => {
      expect(v(cite({ ids: [1, 2], facts: facts([[1, { read: 'absent' }], [2, { read: 'unmeasured', why: 'x' }]]) })))
        .toEqual(refusal('unmeasured', 'unread', 2, 'x'));
      expect(v(cite({ ids: [1, 2], facts: facts([[1, { read: 'unmeasured', why: 'y' }], [2, { read: 'absent' }]]) })))
        .toEqual(refusal('unmeasured', 'unread', 1, 'y'));
    },
    'row 4: an absent id is said-not-operator absent, naming the first, and before a changed hash': () => {
      expect(v(cite({ ids: [1, 2], facts: facts([[1, okFact()], [2, { read: 'absent' }]]) }))).toEqual(refusal('said-not-operator', 'absent', 2));
      expect(v(cite({ ids: [1, 2, 3], facts: facts([[1, okFact()], [2, { read: 'absent' }], [3, { read: 'absent' }]]) })))
        .toEqual(refusal('said-not-operator', 'absent', 2));
      // rule-major: an earlier changed id does not hide a later absent one
      expect(v(cite({ ids: [1, 2], facts: facts([[1, okFact({ hashMatches: false })], [2, { read: 'absent' }]]) })))
        .toEqual(refusal('said-not-operator', 'absent', 2));
    },
    'row 5: a hash that no longer matches is changed, before the spent and window rows': () => {
      expect(v(cite({ ids: [1], facts: facts([[1, okFact({ hashMatches: false })]]) }))).toEqual(refusal('said-not-operator', 'changed', 1));
      expect(v(cite({ ids: [1, 2], facts: facts([[1, okFact({ state: 'spent' })], [2, okFact({ hashMatches: false })]]) })))
        .toEqual(refusal('said-not-operator', 'changed', 2));
      expect(v(cite({ ids: [1, 2], facts: facts([[1, okFact({ at: 0 })], [2, okFact({ hashMatches: false })]]) })))
        .toEqual(refusal('said-not-operator', 'changed', 2));
      expect(v(cite({ root: false, rootCites: new Set(), ids: [1], facts: facts([[1, okFact({ hashMatches: false })]]) })))
        .toEqual(refusal('said-not-operator', 'changed', 1));
    },
    'row 6: a root request citing a spent row is said-not-operator spent; a child does not read the state': () => {
      expect(v(cite({ ids: [1], facts: facts([[1, okFact({ state: 'spent' })]]) }))).toEqual(refusal('said-not-operator', 'spent', 1));
      expect(v(cite({ ids: [1, 2], facts: facts([[1, okFact()], [2, okFact({ state: 'spent' })]]) }))).toEqual(refusal('said-not-operator', 'spent', 2));
      expect(v(cite({ root: false, rootCites: new Set([1]), ids: [1], facts: facts([[1, okFact({ state: 'spent' })]]) })))
        .toEqual({ kind: 'ok', cites: [{ messageId: 1, sha256: 'h', root: false }] });
    },
    'row 7: a root request citing a row older than 24 hours is spent by its age; exactly 24 hours is still ok': () => {
      const day = 24 * HOUR;
      expect(v(cite({ ids: [1], facts: facts([[1, okFact({ at: NOW - day })]]) }))).toEqual({ kind: 'ok', cites: [{ messageId: 1, sha256: 'h', root: true }] });
      expect(v(cite({ ids: [1], facts: facts([[1, okFact({ at: NOW - day - 1 })]]) }))).toEqual(refusal('said-not-operator', 'spent', 1));
      expect(v(cite({ ids: [1], facts: facts([[1, okFact({ at: NOW - day + 1 })]]) }))).toEqual({ kind: 'ok', cites: [{ messageId: 1, sha256: 'h', root: true }] });
      expect(v(cite({ ids: [1], facts: facts([[1, okFact({ at: NOW + HOUR })]]) }))).toEqual({ kind: 'ok', cites: [{ messageId: 1, sha256: 'h', root: true }] });
    },
    'row 7: a child is not bound by the window': () => {
      expect(v(cite({ root: false, rootCites: new Set([1]), ids: [1], facts: facts([[1, okFact({ at: 0 })]]) })))
        .toEqual({ kind: 'ok', cites: [{ messageId: 1, sha256: 'h', root: false }] });
    },
    'rows 6 and 7 are read one after the other across the ids: the spent state is checked on every id before the window': () => {
      expect(v(cite({ ids: [1, 2], facts: facts([[1, okFact({ at: 0 })], [2, okFact({ state: 'spent' })]]) }))).toEqual(refusal('said-not-operator', 'spent', 2));
      expect(v(cite({ ids: [1, 2], facts: facts([[1, okFact()], [2, okFact({ at: 0 })]]) }))).toEqual(refusal('said-not-operator', 'spent', 2));
    },
    'row 8: a child citing an id its root does not cite is not-in-root; a null root list cites nothing': () => {
      expect(v(cite({ root: false, rootCites: new Set([1]), ids: [1, 2], facts: facts([[1, okFact()], [2, okFact()]]) }))).toEqual(refusal('said-not-operator', 'not-in-root', 2));
      expect(v(cite({ root: false, rootCites: null, ids: [1], facts: facts([[1, okFact()]]) }))).toEqual(refusal('said-not-operator', 'not-in-root', 1));
      expect(v(cite({ root: false, rootCites: new Set(), ids: [1], facts: facts([[1, okFact()]]) }))).toEqual(refusal('said-not-operator', 'not-in-root', 1));
      expect(v(cite({ root: false, rootCites: new Set([1, 2, 3]), ids: [3, 1], facts: facts([[1, okFact({ sha256: 'a' })], [3, okFact({ sha256: 'c' })]]) })))
        .toEqual({ kind: 'ok', cites: [{ messageId: 3, sha256: 'c', root: false }, { messageId: 1, sha256: 'a', root: false }] });
    },
    'row 8 is a child\'s only: a root request ignores the root list': () => {
      expect(v(cite({ root: true, rootCites: new Set(), ids: [1], facts: facts([[1, okFact()]]) }))).toEqual({ kind: 'ok', cites: [{ messageId: 1, sha256: 'h', root: true }] });
      expect(v(cite({ root: true, rootCites: null, ids: [1], facts: facts([[1, okFact()]]) }))).toEqual({ kind: 'ok', cites: [{ messageId: 1, sha256: 'h', root: true }] });
    },
    'the ok answer carries each id\'s stored hash and the root flag, in the order given': () => {
      expect(v(cite({ ids: [5, 2, 9], facts: facts([[2, okFact({ sha256: 'b' })], [5, okFact({ sha256: 'a' })], [9, okFact({ sha256: 'c' })]]) })))
        .toEqual({ kind: 'ok', cites: [{ messageId: 5, sha256: 'a', root: true }, { messageId: 2, sha256: 'b', root: true }, { messageId: 9, sha256: 'c', root: true }] });
    },
    'a fact for an id that is not cited is ignored': () => {
      expect(v(cite({ ids: [1], facts: facts([[1, okFact()], [2, { read: 'absent' }], [3, { read: 'unmeasured', why: 'x' }]]) })))
        .toEqual({ kind: 'ok', cites: [{ messageId: 1, sha256: 'h', root: true }] });
    },
    'rule-major: each row is read across every id before the next row': () => {
      // id 1 would be refused by row 8 (a child, not in root), id 2 by row 4: row 4 comes first
      expect(v(cite({ root: false, rootCites: new Set(), ids: [1, 2], facts: facts([[1, okFact()], [2, { read: 'absent' }]]) })))
        .toEqual(refusal('said-not-operator', 'absent', 2));
      // id 1 would be refused by row 7, id 2 by row 5: row 5 comes first
      expect(v(cite({ ids: [1, 2], facts: facts([[1, okFact({ at: 0 })], [2, okFact({ hashMatches: false })]]) }))).toEqual(refusal('said-not-operator', 'changed', 2));
    },
  };
}

// ----------------------------------------------------------------------------------------------------------------- nextRequestId

export function nextRequestIdCases(m: M): Record<string, SuiteCase> {
  return {
    'both nulls answer one; either null answers one past the other; both known answer one past the larger': () => {
      expect(m.nextRequestId(null, null)).toBe(1);
      expect(m.nextRequestId(7, null)).toBe(8);
      expect(m.nextRequestId(null, 7)).toBe(8);
      expect(m.nextRequestId(3, 9)).toBe(10);
      expect(m.nextRequestId(9, 3)).toBe(10);
      expect(m.nextRequestId(5, 5)).toBe(6);
      expect(m.nextRequestId(0, null)).toBe(1);
      expect(m.nextRequestId(null, 0)).toBe(1);
    },
  };
}
