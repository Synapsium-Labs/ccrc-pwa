// Overlord W2 forecasts B, fix round 1 (F3, the coordinator's ruling): a run's spend counts as measured only in the
// conversation it was dispatched into. Dispatch records that conversation as `runs.dispatchConversation`: a fresh spawn's
// is the registry id ccd started it under, a resume's is read from the live process after its `/clear`
// (`turnverdict.ts#conversationAfterClearFor`), and a refused `/clear`, an absent port or a failed read record null
// (unmeasured, so the spend reads `outside`, never a guess).
//
// The harness is `dispatch-child-argv.test.ts`'s, trimmed: a direct `dispatchRun` over a real `CoordStore`, with one
// recording `Runner` shared by `runCcd` and `tmux`.
import { describe, it, expect } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import { dispatchRun, type DispatchRunDeps } from '../src/coord/dispatch.js';
import { clearSender } from '../src/inject/send.js';
import type { Runner, Tmux } from '../src/exec.js';
import type { FleetIO } from '../src/io.js';
import type { SessionRecord } from '../src/registry.js';
import { configDirFor } from '../src/config.js';
import { CONVERSATION_ROTATE_READS, conversationAfterClearFor, type TurnReadDeps } from '../src/turnverdict.js';
import { testDeps } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';

const PROJECT = 'demo';
const FRESH = 'demo-quiet-mesa';
const HELD = 'demo-held-reef';

const seed = (home: string, id: string): void => {
  const reg = path.join(home, '.cc-sessions');
  mkdirSync(reg, { recursive: true });
  const fields: Record<string, string> = {
    wrapper: 'claude', project: PROJECT, workdir: `/w/${id}`, uuid: `u-${id}`, started: '1',
    workspace: id, branch: `ws/${id}`, base: 'origin/main',
  };
  for (const [k, v] of Object.entries(fields)) writeFileSync(path.join(reg, `${id}.${k}`), v);
};

const CLEAR_PANES = ['scrollback\n❯ \n', 'scrollback\n❯ /clear\n', 'scrollback\n❯ \n'];

function makeRunner(home: string): Runner {
  let capIdx = 0;
  return async (_cmd, args) => {
    const verb = args[0] ?? '';
    if (verb === 'ws-add') { seed(home, FRESH); return { ran: true, code: 0, stdout: '', stderr: '' }; }
    if (verb === 'capture-pane') {
      const p = CLEAR_PANES[Math.min(capIdx, CLEAR_PANES.length - 1)]!;
      capIdx++;
      return { ran: true, code: 0, stdout: p, stderr: '' };
    }
    return { ran: true, code: 0, stdout: '', stderr: '' };
  };
}

interface HarnessCfg {
  /** Bind the run to an existing session first: the resume arm. */
  resume?: boolean;
  sendClear?: DispatchRunDeps['sendClear'];
  conversationAfterClear?: DispatchRunDeps['conversationAfterClear'];
}

const harness = (cfg: HarnessCfg = {}) => {
  const home = mkTmp('ccrc-dispatch-conv-');
  mkdirSync(path.join(home, '.cc-sessions'), { recursive: true });
  const coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
  const opened = coord.openRun({ program: 'p', title: 't', project: PROJECT, wave: 1, waveOf: 2, claimedBy: 'c' });
  if (!('id' in opened)) throw new Error(`fixture openRun refused: ${JSON.stringify(opened)}`);
  if (cfg.resume === true) {
    seed(home, HELD);
    coord.setSession(opened.id, HELD);
  }
  const base = testDeps(home, makeRunner(home));
  const deps: DispatchRunDeps = {
    ...base, coord,
    fleetState: { connected: true, downSince: null, ccdVerbs: null, rosterFp: null, build: null },
    configDir: (w: string) => configDirFor(base.cfg, w), turnVerdict: async () => 'idle' as const,
    sendClear: cfg.sendClear ?? clearSender(base),
    ...(cfg.conversationAfterClear === undefined ? {} : { conversationAfterClear: cfg.conversationAfterClear }),
  };
  return {
    dispatch: () => dispatchRun(deps, opened.id, 'go', undefined, {}),
    conversation: (): unknown => (coord.db.prepare('SELECT dispatchConversation AS c FROM runs WHERE id = ?').get(opened.id) as { c: unknown }).c,
  };
};

