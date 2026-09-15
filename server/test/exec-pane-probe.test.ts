// `Tmux.paneProbe` — the ONE measurement of a pane the drawer and (in wave 3)
// the fit floor both read.
//
// Every literal below was measured against tmux 3.4 on a PRIVATE socket
// (`tmux -L ccrc-probe-…`), never the fleet's server:
//
//   $ tmux -L s new-session -d -s cc-demo -x 220 -y 50 'sleep 300'
//   $ tmux -L s list-panes -t cc-demo -F '#{pane_active} #{history_size} …'
//   1 0 2000 220 50 0                                          rc=0
//   $ tmux -L s list-panes -t cc-nope -F '#{pane_active}'
//   can't find window: cc-nope                                  rc=1
//   $ tmux -L s split-window -t cc-demo 'sleep 300'
//   $ tmux -L s list-panes -t cc-demo -F '…'
//   0 0 2000 220 25 0
//   1 0 2000 220 24 0
//
// THE GONE LITERAL IS NOT `capture-pane`'S. `capture-pane` says "can't find
// pane: cc-nope"; `list-panes` says "can't find WINDOW". Two verbs, two
// messages, and folding them into one substring test would make a real
// `unreadable` read as death.
import { describe, it, expect } from 'vitest';
import { Tmux, PANE_PROBE_FORMAT, type ExecResult, type Runner } from '../src/exec.js';
import type { PaneProbe } from '../../shared/api.js';

const ID = 'claude-a-MekWarLive';

const probeOn = async (r: ExecResult): Promise<{ probe: PaneProbe; calls: string[][] }> => {
  const calls: string[][] = [];
  const run: Runner = async (cmd, args) => {
    calls.push([cmd, ...args]);
    return r;
  };
  const probe = await new Tmux(run).paneProbe(ID);
  return { probe, calls };
};

describe('Tmux.paneProbe', () => {
  it('asks for the six formats in one list-panes, against cc-<id>', async () => {
    const { calls } = await probeOn({ code: 0, stdout: '1 0 2000 220 50 0\n', stderr: '' });
    expect(calls).toEqual([['tmux', 'list-panes', '-t', `cc-${ID}`, '-F', PANE_PROBE_FORMAT]]);
    // The format string is the contract with tmux, so it is spelled out here
    // rather than only referenced — a reordering would silently swap two of
    // the numbers below for each other.
    expect(PANE_PROBE_FORMAT).toBe(
      '#{pane_active} #{history_size} #{history_limit} #{pane_width} #{pane_height} #{alternate_on}');
  });

  it('reads the six numbers off a single-pane window', async () => {
    const { probe } = await probeOn({ code: 0, stdout: '1 0 2000 220 50 0\n', stderr: '' });
    expect(probe).toEqual({ ok: true, history: 0, limit: 2000, width: 220, height: 50, alternate: false });
  });

  it('selects the ACTIVE row on a split window, not the first (F7)', async () => {
    // PR #96 read row [0] and mismatched here: pane 0 carried the history,
    // pane 1 was active and is what `capture-pane -t <session>` returns. A
    // probe that describes a pane the capture did not read is worse than none.
    const { probe } = await probeOn({ code: 0, stdout: '0 278 2000 220 25 0\n1 5 2000 220 24 1\n', stderr: '' });
    expect(probe).toEqual({ ok: true, history: 5, limit: 2000, width: 220, height: 24, alternate: true });
  });

  it("answers `gone` on list-panes' own missing-target message, measured verbatim", async () => {
    const { probe } = await probeOn({ code: 1, stdout: '', stderr: "can't find window: cc-nope\n" });
    expect(probe).toEqual({ ok: false, reason: 'gone' });
  });

  it('answers `unreadable` with the reason for any other tmux refusal', async () => {
    const { probe } = await probeOn({ code: 1, stdout: '', stderr: 'no server running on /tmp/tmux-1000/default\n' });
    expect(probe).toEqual({ ok: false, reason: 'unreadable', detail: 'no server running on /tmp/tmux-1000/default' });
    // An unrecognised FUTURE tmux error must read as "we could not look", never
    // as death — `classifyHasSession`'s polarity (D-308/D-309).
    const odd = await probeOn({ code: 3, stdout: '', stderr: '' });
    expect(odd.probe).toEqual({ ok: false, reason: 'unreadable', detail: 'tmux exited 3 with no message' });
  });

  it('answers `unparseable` when tmux succeeded but no row claims to be active', async () => {
    const { probe } = await probeOn({ code: 0, stdout: '0 12 2000 220 25 0\n', stderr: '' });
    expect(probe).toEqual({
      ok: false, reason: 'unparseable',
      detail: 'list-panes returned 1 row(s), none active',
    });
  });

  it('answers `unparseable` when the active row is not six numbers', async () => {
    const { probe } = await probeOn({ code: 0, stdout: '1 0 2000 220 fifty 0\n', stderr: '' });
    expect(probe).toEqual({
      ok: false, reason: 'unparseable',
      detail: 'active row did not match the six-field shape: 1 0 2000 220 fifty 0',
    });
  });

  it('answers `unparseable` on an empty answer rather than inventing a zero', async () => {
    const { probe } = await probeOn({ code: 0, stdout: '', stderr: '' });
    expect(probe).toEqual({
      ok: false, reason: 'unparseable',
      detail: 'list-panes returned 0 row(s), none active',
    });
  });

  it('never narrows a distinction it received — the four arms stay four', async () => {
    // The mutation this is here to catch: any refactor that folds `unreadable`
    // and `unparseable` into one token, or answers `gone` for both. Four
    // inputs, four distinct answers.
    const answers = [
      (await probeOn({ code: 0, stdout: '1 0 2000 220 50 0\n', stderr: '' })).probe,
      (await probeOn({ code: 1, stdout: '', stderr: "can't find window: cc-nope\n" })).probe,
      (await probeOn({ code: 1, stdout: '', stderr: 'boom\n' })).probe,
      (await probeOn({ code: 0, stdout: '0 1 2 3 4 0\n', stderr: '' })).probe,
    ].map((p) => (p.ok ? 'ok' : p.reason));
    expect(answers).toEqual(['ok', 'gone', 'unreadable', 'unparseable']);
  });
});
