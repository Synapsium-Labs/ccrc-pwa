// The archive door's decision (workspace lifecycle spec §5.2), driven through its declared port: the ORDER of its
// refusals, the one act it takes, and how ccd's answer reaches the wire.
import { describe, it, expect } from 'vitest';
import {
  archiveFlags, archiveOutcome, busyReadFailsClosed, ccdArchiveRefusal, decideArchive, refusedAtStop, stopVerdict, worktreeOf,
  type ArchiveCoordPort, type ArchiveMeasure, type StopReadings,
} from '../src/coord/archiveDoor.js';
import type { CloseOutcome } from '../src/coord/close.js';
import type { OpenSibling, OpenSiblingsResult } from '../src/coord/store.js';

const run = (id: number, wave = 1): OpenSibling => ({ id, program: 'lifecycle', wave, waveOf: 3 });
const NONE = { force: false, interrupt: false, programmeEnd: false };
const IDLE_WS: ArchiveMeasure = { workspace: true, turn: 'idle', worktree: 'present', verbSupported: true };
const IDLE_MAIN: ArchiveMeasure = { workspace: false, turn: 'idle', worktree: 'present', verbSupported: false };
const UNREADABLE: OpenSiblingsResult = { ok: false, kind: 'run-unreadable', detail: 'runs.wave' };

/** A port double that records every read and every abandon, in order. `blocked`: what the abandon arm would refuse
 *  from a run's row alone (the pre-read); `refuse`: what an abandon refuses AT the act; `throws`: a store that throws. */
const port = (o: { worker?: OpenSiblingsResult; claimed?: OpenSiblingsResult;
  blocked?: Record<number, Extract<CloseOutcome, { ok: false }>>;
  refuse?: Record<number, Extract<CloseOutcome, { ok: false }>>;
  throws?: { worker?: boolean; claimed?: boolean; blocked?: number; abandon?: number } } = {}) => {
  const seen: string[] = [];
  const p: ArchiveCoordPort = {
    openRunsForSession: (id) => {
      seen.push(`worker:${id}`);
      if (o.throws?.worker === true) throw new Error('database is not open');
      return o.worker ?? { ok: true, siblings: [] };
    },
    openRunsClaimedBy: (id) => {
      seen.push(`claimant:${id}`);
      if (o.throws?.claimed === true) throw new Error('database is not open');
      return o.claimed ?? { ok: true, siblings: [] };
    },
    abandonRefusal: (runId) => {
      seen.push(`can:${runId}`);
      if (o.throws?.blocked === runId) throw new TypeError('transitions undefined');
      return o.blocked?.[runId] ?? null;
    },
    abandon: async (runId) => {
      seen.push(`abandon:${runId}`);
      if (o.throws?.abandon === runId) throw new Error('SQLITE_BUSY: database is locked');
      return o.refuse?.[runId]
        ?? { ok: true, id: runId, state: 'failed', released: true, childReclaim: 'not-queued' } as CloseOutcome;
    },
  };
  return { p, seen };
};

describe('archiveFlags', () => {
  it('reads an absent body as no consent at all', () => {
    expect(archiveFlags(undefined)).toEqual(NONE);
    expect(archiveFlags(null)).toEqual(NONE);
    expect(archiveFlags({})).toEqual(NONE);
  });

  it('reads each consent as given, and `force`/`interrupt` only as true — as `force` always was', () => {
    expect(archiveFlags({ force: true, interrupt: true, programme: 'end' }))
      .toEqual({ force: true, interrupt: true, programmeEnd: true });
    expect(archiveFlags({ force: 'yes', interrupt: 1 })).toEqual(NONE);
  });

  it('refuses a programme word that is not exactly "end", and a body that is not an object', () => {
    for (const bad of [{ programme: 'keep' }, { programme: true }, { programme: 'END' }, [], 'end', 7]) {
      expect(archiveFlags(bad)).toBeNull();
    }
  });
});

describe('worktreeOf', () => {
  it('tells a present worktree from a proven absence from a read that failed', () => {
    expect(worktreeOf({ ok: true, mtimeMs: 1, size: 1 })).toBe('present');
    expect(worktreeOf({ ok: false, reason: 'absent' })).toBe('absent');
    expect(worktreeOf({ ok: false, reason: 'unreadable' })).toBe('unmeasured');
  });
});

