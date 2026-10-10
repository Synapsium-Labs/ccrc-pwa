// The temp-root collector's IDLE WALK, its FLOOR and its TOKEN (child
// reclamation wave 7, spec §5.10).
//
// The walk is GNU `find -P <leaf> -xdev` under LC_ALL=C: the newest CTIME, in
// ns, over every entry, the leaf included, and the entry count. mtime is never
// read — a user can set it into the future, and every change that moves it
// stamps ctime anyway. A timeout, an unreadable entry, the entry cap, or any
// other failure is UNMEASURED, said in its own word. The floor is
// max(24 h, WS_COLLECT_IDLE_FLOOR_S): the knob only raises it, and a set knob
// that is not a whole number is unmeasured, never folded to 24 h. The one
// test-only seam that lowers it is redefining `_ws_collect_floor_s` in the
// sourced harness (ruling G4), pinned below; the other cases name the instant
// instead, through the collector's clock seam `_ws_collect_now_ns`, as
// `_ws_expire_now` is named.
//
// The token is `_ws_reclaim_fingerprint`'s encoding over `mode=collect`, the id,
// the witness's dev, ino, btime, run and at, the newest ctime and the count. An
// unmeasured input mints nothing.
//
// FIXTURE HOMES ONLY (`makePrHarness`); the `find` shim is a script on PATH
// inside the HOME.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { CCD } from './ccdWsHelpers.js';
import { makePrHarness, type PrHarness } from './ccdPrHelpers.js';
import { inheritedEnv } from './gitEnvStrip.js';
import { AGED, collectAudit, collectOf, makeOrphan } from './collectFixture.js';

let h: PrHarness;
let restore: [string, number][] = [];
beforeEach(() => { h = makePrHarness('ccrc-collect-idle-'); restore = []; });
afterEach(() => {
  for (const [p, m] of restore.reverse()) { try { fs.chmodSync(p, m); } catch { /* gone */ } }
  h.cleanup();
});
const chmodFor = (p: string, mode: number): void => {
  restore.push([p, fs.statSync(p).mode & 0o7777]);
  fs.chmodSync(p, mode);
};

const ID = 'demo-quiet-mesa';
const ROOT_USER = process.getuid?.() === 0;
const LINUX = process.platform === 'linux';
const DAY_NS = 86_400n * 1_000_000_000n;
/** The real GNU find a pass-through shim execs: named absolutely, never resolved through a PATH the shim heads. */
const GNU_FIND = '/usr/bin/find';
const leaf = (id: string = ID): string => path.join(h.home, '.cc-tmp', id);

interface Walk { rc: string; newest: string; count: string; why: string; detail: string; walked: string }
const walk = (p: string, pre = ''): Walk => {
  const [rc = '', newest = '', count = '', why = '', detail = '', walked = ''] = h.sh(`${pre} _ws_collect_idle '${p}'; rc=$?;`
    + ' printf \'%s\\x1f%s\\x1f%s\\x1f%s\\x1f%s\\x1f%s\' "$rc" "$_WS_IDLE_NEWEST_NS" "$_WS_IDLE_COUNT" "$_WS_IDLE_WHY" "$_WS_IDLE_DETAIL" "$_WS_IDLE_LEAF"')
    .split('\x1f');
  return { rc, newest, count, why, detail, walked };
};
/** Node's own answer: every entry under p (p included, links not followed), and the newest ctime in ns. */
const measured = (p: string): { newest: bigint; count: number } => {
  let newest = 0n; let count = 0;
  const visit = (q: string): void => {
    const st = fs.lstatSync(q, { bigint: true });
    count += 1;
    if (st.ctimeNs > newest) newest = st.ctimeNs;
    if (st.isDirectory()) for (const e of fs.readdirSync(q)) visit(path.join(q, e));
  };
  visit(p);
  return { newest, count };
};
const plant = (): void => {
  fs.mkdirSync(path.join(leaf(), 'cdk.out', 'deep'), { recursive: true });
  fs.writeFileSync(path.join(leaf(), 'cdk.out', 'm.json'), '{}');
  fs.writeFileSync(path.join(leaf(), 'cdk.out', 'deep', 'x'), 'x');
};

