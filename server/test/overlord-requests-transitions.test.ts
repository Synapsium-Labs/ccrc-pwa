// The request record's vocabulary and `REQUEST_TRANSITIONS` (Overlord W2 request record plan, Task A1; Table 4 and §5.1). L0, so
// pure: the expected table below is spelled out here once, independently of the table it checks, and compared row by row.
import { describe, expect, it } from 'vitest';
import {
  ESCALATE_REASONS, OPEN_REQUEST_STATES, REQUEST_ACTORS, REQUEST_ACTOR_SEQUENCE_KIND, REQUEST_BOUNDS, REQUEST_CITATION_DETAILS,
  REQUEST_COLUMNS, REQUEST_MOVES, isRequestCitationDetail,
  REQUEST_MOVE_FIELDS, REQUEST_MOVE_REASONS, REQUEST_MOVE_REASON_MAP, REQUEST_MOVE_REQUIRED_FIELDS, REQUEST_NEXT_MOVE_MS,
  REQUEST_ORIGINS, REQUEST_STATES, REQUEST_TRANSITIONS, ROOT_FOUND_WINDOW_MS, SHORTLIST_MAX, TERMINAL_REQUEST_STATES,
  UNCLOCKED_REQUEST_STATES, isRequestMove, isRequestMoveReason, isRequestState, isTerminalRequestState, reasonsOfMove,
  requestMoveEntersNeedsYou, requestTransition, transitionEntersNeedsYou,
  type RequestActor, type RequestColumn, type RequestMove, type RequestMoveReason, type RequestState,
} from '../../shared/overlordRequests.js';
import { ACTOR_KINDS } from '../../shared/overlord-identity.js';

type Row = { actor: RequestActor; from: readonly RequestState[]; to: RequestState };

