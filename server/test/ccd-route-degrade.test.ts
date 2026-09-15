// server/test/ccd-route-degrade.test.ts
//
// `_spawn_start` composes `--model` from the class SERVED (routing spec §5.4
// last paragraph, §5.1 `degraded`), not the class merely intended: at every
// settle it re-measures the lane the session is landing on and decides among
// three answers (`_serviceable`'s own three), never fabricating a fourth —
// servable clears a standing stamp, measured-unservable stamps one rung down,
// unmeasured composes whatever stands (or the intended class, absent a stamp)
// and writes nothing.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { makeCcdHarness, type CcdHarness } from './ccdWsHelpers.js';
import { eventsOf } from './lifecycleHelpers.js';

let h: CcdHarness;
beforeEach(() => { h = makeCcdHarness('ccrc-ccd-route-degrade-'); });
afterEach(() => { h.cleanup(); });

// Copied from ccd-route-spawn.test.ts (module-local there).
const RESUME_DIES = `sleep() { :; };
    tmux() {
      echo "tmux $*" >> "$HOME/ccd-calls"
      case "$1" in
        new-session)  case "$*" in *--session-id*) : > "$HOME/pane-up" ;; esac ;;
        has-session)  [[ -e "$HOME/pane-up" ]] ;;
        list-sessions) return 0 ;;
      esac
    };`;
const UUID = 'deadbeef-0000-4000-8000-000000000000';
const seed = (id: string, wrapper = 'claude'): void => {
  h.sh(`_reg_set ${id} wrapper ${wrapper}
        _reg_set ${id} workdir '${h.home}'
        _reg_set ${id} uuid ${UUID}`);
};
const newSessions = (): string[] => h.calls().filter((c) => c.startsWith('tmux new-session'));
const composed = (line: string): string => {
  const m = /^tmux new-session -d -s \S+ -x \d+ -y \d+ (.*)$/.exec(line);
  expect(m, line).not.toBeNull();
  return m![1]!;
};
const spawnBoth = (id: string): string[] => {
  h.sh(`${RESUME_DIES} rm -f "$HOME/pane-up"; _spawn_start ${id} resume 2>/dev/null`);
  const lines = newSessions();
  expect(lines).toHaveLength(2);
  return lines.map(composed);
};
const today = (sidflag: string): string =>
  `cd '${h.home}' && exec env COLORTERM=truecolor ${h.sh('_resume_env')} '${h.home}/.local/bin/claude'  ${sidflag} --dangerously-skip-permissions`;

// Fixture helpers, ccd-swap-target-class.test.ts's style.
const now = (): number => Math.floor(Date.now() / 1000);
const limits = (w: string, five: number, seven: number): void => {
  fs.mkdirSync(path.join(h.home, '.cc-limits'), { recursive: true });
  fs.writeFileSync(path.join(h.home, '.cc-limits', `${w}.json`),
    JSON.stringify({ five, seven, ts: now(), fiveResetAt: now() + 10_000, sevenResetAt: now() + 400_000 }));
};
const sweep = (estimates: Record<string, number | null>, ageS = 1): void => {
  const dir = path.join(h.home, '.cc-sessions', 'usage', 'sweep'); fs.mkdirSync(dir, { recursive: true });
  const finishedAt = new Date((now() - ageS) * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z');
  fs.writeFileSync(path.join(dir, 'latest.json'), JSON.stringify({ finishedAt,
    perAccount: Object.fromEntries(Object.entries(estimates).map(([a, e]) => [a, { fableShare: { estimate: e } }])) }));
};

describe('_spawn_start composes the class SERVED (routing spec §5.4 last paragraph, §5.1 degraded)', () => {
  const expectModel = (line: string, model: string | null): void => {
    if (model === null) expect(line).not.toContain('--model');
    else expect(line).toContain(`--model ${model} `);
  };

  it('class fable on a lane at the Fable ceiling: --model opus on BOTH lines, degraded=opus stamped, one route row (actor ccd)', () => {
    seed('myid'); h.sh('_reg_set myid class fable'); sweep({ claude: 0.5 });
    const [p, r] = spawnBoth('myid');
    expectModel(p, 'opus'); expectModel(r, 'opus');
    expect(h.reg('myid', 'degraded')).toBe('opus');
    const rows = eventsOf(h.home, 'route'); expect(rows).toHaveLength(1);
    expect(String(rows[0]!['detail'])).toBe('degraded: ∅ -> opus');
  });

  it('a standing degraded=opus on a lane that can serve fable again: --model fable, the stamp cleared, a restore row', () => {
    seed('myid'); h.sh('_reg_set myid class fable; _reg_set myid degraded opus'); sweep({ claude: 0.1 });
    const [p] = spawnBoth('myid');
    expectModel(p, 'fable');
    expect(h.reg('myid', 'degraded')).toBeNull();
    expect(String(eventsOf(h.home, 'route')[0]!['detail'])).toBe('degraded: opus -> ∅');
  });

  it('a standing stamp with the lane UNMEASURED: the stamp stays (it was measured when written), --model opus, no new row', () => {
    seed('myid'); h.sh('_reg_set myid class fable; _reg_set myid degraded opus');   // no sweep file
    const [p] = spawnBoth('myid');
    expectModel(p, 'opus');
    expect(h.reg('myid', 'degraded')).toBe('opus');
    expect(eventsOf(h.home, 'route')).toHaveLength(0);
  });

  it('no stamp and the lane UNMEASURED: the intended class is composed and nothing is stamped', () => {
    seed('myid'); h.sh('_reg_set myid class fable');
    const [p] = spawnBoth('myid');
    expectModel(p, 'fable');
    expect(h.reg('myid', 'degraded')).toBeNull();
  });

  it('class opus on a lane whose seven-day figure is at the ceiling: --model sonnet, degraded=sonnet', () => {
    seed('myid'); h.sh('_reg_set myid class opus'); limits('claude', 10, 98);
    const [p] = spawnBoth('myid');
    expectModel(p, 'sonnet'); expect(h.reg('myid', 'degraded')).toBe('sonnet');
  });

  it('a degrade to haiku drops the effort the record names (haiku takes none) and journals the pair note, not --effort', () => {
    seed('myid'); h.sh('_reg_set myid class sonnet; _reg_set myid effort high'); limits('claude', 10, 98);
    const [p] = spawnBoth('myid');
    expectModel(p, 'haiku'); expect(p).not.toContain('--effort');
  });

  it('the same stamp twice writes one row: a second settle on the same unservable lane is silent', () => {
    seed('myid'); h.sh('_reg_set myid class fable'); sweep({ claude: 0.5 });
    spawnBoth('myid'); h.sh('rm -f "$HOME/pane-up"');
    h.sh(`${RESUME_DIES} _spawn_start myid resume 2>/dev/null`);
    expect(eventsOf(h.home, 'route')).toHaveLength(1);
  });

  it('class default and no record: byte-identical to today, nothing read, nothing stamped', () => {
    seed('myid'); sweep({ claude: 0.9 }); limits('claude', 99, 99);
    const [p, r] = spawnBoth('myid');
    expect(p).toBe(today(`--resume '${UUID}'`)); expect(r).toBe(today(`--session-id '${UUID}'`));
    expect(h.reg('myid', 'degraded')).toBeNull();
  });
});
