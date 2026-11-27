// Time the session hook per call, as Claude Code starts the registered command on Windows (MSYS2's bash -c '<command>'),
// in a throwaway fixture HOME (never the live one), in either mode: `bash` runs ~/.cc-sessions/session-hook.sh, `go`
// runs ~/.local/libexec/ccrc/core/ccrc-core hook (built from core/ by core/build.sh into the fixture).
// Usage: node win/bench/hook-time.mjs [runs=50] [bash|go|both=both] [events=SessionStart,PreToolUse,Stop]
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { summarise } from './timing-report.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const GENERATION = '0189abcd-1234-5678-9abc-0123456789ab';
const runs = Number(process.argv[2] ?? 50);
const modes = (process.argv[3] ?? 'both') === 'both' ? ['bash', 'go'] : [process.argv[3]];
const events = (process.argv[4] ?? 'SessionStart,PreToolUse,Stop').split(',');
const win = process.platform === 'win32';
// MSYS2's bash, the shell Claude Code runs hooks in there (ccd's _pane_shell_env); bash elsewhere.
const bash = process.env.CCRC_BASH ?? (win ? 'C:/msys64/usr/bin/bash.exe' : 'bash');
const COMMAND = { bash: 'bash "$HOME/.cc-sessions/session-hook.sh"', go: '"$HOME/.local/libexec/ccrc/core/ccrc-core" hook' };
const PAYLOAD = {
  SessionStart: { hook_event_name: 'SessionStart', session_id: 'uuid-1', source: 'startup', cwd: '/w' },
  PreToolUse: { hook_event_name: 'PreToolUse', session_id: 'uuid-1', tool_name: 'Bash', tool_input: { command: 'ls' }, cwd: '/w' },
  Stop: { hook_event_name: 'Stop', session_id: 'uuid-1', cwd: '/w' },
};

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ccrc-hook-time-'));
try {
  const reg = path.join(home, '.cc-sessions');
  fs.mkdirSync(reg, { recursive: true });
  fs.copyFileSync(path.join(ROOT, 'ccd', 'session-hook.sh'), path.join(reg, 'session-hook.sh'));
  fs.cpSync(path.join(ROOT, 'ccd', 'lib'), path.join(reg, 'lib'), { recursive: true });
  fs.writeFileSync(path.join(reg, 'demo-quiet-basin.generation'), GENERATION);
  if (modes.includes('go')) {
    const core = path.join(home, '.local', 'libexec', 'ccrc', 'core');
    const target = `${win ? 'windows' : process.platform}-${process.arch === 'arm64' ? 'arm64' : 'amd64'}`;
    const exe = win ? 'ccrc-core.exe' : 'ccrc-core';
    if (process.env.CCRC_CORE_EXE) { // a binary built beforehand (core/build.sh's flags), where this shell cannot build one
      fs.mkdirSync(core, { recursive: true });
      fs.copyFileSync(process.env.CCRC_CORE_EXE, path.join(core, exe));
    } else {
      execFileSync(bash, [path.join(ROOT, 'core', 'build.sh').replace(/\\/g, '/'), core.replace(/\\/g, '/'), target], { stdio: 'inherit' });
      fs.renameSync(path.join(core, target, exe), path.join(core, exe));
    }  }
  // The session's tmux: by default a native stand-in built here (the box's MSYS2 tmux.exe is a program, not a script),
  // so neither mode pays a script's extra shell; STANDIN=script uses a `#!/bin/sh` stand-in instead.
  const bin = path.join(home, 'bin');
  fs.mkdirSync(bin);
  if (process.env.STANDIN === 'script') {
    fs.writeFileSync(path.join(bin, 'tmux'), '#!/bin/sh\necho "cc-demo-quiet-basin"\n', { mode: 0o755 });
  } else {
    const src = path.join(home, 'standin');
    fs.mkdirSync(src);
    fs.writeFileSync(path.join(src, 'go.mod'), 'module standin\n');
    fs.writeFileSync(path.join(src, 'main.go'), 'package main\n\nimport "fmt"\n\nfunc main() { fmt.Println("cc-demo-quiet-basin") }\n');
    execFileSync('go', ['build', '-o', path.join(bin, win ? 'tmux.exe' : 'tmux'), '.'], { cwd: src, stdio: 'inherit' });
  }
  const pathKey = Object.keys(process.env).find((k) => k.toUpperCase() === 'PATH') ?? 'PATH';
  const env = { ...process.env, HOME: home, TMUX_PANE: '%1', CLAUDE_CODE_SESSION_ID: 'uuid-1', CLAUDE_PID: '4242',
    CCRC_SESSION_GENERATION: GENERATION, CLAUDE_JOB_DIR: '' };
  if (win) {
    // Fenced, as the test harness's pathFence.ts fences a hook run: this box's user directories hold the live ccd, ccrc and
    // ccrc-api, and a second MSYS runtime (Git for Windows' bash) takes the account's profile as its home. So PATH is the
    // stand-in bin, MSYS2's /usr/bin and System32 alone, and every home variable a Windows program reads is the fixture's.
    for (const k of Object.keys(env)) if (k.toUpperCase() === 'PATH') delete env[k];
    env.PATH = [bin, path.dirname(bash), path.join(process.env.SYSTEMROOT ?? 'C:\\Windows', 'System32')].join(';');
    Object.assign(env, { USERPROFILE: home, HOMEDRIVE: home.slice(0, 2), HOMEPATH: home.slice(2) });
  } else env[pathKey] = [bin, process.env[pathKey] ?? ''].join(path.delimiter);
  // Interleaved (each run of one mode beside a run of the other), so a busy box loads both modes alike.
  for (const ev of events) {
    const input = JSON.stringify(PAYLOAD[ev]);
    const ms = Object.fromEntries(modes.map((m) => [m, []]));
    for (let i = 0; i < runs + 2; i++) {
      for (const mode of modes) {
        const t0 = process.hrtime.bigint();
        execFileSync(bash, ['-c', COMMAND[mode]], { input, env, stdio: ['pipe', 'ignore', 'ignore'] });
        if (i >= 2) ms[mode].push(Number(process.hrtime.bigint() - t0) / 1e6); // the first two warm the caches
      }
    }
    for (const mode of modes) {
      const s = summarise(ms[mode]);
      const p95 = [...ms[mode]].sort((x, y) => x - y)[Math.min(s.n - 1, Math.floor(s.n * 0.95))];
      console.log(`${mode}	${ev}	n=${s.n}	median=${s.median.toFixed(0)}ms	p95=${p95.toFixed(0)}ms`);
    }
  }
} finally {
  fs.rmSync(home, { recursive: true, force: true });
}
