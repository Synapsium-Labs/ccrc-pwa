/**
 * PR landing in ccrc, stage 1, task PL-4 (spec §3.2, §3.5, §3.6, §3.8): the observation writer's `episode` predicate,
 * `queueLandingNotice`, and the checks lane (`FleetWatcher.sweepLandingChecks`). Fixture coord.db, fixture registry
 * and a fixture runner only: nothing here reaches GitHub, a live registry or a live box.
 *
 * Episodes are written as PL-5 will write them: `coord.advance(id, 'merging', 'coordinator', mergingAtDetail(…))` from
 * `awaiting-review`, and every re-entry goes `merging → working → awaiting-review → merging`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { Bus } from '../src/bus.js';
import type { Runner } from '../src/exec.js';
import { FleetWatcher } from '../src/watch.js';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import { queueLandingNotice } from '../src/coord/rundefsTx.js';
import { checksEndDetail, checksRowDetail, mergingAtDetail, type ChecksMode } from '../../shared/landing.js';
import type { SessionRecord } from '../src/registry.js';
import { testDeps } from './helpers.js';
import { mkTmp, removeTmpFixtures } from './tmpHelpers.js';

afterEach(() => { vi.useRealTimers(); removeTmpFixtures(); });

const COORD = 'demo-coordinator';
const HEAD = 'a'.repeat(40);
const HEAD2 = 'b'.repeat(40);
const T0 = Date.parse('2026-10-24T10:00:00Z');
const MIN = 60_000;
const SEC = 1_000;
const at = (ms: number): void => { vi.setSystemTime(T0 + ms); };

type Sweep = 'pending' | 'green' | 'red';

/** One `pr-landing` line for session `id`: bound to PR 42, OPEN, at HEAD, one required check named `ci`. `check` is the
 *  check run's own attempt id, so a rerun is a new `check`. */
const line = (id: string, word: Sweep, o: Record<string, unknown> = {}): Record<string, unknown> => ({
  id, bound: true, number: 42, state: 'OPEN', isDraft: false, base: 'main', head: HEAD,
  required: [{ name: 'ci', appId: null, state: word === 'green' ? 'success' : word === 'red' ? 'failure' : '', checkId: 101, runId: 7 }],
  requiredCut: false, rulesNamed: ['ci'], protectionNamed: [], pinnedNames: [], unmeasured: [], ...o,
});
/** The same line with the required check's attempt id changed (a rerun). */
const rerun = (id: string, word: Sweep, check: number, o: Record<string, unknown> = {}): Record<string, unknown> =>
  line(id, word, { required: [{ name: 'ci', appId: null, state: word === 'green' ? 'success' : word === 'red' ? 'failure' : '', checkId: check, runId: 8 }], ...o });

function setup(first: Record<string, unknown> = {}) {
  void first;
  const home = mkTmp('ccrc-checks-');
  mkdirSync(path.join(home, '.ccrc'), { recursive: true });
  const coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
  const calls: string[][] = [];
  const verbs: string[] = [];
  const answers = new Map<string, Record<string, unknown>>();
  const ctl = { fail: false, hang: false, throwFor: null as string | null };
  const records: SessionRecord[] = [];
  const runner: Runner = async (cmd, args) => {
    if (cmd !== 'tmux' && args[0] !== undefined) verbs.push(args[0]);
    if (args[0] !== 'pr-landing') return { code: 0, stdout: '', stderr: '' };
    calls.push(args);
    if (ctl.hang) return new Promise(() => { /* never settles */ });
    const project = args[args.indexOf('--project') + 1]!;
    if (ctl.throwFor === project) throw new Error('boom');
    if (ctl.fail) return { code: 1, stdout: '', stderr: 'x' };
    const ids = args[args.indexOf('--sessions') + 1]!.split(',').map((p) => p.split(':')[0]!);
    return { code: 0, stdout: ids.map((id) => JSON.stringify(answers.get(id) ?? line(id, 'pending'))).join('\n') + '\n', stderr: '' };
  };
  const deps = { ...testDeps(home, runner), coord, fleetState: { ccdVerbs: ['pr-landing-v1'] } as never };
  let w = new FleetWatcher(deps, new Bus(), 10_000);
  let wave = 0;
  /** A run at `merging` in a new episode of `mode`. `registered: false` leaves its workspace out of the registry. */
  function episode(mode: ChecksMode, o: { sid?: string; project?: string; pr?: number | null; head?: string; registered?: boolean } = {}) {
    const sid = o.sid ?? 'demo-ws-a';
    const project = o.project ?? 'demo';
    const opened = coord.openRun({ program: 'landing', title: 't', project, wave: ++wave, waveOf: 999, claimedBy: COORD });
    if (!('id' in opened)) throw new Error('fixture openRun refused');
    coord.setSession(opened.id, sid);
    for (const s of ['dispatched', 'working', 'awaiting-review'] as const) expect(coord.advance(opened.id, s, 'test').ok, s).toBe(true);
    const pr = o.pr === undefined ? 42 : o.pr;
    const head = o.head ?? HEAD;
    expect(coord.advance(opened.id, 'merging', 'coordinator', mergingAtDetail(head, mode === 'off' ? pr : (pr ?? 42), mode)).ok).toBe(true);
    if (o.registered !== false) records.push({ id: sid, project, workspace: 'w-' + sid } as unknown as SessionRecord);
    return { runId: opened.id, e: coord.currentEpisode(opened.id)!.e, sid };
  }
  /** `merging → working → awaiting-review → merging`, the only way back. */
  function reenter(runId: number, head = HEAD, mode: ChecksMode = 'live') {
    for (const s of ['working', 'awaiting-review'] as const) expect(coord.advance(runId, s, 'test').ok, s).toBe(true);
    expect(coord.advance(runId, 'merging', 'coordinator', mergingAtDetail(head, 42, mode)).ok).toBe(true);
    return coord.currentEpisode(runId)!.e;
  }
  const sweep = async (ms: number, names: readonly string[] | null = []): Promise<void> => {
    at(ms);
    await w.sweepLandingChecks(names, records);
  };
  const restart = (): void => { w.stop(); w = new FleetWatcher(deps, new Bus(), 10_000); };
  const mails = () => coord.mailForRecipient(COORD).reverse();
  const subjects = () => mails().map((m) => m.subject);
  const bodies = () => (coord.db.prepare('SELECT body FROM mail ORDER BY id').all() as { body: string }[]).map((r) => r.body);
  const rows = (runId: number) => coord.runEvents(runId).map((r) => r.detail).filter((d): d is string => d !== null && /^landing(-shadow)?:checks:/.test(d));
  return { home, coord, bodies, calls, verbs, answers, ctl, records, episode, reenter, sweep, restart, mails, subjects, rows, deps, get w() { return w; } };
}

beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(T0); });

describe('the observation writer: the `episode` predicate', () => {
  it('a run at merging in episode e records a row for e, at the run\'s own state', () => {
    const h = setup();
    const { runId, e } = h.episode('live');
    const r = h.coord.recordObservation(runId, checksRowDetail(e, 0, 'open'), T0, { kind: 'episode', episode: e });
    expect(r.recorded).toBe(true);
    const last = h.coord.runEvents(runId).at(-1)!;
    expect(last).toMatchObject({ fromState: 'merging', toState: 'merging', causedBy: 'operator', detail: checksRowDetail(e, 0, 'open') });
  });

  it('a run at merging records nothing under `active` (today\'s behaviour: merging is an idle state)', () => {
    const h = setup();
    const { runId, e } = h.episode('live');
    expect(h.coord.recordObservation(runId, checksRowDetail(e, 0, 'open'), T0, { kind: 'active' })).toEqual({ recorded: false, why: 'run-gone' });
  });

  it('a run that left merging between the lane\'s read and the write records nothing, and queueLandingNotice writes no mail', () => {
    const h = setup();
    const { runId, e } = h.episode('live');
    expect(h.coord.advance(runId, 'working', 'test').ok).toBe(true);
    const run = { id: runId, program: 'landing', wave: 1, waveOf: 999 };
    const q = queueLandingNotice(h.coord, run, { detail: checksRowDetail(e, 0, 'green', 'a'.repeat(12)), at: T0, episode: e, toId: COORD, subject: 's', body: 'b' });
    expect(q).toEqual({ queued: false, why: 'run-gone' });
    expect(h.mails()).toEqual([]);
  });

  it('a run sent back at the SAME head records nothing for the old episode e, and records for the new episode e2', () => {
    const h = setup();
    const { runId, e } = h.episode('live');
    const e2 = h.reenter(runId, HEAD);
    expect(e2).toBeGreaterThan(e);
    expect(h.coord.recordObservation(runId, checksRowDetail(e, 0, 'open'), T0, { kind: 'episode', episode: e })).toEqual({ recorded: false, why: 'run-gone' });
    expect(h.coord.recordObservation(runId, checksRowDetail(e2, 0, 'open'), T0, { kind: 'episode', episode: e2 }).recorded).toBe(true);
  });

  it('a run at done or failed records nothing', () => {
    const h = setup();
    const { runId, e } = h.episode('live');
    expect(h.coord.advance(runId, 'failed', 'test').ok).toBe(true);
    expect(h.coord.recordObservation(runId, checksRowDetail(e, 0, 'open'), T0, { kind: 'episode', episode: e }).recorded).toBe(false);
  });

  it('an observation row at merging (fromState = toState) does not change the current episode', () => {
    const h = setup();
    const { runId, e } = h.episode('live');
    h.coord.recordObservation(runId, checksRowDetail(e, 0, 'open'), T0, { kind: 'episode', episode: e });
    expect(h.coord.currentEpisode(runId)?.e).toBe(e);
    expect(h.coord.recordObservation(runId, checksRowDetail(e, 0, 'red', 'c'.repeat(12)), T0, { kind: 'episode', episode: e }).recorded).toBe(true);
  });

  it('a throw from the mail write after the row leaves neither row nor mail, and the next call writes both', () => {
    const h = setup();
    const { runId, e } = h.episode('live');
    const run = { id: runId, program: 'landing', wave: 1, waveOf: 999 };
    const n = { detail: checksRowDetail(e, 0, 'green', 'a'.repeat(12)), at: T0, episode: e, toId: COORD, subject: 'checks:#42:x', body: 'b' };
    const real = h.coord.insertMail.bind(h.coord);
    h.coord.insertMail = () => { throw new Error('boom'); };
    expect(() => queueLandingNotice(h.coord, run, n)).toThrow('boom');
    expect(h.rows(runId)).toEqual([]);
    expect(h.mails()).toEqual([]);
    h.coord.insertMail = real;
    expect(queueLandingNotice(h.coord, run, n).queued).toBe(true);
    expect(h.rows(runId)).toEqual([n.detail]);
    expect(h.mails()).toHaveLength(1);
  });

  it('a generation takes one stuck row and one edge row inside the transaction, whatever the detail says', () => {
    const h = setup();
    const { runId, e } = h.episode('live');
    const run = { id: runId, program: 'landing', wave: 1, waveOf: 999 };
    const send = (detail: string) => queueLandingNotice(h.coord, run, { detail, at: T0, episode: e, toId: COORD, subject: detail, body: 'b' });
    expect(send(checksRowDetail(e, 0, 'stuck', 'pending@' + 'a'.repeat(12))).queued).toBe(true);
    expect(send(checksRowDetail(e, 0, 'stuck', 'unread'))).toEqual({ queued: false, why: 'duplicate' });
    expect(send(checksRowDetail(e, 1, 'red', 'a'.repeat(12))).queued).toBe(true);
    expect(send(checksRowDetail(e, 1, 'green', 'b'.repeat(12)))).toEqual({ queued: false, why: 'duplicate' });
    expect(h.mails()).toHaveLength(2);
  });
});

