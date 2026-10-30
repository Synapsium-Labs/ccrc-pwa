// path-identity W2, TR5 C, the leaf half: NO REMOVAL CROSSES A MOUNT (path-identity spec §3.5, §3.9).
//
// `_ws_leaf_remove` compared st_dev alone, and `rm --one-file-system` measures st_dev too, so a bind mount of the
// leaf's OWN file system inside it was crossed, and the permission pass's `find -xdev … chmod` changed modes in the
// bind's source before any later check could refuse. ONE helper, `_ws_removal_mounts_clear`, now asks the collector's
// mount question (`_ws_collect_mounts_clear`, reused, never copied) and answers 0 (nothing is mounted at the path or
// under it) or 2 (a mount stands there, or the table was not read whole), never 1; with `resolve` it resolves the path
// first. Its first line of code is the ONE Darwin guard. `_ws_leaf_remove` asks it twice: directly after its device
// compare, before the owner bits, the checkout question and the permission pass, and again directly before `rm`. The
// reclaim and expiry tail's step (6) reaches both of its leaves through `_ws_leaf_remove`, and so does the collector's
// step 6, where a mount made after step 5 asked now answers `failed quarantine-kept`.
//
// MOUNTS ARE FAKED, NEVER MADE. The seam `_ws_collect_mountinfo` names a copy of the kernel's own table under the
// fixture HOME (`MOUNTS_SEAM`, `realMounts`), and a case appends a line naming a mount point. No case mounts anything,
// and none walks the real /proc: every verb, audit and evaluation call stubs the in-use probe (`NOBODY`, `PROBE_STUB`).
// Darwin has no table: its pins POISON the seam and prove the clean path never reads it, on both hosts; a Linux host
// forcing `CCD_OS=darwin` shims the two BSD spellings it cannot run (`DARWIN_SHIMS`).
//
// FIXTURE HOME ONLY (`makePrHarness`): every root, leaf, table, registry row and slot derives from `h.home`, and every
// verb runs as a SOURCED function, never through the installed launcher and never against the live HOME. A case that
// narrows a directory's mode restores it in `finally`.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { makePrHarness, type PrHarness } from './ccdPrHelpers.js';
import { ccdSource } from './ccdWsHelpers.js';
import { eventsOf, measOf } from './lifecycleHelpers.js';
import { CHILD_ID, childReclaimVerb, evalOf, makeChild } from './childReclaimFixture.js';
import { NOBODY, NO_COPY } from './collectRaceFixture.js';
import {
  MOUNTS_SEAM, PROBE_STUB, collectToken, collectVerb, docOf, gapAt, gaps, makeOrphan, quarantineOf, realMounts,
  records, slots,
} from './wsCollectFixture.js';

let h: PrHarness;
beforeEach(() => { h = makePrHarness('ccrc-removal-mounts-'); });
afterEach(() => { h.cleanup(); });

const LINUX = process.platform === 'linux';
const DARWIN_HOST = process.platform === 'darwin';
const ROOT_USER = process.getuid?.() === 0;
const ID = 'demo-quiet-basin';

/** A path as the kernel's table writes it: space, tab, newline and backslash as \040, \011, \012 and \134. */
const encoded = (p: string): string =>
  p.replace(/\\/g, '\\134').replace(/ /g, '\\040').replace(/\t/g, '\\011').replace(/\n/g, '\\012');
