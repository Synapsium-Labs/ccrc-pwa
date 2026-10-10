// The temp-root collector's QUARANTINE and its RENAME (child reclamation
// wave 7, spec §5.10). The quarantine is `<physical ~/.cc-tmp>/.ccd-quarantine`:
// a real directory of this uid at 0700, made when absent, refused as anything
// else. A slot is `slot.<id>.<ns>.<pid>`, made by an exclusive mkdir and never
// reused. The leaf moves by ONE renameat2(RENAME_NOREPLACE) — `mv -T -n
// --no-copy`, `_ws_collect_mv` — and the move is PROVEN by an lstat of where it
// went and of where it was, never by mv's exit code. A box whose mv has no
// `--no-copy`, and Darwin, never rename. A cross-device rename cannot be made
// without privileges, so its answer is a `mv` shim (a shell function).
//
// FIXTURE HOMES ONLY (`makePrHarness`): every root, quarantine and leaf is under
// the harness's HOME, and `~/.cc-tmp` is the fixture's own.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { makePrHarness, type PrHarness } from './ccdPrHelpers.js';

let h: PrHarness;
let restore: [string, number][] = [];
beforeEach(() => { h = makePrHarness('ccrc-collect-quarantine-'); restore = []; });
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
const root = (): string => path.join(h.home, '.cc-tmp');
const leaf = (): string => path.join(root(), ID);

/** rc and the named globals, `\x1f`-separated, from one snippet. */
const ask = (snippet: string, ...globals: string[]): string[] =>
  h.sh(`${snippet}; rc=$?; printf '%s' "$rc"; for g in ${globals.join(' ')}; do printf '\\x1f%s' "\${!g-}"; done`).split('\x1f');
/** What node sees of a directory: dev:ino and whole-second birth time, as ccd's identity reads it. */
const ident = (p: string): { di: string; bt: string } => {
  const st = fs.lstatSync(p, { bigint: true });
  return { di: `${st.dev}:${st.ino}`, bt: String(st.birthtimeNs / 1_000_000_000n) };
};

describe('_ws_collect_qdir: the quarantine is a real directory of this uid at 0700, on the leaf’s own file system', () => {
  it('absent: made 0700 under the PHYSICAL ~/.cc-tmp — a root that is a link is followed to its volume', () => {
    const vol = path.join(h.home, 'vol');
    fs.mkdirSync(vol);
    fs.symlinkSync(vol, root());
    const [rc, q, why] = ask('_ws_collect_qdir', '_WS_Q', '_WS_Q_WHY');
    expect(rc, why).toBe('0');
    expect(q).toBe(path.join(fs.realpathSync(vol), '.ccd-quarantine'));
    expect(fs.lstatSync(q!).isDirectory()).toBe(true);
    expect((fs.statSync(q!).mode & 0o777).toString(8)).toBe('700');
  });

  it('one that stands, 0700 and ours, is used as it is', () => {
    const q = path.join(root(), '.ccd-quarantine');
    fs.mkdirSync(q, { recursive: true, mode: 0o700 });
    fs.chmodSync(q, 0o700);
    const ino = fs.statSync(q).ino;
    const [rc, got] = ask('_ws_collect_qdir', '_WS_Q');
    expect(rc).toBe('0');
    expect(got).toBe(path.join(fs.realpathSync(root()), '.ccd-quarantine'));
    expect(fs.statSync(q).ino).toBe(ino);
  });

  it.each([
    ['a LINK to a directory', (q: string): void => { fs.mkdirSync(`${q}.real`, { mode: 0o700 }); fs.symlinkSync(`${q}.real`, q); }, 'not a real directory'],
    ['a FILE', (q: string): void => { fs.writeFileSync(q, 'x'); }, 'not a real directory'],
    ['mode 0755', (q: string): void => { fs.mkdirSync(q); fs.chmodSync(q, 0o755); }, 'is mode 755, not 0700'],
  ])('%s at the quarantine’s name is unmeasured: 2, and nothing is made', (_label, plant, why) => {
    fs.mkdirSync(root(), { recursive: true });
    const q = path.join(root(), '.ccd-quarantine');
    plant(q);
    const [rc, got, w] = ask('_ws_collect_qdir', '_WS_Q', '_WS_Q_WHY');
    expect(rc).toBe('2');
    expect(got).toBe('');
    expect(w).toContain(why);
  });

  it('another uid’s quarantine is unmeasured: 2', () => {
    fs.mkdirSync(path.join(root(), '.ccd-quarantine'), { recursive: true, mode: 0o700 });
    const [rc, , w] = ask('_ws_leaf_uid() { echo 999999; }; _ws_collect_qdir', '_WS_Q', '_WS_Q_WHY');
    expect(rc).toBe('2');
    expect(w).toContain('belongs to uid 999999');
  });

  it('no ~/.cc-tmp at all is unmeasured: 2, and nothing is made', () => {
    const [rc] = ask('_ws_collect_qdir', '_WS_Q');
    expect(rc).toBe('2');
    expect(fs.existsSync(root())).toBe(false);
  });

  it('an absence that could not be measured is unmeasured: 2, and the quarantine is made only when PROVEN absent', () => {
    fs.mkdirSync(root(), { recursive: true });
    const q = path.join(root(), '.ccd-quarantine');
    const [rc, got, w] = ask('_ws_reclaim_absent() { _WS_ABSENT_WHY=stub; return 2; }; _ws_collect_qdir', '_WS_Q', '_WS_Q_WHY');
    expect(rc, w).toBe('2');
    expect(got).toBe('');
    expect(w).toContain('never asked');
    expect(fs.existsSync(q), 'the quarantine was made on an unmeasured answer').toBe(false);
  });
});

