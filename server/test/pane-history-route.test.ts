// GET /api/sessions/:id/pane/history — the terminal drawer's scrollback.
//
// The drawer attaches with `tmux attach`, which puts the CLIENT on the
// alternate screen; xterm has no scrollback there and turns the wheel into
// arrow keys aimed at the pane. The pane is NOT in alt mode and tmux holds its
// history, so the drawer reads that history instead of driving the pane.
//
// Everything pinned here is about the READ staying a read, and about the three
// answers staying three: content, gone, and could-not-look.
import { describe, it, expect } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../src/server.js';
import { loadConfig } from '../src/config.js';
import { Tmux, type ExecResult, type Runner } from '../src/exec.js';
import { localIO } from '../src/io.js';
import { ccdRunner } from '../src/lifecycle.js';
import { Bus } from '../src/bus.js';
import { mkTmp } from './tmpHelpers.js';
import { seedRoster } from './helpers.js';
import { KeyedQueue } from '../src/inject/queue.js';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const ID = 'claude-a-MekWarLive';

async function makeApp(
  capture: ExecResult,
  listPanes: ExecResult = { code: 0, stdout: '', stderr: '' },
): Promise<{ app: FastifyInstance; calls: string[][] }> {
  const home = mkTmp('ccrc-pane-history-');
  seedRoster(home);
  const calls: string[][] = [];
  const run: Runner = async (cmd, args) => {
    calls.push([cmd, ...args]);
    if (args[0] === 'capture-pane') return capture;
    if (args[0] === 'list-panes') return listPanes;
    return { code: 0, stdout: '', stderr: '' };
  };
  const cfg = loadConfig({ CCRC_HOME: home });
  const app = await buildServer(
    { cfg, runCcd: ccdRunner(run, cfg), tmux: new Tmux(run), io: localIO, queue: new KeyedQueue() },
    new Bus(),
  );
  return { app, calls };
}

const HISTORY = 'older output\nolder still\n';

describe('GET /api/sessions/:id/pane/history', () => {
  it('reads the pane history with capture-pane and answers it verbatim', async () => {
    const { app, calls } = await makeApp({ code: 0, stdout: HISTORY, stderr: '' });
    const res = await app.inject({ method: 'GET', url: `/api/sessions/${ID}/pane/history` });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, text: HISTORY, lines: 2000 });
    // THE ARGV IS THE GUARD. `-p` to stdout, `-e` so the history keeps the
    // colours it was written in, `-S -2000` to start above the screen, and
    // `-J` so a line wrapped at the PANE's width arrives as the one logical
    // line it was, for the reader to wrap at THEIRS. All four are reachable
    // under the agent's existing `['capture-pane']` grant — flags are not
    // checked, only the verb — so nothing here widens the closed exec surface
    // and this never has to ship to the fleet host ahead of the server.
    //
    // WHY `-J` EARNS ITS PLACE, measured on a private socket against a real
    // 200-column transcript: 1882 captured lines become 1113 (-41%) for +0.05%
    // of bytes, and a 43-column phone renders 5861 rows instead of 6130 —
    // which also puts the read back inside the drawer's own `lines * 3`
    // scrollback budget, over which today's capture silently spills. Without
    // it the phone wraps text that tmux already wrapped, and a word breaks
    // twice.
    expect(calls.filter((c) => c[1] === 'capture-pane')).toEqual([
      ['tmux', 'capture-pane', '-t', `cc-${ID}`, '-p', '-e', '-J', '-S', '-2000'],
    ]);
    await app.close();
  });

  it('mutates nothing on the pane — no copy-mode, no send-keys, no resize', async () => {
    // The alternative fixes all put the PANE in copy mode, which is shared with
    // every other attached client and, measured against tmux 3.4, makes
    // `send-keys -l` hang for as long as it lasts. This route must stay a read.
    //
    // The list is EXACT, not a filter, and that is the guard: both verbs here
    // are reads, and the day a mutating one is added to this route — copy-mode,
    // send-keys, resize-window — this line is what refuses it. Growing the list
    // is a deliberate act with this comment in front of it.
    const { app, calls } = await makeApp({ code: 0, stdout: HISTORY, stderr: '' });
    await app.inject({ method: 'GET', url: `/api/sessions/${ID}/pane/history` });

    expect(calls.map((c) => c[1])).toEqual(['capture-pane', 'list-panes']);
    await app.close();
  });

  it('tells a dead pane (404) apart from a tmux that could not answer (502)', async () => {
    // tmux 3.4's own message for a session that is not there, measured.
    const gone = await makeApp({ code: 1, stdout: '', stderr: "can't find pane: cc-nope\n" });
    const goneRes = await gone.app.inject({ method: 'GET', url: `/api/sessions/${ID}/pane/history` });
    expect(goneRes.statusCode).toBe(404);
    expect(goneRes.json()).toEqual({ ok: false, error: 'gone' });
    await gone.app.close();

    // Anything else is UNKNOWN, never death: an unrecognised future tmux error
    // must read as "we could not look", with the reason carried out to the
    // reader rather than collapsed into the same 404.
    const down = await makeApp({ code: 1, stdout: '', stderr: 'error connecting to /tmp/tmux-1000/default (No such file or directory)\n' });
    const downRes = await down.app.inject({ method: 'GET', url: `/api/sessions/${ID}/pane/history` });
    expect(downRes.statusCode).toBe(502);
    expect(downRes.json()).toEqual({
      ok: false,
      error: 'unmeasured',
      detail: 'error connecting to /tmp/tmux-1000/default (No such file or directory)',
    });
    await down.app.close();
  });

  it('a failure with nothing to say still says something', async () => {
    const { app } = await makeApp({ code: 3, stdout: '', stderr: '' });
    const res = await app.inject({ method: 'GET', url: `/api/sessions/${ID}/pane/history` });
    expect(res.statusCode).toBe(502);
    expect(res.json()).toEqual({ ok: false, error: 'unmeasured', detail: 'tmux exited 3 with no message' });
    await app.close();
  });

  it('refuses a session id that is not one, before tmux is reached at all', async () => {
    const { app, calls } = await makeApp({ code: 0, stdout: HISTORY, stderr: '' });
    const res = await app.inject({ method: 'GET', url: '/api/sessions/..%2Fetc/pane/history' });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ ok: false, error: 'bad-session-id' });
    expect(calls).toEqual([]);
    await app.close();
  });

  // — how much is actually up there —
  //
  // `capture-pane` answers with the VISIBLE SCREEN even when nothing has ever
  // scrolled off, so a 200 alone cannot tell a history from a second copy of
  // what the reader is already looking at. The drawer needs the difference to
  // say something true rather than open a view with an empty scrollbar in it,
  // and this route is where the difference is measured.
  it('carries the scrollback measurement beside the text, off the verb that was already allowed', async () => {
    const { app, calls } = await makeApp(
      { code: 0, stdout: HISTORY, stderr: '' },
      { code: 0, stdout: '1979 0\n', stderr: '' },
    );
    const res = await app.inject({ method: 'GET', url: `/api/sessions/${ID}/pane/history` });

    expect(res.json()).toEqual({
      ok: true, text: HISTORY, lines: 2000, scrollback: 1979, alternate: false,
    });
    // `list-panes`, not a new verb: the whitelist entry `panePid` already uses,
    // so this widens nothing in the exec surface.
    expect(calls).toContainEqual(
      ['tmux', 'list-panes', '-t', `cc-${ID}`, '-F', '#{history_size} #{alternate_on}']);
  });

  it('reports the alternate screen as CONTEXT, beside the count that decides', async () => {
    // Not as the reason: measured on a private tmux 3.4 socket, a pane keeps
    // the scrollback it already had when it enters the alternate screen (453
    // lines still captured at `alternate_on=1`). The flag says only that
    // nothing new will scroll off while the full-screen app is up — so the
    // route carries both facts and lets the reader's own words be chosen from
    // the pair.
    const { app } = await makeApp(
      { code: 0, stdout: 'a full screen\n', stderr: '' },
      { code: 0, stdout: '0 1\n', stderr: '' },
    );
    const res = await app.inject({ method: 'GET', url: `/api/sessions/${ID}/pane/history` });

    expect(res.json()).toMatchObject({ ok: true, scrollback: 0, alternate: true });
  });

  it('an unmeasurable probe OMITS both fields — absence is not zero', async () => {
    // The whole point of the pair. A tmux that cannot answer must leave a
    // reader with the behaviour the drawer shipped with; reporting zero here
    // would make every unreachable pane claim it has no history.
    const { app } = await makeApp(
      { code: 0, stdout: HISTORY, stderr: '' },
      { code: 1, stderr: "can't find pane: cc-nope", stdout: '' },
    );
    const res = await app.inject({ method: 'GET', url: `/api/sessions/${ID}/pane/history` });

    expect(res.json()).toEqual({ ok: true, text: HISTORY, lines: 2000 });
  });
});

