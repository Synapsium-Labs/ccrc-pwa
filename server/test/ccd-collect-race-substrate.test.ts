// THE SUBSTRATE THE MOVE STANDS ON (child-workspace reclamation wave 7, spec 2026-09-22 §5.10). The move is one
// `renameat2(RENAME_NOREPLACE)`, spelled `mv -T -n --no-copy`, and the collector never copies: a cross-mount EXDEV, or
// a `mv` with no `--no-copy` (coreutils older than 9.2), answers unmeasured and leaves nothing behind. Both are shims on
// PATH, scoped to THIS fixture's `~/.cc-tmp`, standing in for what the fleet measured. And step 5 reads the mount table
// through `_ws_collect_mountinfo`, which prints the table's PATH: a mount point at or under the slot's leaf, or a table
// it cannot read, is doubt. The leaf goes back, proven by lstat, and the verb answers `failed` `probe-unmeasured`.
// FIXTURE HOME ONLY (`collectRaceFixture.ts`). Linux only.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { makePrHarness, type PrHarness } from './ccdPrHelpers.js';
import { eventsOf } from './lifecycleHelpers.js';
import {
  COL_ID, LINUX, NO_COPY, collectAudit, collectVerb, devinoOf, docOf, gapAt, gapsOf, orphanLeaf, quarantineOf,
  recordsOf, slotsOf, tmpRootOf, tokenOf,
} from './collectRaceFixture.js';

let h: PrHarness;
beforeEach(() => { h = makePrHarness('ccrc-collect-substrate-'); });
afterEach(() => { h.cleanup(); });

/** The host's own `mv`, resolved once by MEASURING this process's PATH. */
const REAL_MV = (process.env['PATH'] ?? '').split(':').filter(Boolean).map((d) => path.join(d, 'mv'))
  .find((p) => { try { fs.accessSync(p, fs.constants.X_OK); return fs.statSync(p).isFile(); } catch { return false; } }) ?? '';
const shimDir = (): string => path.join(h.home, 'mvshim');
const writeShim = (body: string): void => {
  fs.mkdirSync(shimDir(), { recursive: true });
  fs.writeFileSync(path.join(shimDir(), 'mv'), `#!/bin/sh\n${body}\n`, { mode: 0o755 });
};
const SHIM = (): string => `PATH="${shimDir()}:$PATH";`;
/** rename(2) across two mounts, as the fleet measured it (coreutils 9.4): WITH `--no-copy`, EXDEV is a refusal and
 *  nothing lands at the target; WITHOUT it, mv COPIES, fails to remove the source, and LEAVES THE COPY. Only a source
 *  under this fixture's `~/.cc-tmp` is a leaf move; every other `mv` is the real one. */
const exdevShim = (): string => [
  'prev=""; last=""; nc=0',
  'for a in "$@"; do [ "$a" = --no-copy ] && nc=1; prev=$last; last=$a; done',
  'case "$prev" in',
  `  '${tmpRootOf(h)}'/*)`,
  '    if [ "$nc" = 1 ]; then echo "mv: cannot move \'$prev\' to \'$last\': Invalid cross-device link" >&2; exit 1; fi',
  '    cp -a -- "$prev" "$last" 2>/dev/null',
  '    echo "mv: cannot remove \'$prev\': Permission denied" >&2; exit 1 ;;',
  'esac',
  `exec '${REAL_MV}' "$@"`,
].join('\n');
/** A coreutils older than 9.2: no `--no-copy`. It refuses the option as GNU getopt does, and its --help never names it. */
const noNoCopyShim = (): string => [
  'for a in "$@"; do',
  '  case "$a" in',
  '    --no-copy) echo "mv: unrecognized option \'--no-copy\'" >&2; echo "Try \'mv --help\' for more information." >&2; exit 1 ;;',
  `    --help) '${REAL_MV}' --help | grep -v -e --no-copy; exit 0 ;;`,
  '  esac',
  'done',
  `exec '${REAL_MV}' "$@"`,
].join('\n');
/** Every entry under the quarantine directory, relative — what a copy would have left. */
const underQuarantine = (): string[] => {
  const q = quarantineOf(h);
  if (!fs.existsSync(q)) return [];
  return (fs.readdirSync(q, { recursive: true }) as string[]).sort();
};
/** The leaf stands at the id, whole, as the orphan was made. */
const intactAtId = (o: { leaf: string; devino: string }): void => {
  expect(devinoOf(o.leaf), 'the leaf stands at the id, the same inode').toBe(o.devino);
  expect(fs.readFileSync(path.join(o.leaf, 'scratch', 'a.txt'), 'utf8'), 'with its scratch').toBe('old work\n');
  expect(recordsOf(h), 'no record').toEqual([]);
  expect(slotsOf(h), 'no slot').toEqual([]);
};

describe.skipIf(!LINUX)('the runner itself', () => {
  it('the CONTROL: this Linux runner\'s mv has --no-copy, so the race suites RAN rather than skipped', () => {
    expect(NO_COPY, 'coreutils 9.2 or later is required to measure the collector at all').toBe(true);
    expect(path.isAbsolute(REAL_MV), `measured the host mv as ${JSON.stringify(REAL_MV)}`).toBe(true);
  });
});

