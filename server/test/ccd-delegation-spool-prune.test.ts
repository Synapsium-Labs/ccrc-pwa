// The absent-owner spool prune (delegation broker wave 4, PR4 Task 4.4; operator ruling 2026-10-14).
//
// `_spawn_start` makes the spawning session's own spool directory (`_delegation_spool_dir`) and then runs
// `_delegation_spool_prune_absent`, which removes `$REG/delegation/spool/<id>/` only when the owner's registry row is gone and
// every bucket in it is past its day of ingestion: older than the cutoff hour (now minus 24 h, UTC) by name and 24 h old by
// mtime. Everything else keeps the directory. It renames a candidate to `.prune.<id>.<pid>`, checks again, and moves it back
// when the check now fails. No verb, unit or timer: a spawn is the only trigger.
//
// Mutations this file owns (plan, Task 4.4): W4-SM1 (row test) -> S1; SM2 (name test) -> S2; SM3 (mtime test) -> S3;
// SM4 (any entry accepted) -> S4; SM5 (owner link test) -> S5; SM6 (registry readability) -> S6a; SM7 (no re-check after the
// rename) -> S8, S9; SM8 (DSP_PRUNE_MAX ignored) -> S10; SM9 (spool root link test) -> S6b; SM10 (a count on stdout) -> S12.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { makeCcdHarness, WIDE_PANE_IF_UP, type CcdHarness } from './ccdWsHelpers.js';

const HOUR = 3_600_000;
/** The UTC hour bucket `hoursAgo` hours before now, as the hook names it. */
const bucketOf = (hoursAgo: number): string => `${new Date(Date.now() - hoursAgo * HOUR).toISOString().slice(0, 13).replace(/[-T]/g, '')}.spool`;

