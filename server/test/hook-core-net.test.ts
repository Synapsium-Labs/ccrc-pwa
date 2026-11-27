import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { mkTmp } from './tmpHelpers.js';
import { hookBoth } from './hookTwin.js';

// The hook's one network budget (ccd/session-hook.sh, `_hook_net_bound`, HOOK_NET_BUDGET_MS = 8 s): every read the hook
// makes in an invocation (the anchor, the roster card, the start report's send) asks for its bound from ONE deadline, and a
// read that ran out its bound (or exited 124) is followed by none. The Go hook is held to the bash's behaviour on the same
// fixture: each with its own HOME, the same stub client on PATH, the same calls, the same files, and a stop at the bound.
// Fixture HOME only; the client is a stub, no live box.
const HOOK = path.resolve(__dirname, '../../ccd/session-hook.sh');
const GENERATION = '0189abcd-1234-5678-9abc-0123456789ab';
const SID = '00000000-0000-4000-8000-000000000001';
const ID = 'lane-a-project-a';

let home: string;
beforeEach(() => {
  home = mkTmp('ccrc-hook-net-');
  fs.mkdirSync(path.join(home, '.cc-sessions'), { recursive: true });
  fs.mkdirSync(path.join(home, 'bin'), { recursive: true });
  fs.mkdirSync(path.join(home, '.local', 'bin'), { recursive: true });
  fs.writeFileSync(path.join(home, '.cc-sessions', `${ID}.generation`), GENERATION);
  fs.writeFileSync(path.join(home, 'bin', 'tmux'), `#!/bin/sh\necho "cc-${ID}"\n`, { mode: 0o755 });
});
afterEach(() => { fs.rmSync(home, { recursive: true, force: true }); });

/** The stub client: it logs its argv, then answers each read after `how` (seconds to sleep, or `hang`, or `exit124`). */
const stub = (how: Record<'card' | 'runs' | 'start', string>): void => {
  const lines = ['#!/bin/sh', 'echo "$*" >> "$HOME/api.calls"', 'case "$1 $2" in'];
  const act = (h: string): string => (h === 'hang' ? 'sleep 20' : h === 'exit124' ? 'exit 124' : `sleep ${h}`);
  lines.push(`"card --anchor") ${act(how.card)}; echo '{"ok":true,"part":"anchor","form":"start","dark":true}';;`);
  lines.push(`"runs list") ${act(how.runs)}; echo '{"runs":[]}';;`);
  lines.push(`"sessions start") cat >/dev/null; ${act(how.start)}; echo '{"ok":true}'; echo "http 202" >&2;;`);
  lines.push('esac', 'exit 0');
  fs.writeFileSync(path.join(home, '.local', 'bin', 'ccrc-api'), lines.join('\n') + '\n', { mode: 0o755 });
};

const start = (source = 'clear'): object => ({
  session_id: SID, transcript_path: path.join(home, 'cfg', `${SID}.jsonl`), cwd: path.join(home, 'work'),
  hook_event_name: 'SessionStart', source, model: 'claude-model-a',
});
const hook = (p: object) => hookBoth(home, JSON.stringify(p), {
  ...process.env, HOME: home, PATH: `${path.join(home, 'bin')}${path.delimiter}${process.env['PATH'] ?? ''}`,
  TMUX_PANE: '%1', CLAUDE_CODE_SESSION_ID: SID, CLAUDE_PID: '4242', CCRC_SESSION_GENERATION: GENERATION,
}, { hook: HOOK, watch: ['api.calls'], tree: true });
const calls = (): string[] => fs.readFileSync(path.join(home, 'api.calls'), 'utf8').split('\n').filter((l) => l !== '');

