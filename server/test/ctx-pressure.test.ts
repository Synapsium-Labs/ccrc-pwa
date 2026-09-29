// D-2012: ctxPct must not survive a tick whose captured pane carried no `▓
// ctx` segment, even while the rest of the statusline (model/branch/effort)
// is retained. `watch.ts`'s `detectDialogs` is the one place that decides
// what a tick's parse overwrites versus keeps — this file drives it through
// `tick()` (the only public entry point that populates `this.statuslines`)
// and reads the result back off `currentStatuslines()`, the same idiom
// `name-sweep.test.ts` already uses for the identical reason (a sweep alone
// would leave the map empty and prove nothing about the merge).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { Bus } from '../src/bus.js';
import type { Runner } from '../src/exec.js';
import { FleetWatcher } from '../src/watch.js';
import { testDeps } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';
import type { PushPayload } from '../src/push.js';

const ID = 'demo-ctx-pressure';
const UUID = 'c'.repeat(36);
const WORKDIR = '/w/demo/ctx-pressure';

/** Registry row for a live workspace — same shape `name-sweep.test.ts` seeds,
 *  minimal fields `readRegistry` needs to keep the row (registry.ts:124). */
const seed = (home: string): void => {
  const reg = path.join(home, '.cc-sessions');
  mkdirSync(reg, { recursive: true });
  const fields: Record<string, string> = {
    wrapper: 'claude', project: 'demo', workdir: WORKDIR, uuid: UUID,
    started: '1', workspace: 'ctx-pressure', branch: 'ws/ctx-pressure',
  };
  for (const [k, v] of Object.entries(fields)) writeFileSync(path.join(reg, `${ID}.${k}`), v);
};

/** A full statusline row, ctx segment included — same fixture shape
 *  `statusline.test.ts` itself uses. */
const FULL_PANE = (pct: number): string =>
  `  👤 claude │ 🤖 Sonnet 5 · high │ ⎇ ws/ctx-pressure │ 🎯 demo │ ▓ ctx ████░░░░ ${pct}%`;

/** The statusline row with everything BUT the ctx bar — model/branch/effort
 *  still parse; only the `▓` segment is gone (an older statusline-command.sh,
 *  or the operator trimmed the field). */
const NO_CTX_PANE = '  👤 claude │ 🤖 Sonnet 5 · high │ ⎇ ws/ctx-pressure │ 🎯 demo';

/** No statusline at all — a dialog/permission overlay painted over the whole
 *  row, `parseStatusline`'s own "empties" fixture shape. */
const DIALOG_PANE = '❯ 1. Yes\n  2. No, exit\nEnter to select';

/** The ctx segment with no identity beside it — no 🤖, no ⎇. Both are
 *  independently conditional in ccd/statusline-command.sh:134-149 (model on
 *  `.model.display_name`, branch on being inside a repo), so this is a real
 *  pane shape, not a contrived one. The `👤` account segment is NOT
 *  conditional — the script writes it first on every row — and the parser
 *  reads ctx only from the row that `👤` leads, so the fixture carries it. */
const CTX_ONLY_PANE = (pct: number): string => `  👤 claude │ ▓ ctx ████░░░░ ${pct}%`;

/** The `👤` segment alone — 🤖, ⎇ and ▓ are each conditional in
 *  ccd/statusline-command.sh, the account segment is not. No identity, no
 *  ctx: watch.ts's branch 4, on a tick that DID see the row. */
const USER_ONLY_PANE = '  👤 claude │ 🎯 demo';

/** A real 2.1.283 running Workflow row (statusline.test.ts has its capture). */
const WF_ROW = '  ◯ allprobe  ▰▰▰▰▰▰▱▱▱▱▱▱▱▱▱▱▱▱▱▱  1/3 · 7s · ↓ 1.2k tokens';