describe.skipIf(!LINUX)('_ws_collect_idle — the newest CTIME over the whole leaf, in ns, and the entry count', () => {
  it('equals node’s own lstat walk: every entry and the leaf itself, exactly', () => {
    plant();
    const w = walk(leaf());
    expect(w.rc, w.detail).toBe('0');
    const m = measured(leaf());
    expect(w.newest).toBe(String(m.newest));
    expect(w.count).toBe(String(m.count));
    expect(m.count, 'the CONTROL: the leaf, two directories and two files').toBe(5);
    expect(w.walked).toBe(leaf());
  });

  it('an EMPTY leaf is one entry, and its own ctime is the newest — the leaf is included', () => {
    fs.mkdirSync(leaf(), { recursive: true });
    const w = walk(leaf());
    expect(w.rc, w.detail).toBe('0');
    expect(w.count).toBe('1');
    expect(w.newest).toBe(String(fs.lstatSync(leaf(), { bigint: true }).ctimeNs));
  });

  it('a FUTURE mtime holds nothing: the newest is a ctime, and a day past it the floor is reached', () => {
    plant();
    const far = new Date('2100-01-01T00:00:00Z');
    fs.utimesSync(path.join(leaf(), 'cdk.out', 'm.json'), far, far);
    fs.utimesSync(leaf(), far, far);
    const w = walk(leaf());
    expect(w.rc, w.detail).toBe('0');
    expect(BigInt(w.newest), 'not the year-2100 mtime').toBeLessThan(BigInt(Date.now() + 60_000) * 1_000_000n);
    expect(w.newest).toBe(String(measured(leaf()).newest));
    const at = BigInt(w.newest) + DAY_NS;
    expect(h.sh(`_ws_collect_now_ns() { echo ${at}; }; _ws_collect_floor_held ${w.newest}; echo $?`)).toBe('0');
  });

  it('a LINK in the leaf is one entry — its own ctime — and what it points at is never walked', () => {
    fs.mkdirSync(leaf(), { recursive: true });
    const outside = path.join(h.home, 'outside');
    fs.mkdirSync(path.join(outside, 'a', 'b'), { recursive: true });
    fs.symlinkSync(outside, path.join(leaf(), 'link'));
    const w = walk(leaf());
    expect(w.rc, w.detail).toBe('0');
    expect(w.count).toBe('2');
  });

  it.skipIf(ROOT_USER)('an UNREADABLE entry is unmeasured, in its own word — never normalised', () => {
    plant();
    fs.mkdirSync(path.join(leaf(), 'locked'));
    fs.writeFileSync(path.join(leaf(), 'locked', 'x'), 'x');
    chmodFor(path.join(leaf(), 'locked'), 0o000);
    const w = walk(leaf());
    expect(w).toMatchObject({ rc: '2', why: 'unreadable', newest: '', count: '' });
    expect(w.detail).toContain('could not read all of');
    expect((fs.statSync(path.join(leaf(), 'locked')).mode & 0o777).toString(8), 'nothing was made readable').toBe('0');
  });

  it('more entries than the cap is unmeasured, `cap`; exactly the cap is walked', () => {
    plant();
    expect(walk(leaf(), 'WS_COLLECT_IDLE_CAP=5;'), 'the CONTROL: five entries, cap five').toMatchObject({ rc: '0', count: '5' });
    expect(walk(leaf(), 'WS_COLLECT_IDLE_CAP=4;')).toMatchObject({ rc: '2', why: 'cap', newest: '', count: '' });
  });

  it('a walk that outruns its bound is unmeasured, `timeout` — a real find that hangs, killed by the bound', () => {
    plant();
    const realFind = execFileSync('sh', ['-c', 'command -v find'], { encoding: 'utf8', env: inheritedEnv() }).trim();
    const shim = path.join(h.home, 'shim');
    fs.mkdirSync(shim);
    // Only THIS walk hangs (it alone prints change times); every other find is the real one.
    fs.writeFileSync(path.join(shim, 'find'), `#!/bin/sh\ncase " $* " in *" -printf "*) exec sleep 30 ;; esac\nexec '${realFind}' "$@"\n`,
      { mode: 0o755 });
    const t0 = Date.now();
    const w = walk(leaf(), `PATH="${shim}:$PATH"; hash -r; WS_COLLECT_IDLE_SCAN_S=1; CCD_TIMEOUT_KILL_AFTER=2;`);
    expect(Date.now() - t0, 'the bound cut it short (the shim sleeps 30 s)').toBeLessThan(20_000);
    expect(w).toMatchObject({ rc: '2', why: 'timeout', newest: '', count: '' });
  }, 60_000);

  it('a find that fails for another reason, or prints what is not a change time, is `walk-failed`', () => {
    plant();
    const shim = path.join(h.home, 'shim');
    fs.mkdirSync(shim);
    fs.writeFileSync(path.join(shim, 'find'), '#!/bin/sh\necho "find: something else went wrong" >&2\nexit 1\n', { mode: 0o755 });
    expect(walk(leaf(), `PATH="${shim}:$PATH"; hash -r;`)).toMatchObject({ rc: '2', why: 'walk-failed' });
    fs.writeFileSync(path.join(shim, 'find'), '#!/bin/sh\necho "Wed Oct  8 12:00:00 2026"\n', { mode: 0o755 });
    expect(walk(leaf(), `PATH="${shim}:$PATH"; hash -r;`)).toMatchObject({ rc: '2', why: 'walk-failed' });
  });

  it('a leaf that is not a real directory — a link, a file, nothing — is never walked: `walk-failed`', () => {
    fs.mkdirSync(path.join(h.home, 'target'), { recursive: true });
    fs.mkdirSync(path.dirname(leaf()), { recursive: true });
    fs.symlinkSync(path.join(h.home, 'target'), leaf());
    expect(walk(leaf())).toMatchObject({ rc: '2', why: 'walk-failed' });
    fs.unlinkSync(leaf());
    fs.writeFileSync(leaf(), 'x');
    expect(walk(leaf())).toMatchObject({ rc: '2', why: 'walk-failed' });
    expect(walk(path.join(h.home, 'nothing'))).toMatchObject({ rc: '2', why: 'walk-failed' });
  });

  it('a failed walk leaves no earlier walk’s values standing: every field is cleared first', () => {
    plant();
    // The CONTROL: the first walk, in the same shell, measured (the shell exits 9 when it did not).
    const first = `_ws_collect_idle '${leaf()}' && [[ -n "$_WS_IDLE_NEWEST_NS" && -n "$_WS_IDLE_LEAF" ]] || exit 9;`;
    expect(walk(path.join(h.home, 'nothing'), first))
      .toMatchObject({ rc: '2', why: 'walk-failed', newest: '', count: '', walked: '' });
  });

  it('a leaf spelt ending in `/`, `/.` or `/..` is never walked: a link so spelt names its target', () => {
    fs.mkdirSync(path.join(h.home, 'target', 'a', 'b'), { recursive: true });
    fs.mkdirSync(path.dirname(leaf()), { recursive: true });
    fs.symlinkSync(path.join(h.home, 'target'), leaf());
    for (const tail of ['/', '/.', '/..']) {
      const w = walk(`${leaf()}${tail}`);
      expect(w, `the spelling ${tail}`).toMatchObject({ rc: '2', why: 'walk-failed', newest: '', count: '' });
      expect(w.detail).toContain('which names what a link before it points at');
    }
  });

  it('a TMPDIR inside the leaf is counted, never hidden: the walk’s own scratch file makes the leaf busy (fail-closed)', () => {
    plant();
    const before = measured(leaf());
    const w = walk(leaf(), `export TMPDIR='${leaf()}';`);
    expect(w.rc, w.detail).toBe('0');
    expect(w.count, 'the scratch file, made in the leaf before find started, was walked').toBe(String(before.count + 1));
    expect(BigInt(w.newest) > before.newest, 'never an older newest than the real one').toBe(true);
    expect(h.sh(`_ws_collect_now_ns() { echo ${before.newest + DAY_NS}; }; _ws_collect_floor_held ${w.newest}; echo $?`),
      'a day past the tree as it stood before the walk, the walk’s own answer is not yet idle').toBe('1');
  });

  it('a find that writes to stderr and still answers 0 is `walk-failed`: its stderr is never ignored', () => {
    plant();
    expect(fs.existsSync(GNU_FIND), 'the CONTROL: the GNU find the shim execs').toBe(true);
    const shim = path.join(h.home, 'shim');
    fs.mkdirSync(shim);
    fs.writeFileSync(path.join(shim, 'find'), `#!/bin/sh\necho "find: a warning, and no error" >&2\nexec '${GNU_FIND}' "$@"\n`,
      { mode: 0o755 });
    const w = walk(leaf(), `PATH="${shim}:$PATH"; hash -r;`);
    expect(w).toMatchObject({ rc: '2', why: 'walk-failed', newest: '', count: '' });
    expect(w.detail).toContain('find exit 0: find: a warning, and no error');
  });

  it('a scratch file that cannot be made is `walk-failed`, and the detail names the scratch file', () => {
    plant();
    const w = walk(leaf(), `exec 2>/dev/null; export TMPDIR='${path.join(h.home, 'no-such-dir')}';`);
    expect(w).toMatchObject({ rc: '2', why: 'walk-failed', newest: '', count: '' });
    expect(w.detail).toContain('could not make a scratch file to walk');
  });
});