// THE QUESTION, READ-ONLY (spec §5.10, departure audit-asks-the-quarantine-question): `ws-audit --collect` asks it of
// the quarantine and makes nothing, so a quarantine the verb would refuse is refused at the audit too, and no pass
// licenses a move the verb cannot make. Every shape below is asserted to stand afterwards as it was planted.
describe('_ws_collect_qcheck: the quarantine question, READ-ONLY — PROVEN absent, or a real 0700 directory of this uid', () => {
  const q = (): string => path.join(root(), '.ccd-quarantine');
  const lsnap = (p: string): string => {
    try { const s = fs.lstatSync(p, { bigint: true }); return `${s.ino}:${(s.mode & 0o7777n).toString(8)}:${s.isSymbolicLink()}`; } catch { return 'absent'; }
  };

  it('PROVEN absent: 0 with `absent` and the PHYSICAL path — and nothing is made', () => {
    const vol = path.join(h.home, 'vol');
    fs.mkdirSync(vol);
    fs.symlinkSync(vol, root());
    const [rc, state, qp, why] = ask('_ws_collect_qcheck', '_WS_QSTATE', '_WS_QPATH', '_WS_Q_WHY');
    expect(rc, why).toBe('0');
    expect(state).toBe('absent');
    expect(qp).toBe(path.join(fs.realpathSync(vol), '.ccd-quarantine'));
    expect(fs.existsSync(qp!), 'the check made the quarantine').toBe(false);
  });

  it('a real directory of this uid at 0700: 0 with `ok`, untouched', () => {
    fs.mkdirSync(q(), { recursive: true, mode: 0o700 });
    fs.chmodSync(q(), 0o700);
    const before = lsnap(q());
    const [rc, state, why] = ask('_ws_collect_qcheck', '_WS_QSTATE', '_WS_Q_WHY');
    expect(rc, why).toBe('0');
    expect(state).toBe('ok');
    expect(lsnap(q())).toBe(before);
  });

  it.each([
    ['a LINK to a 0700 directory', (p: string): void => { fs.mkdirSync(`${p}.real`, { mode: 0o700 }); fs.symlinkSync(`${p}.real`, p); }, 'is not a real directory'],
    ['a FILE', (p: string): void => { fs.writeFileSync(p, 'x', { mode: 0o600 }); }, 'is not a real directory'],
    ['a directory at mode 0755', (p: string): void => { fs.mkdirSync(p); fs.chmodSync(p, 0o755); }, 'is mode 755, not 0700'],
    ['a directory at mode 2700 (setgid): the operator’s to fix, never chmod-ed', (p: string): void => {
      fs.mkdirSync(p); fs.chmodSync(p, 0o2700);
      expect(fs.statSync(p).mode & 0o7777, 'the CONTROL: the setgid bit took').toBe(0o2700);
    }, 'is mode 2700, not 0700'],
  ])('%s: 2 with its why — and it stands as it was planted', (_label, plant, why) => {
    fs.mkdirSync(root(), { recursive: true });
    plant(q());
    const before = lsnap(q());
    const [rc, state, w] = ask('_ws_collect_qcheck', '_WS_QSTATE', '_WS_Q_WHY');
    expect(rc).toBe('2');
    expect(state).toBe('');
    expect(w).toContain(why);
    expect(lsnap(q()), 'the check changed what it asked of').toBe(before);
  });

  it('another uid’s directory: 2, naming both uids', () => {
    fs.mkdirSync(q(), { recursive: true, mode: 0o700 });
    const [rc, , w] = ask('_ws_leaf_uid() { echo 999999; }; _ws_collect_qcheck', '_WS_QSTATE', '_WS_Q_WHY');
    expect(rc).toBe('2');
    expect(w).toContain('belongs to uid 999999');
  });

  it('an absence it cannot prove: 2, and nothing is made', () => {
    fs.mkdirSync(root(), { recursive: true });
    const [rc, state, w] = ask('_ws_reclaim_absent() { _WS_ABSENT_WHY=stub; return 2; }; _ws_collect_qcheck', '_WS_QSTATE', '_WS_Q_WHY');
    expect(rc).toBe('2');
    expect(state).toBe('');
    expect(w).toContain('stub — whether the quarantine stands was never asked');
    expect(fs.existsSync(q())).toBe(false);
  });

  it('no ~/.cc-tmp at all: 2 — the quarantine’s path cannot be resolved, and nothing is made', () => {
    const [rc, , w] = ask('_ws_collect_qcheck', '_WS_QSTATE', '_WS_Q_WHY');
    expect(rc).toBe('2');
    expect(w).toContain('cannot be resolved');
    expect(fs.existsSync(root())).toBe(false);
  });
});