describe('decideArchive — every check that can refuse runs before any act', () => {
  it('refuses a turn in progress first, reading nothing from the store', async () => {
    const { p, seen } = port({ claimed: { ok: true, siblings: [run(1)] } });
    expect(await decideArchive(p, 'demo-a', NONE, { ...IDLE_WS, turn: 'busy' }))
      .toEqual({ ok: false, reply: { status: 409, body: { ok: false, error: 'session-busy' } } });
    expect(seen).toEqual([]);
  });

  it('a busy row with `interrupt` proceeds, and the stop comes first', async () => {
    const { p } = port();
    expect(await decideArchive(p, 'demo-a', { ...NONE, interrupt: true }, { ...IDLE_WS, turn: 'busy' }))
      .toEqual({ ok: true, stop: true, wsArchive: true, ended: [] });
  });

  it('an idle workspace is archived without a stop; a main checkout is stopped and never reaches ws-archive', async () => {
    expect(await decideArchive(port().p, 'demo-a', NONE, IDLE_WS)).toEqual({ ok: true, stop: false, wsArchive: true, ended: [] });
    expect(await decideArchive(port().p, 'claude-demo', NONE, IDLE_MAIN))
      .toEqual({ ok: true, stop: true, wsArchive: false, ended: [] });
  });

  it('a busy main checkout without `interrupt` refuses too — busy is read for both kinds of row', async () => {
    expect(await decideArchive(port().p, 'claude-demo', NONE, { ...IDLE_MAIN, turn: 'busy' }))
      .toMatchObject({ ok: false, reply: { status: 409, body: { error: 'session-busy' } } });
  });

  // D-3881: a turn nobody could MEASURE is its own word. `interrupt` consents to losing a turn that was measured in
  // progress, never to acting on a state nobody could read, so the refusal comes first and ignores the consents.
  it.each([
    ['a workspace', 'demo-a', IDLE_WS], ['a main checkout', 'claude-demo', IDLE_MAIN],
  ] as const)('an UNMEASURED turn on %s is 409 status-unknown with and without `interrupt`, and the port is never called', async (_k, id, base) => {
    for (const flags of [NONE, { ...NONE, interrupt: true }, { force: true, interrupt: true, programmeEnd: true }]) {
      const { p, seen } = port({ claimed: { ok: true, siblings: [run(1)] } });
      expect(await decideArchive(p, id, flags, { ...base, turn: 'unmeasured' }))
        .toEqual({ ok: false, reply: { status: 409, body: { ok: false, error: 'status-unknown' } } });
      expect(seen).toEqual([]);
    }
  });

  it('an unmeasured turn is refused before a gone worktree is: the first check is the read nobody could make', async () => {
    expect(await decideArchive(port().p, 'demo-a', NONE, { ...IDLE_WS, turn: 'unmeasured', worktree: 'absent' }))
      .toMatchObject({ reply: { body: { error: 'status-unknown' } } });
  });

  it('refuses a workspace whose worktree is PROVEN gone, before the store is asked', async () => {
    const gone = port({ claimed: { ok: true, siblings: [run(1)] } });
    expect(await decideArchive(gone.p, 'demo-a', { ...NONE, programmeEnd: true }, { ...IDLE_WS, worktree: 'absent' }))
      .toEqual({ ok: false, reply: { status: 409, body: { ok: false, error: 'worktree-gone' } } });
    expect(gone.seen).toEqual([]);
  });

  it('an UNMEASURED worktree is not a refusal — in remote mode this box cannot read one; ccd measures it', async () => {
    const { p, seen } = port({ claimed: { ok: true, siblings: [run(1)] } });
    expect(await decideArchive(p, 'demo-c', { ...NONE, programmeEnd: true }, { ...IDLE_WS, worktree: 'unmeasured' }))
      .toEqual({ ok: true, stop: false, wsArchive: true, ended: [run(1)] });
    expect(seen).toEqual(['worker:demo-c', 'claimant:demo-c', 'can:1', 'abandon:1']);
  });

  it('refuses `run-open` naming the runs, or with EMPTY runs when they could not be read — and `force` skips it', async () => {
    expect(await decideArchive(port({ worker: { ok: true, siblings: [run(4)] } }).p, 'demo-a', NONE, IDLE_WS))
      .toEqual({ ok: false, reply: { status: 409, body: { ok: false, error: 'run-open', runs: [run(4)] } } });
    expect(await decideArchive(port({ worker: UNREADABLE }).p, 'demo-a', NONE, IDLE_WS))
      .toEqual({ ok: false, reply: { status: 409, body: { ok: false, error: 'run-open', runs: [], detail: 'runs.wave' } } });
    const forced = port({ worker: { ok: true, siblings: [run(4)] } });
    expect(await decideArchive(forced.p, 'demo-a', { ...NONE, force: true }, IDLE_WS)).toMatchObject({ ok: true });
    expect(forced.seen).toEqual(['claimant:demo-a']);
  });

  it('refuses a coordinator with open runs, naming them, and ends nothing without `programme:"end"`', async () => {
    const { p, seen } = port({ claimed: { ok: true, siblings: [run(7), run(8, 2)] } });
    expect(await decideArchive(p, 'demo-c', NONE, IDLE_WS)).toEqual({ ok: false, reply: { status: 409,
      body: { ok: false, error: 'coordinator-has-open-runs', runs: [run(7), run(8, 2)] } } });
    expect(seen).toEqual(['worker:demo-c', 'claimant:demo-c']);
  });

  it('an unreadable store refuses fail-shut with `runs: []` — even with `programme:"end"`', async () => {
    const { p, seen } = port({ claimed: UNREADABLE });
    expect(await decideArchive(p, 'demo-c', { ...NONE, programmeEnd: true }, IDLE_WS)).toEqual({ ok: false,
      reply: { status: 409, body: { ok: false, error: 'coordinator-has-open-runs', runs: [], detail: 'runs.wave' } } });
    expect(seen.filter((s) => s.startsWith('abandon'))).toEqual([]);
  });

  it('a store read that THROWS is an unreadable store — the same fail-shut refusals, never a rejection (a 500)', async () => {
    expect(await decideArchive(port({ throws: { worker: true } }).p, 'demo-a', NONE, IDLE_WS))
      .toEqual({ ok: false, reply: { status: 409, body: { ok: false, error: 'run-open', runs: [], detail: 'database is not open' } } });
    const { p, seen } = port({ throws: { claimed: true } });
    expect(await decideArchive(p, 'demo-c', { ...NONE, force: true, programmeEnd: true }, IDLE_WS)).toEqual({ ok: false,
      reply: { status: 409, body: { ok: false, error: 'coordinator-has-open-runs', runs: [], detail: 'database is not open' } } });
    expect(seen).toEqual(['claimant:demo-c']);
  });

  it('refuses a box whose ccd predates ws-archive AFTER the claim checks and BEFORE ending anything', async () => {
    const claimedWs = port({ worker: { ok: true, siblings: [run(4)] } });
    expect(await decideArchive(claimedWs.p, 'demo-a', NONE, { ...IDLE_WS, verbSupported: false }))
      .toMatchObject({ reply: { status: 409, body: { error: 'run-open' } } });
    const coordinator = port({ claimed: { ok: true, siblings: [run(7)] } });
    expect(await decideArchive(coordinator.p, 'demo-c', { ...NONE, programmeEnd: true }, { ...IDLE_WS, verbSupported: false }))
      .toEqual({ ok: false, reply: { status: 501, body: { ok: false, error: 'unsupported' } } });
    expect(coordinator.seen.filter((s) => s.startsWith('abandon'))).toEqual([]);
  });

  it('`programme:"end"` abandons every run it coordinates, in id order, and then proceeds', async () => {
    const { p, seen } = port({ claimed: { ok: true, siblings: [run(7), run(8, 2)] } });
    expect(await decideArchive(p, 'demo-c', { ...NONE, programmeEnd: true }, IDLE_WS))
      .toEqual({ ok: true, stop: false, wsArchive: true, ended: [run(7), run(8, 2)] });
    expect(seen).toEqual(['worker:demo-c', 'claimant:demo-c', 'can:7', 'can:8', 'abandon:7', 'abandon:8']);
  });

  it('a run the abandon arm cannot move from its row alone is found BEFORE any run is ended — whatever its id order', async () => {
    const closing = { ok: false, kind: 'bad-transition', from: 'closing', to: 'closing' } as const;
    for (const blockedId of [7, 9]) {
      const { p, seen } = port({ claimed: { ok: true, siblings: [run(7), run(8, 2), run(9, 3)] }, blocked: { [blockedId]: closing } });
      expect(await decideArchive(p, 'demo-c', { ...NONE, programmeEnd: true, interrupt: true }, IDLE_WS)).toEqual({
        ok: false, reply: { status: 409, body: { ok: false, error: 'programme-partly-ended',
          closed: [], notClosed: [run(7), run(8, 2), run(9, 3)],
          refusal: { id: blockedId, kind: 'bad-transition', detail: 'closing → closing' } } } });
      expect(seen.filter((s) => s.startsWith('abandon'))).toEqual([]);
    }
  });

  it('stops at the first run an abandon refuses AT the act: programme-partly-ended, naming closed and not closed', async () => {
    const { p, seen } = port({ claimed: { ok: true, siblings: [run(7), run(8, 2), run(9, 3)] },
      refuse: { 8: { ok: false, kind: 'fleetFailed', stderr: 'ccd: lock busy\n' } } });
    expect(await decideArchive(p, 'demo-c', { ...NONE, programmeEnd: true, interrupt: true }, IDLE_WS)).toEqual({
      ok: false, reply: { status: 409, body: { ok: false, error: 'programme-partly-ended',
        closed: [run(7)], notClosed: [run(8, 2), run(9, 3)],
        refusal: { id: 8, kind: 'fleetFailed', detail: 'ccd: lock busy' } } } });
    expect(seen).toEqual(['worker:demo-c', 'claimant:demo-c', 'can:7', 'can:8', 'can:9', 'abandon:7', 'abandon:8']);
  });

  it('an abandon that THROWS after another run was ended still names what it closed — never a rejection', async () => {
    const { p, seen } = port({ claimed: { ok: true, siblings: [run(7), run(8, 2)] }, throws: { abandon: 8 } });
    expect(await decideArchive(p, 'demo-c', { ...NONE, programmeEnd: true }, IDLE_WS)).toEqual({
      ok: false, reply: { status: 409, body: { ok: false, error: 'programme-partly-ended',
        closed: [run(7)], notClosed: [run(8, 2)],
        refusal: { id: 8, kind: 'threw', detail: 'SQLITE_BUSY: database is locked' } } } });
    expect(seen).toEqual(['worker:demo-c', 'claimant:demo-c', 'can:7', 'can:8', 'abandon:7', 'abandon:8']);
  });

  it('a pre-read that THROWS ends nothing and says which run it was reading', async () => {
    const { p, seen } = port({ claimed: { ok: true, siblings: [run(7), run(8, 2)] }, throws: { blocked: 8 } });
    expect(await decideArchive(p, 'demo-c', { ...NONE, programmeEnd: true }, IDLE_WS)).toEqual({
      ok: false, reply: { status: 409, body: { ok: false, error: 'programme-partly-ended',
        closed: [], notClosed: [run(7), run(8, 2)],
        refusal: { id: 8, kind: 'threw', detail: 'transitions undefined' } } } });
    expect(seen.filter((s) => s.startsWith('abandon'))).toEqual([]);
  });

  it('a box with no coordination archives exactly as before — no store, no claim checks', async () => {
    expect(await decideArchive(null, 'demo-a', NONE, IDLE_WS)).toEqual({ ok: true, stop: false, wsArchive: true, ended: [] });
  });
});

