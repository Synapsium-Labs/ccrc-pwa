// TEMPORARY PROBE (D-5435, run 600): why the join record never rotates on macOS. Removed before the wave's last commit.
// It FAILS on darwin on purpose, so its measurements travel in the assertion message; it never runs elsewhere.
import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { mkTmp } from './tmpHelpers.js';

const HOOK = path.resolve(__dirname, '../../ccd/session-hook.sh');
const GENERATION = '0189abcd-1234-5678-9abc-0123456789ab';

describe.runIf(process.platform === 'darwin')('darwin join-rotation probe', () => {
  it('measures each conjunct of the rotation, and traces the real hook', () => {
    const home = mkTmp('ccrc-probe-');
    const reg = path.join(home, '.cc-sessions');
    fs.mkdirSync(reg, { recursive: true });
    fs.writeFileSync(path.join(reg, 'demo-quiet-basin.generation'), GENERATION);
    const bin = path.join(home, 'bin');
    fs.mkdirSync(bin, { recursive: true });
    fs.writeFileSync(path.join(bin, 'tmux'), '#!/bin/sh\necho "cc-demo-quiet-basin"\n', { mode: 0o755 });
    const env = {
      ...process.env, HOME: home, PATH: `${bin}:${process.env['PATH'] ?? ''}`,
      TMUX_PANE: '%1', CLAUDE_CODE_SESSION_ID: 'uuid-1', CLAUDE_PID: '4242', CCRC_SESSION_GENERATION: GENERATION,
    };
    const snippet = [
      'echo "bash=$BASH $BASH_VERSION"; command -v mv flock stat',
      'flock --version 2>&1 | head -1',
      'd="$1"; f="$d/joined"; for i in $(seq 0 128); do echo "j$i"; done > "$f"',
      'exec {fd}<"$f"; echo "fd=$fd"',
      '[[ "$f" -ef "/dev/fd/$fd" ]] && echo ef=yes || echo ef=no',
      '[[ -L "$f" ]] && echo L=yes || echo L=no',
      'echo "statL_fd=$(stat -L -f "%d %i %HT" "/dev/fd/$fd" 2>&1)"; echo "stat_fd=$(stat -f "%d %i %HT" "/dev/fd/$fd" 2>&1)"; echo "stat_f=$(stat -f "%d %i %HT" "$f" 2>&1)"',
      'flock -n "$fd"; echo "flock_rc=$?"',
      'cur=""; { IFS= read -r -N 16384 cur <&"$fd"; }; echo "read_rc=$? len=${#cur}"; nl="${cur//[!$\'\\n\']/}"; echo "nl=${#nl}"',
      'mv -f "$f" "$d/prev"; echo "mv_rc=$?"; ls "$d"',
    ].join('\n');
    const probe = spawnSync('bash', ['-c', snippet, 'probe', home], { encoding: 'utf8', env });
    fs.writeFileSync(path.join(reg, 'demo-quiet-basin.joined'), `${Array.from({ length: 128 }, (_, i) => `j${i}`).join('\n')}\n`);
    const payload = JSON.stringify({ hook_event_name: 'SubagentStart', agent_id: 'j-new', agent_type: 'general-purpose' });
    const traced = spawnSync('bash', ['-x', HOOK], { input: payload, encoding: 'utf8', env });
    const trace = traced.stderr.split('\n');
    const from = trace.findIndex((l) => l.includes('_hook_join_record'));
    const after = fs.readdirSync(reg).sort().join(' ');
    const diag = [
      `probe rc=${probe.status}`, probe.stdout, probe.stderr,
      `hook rc=${traced.status}; registry after: ${after}`,
      ...(from < 0 ? ['no _hook_join_record in the trace', ...trace.slice(-40)] : trace.slice(from).filter((l) => /^\++ /.test(l)).slice(0, 45).map((l) => l.slice(0, 220))),
    ].join('\n');
    expect(diag).toBe('');
  });
});
