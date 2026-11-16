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
import { makeCcdHarness, seedAccountsSh, rosterWithFacts, type CcdHarness, toolAdjToken as adj, sessionTmpToken, sessionPanePath } from './ccdWsHelpers.js';
import { paneFragment } from './worktreeIdentityFixture.js';   // path-identity W3 (R8): the pane's entry-identity writer, read from ccd's composer
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
  `cd '${h.home}' && ${paneFragment(h, 'myid', h.home)}true; cd '${h.home}' && exec env COLORTERM=truecolor ${h.sh('_resume_env')}${adj(h)}${sessionTmpToken(h)} ${sessionPanePath(h)} '${h.home}/.local/bin/claude' --effort high ${sidflag} --dangerously-skip-permissions`;

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

// The Overlord's settle arm (serviceability plan question 7, ruled F4 and F1): on a lane with no continuity record no rung
// serves a set-side session, so a stamp would claim a fallback that does not exist; but the backend, billing, share and
// seven-day tests run first as for a plain session, and the continuity arm applies on top of a passing base only.
describe('_spawn_start on a lane with no continuity record, for a set-side session', () => {
  // billing `included` and NO continuity record: the lane the arm is about (an unset billing fact would answer billing-unset first)
  const billing = (b: 'included' | 'credits'): void => { seedAccountsSh(h.home, rosterWithFacts({ claude: { fableBilling: b } })); };
  beforeEach(() => billing('included'));
  const setSide = (id: string): void => { fs.writeFileSync(path.join(h.home, '.cc-sessions', `${id}.poolset`), 'pool-a'); };
  const unmet = (): string[] => (fs.existsSync(path.join(h.home, '.cc-sessions', 'swap.log')) ? swapLog() : '')
    .split('\n').filter((l) => l.includes('continuity-unmet'));

  it('a standing degraded=opus: composes --model fable, leaves the stamp\'s bytes, no route row, exactly one continuity-unmet line', () => {
    seed('myid'); h.sh('_reg_set myid class fable; _reg_set myid degraded opus'); sweep({ claude: 0.1 }); setSide('myid');
    const stamp = path.join(h.home, '.cc-sessions', 'myid.degraded');
    const before = fs.readFileSync(stamp);
    const [p, r] = spawnBoth('myid');
    expect(p).toContain('--model fable '); expect(r).toContain('--model fable ');
    expect(fs.readFileSync(stamp).equals(before), 'the stamp is as it was').toBe(true);
    expect(eventsOf(h.home, 'route')).toHaveLength(0);
    // two spawn lines (resume then create) run ONE settle, so the line is written once per settle
    const lines = unmet();
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d continuity-unmet myid: claude \(no-continuity\); composing fable, a standing degraded stamp left as it is$/);
  });

  it('no stamp stands, the base servable: still no stamp, no route row, the line written, the intended class composed', () => {
    seed('myid'); h.sh('_reg_set myid class opus'); limits('claude', 10, 50); setSide('myid');
    const [p] = spawnBoth('myid');
    expect(p).toContain('--model opus ');
    expect(h.reg('myid', 'degraded')).toBeNull();
    expect(eventsOf(h.home, 'route')).toHaveLength(0);
    expect(unmet()).toHaveLength(1);
  });

  it('F1: the seven-day ceiling outranks the continuity word: a set-side opus session degrades like a plain one', () => {
    seed('myid'); h.sh('_reg_set myid class opus'); limits('claude', 10, 99); setSide('myid');
    const [p] = spawnBoth('myid');
    expect(p).toContain('--model sonnet ');
    expect(h.reg('myid', 'degraded')).toBe('sonnet');
    expect(unmet()).toHaveLength(0);
  });

  it('F1: set-side fable on a credits lane with no record degrades to opus with a stamp, as a plain session does', () => {
    billing('credits');
    seed('myid'); h.sh('_reg_set myid class fable'); sweep({ claude: 0.1 }); setSide('myid');
    const [p] = spawnBoth('myid');
    expect(p).toContain('--model opus ');
    expect(h.reg('myid', 'degraded')).toBe('opus');
    expect(eventsOf(h.home, 'route')).toHaveLength(1);
    expect(unmet()).toHaveLength(0);
  });

  it('F1: no record and the base UNMEASURED, a degraded stamp standing: composes the stamp\'s class, leaves it, names it in the line', () => {
    seed('myid'); h.sh('_reg_set myid class fable; _reg_set myid degraded opus'); setSide('myid');   // no sweep file
    const stamp = path.join(h.home, '.cc-sessions', 'myid.degraded');
    const before = fs.readFileSync(stamp);
    const [p] = spawnBoth('myid');
    expect(p).toContain('--model opus ');
    expect(fs.readFileSync(stamp).equals(before)).toBe(true);
    expect(eventsOf(h.home, 'route')).toHaveLength(0);
    expect(unmet()[0]).toMatch(/continuity-unmet myid: claude \(no-continuity\); composing opus, a standing degraded stamp left as it is$/);
  });

  it('an old projection says continuity-unread in the same arm', () => {
    seed('myid'); h.sh('_reg_set myid class fable; _reg_set myid degraded opus'); sweep({ claude: 0.1 }); setSide('myid');
    const sh = path.join(h.home, '.ccrc', 'accounts.sh');
    fs.writeFileSync(sh, fs.readFileSync(sh, 'utf8').replace(/^_ccrc_continuity\(\) \{\n[\s\S]*?^\}\n/m, ''));
    const [p] = spawnBoth('myid');
    expect(p).toContain('--model fable ');
    expect(h.reg('myid', 'degraded')).toBe('opus');
    expect(unmet()[0]).toContain('(continuity-unread)');
  });

  it('a PLAIN session on the same lane composes as today: the ceiling degrades it', () => {
    seed('myid'); h.sh('_reg_set myid class fable'); sweep({ claude: 0.5 });
    const [p] = spawnBoth('myid');
    expect(p).toContain('--model opus ');
    expect(h.reg('myid', 'degraded')).toBe('opus');
    expect(unmet()).toHaveLength(0);
  });

  it('a set-side session on a RECORDED lane settles as today (the ceiling degrades it), and says nothing of continuity', () => {
    seedAccountsSh(h.home, rosterWithFacts({ claude: { fableBilling: 'included', continuity: 1_790_000_000 } }));
    seed('myid'); h.sh('_reg_set myid class fable'); sweep({ claude: 0.5 }); setSide('myid');
    const [p] = spawnBoth('myid');
    expect(p).toContain('--model opus ');
    expect(h.reg('myid', 'degraded')).toBe('opus');
    expect(unmet()).toHaveLength(0);
  });
});