describe('the one network budget of an invocation (HOOK_NET_BUDGET_MS, 8 s), in bash and in go', () => {
  // Linux and macOS only: the fixture times its reads in seconds of `sleep` against the 8 s budget, and on Windows an MSYS2
  // `sleep 3.5` under sh takes about 4 s (its process starts, measured), so 3.5 + 3.5 inside 8, or a cut at 4 s inside 6 s,
  // does not hold there in either mode; the cut itself was measured on Windows at 4.3 to 4.9 s for a hung read
  it.skipIf(process.platform === 'win32')('reads that each take 3.5 s share the 8 s: the third is not started with under a second left', () => {
    stub({ card: '3.5', runs: '3.5', start: '3.5' });
    const r = hook(start());
    expect(r.status).toBe(0);
    // the anchor (3.5 s), the roster card (3.5 s of the 4.5 s left); the start report has 1.0 s: its send needs a whole second
    expect(calls()).toEqual(['card --anchor --form start', 'runs list']);
    for (const ms of [r.ms, r.goMs]) {
      expect(ms, 'two reads of 3.5 s, and no third').toBeGreaterThanOrEqual(6900);
      expect(ms, 'inside the budget').toBeLessThan(8500);
    }
  });

  // Linux and macOS only: the fixture times its reads in seconds of `sleep` against the 8 s budget, and on Windows an MSYS2
  // `sleep 3.5` under sh takes about 4 s (its process starts, measured), so 3.5 + 3.5 inside 8, or a cut at 4 s inside 6 s,
  // does not hold there in either mode; the cut itself was measured on Windows at 4.3 to 4.9 s for a hung read
  it.skipIf(process.platform === 'win32')('a read that runs out its bound is cut there, and no later read is started (HOOK_NET_HUNG)', () => {
    stub({ card: 'hang', runs: '0', start: '0' });
    const r = hook(start());
    expect(calls(), 'the anchor hung, so neither the roster card nor the report was asked').toEqual(['card --anchor --form start']);
    for (const ms of [r.ms, r.goMs]) {
      expect(ms, 'cut at the anchor\'s 4 s bound').toBeGreaterThanOrEqual(3800);
      expect(ms).toBeLessThan(6000);
    }
    expect(fs.readFileSync(path.join(home, '.cc-sessions', `${ID}.startpending`), 'utf8')).toMatch(/^[0-9]+\t0\n0\t\{"fromId":"lane-a-project-a"/);
  });

  it('a client that exits 124 by itself reads as hung too (the bash tests `$? == 124`, not the cut)', () => {
    stub({ card: 'exit124', runs: '0', start: '0' });
    hook(start());
    expect(calls()).toEqual(['card --anchor --form start']);
  });

  it('a read that answers in time leaves the budget for the next: all three run', () => {
    stub({ card: '0', runs: '0', start: '0' });
    hook(start());
    expect(calls()).toEqual(['card --anchor --form start', 'runs list', 'sessions start lane-a-project-a --json -']);
    expect(fs.existsSync(path.join(home, '.cc-sessions', `${ID}.startpending`)), 'a 202 keeps nothing').toBe(false);
  });

  // Linux and macOS only: the fixture times its reads in seconds of `sleep` against the 8 s budget, and on Windows an MSYS2
  // `sleep 3.5` under sh takes about 4 s (its process starts, measured), so 3.5 + 3.5 inside 8, or a cut at 4 s inside 6 s,
  // does not hold there in either mode; the cut itself was measured on Windows at 4.3 to 4.9 s for a hung read
  it.skipIf(process.platform === 'win32')('a read is not started with under a second of the budget left: four reports of 2.5 s send three', () => {
    fs.writeFileSync(path.join(home, '.local', 'bin', 'ccrc-api'), '#!/bin/sh\necho "$*" >> "$HOME/api.calls"\ncat >/dev/null\nsleep 2.5\n', { mode: 0o755 });
    const line = (id: number): string => `ccrc-mail: you have new mail. Operator message ${id}: read it with your messages door.`;
    const r = hookBoth(home, JSON.stringify({ session_id: SID, transcript_path: path.join(home, 'cfg', `${SID}.jsonl`), cwd: path.join(home, 'work'),
      hook_event_name: 'UserPromptSubmit', prompt: [1, 2, 3, 4].map(line).join('\n') }), {
      ...process.env, HOME: home, PATH: `${path.join(home, 'bin')}${path.delimiter}${process.env['PATH'] ?? ''}`,
      TMUX_PANE: '%1', CLAUDE_CODE_SESSION_ID: SID, CLAUDE_PID: '4242', CCRC_SESSION_GENERATION: GENERATION, CCRC_DOOR_NONCE_SHA256: 'a'.repeat(64),
    }, { hook: HOOK, watch: ['api.calls'], tree: true });
    // 2.5 s + 2.5 s + 2.5 s = 7.5 s used; the fourth would have 0.5 s
    expect(calls()).toEqual(Array(3).fill(`sessions report ${ID} --json -`));
    for (const ms of [r.ms, r.goMs]) expect(ms).toBeLessThan(8500);
  });

  // The hookstate's `updatedAt` is the clock read where the line is written (`$(_hook_epoch_ms)` in its own jq call), which is
  // after the door's sends: a report cut at its 3 s bound puts the stamp 3 s after the hook's start, in both hooks.
  it('the hookstate\'s stamp is the write\'s own clock, taken after the door\'s reports', () => {
    fs.writeFileSync(path.join(home, '.local', 'bin', 'ccrc-api'), '#!/bin/sh\ncat >/dev/null\nsleep 4\n', { mode: 0o755 });
    // a main turn already working, so this tool event takes no stamp of its own for the line
    const now = Date.now();
    fs.writeFileSync(path.join(home, '.cc-sessions', `${ID}.turn.json`), `${JSON.stringify({ v: 1, sessionId: SID, state: 'working', event: 'UserPromptSubmit', at: now - 60_000, turnAt: now - 60_000, stopAt: null, bg: -1, bgKinds: '', bgIds: '', err: null, restartAt: null, lostBg: 0, lostKinds: '', lostIds: '', crons: -1 })}\n`);
    const r = hookBoth(home, JSON.stringify({ session_id: SID, transcript_path: path.join(home, 'cfg', `${SID}.jsonl`), cwd: path.join(home, 'work'),
      hook_event_name: 'PreToolUse', tool_name: 'mcp__door__note_add', tool_use_id: 'toolu_1', tool_input: { text: 'x' } }), {
      ...process.env, HOME: home, PATH: `${path.join(home, 'bin')}${path.delimiter}${process.env['PATH'] ?? ''}`,
      TMUX_PANE: '%1', CLAUDE_CODE_SESSION_ID: SID, CLAUDE_PID: '4242', CCRC_SESSION_GENERATION: GENERATION, CCRC_DOOR_NONCE_SHA256: 'a'.repeat(64),
    }, { hook: HOOK, watch: [`.cc-sessions/${ID}.hookstate.json`], tree: true });
    expect(r.ms, 'the report was cut at its bound').toBeGreaterThanOrEqual(2900);
    const st = JSON.parse(fs.readFileSync(path.join(home, '.cc-sessions', `${ID}.hookstate.json`), 'utf8')) as { updatedAt: number };
    expect(st.updatedAt - now, 'the bash stamps after the send').toBeGreaterThanOrEqual(2900);
  });

  // `_hook_timeout` runs its command under `timeout` or `gtimeout`; with neither on PATH it answers 127 and starts nothing.
  // The Go hook bounds in-process, so it must be told: it starts no client either, and keeps what the bash keeps. (Such a
  // box cannot ask tmux either, so the session is found by its job directory and its uuid.)
  // Not on Windows: the PATH below is built from /usr/local/bin, /usr/bin and /bin as node's fs reads them, which name
  // nothing there, so the bash hook ran with no jq and printed nothing while the Go hook, which needs no jq for a role
  // card or a delta line, printed one (final review finding 6). A Windows twin would link MSYS2's /usr/bin file by file,
  // which needs the symlink privilege, or copy it whole; and an MSYS2 box always has `timeout`.
  describe.skipIf(process.platform === 'win32')('a box with no `timeout` or `gtimeout`', () => {
    const noTimeoutPath = (): string => {
      const dir = path.join(home, 'bin-no-timeout');
      fs.mkdirSync(dir);
      for (const d of ['/usr/local/bin', '/usr/bin', '/bin']) {
        for (const f of fs.existsSync(d) ? fs.readdirSync(d) : []) {
          if (f === 'timeout' || f === 'gtimeout' || fs.existsSync(path.join(dir, f))) continue;
          try { fs.symlinkSync(path.join(d, f), path.join(dir, f)); } catch { /* a name taken */ }
        }
      }
      return `${path.join(home, 'bin')}${path.delimiter}${dir}`;
    };
    const bare = (p: object, extra: NodeJS.ProcessEnv = {}) => {
      fs.writeFileSync(path.join(home, '.cc-sessions', `${ID}.uuid`), `${SID}\n`);
      return hookBoth(home, JSON.stringify(p), {
        ...process.env, HOME: home, PATH: noTimeoutPath(),
        CLAUDE_JOB_DIR: path.join(home, 'job'), CLAUDE_CODE_SESSION_ID: SID, CLAUDE_PID: '4242', CCRC_SESSION_GENERATION: GENERATION, ...extra,
      }, { hook: HOOK, watch: ['api.calls'], tree: true });
    };

    it('no read is started, and the start report is kept for the next prompt', () => {
      stub({ card: '0', runs: '0', start: '0' });
      const r = bare(start());
      expect(r.status).toBe(0);
      expect(fs.existsSync(path.join(home, 'api.calls')), 'the client never ran').toBe(false);
      expect(fs.readFileSync(path.join(home, '.cc-sessions', `${ID}.startpending`), 'utf8')).toMatch(/^[0-9]+\t0\n0\t\{"fromId":"lane-a-project-a"/);
    });

    it('the door\'s delta, read under `timeout`, reads as the unknown line', () => {
      const at = Date.now();
      const d = path.join(home, '.cc-sessions', '.door', ID);
      fs.mkdirSync(d, { recursive: true });
      fs.writeFileSync(path.join(d, 'delta'), `v=1 at=${at} until=${at + 180_000}\nccrc-delta: fresh`);
      const r = bare({ session_id: SID, transcript_path: path.join(home, 'cfg', `${SID}.jsonl`), cwd: path.join(home, 'work'),
        hook_event_name: 'UserPromptSubmit', prompt: 'carry on' }, { CCRC_DOOR_NONCE_SHA256: 'a'.repeat(64) });
      expect(r.stdout).toContain('ccrc-delta: unknown');
      expect(r.stdout).not.toContain('fresh');
    });
  });
});
