// The fresh pick's decider, steps 1 and 2 and its refusals (the Overlord W1 ccd arms, PR C1: plan
// `docs/superpowers/plans/2026-11-14-overlord-w1/w1-ccd-arms.md` Task 6; spec 2026-11-09 §3.4 C56 and Table 3.4a).
// `_fresh_pick_to var id cur` reads the route's ordered account list (`acctorder`), the session's pool side and its class,
// and answers the account a renewal's fresh start lands on: step 1, the first listed account under the soft line
// (`FRESH_PICK_SOFT_PCT`) that serves the designated class, unless the hold-down holds; step 2, the same on the fallback
// class (`FRESH_PICK_FALLBACK_CLASS`, Opus), only for a Fable-designated session. A list, set or class it cannot read is a
// refusal, never a pick. It writes nothing. C1's decider is called by nothing but this file: C2 adds step 3, `stay` and the
// wiring into the fresh start.
//
// The fixture: the session runs on a `pool-a` set; `claude-a`, `claude-b` and `claude-d` are in `pool-a`, `claude` is in
// `pool-b`, and every lane carries a continuity record and included Fable billing, so `_serviceable`'s set arm reads the
// share figure. FIXTURE HOME ONLY (`makeCcdHarness`).
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { makeCcdHarness, seedAccountsSh, rosterWithFacts, plantPoolEpoch, type CcdHarness } from './ccdWsHelpers.js';

let h: CcdHarness;
const ID = 'claude-a-overlord';
const LANES = ['claude', 'claude-a', 'claude-b', 'claude-d', 'gpt'] as const;
const now = (): number => Math.floor(Date.now() / 1000);
const REG = (): string => path.join(h.home, '.cc-sessions');

beforeEach(() => {
  h = makeCcdHarness('ccrc-ccd-fresh-pick-');
  const facts = Object.fromEntries(LANES.map((w) => [w, { fableBilling: 'included' as const, continuity: 1_700_000_000 }]));
  seedAccountsSh(h.home, rosterWithFacts(facts));
  plantPoolEpoch(h.home, { claude: 'pool-b', 'claude-a': 'pool-a', 'claude-b': 'pool-a', 'claude-d': 'pool-a', gpt: 'pool-a' });
  fs.writeFileSync(path.join(REG(), `${ID}.poolset`), 'pool-a');
  h.sh(`_reg_set ${ID} wrapper claude-a; _reg_set ${ID} uuid u1; _reg_set ${ID} project demo; _reg_set ${ID} profile overlord`);
});
afterEach(() => { h.cleanup(); });

