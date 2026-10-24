/**
 * The server half of landing-order wave 2 (spec §5.2): `queueFor`, the ONE
 * reader of ccd's additive `queue`/`queueAt` fields, and the landing lane —
 * the coordinator's two notices about a PR it is landing through the merge
 * queue. A `dequeued` reading is a `queue` feed record and a `status` mail to
 * the coordinator of the open run that names the workspace, once per
 * (workspace, PR, removal); a PR that reads merged while that run waits at
 * `merging` is a `status` mail too, once per (workspace, PR). Once means once
 * across a server restart as well, and never for any other word, for an
 * unmeasured read, or for a line from an older ccd. A read that fails or a
 * mail that throws is retried, never latched as told.
 */
import { describe, it, expect, vi } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { Bus } from '../src/bus.js';
import type { Runner } from '../src/exec.js';
import { FleetWatcher } from '../src/watch.js';
import { renderDequeueBrief, renderMergedBrief } from '../src/coord/landing.js';
import { NotifyLog } from '../src/notifylog.js';
import { queueFor, type CcdPrLine } from '../src/prstate.js';
import { dequeuedSubject, mergedSubject } from '../src/coord/rundefs.js';
import { testDeps } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';
import type { PushPayload } from '../src/push.js';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import type { RunState } from '../../shared/api.js';
import { HIBERNATE_DISABLED_MARKER } from '../src/coord/hibernate.js';

const ID = 'demo-quiet-basin';
const T1 = '2026-09-23T11:30:00Z';
const T2 = '2026-09-23T12:05:00Z';
const COORDINATOR = 'ccrc-pwa-coordinator';

function seed(): string {
  const home = mkTmp('ccrc-queue-');
  const reg = path.join(home, '.cc-sessions');
  mkdirSync(reg, { recursive: true });
  for (const [f, v] of [['uuid', 'u-' + ID], ['wrapper', 'claude'], ['workdir', '/w/' + ID],
    ['project', 'demo'], ['workspace', 'quiet-basin'], ['branch', 'ws/' + ID], ['base', 'origin/main']]) {
    writeFileSync(path.join(reg, `${ID}.${f}`), v!);
  }
  // D-5242: hibernation's shadow sweep, off. It reads this idle session's run rows on its own clock, and the spy on
  // `openRunsForSession` below asks about THIS lane's re-reads only; hibernation is not under test here.
  writeFileSync(path.join(reg, HIBERNATE_DISABLED_MARKER), '');
  return home;
}

/** One full `pr-state` line for an OPEN PR #`number`, carrying whatever queue
 *  fields the case needs — `extra` absent means a line from an older ccd. */
const openLine = (extra: Record<string, unknown>, number = 42): string => JSON.stringify({
  id: ID, project: 'demo', repo: 'o/r', branch: 'ws/' + ID, base: 'origin/main', baseShort: 'main',
  tip: 'f'.repeat(40), ahead: 1, dirty: 0, commits: [], template: null,
  rows: [{ number, state: 'OPEN', headRefName: 'ws/' + ID, headRefOid: 'deadbee', baseRefName: 'main',
    isCrossRepository: false, mergedAt: null, mergeCommit: null, url: 'u', title: 't', isDraft: false,
    statusCheckRollup: null, ours: true }],
  phase: 'open', number, checkedAt: 1785300000000, reason: null, ...extra,
});

/** The same PR, MERGED and bound (`pr-sweep.test.ts`'s `mergedLine`). */
const mergedLine = (extra: Record<string, unknown> = {}, number = 42): string => JSON.stringify({
  id: ID, project: 'demo', repo: 'o/r', branch: 'ws/' + ID, base: 'origin/main', baseShort: 'main',
  tip: 'f'.repeat(40), ahead: 1, dirty: 0, commits: [], template: null,
  rows: [{ number, state: 'MERGED', headRefName: 'ws/' + ID, headRefOid: 'deadbee', baseRefName: 'main',
    isCrossRepository: false, mergedAt: '2026-09-23T12:30:00Z', mergeCommit: { oid: '7a68ca0' }, url: 'u',
    title: 't', isDraft: false, statusCheckRollup: null, ours: true }],
  phase: 'merged', number, checkedAt: 1785300000000, reason: null, ...extra,
});