/** One line of the kernel's table, naming a mount point at `p` (a PHYSICAL path). */
const MOUNT_LINE = (p: string): string => `9999 1 0:99 / ${encoded(p)} rw,relatime - tmpfs tmpfs rw`;
const at = (n: string): string => path.join(h.home, n);
/** The table `MOUNTS_SEAM` names. */
const tableOf = (): string => at('mountinfo');
/** The kernel's own table copied under the fixture HOME, then one line at each of `ps`. */
const fakeTable = (...ps: string[]): void => {
  realMounts(h);
  for (const p of ps) fs.appendFileSync(tableOf(), `${MOUNT_LINE(p)}\n`);
};
/** The seam POISONED: any read of the table leaves `$HOME/mi-called`, and the table it names does not exist. */
const POISON = '_ws_collect_mountinfo() { echo x >> "$HOME/mi-called"; printf "%s" "$HOME/no-such-table"; };';
/** Forced Darwin on a LINUX host (measured: GNU `stat -f '%d:%i'` and GNU `rm -rfx` both fail): the device read takes
 *  GNU's spelling, and `rm -rfx` is logged to `$HOME/rm-calls` and run as `rm -rf`; every other `rm` passes through
 *  unlogged. On a Darwin host the real BSD spellings run, and nothing is shimmed. */
const DARWIN_SHIMS = DARWIN_HOST ? '' : '_plat_devino() { stat -c \'%d:%i\' "$@"; };'
  + ' rm() { if [[ "${1-}" == -rfx ]]; then printf \'%s\\n\' "$*" >> "$HOME/rm-calls"; shift;'
  + ' command rm -rf "$@"; else command rm "$@"; fi; };';
/** `_ws_dir_physical`, wrapped: every directory it is asked to resolve is logged to `$HOME/phys-called`. */
const PHYS_SPY = 'eval "_t_phys_real()$(declare -f _ws_dir_physical | tail -n +2)";'
  + ' _ws_dir_physical() { printf \'%s\\n\' "$1" >> "$HOME/phys-called"; _t_phys_real "$@"; };';
const linesAt = (n: string): string[] =>
  (fs.existsSync(at(n)) ? fs.readFileSync(at(n), 'utf8').split('\n').filter(Boolean) : []);
const modeOf = (p: string): string => (fs.statSync(p).mode & 0o777).toString(8);
/** A fresh directory under the fixture HOME, returned in its PHYSICAL spelling. */
const dirAt = (n: string): string => { fs.mkdirSync(at(n), { recursive: true }); return fs.realpathSync(at(n)); };
/** `_ws_collect_mounts_clear`'s own reason for a mount point `mp` at or under `dir`. */
const MOUNTED = (mp: string, dir: string): string =>
  `something is mounted at ${encoded(mp)}, at or under ${dir} — ccd never removes across a mount`;

/** The helper, asked in the current shell: `[rc=N] <its reason>`. */
const ask = (d: string, opts: { resolve?: boolean; pre?: string } = {}): string =>
  h.run(`${opts.pre ?? ''} _ws_removal_mounts_clear '${d}'${opts.resolve ? ' resolve' : ''};`
    + ' echo "[rc=$?] $_WS_MOUNTS_WHY"').stdout;

const rootOf = (): string => at('root');
const leafOf = (): string => path.join(rootOf(), ID);
/** The leaf as `_ws_leaf_remove` composes it: the root resolved physically, then the id. */
const physLeaf = (): string => path.join(fs.realpathSync(rootOf()), ID);
/** `_ws_leaf_remove "$HOME/root" <ID>`, asked in the current shell: `[rc=N] <its raw, uncut reason>`. */
const removeLeaf = (pre = ''): string =>
  h.run(`${pre} _ws_leaf_remove "$HOME/root" ${ID}; echo "[rc=$?] $_WS_LEAF_WHY"`).stdout;
/** What `_ws_leaf_remove` answers when the mount question answers 2 with `why`. */
const LEAF_KEPT = (why: string, leaf: string): string => `[rc=2] ${why} — nothing under ${leaf} was removed`;