describe('_ws_collect_idle on Darwin', () => {
  it('is unmeasured, `walk-failed`, and walks nothing', () => {
    fs.mkdirSync(leaf(), { recursive: true });
    expect(walk(leaf(), 'CCD_OS=darwin;')).toMatchObject({ rc: '2', why: 'walk-failed', newest: '', count: '' });
  });
});

describe('_ws_collect_floor_s / _ws_collect_floor_held — max(24 h, the knob); the clock is a test seam', () => {
  const NEWEST = 1_791_400_000_000_000_000n;
  const held = (nowNs: bigint | string, env = ''): string =>
    h.sh(`${env} _ws_collect_now_ns() { echo ${nowNs}; }; _ws_collect_floor_held ${NEWEST}; echo $?`);

  it('the floor is 24 h: a day less one ns is not idle, a day is', () => {
    expect(h.sh('_ws_collect_floor_s')).toBe('86400');
    expect(held(NEWEST + DAY_NS - 1n)).toBe('1');
    expect(held(NEWEST + DAY_NS)).toBe('0');
  });

  it('the floor is read through `_ws_collect_floor_s`, the ONE test-only seam that lowers it (ruling G4)', () => {
    const FLOOR0 = '_ws_collect_floor_s() { echo 0; };';
    expect(held(NEWEST, FLOOR0), 'redefined to 0: the newest instant itself is idle').toBe('0');
    expect(held(NEWEST - 1n, FLOOR0), 'a clock behind the newest change is still not idle').toBe('1');
  });

  it('the knob RAISES it; unset, empty or a whole number at or below 24 h leaves it at 24 h; ten or more significant digits clamp', () => {
    expect(h.sh('WS_COLLECT_IDLE_FLOOR_S=90000; _ws_collect_floor_s')).toBe('90000');
    expect(held(NEWEST + DAY_NS, 'WS_COLLECT_IDLE_FLOOR_S=90000;')).toBe('1');
    expect(held(NEWEST + 90_000n * 1_000_000_000n, 'WS_COLLECT_IDLE_FLOOR_S=90000;')).toBe('0');
    expect(h.sh('unset WS_COLLECT_IDLE_FLOOR_S; _ws_collect_floor_s'), 'unset').toBe('86400');
    for (const v of ['3600', '0', '', '86400']) {
      expect(h.sh(`WS_COLLECT_IDLE_FLOOR_S='${v}'; _ws_collect_floor_s`), `knob ${JSON.stringify(v)}`).toBe('86400');
    }
    expect(held(NEWEST + DAY_NS - 1n, 'WS_COLLECT_IDLE_FLOOR_S=3600;'), 'a lower knob never lowers it').toBe('1');
    // Ten or more significant digits: the raise is honoured, clamped so the arithmetic never wraps.
    const MAX_NS = 999_999_999n * 1_000_000_000n;
    expect(h.sh('WS_COLLECT_IDLE_FLOOR_S=9999999999; _ws_collect_floor_s')).toBe('999999999');
    expect(held(NEWEST + MAX_NS - 1n, 'WS_COLLECT_IDLE_FLOOR_S=9999999999;')).toBe('1');
    expect(held(NEWEST + MAX_NS, 'WS_COLLECT_IDLE_FLOOR_S=9999999999;')).toBe('0');
  });

  // Leading zeros are stripped BEFORE the length clamp, and the clamp is asked BEFORE any arithmetic reads the value
  // (ruling G4): ten zero-padded digits are 1, never the clamp; a twenty-digit knob past 2^64 clamps, never wraps.
  const PADDED: [string, string][] = [
    ['0000000001', '86400'], ['000000000000172800', '172800'], ['18446744073709551617', '999999999'],
    ['0000000000', '86400'], ['00000000000999999999', '999999999'], ['0000000000999999998', '999999998'],
  ];
  it.each(PADDED)('the knob %j: its significant digits are read, clamped by their count before their value — %s', (k, want) => {
    const [rc = '', out = '', why = ''] = h.sh(`WS_COLLECT_IDLE_FLOOR_S='${k}'; out=$(_ws_collect_floor_s); rc=$?;`
      + ` _ws_collect_floor_s >/dev/null; printf '%s\\x1f%s\\x1f%s' "$rc" "$out" "$_WS_FLOOR_WHY"`).split('\x1f');
    expect({ rc, out, why }).toEqual({ rc: '0', out: want, why: '' });
  });

  it.skipIf(!LINUX).each(PADDED.slice(0, 3))('the audit document prints `floorS` for the knob %j as %s', (k, want) => {
    makeOrphan(h);
    const a = collectAudit(h, { pre: `WS_COLLECT_IDLE_FLOOR_S='${k}'; ${AGED}` });
    expect(collectOf(a)['floorS'], a.stderr).toBe(Number(want));
    expect(collectOf(a)['unmeasured'], a.stderr).toBeNull();
  }, 60_000);

  it('a set knob that is not a whole number is UNMEASURED: nothing printed, rc 2, the knob named, and the floor not held (2)', () => {
    // '90000+1' is an expression, not a whole number: the grammar refuses it before any arithmetic reads it.
    for (const v of ['172800s', '48h', '172800 ', ' 172800', 'x', '-90000', '86400s', '90000+1']) {
      const [rc = '', out = '', why = ''] = h.sh(`WS_COLLECT_IDLE_FLOOR_S='${v}'; out=$(_ws_collect_floor_s); rc=$?;`
        + ` _ws_collect_floor_s >/dev/null; printf '%s\\x1f%s\\x1f%s' "$rc" "$out" "$_WS_FLOOR_WHY"`).split('\x1f');
      expect({ rc, out }, `knob ${JSON.stringify(v)}`).toEqual({ rc: '2', out: '' });
      expect(why, `knob ${JSON.stringify(v)}`).toContain('WS_COLLECT_IDLE_FLOOR_S');
      expect(held(NEWEST + 1000n * DAY_NS, `WS_COLLECT_IDLE_FLOOR_S='${v}';`), `knob ${JSON.stringify(v)}`).toBe('2');
    }
  });

  it('a floor that does not print a whole number is unmeasured: 2, never a floor of 0 (the G4 seam)', () => {
    expect(held(NEWEST + 1n, '_ws_collect_floor_s() { echo; };'), 'an empty print').toBe('2');
    expect(held(NEWEST + 1n, '_ws_collect_floor_s() { echo 1d; };'), 'not a number').toBe('2');
    expect(held(NEWEST + 1n, '_ws_collect_floor_s() { echo 0; return 2; };'), 'a print beside rc 2').toBe('2');
    expect(held(NEWEST + 1n, '_ws_collect_floor_s() { echo 0; };'), 'the CONTROL: a floor of 0, printed, is held').toBe('0');
  });

  it('a newest change AHEAD of the clock (a clock stepped back) is not idle: 1', () => {
    expect(held(NEWEST - 1n)).toBe('1');
  });

  it('a clock or an input that cannot be read is unmeasured: 2', () => {
    expect(held('soon')).toBe('2');
    expect(h.sh('_ws_collect_floor_held x; echo $?')).toBe('2');
  });
});