const runnerFor = (out: () => string): Runner => async (_cmd, args) => {
  if (args[0] === 'pr-state') return { code: 0, stdout: out(), stderr: '' };
  if (args[0] === 'list-panes') return { code: 0, stdout: '4242\n', stderr: '' };
  return { code: 0, stdout: '', stderr: '' };
};

/** Walk a run through the ONE path `RUN_TRANSITIONS` allows to `to`. */
const PATH: Record<string, RunState[]> = {
  planned: [], 'awaiting-review': ['dispatched', 'working', 'awaiting-review'],
  merging: ['dispatched', 'working', 'awaiting-review', 'merging'],
};
const walk = (coord: CoordStore, id: number, to: RunState): void => {
  for (const s of PATH[to]!) expect(coord.advance(id, s, 'test').ok, `advance to ${s}`).toBe(true);
};

/** `run`: whose workspace the ONE open programme's run names — this one
 *  (`mine`), or ANOTHER (`other`), so `resolveCoordinator(null)` would answer
 *  a real session and the lane must not take that guess. `state`: where the
 *  run waits (default `merging` — the coordinator is landing). `second`: a
 *  SECOND open run naming this workspace (wave N+1 on the same workspace).
 *  `visible`: the operator is looking at this pane — the presence gate
 *  `pushOne` consults, which a `recordAlways` record must not heed. */
async function harness(first: string, opts: { run?: 'mine' | 'other'; state?: RunState; second?: boolean; visible?: boolean } = {}) {
  const home = seed();
  const coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
  const opened = coord.openRun({ program: 'landing', title: 't', project: 'demo',
    wave: 2, waveOf: 5, claimedBy: COORDINATOR });
  if (!('id' in opened)) throw new Error('fixture openRun refused');
  const mine = (opts.run ?? 'mine') === 'mine';
  coord.setSession(opened.id, mine ? ID : 'demo-still-cove');
  walk(coord, opened.id, opts.state ?? 'merging');
  let runId: number | null = mine ? opened.id : null;
  if (opts.second) {
    const next = coord.openRun({ program: 'landing', title: 't', project: 'demo',
      wave: 3, waveOf: 5, claimedBy: COORDINATOR });
    if (!('id' in next)) throw new Error('fixture second openRun refused');
    coord.setSession(next.id, ID);
    runId = next.id;
  }
  const log = new NotifyLog(path.join(home, 'notify.json'));
  await log.load();
  const sent: PushPayload[] = [];
  let out = first;
  const deps = { ...testDeps(home, runnerFor(() => out)), coord, notifyLog: log,
    push: { notify: async (p: PushPayload) => { sent.push(p); } } as never,
    presence: { isVisible: () => opts.visible === true } as never };
  let w = new FleetWatcher(deps, new Bus(), 10_000);
  const sweep = async (next?: string): Promise<void> => {
    if (next !== undefined) out = next;
    w.kick('pr');
    await w.tick();
    await vi.waitFor(() => expect(w.inFlight('pr')).toBeNull());
  };
  /** A server restart: a NEW watcher — every in-memory latch empty — over the
   *  SAME coord.db, which is what a rollout or a crash leaves behind. */
  const restart = (): void => { w.stop(); w = new FleetWatcher(deps, new Bus(), 10_000); };
  const stop = (): void => { w.stop(); };
  const queueFeed = () => coord.feedEvents(200).filter((e) => e.kind === 'queue');
  const mail = () => coord.mailForRecipient(COORDINATOR);
  return { coord, deps, sweep, restart, stop, sent, queueFeed, mail, runId, firstRunId: opened.id };
}

describe('queueFor — the one reader of the queue fields', () => {
  const line = (extra: Record<string, unknown>): CcdPrLine => JSON.parse(openLine(extra)) as CcdPrLine;

  it('answers absent for a line with no queue key — an older ccd, or --session — never unmeasured', () => {
    expect(queueFor(line({}))).toEqual({ state: 'absent', at: null });
  });

  it('reads each of the five words, and a stranger token as unmeasured', () => {
    for (const w of ['queued', 'dequeued', 'landed', 'none', 'unmeasured']) {
      expect(queueFor(line({ queue: w })).state).toBe(w);
    }
    expect(queueFor(line({ queue: 'parked' })).state).toBe('unmeasured');
    expect(queueFor(line({ queue: 7 })).state).toBe('unmeasured');
  });

  it('keeps queueAt only when it is shaped like a timestamp', () => {
    expect(queueFor(line({ queue: 'dequeued', queueAt: T1 })).at).toBe(T1);
    expect(queueFor(line({ queue: 'dequeued', queueAt: '$(reboot)' })).at).toBeNull();
  });
});