describe.skipIf(!LINUX)('_ws_removal_mounts_clear — the one mount question, 0 or 2 and never 1 (path-identity spec §3.5)', () => {
  it('case 1: a mount AT the directory answers 2', () => {
    const d = dirAt('d');
    fakeTable(d);
    expect(ask(d, { pre: MOUNTS_SEAM })).toBe(`[rc=2] ${MOUNTED(d, d)}`);
  });

  it('case 2: a mount UNDER the directory answers 2', () => {
    const d = dirAt('d');
    fakeTable(`${d}/x`);
    expect(ask(d, { pre: MOUNTS_SEAM })).toBe(`[rc=2] ${MOUNTED(`${d}/x`, d)}`);
  });

  it('case 3: a mount at a SIBLING (`<d>-x`) is not under it: 0', () => {
    const d = dirAt('d');
    fakeTable(`${d}-x`);
    expect(ask(d, { pre: MOUNTS_SEAM })).toBe('[rc=0]');
  });

  it('case 4: a table that cannot be read answers 2', () => {
    const d = dirAt('d');
    const pre = '_ws_collect_mountinfo() { printf \'%s\' "$HOME/no-such"; };';
    expect(ask(d, { pre }))
      .toBe(`[rc=2] ${at('no-such')} could not be read, so whether anything is mounted under ${d} was never asked`);
  });

  it('case 4b: a table that holds a line that is not a mount answers 2', () => {
    const d = dirAt('d');
    fakeTable();
    fs.appendFileSync(tableOf(), 'not a mount line\n');
    expect(ask(d, { pre: MOUNTS_SEAM }))
      .toBe(`[rc=2] ${tableOf()} holds a line that is not a mount, so the table was never read whole`);
  });

  it('case 5: a table that lists no mount answers 2', () => {
    const d = dirAt('d');
    fs.writeFileSync(tableOf(), '');
    expect(ask(d, { pre: MOUNTS_SEAM })).toBe(`[rc=2] ${tableOf()} listed no mount at all, so the table was never read`);
  });

  it('case 6: a `//` spelling is collapsed to `/` and asked — never missed, never refused', () => {
    const d = dirAt('d');
    fakeTable(`${d}/x`);
    // THE CONTROL: the collector's question asked of the `//` spelling directly MISSES the mount (the table never
    // writes `//`), so the collapse is what makes the answer right.
    expect(h.run(`${MOUNTS_SEAM} _ws_collect_mounts_clear '/${d}'; echo "[rc=$?]"`).stdout).toBe('[rc=0]');
    expect(ask(`/${d}`, { pre: MOUNTS_SEAM })).toBe(`[rc=2] ${MOUNTED(`${d}/x`, d)}`);
  });

  it('case 7: `resolve` asks the PHYSICAL path of a directory under a symbolic link; without it the text is asked', () => {
    const d = dirAt('real/d');
    fs.symlinkSync(at('real'), at('alias'));
    const logical = path.join(at('alias'), 'd');
    fakeTable(`${d}/x`);
    expect(ask(logical, { resolve: true, pre: MOUNTS_SEAM })).toBe(`[rc=2] ${MOUNTED(`${d}/x`, d)}`);
    expect(ask(logical, { pre: MOUNTS_SEAM }), 'without resolve the logical spelling is compared as text').toBe('[rc=0]');
  });

  it('case 8: `resolve` of a directory that cannot be entered answers 2, and the table is never asked', () => {
    const n = at('nowhere');
    expect(ask(n, { resolve: true, pre: MOUNTS_SEAM }))
      .toBe(`[rc=2] ${n} cannot be resolved (${n} cannot be entered), so whether anything is mounted under it was never asked`);
  });

  it('case 9: the CONTROL — the kernel’s own table, untouched, has no mount under a fixture directory: 0', () => {
    expect(ask(dirAt('d'))).toBe('[rc=0]');
  });
});

