// D-8073 (spec 2026-11-04 §11.7; ruled plan W1, "Telling the coordinator"): the close transaction writes one `untold`
// row per run closed by the sweep or the operator, and a drain sends one record-only system mail per claimant per pass,
// with runId null, asking no wake. A claimant that does not read alive is not mailed, and its rows wait for an heir.
import { describe, it, expect, afterEach } from 'vitest';
import path from 'node:path';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import { untoldPass, isUntoldNotice, UNTOLD_SUBJECT_PREFIX } from '../src/coord/untold.js';
import type { ClaimantVerdict } from '../src/coord/reclaim.js';
import { mkTmp, removeTmpFixtures } from './tmpHelpers.js';

afterEach(removeTmpFixtures);

const store = (): CoordStore => new CoordStore(openCoordDb(path.join(mkTmp('ccrc-untold-'), '.ccrc', 'coord.db')));
const open = (s: CoordStore, wave: number, claimedBy = 'coord-a', program = 'programme-a'): number => {
  const r = s.openRun({ program, title: 'T', project: 'demo', wave, waveOf: null, claimedBy });
  if (!('id' in r)) throw new Error(`fixture openRun refused: ${JSON.stringify(r)}`);
  return r.id;
};
const close = (s: CoordStore, id: number, causedBy: string, program = 'programme-a'): void => {
  const r = s.closeRun({ runId: id, finalState: 'failed', causedBy, handoffCommit: null, program, viaClosing: false });
  if (!r.ok) throw new Error(`fixture close refused: ${JSON.stringify(r)}`);
};
const untold = (s: CoordStore): { runId: number; claimant: string }[] =>
  s.db.prepare('SELECT runId, claimant FROM run_close_untold ORDER BY runId').all() as never;
const mails = (s: CoordStore): { toId: string; runId: number | null; subject: string; body: string; fromId: string; wake: string | null }[] =>
  s.db.prepare('SELECT d.toId, m.runId, m.subject, m.body, m.fromId, d.wake FROM mail_deliveries d JOIN mail m ON m.id = d.mailId ORDER BY d.id').all() as never;
const ALIVE: ClaimantVerdict = { state: 'alive', why: 'live' };
const verdicts = (v: Record<string, ClaimantVerdict>) => async (id: string): Promise<ClaimantVerdict> =>
  v[id] ?? { state: 'unmeasurable', why: 'no reading' };

describe('the close transaction writes one row per run', () => {
  it('the close transaction writes one row per run', () => {
    const s = store();
    const a = open(s, 1);
    const b = open(s, 2);
    close(s, a, 'operator');
    close(s, b, 'sweep');
    expect(untold(s)).toEqual([{ runId: a, claimant: 'coord-a' }, { runId: b, claimant: 'coord-a' }]);
  });

  it('a close the coordinator made itself writes none', () => {
    const s = store();
    const a = open(s, 1);
    close(s, a, 'coordinator');
    expect(untold(s)).toEqual([]);
  });

  it('a refused close writes none', () => {
    const s = store();
    const a = open(s, 1);
    const r = s.closeRun({ runId: a, finalState: 'failed', causedBy: 'operator', handoffCommit: null, program: 'programme-a',
      viaClosing: false, expectClaimedBy: 'someone-else' });
    expect(r.ok).toBe(false);
    expect(untold(s)).toEqual([]);
  });
});

describe('the drain', () => {
  it('a drain sends one system mail per claimant per pass with runId null', async () => {
    const s = store();
    const a = open(s, 1);
    const b = open(s, 2);
    const c = open(s, 1, 'coord-b', 'programme-b');
    close(s, a, 'operator');
    close(s, b, 'sweep');
    close(s, c, 'operator', 'programme-b');
    await untoldPass({ coord: s, measure: verdicts({ 'coord-a': ALIVE, 'coord-b': ALIVE }) });
    const sent = mails(s).filter((m) => isUntoldNotice(m.subject));
    expect(sent.map((m) => m.toId).sort()).toEqual(['coord-a', 'coord-b']);
    expect(sent.every((m) => m.runId === null && m.fromId === 'operator')).toBe(true);
    expect(sent.find((m) => m.toId === 'coord-a')!.subject.startsWith(UNTOLD_SUBJECT_PREFIX)).toBe(true);
    expect(sent.find((m) => m.toId === 'coord-a')!.body).toContain(`run ${a}`);
    expect(sent.find((m) => m.toId === 'coord-a')!.body).toContain(`run ${b}`);
    expect(untold(s)).toEqual([]);
  });

  it('it is record-only: the delivery is marked never-wake and the subject is the notice head', async () => {
    const s = store();
    close(s, open(s, 1), 'operator');
    await untoldPass({ coord: s, measure: verdicts({ 'coord-a': ALIVE }) });
    const sent = mails(s);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.wake).toBe('never');
    expect(isUntoldNotice(sent[0]!.subject)).toBe(true);
  });

  it('a second pass with nothing new sends nothing', async () => {
    const s = store();
    close(s, open(s, 1), 'operator');
    await untoldPass({ coord: s, measure: verdicts({ 'coord-a': ALIVE }) });
    await untoldPass({ coord: s, measure: verdicts({ 'coord-a': ALIVE }) });
    expect(mails(s)).toHaveLength(1);
  });

  it("a gone claimant's rows wait for an heir", async () => {
    const s = store();
    const a = open(s, 1);
    close(s, a, 'operator');
    await untoldPass({ coord: s, measure: verdicts({ 'coord-a': { state: 'dead', cause: 'absent', why: 'gone' } }) });
    await untoldPass({ coord: s, measure: verdicts({}) });
    expect(mails(s)).toEqual([]);
    expect(untold(s)).toEqual([{ runId: a, claimant: 'coord-a' }]);
    await untoldPass({ coord: s, measure: verdicts({ 'coord-a': ALIVE }) });
    expect(mails(s)).toHaveLength(1);
    expect(untold(s)).toEqual([]);
  });

  it("a gone claimant's rows go to the heir the reclaim installs, and the heir is told", async () => {
    const s = store();
    const a = open(s, 1);
    close(s, a, 'sweep');
    const r = s.reclaimProgram(a, 'coord-heir', Date.now(), null);
    expect(r.ok).toBe(true);
    expect(untold(s)).toEqual([{ runId: a, claimant: 'coord-heir' }]);
    await untoldPass({ coord: s, measure: verdicts({ 'coord-a': { state: 'dead', cause: 'absent', why: 'gone' }, 'coord-heir': ALIVE }) });
    expect(mails(s).map((m) => m.toId)).toEqual(['coord-heir']);
    expect(untold(s)).toEqual([]);
  });

  it('a mail that cannot be written leaves the rows standing, so a retry still tells once', async () => {
    const s = store();
    const a = open(s, 1);
    close(s, a, 'operator');
    const real = s.insertMail.bind(s);
    (s as unknown as { insertMail: unknown }).insertMail = () => { throw new Error('disk full'); };
    await untoldPass({ coord: s, measure: verdicts({ 'coord-a': ALIVE }) });
    expect(untold(s)).toEqual([{ runId: a, claimant: 'coord-a' }]);
    expect(mails(s)).toEqual([]);
    (s as unknown as { insertMail: unknown }).insertMail = real;
    await untoldPass({ coord: s, measure: verdicts({ 'coord-a': ALIVE }) });
    expect(mails(s)).toHaveLength(1);
  });
});