describe('the landing lane — a dequeue', () => {
  it('records a queue feed event and mails the coordinator of the open run, once', async () => {
    const f = await harness(openLine({ queue: 'dequeued', queueAt: T1 }));
    await f.sweep();
    expect(f.queueFeed()).toHaveLength(1);
    expect(f.queueFeed()[0]!.title).toBe('⤺ dequeued › quiet-basin');
    expect(f.queueFeed()[0]!.runId).toBe(f.runId);
    const m = f.mail();
    expect(m).toHaveLength(1);
    expect(m[0]!.subject).toBe(`dequeued:#42@${T1}`);
    expect(m[0]!.subject).toBe(dequeuedSubject(42, T1));
    expect(m[0]!.kind).toBe('status');
    expect(m[0]!.runId).toBe(f.runId);
    expect(f.sent.find((p) => p.tag === `queue-${ID}#42:dequeued@${T1}`)).toBeDefined();
    // The same reading on the next sweep is the same fact: no second anything —
    // and, latched in memory, it costs no second read of the run rows.
    const reads = vi.spyOn(f.coord, 'openRunsForSession');
    await f.sweep();
    expect(f.queueFeed()).toHaveLength(1);
    expect(f.mail()).toHaveLength(1);
    expect(reads, 'a latched removal re-read the run rows on the next sweep').not.toHaveBeenCalled();
    f.stop();
  });

  it('announces a SECOND removal of the same PR — the latch carries the removal time', async () => {
    const f = await harness(openLine({ queue: 'dequeued', queueAt: T1 }));
    await f.sweep();
    await f.sweep(openLine({ queue: 'queued', queueAt: '2026-09-23T11:40:00Z' }));
    await f.sweep(openLine({ queue: 'dequeued', queueAt: T2 }));
    expect(f.queueFeed()).toHaveLength(2);
    expect(f.mail().map((m) => m.subject).sort()).toEqual([`dequeued:#42@${T1}`, `dequeued:#42@${T2}`]);
    f.stop();
  });

  it('names the survivor — with two open runs on the workspace, the newer, the close\'s own rule', async () => {
    const f = await harness(openLine({ queue: 'dequeued', queueAt: T1 }), { second: true });
    await f.sweep();
    expect(f.runId).not.toBe(f.firstRunId);
    expect(f.mail().map((m) => m.runId)).toEqual([f.runId]);
    expect(f.queueFeed()[0]!.runId).toBe(f.runId);
    f.stop();
  });

  it('with no open run, records the feed event and mails nobody — never a guessed coordinator', async () => {
    const f = await harness(openLine({ queue: 'dequeued', queueAt: T1 }), { run: 'other' });
    await f.sweep();
    expect(f.queueFeed()).toHaveLength(1);
    expect(f.queueFeed()[0]!.body).toContain('No open run names a coordinator');
    expect(f.mail()).toEqual([]);
    f.stop();
  });

  it('records the dequeue even while the operator is looking at the pane — the record is never presence-gated', async () => {
    const f = await harness(openLine({ queue: 'dequeued', queueAt: T1 }), { visible: true });
    await f.sweep();
    expect(f.queueFeed(), 'the operator watching the pane erased the record of a removal').toHaveLength(1);
    f.stop();
  });

  it('says nothing for queued, landed, none, unmeasured, or a line from an older ccd', async () => {
    // `none` at `merging` is silent BY DESIGN, and it is also what a PR reads
    // when the coordinator's enqueue only ARMED auto-merge (gh 2.45 does that
    // for a PR whose required checks have not passed, with the same success
    // line): the coordinator's own read-back of the queue entry is what makes
    // that case loud (`wave-lifecycle.md` §5), not this lane.
    for (const extra of [{ queue: 'queued' }, { queue: 'landed' }, { queue: 'none' },
      { queue: 'unmeasured' }, {}]) {
      const f = await harness(openLine(extra));
      await f.sweep();
      expect(f.queueFeed(), JSON.stringify(extra)).toEqual([]);
      expect(f.mail(), JSON.stringify(extra)).toEqual([]);
      f.stop();
    }
  });

  it('the dequeue brief reads why from the queue\'s own run, disarms before a fix round, re-enqueues at the exact SHA and never with --admin; the merged brief asks for the merge proof', () => {
    const b = renderDequeueBrief(ID, 42);
    expect(b).toContain('`gh pr merge 42 --match-head-commit <handoffCommit>`');
    expect(b.replace('never `--admin`', '')).not.toContain('--admin');
    expect(b).not.toContain('--squash');
    // A queue failure is the merge_group run's, on the queue branch's commit;
    // the PR head's own checks never include it and can read green.
    expect(b).toContain('`gh run list --event merge_group');
    expect(b).not.toContain('statusCheckRollup');
    // An armed auto-merge queues whatever head a fix round pushes.
    expect(b).toContain('`gh pr merge 42 --disable-auto`');
    expect(renderMergedBrief(ID, 42)).toContain('`gh pr view 42 --json state,headRefOid`');
  });
});