describe('a spawn prunes absent owners\' spool directories past their day of ingestion (W4-S1..S12)', () => {
  let h: CcdHarness;
  beforeEach(() => { h = makeCcdHarness('ccrc-dsp-prune-'); });
  afterEach(() => { h.cleanup(); });
  const ID = 'demo-quiet-mesa';          // the spawning session
  const GONE = 'demo-gone-basin';        // an owner whose row is gone
  const reg = (): string => path.join(h.home, '.cc-sessions');
  const root = (): string => path.join(reg(), 'delegation', 'spool');
  const dirOf = (id: string): string => path.join(root(), id);
  /** `delegation-spool.test.ts`'s spawn substrate: a tmux that RECORDS, and a pane that comes up. */
  const TMUX = `sleep() { :; };
    tmux() {
      echo "tmux $*" >> "$HOME/ccd-calls"
      ${WIDE_PANE_IF_UP}
      case "$1" in
        new-session)  : > "$HOME/pane-up" ;;
        kill-session) rm -f "$HOME/pane-up" ;;
        has-session)  [[ -e "$HOME/pane-up" ]] ;;
      esac
    };`;
  const seed = (id = ID): void => {
    h.sh(`_reg_set ${id} wrapper claude
          _reg_set ${id} workdir '${h.home}'
          _reg_set ${id} uuid deadbeef-0000-4000-8000-000000000000`);
  };
  const spawn1 = (shadow = ''): string => h.sh(`${TMUX} ${shadow} rm -f "$HOME/pane-up"; _spawn_start ${ID} new 2>&1; echo "[rc=$?]"`);
  /** Plants the spool root through one real spawn of the spawning id. */
  const plantRoot = (): void => { seed(); expect(spawn1()).toContain('[rc=0]'); expect(fs.statSync(dirOf(ID)).isDirectory()).toBe(true); };
  const age = (p: string, hoursAgo: number): void => { const t = (Date.now() - hoursAgo * HOUR) / 1000; fs.utimesSync(p, t, t); };
  /** An owner directory holding one bucket per entry, each named `name` hours ago, its mtime `mtime` hours ago. */
  const plantOwner = (dir: string, buckets: Array<{ name: number; mtime: number }>): void => {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    for (const b of buckets) {
      const f = path.join(dir, bucketOf(b.name));
      fs.writeFileSync(f, `{"bucket":${b.name}}\n`);
      age(f, b.mtime);
    }
  };
  const OLD = [{ name: 48, mtime: 48 }, { name: 30, mtime: 30 }];
  /** Every entry under `dir`, name -> bytes (or the link's target), for "kept, byte for byte". */
  const snap = (dir: string): Record<string, string> => Object.fromEntries(fs.readdirSync(dir).sort().map((n) => {
    const p = path.join(dir, n);
    const st = fs.lstatSync(p);
    return [n, st.isSymbolicLink() ? `-> ${fs.readlinkSync(p)}` : st.isDirectory() ? '<dir>' : fs.readFileSync(p, 'utf8')];
  }));
  const leftovers = (): string[] => fs.readdirSync(root()).filter((n) => n.startsWith('.prune.'));

  it('W4-S1: an owner whose row is present (only <id>.generation stands) keeps a 48 h old directory, byte for byte', () => {
    plantRoot();
    plantOwner(dirOf(GONE), OLD);
    fs.writeFileSync(path.join(reg(), `${GONE}.generation`), '0189abcd-1234-5678-9abc-0123456789ab');
    const before = snap(dirOf(GONE));
    expect(spawn1()).toContain('[rc=0]');
    expect(snap(dirOf(GONE))).toEqual(before);
  });

  // Two arms: the plan's (23 h by name and mtime), and one whose 23 h bucket is 48 h old by mtime, so the name test alone keeps it
  // (the plan's arm is also kept by the mtime test, so it could not see W4-SM2).
  it('W4-S2: a row that is gone, with a newest bucket 23 h old by name (and by mtime, or 48 h by mtime), keeps its directory', () => {
    plantRoot();
    for (const [id, mtime] of [[GONE, 23], [`${GONE}-b`, 48]] as const) {
      plantOwner(dirOf(id), [...OLD, { name: 23, mtime }]);
      const before = snap(dirOf(id));
      expect(spawn1()).toContain('[rc=0]');
      expect(snap(dirOf(id)), `mtime ${mtime} h`).toEqual(before);
    }
  });

  it('W4-S3: a bucket 48 h old by name whose mtime is 1 h old keeps its directory', () => {
    plantRoot();
    plantOwner(dirOf(GONE), [{ name: 48, mtime: 1 }]);
    const before = snap(dirOf(GONE));
    expect(spawn1()).toContain('[rc=0]');
    expect(snap(dirOf(GONE))).toEqual(before);
  });

  it('W4-S4: a foreign file, a subdirectory or a link among old buckets keeps the directory, and a link\'s target is untouched', () => {
    plantRoot();
    const target = path.join(h.home, 'target.txt');
    fs.writeFileSync(target, 'untouched\n');
    const extras: Array<[string, (d: string) => void]> = [
      ['notes.txt', (d) => { fs.writeFileSync(path.join(d, 'notes.txt'), 'n\n'); }],
      ['a subdirectory', (d) => { fs.mkdirSync(path.join(d, 'sub')); }],
      ['a link', (d) => { fs.symlinkSync(target, path.join(d, bucketOf(40))); }],
    ];
    extras.forEach(([label, plant], i) => {
      const id = `${GONE}${i}`;
      plantOwner(dirOf(id), OLD);
      plant(dirOf(id));
      age(dirOf(id), 48);
      const before = snap(dirOf(id));
      expect(spawn1(), label).toContain('[rc=0]');
      expect(snap(dirOf(id)), label).toEqual(before);
    });
    expect(fs.readFileSync(target, 'utf8')).toBe('untouched\n');
  });

  it('W4-S5: an owner directory that is a link to a directory of old buckets is kept, and its target untouched', () => {
    plantRoot();
    const outside = path.join(h.home, 'outside-owner');
    plantOwner(outside, OLD);
    const before = snap(outside);
    fs.symlinkSync(outside, dirOf(GONE));
    expect(spawn1()).toContain('[rc=0]');
    expect(fs.lstatSync(dirOf(GONE)).isSymbolicLink()).toBe(true);
    expect(snap(outside)).toEqual(before);
  });

  it.skipIf(process.getuid?.() === 0)('W4-S6 (a): a registry that is searchable but not readable removes nothing, and the spawn returns rc 0', () => {
    plantRoot();
    plantOwner(dirOf(GONE), OLD);
    const before = snap(dirOf(GONE));
    fs.chmodSync(reg(), 0o300);
    let out = '';
    try { out = spawn1(); } finally { fs.chmodSync(reg(), 0o700); }
    expect(out).toContain('[rc=0]');
    expect(snap(dirOf(GONE))).toEqual(before);
  });

  it('W4-S6 (b): a spool root that is a link is never pruned through: nothing under its target is removed, and the spawn returns rc 0', () => {
    plantRoot();
    const outside = path.join(h.home, 'outside-root');
    plantOwner(path.join(outside, GONE), OLD);
    const before = snap(path.join(outside, GONE));
    fs.rmSync(root(), { recursive: true, force: true });
    fs.symlinkSync(outside, root());
    expect(spawn1()).toContain('[rc=0]');
    expect(snap(path.join(outside, GONE))).toEqual(before);
  });

  it('W4-S7: a row that is gone, with every bucket 25 h or more old by name and mtime, loses its directory; a present owner and the spawning id are untouched', () => {
    plantRoot();
    plantOwner(dirOf(GONE), [...OLD, { name: 25, mtime: 25 }]);
    const HERE = 'demo-here-cove';
    seed(HERE);
    plantOwner(dirOf(HERE), OLD);
    fs.writeFileSync(path.join(dirOf(ID), bucketOf(0)), '{"own":1}\n');
    const here = snap(dirOf(HERE));
    const own = snap(dirOf(ID));
    expect(spawn1()).toContain('[rc=0]');
    expect(fs.existsSync(dirOf(GONE)), 'the absent owner\'s directory is gone').toBe(false);
    expect(leftovers()).toEqual([]);
    expect(snap(dirOf(HERE))).toEqual(here);
    expect(snap(dirOf(ID))).toEqual(own);
  });

  /** A shadow `_plat_mv_notdir`, defined after ccd is sourced: the real one, then `act` once, on the prune's rename only. */
  const shadowMv = (act: string): string => `eval "_w4_real_mv() $(declare -f _plat_mv_notdir | tail -n +2)";
    _plat_mv_notdir() { _w4_real_mv "$@"; local rc=$?; if [[ -z "\${W4_FIRED-}" && "$2" == */.prune.* ]]; then W4_FIRED=1; ${act}; fi; return $rc; };`;

  it('W4-S8: an owner respawned between the rename and the second check is moved back under <id> with all its buckets', () => {
    plantRoot();
    plantOwner(dirOf(GONE), OLD);
    const before = snap(dirOf(GONE));
    expect(spawn1(shadowMv(`_reg_set ${GONE} uuid deadbeef-0000-4000-8000-000000000001`))).toContain('[rc=0]');
    expect(fs.existsSync(path.join(reg(), `${GONE}.uuid`)), 'the shadow fired').toBe(true);
    expect(snap(dirOf(GONE))).toEqual(before);
    expect(leftovers()).toEqual([]);
  });

  it('W4-S9: a fresh bucket appended into the renamed directory moves it back, and nothing is deleted', () => {
    plantRoot();
    plantOwner(dirOf(GONE), OLD);
    const before = snap(dirOf(GONE));
    const fresh = bucketOf(0);
    expect(spawn1(shadowMv(`printf '{"late":1}\\n' > "$2/${fresh}"`))).toContain('[rc=0]');
    expect(snap(dirOf(GONE))).toEqual({ ...before, [fresh]: '{"late":1}\n' });
    expect(leftovers()).toEqual([]);
  });

  it('W4-S10: twelve eligible directories go eight at the first spawn and four at the next', () => {
    plantRoot();
    const ids = Array.from({ length: 12 }, (_, i) => `${GONE}-${String(i).padStart(2, '0')}`);
    for (const id of ids) plantOwner(dirOf(id), OLD);
    const left = (): string[] => ids.filter((id) => fs.existsSync(dirOf(id)));
    expect(spawn1()).toContain('[rc=0]');
    expect(left()).toHaveLength(4);
    expect(spawn1()).toContain('[rc=0]');
    expect(left()).toEqual([]);
    expect(leftovers()).toEqual([]);
  });

  it('W4-S11: a leftover .prune.<id>.<pid> with the row gone is removed at the next spawn; with the row present it is moved back to <id>', () => {
    plantRoot();
    const leftover = path.join(root(), `.prune.${GONE}.123`);
    plantOwner(leftover, OLD);
    expect(spawn1()).toContain('[rc=0]');
    expect(fs.existsSync(leftover), 'removed with its row gone').toBe(false);
    expect(fs.existsSync(dirOf(GONE))).toBe(false);
    plantOwner(leftover, OLD);
    const before = snap(leftover);
    fs.writeFileSync(path.join(reg(), `${GONE}.generation`), '0189abcd-1234-5678-9abc-0123456789ab');
    expect(spawn1()).toContain('[rc=0]');
    expect(fs.existsSync(leftover)).toBe(false);
    expect(snap(dirOf(GONE)), 'moved back to <id>').toEqual(before);
  });

  it('W4-S12: the prune prints nothing on stdout, and the spawn around it reports rc 0', () => {
    plantRoot();
    plantOwner(dirOf(GONE), OLD);
    expect(h.sh(`_delegation_spool_prune_absent ${ID} 2>/dev/null; printf '[rc=%s]' "$?"`)).toBe('[rc=0]');
    plantOwner(dirOf(`${GONE}x`), OLD);
    expect(spawn1()).toContain('[rc=0]');
  });
});