// F1 FALSIFIED THE CLAIM THESE COMMENTS CARRIED, and a comment is not a
// mechanism — so this is the mechanism. Measured on a private tmux 3.4 socket:
// `resize-window -x 43` on a 220-column pane holding 1853 stored lines reflows
// `history_size` to 9460; at `history-limit 2000` the next output sheds ~600
// lines and restoring 220 leaves 1746 logical lines of 1903, oldest gone. tmux
// REFLOWS. What `-J` actually buys is that a LOGICAL line survives that reflow
// and the reader wraps it once, at its own width.
describe('the shipped comments say what F1 measured', () => {
  const root = path.resolve(__dirname, '../..');
  const read = (rel: string): string => readFileSync(path.join(root, rel), 'utf8');
  const SOURCES = ['server/src/exec.ts', 'pwa/src/session/TerminalDrawer.tsx'] as const;

  it('no shipped comment claims tmux never reflows a stored line (F1)', () => {
    const offenders = SOURCES.filter((rel) => /tmux (never|does not) reflow/i.test(read(rel)));
    expect(offenders, 'a shipped comment still asserts what F1 falsified').toEqual([]);
  });

  it('the scan is looking at something — both files are real and mention reflow', () => {
    for (const rel of SOURCES) {
      expect(read(rel).length, `${rel} is empty or missing`).toBeGreaterThan(1000);
      expect(read(rel), `${rel} lost its reflow note entirely`).toMatch(/reflow/i);
    }
  });

  it('the -J note counts rows DOWN, not up — joining cannot render more rows', () => {
    const src = read('server/test/pane-history-route.test.ts');
    const m = /renders (\d+) rows instead of (\d+)/.exec(src);
    expect(m, 'the -J row measurement went missing from this file').not.toBeNull();
    const withJ = Number(m![1]);
    const without = Number(m![2]);
    expect(withJ, 'the numbers are inverted: -J joins lines, so it renders FEWER rows')
      .toBeLessThan(without);
  });
});