describe('on Darwin nothing is asked: the helper’s one guard, and the leaf’s clean removal (both hosts; path-identity spec §3.5)', () => {
  it('case 10: forced Darwin, the seam poisoned and the resolution spied — 0, and neither was reached', () => {
    const d = dirAt('d');
    expect(ask(d, { resolve: true, pre: `CCD_OS=darwin; ${POISON} ${PHYS_SPY}` })).toBe('[rc=0]');
    expect(linesAt('mi-called'), 'the table was never read').toEqual([]);
    expect(linesAt('phys-called'), 'nothing was resolved').toEqual([]);
    // THE CONTROL: the same poison and spy on the Linux arm are reached, and the poison answers 2.
    expect(ask(d, { resolve: true, pre: `CCD_OS=linux; ${POISON} ${PHYS_SPY}` }))
      .toMatch(/^\[rc=2\] \S+\/no-such-table could not be read, so whether anything is mounted under /);
    expect(linesAt('mi-called')).toHaveLength(1);
    expect(linesAt('phys-called')).toEqual([d]);
  });

  it('D1: forced Darwin, a clean directory leaf — removed by its Darwin removal, and the table never read', () => {
    fs.mkdirSync(path.join(leafOf(), 'x'), { recursive: true });
    fs.writeFileSync(path.join(leafOf(), 'x', 'f'), 'scratch\n');
    const leaf = physLeaf();
    expect(removeLeaf(`CCD_OS=darwin; ${POISON} ${DARWIN_SHIMS}`)).toBe('[rc=0]');
    expect(fs.existsSync(leafOf()), 'the leaf is gone').toBe(false);
    expect(linesAt('mi-called'), 'the table was never read').toEqual([]);
    if (!DARWIN_HOST) expect(linesAt('rm-calls'), 'the Darwin removal itself ran').toEqual([`-rfx -- ${leaf}`]);
  }, 60_000);
});