describe('_ws_collect_token — named inputs, mode=collect first; an unmeasured input mints nothing', () => {
  const W = { dev: '2064', ino: '35429071', btime: '1791468463', run: '7', at: '1791470480213' };
  const IDLE = { newest: '1791468465283232695', count: '76915' };
  const SET = (w: Record<string, string> = W, idle: Record<string, string> = IDLE, walked = `/h/.cc-tmp/${ID}`): string =>
    `_WS_WIT_DEV='${w.dev}' _WS_WIT_INO='${w.ino}' _WS_WIT_BTIME='${w.btime}' _WS_WIT_RUN='${w.run}' _WS_WIT_AT='${w.at}';`
    + ` _WS_IDLE_NEWEST_NS='${idle.newest}' _WS_IDLE_COUNT='${idle.count}' _WS_IDLE_LEAF='${walked}';`;
  const token = (pre: string, id: string = ID): { rc: string; out: string } => {
    const [rc = '', out = ''] = h.sh(`${pre} out=$(_ws_collect_token '${id}'); rc=$?; printf '%s\\x1f%s' "$rc" "$out"`).split('\x1f');
    return { rc, out };
  };

  it('is the sha256 of exactly these named lines, in this order', () => {
    const lines = [`mode=collect`, `id=${ID}`, `dev=${W.dev}`, `ino=${W.ino}`, `btime=${W.btime}`, `run=${W.run}`,
      `at=${W.at}`, `newestCtimeNs=${IDLE.newest}`, `entries=${IDLE.count}`];
    const want = createHash('sha256').update(`${lines.join('\n')}\n`).digest('hex');
    expect(token(SET())).toEqual({ rc: '0', out: want });
  });

  it('every input moves it: the id, each witness field, the newest ctime and the count', () => {
    const base = token(SET()).out;
    const variants = [
      token(SET(W, IDLE, '/h/.cc-tmp/demo-quiet-reef'), 'demo-quiet-reef').out,
      token(SET({ ...W, dev: '2065' })).out,
      token(SET({ ...W, ino: '35429072' })).out,
      token(SET({ ...W, btime: '1791468464' })).out,
      token(SET({ ...W, at: '1791470480214' })).out,
      token(SET({ ...W, run: '8' })).out,
      token(SET(W, { ...IDLE, newest: `${IDLE.newest.slice(0, -1)}6` })).out,
      token(SET(W, { ...IDLE, count: '76916' })).out,
    ];
    for (const v of variants) expect(v).toMatch(/^[0-9a-f]{64}$/);
    expect(new Set([base, ...variants]).size, 'nine inputs, nine tokens').toBe(9);
  });

  it('no witness read: rc 2, nothing printed', () => {
    expect(token(`_WS_IDLE_NEWEST_NS=1 _WS_IDLE_COUNT=1 _WS_IDLE_LEAF=/h/.cc-tmp/${ID};`)).toEqual({ rc: '2', out: '' });
  });

  it.each([
    ['a witness with no birth time', '_WS_WIT_BTIME=-;'],
    ['a witness run outside the grammar', '_WS_WIT_RUN=07;'],
    ['no walk made', "_WS_IDLE_NEWEST_NS='' _WS_IDLE_COUNT='';"],
    ['a walk of ANOTHER leaf', "_WS_IDLE_LEAF=/h/.cc-tmp/demo-quiet-reef;"],
    ['a walk of a NESTED id’s leaf', `_WS_IDLE_LEAF=/h/.cc-tmp/${ID}.v2-x;`],
    ['a count of 0', '_WS_IDLE_COUNT=0;'],
    ['a witness with no device', "_WS_WIT_DEV='';"],
    ['a witness with no inode', "_WS_WIT_INO='';"],
    ['a witness `at` that is not epoch ms', '_WS_WIT_AT=1791470480;'],
    ['a walk with no newest ctime', "_WS_IDLE_NEWEST_NS='';"],
  ])('%s: rc 2, nothing printed', (_label, tweak) => {
    expect(token(`${SET()} ${tweak}`)).toEqual({ rc: '2', out: '' });
  });

  it('an id no witness is named for: rc 2', () => {
    expect(token(SET(W, IDLE, '/h/.cc-tmp/.x'), '.x')).toEqual({ rc: '2', out: '' });
  });

  it.skipIf(!LINUX)('CONTROL: the REAL witness and the REAL walk mint one, and any change under the leaf mints another', () => {
    fs.mkdirSync(path.join(leaf(), 'x'), { recursive: true });
    const real = `_ws_tmproot_witness_write ${ID} '${leaf()}' 7 && _ws_tmproot_witness_read ${ID} && _ws_collect_idle '${leaf()}';`;
    const a = token(real);
    expect(a.rc).toBe('0');
    expect(token(real).out, 'unchanged: the same token').toBe(a.out);
    fs.writeFileSync(path.join(leaf(), 'x', 'new'), 'n');
    const b = token(real);
    expect(b.rc).toBe('0');
    expect(b.out).not.toBe(a.out);
  });
});

describe('the walk’s bound fits ws-audit’s runner row (departure idle-walk-bound-30s)', () => {
  it('WS_COLLECT_IDLE_SCAN_S is 30: with the in-use probe and the checkout scan, 70 s before the row pass, inside the row', () => {
    const [idle = '', probe = '', scan = ''] = h.sh('printf "%s:%s:%s" "${WS_COLLECT_IDLE_SCAN_S-}" "${WS_PATH_USERS_SCAN_S-}" "${REAP_SCAN_SECONDS-}"').split(':');
    expect(idle, 'the idle walk’s bound').toBe('30');
    expect([probe, scan], 'the CONTROL: the two bounds the fresh audit spends beside it').toEqual(['10', '30']);
    const runner = fs.readFileSync(path.join(path.dirname(CCD), '..', 'server', 'src', 'remote', 'runner.ts'), 'utf8');
    const row = /^\s*'ws-audit': ([0-9_]+),$/m.exec(runner);
    expect(row, 'the CONTROL: ws-audit’s runner row was read').not.toBeNull();
    expect((Number(idle) + Number(probe) + Number(scan)) * 1000, 'the bounds the fresh audit spends in sequence, in ms')
      .toBeLessThan(Number(row![1]!.replace(/_/g, '')));
  });
});