describe('the checks lane: edges', () => {
  it('a shadow episode: a settled read writes landing-shadow:checks:<e>:0:green@<fp> and sends no mail', async () => {
    const h = setup();
    const { runId, e, sid } = h.episode('shadow');
    h.answers.set(sid, line(sid, 'green'));
    await h.sweep(30 * SEC);
    expect(h.rows(runId).map((d) => d.replace(/@[0-9a-f]{12}$/, '@fp'))).toEqual([`landing-shadow:checks:${e}:0:open`, `landing-shadow:checks:${e}:0:green@fp`]);
    expect(h.mails()).toEqual([]);
  });

  it('a live episode: one checks:#42:<e>.0:green@aaaaaaa mail to the coordinator from operator, with the runId', async () => {
    const h = setup();
    const { runId, e, sid } = h.episode('live');
    h.answers.set(sid, line(sid, 'green'));
    await h.sweep(30 * SEC);
    expect(h.subjects()).toEqual([`checks:#42:${e}.0:green@aaaaaaa`]);
    expect(h.mails()[0]).toMatchObject({ fromId: 'operator', runId, kind: 'status' });
    await h.sweep(60 * SEC);
    expect(h.subjects()).toHaveLength(1);
  });

  it('a rerun that finishes red between two reads mails .1:red', async () => {
    const h = setup();
    const { e, sid } = h.episode('live');
    h.answers.set(sid, line(sid, 'red'));
    await h.sweep(30 * SEC);
    h.answers.set(sid, rerun(sid, 'red', 202));
    await h.sweep(60 * SEC);
    expect(h.subjects()).toEqual([`checks:#42:${e}.0:red@aaaaaaa`, `checks:#42:${e}.1:red@aaaaaaa`]);
  });

  it('red then green with no running read mails .1:green', async () => {
    const h = setup();
    const { e, sid } = h.episode('live');
    h.answers.set(sid, line(sid, 'red'));
    await h.sweep(30 * SEC);
    h.answers.set(sid, line(sid, 'green'));
    await h.sweep(60 * SEC);
    expect(h.subjects()).toEqual([`checks:#42:${e}.0:red@aaaaaaa`, `checks:#42:${e}.1:green@aaaaaaa`]);
  });

  it('the red mail names the failing check inside the fence and the next act', async () => {
    const h = setup();
    const { sid } = h.episode('live');
    h.answers.set(sid, line(sid, 'red'));
    await h.sweep(30 * SEC);
    const body = h.bodies()[0]!;
    expect(body).toContain('ci');
    expect(body).toContain('gh run rerun 7 --failed');
  });

  it('after a red edge the project\'s next read is 30 s later, and after a green edge 120 s', async () => {
    const h = setup();
    const { sid } = h.episode('live');
    h.answers.set(sid, line(sid, 'red'));
    await h.sweep(30 * SEC);
    expect(h.calls).toHaveLength(1);
    await h.sweep(50 * SEC);
    expect(h.calls).toHaveLength(1);
    await h.sweep(60 * SEC);
    expect(h.calls).toHaveLength(2);
    h.answers.set(sid, line(sid, 'green'));
    await h.sweep(90 * SEC);
    expect(h.calls).toHaveLength(3);
    await h.sweep(150 * SEC);
    expect(h.calls).toHaveLength(3);
    await h.sweep(210 * SEC);
    expect(h.calls).toHaveLength(4);
  });

  it('a bound head that differs from the episode\'s head mails .0:moved once and no edge', async () => {
    const h = setup();
    const { e, sid } = h.episode('live');
    h.answers.set(sid, line(sid, 'green', { head: HEAD2 }));
    await h.sweep(30 * SEC);
    await h.sweep(60 * SEC);
    expect(h.subjects()).toEqual([`checks:#42:${e}.0:moved@aaaaaaa`]);
    expect(h.bodies()[0]!).toContain(HEAD2);
    expect(h.calls).toHaveLength(1);
  });
});