describe('ctx pressure survives only the tick that measured it (D-2012)', () => {
  let paneOut = FULL_PANE(82);
  const run: Runner = async (_cmd, args) => {
    if (args[0] === 'capture-pane') return { code: 0, stdout: paneOut, stderr: '' };
    if (args[0] === 'has-session') return { code: 0, stdout: '', stderr: '' };
    if (args[0] === 'list-panes') return { code: 0, stdout: '4061\n', stderr: '' };
    return { code: 1, stdout: '', stderr: '' };
  };

  beforeEach(() => { paneOut = FULL_PANE(82); });

  it('drops ctxPct on a tick whose pane has a statusline but no ctx segment, while model/branch are retained', async () => {
    const home = mkTmp('ccrc-ctx-');
    seed(home);
    const w = new FleetWatcher(testDeps(home, run), new Bus(), 2000);

    await w.tick();
    const first = w.currentStatuslines().get(ID);
    expect(first?.ctxPct, 'the fixture only proves the merge if the first tick really measured 82%')
      .toBe(82);
    expect(first?.model).toBe('Sonnet 5');

    paneOut = NO_CTX_PANE;
    await w.tick();
    const second = w.currentStatuslines().get(ID);
    expect(second?.ctxPct).toBeUndefined();
    expect(second?.model).toBe('Sonnet 5');
    expect(second?.branch).toBe('ws/ctx-pressure');
  });

  it('drops ctxPct — does not let the stale reading ride — even when a dialog hides the WHOLE statusline for a tick, while still keeping model/branch (the "right for model and branch" case D-2012 names)', async () => {
    const home = mkTmp('ccrc-ctx-');
    seed(home);
    const w = new FleetWatcher(testDeps(home, run), new Bus(), 2000);

    await w.tick();
    expect(w.currentStatuslines().get(ID)?.ctxPct).toBe(82);

    paneOut = DIALOG_PANE;
    await w.tick();
    const afterDialog = w.currentStatuslines().get(ID);
    // The whole-object-replace mutant keeps `{model:undefined,...}` here
    // (today's `if (sl.model || sl.branch || sl.effort)` guard is false, so
    // nothing is touched at all) — which is right for model/branch, per
    // D-2012's own text, but wrong for ctxPct: a stale 82% reading as
    // current on a row the console cannot currently even see the statusline
    // for is worse than no reading.
    expect(afterDialog?.ctxPct, 'a stale ctxPct rode a tick that measured nothing at all').toBeUndefined();
    expect(afterDialog?.model, 'model must still survive a one-tick overlay miss, unlike ctxPct').toBe('Sonnet 5');
    expect(afterDialog?.branch).toBe('ws/ctx-pressure');
    // …marked as KEPT, not measured, so the fleet ranks this branch below the
    // worktree's measured HEAD (fleet.ts) — the map still holds it.
    expect(afterDialog?.retained, 'a kept entry must say it was kept').toBe(true);
    // And a tick that measures the row again clears the mark.
    paneOut = FULL_PANE(82);
    await w.tick();
    expect(w.currentStatuslines().get(ID)?.retained).toBeUndefined();
  });

  it('a tick that measures ONLY the ctx segment merges the fresh reading onto retained identity, never blanking model/branch (Finding 3)', async () => {
    const home = mkTmp('ccrc-ctx-');
    seed(home);
    const w = new FleetWatcher(testDeps(home, run), new Bus(), 2000);

    await w.tick();
    expect(w.currentStatuslines().get(ID)?.model).toBe('Sonnet 5');
    expect(w.currentStatuslines().get(ID)?.ctxPct).toBe(82);

    paneOut = CTX_ONLY_PANE(91);
    await w.tick();
    const afterCtxOnly = w.currentStatuslines().get(ID);
    // The whole-object-replace mutant (`this.statuslines.set(r.id, sl)`
    // whenever `sl.ctxPct !== undefined`, with no merge) sets model/branch
    // to `undefined` here — the exact regression this branch exists to
    // stop, and the one the reviewer measured surviving a naive
    // `sl.model || sl.branch || sl.effort` guard with all three touched
    // suites still green.
    expect(afterCtxOnly?.ctxPct, 'the fresh ctx-only reading must still land').toBe(91);
    expect(afterCtxOnly?.model, 'model must survive a tick where only the ctx segment rendered').toBe('Sonnet 5');
    expect(afterCtxOnly?.branch).toBe('ws/ctx-pressure');
    expect(afterCtxOnly?.retained, 'identity this tick did not measure is marked kept').toBe(true);
  });

  it('boxCols is only ever THIS tick\'s width — a tick that cannot see the prompt box reads none, identity kept or not', async () => {
    const home = mkTmp('ccrc-ctx-');
    seed(home);
    const w = new FleetWatcher(testDeps(home, run), new Bus(), 2000);
    const boxed = (row: string): string => ['─'.repeat(220), '❯\u00a0', '─'.repeat(220), row].join('\n');

    paneOut = boxed(FULL_PANE(82));
    await w.tick();
    expect(w.currentStatuslines().get(ID)?.boxCols, 'the fixture must first measure a width').toBe(220);

    // An overlay hides the row: identity is kept (D-2012), the width is not.
    paneOut = DIALOG_PANE;
    await w.tick();
    expect(w.currentStatuslines().get(ID)?.model).toBe('Sonnet 5');
    expect(w.currentStatuslines().get(ID)?.boxCols, 'a kept width reads an unseen pane as wide').toBeUndefined();

    // A ctx-only row under a 130-column box merges THIS tick's width.
    paneOut = boxed(CTX_ONLY_PANE(91));
    await w.tick();
    expect(w.currentStatuslines().get(ID)?.boxCols).toBe(220);
    paneOut = ['─'.repeat(130), CTX_ONLY_PANE(91)].join('\n');
    await w.tick();
    expect(w.currentStatuslines().get(ID)?.boxCols).toBe(130);
    expect(w.currentStatuslines().get(ID)?.retained).toBe(true);
  });

  // `workflowActive` reads the rows BELOW the statusline row. A tick that saw
  // that row MEASURED them, `true` or `false`, and its reading lands on every
  // branch, kept entry or fresh. A tick that could not see it (an overlay, a
  // pane mid-render) measured nothing below it: `parseStatusline` answers
  // `undefined`, and the last measurement rides through the way identity does.
  // Storing a `false` there read a running Workflow as gone for as long as the
  // overlay stayed up (the push case, in its own describe below).
  it('workflowActive is THIS tick\'s reading wherever it saw the statusline row, and the last one kept where it did not', async () => {
    const home = mkTmp('ccrc-ctx-');
    seed(home);
    const w = new FleetWatcher(testDeps(home, run), new Bus(), 2000);
    const wf = () => w.currentStatuslines().get(ID)?.workflowActive;

    paneOut = [FULL_PANE(82), '', WF_ROW].join('\n');
    await w.tick();
    expect(wf(), 'the fixture must first read the row').toBe(true);

    // An overlay hides the statusline row: nothing below it was measured.
    paneOut = DIALOG_PANE;
    await w.tick();
    expect(w.currentStatuslines().get(ID)?.retained).toBe(true);
    expect(wf(), 'an unseen row was stored as a measured false').toBe(true);

    // Branch 3, a ctx-only row: what it sees below it lands, false or true.
    paneOut = CTX_ONLY_PANE(91);
    await w.tick();
    expect(wf(), 'a ctx-only tick kept the reading it had just re-measured').toBe(false);
    paneOut = [CTX_ONLY_PANE(91), '', WF_ROW].join('\n');
    await w.tick();
    expect(w.currentStatuslines().get(ID)?.retained).toBe(true);
    expect(wf(), 'a ctx-only tick dropped the row it saw').toBe(true);

    // Branch 4 WITH a row: a `👤`-only statusline measures no identity and no
    // ctx, yet it IS the row, so what sits below it was measured — this
    // tick's reading lands over the kept one, either way.
    paneOut = USER_ONLY_PANE;
    await w.tick();
    expect(w.currentStatuslines().get(ID)?.retained).toBe(true);
    expect(wf(), 'a 👤-only tick kept the reading it had just re-measured').toBe(false);
    paneOut = [USER_ONLY_PANE, '', WF_ROW].join('\n');
    await w.tick();
    expect(w.currentStatuslines().get(ID)?.retained).toBe(true);
    expect(wf(), 'a 👤-only tick dropped the row it saw').toBe(true);
    expect(w.currentStatuslines().get(ID)?.model, 'identity still rides branch 4').toBe('Sonnet 5');
  });

  it('a dead pane deletes the WHOLE entry, not just ctxPct — distinguishable from the two misses above', async () => {
    const home = mkTmp('ccrc-ctx-');
    seed(home);
    const deadRun: Runner = async (_cmd, args) => {
      if (args[0] === 'capture-pane') return { code: 1, stdout: '', stderr: '' }; // Tmux.capture -> null
      if (args[0] === 'has-session') return { code: 1, stdout: '', stderr: '' };
      return { code: 1, stdout: '', stderr: '' };
    };
    const w = new FleetWatcher(testDeps(home, run), new Bus(), 2000);
    await w.tick();
    expect(w.currentStatuslines().get(ID)?.ctxPct).toBe(82);

    const w2 = new FleetWatcher(testDeps(home, deadRun), new Bus(), 2000);
    await w2.tick();
    expect(w2.currentStatuslines().has(ID)).toBe(false);
  });
});