// THE MAKER is the verb's alone: the check, a plain `mkdir -m 0700` (never `-p`) when the check PROVED it absent, then
// `chmod g-s` on what THIS call made (departure quarantine-made-without-setgid: under a setgid `~/.cc-tmp` the kernel
// hands a new directory the setgid bit, 2700), then the check again, which must answer `ok`.
describe('_ws_collect_qdir, the MAKER: the check, the mkdir, `chmod g-s` on what it made, the check again', () => {
  const q = (): string => path.join(root(), '.ccd-quarantine');
  /** Every chmod the maker runs, logged to `$HOME/chmod-calls`, then run. */
  const CHMOD_LOG = 'chmod() { printf \'%s\\n\' "$*" >> "$HOME/chmod-calls"; command chmod "$@"; };';
  const chmodCalls = (): string[] => {
    const p = path.join(h.home, 'chmod-calls');
    return fs.existsSync(p) ? fs.readFileSync(p, 'utf8').split('\n').filter(Boolean) : [];
  };
  /** The check's absence proof answers "absent" ONCE, and `make` runs first: another maker, between the check and
   *  this call's mkdir. Every later ask is the real proof. */
  const raceMaker = (make: string): string => 'eval "_orig_absent() $(declare -f _ws_reclaim_absent | tail -n +2)";'
    + ' _ws_reclaim_absent() { if [[ "$1" == */.ccd-quarantine && ! -e "$HOME/raced" ]]; then : > "$HOME/raced";'
    + ` ${make}; return 0; fi; _orig_absent "$@"; };`;

  it('on a setgid ~/.cc-tmp the quarantine it makes is 0700 — the CONTROL: a bare `mkdir -m 0700` there is 2700', () => {
    fs.mkdirSync(root(), { mode: 0o755 });
    fs.chmodSync(root(), 0o2755);
    expect(fs.statSync(root()).mode & 0o7777, 'the CONTROL: ~/.cc-tmp is setgid').toBe(0o2755);
    const probe = path.join(root(), 'probe');
    h.sh(`mkdir -m 0700 -- '${probe}'`);
    expect(fs.statSync(probe).mode & 0o7777, 'the CONTROL: a plain mkdir inherits the setgid bit').toBe(0o2700);
    const [rc, got, why] = ask(`${CHMOD_LOG} _ws_collect_qdir`, '_WS_Q', '_WS_Q_WHY');
    expect(rc, why).toBe('0');
    expect(got).toBe(path.join(fs.realpathSync(root()), '.ccd-quarantine'));
    expect(fs.statSync(got!).mode & 0o7777).toBe(0o700);
    expect(chmodCalls()).toEqual([`g-s -- ${got}`]);
  });

  it('a quarantine already standing at 2700 is never chmod-ed: 2, and it stays 2700 — the operator’s to fix', () => {
    fs.mkdirSync(q(), { recursive: true });
    fs.chmodSync(q(), 0o2700);
    expect(fs.statSync(q()).mode & 0o7777, 'the CONTROL').toBe(0o2700);
    const [rc, got, why] = ask(`${CHMOD_LOG} _ws_collect_qdir`, '_WS_Q', '_WS_Q_WHY');
    expect(rc).toBe('2');
    expect(got).toBe('');
    expect(why).toContain('is mode 2700, not 0700');
    expect(fs.statSync(q()).mode & 0o7777).toBe(0o2700);
    expect(chmodCalls()).toEqual([]);
  });

  it('the check is asked again after the mkdir: a mkdir that left another mode answers 2', () => {
    fs.mkdirSync(root(), { recursive: true });
    const [rc, got, why] = ask('mkdir() { command mkdir "$@" && command chmod 0755 -- "${@: -1}"; }; _ws_collect_qdir', '_WS_Q', '_WS_Q_WHY');
    expect(rc).toBe('2');
    expect(got).toBe('');
    expect(why).toContain('is mode 755, not 0700');
  });

  it('a `chmod g-s` that fails on what it made: 2, naming it', () => {
    fs.mkdirSync(root(), { recursive: true });
    const [rc, got, why] = ask('chmod() { return 1; }; _ws_collect_qdir', '_WS_Q', '_WS_Q_WHY');
    expect(rc).toBe('2');
    expect(got).toBe('');
    expect(why).toContain('its setgid bit could not be cleared');
  });

  it('a mkdir that loses to another maker falls to the check again: 0 over a 0700 quarantine, which it never chmods', () => {
    fs.mkdirSync(root(), { recursive: true });
    const [rc, got, why] = ask(`${CHMOD_LOG} ${raceMaker(`command mkdir -m 0700 -- '${q()}'`)} _ws_collect_qdir`, '_WS_Q', '_WS_Q_WHY');
    expect(fs.existsSync(path.join(h.home, 'raced')), 'the CONTROL: the race ran').toBe(true);
    expect(rc, why).toBe('0');
    expect(got).toBe(path.join(fs.realpathSync(root()), '.ccd-quarantine'));
    expect(chmodCalls(), 'a quarantine this call did not make is never chmod-ed').toEqual([]);
  });

  it('… and 2 over one the other maker left at 2700, which it never chmods', () => {
    fs.mkdirSync(root(), { recursive: true });
    const make = `command mkdir -m 0700 -- '${q()}' && command chmod 2700 -- '${q()}'`;
    const [rc, got, why] = ask(`${CHMOD_LOG} ${raceMaker(make)} _ws_collect_qdir`, '_WS_Q', '_WS_Q_WHY');
    expect(fs.existsSync(path.join(h.home, 'raced')), 'the CONTROL: the race ran').toBe(true);
    expect(rc).toBe('2');
    expect(got).toBe('');
    expect(why).toContain('is mode 2700, not 0700');
    expect(fs.statSync(q()).mode & 0o7777).toBe(0o2700);
    expect(chmodCalls()).toEqual([]);
  });
});