describe('ccdArchiveRefusal — ccd\'s die lines, and only them', () => {
  it.each([
    ['ccd: session-busy\n', 'session-busy'],
    ['ccd: status-unknown\n', 'status-unknown'],
    ['ccd: worktree is gone: /w/demo-a — cannot describe it for the archive record; see: ccd ws-attic --session demo-a\n', 'worktree-gone'],
    ['_ws_archive_manifest: /w/x is not a worktree of /p/demo\nccd: cannot describe demo-a truthfully — nothing was touched\n', 'manifest-unbuildable'],
    ['ccd: empty archive manifest for demo-a — nothing was touched\n', 'manifest-unbuildable'],
    ['ccd: archive manifest for demo-a is not valid JSON — nothing was touched\n', 'manifest-unbuildable'],
  ] as const)('%j → %s', (stderr, want) => {
    expect(ccdArchiveRefusal(stderr)).toBe(want);
  });

  it.each([
    'ccd: no such session: demo-a', 'ccd: incomplete registry for \'demo-a\'', 'agent unreachable',
    'ccd: session-busy-ish', 'echo ccd: session-busy', '',
  ])('%j has no word', (stderr) => {
    expect(ccdArchiveRefusal(stderr)).toBeNull();
  });
});

describe('archiveOutcome — ws-archive\'s answer on the wire', () => {
  it('archived', () => {
    expect(archiveOutcome(false, [], { ok: true, stderr: '' }))
      .toEqual({ status: 200, body: { ok: true, archived: true, stopped: false, ended: [] } });
  });

  it('the partial outcome: stopped, then refused — 200, the row stays at the top level', () => {
    expect(archiveOutcome(true, [], { ok: false, stderr: 'ccd: status-unknown\n' })).toEqual({ status: 200,
      body: { ok: true, archived: false, stopped: true, ended: [], refusal: 'status-unknown', detail: 'ccd: status-unknown' } });
  });

  it('a refusal with nothing stopped is ccd\'s word as a 409 — the race after the live read included', () => {
    expect(archiveOutcome(false, [], { ok: false, stderr: 'ccd: session-busy\n' }))
      .toEqual({ status: 409, body: { ok: false, error: 'session-busy', detail: 'ccd: session-busy' } });
  });

  it('a refusal this build has no word for keeps today\'s 502 {stderr}, byte for byte', () => {
    expect(archiveOutcome(false, [], { ok: false, stderr: 'ccd: no such session: x\n' }))
      .toEqual({ status: 502, body: { ok: false, stderr: 'ccd: no such session: x\n' } });
  });

  it('says a programme was ended on every answer after it', () => {
    expect(archiveOutcome(false, [run(7)], { ok: false, stderr: 'boom' }).body).toMatchObject({ ended: [run(7)] });
    expect(archiveOutcome(false, [run(7)], { ok: false, stderr: 'ccd: status-unknown' }).body).toMatchObject({ ended: [run(7)] });
  });
});

