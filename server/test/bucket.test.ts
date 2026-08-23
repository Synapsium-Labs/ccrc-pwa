import { describe, it, expect } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
// The ladder lives in `shared/` because `reviveFleetSession` is its second
// producer — see its docstring, and fleetstate.test.ts's derivation suite.
import { sessionBucket, SESSION_LIFECYCLES, type BucketInput } from '../../shared/api.js';
import { loadConfig } from '../src/config.js';
import { assembleFleet } from '../src/fleet.js';
import { Tmux, type Runner } from '../src/exec.js';
import { localIO } from '../src/io.js';
import type { HookState } from '../src/hookstate.js';
import { mkTmp } from './tmpHelpers.js';
import { seedRoster } from './helpers.js';

const base: BucketInput = {
  status: 'idle', statusUpdatedAt: 1000, dialogPending: false,
  hookState: null, archivedAt: null, pr: null,
};

describe('sessionBucket', () => {
  it('routes a merged archived workspace to cleanup, not dead', () => {
    // ws-archive STOPS the session, so every cleanup candidate is also dead.
    // Testing dead first would empty this bucket permanently.
    const r = sessionBucket(
      { ...base, status: 'dead', statusUpdatedAt: 9000, archivedAt: 1700, pr: { phase: 'merged' } as never },
      null,
    );
    expect(r).toEqual({ bucket: 'cleanup', bucketSince: 1_700_000 });
  });

  // `cleanup` is a CONJUNCTION, so it is entered at the later of its two
  // events. The auto-archive path hides this — there the archive is the later
  // one — but the manual path inverts it: archive at T0 with the PR still
  // open, open the session at T1 (which acks it at T1), merge at T2. Stamped
  // at T0 the session is dated before the ack that predates the episode, so
  // `isUnseen` computes `T0 > T1` = false and the leapfrog bucket's badge
  // never fires in the one flow it exists for.
  it('dates a workspace archived BEFORE its merge by the merge, not the archive', () => {
    const r = sessionBucket(
      { ...base, status: 'dead', archivedAt: 1700, pr: { phase: 'merged', mergedAt: 5_000_000 } as never },
      null,
    );
    expect(r).toEqual({ bucket: 'cleanup', bucketSince: 5_000_000 });
  });

  it('keeps the archive time when the merge came first — the LATER event, not the merge one', () => {
    // The auto-archive path: sweepPr sees the merge, archiveMerged archives
    // seconds later. Taking `mergedAt` unconditionally would date the session
    // before it was archived, i.e. before it could possibly be in `cleanup`.
    const r = sessionBucket(
      { ...base, status: 'dead', archivedAt: 9000, pr: { phase: 'merged', mergedAt: 5_000_000 } as never },
      null,
    );
    expect(r).toEqual({ bucket: 'cleanup', bucketSince: 9_000_000 });
  });

  it('falls back to the archive time when the registry supplied no mergedAt', () => {
    // `persistedPr` (fleet.ts) carries the phase from the registry with
    // `mergedAt: null` — the pre-sweep answer must degrade to exactly the old
    // one, never to 0.
    const r = sessionBucket(
      { ...base, status: 'dead', archivedAt: 1700, pr: { phase: 'merged', mergedAt: null } as never },
      null,
    );
    expect(r).toEqual({ bucket: 'cleanup', bucketSince: 1_700_000 });
  });

  it('routes an archived workspace with no merged PR to archived', () => {
    const r = sessionBucket({ ...base, status: 'dead', archivedAt: 1700, pr: null }, null);
    expect(r.bucket).toBe('archived');
  });

  // D-74. The archived rungs above are entered on `archivedAt` ALONE, and the
  // whole reason that is safe — this file's first test states it — is that
  // `ws-archive` stops the session, so every cleanup candidate is also dead.
  // A REVIVED workspace falsifies that: `ccd start`/`ccd ensure` clear
  // `.stopped` and `.swapblocked` on a deliberate revival but NEVER
  // `$REG/<id>.archived` (only `ws-restore` removes it, ccd:4498), so the
  // marker outlives the archive it describes and the row is bucketed
  // `cleanup` for ever — no matter how busy the pane is.
  //
  // MEASURED on the live fleet 2026-08-17: 5 of the 7 `.archived` markers on
  // the box sat on sessions with a LIVE tmux pane, 4 of them mid-turn. A
  // quarter of the fleet rendered the word `merged` (SessionLine.tsx's WORD
  // table) while working, sorted BELOW idle (sortFleet's RANK: cleanup 4,
  // working 3) and counted out of its project's `busy` total.
  //
  // A live pane is not evidence that the archive was undone — it is evidence
  // that the marker no longer describes this session. The bucket says what
  // the session IS DOING; `archivedAt` stays on the wire untouched, so the
  // archive screen, the reap flow and `ws-attic` all still find it.
  it('buckets a REVIVED archived workspace on its live state — the marker is stale, the pane is not', () => {
    const r = sessionBucket(
      { ...base, status: 'busy', statusUpdatedAt: 9000, archivedAt: 1700,
        pr: { phase: 'merged', mergedAt: 5_000_000 } as never },
      null,
    );
    expect(r).toEqual({ bucket: 'working', bucketSince: 9000 });
  });

  it('a revived archived workspace with no merged PR is live too — `archived` may not outrank a pane either', () => {
    // The sibling rung. Both archived rungs share one precondition, so a fix
    // applied to only the `cleanup` one would leave this shape misbucketed.
    const r = sessionBucket(
      { ...base, status: 'busy', statusUpdatedAt: 9000, archivedAt: 1700, pr: null },
      null,
    );
    expect(r).toEqual({ bucket: 'working', bucketSince: 9000 });
  });

  it('a revived archived workspace still reaches attention — the marker hides a waiting question too', () => {
    // The cost of the old ordering was not only a wrong word: `attention` is
    // the one bucket this screen exists for, and it sits BELOW the archived
    // rungs. A revived workspace asking a question was unreachable through
    // the attention section.
    const r = sessionBucket(
      { ...base, status: 'idle', statusUpdatedAt: 9000, archivedAt: 1700,
        hookState: 'waiting', pr: { phase: 'merged' } as never },
      5555,
    );
    expect(r).toEqual({ bucket: 'attention', bucketSince: 5555 });
  });

  it('routes a live dead session to dead', () => {
    expect(sessionBucket({ ...base, status: 'dead', statusUpdatedAt: 42 }, null))
      .toEqual({ bucket: 'dead', bucketSince: 42 });
  });

  it('uses the hook timestamp for a waiting session', () => {
    const r = sessionBucket({ ...base, status: 'busy', hookState: 'waiting' }, 5555);
    expect(r).toEqual({ bucket: 'attention', bucketSince: 5555 });
  });

  it('falls back to statusUpdatedAt when the pane scrape is the reason', () => {
    const r = sessionBucket({ ...base, status: 'busy', dialogPending: true }, 5555);
    expect(r).toEqual({ bucket: 'attention', bucketSince: 1000 });
  });

  it('does NOT use the hook timestamp for working — it bumps on every PostToolUse', () => {
    const r = sessionBucket({ ...base, status: 'busy', hookState: 'working' }, 8888);
    expect(r).toEqual({ bucket: 'working', bucketSince: 1000 });
  });

  // — D-75: two observers of one fact, and the FRESHER one decides —
  //
  // `status` comes from Claude Code's own `sessions/<pid>.json`; `hookState`
  // comes from `session-hook.sh`. Neither is reliable alone, and until now
  // only the first could ever say `working`:
  //
  //   * The live file WEDGES. MEASURED on the fleet 2026-08-17, twice
  //     independently and with the same signature — a turn whose last tool
  //     call was a Bash ends without Claude Code ever writing the transition
  //     back, so the file stays on `"status":"shell"` (which
  //     `liveSessionStatus` reads as busy, correctly, for every value but
  //     `idle`). `claude-corp-data-internal` held that wedge for 1h48m while
  //     its hook had written `done` 5.7s after the file's last write;
  //     `expoAI-assistant-warm-mesa` reproduced it during the same sampling
  //     run. Those rows read `working` for ever.
  //   * The live file can also be ABSENT or unreadable, where `fleet.ts`
  //     leaves `status` at its `'idle'` fallback (an unknown wrapper =>
  //     `!cfgDir`, a degraded registry row, a read that failed rather than
  //     missed) — push-copy.test.ts already names that shape. A session
  //     working behind one of those reads `idle`.
  //
  // So the rungs below arbitrate: whichever observation carries the LATER
  // timestamp is the one this ladder believes. This is a BUCKET decision
  // only — `status` stays frozen and hook-blind (fleet.test.ts's freeze
  // test), and nothing here needs a new wire field: both timestamps are
  // already arguments to this function.
  it('D-75: a wedged busy loses to a NEWER hook `done` — the turn demonstrably ended after the file stopped', () => {
    const r = sessionBucket(
      { ...base, status: 'busy', statusUpdatedAt: 1000, hookState: 'done' },
      5700, 'Stop',
    );
    expect(r).toEqual({ bucket: 'done', bucketSince: 5700 });
  });

  it('D-75: an OLDER hook `done` does not unseat a live busy — the file is the newer observation', () => {
    const r = sessionBucket(
      { ...base, status: 'busy', statusUpdatedAt: 9000, hookState: 'done' },
      5700, 'Stop',
    );
    expect(r).toEqual({ bucket: 'working', bucketSince: 9000 });
  });

  it('D-75: a SessionStart `done` never unseats a live busy — F1s synthetic write is not a finished turn', () => {
    // The same reasoning the `done` rung already applies to `SessionStart`:
    // it proves "never started", not "just finished". A resuming session is
    // legitimately busy while that write is the newest hook fact on disk, so
    // treating it as evidence would blink every resume through `idle`.
    const r = sessionBucket(
      { ...base, status: 'busy', statusUpdatedAt: 1000, hookState: 'done' },
      5700, 'SessionStart',
    );
    expect(r).toEqual({ bucket: 'working', bucketSince: 1000 });
  });

  it('D-75: a fresh hook `working` raises a stale idle — the live file missed the turn', () => {
    const r = sessionBucket(
      { ...base, status: 'idle', statusUpdatedAt: 1000, hookState: 'working' },
      5700,
    );
    expect(r).toEqual({ bucket: 'working', bucketSince: 1000 });
  });

  it('D-75: a hook `working` with NO live status at all still reads working', () => {
    // `statusUpdatedAt: null` is the absent/unreadable live file — there is
    // no rival observation to be fresher than, so the one observer that did
    // report wins outright rather than losing to a default.
    const r = sessionBucket(
      { ...base, status: 'idle', statusUpdatedAt: null, hookState: 'working' },
      5700,
    );
    expect(r).toEqual({ bucket: 'working', bucketSince: null });
  });

  it('D-75: a STALE hook `working` does not raise an idle the live file has since measured', () => {
    // The mirror of the wedge: the hook wrote `working` and then the process
    // that would have written `done` never ran (a killed pane, a hook that
    // failed), while Claude Code went on to report idle. The newer
    // observation is the live file's, so it decides.
    const r = sessionBucket(
      { ...base, status: 'idle', statusUpdatedAt: 9000, hookState: 'working' },
      5700,
    );
    expect(r).toEqual({ bucket: 'idle', bucketSince: 9000 });
  });

  it('routes a finished turn to done with the hook timestamp', () => {
    expect(sessionBucket({ ...base, hookState: 'done' }, 7777))
      .toEqual({ bucket: 'done', bucketSince: 7777 });
  });

  // Blocking review finding (F1): `session-hook.sh`'s `SessionStart` writes
  // `state: 'done'` so the mail delivery gate can inject a virgin worker's
  // first brief (its `hs.state === 'done'` conjunct — watch.ts), but `done`
  // is ALSO this ladder's own bucket for "finished a turn", surfaced
  // verbatim on the wire and BADGED (pwa/src/lib/seen.ts's `BADGED` set).
  // Without the `hookEvent` degrade a never-run session would flash `done`
  // and get badged for ordinary spawn — exactly the false positive this
  // ladder's own `done` branch exists to rule out for a hookless idle→done
  // transition. `hookEvent: 'SessionStart'` must degrade to `idle`, the
  // honest fact on the ground, not accumulate as `done`.
  it('F1: a SessionStart-sourced done degrades to idle, not the done bucket', () => {
    expect(sessionBucket({ ...base, hookState: 'done' }, 7777, 'SessionStart'))
      .toEqual({ bucket: 'idle', bucketSince: 1000 });
  });

  // The same hook state, once a REAL turn has actually run (`Stop` or a
  // manual `PostCompact`), still reports `done` — the fix must not blunt the
  // bucket for the case it exists for, only for `SessionStart`'s specific
  // "never started" claim.
  it('F1: a Stop-sourced done still reports done — only SessionStart degrades', () => {
    expect(sessionBucket({ ...base, hookState: 'done' }, 7777, 'Stop'))
      .toEqual({ bucket: 'done', bucketSince: 7777 });
  });

  // No third argument at all (every pre-F1 call site, and `reviveFleetSession`
  // on a cached snapshot that never had an `event` to give) must keep the
  // pre-fix answer — the default is `null`, not `'SessionStart'`.
  it('F1: hookEvent omitted keeps done — the default never degrades it', () => {
    expect(sessionBucket({ ...base, hookState: 'done' }, 7777))
      .toEqual({ bucket: 'done', bucketSince: 7777 });
  });

  it('leaves a hookless idle session in idle — no hook evidence, no done claim', () => {
    expect(sessionBucket(base, null)).toEqual({ bucket: 'idle', bucketSince: 1000 });
  });

  it('assembleFleet ships the bucket without moving status', async () => {
    // The Build 1 freeze test (fleet.test.ts, "status is frozen against hook
    // data") asserts status is identical with and without hookstate. This is
    // its sibling: with hookstate present, `bucket` is the field that moved.
    // Harness copied from fleet.test.ts's "status is IDENTICAL..." fixture.
    const home = mkTmp('ccrc-');
    seedRoster(home);
    const reg = path.join(home, '.cc-sessions');
    mkdirSync(reg, { recursive: true });
    const fields = {
      wrapper: 'claude2', project: 'claude2-MekWarLive', workdir: '/data/projects/MekWarLive',
      uuid: '1'.repeat(36), started: '1',
    };
    for (const [k, v] of Object.entries(fields)) writeFileSync(path.join(reg, `claude2-MekWarLive.${k}`), v);
    mkdirSync(path.join(home, '.claude-personal', 'sessions'), { recursive: true });
    writeFileSync(path.join(home, '.claude-personal', 'sessions', '40613.json'), JSON.stringify({
      pid: 40613, sessionId: '1'.repeat(36), cwd: '/data/projects/MekWarLive',
      name: 'mekwar-a1', status: 'busy', statusUpdatedAt: 1784582728369, version: '2.1.210',
    }));
    const run: Runner = async (_cmd, args) => {
      if (args[0] === 'has-session') return { code: args.includes('cc-claude2-MekWarLive') ? 0 : 1, stdout: '', stderr: '' };
      if (args[0] === 'list-panes') return { code: 0, stdout: '40613\n', stderr: '' };
      return { code: 0, stdout: '', stderr: '' };
    };
    const cfg = loadConfig({ CCRC_HOME: home });

    const withoutHook = await assembleFleet(localIO, cfg, new Tmux(run), 1784600000);
    const waitingHookStates = new Map<string, HookState>([
      ['claude2-MekWarLive', { state: 'waiting', updatedAt: 1784600000000, event: null, ask: null, subagents: [], interrupted: false }],
    ]);
    const withWaitingHook = await assembleFleet(
      localIO, cfg, new Tmux(run), 1784600000, undefined, undefined, undefined, undefined, waitingHookStates,
    );

    const before = withoutHook.find((x) => x.id === 'claude2-MekWarLive')!;
    const afterWaiting = withWaitingHook.find((x) => x.id === 'claude2-MekWarLive')!;

    // status stays frozen — the field this task must not move.
    expect(afterWaiting.status).toBe(before.status);
    // bucket is the field that DOES move, once hook evidence says waiting.
    expect(afterWaiting.bucket).toBe('attention');

    // A hookless session with no dialog and no evidence of a finished turn
    // reports idle — mirrors sessionBucket's own "leaves a hookless idle
    // session in idle" unit test, through the full assembleFleet path.
    const home2 = mkTmp('ccrc-');
    seedRoster(home2);
    const reg2 = path.join(home2, '.cc-sessions');
    mkdirSync(reg2, { recursive: true });
    writeFileSync(path.join(reg2, 'claude-demo.wrapper'), 'claude');
    writeFileSync(path.join(reg2, 'claude-demo.project'), 'demo');
    writeFileSync(path.join(reg2, 'claude-demo.workdir'), '/data/projects/demo');
    writeFileSync(path.join(reg2, 'claude-demo.uuid'), '1'.repeat(36));
    writeFileSync(path.join(reg2, 'claude-demo.started'), '1');
    const idleRun: Runner = async (_cmd, args) => {
      if (args[0] === 'has-session') return { code: 0, stdout: '', stderr: '' };
      if (args[0] === 'list-panes') return { code: 0, stdout: '', stderr: '' };
      return { code: 0, stdout: '', stderr: '' };
    };
    const fleetNoHookFile = await assembleFleet(
      localIO, loadConfig({ CCRC_HOME: home2 }), new Tmux(idleRun), 1784600000,
    );
    const noHook = fleetNoHookFile.find((x) => x.id === 'claude-demo')!;
    expect(noHook.status).toBe('idle');
    expect(noHook.bucket).toBe('idle');
  });

  // D-74 end to end, on the EXACT registry shape the live fleet was measured
  // in on 2026-08-17: `.archived` + `.archivedreason merged:#N` + `.prphase
  // merged` (what `archiveMerged` writes) standing beside a live tmux pane and
  // a busy live-status file (what a later `ccd start` produced). Five of the
  // box's seven archive markers were in this state; four of those panes were
  // mid-turn. The unit cases above pin the ladder — this pins the whole path
  // that feeds it, because the ladder can only be right about `status` if
  // `assembleFleet` is still measuring the pane it describes.
  it('D-74: assembleFleet buckets a revived-from-archive workspace as working, keeping archivedAt on the wire', async () => {
    const home = mkTmp('ccrc-');
    seedRoster(home);
    const reg = path.join(home, '.cc-sessions');
    mkdirSync(reg, { recursive: true });
    const fields: Record<string, string> = {
      wrapper: 'claude2', project: 'demo', workdir: '/data/projects/demo',
      workspace: 'calm-mesa', uuid: '2'.repeat(36), started: '1',
      // The archive that really happened, days ago…
      archived: '1786431390', archivedreason: 'merged:#28',
      prphase: 'merged', prnumber: '28',
    };
    for (const [k, v] of Object.entries(fields)) writeFileSync(path.join(reg, `demo-calm-mesa.${k}`), v);
    // …and the revival that followed it, which clears `.stopped` but leaves
    // `.archived` standing (ccd's `cmd_ensure`, `rm -f "$REG/$id.stopped"`).
    mkdirSync(path.join(home, '.claude-personal', 'sessions'), { recursive: true });
    writeFileSync(path.join(home, '.claude-personal', 'sessions', '9001.json'), JSON.stringify({
      pid: 9001, sessionId: '2'.repeat(36), cwd: '/data/projects/demo',
      name: 'calm-mesa', status: 'busy', statusUpdatedAt: 1786973261696, version: '2.1.233',
    }));
    const run: Runner = async (_cmd, args) => {
      if (args[0] === 'has-session') return { code: args.includes('cc-demo-calm-mesa') ? 0 : 1, stdout: '', stderr: '' };
      if (args[0] === 'list-panes') return { code: 0, stdout: '9001\n', stderr: '' };
      return { code: 0, stdout: '', stderr: '' };
    };
    const fleet = await assembleFleet(
      localIO, loadConfig({ CCRC_HOME: home }), new Tmux(run), 1786973300,
    );
    const s = fleet.find((x) => x.id === 'demo-calm-mesa')!;
    expect(s.status).toBe('busy');
    expect(s.bucket).toBe('working');
    // The disk fact is NOT suppressed to get there — `/archive`, `ws-attic`
    // and the reap flow all key off this field, and the bucket moving must
    // not take the workspace off any of them.
    expect(s.archivedAt).toBe(1786431390);
  });

  // D-76's assembly half. The unit half lives in `livestate.test.ts`; this is
  // the seam where a parsed `waiting` has to become the ATTENTION bucket —
  // with no pane menu and no hookstate anywhere, which is the shape three of
  // Claude Code's four `waitingFor` causes actually produce (a sandbox
  // request, an elicitation prompt and a managed-settings security prompt
  // paint no numbered menu for the scraper to find, and `session-hook.sh`
  // writes `waiting` only for `AskUserQuestion`/`PermissionRequest`).
  it('D-76: a live status of `waiting` raises dialogPending and buckets attention, not working', async () => {
    const home = mkTmp('ccrc-');
    seedRoster(home);
    const reg = path.join(home, '.cc-sessions');
    mkdirSync(reg, { recursive: true });
    const fields: Record<string, string> = {
      wrapper: 'claude2', project: 'demo', workdir: '/data/projects/demo',
      uuid: '4'.repeat(36), started: '1',
    };
    for (const [k, v] of Object.entries(fields)) writeFileSync(path.join(reg, `demo-blocked.${k}`), v);
    mkdirSync(path.join(home, '.claude-personal', 'sessions'), { recursive: true });
    writeFileSync(path.join(home, '.claude-personal', 'sessions', '7007.json'), JSON.stringify({
      pid: 7007, sessionId: '4'.repeat(36), cwd: '/data/projects/demo',
      name: 'blocked', status: 'waiting', waitingFor: 'sandbox request',
      statusUpdatedAt: 1786973261696, version: '2.1.233',
    }));
    const run: Runner = async (_cmd, args) => {
      if (args[0] === 'has-session') return { code: args.includes('cc-demo-blocked') ? 0 : 1, stdout: '', stderr: '' };
      if (args[0] === 'list-panes') return { code: 0, stdout: '7007\n', stderr: '' };
      return { code: 0, stdout: '', stderr: '' };
    };
    const fleet = await assembleFleet(
      localIO, loadConfig({ CCRC_HOME: home }), new Tmux(run), 1786973300,
    );
    const s = fleet.find((x) => x.id === 'demo-blocked')!;
    // `status` is untouched by this fix — `waiting` still collapses to busy,
    // which is what keeps the mail gate and archive-safety hands-off.
    expect(s.status).toBe('busy');
    expect(s.dialogPending).toBe(true);
    expect(s.bucket).toBe('attention');
    // …and the row says WHY, from the reason already on disk, without a
    // single pane capture. `hookState` is null here: no hook wrote this.
    expect(s.askSummary).toBe('sandbox request');
    expect(s.hookState).toBeNull();
  });

  it('D-76: a `waiting` file with no reason still raises attention — the summary is what degrades', async () => {
    const home = mkTmp('ccrc-');
    seedRoster(home);
    const reg = path.join(home, '.cc-sessions');
    mkdirSync(reg, { recursive: true });
    const fields: Record<string, string> = {
      wrapper: 'claude2', project: 'demo', workdir: '/data/projects/demo',
      uuid: '5'.repeat(36), started: '1',
    };
    for (const [k, v] of Object.entries(fields)) writeFileSync(path.join(reg, `demo-mute.${k}`), v);
    mkdirSync(path.join(home, '.claude-personal', 'sessions'), { recursive: true });
    writeFileSync(path.join(home, '.claude-personal', 'sessions', '7008.json'), JSON.stringify({
      pid: 7008, sessionId: '5'.repeat(36), cwd: '/data/projects/demo',
      status: 'waiting', statusUpdatedAt: 1786973261696, version: '2.1.233',
    }));
    const run: Runner = async (_cmd, args) => {
      if (args[0] === 'has-session') return { code: args.includes('cc-demo-mute') ? 0 : 1, stdout: '', stderr: '' };
      if (args[0] === 'list-panes') return { code: 0, stdout: '7008\n', stderr: '' };
      return { code: 0, stdout: '', stderr: '' };
    };
    const fleet = await assembleFleet(
      localIO, loadConfig({ CCRC_HOME: home }), new Tmux(run), 1786973300,
    );
    const s = fleet.find((x) => x.id === 'demo-mute')!;
    expect(s.bucket).toBe('attention');
    // Never `''` — this line renders unconditionally on a waiting card, so
    // "no reason" must stay no line, exactly as `hookAskSummary` insists.
    expect(s.askSummary).toBeNull();
  });

  // Blocking review finding (F1), end to end through `assembleFleet` — the
  // exact wire shape a freshly-spawned worker produces: `session-hook.sh`'s
  // `SessionStart` write (`state: 'done', event: 'SessionStart'`), before
  // that worker has taken a single turn. `hookState` itself is still `done`
  // on the wire (unchanged — the mail delivery gate at watch.ts still needs
  // it), but `bucket` — the field the fleet screen's sections, counts and
  // badge (`pwa/src/lib/seen.ts`'s `BADGED`) all key off — must read `idle`,
  // never `done`: a virgin worker has not "finished a turn wanting
  // attention", it has not run at all.
  it('F1: assembleFleet buckets a virgin SessionStart-done session as idle, not done', async () => {
    const home = mkTmp('ccrc-');
    // Stage 2a: `loadConfig` reads `~/.ccrc/accounts.json` and refuses to boot
    // without it, so every fixture home needs a roster before it is loaded.
    // This test arrived on main while that branch was in flight, so it is the
    // one call site the sweep could not have covered.
    seedRoster(home);
    const reg = path.join(home, '.cc-sessions');
    mkdirSync(reg, { recursive: true });
    const fields = {
      wrapper: 'claude2', project: 'claude2-MekWarLive', workdir: '/data/projects/MekWarLive',
      uuid: '1'.repeat(36), started: '1',
    };
    for (const [k, v] of Object.entries(fields)) writeFileSync(path.join(reg, `claude2-MekWarLive.${k}`), v);
    mkdirSync(path.join(home, '.claude-personal', 'sessions'), { recursive: true });
    writeFileSync(path.join(home, '.claude-personal', 'sessions', '40613.json'), JSON.stringify({
      pid: 40613, sessionId: '1'.repeat(36), cwd: '/data/projects/MekWarLive',
      name: 'mekwar-a1', status: 'idle', statusUpdatedAt: 1784582728369, version: '2.1.210',
    }));
    const run: Runner = async (_cmd, args) => {
      if (args[0] === 'has-session') return { code: args.includes('cc-claude2-MekWarLive') ? 0 : 1, stdout: '', stderr: '' };
      if (args[0] === 'list-panes') return { code: 0, stdout: '40613\n', stderr: '' };
      return { code: 0, stdout: '', stderr: '' };
    };
    const cfg = loadConfig({ CCRC_HOME: home });
    const sessionStartDone = new Map<string, HookState>([
      ['claude2-MekWarLive',
        { state: 'done', updatedAt: 1784600000000, event: 'SessionStart', ask: null, subagents: [], interrupted: false }],
    ]);
    const fleet = await assembleFleet(
      localIO, cfg, new Tmux(run), 1784600000, undefined, undefined, undefined, undefined, sessionStartDone,
    );
    const s = fleet.find((x) => x.id === 'claude2-MekWarLive')!;
    // The raw hook field is unchanged — the mail delivery gate still reads it.
    expect(s.hookState).toBe('done');
    // The bucket — what the PWA sections/badges on — is not.
    expect(s.bucket).toBe('idle');
  });
});