describe('the checks lane: re-entry at the same head', () => {
  it('episode e mailed .0:green; after merging → working → awaiting-review → merging a pending then green read mails <e2>.0:green', async () => {
    const h = setup();
    const { runId, e, sid } = h.episode('live');
    h.answers.set(sid, line(sid, 'green'));
    await h.sweep(30 * SEC);
    const e2 = h.reenter(runId);
    h.answers.set(sid, line(sid, 'pending'));
    await h.sweep(60 * SEC);
    h.answers.set(sid, line(sid, 'green'));
    await h.sweep(90 * SEC);
    expect(h.subjects()).toEqual([`checks:#42:${e}.0:green@aaaaaaa`, `checks:#42:${e2}.0:green@aaaaaaa`]);
  });

  it('e2\'s stuck clock starts at e2\'s transition, not e\'s', async () => {
    const h = setup();
    const { runId, sid } = h.episode('live');
    h.answers.set(sid, line(sid, 'pending'));
    await h.sweep(30 * SEC);
    at(50 * MIN);
    const e2 = h.reenter(runId);
    await h.sweep(51 * MIN);
    await h.sweep(94 * MIN);
    expect(h.subjects()).toEqual([]);
    await h.sweep(96 * MIN);
    expect(h.subjects()).toEqual([`checks:#42:${e2}.0:stuck@aaaaaaa`]);
  });
});

describe('the checks lane: the PR or the workspace drops out', () => {
  it.each([
    ['closed', { state: 'CLOSED' }],
    ['draft', { isDraft: true }],
    ['unbound', { bound: false, number: null, state: null, head: null, base: null }],
  ] as const)('a live episode whose PR reads %s mails .0:left once, and nothing after', async (phase, extra) => {
    const h = setup();
    const { e, sid } = h.episode('live');
    h.answers.set(sid, line(sid, 'pending', extra));
    await h.sweep(30 * SEC);
    await h.sweep(60 * SEC);
    await h.sweep(90 * SEC);
    await h.sweep(400 * SEC);
    expect(h.subjects()).toEqual([`checks:#42:${e}.0:left@aaaaaaa`]);
    expect(h.bodies()[0]!).toContain(`(${phase})`);
    expect(h.calls).toHaveLength(1);
  });

  it('a live episode whose PR merges writes the left row and sends no checks: mail', async () => {
    const h = setup();
    const { runId, e, sid } = h.episode('live');
    h.answers.set(sid, line(sid, 'green', { state: 'MERGED' }));
    await h.sweep(30 * SEC);
    expect(h.rows(runId)).toEqual([checksEndDetail(e, 'left')]);
    expect(h.mails()).toEqual([]);
  });

  it('a live episode whose workspace leaves the registry is never read, and still mails stuck with unmeasured at its bound, once', async () => {
    const h = setup();
    const { e } = h.episode('live', { registered: false });
    await h.sweep(30 * SEC);
    await h.sweep(44 * MIN);
    expect(h.subjects()).toEqual([]);
    await h.sweep(46 * MIN);
    await h.sweep(90 * MIN);
    expect(h.subjects()).toEqual([`checks:#42:${e}.0:stuck@aaaaaaa`]);
    expect(h.bodies()[0]!).toContain('(unmeasured)');
    expect(h.calls).toEqual([]);
  });

  it('a shadow episode whose PR is closed writes the shadow left row and sends no mail', async () => {
    const h = setup();
    const { runId, e, sid } = h.episode('shadow');
    h.answers.set(sid, line(sid, 'pending', { state: 'CLOSED' }));
    await h.sweep(30 * SEC);
    expect(h.rows(runId)).toEqual([checksEndDetail(e, 'left', true)]);
    expect(h.mails()).toEqual([]);
  });
});