describe.skipIf(!LINUX)('_ws_leaf_remove asks it twice: after the device compare, and before rm (path-identity spec §3.5)', () => {
  it('L1: a mount under the leaf answers 2 before the permission pass — a mode-0500 directory inside it keeps its mode', () => {
    const locked = path.join(leafOf(), 'mnt', 'locked');
    fs.mkdirSync(locked, { recursive: true });
    fs.writeFileSync(path.join(locked, 'f'), 'inside the mount\n');
    fs.chmodSync(locked, 0o500);
    const leaf = physLeaf();
    fakeTable(`${leaf}/mnt`);
    let out: string; let mode: string;
    try { out = removeLeaf(MOUNTS_SEAM); mode = fs.existsSync(locked) ? modeOf(locked) : 'gone'; }
    finally { if (fs.existsSync(locked)) fs.chmodSync(locked, 0o755); }
    expect(out).toBe(LEAF_KEPT(MOUNTED(`${leaf}/mnt`, leaf), leaf));
    expect(mode, 'the permission pass never ran inside the mount').toBe('500');
    expect(fs.readFileSync(path.join(locked, 'f'), 'utf8'), 'everything stands').toBe('inside the mount\n');
  }, 60_000);

  it('L1b: a mount AT the leaf answers 2 before the leaf’s own owner bits are set', () => {
    fs.mkdirSync(path.join(leafOf(), 'x'), { recursive: true });
    const leaf = physLeaf();
    fakeTable(leaf);
    fs.chmodSync(leafOf(), 0o500);
    let out: string; let mode: string;
    try { out = removeLeaf(MOUNTS_SEAM); mode = fs.existsSync(leafOf()) ? modeOf(leafOf()) : 'gone'; }
    finally { if (fs.existsSync(leafOf())) fs.chmodSync(leafOf(), 0o755); }
    expect(out).toBe(LEAF_KEPT(MOUNTED(leaf, leaf), leaf));
    expect(mode, 'the leaf’s own mode, untouched: ask 1 precedes the owner bits').toBe('500');
    expect(fs.existsSync(path.join(leafOf(), 'x')), 'everything stands').toBe(true);
  }, 60_000);

  it('L2: a mount made while the permission pass runs is seen by the second ask, directly before rm', () => {
    fs.mkdirSync(path.join(leafOf(), 'mnt'), { recursive: true });
    fs.writeFileSync(path.join(leafOf(), 'mnt', 'f'), 'inside the mount\n');
    const leaf = physLeaf();
    fakeTable();
    const pre = `${MOUNTS_SEAM} eval "_t_norm_real()$(declare -f _ws_reclaim_normalise | tail -n +2)";`
      + ` _ws_reclaim_normalise() { if [[ "$1" == */${ID} ]]; then`
      + ' printf \'%s\\n\' "9999 1 0:99 / $1/mnt rw,relatime - tmpfs tmpfs rw" >> "$HOME/mountinfo"; fi;'
      + ' _t_norm_real "$@"; };';
    expect(removeLeaf(pre)).toBe(LEAF_KEPT(MOUNTED(`${leaf}/mnt`, leaf), leaf));
    expect(fs.readFileSync(tableOf(), 'utf8'), 'the CONTROL: the line was added inside the pass, after ask 1')
      .toContain(`/ ${leaf}/mnt rw,relatime`);
    expect(fs.readFileSync(path.join(leafOf(), 'mnt', 'f'), 'utf8'), 'everything stands').toBe('inside the mount\n');
  }, 60_000);

  it('L3: a table that cannot be read answers 2, and nothing is removed', () => {
    fs.mkdirSync(path.join(leafOf(), 'x'), { recursive: true });
    const leaf = physLeaf();
    const pre = '_ws_collect_mountinfo() { printf \'%s\' "$HOME/no-such-table"; };';
    expect(removeLeaf(pre)).toBe(LEAF_KEPT(
      `${at('no-such-table')} could not be read, so whether anything is mounted under ${leaf} was never asked`, leaf));
    expect(fs.existsSync(path.join(leafOf(), 'x'))).toBe(true);
  }, 60_000);

  it('L4: the CONTROL — a mount at a sibling of the leaf is not under it: removed, and proven gone', () => {
    fs.mkdirSync(path.join(leafOf(), 'x'), { recursive: true });
    fakeTable(`${physLeaf()}-x`);
    expect(removeLeaf(MOUNTS_SEAM)).toBe('[rc=0]');
    expect(fs.existsSync(leafOf())).toBe(false);
  }, 60_000);

  it('L5: a root that resolves to a `//` spelling is collapsed and asked: a mount under the real spelling answers 2', () => {
    const real = dirAt('rootreal');
    fs.mkdirSync(path.join(real, ID, 'x'), { recursive: true });
    fs.writeFileSync(path.join(real, ID, 'x', 'f'), 'inside the mount\n');
    fs.symlinkSync(`/${real}`, rootOf());
    expect(h.sh('_ws_dir_physical "$HOME/root"; printf \'%s\' "$_WS_PHYS"'),
      'the CONTROL: bash keeps the link target’s leading `//`').toBe(`/${real}`);
    fakeTable(`${real}/${ID}/x`);
    expect(removeLeaf(MOUNTS_SEAM))
      .toBe(LEAF_KEPT(MOUNTED(`${real}/${ID}/x`, `${real}/${ID}`), `/${real}/${ID}`));
    expect(fs.readFileSync(path.join(real, ID, 'x', 'f'), 'utf8'), 'everything stands').toBe('inside the mount\n');
  }, 60_000);

  it.skipIf(ROOT_USER)('L6: a mode-000 leaf with no mount is removed as before — the question never enters the leaf', () => {
    fs.mkdirSync(path.join(leafOf(), 'x'), { recursive: true });
    fakeTable();
    fs.chmodSync(leafOf(), 0o000);
    let out: string;
    try { out = removeLeaf(MOUNTS_SEAM); } finally { if (fs.existsSync(leafOf())) fs.chmodSync(leafOf(), 0o755); }
    expect(out).toBe('[rc=0]');
    expect(fs.existsSync(leafOf())).toBe(false);
  }, 60_000);
});

