// Design 2026-09-20 §10 — `classifyOpAnswer` (server/src/update/dispatch.ts, L1): what ONE op's answer does
// to the lease the dispatcher holds. Pure: an answer and whether the agent advertises the op, in; `hold` or
// release-to-a-state, out. The act (`converge.ts`) applies it; `update-converge.test.ts` pins that end to end.
//
// The `Record<UpdateOpError, …>` below is the test's half of D-3370: a word added to
// UPDATE_OP_ERRORS without a row here is a compile error (typecheck-tests.test.ts compiles this directory), and
// the dispatcher's own `never` arm makes it one in `dispatch.ts` too.
import { describe, expect, it } from 'vitest';
import { UPDATE_OP_DETAIL_MAX, UPDATE_OP_ERRORS, type UpdateOpError } from '../../shared/agent-protocol.js';
import {
  AGENT_REJECTED_DETAIL, LINK_FAILED_HOLD_PREFIX, classifyOpAnswer, linkFailedDeadlineDetail, linkFailedHoldDetail,
  type AnswerAction, type OpAnswer,
} from '../src/update/dispatch.js';

const refused = (err: string, detail: string | null = null): OpAnswer => ({ kind: 'refused', err, detail });
const LOCK = 'ccrc: update: another update holds ~/.ccrc/update.lock (pid 7, target v0.0.8)';

describe('classifyOpAnswer — accepted never settles (§18 "`accepted` does not settle")', () => {
  it.each([true, false])('accepted HOLDS the lease (advertised=%s) — only the sweep settles it', (advertised) => {
    expect(classifyOpAnswer({ kind: 'accepted' }, advertised))
      .toEqual({ kind: 'hold', detail: 'accepted — the node queued a detached run' });
  });
});

describe('classifyOpAnswer — an accepted that carries the bound\'s words holds with them (D-3400 amended, D-3413)', () => {
  it.each([true, false])('accepted WITH a detail holds (advertised=%s) and says the node\'s words, as one printable line', (advertised) => {
    expect(classifyOpAnswer({ kind: 'accepted', detail: 'stopped at the bound\nafter it queued v0.0.9' }, advertised))
      .toEqual({ kind: 'hold', detail: 'stopped at the bound' });
    expect(classifyOpAnswer({ kind: 'accepted', detail: 'x'.repeat(500) }, advertised))
      .toEqual({ kind: 'hold', detail: 'x'.repeat(200) });
  });
  it('an accepted whose detail is empty of printable text falls back to the default words, never an empty detail', () => {
    expect(classifyOpAnswer({ kind: 'accepted', detail: '\u0000' }, true))
      .toEqual({ kind: 'hold', detail: 'accepted — the node queued a detached run' });
  });
});

describe('classifyOpAnswer — every UpdateOpError word (D-3370)', () => {
  const EXPECTED: Record<UpdateOpError, AnswerAction> = {
    'bad-tag': { kind: 'release', to: 'failed', detail: 'agent refused the op: bad-tag' },
    'bad-kind': { kind: 'release', to: 'failed', detail: 'agent refused the op: bad-kind' },
    busy: { kind: 'release', to: 'idle', detail: `busy — ${LOCK}` },
    'spawn-failed': { kind: 'release', to: 'failed', detail: `spawn-failed — ${LOCK}` },
    // D-3413: the bound's arm A. Not `busy` (nobody else is updating) and not `spawn-failed` (no fault, nothing halts).
    'not-queued': { kind: 'release', to: 'idle', detail: `not-queued — ${LOCK}` },
  };

  it('has a row for exactly the words the op answers with', () => {
    expect(Object.keys(EXPECTED).sort()).toEqual([...UPDATE_OP_ERRORS].sort());
  });

  for (const err of UPDATE_OP_ERRORS) {
    for (const advertised of [true, false]) {
      it(`${err} (advertised=${advertised}) — busy and not-queued never halt; bad-tag, bad-kind and spawn-failed do`, () => {
        expect(classifyOpAnswer(refused(err, LOCK), advertised)).toEqual(EXPECTED[err]);
      });
    }
  }

  it('a missing detail reads as its own words, never an empty dash — not-queued too (D-3413)', () => {
    expect(classifyOpAnswer(refused('not-queued'), true))
      .toEqual({ kind: 'release', to: 'idle', detail: 'not-queued — the parent was stopped before it queued anything' });
    expect(classifyOpAnswer(refused('busy'), true))
      .toEqual({ kind: 'release', to: 'idle', detail: 'busy — the node gave no detail' });
    expect(classifyOpAnswer(refused('spawn-failed'), true))
      .toEqual({ kind: 'release', to: 'failed', detail: 'spawn-failed — no message' });
  });

  it('a node-supplied detail is stored as ONE printable line (firstStderrLine)', () => {
    // Task 1's rule: a run outside 0x20–0x7E becomes ONE space — so the NUL between the two words is the space.
    expect(classifyOpAnswer(refused('spawn-failed', 'first\u0000line\nsecond line'), true))
      .toEqual({ kind: 'release', to: 'failed', detail: 'spawn-failed — first line' });
  });
});