describe('the checks lane: restarts (a fresh watcher over the same coord.db)', () => {
  it('(a) gen-0 red mailed, rerun pending, restart, red again: one <e>.1:red mail', async () => {
    const h = setup();
    const { e, sid } = h.episode('live');
    h.answers.set(sid, line(sid, 'red'));
    await h.sweep(30 * SEC);
    h.answers.set(sid, rerun(sid, 'pending', 301));
    await h.sweep(60 * SEC);
    h.restart();
    h.answers.set(sid, rerun(sid, 'red', 302));
    await h.sweep(90 * SEC);
    await h.sweep(120 * SEC);
    expect(h.subjects()).toEqual([`checks:#42:${e}.0:red@aaaaaaa`, `checks:#42:${e}.1:red@aaaaaaa`]);
  });

  it('(b) gen-0 red, gen-1 green mailed, restart, green read again: no mail', async () => {
    const h = setup();
    const { sid } = h.episode('live');
    h.answers.set(sid, line(sid, 'red'));
    await h.sweep(30 * SEC);
    h.answers.set(sid, rerun(sid, 'green', 302));
    await h.sweep(60 * SEC);
    expect(h.subjects()).toHaveLength(2);
    h.restart();
    await h.sweep(90 * SEC);
    await h.sweep(300 * SEC);
    expect(h.subjects()).toHaveLength(2);
  });

  it('(c) a rerun opened 50 min after the advance, pending 10 min, a restart every 20 min for 50 min: one <e>.1:stuck, 45 min after the 1:open row', async () => {
    const h = setup();
    const { e, sid } = h.episode('live');
    h.answers.set(sid, line(sid, 'red'));
    await h.sweep(30 * SEC);
    h.answers.set(sid, rerun(sid, 'pending', 401));
    await h.sweep(50 * MIN);                  // 1:open at 50 min
    for (const m of [60, 70, 80, 90, 94]) {
      if (m % 20 === 0 || m === 70 || m === 90) h.restart();
      await h.sweep(m * MIN);
    }
    expect(h.subjects().filter((s) => s.includes(':stuck@'))).toEqual([]);
    h.restart();
    await h.sweep(96 * MIN);
    h.restart();
    await h.sweep(100 * MIN);
    expect(h.subjects().filter((s) => s.includes(':stuck@'))).toEqual([`checks:#42:${e}.1:stuck@aaaaaaa`]);
  });

  it('a restart after any mail sends nothing', async () => {
    const h = setup();
    const { sid } = h.episode('live');
    h.answers.set(sid, line(sid, 'green'));
    await h.sweep(30 * SEC);
    h.restart();
    await h.sweep(60 * SEC);
    await h.sweep(5 * MIN);
    expect(h.subjects()).toHaveLength(1);
  });
});

describe('the checks lane: the latch', () => {
  it('a second pass with the same verdict and fingerprint, before the bound is due, makes no checksRows read for that episode', async () => {
    const h = setup();
    h.episode('live');
    await h.sweep(30 * SEC);
    const spy = vi.spyOn(h.coord, 'checksRows');
    await h.sweep(60 * SEC);
    await h.sweep(90 * SEC);
    expect(spy).not.toHaveBeenCalled();
  });

  it('a thrown row write latches nothing, and the next pass writes it', async () => {
    const h = setup();
    const { runId, sid } = h.episode('live');
    h.answers.set(sid, line(sid, 'green'));
    const real = h.coord.recordObservation.bind(h.coord);
    let once = true;
    h.coord.recordObservation = (...a: Parameters<typeof real>) => { if (once) { once = false; throw new Error('boom'); } return real(...a); };
    await h.sweep(30 * SEC);
    expect(h.rows(runId)).toEqual([]);
    await h.sweep(60 * SEC);
    expect(h.subjects()).toHaveLength(1);
  });

  it('live pending, read every 30 s with the same fingerprint, no restart, 46 min: one stuck with timeout, 45 min after the 0:open row', async () => {
    const h = setup();
    const { e, sid } = h.episode('live');
    h.answers.set(sid, line(sid, 'pending'));
    for (let s = 30; s <= 46 * 60; s += 30) await h.sweep(s * SEC);
    expect(h.subjects()).toEqual([`checks:#42:${e}.0:stuck@aaaaaaa`]);
    expect(h.bodies()[0]!).toContain('(timeout)');
    const stuck = h.coord.runEvents(h.coord.mergingRuns()[0]!.id).find((r) => r.detail?.includes(':stuck:'));
    expect(stuck).toBeDefined();
  });

  it('live red mailed, read every 30 s with the same red fingerprint, no restart, 46 min: one stuck with timeout, 45 min after the red row', async () => {
    const h = setup();
    const { e, sid } = h.episode('live');
    h.answers.set(sid, line(sid, 'red'));
    for (let s = 30; s <= 46 * 60; s += 30) await h.sweep(s * SEC);
    expect(h.subjects()).toEqual([`checks:#42:${e}.0:red@aaaaaaa`, `checks:#42:${e}.0:stuck@aaaaaaa`]);
    expect(h.bodies()[1]!).toContain('(timeout)');
  });

  it('live green mailed, read every 30 s for 3 hours: one checksRows read after the mail, and nothing sent', async () => {
    const h = setup();
    const { sid } = h.episode('live');
    h.answers.set(sid, line(sid, 'green'));
    await h.sweep(30 * SEC);
    const spy = vi.spyOn(h.coord, 'checksRows');
    for (let s = 60; s <= 3 * 3600; s += 120) await h.sweep(s * SEC);
    expect(spy.mock.calls.length).toBeLessThanOrEqual(1);
    expect(h.subjects()).toHaveLength(1);
  });
});

