// Overlord W1, inbox piece, Task 4 (plan `docs/superpowers/plans/2026-11-14-overlord-w1/w1-inbox.md`, question 16):
// `overlordGateRun.ts#overlordReadGate`, the gate asked for a caller that presents no call (the wake lane), and
// `#callerGenerationOf`, the one reading of a caller's live generation that the runner, the read gate, the inbox door and the wake
// lane share. Pure fakes: no store, no fixture file. The runner's own cases are `overlord-gate-run.test.ts`, which stays as it was.
import { describe, expect, it } from 'vitest';
import { callerGenerationOf, overlordReadGate, type OverlordGateDeps } from '../src/coord/overlordGateRun.js';
import type { GenRow } from '../src/continuity/continuityStore.js';
import type { DesignationRead } from '../../shared/overlord-designation.js';

const BODY = 'lane-a-overlord';
const OTHER = 'lane-b-project-a';
const INC = 'inc-1';
const DESIGNATED = {
  kind: 'designated', sessionId: BODY, term: 1,
  row: { bound: { sessionId: BODY, generation: INC }, pending: null, term: 1, designatedTerm: 1 },
} as unknown as DesignationRead;
const gen = (state: string, over: Record<string, unknown> = {}): GenRow =>
  ({ id: 9, identity: 'overlord', startId: 4, n: 3, term: 1, state, walk: 'live', shadowState: null, deadlineAt: null, ...over }) as unknown as GenRow;

function deps(over: Partial<OverlordGateDeps> = {}): { deps: OverlordGateDeps; touched: string[] } {
  const touched: string[] = [];
  const spy = <T>(name: string, v: T) => (): T => { touched.push(name); return v; };
  return {
    touched,
    deps: {
      identity: {
        session: async () => { throw new Error('a read gate presents no call'); },
        incarnation: async () => ({ kind: 'measured', incarnation: INC }) as never,
      },
      designation: () => DESIGNATED,
      authority: () => ({ kind: 'coherent' }),
      ladder: () => ({ kind: 'read', rung: { rung: 'full', operatorRung: 'full', binding: [], readBy: [] } as never }),
      generations: () => ({ ok: true, rows: [gen('active')] }),
      continuityLive: () => true,
      cardRead: () => ({ ok: true, read: { current: true } as never }),
      actKey: spy('actKey', { kind: 'unmeasured', why: 'x' } as never),
      counter: spy('counter', 'unmeasured' as never),
      witness: spy('witness', { kind: 'unmeasured', why: 'x' } as never),
      recordWitness: spy('recordWitness', true),
      recordFenceRefusal: () => { touched.push('recordFenceRefusal'); },
      serverWords: () => ['overlord-v1'],
      now: () => 1,
      ...over,
    },
  };
}

describe('overlordReadGate', () => {
  it('passes the designated session for the inbox row as a read, reading no fence, no witness and recording nothing', async () => {
    const d = deps();
    expect(await overlordReadGate(d.deps)(BODY, 'inbox')).toEqual({ kind: 'pass' });
    expect(d.touched).toEqual([]);
  });

  it('refuses any other session not-the-overlord at step 1, and an unreadable designation unavailable', async () => {
    expect(await overlordReadGate(deps().deps)(OTHER, 'inbox')).toMatchObject({ kind: 'refuse', word: 'not-the-overlord', step: '1' });
    const broken = deps({ designation: () => { throw new Error('boom'); } });
    expect(await overlordReadGate(broken.deps)(BODY, 'inbox')).toMatchObject({ kind: 'refuse', word: 'unavailable', step: '1' });
  });

  it('answers each gate word the runner would, from the same readers', async () => {
    const cases: [string, Partial<OverlordGateDeps>][] = [
      ['capability-missing', { serverWords: () => [] }],
      ['authority-rolled-back', { authority: () => ({ kind: 'rolled-back', cause: 'missing' }) }],
      ['overlord-off', { ladder: () => ({ kind: 'read', rung: { rung: 'off', operatorRung: 'off', binding: [], readBy: [] } as never }) }],
      ['launch-profile-unmet', { ladder: () => ({ kind: 'read', rung: { rung: 'full', operatorRung: 'full', binding: [], readBy: [{ reader: 'launch-profile-unmet', cause: 'p', reading: 'r' }] } as never }) }],
      ['card-unread', { cardRead: () => ({ ok: true, read: null }) }],
      ['renewing', { generations: () => ({ ok: true, rows: [gen('draining')] }) }],
    ];
    for (const [word, over] of cases) {
      expect(await overlordReadGate(deps(over).deps)(BODY, 'inbox'), word).toMatchObject({ kind: 'refuse', word });
    }
  });

  it('reads every port\'s throw as that fact\'s unmeasured arm and never throws itself, an unknown key included', async () => {
    const throwing = deps({
      authority: () => { throw new Error('a'); }, ladder: () => { throw new Error('b'); }, generations: () => { throw new Error('c'); },
      cardRead: () => { throw new Error('d'); }, serverWords: () => { throw new Error('e'); },
    });
    expect(await overlordReadGate(throwing.deps)(BODY, 'inbox')).toMatchObject({ kind: 'refuse' });
    expect(await overlordReadGate(deps().deps)(BODY, 'no-such-door')).toMatchObject({ kind: 'refuse', word: 'unmeasured' });
  });
});

describe('callerGenerationOf', () => {
  const src = (rows: GenRow[] | 'fail', live = true): Pick<OverlordGateDeps, 'generations' | 'continuityLive'> => ({
    generations: () => (rows === 'fail' ? { ok: false, detail: 'no rows' } : { ok: true, rows }),
    continuityLive: () => live,
  });
  it('answers the identity\'s effective state, no live generation, and the reason a read failed, each its own arm', () => {
    expect(callerGenerationOf(src([gen('active')]), BODY, DESIGNATED).generation).toEqual({ kind: 'state', state: 'active' });
    expect(callerGenerationOf(src([gen('active', { identity: 'someone-else' })]), BODY, DESIGNATED).generation).toEqual({ kind: 'none' });
    expect(callerGenerationOf(src('fail'), BODY, DESIGNATED).generation).toEqual({ kind: 'unmeasured', why: 'no rows' });
    expect(callerGenerationOf({ generations: () => { throw new Error('boom'); }, continuityLive: () => true }, BODY, DESIGNATED).generation)
      .toEqual({ kind: 'unmeasured', why: 'boom' });
    expect(callerGenerationOf(src([gen('active')]), BODY, { kind: 'unmeasured', why: 'x' }).generation)
      .toEqual({ kind: 'unmeasured', why: 'the generations could not be read' });
  });
  it('a session that is not the Overlord reads under its own id, and the effective state follows the continuity row', () => {
    const own = gen('active', { identity: OTHER });
    expect(callerGenerationOf(src([gen('draining'), own]), OTHER, DESIGNATED).generation).toEqual({ kind: 'state', state: 'active' });
    // not live and no walk: the shadow column holds what the machine says
    const shadowed = gen('active', { walk: null, shadowState: 'draining' });
    expect(callerGenerationOf(src([shadowed], false), BODY, DESIGNATED).generation).toEqual({ kind: 'state', state: 'draining' });
    expect(callerGenerationOf(src([shadowed], true), BODY, DESIGNATED).generation).toEqual({ kind: 'state', state: 'active' });
  });
});