describe('_ws_collect_slot_path / _ws_collect_slot_make: `slot.<id>.<ns>.<pid>`, exclusive, never reused', () => {
  it('the path is `<q>/slot.<id>.<ns>.<pid>`, the ns from the collector’s clock', () => {
    const [rc, s] = ask(`_ws_collect_now_ns() { echo 1791470480213200844; }; _ws_collect_slot_path /q ${ID}`, '_WS_SLOT');
    expect(rc).toBe('0');
    expect(s).toMatch(new RegExp(`^/q/slot\\.${ID.replace(/-/g, '\\-')}\\.1791470480213200844\\.[0-9]+$`));
  });

  it.each([['.hidden'], ['a/b'], ['']])('an id no witness is named for (%j) makes no path: 2', (id) => {
    expect(ask(`_ws_collect_slot_path /q '${id}'`, '_WS_SLOT')).toEqual(['2', '']);
  });

  it('a clock that does not answer makes no path: 2', () => {
    expect(ask(`_ws_collect_now_ns() { echo soon; }; _ws_collect_slot_path /q ${ID}`, '_WS_SLOT')).toEqual(['2', '']);
  });

  it('make: a real directory at 0700, made by this call', () => {
    const s = path.join(h.home, 'q', `slot.${ID}.1.2`);
    fs.mkdirSync(path.dirname(s));
    const [rc, why] = ask(`_ws_collect_slot_make '${s}'`, '_WS_SLOT_WHY');
    expect(rc, why).toBe('0');
    expect(fs.lstatSync(s).isDirectory()).toBe(true);
    expect((fs.statSync(s).mode & 0o777).toString(8)).toBe('700');
  });

  it.each([
    ['an empty directory', (s: string): void => { fs.mkdirSync(s); }],
    ['a directory holding a leaf', (s: string): void => { fs.mkdirSync(path.join(s, 'leaf'), { recursive: true }); }],
    ['a file', (s: string): void => { fs.writeFileSync(s, 'x'); }],
    ['a dangling link', (s: string): void => { fs.symlinkSync('/nowhere', s); }],
  ])('a name that already stands (%s) is never reused: 1, and it is untouched', (_label, plant) => {
    const s = path.join(h.home, 'q', `slot.${ID}.1.2`);
    fs.mkdirSync(path.dirname(s));
    plant(s);
    const before = fs.lstatSync(s).ino;
    const [rc, why] = ask(`_ws_collect_slot_make '${s}'`, '_WS_SLOT_WHY');
    expect(rc).toBe('1');
    expect(why).toContain('never reused');
    expect(fs.lstatSync(s).ino).toBe(before);
  });

  it('the exclusive mkdir itself refuses a name that appears after the absence check: 1', () => {
    const s = path.join(h.home, 'q', `slot.${ID}.1.2`);
    fs.mkdirSync(path.dirname(s));
    // The absence proof answers "absent", and a racer makes the name before the mkdir.
    const [rc] = ask(`_ws_reclaim_absent() { mkdir -p '${s}'; return 0; }; _ws_collect_slot_make '${s}'`, '_WS_SLOT_WHY');
    expect(rc).toBe('1');
  });

  it('a parent that does not exist: 2', () => {
    const [rc] = ask(`_ws_collect_slot_make '${path.join(h.home, 'nowhere', 'slot.x.1.2')}'`, '_WS_SLOT_WHY');
    expect(rc).toBe('2');
  });

  it('an absence that could not be measured, over a writable parent, is unmeasured: 2, and no slot is made', () => {
    const s = path.join(h.home, 'q', `slot.${ID}.1.2`);
    fs.mkdirSync(path.dirname(s));
    const [rc, why] = ask(`_ws_reclaim_absent() { _WS_ABSENT_WHY=stub; return 2; }; _ws_collect_slot_make '${s}'`, '_WS_SLOT_WHY');
    expect(rc, why).toBe('2');
    expect(why).toContain('never asked');
    expect(fs.existsSync(s), 'the slot was made on an unmeasured answer').toBe(false);
  });
});