// Round-1 review (harm lens), measured: a session whose card the Workflow row
// decides — no live-status file (`no-state` reads idle), or a build older than
// 2.1.277 — runs a Workflow, and an overlay covers the statusline for a few
// ticks. Stored as a measured `false`, the unseen row dropped the card to idle
// for as long as the overlay stayed, and the busy→idle edge pushed "✓ Finished"
// mid-run, then again at the real finish. The same five ticks the reviewer
// ran — row, row, overlay, overlay, row — then the real finish, whose one push
// proves this harness can see one.
describe('an overlay over a running Workflow neither drops a fallback card to idle nor fires "✓ Finished"', () => {
  const RUN_283 = WF_ROW;
  const DONE_283 = '  ◯ allprobe  ▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰  3/3 · 13s · ↓ 3.6k tokens'; // real (statusline.test.ts)
  const row280 = (count: string) => '  ◯ triage  Rig probe workflow' + ' '.repeat(146) + count;
  const cases: { name: string; version: string | null; running: string; finished: string }[] = [
    { name: 'no live file, a 2.1.283 row', version: null, running: RUN_283, finished: DONE_283 },
    { name: 'no live file, a 2.1.280 row', version: null, running: row280('1/3 agents done · 5s'), finished: row280('3/3 agents done · 13s') },
    { name: 'a 2.1.276 idle file, a 2.1.280 row', version: '2.1.276', running: row280('1/3 agents done · 5s'), finished: row280('3/3 agents done · 13s') },
  ];

  for (const c of cases) {
    it(c.name, async () => {
      const home = mkTmp('ccrc-ctx-');
      seed(home);
      if (c.version) {
        const sessions = path.join(home, '.claude', 'sessions');
        mkdirSync(sessions, { recursive: true });
        writeFileSync(path.join(sessions, '4061.json'),
          JSON.stringify({ pid: 4061, sessionId: UUID, cwd: WORKDIR, status: 'idle', version: c.version }));
      }
      let pane = '';
      const run: Runner = async (_cmd, args) => {
        if (args[0] === 'capture-pane') return { code: 0, stdout: pane, stderr: '' };
        if (args[0] === 'has-session') return { code: 0, stdout: '', stderr: '' };
        if (args[0] === 'list-panes') return { code: 0, stdout: '4061\n', stderr: '' };
        return { code: 1, stdout: '', stderr: '' };
      };
      const sent: PushPayload[] = [];
      const push = { notify: async (p: PushPayload) => { sent.push(p); } };
      const w = new FleetWatcher({ ...testDeps(home, run), push: push as never }, new Bus(), 2000,
        path.join(home, 'state-cache.json'));
      const status = () => w.currentFleet()?.find((s) => s.id === ID)?.status;
      const finished = () => sent.filter((p) => p.title.startsWith('✓ Finished')).length;

      const seen: (string | undefined)[] = [];
      for (const p of [c.running, c.running, DIALOG_PANE, DIALOG_PANE, c.running]) {
        pane = p === DIALOG_PANE ? p : [FULL_PANE(82), '', p].join('\n');
        await w.tick();
        seen.push(status());
      }
      expect(seen, 'the card left busy while the workflow ran').toEqual(['busy', 'busy', 'busy', 'busy', 'busy']);
      expect(finished(), '"✓ Finished" fired while the workflow ran').toBe(0);

      pane = [FULL_PANE(82), '', c.finished].join('\n');
      await w.tick();
      expect(status()).toBe('idle');
      expect(finished(), 'the real finish pushes exactly once').toBe(1);
    });
  }
});