describe('dispatch records the conversation a run was dispatched into (F3)', () => {
  it('a fresh spawn records the registry id ccd started the session under', async () => {
    const h = harness();
    expect(await h.dispatch()).toMatchObject({ ok: true });
    expect(h.conversation()).toBe(`u-${FRESH}`);
  });

  it('a resume records the id the live process names after its /clear, asked with the registry id from before it', async () => {
    const asked: [string, string][] = [];
    const h = harness({ resume: true, conversationAfterClear: async (rec, prior) => { asked.push([rec.id, prior]); return 'conv-new'; } });
    expect(await h.dispatch()).toMatchObject({ ok: true });
    expect(h.conversation()).toBe('conv-new');
    expect(asked).toEqual([[HELD, `u-${HELD}`]]);
  });

  it('a resume whose /clear was refused records null and never asks (F10\')', async () => {
    let asked = 0;
    const h = harness({ resume: true, sendClear: async () => ({ ok: false, error: 'dialog-open' }),
      conversationAfterClear: async () => { asked++; return 'conv-new'; } });
    expect(await h.dispatch()).toMatchObject({ ok: true });
    expect(h.conversation()).toBeNull();
    expect(asked).toBe(0);
  });

  it('a resume with no port, a port that answers null, or a port that throws records null', async () => {
    const none = harness({ resume: true });
    expect(await none.dispatch()).toMatchObject({ ok: true });
    expect(none.conversation()).toBeNull();
    const unread = harness({ resume: true, conversationAfterClear: async () => null });
    expect(await unread.dispatch()).toMatchObject({ ok: true });
    expect(unread.conversation()).toBeNull();
    const threw = harness({ resume: true, conversationAfterClear: async () => { throw new Error('agent link down'); } });
    expect(await threw.dispatch()).toMatchObject({ ok: true });
    expect(threw.conversation()).toBeNull();
  });
});

describe('conversationAfterClearFor reads the live process until it names another conversation (F3)', () => {
  const PID = 4242;
  const rec = { id: HELD, wrapper: 'claude' } as SessionRecord;
  const reads = (answers: (string | 'absent' | 'unreadable')[]) => {
    const home = mkTmp('ccrc-conv-read-');
    const base = testDeps(home);
    let n = 0;
    const io = {
      readFileMeasured: async () => {
        const a = answers[Math.min(n, answers.length - 1)]!;
        n++;
        if (a === 'absent' || a === 'unreadable') return { ok: false, reason: a };
        return { ok: true, content: JSON.stringify({ pid: PID, sessionId: a, status: 'idle' }) };
      },
    } as unknown as FleetIO;
    const d: TurnReadDeps = { io, cfg: base.cfg, tmux: { panePid: async () => PID } as unknown as Tmux,
      pendingDialogs: () => undefined, statuslines: () => undefined };
    return { d, count: () => n };
  };

  it('answers the first id other than the prior one, reading again while it still names the prior', async () => {
    const r = reads(['u-old', 'u-old', 'u-new']);
    expect(await conversationAfterClearFor(r.d, rec, 'u-old')).toBe('u-new');
    expect(r.count()).toBe(3);
  });

  it('answers null when the id never moves within its reads, never the prior id', async () => {
    const r = reads(['u-old']);
    expect(await conversationAfterClearFor(r.d, rec, 'u-old', 3)).toBeNull();
    expect(r.count()).toBe(3);
    expect(CONVERSATION_ROTATE_READS).toBeGreaterThan(1);
  });

  it('answers null at once for an absent or unreadable live file, or a pane with no pid', async () => {
    expect(await conversationAfterClearFor(reads(['absent']).d, rec, 'u-old')).toBeNull();
    expect(await conversationAfterClearFor(reads(['unreadable']).d, rec, 'u-old')).toBeNull();
    const r = reads(['u-new']);
    const noPane: TurnReadDeps = { ...r.d, tmux: { panePid: async () => null } as unknown as Tmux };
    expect(await conversationAfterClearFor(noPane, rec, 'u-old')).toBeNull();
    expect(r.count()).toBe(0);
  });
});