describe('_ws_collect_ident: an lstat — a real directory with this dev:ino and birth time, never followed', () => {
  it('the directory itself: 0; another inode, another birth time, a link to it, a file, nothing: 1', () => {
    fs.mkdirSync(leaf(), { recursive: true });
    const { di, bt } = ident(leaf());
    const q = (p: string, d = di, b = bt): string => h.sh(`_ws_collect_ident '${p}' '${d}' '${b}'; echo $?`);
    expect(q(leaf())).toBe('0');
    expect(q(leaf(), '1:1')).toBe('1');
    expect(q(leaf(), di, String(Number(bt) + 1))).toBe('1');
    const link = path.join(h.home, 'link');
    fs.symlinkSync(leaf(), link);
    expect(q(link), 'a link to the very directory is not it').toBe('1');
    const file = path.join(h.home, 'file');
    fs.writeFileSync(file, 'x');
    expect(q(file)).toBe('1');
    expect(q(path.join(h.home, 'nothing'))).toBe('1');
  });

  it.skipIf(ROOT_USER)('nothing there, under a parent that cannot be searched, is unmeasured: 2', () => {
    const locked = path.join(h.home, 'locked');
    fs.mkdirSync(locked);
    chmodFor(locked, 0o600);
    expect(h.sh(`_ws_collect_ident '${path.join(locked, 'x')}' 1:1 1; echo $?`)).toBe('2');
  });

  // An identity that cannot be READ is unmeasured, never "something else stands":
  // a caller reads 1 as a mismatch, and only 2 as a retry.
  it.each([
    ['its dev:ino read fails', '_plat_devino() { return 1; };'],
    ['its dev:ino read answers no dev:ino', '_plat_devino() { echo 12; };'],
    ['its birth-time read fails', '_plat_btime() { return 1; };'],
    ['its birth-time read answers no number', '_plat_btime() { echo -; };'],
  ])('the directory, when %s, is unmeasured: 2', (_label, seam) => {
    fs.mkdirSync(leaf(), { recursive: true });
    const { di, bt } = ident(leaf());
    expect(h.sh(`${seam} _ws_collect_ident '${leaf()}' '${di}' '${bt}'; echo $?`)).toBe('2');
  });

  // NEVER FOLLOWED, BY MECHANISM: each spelling below lstat()s the link's TARGET,
  // which is the very directory, so without the refusal each answered 0.
  it.each([
    ['`link/`', (l: string): string => `${l}/`, (): string => leaf()],
    ['`link/.`', (l: string): string => `${l}/.`, (): string => leaf()],
    ['`link/..`, the link at a child of the directory', (l: string): string => `${l}/..`, (): string => path.join(leaf(), 'sub')],
  ])('a path spelled %s is refused: 2, never the directory a link names', (_label, spell, target) => {
    fs.mkdirSync(path.join(leaf(), 'sub'), { recursive: true });
    const { di, bt } = ident(leaf());
    const link = path.join(h.home, 'link');
    fs.symlinkSync(target(), link);
    expect(h.sh(`_ws_collect_ident '${spell(link)}' '${di}' '${bt}'; echo $?`)).toBe('2');
  });
});