// D-3878: the verdict rule `server.ts` used to hold in `idleForStop` — a DECISION, so it lives here, over what the
// route measured. D-3881 made it three-valued (3878's `stopIsIdle` answered a boolean). One case per arm; `server.ts`
// keeps only the reads (and `archive-door.test.ts` the wiring).
describe('stopVerdict — a stop read fail-closed (D-3841), with "could not measure" its own word (D-3881)', () => {
  const live = (over: Partial<Extract<StopReadings, { pane: 'live'; pid: number }>> = {}): StopReadings => ({
    configDir: 'present', pane: 'live', pid: 4242,
    liveFile: { read: 'ok', status: 'idle' }, row: { status: 'idle', bucket: 'idle' }, ...over,
  });

  it('a pane that is gone, under a wrapper with a config dir, is idle: nothing is running, so there is no turn to lose', () => {
    expect(stopVerdict({ configDir: 'present', pane: 'gone' })).toBe('idle');
  });

  it('a wrapper with no config dir is UNMEASURED whatever its pane did — ccd reads the config dir BEFORE the tmux verdict (`cfg=$(_cfg_dir "$wrapper"); [[ -n "$cfg" ]] || return 1`), so a gone pane is not idle there', () => {
    expect(stopVerdict({ configDir: 'none' })).toBe('unmeasured');
    // There is no way to say "gone without a config dir": the reading has no `pane` to carry.
    // @ts-expect-error `pane` belongs to the `present` arms only
    expect(stopVerdict({ configDir: 'none', pane: 'gone' })).toBe('unmeasured');
  });

  it('a pane tmux could not be asked about is UNMEASURED — `unknown` is neither `gone` nor busy', () => {
    expect(stopVerdict({ configDir: 'present', pane: 'unknown' })).toBe('unmeasured');
  });

  it('a live pane whose pid could not be read is unmeasured', () => {
    expect(stopVerdict({ configDir: 'present', pane: 'live', pid: 'unread' })).toBe('unmeasured');
  });

  it('a live pane is idle only when its live file affirmatively says idle: an ALLOWLIST', () => {
    expect(stopVerdict(live())).toBe('idle');
    expect(stopVerdict(live({ liveFile: { read: 'ok', status: 'busy' } }))).toBe('busy');
    expect(stopVerdict(live({ liveFile: { read: 'ok', status: 'waiting' } }))).toBe('busy');
    expect(stopVerdict(live({ liveFile: { read: 'ok', status: 'some-new-word' } }))).toBe('busy');
  });

  // ccd's `_ws_status` extracts the word with `grep -oE '"status":"[a-z_-]+"'` and returns 1 when that finds nothing,
  // so a word it could not extract is a state it could not read. `readLiveStateMeasured` answers `status: ''` for a
  // file with a `sessionId` and no `status` (F1, review 243).
  it('a status word ccd could not extract is UNMEASURED, not busy: empty, capitals, digits', () => {
    for (const status of ['', 'Idle', 'BUSY', 'busy2', 'a b', '1']) {
      expect(stopVerdict(live({ liveFile: { read: 'ok', status } })), JSON.stringify(status)).toBe('unmeasured');
    }
    expect(stopVerdict(live({ liveFile: { read: 'ok', status: 'some-new-word' } }))).toBe('busy');
    expect(stopVerdict(live({ liveFile: { read: 'ok', status: 'under_score' } }))).toBe('busy');
  });

  it('a live pane whose live file is absent or unread is unmeasured, not busy (ccd: `[[ -f $sf ]] || return 1`)', () => {
    expect(stopVerdict(live({ liveFile: { read: 'no-state' } }))).toBe('unmeasured');
    expect(stopVerdict(live({ liveFile: { read: 'unmeasured' } }))).toBe('unmeasured');
  });

  it('a live pane whose live file says idle is still busy while the frame row reports a turn or a question', () => {
    expect(stopVerdict(live({ row: { status: 'busy', bucket: 'idle' } }))).toBe('busy');
    expect(stopVerdict(live({ row: { status: 'idle', bucket: 'working' } }))).toBe('busy');
    expect(stopVerdict(live({ row: { status: 'idle', bucket: 'attention' } }))).toBe('busy');
  });

  // ccd reads no frame row at all: this arm is the SERVER's own, stricter than ccd.
  it('a live pane with no frame row is unmeasured: no row is no measurement (the server\'s own arm, stricter than ccd)', () => {
    expect(stopVerdict(live({ row: 'missing' }))).toBe('unmeasured');
  });

  it('a live file that MEASURED a turn is busy even when the frame row is missing: a read turn is not an unread one', () => {
    expect(stopVerdict(live({ liveFile: { read: 'ok', status: 'busy' }, row: 'missing' }))).toBe('busy');
  });
});

