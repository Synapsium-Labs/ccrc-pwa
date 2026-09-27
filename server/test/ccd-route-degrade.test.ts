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
import { eventsOf, decOf } from './lifecycleHelpers.js';

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
const swapLog = (): string => fs.readFileSync(path.join(h.home, '.cc-sessions', 'swap.log'), 'utf8');
// `makeCcdHarness` stubs the roster's home-able ids only (`ccd-auto-swap-pool.test.ts`'s
// `install()`, copied): `gpt` (the roster's non-Anthropic, non-home-able lane) needs its own
// binary planted before a case can spawn on it.
const install = (w: string): void => {
  fs.writeFileSync(path.join(h.home, '.local', 'bin', w), '#!/bin/sh\n', { mode: 0o755 });
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
    expect(decOf(rows[0]!)).toMatchObject({ actor: 'ccd' });
  });

  it('class fable on a NON-Anthropic wrapper: unservable by BACKEND, not by a fabricated ceiling — --model opus, degraded=opus, dec.reason names backend', () => {
    // Ruling S3-R6: `_serviceable`'s rc 1 has two causes and the settle used to
    // discard which one — a `class fable` session on a codex lane journalled a
    // permanent route row asserting a ceiling figure nobody read. `gpt` is the
    // test roster's non-Anthropic lane (`DEFAULT_TEST_ROSTER`, telemetry: 'none'),
    // not home-able, so it needs its own binary installed.
    install('gpt');
    seed('myid', 'gpt'); h.sh('_reg_set myid class fable');
    const [p] = spawnBoth('myid');
    expectModel(p, 'opus');
    expect(h.reg('myid', 'degraded')).toBe('opus');
    const rows = eventsOf(h.home, 'route'); expect(rows).toHaveLength(1);
    const reason = String(decOf(rows[0]!)['reason']);
    expect(reason).toContain('backend');
    expect(reason).not.toContain('ceiling');
  });

  it('a degrade stamp that cannot be WRITTEN at settle: composes the INTENDED class, no stamp, no route row, one swap.log line', () => {
    // Ruling S3-R7. `_route_degrade` returns 1 when its `_reg_set` fails
    // (before the journal row and the swap.log line), and the settle used to
    // set `rdeg="$below"` unconditionally — the spawn composed `--model opus`
    // with no stamp, no row and no log line. The failure is planted the way
    // `_reg_set` can actually fail (`ccd-swap-target-class.test.ts`'s
    // degrade-unwritable case): a DIRECTORY at the field's own path, so
    // `_reg_get`'s `-f` guard reads the standing value as absent too.
    seed('myid'); h.sh('_reg_set myid class fable'); sweep({ claude: 0.5 });
    const stamp = path.join(h.home, '.cc-sessions', 'myid.degraded');
    fs.mkdirSync(stamp);
    const [p] = spawnBoth('myid');
    expectModel(p, 'fable');
    expect(fs.statSync(stamp).isDirectory(), 'nothing was written over the unwritable field').toBe(true);
    expect(eventsOf(h.home, 'route')).toHaveLength(0);
    expect(swapLog()).toContain(
      'degrade-unwritable myid: fable -> opus at settle on claude (stamp not written; composing fable)');
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

  it('a standing degraded=opus STALE against a NEW intended class (rerouted to haiku), lane UNMEASURED: the stamp is cleared, --model haiku, a restore row whose reason starts stale:', () => {
    // Ruling S3-R7, and this settle is now the BACKSTOP rather than the only
    // reader: since the final review's finding 4 the routing writers clear a
    // stale stamp at the moment the class is written (`_route_stale_degrade_clear`,
    // pinned in `ccd-route-apply.test.ts`), because a live session's applier
    // reads the stamp every five seconds and would otherwise type the OLD rung.
    // What reaches here is a stamp that went stale by some other route — a
    // record written before that fix, or a hand edit. A stamp measured for the
    // OLD intended class (fable -> opus) outliving a reroute to `class haiku` is
    // one rung ABOVE the class asked for, from a measurement about a class
    // nobody intends anymore. No
    // limits/sweep file: the lane is UNMEASURED at haiku, so absent the stale
    // check this settle would compose the stale `opus` stamp unchanged.
    seed('myid'); h.sh('_reg_set myid class haiku; _reg_set myid degraded opus');
    const [p] = spawnBoth('myid');
    expectModel(p, 'haiku');
    expect(h.reg('myid', 'degraded')).toBeNull();
    const rows = eventsOf(h.home, 'route'); expect(rows).toHaveLength(1);
    expect(String(rows[0]!['detail'])).toBe('degraded: opus -> ∅');
    expect(String(decOf(rows[0]!)['reason'])).toMatch(/^stale:/);
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
    expect(swapLog()).toContain('class haiku takes no effort level — the effort field is ignored');
  });

  it('the same stamp twice writes one row: a second settle on the same unservable lane is silent', () => {
    seed('myid'); h.sh('_reg_set myid class fable'); sweep({ claude: 0.5 });
    spawnBoth('myid'); h.sh('rm -f "$HOME/pane-up"');
    h.sh(`${RESUME_DIES} _spawn_start myid resume 2>/dev/null`);
    expect(eventsOf(h.home, 'route')).toHaveLength(1);
  });

  it('no record at all: byte-identical to today, nothing read, nothing stamped', () => {
    seed('myid'); sweep({ claude: 0.9 }); limits('claude', 99, 99);
    const [p, r] = spawnBoth('myid');
    expect(p).toBe(today(`--resume '${UUID}'`)); expect(r).toBe(today(`--session-id '${UUID}'`));
    expect(h.reg('myid', 'degraded')).toBeNull();
  });

  it('class default, explicitly recorded: the same rc-3 short-circuit, byte-identical to today', () => {
    // `_route_any` sees a routing field (the `class` file itself exists, unlike
    // the "no record at all" case above, which has none), so this exercises the
    // OTHER half of `_serviceable`'s rc-3 skip: a real record whose value is
    // literally `default`, not the absence of a record.
    seed('myid'); h.sh('_reg_set myid class default'); sweep({ claude: 0.9 }); limits('claude', 99, 99);
    const [p, r] = spawnBoth('myid');
    expect(p).toBe(today(`--resume '${UUID}'`)); expect(r).toBe(today(`--session-id '${UUID}'`));
    expect(h.reg('myid', 'degraded')).toBeNull();
    expect(eventsOf(h.home, 'route')).toHaveLength(0);
  });
});