// §4.4 and non-goal §6: "No new SessionStatus/SessionBucket member, and no
// bucket-ladder change." M10 is why — the live fleet frame is CAST, not
// revived, so an unknown bucket reaches `RANK[bucket]` as a NaN comparator and
// `DOT[status].cls` THROWS in an already-deployed PWA. A dead row's kind of
// dead is a qualifier ON the row, never a new sorting class.
describe('the lifecycle field moves no bucket (M10)', () => {
  it('a dead row is `dead` whatever its lifecycle says — all seven of them', () => {
    for (const lc of SESSION_LIFECYCLES) {
      // Assigned to a const first: a fresh object literal at the call site
      // would trip excess-property checking, which is the compiler telling us
      // `BucketInput` does not name this field — exactly the property this
      // test exists to keep true.
      const s = { ...base, status: 'dead' as const, statusUpdatedAt: 42, lifecycle: lc };
      expect(sessionBucket(s, null), lc).toEqual({ bucket: 'dead', bucketSince: 42 });
    }
  });

  it('an archived, merged row still routes to cleanup with a lifecycle set — the archived rungs come first', () => {
    // §4.3: "An archived row never reaches this table." `ws-archive` stamps
    // `.stopped` through `_ws_unsupervise`, so an archived workspace DOES carry
    // `lifecycle: 'stopped'` on the wire — and it must still bucket `cleanup`,
    // because the archived rungs are tested before `dead` for the reason this
    // file's first test already states.
    const s = {
      ...base, status: 'dead' as const, archivedAt: 1700,
      pr: { phase: 'merged' } as never, lifecycle: 'stopped' as const,
    };
    expect(sessionBucket(s, null).bucket).toBe('cleanup');
  });
});