// D-3877, D-3881: which read answers the turn verdict. The decision is here; `server.ts` obeys it when it builds
// `ArchiveMeasure.turn`.
describe('busyReadFailsClosed — which read answers the turn verdict before any act', () => {
  it('a main checkout is always read fail-closed: its stop refuses nothing', () => {
    for (const flags of [NONE, { ...NONE, programmeEnd: true }, { ...NONE, interrupt: true },
      { force: true, interrupt: true, programmeEnd: true }]) {
      expect(busyReadFailsClosed(false, flags)).toBe(true);
    }
  });

  it('a workspace is read fail-closed when the programme is to END, with or without `interrupt`: the end is irreversible', () => {
    expect(busyReadFailsClosed(true, { ...NONE, programmeEnd: true })).toBe(true);
    expect(busyReadFailsClosed(true, { force: true, interrupt: false, programmeEnd: true })).toBe(true);
    // `interrupt` consents to a MEASURED turn lost, never to acting on a state nobody could read (D-3881).
    expect(busyReadFailsClosed(true, { force: false, interrupt: true, programmeEnd: true })).toBe(true);
  });

  // F7 (review 243, ruled by the coordinator): the stop `interrupt` brings precedes `ws-archive`'s `_ws_status`, so ccd
  // cannot catch an unreadable pane afterwards. The frame row folds tmux `unknown` to dead and leaves an unread pid or an
  // absent live file idle, so an ordinary workspace archive with `interrupt` would STOP a pane nobody could read.
  it('a workspace with `interrupt` alone is read fail-closed too: its stop runs BEFORE ccd\'s own read', () => {
    expect(busyReadFailsClosed(true, { ...NONE, interrupt: true })).toBe(true);
    expect(busyReadFailsClosed(true, { force: true, interrupt: true, programmeEnd: false })).toBe(true);
  });

  it('a workspace with neither `interrupt` nor a programme end keeps the frame\'s own row, with ccd\'s `_ws_status` behind it at ws-archive', () => {
    for (const flags of [NONE, { ...NONE, force: true }]) {
      expect(busyReadFailsClosed(true, flags)).toBe(false);
    }
  });
});

// D-3881: the stop's own re-read refused — one word per verdict, chosen in L1.
describe('refusedAtStop — the re-read at the stop, one word per verdict', () => {
  it('a measured busy is `session-busy`, an unmeasured one `status-unknown`', () => {
    expect(refusedAtStop('busy', [])).toEqual({ status: 409, body: { ok: false, error: 'session-busy' } });
    expect(refusedAtStop('unmeasured', [])).toEqual({ status: 409, body: { ok: false, error: 'status-unknown' } });
  });

  it('carries `ended` only when a programme was ended, for either word', () => {
    expect(refusedAtStop('busy', [run(7)]).body).toEqual({ ok: false, error: 'session-busy', ended: [run(7)] });
    expect(refusedAtStop('unmeasured', [run(7)]).body).toEqual({ ok: false, error: 'status-unknown', ended: [run(7)] });
  });
});