describe('classifyOpAnswer — bad-request (§18 "`bad-request` from an advertising agent halts")', () => {
  it('from an agent that ADVERTISES the op: failed, the spec\'s sentence — halting', () => {
    expect(AGENT_REJECTED_DETAIL).toBe('agent rejected the update op');
    expect(classifyOpAnswer(refused('bad-request'), true))
      .toEqual({ kind: 'release', to: 'failed', detail: AGENT_REJECTED_DETAIL });
  });

  it('from an agent that does not: idle, the version-skew sentence — the request stands', () => {
    expect(classifyOpAnswer(refused('bad-request'), false)).toEqual({
      kind: 'release', to: 'idle',
      detail: 'agent-predates-update-op — the agent answered bad-request and does not advertise the update op; the request stands',
    });
  });
});

describe('classifyOpAnswer — any other word, and the transport', () => {
  it.each([true, false])('a word outside the vocabulary is failed and named (advertised=%s)', (advertised) => {
    expect(classifyOpAnswer(refused('forbidden'), advertised))
      .toEqual({ kind: 'release', to: 'failed', detail: 'agent answered forbidden' });
    expect(classifyOpAnswer(refused('ok-without-accepted'), advertised))
      .toEqual({ kind: 'release', to: 'failed', detail: 'agent answered ok-without-accepted' });
  });

  it.each(['disconnected', 'timeout', 'aborted'] as const)(
    '%s that never reached the link releases idle — the op never left, so the request stands',
    (why) => {
      expect(classifyOpAnswer({ kind: 'transport', why, message: why, reached: 'never' }, true))
        .toEqual({ kind: 'release', to: 'idle', detail: `${why} — the op never reached the fleet link; the request stands` });
    },
  );

  it('other, never reached, carries its own message, cut to one printable line (the server-role local arm\'s shape)', () => {
    expect(classifyOpAnswer({ kind: 'transport', why: 'other', message: 'EPIPE\nstack', reached: 'never' }, true))
      .toEqual({ kind: 'release', to: 'idle', detail: 'other — EPIPE; the request stands' });
  });

  describe('a transport failure that MAY have reached the link HOLDS the lease (D-3555)', () => {
    const WHYS = ['disconnected', 'timeout', 'aborted', 'other'] as const;
    for (const advertised of [true, false]) {
      for (const why of WHYS) {
        it(`why=${why} advertised=${advertised}`, () => {
          const message = why === 'other' ? 'EPIPE\nstack' : why;
          expect(classifyOpAnswer({ kind: 'transport', why, message, reached: 'maybe' }, advertised))
            .toEqual({ kind: 'hold', detail: linkFailedHoldDetail(why, message) });
        });
      }
    }

    it('the timeout hold detail is spelled out verbatim', () => {
      expect(linkFailedHoldDetail('timeout', 'timeout')).toBe(
        'link failed mid-op (timeout) — the op reached the fleet link and no answer came back, so the node may ' +
        'have started the run; the lease holds until its report or the deadline',
      );
    });

    it('other names its message after the prefix', () => {
      expect(linkFailedHoldDetail('other', 'EPIPE\nstack').startsWith('link failed mid-op (other: EPIPE) — ')).toBe(true);
    });

    it('a huge other message is cut to UPDATE_OP_DETAIL_MAX and still begins with the prefix', () => {
      const detail = linkFailedHoldDetail('other', 'x'.repeat(5000));
      expect(detail.length).toBeLessThanOrEqual(UPDATE_OP_DETAIL_MAX);
      expect(detail.startsWith(LINK_FAILED_HOLD_PREFIX)).toBe(true);
    });

    it('why=other says the op MAY have reached the link; the three named post-send arms keep "reached" '
      + '(fix round 1, review 178 O1)', () => {
      const other = linkFailedHoldDetail('other', 'EPIPE');
      expect(other).toContain('the op may have reached the fleet link');
      for (const why of ['disconnected', 'timeout', 'aborted'] as const) {
        const detail = linkFailedHoldDetail(why, why);
        expect(detail).toContain('the op reached the fleet link');
        expect(detail).not.toContain('may have reached');
      }
    });

    it('a 500-character other message still fits UPDATE_OP_DETAIL_MAX and keeps its tail (fix round 1, review 178, '
      + 'item 3 — the cap is on the MESSAGE, never on the sentence\'s own end)', () => {
      const detail = linkFailedHoldDetail('other', 'x'.repeat(500));
      expect(detail.length).toBeLessThanOrEqual(UPDATE_OP_DETAIL_MAX);
      expect(detail.startsWith(LINK_FAILED_HOLD_PREFIX)).toBe(true);
      expect(detail.endsWith('the lease holds until its report or the deadline')).toBe(true);
    });
  });
});