describe('the landing lane — a merge while the run waits at merging', () => {
  it('mails the coordinator merged:#<n> once, and records no queue event', async () => {
    const f = await harness(mergedLine({ queue: 'landed', queueAt: T2 }));
    await f.sweep();
    const m = f.mail();
    expect(m).toHaveLength(1);
    expect(m[0]!.subject).toBe('merged:#42');
    expect(m[0]!.subject).toBe(mergedSubject(42));
    expect(m[0]!.kind).toBe('status');
    expect(m[0]!.runId).toBe(f.runId);
    expect(f.queueFeed()).toEqual([]);
    await f.sweep();
    expect(f.mail()).toHaveLength(1);
    f.stop();
  });

  it('says nothing when the run is not at merging, or no open run names the workspace', async () => {
    for (const opts of [{ state: 'awaiting-review' as RunState }, { state: 'planned' as RunState }, { run: 'other' as const }]) {
      const f = await harness(mergedLine(), opts);
      await f.sweep();
      expect(f.mail(), JSON.stringify(opts)).toEqual([]);
      f.stop();
    }
  });
});

describe('the landing lane latches only what it told', () => {
  it('an unreadable run read is not "no open run": it defers, records nothing, and mails once it reads', async () => {
    const f = await harness(openLine({ queue: 'dequeued', queueAt: T1 }));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const real = f.coord.openRunsForSession.bind(f.coord);
    let n = 0;
    vi.spyOn(f.coord, 'openRunsForSession').mockImplementation((id, ex) => (n++ === 0
      ? { ok: false, kind: 'run-unreadable', detail: 'fixture' } : real(id, ex)));
    await f.sweep();
    expect(f.queueFeed(), 'an unreadable run read was announced as "no open run"').toEqual([]);
    expect(f.mail()).toEqual([]);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('deferred (run rows unreadable: fixture)'));
    await f.sweep();
    expect(f.mail(), 'the deferred notice was never sent').toHaveLength(1);
    expect(f.queueFeed()).toHaveLength(1);
    expect(f.queueFeed()[0]!.body).toContain(`Mailed coordinator ${COORDINATOR}`);
    warn.mockRestore();
    f.stop();
  });

  it('a mail that throws is retried on the next sweep, and leaves exactly one record', async () => {
    const f = await harness(openLine({ queue: 'dequeued', queueAt: T1 }));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    // `hasOutstandingMail` is `queueSystemMail`'s first statement: a throw
    // there is `node:sqlite`'s 'database is locked' reaching the lane.
    const real = f.coord.hasOutstandingMail.bind(f.coord);
    let n = 0;
    vi.spyOn(f.coord, 'hasOutstandingMail').mockImplementation((...a) => {
      if (n++ === 0) throw new Error('database is locked');
      return real(...a);
    });
    await f.sweep();
    expect(f.mail()).toEqual([]);
    expect(f.queueFeed(), 'a record was left for a notice that was never sent').toEqual([]);
    await f.sweep();
    expect(f.mail(), 'the thrown notice was never retried').toHaveLength(1);
    expect(f.queueFeed()).toHaveLength(1);
    warn.mockRestore();
    f.stop();
  });

  it('a restart re-announces no dequeue it already mailed — acked or not — and still hears a new removal', async () => {
    const f = await harness(openLine({ queue: 'dequeued', queueAt: T1 }));
    await f.sweep();
    const m = f.mail();
    expect(m).toHaveLength(1);
    // Acked, so `queueSystemMail`'s OUTSTANDING-only dedupe no longer sees it.
    f.coord.markAcked(m[0]!.deliveryId, Date.now());
    f.restart();
    await f.sweep();
    expect({ mail: f.mail().length, feed: f.queueFeed().length }).toEqual({ mail: 1, feed: 1 });
    await f.sweep(openLine({ queue: 'dequeued', queueAt: T2 }));
    expect({ mail: f.mail().length, feed: f.queueFeed().length }).toEqual({ mail: 2, feed: 2 });
    f.stop();
  });

  it('a restart re-records no feed-only dequeue either', async () => {
    const f = await harness(openLine({ queue: 'dequeued', queueAt: T1 }), { run: 'other' });
    await f.sweep();
    f.restart();
    await f.sweep();
    expect(f.queueFeed()).toHaveLength(1);
    expect(f.mail()).toEqual([]);
    f.stop();
  });

  it('a merge whose run row cannot be read defers, and a merged notice whose mail throws is retried — neither is latched as told', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const f = await harness(mergedLine());
    const realRun = f.coord.run.bind(f.coord);
    let n = 0;
    vi.spyOn(f.coord, 'run').mockImplementation((id) => (n++ === 0
      ? { ok: false as const, kind: 'run-unreadable' as const, detail: 'fixture' } : realRun(id)));
    await f.sweep();
    expect(f.mail(), 'an unreadable run row was read as "not at merging"').toEqual([]);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('deferred (run rows unreadable: fixture)'));
    await f.sweep();
    expect(f.mail(), 'the deferred merged notice was never sent').toHaveLength(1);
    f.stop();
    const g = await harness(mergedLine());
    const real = g.coord.hasOutstandingMail.bind(g.coord);
    let k = 0;
    vi.spyOn(g.coord, 'hasOutstandingMail').mockImplementation((...a) => {
      if (k++ === 0) throw new Error('database is locked');
      return real(...a);
    });
    await g.sweep();
    expect(g.mail()).toEqual([]);
    await g.sweep();
    expect(g.mail(), 'the thrown merged notice was never retried').toHaveLength(1);
    warn.mockRestore();
    g.stop();
  });

  it('a restart re-mails no merge it already told — acked', async () => {
    const f = await harness(mergedLine());
    await f.sweep();
    const m = f.mail();
    expect(m).toHaveLength(1);
    f.coord.markAcked(m[0]!.deliveryId, Date.now());
    f.restart();
    await f.sweep();
    expect(f.mail()).toHaveLength(1);
    f.stop();
  });
});

