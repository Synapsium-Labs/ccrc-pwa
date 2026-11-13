// server/test/ccd-launch-profile.test.ts
//
// Overlord W1a launch profiles, Task 3 (spec §3.6, H1; §3.3.7, H14; §3.3.4, C39): ccd applies the launch profile a
// session's route names, at every spawn. The row is `ccd/lib/launch-profiles.json`'s (a projection of
// `FLEET_ROLES.launchProfile`, held equal by `launch-profiles-file.test.ts`); the route fields are `profile`, `automem`
// and `compactwindow`. The substrate is `ccd-spawn-fleet-pins.test.ts`'s: both spawn lines (`--resume` and the
// `--session-id` retry), with the fleet pins armed, in a fixture HOME.
//
// CHARACTERIZATION FIRST (Review Focus 1): a row whose route names no profile spawns byte for byte as on the branch
// point, flags and environment both, on a first start, a resume (both lines), a fresh start and a routed row. The
// recording below was taken on the branch point's code, before `_profile_spawn_compose` existed.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { makeCcdHarness, ghContainedEnv, CCD, type CcdHarness } from './ccdWsHelpers.js';

const ID = 'lane-a-project-a';
const UUID = 'deadbeef-0000-4000-8000-000000000000';
const RESUME_DIES = `sleep() { :; };
    tmux() {
      echo "tmux $*" >> "$HOME/ccd-calls"
      case "$1" in
        new-session)  case "$*" in *--session-id*) : > "$HOME/pane-up" ;; esac ;;
        has-session)  [[ -e "$HOME/pane-up" ]] ;;
        list-sessions) return 0 ;;
      esac
    };`;

let h: CcdHarness;
beforeEach(() => { h = makeCcdHarness('ccrc-ccd-launch-profile-'); });
afterEach(() => { h.cleanup(); });

/** Seed a row; `route` is a list of `field value` pairs written as registry fields (what `cmd_route --set` leaves). */
const seed = (route: readonly (readonly [string, string])[] = []): void => {
  h.sh(`_reg_set ${ID} wrapper claude
        _reg_set ${ID} workdir '${h.home}'
        _reg_set ${ID} uuid ${UUID}
        ${route.map(([f, v]) => `_reg_set ${ID} ${f} '${v}'`).join('\n        ')}`);
};
/** HOME and the run's temp root, which differ per run, as placeholders; everything else is the spawn's own bytes. */
const norm = (l: string): string => l.split(h.home).join('<HOME>').replace(/CCRC_SESSION_TMPDIR='[^']*'/g, "CCRC_SESSION_TMPDIR='<TMP>'");
/** Run `_spawn_start` with `mode`, and answer the tmux new-session lines with HOME normalised, plus stderr. */
const spawn = (mode: 'new' | 'resume', pre = ''): { lines: string[]; err: string } => {
  h.sh(`rm -f "$HOME/ccd-calls" "$HOME/pane-up"`);
  const r = spawnSync('bash', ['-c', 'a_src=$A_SRC a_snip=$A_SNIP; unset A_SRC A_SNIP; source "$a_src"; eval "$a_snip"'], {
    env: ghContainedEnv(h.home, { ...h.env(), A_SRC: CCD, A_SNIP: `${RESUME_DIES} ${pre} _spawn_start ${ID} ${mode}` }, { systemd: true, tmux: true, net: true }),
    cwd: h.home, encoding: 'utf8',
  });
  const lines = h.calls().filter((c) => c.startsWith('tmux new-session')).map(norm);
  return { lines, err: r.stderr.split(h.home).join('<HOME>') };
};
/** The one `--settings` value of a spawn line, parsed (inline JSON, exactly one flag). */
const settingsOf = (l: string): Record<string, unknown> => {
  const all = [...l.matchAll(/--settings '([^']*)'/g)].map((m) => m[1] as string);
  expect(all, l).toHaveLength(1);
  return JSON.parse(all[0]!) as Record<string, unknown>;
};
/** The `env` words of a spawn line, between `exec env` and the wrapper. */
const envOf = (l: string): string[] => {
  const m = /exec env (.*?) [^ ]*'<HOME>\/\.local\/bin\/claude'/.exec(l) ?? /exec env (.*?) '[^']*\/claude'/.exec(l);
  expect(m, l).not.toBeNull();
  return m![1]!.split(' ');
};

// ── The recording (branch point d24da2880), normalised by `norm`. ────────────────────────────────────────────────
const RECORDED = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/launch-profile/branch-point.json'), 'utf8')) as Record<string, string[]>;

describe('no profile, no change: the spawn is byte for byte the branch point (Review Focus 1)', () => {
  const cases: [string, 'new' | 'resume', readonly (readonly [string, string])[], string][] = [
    ['first start', 'new', [], ''],
    ['resume, both lines', 'resume', [], ''],
    ['fresh start', 'new', [], `_reg_set ${ID} fresh ${UUID};`],
    ['routed row, resume', 'resume', [['effort', 'high'], ['workflow', 'on'], ['subagent', 'sonnet']], ''],
  ];
  for (const [name, mode, route, pre] of cases) {
    it(name, () => {
      seed(route);
      const { lines } = spawn(mode, pre);
      if (process.env.LP_RECORD === '1') console.log(`RECORD ${JSON.stringify([name, lines])}`);
      expect(lines).toStrictEqual(RECORDED[name]);
    });
  }
});

