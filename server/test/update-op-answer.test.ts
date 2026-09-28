// Design 2026-09-20 §10 — `classifyOpAnswer` (server/src/update/dispatch.ts, L1): what ONE op's answer does
// to the lease the dispatcher holds. Pure: an answer and whether the agent advertises the op, in; `hold` or
// release-to-a-state, out. The act (`converge.ts`) applies it; `update-converge.test.ts` pins that end to end.
//
// The `Record<UpdateOpError, …>` below is the test's half of D-3370: a word added to
// UPDATE_OP_ERRORS without a row here is a compile error (typecheck-tests.test.ts compiles this directory), and
// the dispatcher's own `never` arm makes it one in `dispatch.ts` too.
import { describe, expect, it } from 'vitest';
import { UPDATE_OP_ERRORS, type UpdateOpError } from '../../shared/agent-protocol.js';
import { AGENT_REJECTED_DETAIL, classifyOpAnswer, type AnswerAction, type OpAnswer } from '../src/update/dispatch.js';

const refused = (err: string, detail: string | null = null): OpAnswer => ({ kind: 'refused', err, detail });
const LOCK = 'ccrc: update: another update holds ~/.ccrc/update.lock (pid 7, target v0.0.8)';

describe('classifyOpAnswer — accepted never settles (§18 "`accepted` does not settle")', () => {
  it.each([true, false])('accepted HOLDS the lease (advertised=%s) — only the sweep settles it', (advertised) => {
    expect(classifyOpAnswer({ kind: 'accepted' }, advertised))
      .toEqual({ kind: 'hold', detail: 'accepted — the node queued a detached run' });
  });
});

describe('classifyOpAnswer — every UpdateOpError word (D-3370)', () => {
  const EXPECTED: Record<UpdateOpError, AnswerAction> = {
    'bad-tag': { kind: 'release', to: 'failed', detail: 'agent refused the op: bad-tag' },
    'bad-kind': { kind: 'release', to: 'failed', detail: 'agent refused the op: bad-kind' },
    busy: { kind: 'release', to: 'idle', detail: `busy — ${LOCK}` },
    'spawn-failed': { kind: 'release', to: 'failed', detail: `spawn-failed — ${LOCK}` },
  };

  it('has a row for exactly the words the op answers with', () => {
    expect(Object.keys(EXPECTED).sort()).toEqual([...UPDATE_OP_ERRORS].sort());
  });

  for (const err of UPDATE_OP_ERRORS) {
    for (const advertised of [true, false]) {
      it(`${err} (advertised=${advertised}) — busy never halts; bad-tag, bad-kind and spawn-failed do`, () => {
        expect(classifyOpAnswer(refused(err, LOCK), advertised)).toEqual(EXPECTED[err]);
      });
    }
  }

  it('a missing detail reads as its own words, never an empty dash', () => {
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

  it.each(['disconnected', 'timeout', 'aborted'] as const)('%s is idle — the node said nothing, so the request stands', (why) => {
    expect(classifyOpAnswer({ kind: 'transport', why, message: why }, true))
      .toEqual({ kind: 'release', to: 'idle', detail: `${why} — the node dropped mid-dispatch; the request stands` });
  });

  it('other carries its own message, cut to one printable line', () => {
    expect(classifyOpAnswer({ kind: 'transport', why: 'other', message: 'EPIPE\nstack' }, true))
      .toEqual({ kind: 'release', to: 'idle', detail: 'other — EPIPE; the request stands' });
  });
});