describe('the checks lane: after an unsettled stuck', () => {
  it('live pending stuck with timeout, a rerun read pending with a new fingerprint, the rerun hangs: a second stuck (<e>.1:stuck) 45 min after the 1:open row', async () => {
    const h = setup();
    const { e, sid } = h.episode('live');
    h.answers.set(sid, line(sid, 'pending'));
    for (let s = 30; s <= 46 * 60; s += 30) await h.sweep(s * SEC);
    h.answers.set(sid, rerun(sid, 'pending', 501));
    await h.sweep(47 * MIN);                                   // 1:open at 47 min
    await h.sweep(91 * MIN);
    expect(h.subjects()).toHaveLength(1);
    await h.sweep(93 * MIN);
    expect(h.subjects()).toEqual([`checks:#42:${e}.0:stuck@aaaaaaa`, `checks:#42:${e}.1:stuck@aaaaaaa`]);
  });

  it('live pending stuck with timeout, the same fingerprint for 3 hours: no second mail', async () => {
    const h = setup();
    const { sid } = h.episode('live');
    h.answers.set(sid, line(sid, 'pending'));
    for (let s = 30; s <= 46 * 60; s += 30) await h.sweep(s * SEC);
    for (let m = 48; m <= 180; m += 2) await h.sweep(m * MIN);
    expect(h.subjects()).toHaveLength(1);
  });

  it('live pending stuck, a rerun then green: one <e>.1:green', async () => {
    const h = setup();
    const { e, sid } = h.episode('live');
    h.answers.set(sid, line(sid, 'pending'));
    for (let s = 30; s <= 46 * 60; s += 30) await h.sweep(s * SEC);
    h.answers.set(sid, rerun(sid, 'green', 601));
    await h.sweep(48 * MIN);
    expect(h.subjects()).toEqual([`checks:#42:${e}.0:stuck@aaaaaaa`, `checks:#42:${e}.1:green@aaaaaaa`]);
  });
});

describe('the checks lane: the switches', () => {
  it('an unlistable registry: no pr-landing call, and a live episode pending 46 min mails one stuck with unmeasured; a shadow episode nothing', async () => {
    const h = setup();
    const live = h.episode('live', { sid: 'demo-ws-a' });
    const shadow = h.episode('shadow', { sid: 'demo-ws-b' });
    await h.sweep(30 * SEC, null);
    await h.sweep(44 * MIN, null);
    expect(h.subjects()).toEqual([]);
    await h.sweep(46 * MIN, null);
    await h.sweep(90 * MIN, null);
    expect(h.calls).toEqual([]);
    expect(h.subjects()).toEqual([`checks:#42:${live.e}.0:stuck@aaaaaaa`]);
    expect(h.bodies()[0]!).toContain('(unmeasured)');
    expect(h.rows(shadow.runId)).toEqual([]);
  });

  it('landing-disabled: no pr-landing call, no edge row, and a live episode pending 46 min mails one stuck with disabled', async () => {
    const h = setup();
    const { runId, e, sid } = h.episode('live');
    h.answers.set(sid, line(sid, 'green'));
    const names = ['landing-disabled'];
    await h.sweep(30 * SEC, names);
    await h.sweep(46 * MIN, names);
    expect(h.calls).toEqual([]);
    expect(h.subjects()).toEqual([`checks:#42:${e}.0:stuck@aaaaaaa`]);
    expect(h.bodies()[0]!).toContain('(disabled)');
    expect(h.rows(runId).some((d) => /:(green|red)@/.test(d))).toBe(false);
  });

  it('landing-disabled and a shadow episode: nothing', async () => {
    const h = setup();
    const { runId } = h.episode('shadow');
    await h.sweep(46 * MIN, ['landing-disabled']);
    expect(h.rows(runId)).toEqual([]);
    expect(h.mails()).toEqual([]);
  });

  it('a ccd without pr-landing-v1 is never asked, and a live episode mails one stuck with unmeasured at its bound', async () => {
    const h = setup();
    (h.deps.fleetState as { ccdVerbs: string[] }).ccdVerbs = ['pr-state'];
    const { e } = h.episode('live');
    await h.sweep(30 * SEC);
    await h.sweep(46 * MIN);
    expect(h.calls).toEqual([]);
    expect(h.subjects()).toEqual([`checks:#42:${e}.0:stuck@aaaaaaa`]);
  });

  it('mail-disabled holds the mail and keeps no row, so a green goes once mail is enabled (and is never latched meanwhile)', async () => {
    const h = setup();
    const { runId, e, sid } = h.episode('live');
    h.answers.set(sid, line(sid, 'green'));
    await h.sweep(30 * SEC, ['mail-disabled']);
    await h.sweep(60 * SEC, ['mail-disabled']);
    expect(h.mails()).toEqual([]);
    expect(h.rows(runId).some((d) => /:green@/.test(d))).toBe(false);
    await h.sweep(90 * SEC, []);
    expect(h.subjects()).toEqual([`checks:#42:${e}.0:green@aaaaaaa`]);
  });

  it('mail-disabled does not hold a shadow row', async () => {
    const h = setup();
    const { runId, sid } = h.episode('shadow');
    h.answers.set(sid, line(sid, 'green'));
    await h.sweep(30 * SEC, ['mail-disabled']);
    expect(h.rows(runId).some((d) => /:green@/.test(d))).toBe(true);
  });

  it('removing landing-checks-live leaves a live episode mailing', async () => {
    const h = setup();
    const { e, sid } = h.episode('live');
    h.answers.set(sid, line(sid, 'green'));
    await h.sweep(30 * SEC, []);
    expect(h.subjects()).toEqual([`checks:#42:${e}.0:green@aaaaaaa`]);
  });
});