describe.skipIf(!LINUX)('the tail’s two leaves, through the real reclaim verb: kept `unmeasured`, the act complete (path-identity spec §3.5)', () => {
  const done = (): Record<string, unknown> => eventsOf(h.home, 'reclaim').find((e) => e['outcome'] === 'done')!;

  it('TL1: a mount under the temp root — kept `unmeasured`, the leaf and its witness standing, byte for byte', () => {
    makeChild(h);
    h.sh(`_child_tmpdir ${CHILD_ID} >/dev/null`);
    const tmp = path.join(h.home, '.cc-tmp', CHILD_ID);
    const wit = path.join(h.home, '.cc-sessions', 'tmproots', CHILD_ID);
    expect(fs.existsSync(wit), 'the CONTROL: the real writer witnessed the leaf').toBe(true);
    const before = fs.readFileSync(wit, 'utf8');
    fs.writeFileSync(path.join(tmp, 'scratch.txt'), 'scratch\n');
    fakeTable(path.join(fs.realpathSync(tmp), 'mnt'));
    const r = childReclaimVerb(h, evalOf(h, { pre: NOBODY }).token, { pre: `${MOUNTS_SEAM} ${NOBODY}` });
    expect(r.code, r.stdout + r.stderr).toBe(0);
    const doc = JSON.parse(r.stdout) as Record<string, unknown>;
    expect(doc['reclaimed']).toBe(CHILD_ID);
    expect(doc['tmpRootKept'], 'a kept leaf is said, not refused').toBe('unmeasured');
    expect(measOf(done())['tmpRootKept']).toBe('unmeasured');
    expect(String(done()['detail'])).toContain(`temp root ${tmp} kept (unmeasured): something is mounted at `);
    expect(fs.readFileSync(path.join(tmp, 'scratch.txt'), 'utf8'), 'the leaf stands').toBe('scratch\n');
    expect(fs.readFileSync(wit, 'utf8'), 'its witness stands, byte for byte').toBe(before);
  }, 90_000);

  it('TL2: a mount under the clips leaf — kept `unmeasured`, the clips leaf standing', () => {
    makeChild(h);
    const clips = path.join(h.home, '.cc-clips', CHILD_ID);
    fs.mkdirSync(clips, { recursive: true });
    fs.writeFileSync(path.join(clips, 'shot.png'), 'png');
    fakeTable(path.join(fs.realpathSync(clips), 'mnt'));
    const r = childReclaimVerb(h, evalOf(h, { pre: NOBODY }).token, { pre: `${MOUNTS_SEAM} ${NOBODY}` });
    expect(r.code, r.stdout + r.stderr).toBe(0);
    const doc = JSON.parse(r.stdout) as Record<string, unknown>;
    expect(doc['reclaimed']).toBe(CHILD_ID);
    expect(doc['clipsKept'], 'a kept leaf is said, not refused').toBe('unmeasured');
    expect(measOf(done())['clipsKept']).toBe('unmeasured');
    expect(String(done()['detail'])).toContain(`clips ${clips} kept (unmeasured): something is mounted at `);
    expect(fs.readFileSync(path.join(clips, 'shot.png'), 'utf8'), 'the clips leaf stands').toBe('png');
  }, 90_000);
});