// Table 4 of the plan, spelled out independently of the table.
const EXPECTED: Record<RequestMove, Row> = {
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
  'needs-you': { actor: 'server', from: ['received', 'routed', 'in-progress', 'blocked', 'declined'], to: 'needs-you' },
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

const EXPECTED_STATES: readonly RequestState[] = [
  'received', 'routed', 'in-progress', 'blocked', 'declined', 'needs-you', 'done-unverified', 'done', 'failed', 'dropped',
];
const EXPECTED_MOVES = Object.keys(EXPECTED) as RequestMove[];

// The reason words, spelled out independently of the map (each with its moves, in the map's order).
const EXPECTED_REASONS: Record<RequestMoveReason, readonly RequestMove[]> = {
  'needs-start': ['escalate'], 'needs-proposal': ['escalate'], 'unnamed-widening': ['escalate'], dropped: ['drop'],
  'outside-goals': ['decline'], 'goal-conflict': ['decline'], impossible: ['decline'], duplicate: ['decline'],
  'two-counters': ['needs-you'], 'two-silent-nudges': ['needs-you'], 'due-unarmed': ['needs-you'], 'off-before-ack': ['needs-you'],
  'off-after-decline': ['needs-you'], restore: ['needs-you'], 'child-ended': ['needs-you'], 'dependency-ended': ['needs-you'],
  'operator-took-it': ['take'],
};

describe('vocabulary', () => {
  it('lists the ten states, the four actors, the two origins and the six columns', () => {
    expect([...REQUEST_STATES]).toEqual(EXPECTED_STATES);
    expect([...REQUEST_ACTORS]).toEqual(['overlord', 'owner', 'server', 'operator']);
    expect([...REQUEST_ORIGINS]).toEqual(['operator', 'overlord']);
    expect([...REQUEST_COLUMNS]).toEqual(['owner', 'doneTest', 'expectedPaths', 'dependsOn', 'takenFrom', 'closeNote', 'counters']);
  });

  it('the guards recognise exactly their own words', () => {
    for (const s of EXPECTED_STATES) expect(isRequestState(s), s).toBe(true);
    for (const m of EXPECTED_MOVES) expect(isRequestMove(m), m).toBe(true);
    for (const v of ['', 'Received', 'toString', 'constructor', '__proto__', 'hasOwnProperty', 'gone', null, undefined, 3]) {
      expect(isRequestState(v), String(v)).toBe(false);
      expect(isRequestMove(v), String(v)).toBe(false);
      expect(isRequestMoveReason(v), String(v)).toBe(false);
    }
  });

  it('the sequence actor kind is total over the actors and names a known kind', () => {
    expect(Object.keys(REQUEST_ACTOR_SEQUENCE_KIND).sort()).toEqual([...REQUEST_ACTORS].sort());
    expect(REQUEST_ACTOR_SEQUENCE_KIND).toEqual({ overlord: 'session', owner: 'session', server: 'server', operator: 'operator' });
    for (const a of REQUEST_ACTORS) expect(ACTOR_KINDS, a).toContain(REQUEST_ACTOR_SEQUENCE_KIND[a]);
  });

  it('exports the bounds and the windows with the plan\'s values', () => {
    expect(REQUEST_BOUNDS).toEqual({ cites: 8, summaryChars: 200, expectedPaths: 32, pathBytes: 512, consulted: 6, closeNoteChars: 600 });
    expect(ROOT_FOUND_WINDOW_MS).toBe(24 * 3_600_000);
    expect(REQUEST_NEXT_MOVE_MS).toBe(3_600_000);
    expect(SHORTLIST_MAX).toBe(6);
  });
});

describe('Table 4, REQUEST_TRANSITIONS', () => {
  it('has exactly the plan\'s moves, in its order', () => {
    expect([...REQUEST_MOVES]).toEqual(EXPECTED_MOVES);
    expect(Object.keys(REQUEST_TRANSITIONS)).toEqual(EXPECTED_MOVES);
  });

  it('every row equals its independently spelled row', () => {
    for (const move of EXPECTED_MOVES) {
      expect(REQUEST_TRANSITIONS[move], move).toEqual(EXPECTED[move]);
      expect(requestTransition(move), move).toEqual(EXPECTED[move]);
    }
  });

  it('every state a row names is a state, and every actor is an actor', () => {
    for (const move of EXPECTED_MOVES) {
      const row = REQUEST_TRANSITIONS[move];
      expect(REQUEST_STATES, move).toContain(row.to);
      for (const s of row.from) expect(REQUEST_STATES, move).toContain(s);
      expect(REQUEST_ACTORS, move).toContain(row.actor);
    }
  });

  it('derives the open and the terminal states, and the terminal ones are the three §5.1 lists', () => {
    expect([...TERMINAL_REQUEST_STATES]).toEqual(['done', 'failed', 'dropped']);
    expect([...OPEN_REQUEST_STATES]).toEqual(['received', 'routed', 'in-progress', 'blocked', 'declined', 'needs-you', 'done-unverified']);
    for (const s of EXPECTED_STATES) expect(isTerminalRequestState(s), s).toBe(TERMINAL_REQUEST_STATES.includes(s));
    expect([...OPEN_REQUEST_STATES, ...TERMINAL_REQUEST_STATES].sort()).toEqual([...EXPECTED_STATES].sort());
  });

  it('every open state has an exit, no terminal state has one, and exactly one row (open) has an empty `from`', () => {
    for (const s of OPEN_REQUEST_STATES) {
      expect(EXPECTED_MOVES.some((m) => EXPECTED[m].from.includes(s)), s).toBe(true);
    }
    for (const s of TERMINAL_REQUEST_STATES) {
      expect(EXPECTED_MOVES.some((m) => EXPECTED[m].from.includes(s)), s).toBe(false);
    }
    expect(EXPECTED_MOVES.filter((m) => REQUEST_TRANSITIONS[m].from.length === 0)).toEqual(['open']);
  });

  it('hand back is three rows, each from needs-you, one to each of routed, in-progress and blocked', () => {
    const rows = EXPECTED_MOVES.filter((m) => m.startsWith('hand-back-'));
    expect(rows).toEqual(['hand-back-routed', 'hand-back-in-progress', 'hand-back-blocked']);
    for (const m of rows) expect(REQUEST_TRANSITIONS[m].from, m).toEqual(['needs-you']);
    expect(rows.map((m) => REQUEST_TRANSITIONS[m].to)).toEqual(['routed', 'in-progress', 'blocked']);
  });

  it('close and close-unverified are separate rows with different targets', () => {
    expect(REQUEST_TRANSITIONS.close.to).toBe('done');
    expect(REQUEST_TRANSITIONS['close-unverified'].to).toBe('done-unverified');
    expect(REQUEST_TRANSITIONS.close).not.toEqual(REQUEST_TRANSITIONS['close-unverified']);
  });

  it('withdraw\'s `from` equals the derived open states, so a new open state cannot miss it', () => {
    expect([...REQUEST_TRANSITIONS.withdraw.from]).toEqual([...OPEN_REQUEST_STATES]);
  });

  it('the unclocked states are needs-you, done-unverified and blocked, and every one is open', () => {
    expect([...UNCLOCKED_REQUEST_STATES].sort()).toEqual(['blocked', 'done-unverified', 'needs-you']);
    for (const s of UNCLOCKED_REQUEST_STATES) expect(OPEN_REQUEST_STATES, s).toContain(s);
  });
});

describe('what a move enters', () => {
  it('a move enters needs-you when it reaches it from another state, and answer-recorded does not', () => {
    const entering: RequestMove[] = ['escalate', 'needs-you', 'take'];
    expect(REQUEST_MOVES.filter((m) => requestMoveEntersNeedsYou(m))).toEqual(entering);
    expect(requestMoveEntersNeedsYou('answer-recorded')).toBe(false);
    // by the rule, not by a list: every row that reaches needs-you from a state other than needs-you
    for (const m of EXPECTED_MOVES) {
      const row = EXPECTED[m];
      expect(requestMoveEntersNeedsYou(m), m).toBe(row.to === 'needs-you' && row.from.some((s) => s !== 'needs-you'));
    }
  });
});

describe('transitionEntersNeedsYou, the one rule on a row', () => {
  it('a synthetic row that reaches needs-you from another state as well as from needs-you enters', () => {
    expect(transitionEntersNeedsYou({ actor: 'server', from: ['received', 'needs-you'], to: 'needs-you' })).toBe(true);
    expect(transitionEntersNeedsYou({ actor: 'server', from: ['routed'], to: 'needs-you' })).toBe(true);
  });

  it('the answer-recorded row, a pure self-loop, does not enter; nor does a row to another state or an empty one', () => {
    expect(transitionEntersNeedsYou(REQUEST_TRANSITIONS['answer-recorded'])).toBe(false);
    expect(transitionEntersNeedsYou({ actor: 'operator', from: ['needs-you'], to: 'needs-you' })).toBe(false);
    expect(transitionEntersNeedsYou({ actor: 'server', from: ['received', 'needs-you'], to: 'routed' })).toBe(false);
    expect(transitionEntersNeedsYou({ actor: 'overlord', from: [], to: 'needs-you' })).toBe(false);
  });

  it('requestMoveEntersNeedsYou is that rule over the move\'s own row', () => {
    for (const m of EXPECTED_MOVES) expect(requestMoveEntersNeedsYou(m), m).toBe(transitionEntersNeedsYou(EXPECTED[m]));
  });
});

describe('fields', () => {
  const closeNote: readonly RequestColumn[] = ['closeNote'];
  const relay: readonly RequestColumn[] = ['owner', 'doneTest', 'expectedPaths'];

  it('every move to a terminal state lists closeNote', () => {
    for (const m of EXPECTED_MOVES.filter((x) => TERMINAL_REQUEST_STATES.includes(EXPECTED[x].to))) {
      expect(REQUEST_MOVE_FIELDS[m], m).toContain('closeNote');
    }
  });

  it('only the three relay moves list doneTest', () => {
    expect(EXPECTED_MOVES.filter((m) => REQUEST_MOVE_FIELDS[m].includes('doneTest'))).toEqual(['route', 're-relay', 'route-elsewhere']);
  });

  it('spells each move\'s fields, and the map is total over the moves', () => {
    const expected: Record<RequestMove, readonly RequestColumn[]> = {
      open: [], route: relay, 're-relay': relay, 'route-elsewhere': relay, drop: closeNote, escalate: [], acknowledge: [],
      counter: ['counters'], decline: [], block: ['dependsOn'], fail: closeNote, close: closeNote, 'close-unowned': closeNote,
      'close-unverified': [], 'start-parent': [], 'close-parent': closeNote, 'resume-parent': [], unblock: [], 'needs-you': [],
      answer: [], 'answer-recorded': [], take: [], 'hand-back-routed': [], 'hand-back-in-progress': [], 'hand-back-blocked': [],
      confirm: closeNote, withdraw: closeNote,
    };
    expect(Object.keys(REQUEST_MOVE_FIELDS)).toEqual(EXPECTED_MOVES);
    for (const m of EXPECTED_MOVES) expect(REQUEST_MOVE_FIELDS[m], m).toEqual(expected[m]);
    for (const m of EXPECTED_MOVES) for (const c of REQUEST_MOVE_FIELDS[m]) expect(REQUEST_COLUMNS, `${m} ${c}`).toContain(c);
  });

  it('no move lists takenFrom as an input (the writer sets and clears it), and only drop requires a field', () => {
    for (const m of EXPECTED_MOVES) expect(REQUEST_MOVE_FIELDS[m], m).not.toContain('takenFrom');
    expect(REQUEST_MOVE_REQUIRED_FIELDS).toEqual({ drop: ['closeNote'] });
    for (const [m, req] of Object.entries(REQUEST_MOVE_REQUIRED_FIELDS)) {
      for (const f of req) expect(REQUEST_MOVE_FIELDS[m as RequestMove], m).toContain(f);
    }
  });
});

describe('reasons', () => {
  it('lists the words of the plan, each with its moves, and reasonsOfMove inverts the map', () => {
    expect([...REQUEST_MOVE_REASONS]).toEqual(Object.keys(EXPECTED_REASONS));
    for (const r of REQUEST_MOVE_REASONS) {
      expect(REQUEST_MOVE_REASON_MAP[r].moves, r).toEqual(EXPECTED_REASONS[r]);
      expect(isRequestMoveReason(r), r).toBe(true);
    }
    for (const m of EXPECTED_MOVES) {
      const want = (Object.keys(EXPECTED_REASONS) as RequestMoveReason[]).filter((r) => EXPECTED_REASONS[r].includes(m));
      expect([...reasonsOfMove(m)], m).toEqual(want);
    }
  });

  it('every reason row names moves that exist, and a word is not repeated', () => {
    for (const r of REQUEST_MOVE_REASONS) {
      expect(REQUEST_MOVE_REASON_MAP[r].moves.length, r).toBeGreaterThan(0);
      for (const m of REQUEST_MOVE_REASON_MAP[r].moves) expect(REQUEST_MOVES, `${r} ${m}`).toContain(m);
    }
    expect(new Set(REQUEST_MOVE_REASONS).size).toBe(REQUEST_MOVE_REASONS.length);
  });

  it('every move that enters needs-you carries at least one reason, and answer-recorded (which does not enter) carries none', () => {
    for (const m of EXPECTED_MOVES.filter((x) => requestMoveEntersNeedsYou(x))) {
      expect(reasonsOfMove(m).length, m).toBeGreaterThan(0);
    }
    expect(requestMoveEntersNeedsYou('answer-recorded')).toBe(false);
    expect(reasonsOfMove('answer-recorded')).toEqual([]);
  });

  it('ESCALATE_REASONS is the three words of index question 7', () => {
    expect([...ESCALATE_REASONS]).toEqual(['needs-start', 'needs-proposal', 'unnamed-widening']);
  });
});

describe('the citation details (plan Table 6)', () => {
  it('are the seven words, one per refusing row, and the guard takes the map\'s keys only', () => {
    expect(REQUEST_CITATION_DETAILS).toEqual(['too-many', 'repeated', 'unread', 'absent', 'changed', 'spent', 'not-in-root']);
    for (const d of REQUEST_CITATION_DETAILS) expect(isRequestCitationDetail(d), d).toBe(true);
    for (const bad of ['', 'too-large', 'said-not-operator', 'constructor', 'toString', '__proto__', null, undefined, 1]) {
      expect(isRequestCitationDetail(bad), String(bad)).toBe(false);
    }
  });
});