describe('the checks lane: a red the lane can no longer follow', () => {
  it('live red mailed, landing-disabled created, 46 min later one stuck with disabled', async () => {
    const h = setup();
    const { e, sid } = h.episode('live');
    h.answers.set(sid, line(sid, 'red'));
    await h.sweep(30 * SEC);
    await h.sweep(31 * MIN, ['landing-disabled']);
    expect(h.subjects()).toHaveLength(1);
    await h.sweep(46 * MIN, ['landing-disabled']);
    expect(h.subjects()).toEqual([`checks:#42:${e}.0:red@aaaaaaa`, `checks:#42:${e}.0:stuck@aaaaaaa`]);
    expect(h.bodies()[1]!).toContain('(disabled)');
  });

  it('live red mailed, ccd loses pr-landing-v1: one stuck with unmeasured', async () => {
    const h = setup();
    const { sid } = h.episode('live');
    h.answers.set(sid, line(sid, 'red'));
    await h.sweep(30 * SEC);
    (h.deps.fleetState as { ccdVerbs: string[] }).ccdVerbs = [];
    await h.sweep(46 * MIN);
    expect(h.subjects()).toHaveLength(2);
    expect(h.bodies()[1]!).toContain('(unmeasured)');
  });

  it('live red mailed, the workspace leaves the registry: one stuck with unmeasured 45 min after the red row', async () => {
    const h = setup();
    const { sid } = h.episode('live');
    h.answers.set(sid, line(sid, 'red'));
    await h.sweep(30 * SEC);
    h.records.length = 0;
    await h.sweep(44 * MIN);
    expect(h.subjects()).toHaveLength(1);
    await h.sweep(46 * MIN);
    expect(h.subjects()).toHaveLength(2);
    expect(h.bodies()[1]!).toContain('(unmeasured)');
  });

  it('live red mailed, a rerun read pending within 45 min: no after-red stuck, and generation 1\'s own bound runs', async () => {
    const h = setup();
    const { e, sid } = h.episode('live');
    h.answers.set(sid, line(sid, 'red'));
    await h.sweep(30 * SEC);
    h.answers.set(sid, rerun(sid, 'pending', 701));
    await h.sweep(10 * MIN);
    await h.sweep(46 * MIN);
    expect(h.subjects()).toEqual([`checks:#42:${e}.0:red@aaaaaaa`]);
    await h.sweep(56 * MIN);
    expect(h.subjects()).toEqual([`checks:#42:${e}.0:red@aaaaaaa`, `checks:#42:${e}.1:stuck@aaaaaaa`]);
  });

  it('live red mailed, a fix round (merging → working) within 45 min: nothing more', async () => {
    const h = setup();
    const { runId, sid } = h.episode('live');
    h.answers.set(sid, line(sid, 'red'));
    await h.sweep(30 * SEC);
    expect(h.coord.advance(runId, 'working', 'test').ok).toBe(true);
    await h.sweep(46 * MIN);
    expect(h.subjects()).toHaveLength(1);
  });

  it('live green mailed, landing-disabled created, 46 min later: nothing', async () => {
    const h = setup();
    const { sid } = h.episode('live');
    h.answers.set(sid, line(sid, 'green'));
    await h.sweep(30 * SEC);
    await h.sweep(46 * MIN, ['landing-disabled']);
    expect(h.subjects()).toHaveLength(1);
  });

  it('restart case (d): live red mailed, landing-disabled, a restart every 20 min: one stuck 45 min after the red row, and none before', async () => {
    const h = setup();
    const { sid } = h.episode('live');
    h.answers.set(sid, line(sid, 'red'));
    await h.sweep(30 * SEC);
    const names = ['landing-disabled'];
    for (const m of [20, 40]) { h.restart(); await h.sweep(m * MIN, names); }
    expect(h.subjects()).toHaveLength(1);
    h.restart();
    await h.sweep(46 * MIN, names);
    expect(h.subjects()).toHaveLength(2);
    h.restart();
    await h.sweep(66 * MIN, names);
    expect(h.subjects()).toHaveLength(2);
  });
});