/** A shim's view of `_ws_collect_mv`'s argv: its last two arguments, whatever flags precede them. */
const LAST2 = 'last2() { s="${@: -2:1}"; d="${@: -1}"; };';

describe('_ws_collect_move: renameat2(RENAME_NOREPLACE), PROVEN by lstat — never by mv’s exit code', () => {
  const dst = (): string => path.join(h.home, 'q', 'slot.x.1.2', 'leaf');
  const setup = (): { di: string; bt: string } => {
    fs.mkdirSync(path.join(leaf(), 'cdk.out'), { recursive: true });
    fs.writeFileSync(path.join(leaf(), 'cdk.out', 'm.json'), '{}');
    fs.mkdirSync(path.dirname(dst()), { recursive: true });
    return ident(leaf());
  };
  const move = (from: string, to: string, di: string, bt: string, pre = ''): string[] =>
    ask(`${pre} _ws_collect_move '${from}' '${to}' '${di}' '${bt}'`, '_WS_MOVE_WHY');

  it.skipIf(!LINUX)('a real move: 0 — the inode and its birth time go with it, and nothing stands where it was', () => {
    const { di, bt } = setup();
    const [rc, why] = move(leaf(), dst(), di, bt);
    expect(rc, why).toBe('0');
    expect(ident(dst())).toEqual({ di, bt });
    expect(fs.existsSync(leaf())).toBe(false);
    expect(fs.readFileSync(path.join(dst(), 'cdk.out', 'm.json'), 'utf8')).toBe('{}');
  });

  it.skipIf(!LINUX)('the move BACK is the same proof: 0, the original path is the directory again and the slot’s leaf is gone', () => {
    const { di, bt } = setup();
    expect(move(leaf(), dst(), di, bt)[0]).toBe('0');
    const [rc, why] = move(dst(), leaf(), di, bt);
    expect(rc, why).toBe('0');
    expect(ident(leaf())).toEqual({ di, bt });
    expect(fs.existsSync(dst())).toBe(false);
  });

  it.skipIf(!LINUX).each([
    ['an empty directory', (p: string): void => { fs.mkdirSync(p); }],
    ['a directory holding a file', (p: string): void => { fs.mkdirSync(p); fs.writeFileSync(path.join(p, 'theirs'), 't'); }],
    ['a file', (p: string): void => { fs.writeFileSync(p, 'theirs'); }],
    ['a dangling link', (p: string): void => { fs.symlinkSync('/nowhere', p); }],
  ])('NOREPLACE: %s at the destination is never replaced — 1, both untouched', (_label, plant) => {
    const { di, bt } = setup();
    plant(dst());
    const before = fs.lstatSync(dst()).ino;
    const [rc, why] = move(leaf(), dst(), di, bt);
    expect(rc, why).toBe('1');
    expect(ident(leaf())).toEqual({ di, bt });
    expect(fs.lstatSync(dst()).ino).toBe(before);
  });

  it.skipIf(!LINUX)('a cross-device rename (EXDEV) — `--no-copy` turns it into a failure — is "not moved": 1, mv’s own words carried', () => {
    const { di, bt } = setup();
    const pre = `_WS_MV_NOCOPY=1; ${LAST2} mv() { last2 "$@"; echo "mv: cannot move '$s' to '$d': Invalid cross-device link" >&2; return 1; };`;
    const [rc, why] = move(leaf(), dst(), di, bt, pre);
    expect(rc).toBe('1');
    expect(why).toContain('Invalid cross-device link');
    expect(ident(leaf())).toEqual({ di, bt });
  });

  it.skipIf(!LINUX)('a `mv` that COPIES and answers 0 is unmeasured: 2 — the new inode is not the directory', () => {
    const { di, bt } = setup();
    const pre = `_WS_MV_NOCOPY=1; ${LAST2} mv() { last2 "$@"; cp -a -- "$s" "$d" && rm -rf -- "$s"; };`;
    const [rc, why] = move(leaf(), dst(), di, bt, pre);
    expect(rc, why).toBe('2');
    expect(why).toContain('neither');
  });

  it.skipIf(!LINUX)('a `mv` that answers 0 and moved nothing is "not moved": 1', () => {
    const { di, bt } = setup();
    const [rc, why] = move(leaf(), dst(), di, bt, '_WS_MV_NOCOPY=1; mv() { return 0; };');
    expect(rc, why).toBe('1');
    expect(why).toContain('mv exit 0');
  });

  it.skipIf(!LINUX)('a move whose source stands AGAIN (re-created in the window) is not proven: 2', () => {
    const { di, bt } = setup();
    const pre = `_WS_MV_NOCOPY=1; ${LAST2} mv() { last2 "$@"; command mv -T -- "$s" "$d" && mkdir '${leaf()}'; };`;
    const [rc, why] = move(leaf(), dst(), di, bt, pre);
    expect(rc, why).toBe('2');
    expect(why).toContain('not proven');
  });

  it.skipIf(!LINUX)('a box whose mv has no `--no-copy` never renames: 2, and nothing moved', () => {
    const { di, bt } = setup();
    const pre = 'mv() { if [[ "$1" == --help ]]; then echo "Usage: mv [OPTION]... SOURCE DEST"; return 0; fi; command mv "$@"; };';
    const [rc, why] = move(leaf(), dst(), di, bt, pre);
    expect(rc).toBe('2');
    expect(why).toContain('no \'mv --no-copy\'');
    expect(ident(leaf())).toEqual({ di, bt });
    expect(fs.existsSync(dst())).toBe(false);
  });

  it.skipIf(!LINUX).each([
    ['another directory’s identity', (): { di: string; bt: string } => {
      const other = path.join(h.home, 'other');
      fs.mkdirSync(other);
      return ident(other);
    }],
    ['an identity that is no dev:ino and birth time', (): { di: string; bt: string } => ({ di: 'garbage', bt: 'x' })],
  ])('identity is asked BEFORE the rename: src not PROVEN %s is refused — 2, mv never run, nothing moved', (_label, want) => {
    const own = setup();
    const { di, bt } = want();
    const rec = '_WS_MV_NOCOPY=1; mv() { echo "$*" >> "$HOME/mv-calls"; command mv "$@"; };';
    const [rc, why] = move(leaf(), dst(), di, bt, rec);
    expect(rc, why).toBe('2');
    expect(why).toContain('nothing was renamed');
    expect(fs.existsSync(path.join(h.home, 'mv-calls')), 'mv was run').toBe(false);
    expect(ident(leaf()), 'the directory at src still stands').toEqual(own);
    expect(fs.existsSync(dst())).toBe(false);
  });

  it('Darwin never renames: 2, mv is never run, and nothing moved', () => {
    const { di, bt } = setup();
    const rec = 'mv() { [[ "$1" == --help ]] || echo "$*" >> "$HOME/mv-calls"; command mv "$@"; };';
    expect(h.sh(`${rec} CCD_OS=darwin; _ws_collect_mv_ok; echo $?`), 'the capability answers no on Darwin').toBe('1');
    const [rc] = move(leaf(), dst(), di, bt, `${rec} CCD_OS=darwin;`);
    expect(rc).toBe('2');
    expect(fs.existsSync(path.join(h.home, 'mv-calls')), 'mv was run').toBe(false);
    expect(ident(leaf())).toEqual({ di, bt });
  });

  it.skipIf(!LINUX)('the capability is asked of `mv --help` once, then remembered', () => {
    const out = h.sh('mv() { if [[ "$1" == --help ]]; then echo asked >> "$HOME/help-calls"; command mv --help; return; fi; command mv "$@"; };'
      + ' _ws_collect_mv_ok; a=$?; _ws_collect_mv_ok; b=$?; echo "$a$b"');
    expect(out).toBe('00');
    expect(fs.readFileSync(path.join(h.home, 'help-calls'), 'utf8')).toBe('asked\n');
  });
});