describe.skipIf(!LINUX || !NO_COPY)('the collector’s window: a mount made after its step 5 asked (path-identity spec §3.5)', () => {
  it('K1: step 6 answers failed quarantine-kept — the record and the slot kept, the leaf whole in its slot', () => {
    makeOrphan(h);
    const token = collectToken(h, { pre: PROBE_STUB });
    realMounts(h);
    const mountAtProven = gapAt('proven',
      'printf "9999 1 0:99 / %s/leaf/mnt rw - tmpfs tmpfs rw\\n" "$3" >> "$HOME/mountinfo"');
    const r = collectVerb(h, token, { pre: `${MOUNTS_SEAM} ${PROBE_STUB} ${mountAtProven}` });
    expect(r.code, r.stdout + r.stderr).toBe(1);
    const doc = docOf(r.stdout);
    expect(doc['failed']).toBe('quarantine-kept');
    expect(String(doc['detail'])).toMatch(
      /^the quarantine record \S+ is kept, and nothing further was removed: something is mounted at /);
    expect(gaps(h), 'step 5 passed').toContain('proven');
    expect(gaps(h), 'and nothing was removed').not.toContain('removed');
    expect(records(h), 'its record is kept').toHaveLength(1);
    expect(slots(h), 'its slot is kept').toHaveLength(1);
    const sleaf = path.join(quarantineOf(h), slots(h)[0]!, 'leaf');
    expect(fs.readFileSync(path.join(sleaf, 'scratch.txt'), 'utf8'), 'scratch.txt is intact').toBe('scratch\n');
    expect(fs.readFileSync(path.join(sleaf, 'cdk.out', 'manifest.json'), 'utf8')).toBe('{}');
  }, 60_000);
});

describe('the source: one helper, one Darwin guard, and the leaf’s two asks in their places (path-identity spec §3.5)', () => {
  const src = ccdSource();
  /** `name`'s definition, from its head line to its closing brace at column 0, or '' when it is not defined. */
  const bodyOf = (name: string): string => {
    const a = src.indexOf(`\n${name}() {`);
    const b = a > -1 ? src.indexOf('\n}\n', a + 1) : -1;
    return b > a ? src.slice(a + 1, b) : '';
  };
  /** Its lines of code: every whole-line comment dropped. */
  const codeOf = (name: string): string[] => bodyOf(name).split('\n').filter((l) => !/^\s*#/.test(l));
  const GUARD = '[[ "$CCD_OS" != darwin ]] || return 0';

  it('src-guard: the helper’s first line of code is the ONE Darwin guard, spelled once in ccd', () => {
    const code = codeOf('_ws_removal_mounts_clear');
    expect(code[0], 'the helper is defined').toMatch(/^_ws_removal_mounts_clear\(\) \{/);
    expect(code[1]?.trim(), 'its first line of code is the guard').toBe(GUARD);
    expect(src.split(GUARD).length - 1, 'the guard is spelled once').toBe(1);
  });

  it('src-reuse: the helper asks the collector’s question and reads no table of its own', () => {
    const code = codeOf('_ws_removal_mounts_clear').join('\n');
    expect(code).toContain('_ws_collect_mounts_clear "$d" && return 0');
    expect(code, 'no second reader of the table').not.toMatch(/mountinfo|exec \{|\bread -r\b/);
  });

  it('src-order: _ws_leaf_remove asks it twice — directly after the device compare, and directly before rm', () => {
    const code = codeOf('_ws_leaf_remove');
    const at = (needle: string): number => code.findIndex((l) => l.includes(needle));
    const asks = code.flatMap((l, i) => (/^\s*_ws_removal_mounts_clear "\$leaf" \\$/.test(l) ? [i] : []));
    expect(asks, 'two asks, neither in resolve mode').toHaveLength(2);
    const dev = at('ccd never removes a mount"; return 1; }');
    const bits = at('find -P "$leaf" -maxdepth 0');
    const rm = at('then err=$(rm -rfx -- "$leaf"');
    expect([dev, bits, rm].every((i) => i > -1), 'the anchors were found').toBe(true);
    expect(asks[0], 'ask 1 directly follows the device compare').toBe(dev + 1);
    expect(asks[0]! + 2, 'and directly precedes the owner bits').toBe(bits);
    expect(asks[1]! + 2, 'ask 2 directly precedes rm').toBe(rm);
    for (const i of asks) {
      expect(code[i + 1]?.trim(), 'each maps the answer to 2, the reason first')
        .toBe('|| { _WS_LEAF_WHY="$_WS_MOUNTS_WHY — nothing under $leaf was removed"; return 2; }');
    }
  });
});