const limits = (w: string, five: number, seven = five): void => {
  fs.writeFileSync(path.join(h.home, '.cc-limits', `${w}.json`),
    JSON.stringify({ five, seven, ts: now(), fiveResetAt: now() + 10_000, sevenResetAt: now() + 400_000 }));
};
/** The sweep's Fable share per lane: under `FABLE_SHARE_CEILING_PCT` (40) serves `fable`, at or over it does not. */
const sweep = (shares: Record<string, number>): void => {
  const dir = path.join(REG(), 'usage', 'sweep'); fs.mkdirSync(dir, { recursive: true });
  const finishedAt = new Date((now() - 1) * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z');
  fs.writeFileSync(path.join(dir, 'latest.json'), JSON.stringify({ finishedAt,
    perAccount: Object.fromEntries(Object.entries(shares).map(([a, e]) => [a, { fableShare: { estimate: e } }])) }));
};
const route = (cls: string | null, list: string | null): void => {
  h.sh(cls === null ? `rm -f "$REG/${ID}.class"` : `_reg_set ${ID} class ${cls}`);
  h.sh(list === null ? `rm -f "$REG/${ID}.acctorder"` : `_reg_set ${ID} acctorder '${list}'`);
};
type Pick = { pick: string; step: string; rc: number; why: string };
/** `_fresh_pick_to v <id> <cur>`, after `pre` (stubs, a locale). The answer's four parts, `|`-joined inside `<…>`
 *  (`h.sh` trims, so an empty first part needs the bracket). */
const pick = (cur = 'claude-a', pre = ''): Pick => {
  const out = h.sh(`${pre} _fresh_pick_to v ${ID} ${cur}; rc=$?; printf '<%s|%s|%s|%s>' "$v" "$FRESH_PICK_STEP" "$rc" "$FRESH_PICK_WHY"`);
  const [p, step, rc, ...why] = out.replace(/^[\s\S]*</, '').replace(/>$/, '').split('|');
  return { pick: p ?? '', step: step ?? '', rc: Number(rc), why: why.join('|') };
};
/** A list of exactly `n` bytes of valid, distinct ids (each at most 64 bytes), `claude-b` first, so only its size can refuse it. */
const listOf = (n: number): string => {
  let l = 'claude-b';
  for (let i = 0; l.length + 65 <= n; i++) l += `,${'q'.repeat(60)}${String(i).padStart(4, '0')}`;
  return l.length === n ? l : `${l},${'r'.repeat(n - l.length - 1)}`;
};
const listWhy = (): string => `the ordered account list on ${REG()}/${ID}.acctorder cannot be read; the server writes it again at its next sweep`;
/** The registry's entries and their mtimes, so a case can say the decider wrote nothing. */
const snapshot = (): string[] => fs.readdirSync(REG()).sort().map((f) => `${f} ${fs.lstatSync(path.join(REG(), f)).mtimeMs}`);

describe('no list: today\'s behaviour', () => {
  it('no acctorder entry: the current account, step none, rc 0, whatever the loads', () => {
    route('fable', null); limits('claude-a', 99);
    expect(pick('claude-a')).toEqual({ pick: 'claude-a', step: 'none', rc: 0, why: '' });
  });
});

describe('step 1: the first listed account under the soft line that serves the designated class', () => {
  it('skips one at 75% and one where fable is unservable, and picks the next', () => {
    route('fable', 'claude-a,claude-b,claude-d');
    limits('claude-a', 75); limits('claude-b', 20); limits('claude-d', 30);
    sweep({ 'claude-a': 0.1, 'claude-b': 0.9, 'claude-d': 0.1 });
    expect(pick()).toEqual({ pick: 'claude-d', step: '1', rc: 0, why: '' });
  });

  it('the soft line is exclusive: 70% is not under it, 69% is', () => {
    route('fable', 'claude-a,claude-b');
    limits('claude-a', 70); limits('claude-b', 69); sweep({ 'claude-a': 0.1, 'claude-b': 0.1 });
    expect(pick()).toMatchObject({ pick: 'claude-b', step: '1', rc: 0 });
  });

  it('the soft line reads the larger of the two windows: a seven-day figure at 80% is over it', () => {
    route('fable', 'claude-a,claude-b');
    limits('claude-a', 10, 80); limits('claude-b', 20, 20); sweep({ 'claude-a': 0.1, 'claude-b': 0.1 });
    expect(pick()).toMatchObject({ pick: 'claude-b', step: '1' });
  });

  it('asks _class_gate with the session id, main\'s signature (serviceability A\'s seam)', () => {
    route('fable', 'claude-b'); limits('claude-b', 20);
    const r = pick('claude-a', `_class_gate() { echo "$1|$2|$3" >> "$HOME/gates"; return 0; };`);
    expect(r).toMatchObject({ pick: 'claude-b', step: '1' });
    expect(fs.readFileSync(path.join(h.home, 'gates'), 'utf8')).toBe(`claude-b|fable|${ID}\n`);
  });
});

describe('step 2: the fallback class, Opus, only for a Fable-designated session', () => {
  it('every account\'s fable unservable: the first under 70% that serves opus', () => {
    route('fable', 'claude-a,claude-b,claude-d');
    limits('claude-a', 80); limits('claude-b', 30); limits('claude-d', 10);
    sweep({ 'claude-a': 0.9, 'claude-b': 0.9, 'claude-d': 0.9 });
    expect(pick()).toEqual({ pick: 'claude-b', step: '2', rc: 0, why: '' });
  });

  it('a later account that serves fable wins over an earlier one that serves only opus: step 1 first', () => {
    route('fable', 'claude-b,claude-d');
    limits('claude-b', 10); limits('claude-d', 30); sweep({ 'claude-b': 0.9, 'claude-d': 0.1 });
    expect(pick()).toMatchObject({ pick: 'claude-d', step: '1' });
  });

  it('class opus: no step 2, and never sonnet — an account where opus is unservable is never picked on a lower rung', () => {
    route('opus', 'claude-b,claude-d'); limits('claude-b', 20); limits('claude-d', 30);
    const gates = `_class_gate() { echo "$2" >> "$HOME/gates"; [[ "$2" == sonnet ]]; };`;
    const r = pick('claude-a', gates);
    expect(r).toMatchObject({ pick: '', step: 'none', rc: 1 });
    expect(r.why).toBe('no account on the ordered list can take it: claude-b class; claude-d class');
    expect(fs.readFileSync(path.join(h.home, 'gates'), 'utf8').split('\n').filter(Boolean)).toEqual(['opus', 'opus']);
  });

  it('a class other than fable or opus has no step 2 either', () => {
    route('sonnet', 'claude-b'); limits('claude-b', 20);
    const r = pick('claude-a', `_class_gate() { echo "$2" >> "$HOME/gates"; [[ "$2" == opus ]]; };`);
    expect(r).toMatchObject({ pick: '', rc: 1 });
    expect(fs.readFileSync(path.join(h.home, 'gates'), 'utf8')).toBe('sonnet\n');
  });
});

describe('the hold-down: step 1 waits while a long-lived role\'s degraded stamp is young', () => {
  const stamp = (ageS: number): void => {
    h.sh(`_reg_set ${ID} degraded opus; touch -d @${now() - ageS} "$REG/${ID}.degraded"`);
  };
  const servable = (): void => {
    route('fable', 'claude-b,claude-d'); limits('claude-b', 20); limits('claude-d', 30);
    sweep({ 'claude-b': 0.1, 'claude-d': 0.1 });
  };

  it('a stamp younger than the hold-down skips step 1 though fable is servable: step 2 on opus', () => {
    servable(); stamp(60);
    expect(pick()).toMatchObject({ pick: 'claude-b', step: '2', rc: 0 });
  });

  it('a stamp older than the hold-down: step 1 runs', () => {
    servable(); stamp(7200);
    expect(pick()).toMatchObject({ pick: 'claude-b', step: '1' });
  });

  it('a stamp in the future skips step 1, and its mtime is unchanged (the decider writes nothing)', () => {
    servable(); stamp(-3600);
    const before = fs.statSync(path.join(REG(), `${ID}.degraded`)).mtimeMs;
    expect(pick()).toMatchObject({ pick: 'claude-b', step: '2' });
    expect(fs.statSync(path.join(REG(), `${ID}.degraded`)).mtimeMs).toBe(before);
    expect(fs.existsSync(path.join(REG(), 'swap.log'))).toBe(false);
  });

  it('no degraded stamp: no hold, though an absent stamp has no time', () => {
    servable();
    expect(pick()).toMatchObject({ pick: 'claude-b', step: '1' });
  });

  it('a row that is not long-lived is never held (plain profile, a young stamp)', () => {
    servable(); stamp(60); h.sh(`_reg_set ${ID} profile plain`);
    expect(pick()).toMatchObject({ pick: 'claude-b', step: '1' });
  });

  it('a young stamp on an opus-designated row: no step 1 and no step 2, so it refuses', () => {
    route('opus', 'claude-b'); limits('claude-b', 20); stamp(60);
    expect(pick()).toMatchObject({ pick: '', rc: 1, why: 'no account on the ordered list can take it: claude-b class' });
  });
});

describe('the hard filter: _fresh_pick_ok', () => {
  it('an account outside the set is never picked, though listed first and empty', () => {
    route('fable', 'claude,claude-b'); limits('claude', 1); limits('claude-b', 20); sweep({ claude: 0.1, 'claude-b': 0.1 });
    expect(pick()).toMatchObject({ pick: 'claude-b', step: '1' });
    route('fable', 'claude');
    expect(pick()).toMatchObject({ pick: '', rc: 1, why: 'no account on the ordered list can take it: claude pool' });
  });

  it('an id the roster does not know is skipped (pool set Q9), and so is a listed non-Anthropic account', () => {
    fs.writeFileSync(path.join(h.home, '.local', 'bin', 'gpt'), '#!/bin/sh\n', { mode: 0o755 });
    route('opus', 'claude-zz,gpt,claude-d'); limits('gpt', 5); limits('claude-d', 30);
    expect(pick()).toMatchObject({ pick: 'claude-d', step: '1' });
    route('opus', 'claude-zz,gpt');
    expect(pick().why).toBe('no account on the ordered list can take it: claude-zz unknown; gpt backend');
  });

  it('a disabled, an authdead and an at-ceiling account are skipped, each with its word', () => {
    route('fable', 'claude-a,claude-b,claude-d');
    limits('claude-a', 10); limits('claude-b', 10); limits('claude-d', 99); sweep({ 'claude-a': 0.1, 'claude-b': 0.1, 'claude-d': 0.1 });
    fs.writeFileSync(path.join(REG(), 'claude-a-disabled'), '');
    fs.writeFileSync(path.join(REG(), 'claude-b-authdead'), `${now()} auth-401`);
    expect(pick()).toEqual({ pick: '', step: 'none', rc: 1,
      why: 'no account on the ordered list can take it: claude-a disabled; claude-b authdead; claude-d at-ceiling' });
  });
});

describe('the load: an unmeasured figure never qualifies', () => {
  it('no limits file: never picked by step 1 or 2, and named load', () => {
    route('fable', 'claude-b,claude-d'); limits('claude-d', 30); sweep({ 'claude-b': 0.1, 'claude-d': 0.9 });
    expect(pick()).toMatchObject({ pick: 'claude-d', step: '2' });
    route('fable', 'claude-b');
    expect(pick()).toMatchObject({ pick: '', rc: 1, why: 'no account on the ordered list can take it: claude-b load' });
  });

  it('one window unmeasured (a seven-day figure only) is no score: load', () => {
    route('opus', 'claude-b');
    fs.writeFileSync(path.join(h.home, '.cc-limits', 'claude-b.json'), JSON.stringify({ seven: 10, ts: now(), sevenResetAt: now() + 400_000 }));
    expect(pick()).toMatchObject({ pick: '', rc: 1, why: 'no account on the ordered list can take it: claude-b load' });
  });

  it('no account under the soft line: rc 1, one clause per account, in list order', () => {
    route('fable', 'claude-d,claude-a,claude-b');
    limits('claude-a', 70); limits('claude-b', 85); limits('claude-d', 95); sweep({ 'claude-a': 0.1, 'claude-b': 0.1, 'claude-d': 0.1 });
    expect(pick()).toEqual({ pick: '', step: 'none', rc: 1,
      why: 'no account on the ordered list can take it: claude-d load; claude-a load; claude-b load' });
  });
});

describe('a no-class route: step 1 on load alone, no step 2, no hold', () => {
  it.each([[null], ['default']])('class %s: the first listed under the soft line', (cls) => {
    route(cls, 'claude-a,claude-b'); limits('claude-a', 80); limits('claude-b', 20);
    h.sh(`_reg_set ${ID} degraded opus`);
    expect(pick()).toMatchObject({ pick: 'claude-b', step: '1', rc: 0 });
  });
});

describe('refusals: undecidable is never a pick', () => {
  const unreadableList = (make: (f: string) => void): void => {
    route('fable', null); limits('claude-b', 20); sweep({ 'claude-b': 0.1 });
    make(path.join(REG(), `${ID}.acctorder`));
  };
  it.each([
    ['a FIFO', (f: string) => { h.sh(`mkfifo '${f}'`); }],
    ['a link to a good list', (f: string) => { fs.writeFileSync(`${f}.real`, 'claude-b'); fs.symlinkSync(`${f}.real`, f); }],
    ['a dangling link', (f: string) => { fs.symlinkSync(`${f}.nowhere`, f); }],
    ['a directory', (f: string) => { fs.mkdirSync(f); }],
    ['a repeat, claude-a,claude-a', (f: string) => { fs.writeFileSync(f, 'claude-a,claude-a'); }],
    ['an empty file', (f: string) => { fs.writeFileSync(f, ''); }],
    ['a 1,025-byte list of valid ids', (f: string) => { fs.writeFileSync(f, listOf(1025)); }],
    ['a NUL inside', (f: string) => { fs.writeFileSync(f, 'claude-b\0,claude-d'); }],
  ])('the list as %s refuses with the list sentence', (_n, make) => {
    unreadableList(make);
    expect(pick()).toEqual({ pick: '', step: 'none', rc: 1, why: listWhy() });
  });

  it('a 1,024-byte list is at the cap and reads', () => {
    route('fable', listOf(1024)); limits('claude-b', 20); sweep({ 'claude-b': 0.1 });
    expect(h.sh(`_acctorder_valid '${listOf(1025)}'; echo $?`)).toBe('1');
    expect(h.sh(`_acctorder_valid '${listOf(1024)}'; echo $?`)).toBe('0');
    expect(fs.statSync(path.join(REG(), `${ID}.acctorder`)).size).toBe(1024);
    expect(pick()).toMatchObject({ pick: 'claude-b', step: '1' });
  });

  it('an unreadable list (mode 000) refuses', () => {
    route('fable', 'claude-b'); limits('claude-b', 20); sweep({ 'claude-b': 0.1 });
    fs.chmodSync(path.join(REG(), `${ID}.acctorder`), 0);
    if (process.getuid?.() === 0) return;   // root reads through the mode
    expect(pick()).toMatchObject({ pick: '', rc: 1, why: listWhy() });
  });

  it.each([
    ['set-unreadable', (f: string) => { fs.rmSync(f); fs.mkdirSync(f); }, 'unreadable'],
    ['set-malformed', (f: string) => { fs.writeFileSync(f, 'Z!'); }, 'malformed'],
  ])('a %s side refuses with the set sentence', (_n, make, state) => {
    route('fable', 'claude-b'); limits('claude-b', 20); sweep({ 'claude-b': 0.1 });
    make(path.join(REG(), `${ID}.poolset`));
    expect(pick()).toEqual({ pick: '', step: 'none', rc: 1,
      why: h.sh(`_pool_set_undecidable_why ${state} ${ID}`) });
  });

  it.each([
    ['a FIFO', (f: string) => { h.sh(`mkfifo '${f}'`); }],
    ['a word off the vocabulary', (f: string) => { fs.writeFileSync(f, 'Fable!'); }],
  ])('the class as %s refuses: an unreadable class is not "no class"', (_n, make) => {
    route(null, 'claude-b'); limits('claude-b', 20); sweep({ 'claude-b': 0.1 });
    make(path.join(REG(), `${ID}.class`));
    expect(pick()).toEqual({ pick: '', step: 'none', rc: 1,
      why: `the class on ${REG()}/${ID}.class cannot be read; the designation writes it again` });
  });
});

describe('writes nothing, and one verdict under any locale', () => {
  it('the registry is byte- and time-identical after every answer', () => {
    const cases: Array<() => void> = [
      () => { route('fable', 'claude-b'); limits('claude-b', 20); sweep({ 'claude-b': 0.1 }); },
      () => { route('fable', 'claude-b'); sweep({ 'claude-b': 0.9 }); },
      () => { route('fable', 'claude-b,claude-a,claude-a'); },
      () => { route('fable', 'claude-b'); h.sh(`_reg_set ${ID} degraded opus; touch -d @${now() + 3600} "$REG/${ID}.degraded"`); },
    ];
    for (const seed of cases) {
      seed();
      const before = snapshot();
      pick();
      expect(snapshot()).toEqual(before);
    }
  });

  it('the same bytes give the same verdict under LC_ALL=C and en_US.UTF-8', () => {
    route('fable', 'claude-a,claude-b,claude-d');
    limits('claude-a', 75); limits('claude-b', 20); limits('claude-d', 30); sweep({ 'claude-a': 0.1, 'claude-b': 0.9, 'claude-d': 0.1 });
    const c = pick('claude-a', 'export LC_ALL=C;');
    expect(pick('claude-a', 'export LC_ALL=en_US.UTF-8;')).toEqual(c);
    expect(c).toMatchObject({ pick: 'claude-d', step: '1' });
    fs.writeFileSync(path.join(REG(), `${ID}.acctorder`), Buffer.from([...Buffer.from('claude-b,cl'), 0xc3, 0xa9]));
    const r = pick('claude-a', 'export LC_ALL=C;');
    expect(r).toMatchObject({ rc: 1, why: listWhy() });
    expect(pick('claude-a', 'export LC_ALL=en_US.UTF-8;')).toEqual(r);
  });
});