// D-5860 (Task C1f): the landing step's feed-only "already told" read (`toldFeed`) is `hasNotice('queue', id, key)`
// on the removal's key, which every dequeue row carries, mailed or not. Step 1 pinned these rows on the body read;
// Step 3 changed only the rows OA-C3 ruled (operator, 2026-10-21: "A: the label decides"), each marked RULED with what
// it did before. Rows (a), (b) and (e) of the plan's table are "with no open run, records the feed event and mails
// nobody", the same block's second sweep, and "a restart re-records no feed-only dequeue either" above. The mailed
// path's read (`hasMailWithSubject`) is not a feed read and is not C1f's.
describe('C1f: the landing step\'s feed-only "already told" is the removal\'s key (D-5860, OA-C3 ruled A)', () => {
  const TAG = `queue-${ID}#42:dequeued@${T1}`;
  // RULED (OA-C3, A). Before: a second row and push, "No open run names a coordinator to tell."
  it('(c) told WITH a coordinator, then the run fails, then a restart: the same removal is NOT recorded or pushed again', async () => {
    const f = await harness(openLine({ queue: 'dequeued', queueAt: T1 }));
    await f.sweep();
    expect(f.queueFeed().map((e) => e.body)).toEqual([expect.stringContaining(`Mailed coordinator ${COORDINATOR}.`)]);
    expect(f.coord.advance(f.runId!, 'failed', 'test').ok).toBe(true);
    // Same process: the in-memory latch holds, whatever the run did.
    await f.sweep();
    expect(f.queueFeed()).toHaveLength(1);
    f.restart();
    await f.sweep();
    // The second read asks the feed (no open run names a coordinator now): the mailed row carries the same key.
    expect(f.queueFeed().map((e) => e.body)).toEqual([expect.stringContaining(`Mailed coordinator ${COORDINATOR}.`)]);
    expect(f.mail()).toHaveLength(1);
    expect(f.sent.filter((p) => p.tag === TAG)).toHaveLength(1);
    f.stop();
  });
  // RULED (OA-C3, A). Before: a second row and push.
  it('(c) the feed-only row\'s body changed (a reworded deploy), then a restart: NOT recorded or pushed again', async () => {
    const f = await harness(openLine({ queue: 'dequeued', queueAt: T1 }), { run: 'other' });
    await f.sweep();
    f.coord.db.prepare("UPDATE feed_events SET body = ? WHERE kind = 'queue'").run(`PR #42 was dequeued (an earlier wording) (removed ${T1})`);
    f.restart();
    await f.sweep();
    expect(f.queueFeed()).toHaveLength(1);
    expect(f.sent.filter((p) => p.tag === TAG)).toHaveLength(1);
    expect(f.mail()).toEqual([]);
    f.stop();
  });
  // Departure `dedupe-key-legacy-text`: a row archived BEFORE the key (NULL) is still matched by its body, so the
  // deploy itself re-sends nothing.
  it('a row archived before the key is matched by its body: a restart onto the new build re-sends nothing', async () => {
    const f = await harness(openLine({ queue: 'dequeued', queueAt: T1 }), { run: 'other' });
    await f.sweep();
    f.coord.db.prepare("UPDATE feed_events SET dedupe_key = NULL WHERE kind = 'queue'").run();
    f.restart();
    await f.sweep();
    expect(f.queueFeed()).toHaveLength(1);
    expect(f.sent.filter((p) => p.tag === TAG)).toHaveLength(1);
    f.stop();
  });
  it('a SECOND removal of the same PR, after a restart, is a new key: recorded and pushed (unchanged)', async () => {
    const f = await harness(openLine({ queue: 'dequeued', queueAt: T1 }), { run: 'other' });
    await f.sweep();
    f.restart();
    await f.sweep(openLine({ queue: 'dequeued', queueAt: T2 }));
    expect(f.queueFeed().map((e) => e.body)).toEqual([
      expect.stringContaining(`(removed ${T1})`), expect.stringContaining(`(removed ${T2})`)]);
    expect(f.mail()).toEqual([]);
    f.stop();
  });
  it('(d)+(e) a ring restart (a new epoch) and a restart: the archived row is matched whatever epoch wrote it', async () => {
    const f = await harness(openLine({ queue: 'dequeued', queueAt: T1 }), { run: 'other' });
    await f.sweep();
    const before = (f.deps as unknown as { notifyLog: NotifyLog }).notifyLog;
    const fresh = new NotifyLog(path.join(mkTmp('ccrc-queue-ring-'), 'notify.json'));
    await fresh.load();
    expect(fresh.epoch).not.toBe(before.epoch);
    (f.deps as unknown as { notifyLog: NotifyLog }).notifyLog = fresh;
    f.restart();
    await f.sweep();
    expect(f.queueFeed()).toHaveLength(1);
    expect(f.sent.filter((p) => p.tag === TAG)).toHaveLength(1);
    f.stop();
  });
});