describe("linkFailedDeadlineDetail — D-3555's deadline words", () => {
  const held = linkFailedHoldDetail('timeout', 'timeout');

  it('no report of the tag at all: "the row\'s last report does not name v0.0.10" (fix round 1, review 178 F1 — '
    + 'the row\'s last report is all this column can prove)', () => {
    const detail = linkFailedDeadlineDetail({ updateDetail: held, updateTarget: 'v0.0.10', reportedTarget: null });
    expect(detail).toBe("deadline — the fleet link failed mid-op; the row's last report does not name v0.0.10");
    expect(detail).not.toContain('was reported');
  });

  it('a report naming a DIFFERENT tag reads the same (fix round 1, review 178 F1)', () => {
    const detail = linkFailedDeadlineDetail({ updateDetail: held, updateTarget: 'v0.0.10', reportedTarget: 'v0.0.9' });
    expect(detail).toBe("deadline — the fleet link failed mid-op; the row's last report does not name v0.0.10");
    expect(detail).not.toContain('was reported');
  });

  it('a report naming the SAME tag gets the qualified sentence', () => {
    expect(linkFailedDeadlineDetail({ updateDetail: held, updateTarget: 'v0.0.10', reportedTarget: 'v0.0.10' }))
      .toBe("deadline — the fleet link failed mid-op; the row's last report names v0.0.10, which may be an earlier run's");
  });

  it('an accepted (non-link-failure) detail is not a link-failure hold: null', () => {
    expect(linkFailedDeadlineDetail({
      updateDetail: 'accepted — the node queued a detached run', updateTarget: 'v0.0.10', reportedTarget: null,
    })).toBeNull();
  });

  it('no detail at all: null', () => {
    expect(linkFailedDeadlineDetail({ updateDetail: null, updateTarget: 'v0.0.10', reportedTarget: null })).toBeNull();
  });

  it('no target: null', () => {
    expect(linkFailedDeadlineDetail({ updateDetail: held, updateTarget: null, reportedTarget: null })).toBeNull();
  });
});