describe('the checks lane: population', () => {
  it('a run at awaiting-review is not read', async () => {
    const h = setup();
    const { runId } = h.episode('live');
    expect(h.coord.advance(runId, 'working', 'test').ok).toBe(true);
    expect(h.coord.advance(runId, 'awaiting-review', 'test').ok).toBe(true);
    await h.sweep(30 * SEC);
    expect(h.calls).toEqual([]);
  });

  it('a PR with no run is not read, and a project with no run at merging makes no call', async () => {
    const h = setup();
    h.records.push({ id: 'demo-ws-z', project: 'other', workspace: 'w' } as unknown as SessionRecord);
    await h.sweep(30 * SEC);
    expect(h.calls).toEqual([]);
  });

  it('an off episode (no bound PR at the advance, or a stacked PR) is not read and owed nothing', async () => {
    const h = setup();
    const { runId } = h.episode('off', { pr: null });
    await h.sweep(30 * SEC);
    await h.sweep(60 * MIN);
    expect(h.calls).toEqual([]);
    expect(h.rows(runId)).toEqual([]);
    expect(h.mails()).toEqual([]);
  });

  it('two runs in one project make one pr-landing call, naming each with its own episode\'s pr', async () => {
    const h = setup();
    h.episode('live', { sid: 'demo-ws-a', pr: 42 });
    h.episode('live', { sid: 'demo-ws-b', pr: 77 });
    await h.sweep(30 * SEC);
    expect(h.calls).toHaveLength(1);
    expect(h.calls[0]![h.calls[0]!.indexOf('--sessions') + 1]).toBe('demo-ws-a:42,demo-ws-b:77');
  });

  it('17 members make two pr-landing calls', async () => {
    const h = setup();
    for (let i = 0; i < 17; i++) h.episode('shadow', { sid: `demo-ws-${i}`, pr: 100 + i });
    await h.sweep(30 * SEC);
    expect(h.calls).toHaveLength(2);
    const sizes = h.calls.map((c) => c[c.indexOf('--sessions') + 1]!.split(',').length).sort((a, b) => a - b);
    expect(sizes).toEqual([1, 16]);
  });
});

describe('the checks lane: read-only and isolated', () => {
  it('across a mixed run, the lane composes no ccd verb but pr-landing', async () => {
    const h = setup();
    const { sid } = h.episode('live');
    h.answers.set(sid, line(sid, 'red'));
    await h.sweep(30 * SEC);
    h.answers.set(sid, line(sid, 'green', { head: HEAD2 }));
    await h.sweep(60 * SEC);
    expect(new Set(h.verbs)).toEqual(new Set(['pr-landing']));
  });

  it('one project\'s thrown read does not cost the next project', async () => {
    const h = setup();
    // A session id the argv builder refuses throws before any call is made: that project's pass fails, the next one runs.
    h.episode('live', { sid: 'demo/ws-a', project: 'alpha' });
    const b = h.episode('live', { sid: 'demo-ws-b', project: 'beta' });
    h.answers.set(b.sid, line(b.sid, 'green'));
    await h.sweep(30 * SEC);
    expect(h.subjects()).toEqual([`checks:#42:${b.e}.0:green@aaaaaaa`]);
  });

  it('a slow pr-landing does not delay the tick (the lane is never awaited)', async () => {
    const h = setup();
    const { sid } = h.episode('live');
    // The tick reads its own registry: seed the workspace there so the lane really asks.
    const reg = path.join(h.home, '.cc-sessions');
    mkdirSync(reg, { recursive: true });
    for (const [f, v] of [['uuid', 'u-' + sid], ['wrapper', 'claude'], ['workdir', '/w/' + sid], ['project', 'demo'],
      ['workspace', 'w-' + sid], ['branch', 'ws/' + sid], ['base', 'origin/main']]) writeFileSync(path.join(reg, `${sid}.${f}`), v!);
    h.ctl.hang = true;
    let done = false;
    void h.w.tick().then(() => { done = true; });
    await vi.waitFor(() => expect(done).toBe(true));
    await vi.waitFor(() => expect(h.calls.length).toBeGreaterThan(0));
    h.w.stop();
  });
});