// Landing-order wave 3d: the merged lane's feed row is once per (workspace, PR) across a restart, as the queue and
// nudge rows are. The in-memory `mergedNotified` is this process's latch; the archive is every process's. Measured
// 2026-10-21: a server restart wrote a merged PR's `merged` row a second time while its run waited at `merging`.
describe('the merged feed row is once-only across a restart (landing-order wave 3d)', () => {
  const TAG = `merged-${ID}#42`;
  const mergedFeed = (f: Awaited<ReturnType<typeof harness>>) => f.coord.feedEvents(200).filter((e) => e.kind === 'merged');

  it('a restart writes no second merged row and sends no second push', async () => {
    const f = await harness(mergedLine());
    await f.sweep();
    expect(mergedFeed(f)).toHaveLength(1);
    f.restart();
    const reads = vi.spyOn(f.coord, 'hasNotice');
    await f.sweep();
    await f.sweep();
    expect(mergedFeed(f)).toHaveLength(1);
    expect(f.sent.filter((p) => p.tag === TAG)).toHaveLength(1);
    expect(f.mail()).toHaveLength(1);
    // The durable hit latches in memory too: one read per process, not one per sweep.
    expect(reads.mock.calls.filter((c) => c[0] === 'merged')).toHaveLength(1);
    f.stop();
  });

  it('the key matches when the body changed across the restart: the run closed, so the reason clause went', async () => {
    const f = await harness(mergedLine());
    await f.sweep();
    expect(mergedFeed(f).map((e) => e.body)).toEqual([expect.stringContaining(`run ${f.runId} is still open`)]);
    expect(f.coord.advance(f.runId!, 'failed', 'test').ok).toBe(true);
    f.restart();
    await f.sweep();
    expect(mergedFeed(f)).toHaveLength(1);
    expect(f.sent.filter((p) => p.tag === TAG)).toHaveLength(1);
    f.stop();
  });

  it('a row archived before the key, its body unchanged, is matched by that body: no repeat', async () => {
    const f = await harness(mergedLine());
    await f.sweep();
    f.coord.db.prepare("UPDATE feed_events SET dedupe_key = NULL WHERE kind = 'merged'").run();
    f.restart();
    await f.sweep();
    expect(mergedFeed(f)).toHaveLength(1);
    expect(f.sent.filter((p) => p.tag === TAG)).toHaveLength(1);
    f.stop();
  });

  it('a row archived before the key whose body has changed since is announced ONCE more, at the deploy, then never', async () => {
    // The third repeat by design: the usual merged workspace was a queue landing whose run waited at `merging`, so its
    // pre-key row names the open run; the coordinator closed that run since, so the body the new code builds differs,
    // and the row has no key to match. The repeat writes a keyed row, so the restart after it matches by key.
    const f = await harness(mergedLine());
    await f.sweep();
    f.coord.db.prepare("UPDATE feed_events SET dedupe_key = NULL WHERE kind = 'merged'").run();
    expect(f.coord.advance(f.runId!, 'failed', 'test').ok).toBe(true);
    f.restart();
    await f.sweep();
    expect(mergedFeed(f).map((e) => e.body)).toEqual([
      expect.stringContaining(`run ${f.runId} is still open`), 'PR #42 merged; nothing archived.']);
    expect(f.sent.filter((p) => p.tag === TAG)).toHaveLength(2);
    f.restart();
    await f.sweep();
    expect(mergedFeed(f)).toHaveLength(2);
    expect(f.sent.filter((p) => p.tag === TAG)).toHaveLength(2);
    f.stop();
  });

  it('a SECOND PR from the same workspace is a new key: recorded and pushed', async () => {
    const f = await harness(mergedLine());
    await f.sweep();
    f.restart();
    await f.sweep(mergedLine({}, 43));
    expect(mergedFeed(f).map((e) => e.body)).toEqual([expect.stringContaining('PR #42 merged'), expect.stringContaining('PR #43 merged')]);
    f.stop();
  });

  it('a durable read that throws announces, as before the read existed, and costs the landing lane nothing', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const f = await harness(mergedLine());
    vi.spyOn(f.coord, 'hasNotice').mockImplementation(() => { throw new Error('database is locked'); });
    await f.sweep();
    expect(mergedFeed(f)).toHaveLength(1);
    expect(f.sent.filter((p) => p.tag === TAG)).toHaveLength(1);
    expect(f.mail(), 'the throw cost sweepLanding its sweep').toHaveLength(1);
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/^ccrc-server: merged notice read for demo-quiet-basin failed \(database is locked\)/));
    warn.mockRestore();
    f.stop();
  });
});