describe.skipIf(!LINUX || !NO_COPY)('the move never copies', () => {
  it('EXDEV — the quarantine on another mount: `probe-unmeasured`, nothing moved, NOTHING COPIED, no record, no slot', () => {
    writeShim(exdevShim());
    const o = orphanLeaf(h);
    const r = collectVerb(h, tokenOf(h, COL_ID, SHIM()), COL_ID, SHIM());
    expect(underQuarantine(), 'nothing was copied into the quarantine').toEqual([]);
    expect(r.code, r.stdout + r.stderr).toBe(1);
    expect(docOf(r.stdout)['failed'], r.stdout).toBe('probe-unmeasured');
    intactAtId(o);
  }, 120_000);

  it('a `mv` with no --no-copy: the AUDIT answers `unmeasured`, exits 1, and journals nothing', () => {
    writeShim(noNoCopyShim());
    const o = orphanLeaf(h);
    const a = collectAudit(h, COL_ID, SHIM());
    expect(a.code, a.stdout + a.stderr).toBe(1);
    expect(docOf(a.stdout)['verdict'], a.stdout).toBe('unmeasured');
    expect(docOf(a.stdout)['token'], 'no token').toBeUndefined();
    expect(eventsOf(h.home, 'collect'), 'unmeasured is journaled nowhere').toEqual([]);
    intactAtId(o);
  }, 120_000);

  it('a `mv` with no --no-copy, at the VERB (the token minted where it had one): `probe-unmeasured` before anything is written', () => {
    const o = orphanLeaf(h);
    const token = tokenOf(h);
    writeShim(noNoCopyShim());
    const r = collectVerb(h, token, COL_ID, `${SHIM()} ${gapAt({})}`);
    expect(r.code, r.stdout + r.stderr).toBe(1);
    expect(docOf(r.stdout)['failed'], r.stdout).toBe('probe-unmeasured');
    expect(gapsOf(h), 'refused inside the lock BEFORE the record').not.toContain('recorded');
    intactAtId(o);
    expect(underQuarantine()).toEqual([]);
  }, 120_000);
});

/** `_ws_collect_mountinfo`, redefined. Task 6's seam PRINTS THE PATH of the table `_ws_collect_mounts_clear` opens, so
 *  this one writes `$HOME/mountinfo` (the real table, plus one line per `rels` whose mount point (field 5) is
 *  `<physical slot>/<rel>`, the slot found by its name at the instant step 5 asks, and one per `abs`) and prints that
 *  path. A failure prints nothing, which the reader cannot open: unmeasured. */
const MOUNTS = (rels: readonly string[], abs: readonly string[] = []): string =>
  '_ws_collect_mountinfo() { local s p r t="$HOME/mountinfo"; cat /proc/self/mountinfo > "$t" || return 1;'
  + ` for s in "$HOME/.cc-tmp/.ccd-quarantine"/slot.${COL_ID}.*; do [[ -d "$s" ]] || continue; p=$(cd -- "$s" && pwd -P) || return 1;`
  + ` for r in ${rels.map((x) => `'${x}'`).join(' ')}; do printf '4242 1 0:4242 / %s rw,relatime - tmpfs tmpfs rw\\n' "$p/$r" >> "$t"; done; done;`
  + abs.map((a) => ` printf '4243 1 0:4243 / %s rw,relatime - tmpfs tmpfs rw\\n' "${a}" >> "$t";`).join('')
  + ' printf \'%s\' "$t"; };';

describe.skipIf(!LINUX || !NO_COPY)('step 5\'s mount check, through `_ws_collect_mountinfo`', () => {
  it.each(['leaf/sub', 'leaf'])('a mount point at `<slot>/%s`: doubt — the leaf goes back, proven; `probe-unmeasured`; nothing removed', (rel) => {
    const o = orphanLeaf(h);
    const r = collectVerb(h, tokenOf(h), COL_ID, MOUNTS([rel]));
    const d = docOf(r.stdout);
    expect(d['collected'], r.stdout).toBeUndefined();
    // Ruled (T8 OPEN5, T6 OPEN8): a mount at or under the slot's leaf is unmeasured, answered after a PROVEN restore.
    expect(r.code, r.stdout + r.stderr).toBe(1);
    expect(d['failed'], r.stdout).toBe('probe-unmeasured');
    intactAtId(o);
  }, 120_000);

  it('a mount table that cannot be READ: unmeasured — the leaf goes back; `probe-unmeasured`', () => {
    const o = orphanLeaf(h);
    const r = collectVerb(h, tokenOf(h), COL_ID, '_ws_collect_mountinfo() { printf \'%s\' "$HOME/no-such-table"; };');
    expect(r.code, r.stdout + r.stderr).toBe(1);
    expect(docOf(r.stdout)['failed'], r.stdout).toBe('probe-unmeasured');
    intactAtId(o);
  }, 120_000);

  it('the CONTROL: a mount at `<slot>/leaf2` is beside the leaf, not under it, and one elsewhere is nowhere near — collected', () => {
    const o = orphanLeaf(h);
    const r = collectVerb(h, tokenOf(h), COL_ID, MOUNTS(['leaf2'], [path.join(h.home, 'elsewhere')]));
    expect(docOf(r.stdout)['collected'], r.stdout).toBe(COL_ID);
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(devinoOf(o.leaf)).toBeNull();
  }, 120_000);
});