// THE HOLD-DOWN AT THE SETTLE (Overlord W1 ccd arms, Task 4; the index's question 9). On `main` before the hold-down, a
// standing stamp one second old on a lane that serves the intended class again was restored at the very next settle,
// whatever the route's `profile` (Step 1's characterization). The hold-down (`ccd/lib/long-lived.sh`, region `holddown`)
// changes that for a long-lived profile only: it keeps composing the degraded class, the stamp stays, and no row is
// written. `_route_stale_degrade_clear` still restores at once on a new intended class (question 4).
describe('the settle holds a fresh stamp for a long-lived profile, and restores it at once for every other', () => {
  const restored = (id: string): void => {
    const [p] = spawnBoth(id);
    expect(p).toContain('--model fable ');
    expect(h.reg(id, 'degraded')).toBeNull();
    const rows = eventsOf(h.home, 'route');
    expect(rows).toHaveLength(1);
    expect(String(rows[0]!['detail'])).toBe('degraded: opus -> ∅');
  };
  it.each([['plain'], [null]])('profile %s: a one-second degraded=opus on a lane serving fable composes --model fable, clears the stamp, one restore row', (profile) => {
    seed('myid'); h.sh(`_reg_set myid class fable; _reg_set myid degraded opus${profile ? `; _reg_set myid profile ${profile}` : ''}`);
    sweep({ claude: 0.1 });
    restored('myid');
  });
  it.each([['coordinator'], ['overlord'], ['nosuchrole']])('profile %s: the same settle holds: --model opus on both lines, the stamp stays, no route row', (profile) => {
    seed('myid'); h.sh(`_reg_set myid class fable; _reg_set myid degraded opus; _reg_set myid profile ${profile}`);
    sweep({ claude: 0.1 });
    const [p, r] = spawnBoth('myid');
    expect(p).toContain('--model opus '); expect(r).toContain('--model opus ');
    expect(h.reg('myid', 'degraded')).toBe('opus');
    expect(eventsOf(h.home, 'route')).toHaveLength(0);
  });
  it('profile coordinator: a stamp older than the hold-down is restored at the settle, as today', () => {
    seed('myid'); h.sh('_reg_set myid class fable; _reg_set myid degraded opus; _reg_set myid profile coordinator');
    h.sh(`touch -d @${now() - 3601} "$REG/myid.degraded"`);
    sweep({ claude: 0.1 });
    restored('myid');
  });
  it('profile coordinator: a new intended class clears a one-second stamp at once (_route_stale_degrade_clear)', () => {
    seed('myid'); h.sh('_reg_set myid class haiku; _reg_set myid degraded opus; _reg_set myid profile coordinator');
    h.sh('_route_stale_degrade_clear myid haiku');
    expect(h.reg('myid', 'degraded')).toBeNull();
    expect(String(eventsOf(h.home, 'route')[0]!['detail'])).toBe('degraded: opus -> ∅');
  });
});
