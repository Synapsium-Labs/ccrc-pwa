// Landing order wave 5j-b, Task 8: `actLandingWrite` (coord/landingWritesAct.ts, L4), the attributed writes' and the
// operator's doors' ONE action, over a fake `write` and a fake `notice`. It answers each of the three result shapes and
// raises the feed event `landingMutationNotice` says is due, and none for an unchanged pause or any refusal.
import { describe, it, expect } from 'vitest';
import { actLandingWrite, type LandingWritePorts } from '../src/coord/landingWritesAct.js';
import type { LandingAuthorityCommand, LandingAuthorityWrite, LandingPauseWrite, LandingWithdrawWrite } from '../src/coord/landingWrites.js';
import type { NoticeRecord } from '../src/notice.js';
import type { LandingEntry } from '../../shared/landingLine.js';

const entry = (over: Partial<LandingEntry> = {}): LandingEntry => ({
  id: 101, project: 'project-a', pr: 1, pinnedSha: 'a'.repeat(40), handoffCommit: 'b'.repeat(40), runId: null, state: 'pinned', baseSha: null,
  ejectionKind: null, ejections: 0, afterIds: [], fixesMain: false, setBy: 'lane-a', pinnedAt: 1001, ...over });

/** A fake sink that records every event and its mode. */
/** A fake store writer answering one fixed result (the port is generic over the command; the fake answers that arm). */
const answering = (r: unknown): LandingWritePorts['write'] => (() => r) as LandingWritePorts['write'];
const sink = () => {
  const seen: { event: NoticeRecord; mode: string }[] = [];
  const notice: LandingWritePorts['notice'] = (event: NoticeRecord, mode) => { seen.push({ event, mode }); return { recorded: true } as unknown as ReturnType<LandingWritePorts['notice']>; };
  return { seen, notice };
};

describe('actLandingWrite (wave 5j-b)', () => {
  it('an order: answers the write\'s result and raises the order arm\'s event', () => {
    const s = sink();
    const result: LandingAuthorityWrite = { ok: true, entry: entry({ afterIds: [102] }), previous: entry(), changed: true, seq: 3,
      coordinator: { kind: 'no-run' }, released: [] };
    const command: Extract<LandingAuthorityCommand, { kind: 'order' }> = { kind: 'order', project: 'project-a', pr: 1, afterIds: [102], setBy: 'lane-b' };
    expect(actLandingWrite(command, 7, { write: answering(result), notice: s.notice })).toBe(result);
    expect(s.seen).toEqual([{ mode: 'record-only', event: expect.objectContaining({ title: 'landing-inversion: project-a #1', sessionId: 'lane-b' }) }]);
  });

  it('a pause: answers the pause shape and raises landing-paused; an unchanged pause raises nothing', () => {
    const s = sink();
    const command: Extract<LandingAuthorityCommand, { kind: 'pause' }> = { kind: 'pause', project: 'project-a', paused: true, setBy: 'operator', actor: 'flag-off' };
    const changed: LandingPauseWrite = { ok: true, project: 'project-a', operatorPaused: true, changed: true, seq: 4 };
    const r = actLandingWrite(command, 7, { write: answering(changed), notice: s.notice });
    expect(r).toBe(changed);
    expect(s.seen).toEqual([{ mode: 'record-only', event: { kind: 'coord', sessionId: '', title: 'landing-paused: project-a',
      body: 'flag-off paused the landing line of project-a (journal seq 4)', runId: null } }]);
    const t = sink();
    const unchanged: LandingPauseWrite = { ok: true, project: 'project-a', operatorPaused: true, changed: false, seq: null };
    expect(actLandingWrite(command, 7, { write: answering(unchanged), notice: t.notice })).toBe(unchanged);
    expect(t.seen).toEqual([]);
  });

  it('a withdraw: answers the withdraw shape and raises landing-withdrawn', () => {
    const s = sink();
    const command: Extract<LandingAuthorityCommand, { kind: 'withdraw' }> = { kind: 'withdraw', project: 'project-a', pr: 1, pinnedAt: 1001,
      setBy: 'operator', actor: 'unmeasured' };
    const result: LandingWithdrawWrite = { ok: true, entry: entry({ state: 'withdrawn' }), previous: entry(), changed: true, seq: 5,
      notices: [{ word: 'landing-withdrawn', entryId: 101, kind: 'none', reason: 'unrecorded' }], coordinator: { kind: 'no-run' } };
    expect(actLandingWrite(command, 7, { write: answering(result), notice: s.notice })).toBe(result);
    expect(s.seen).toEqual([{ mode: 'record-only', event: expect.objectContaining({ sessionId: '', title: 'landing-withdrawn: project-a #1', runId: null }) }]);
  });

  it('a withdraw whose coordinator is a run raises the event with that run and no session (D-9110 carry)', () => {
    const s = sink();
    const command: Extract<LandingAuthorityCommand, { kind: 'withdraw' }> = { kind: 'withdraw', project: 'project-a', pr: 1, pinnedAt: 1001,
      setBy: 'operator', actor: 'flag-off' };
    const result: LandingWithdrawWrite = { ok: true, entry: entry({ state: 'withdrawn', runId: 7 }), previous: entry({ runId: 7 }), changed: true, seq: 6,
      notices: [{ word: 'landing-withdrawn', entryId: 101, kind: 'queued', toId: 'lane-a', mailId: 1, deliveryId: 2 }],
      coordinator: { kind: 'run', runId: 7, claimedBy: 'lane-a' } };
    expect(actLandingWrite(command, 7, { write: answering(result), notice: s.notice })).toBe(result);
    expect(s.seen).toEqual([{ mode: 'record-only', event: expect.objectContaining({ sessionId: '', title: 'landing-withdrawn: project-a #1', runId: 7 }) }]);
  });

  it('a refusal raises nothing and is answered as the write gave it', () => {
    const s = sink();
    const command: Extract<LandingAuthorityCommand, { kind: 'withdraw' }> = { kind: 'withdraw', project: 'project-a', pr: 1, pinnedAt: 1,
      setBy: 'operator', actor: 'flag-off' };
    const refused: LandingWithdrawWrite = { ok: false, error: 'landing-entry-moved' };
    expect(actLandingWrite(command, 7, { write: answering(refused), notice: s.notice })).toBe(refused);
    expect(s.seen).toEqual([]);
  });

  it('the write port receives the command and the time it was given, once', () => {
    const calls: unknown[] = [];
    const command: Extract<LandingAuthorityCommand, { kind: 'pause' }> = { kind: 'pause', project: 'project-a', paused: false, setBy: 'operator', actor: 'flag-off' };
    actLandingWrite(command, 42, { write: ((c: unknown, at: number) => { calls.push([c, at]); return { ok: false, error: 'landing-project-unknown' }; }) as LandingWritePorts['write'],
      notice: () => ({ recorded: true }) as unknown as ReturnType<LandingWritePorts['notice']> });
    expect(calls).toEqual([[command, 42]]);
  });
});
