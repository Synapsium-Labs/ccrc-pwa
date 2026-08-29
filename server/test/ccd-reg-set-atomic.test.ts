// server/test/ccd-reg-set-atomic.test.ts
//
// Wave 2 of the registry-durability program. `_reg_set` used to be
// `printf '%s' "$3" > "$REG/$1.$2"` — truncate-then-write, so a reader that
// opened the file inside the window read ZERO BYTES or a prefix of the new
// value. The registry's whole read side (wave 1's measured reads included)
// treats a field's bytes as a fact; a torn field is a fact that was never
// true.
//
// THE INVARIANT D-112 RESTS ON SURVIVES, and this file pins it: the NAME
// never disappears. Truncation never unlinked; rename(2) replaces the
// destination atomically and POSIX requires the new path stay resolvable
// throughout. There is no ENOENT window before or after this change — which
// is why `buildRecord` may keep dropping a row on a single measured-`absent`
// identity field with no second listing.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync, existsSync, mkdirSync, statSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { CCD, makeCcdHarness, type CcdHarness } from './ccdWsHelpers.js';

const ccd = readFileSync(CCD, 'utf8');

let h: CcdHarness;
beforeEach(() => { h = makeCcdHarness('ccrc-ccd-regset-'); });
afterEach(() => { h.cleanup(); });

const REG = (hh: CcdHarness): string => path.join(hh.home, '.cc-sessions');

describe('_reg_set writes atomically', () => {
  it('writes the value BYTE-EXACT, with no trailing newline', () => {
    // The pre-existing contract, pinned first: every reader in the tree
    // (`_reg_get`, `field()` in registry.ts) is written against a file whose
    // bytes are exactly the value. An implementation that gained a newline
    // would break `.uuid` matching and every `-eq`/`=~` guard downstream.
    h.sh(`_reg_set demo-quiet-basin wrapper claude2`);
    expect(readFileSync(path.join(REG(h), 'demo-quiet-basin.wrapper'), 'utf8')).toBe('claude2');
  });

  it('REPLACES the inode rather than truncating it — a reader that already opened the file still sees whole, OLD bytes', () => {
    // THE MECHANISM, and the one assertion that cannot be satisfied by the
    // old body. fd 9 is opened on the old inode; `_reg_set` renames a new
    // inode over the name. Under rename the fd still reads the complete old
    // value. Under truncate-in-place the SAME fd reads the new value (or, in
    // the real race, nothing at all) — which is precisely the torn read.
    const out = h.sh(`_reg_set demo-quiet-basin hold 'program:evals wave:1/4'
      exec 9< "$REG/demo-quiet-basin.hold"
      _reg_set demo-quiet-basin hold 'program:evals wave:2/4'
      printf 'through-fd:[%s] on-disk:[%s]' "$(cat <&9)" "$(cat "$REG/demo-quiet-basin.hold")"
      exec 9<&-`);
    expect(out).toContain('through-fd:[program:evals wave:1/4]');
    expect(out).toContain('on-disk:[program:evals wave:2/4]');
  });

  it('never unlinks its destination — the name is resolvable at every instant (D-112 rests on this)', () => {
    // Structural, because the window it denies is sub-millisecond and cannot
    // be sampled reliably. `_reg_set`'s body must contain no `rm` of the
    // destination and no redirection INTO the destination: the only thing
    // that may touch `$REG/$1.$2` is the rename.
    const body = /_reg_set\(\)\s*\{([\s\S]*?)\n\}/.exec(ccd)?.[1] ?? '';
    expect(body, '_reg_set must be a multi-line function by now').not.toBe('');
    expect(body, 'nothing may unlink the destination').not.toMatch(/rm\s+[^\n]*"\$REG\/\$1\.\$2"/);
    expect(body, 'nothing may redirect into the destination').not.toMatch(/>\s*"\$REG\/\$1\.\$2"/);
    // THE RENAME MOVED ONE FRAME DEEPER when macOS arrived: BSD `mv` has no
    // `-T`, so the GNU call this used to scan for now lives in
    // `_plat_mv_notdir`, whose Linux arm IS that call and whose Darwin arm
    // reproduces its refusal. The invariant is unchanged and so is the
    // strength of this check — it just has to follow the indirection, and it
    // pins BOTH ends so neither can be loosened alone.
    expect(body, 'the destination is reached by the rename helper only')
      .toMatch(/_plat_mv_notdir\s+"\$tmp"\s+"\$REG\/\$1\.\$2"/);
    const mvBody = /_plat_mv_notdir\(\)\s*\{([\s\S]*?)\n\}/.exec(ccd)?.[1] ?? '';
    expect(mvBody, '_plat_mv_notdir must be a multi-line function').not.toBe('');
    expect(mvBody, 'the helper reaches the destination by rename only').toMatch(/mv\s+-[a-zA-Z]*T[a-zA-Z]*\s/);
    expect(mvBody, 'the helper must never unlink its destination').not.toMatch(/rm\s+[^\n]*"\$2"/);
    expect(mvBody, 'the helper must never redirect into its destination').not.toMatch(/>\s*"\$2"/);
  });

  it('names its tmp DOT-FIRST and never ends it in the field — the two properties every listing reader depends on', () => {
    // STRUCTURAL, and deliberately so: the only moment a tmp exists is between
    // `_reg_set`'s redirection and its `mv`, and a behavioural test cannot
    // observe that window without racing the very write it is watching. So
    // the NAME is pinned where the name is decided — a scan of `_reg_set`'s
    // own body, the same instrument `ccd-pr-state.test.ts` uses on the python
    // half ("put() renames rather than truncating…"). The sibling test below
    // can only assert what is left AFTER a successful `_reg_set`, and a
    // success renames the tmp out of existence, so nothing there can see a
    // tmp name at all.
    //
    // Both properties are load-bearing and each closes a different reader
    // class (`_reg_set`'s own comment states them):
    //   - LEADING DOT — every registry glob in ccd is un-`dotglob`'d
    //     (`$REG/$id.*` in `_reg_purge`/`_ws_slug_free`/`_ws_slug_residue`,
    //     `$REG/*.workspace`, `$REG/*.uuid`), and a dotfile matches none of
    //     them. Drop the dot and a leaked tmp wedges a slug.
    //   - FIELD NEVER LAST — node's `readdir` DOES return dotfiles, and
    //     `readRegistryMeasured` mints session ids from
    //     `names.filter(n => n.endsWith('.uuid'))`. A tmp ending in the field
    //     name would mint a phantom session out of an in-flight write.
    const body = /_reg_set\(\)\s*\{([\s\S]*?)\n\}/.exec(ccd)?.[1] ?? '';
    const assigned = /^\s*tmp=("[^"]*")/m.exec(body)?.[1] ?? '';
    expect(assigned, '_reg_set must build its tmp path in one quoted assignment').not.toBe('');
    const parts = assigned.slice(1, -1).split('.');
    expect(parts[0], 'the tmp must be DOT-PREFIXED — the first path component after $REG/ is the dot')
      .toBe('$REG/');
    expect(parts[parts.length - 1], 'the FIELD may never be the last component — a `.tmp` suffix is what keeps it out of `endsWith(\'.uuid\')`')
      .toBe('tmp');
    expect(parts, 'the field must still appear, just never last').toContain('$2');
  });

  it('leaves NO tmp file behind on the success path, and its tmp is invisible to every registry glob', () => {
    // Everything here is asserted AFTER `_reg_set` succeeded, and success
    // renames the tmp out of existence — so this test pins CLEANUP and the
    // resulting listing, never the tmp's NAME. The naming scheme itself is
    // pinned structurally by the test above.
    h.sh(`_reg_set demo-quiet-basin uuid u1
          _reg_set demo-quiet-basin workspace quiet-basin
          _reg_set demo-quiet-basin wrapper claude`);
    const all = readdirSync(REG(h));
    expect(all.filter((n) => n.endsWith('.tmp')), 'a success-path write must clean up after itself').toEqual([]);
    // The two shapes every consumer keys on. A tmp that ended in the field
    // name would mint a phantom session id in `readRegistryMeasured`
    // (`names.filter(n => n.endsWith('.uuid'))`), which is the failure this
    // naming scheme exists to prevent.
    expect(all.filter((n) => n.endsWith('.uuid'))).toEqual(['demo-quiet-basin.uuid']);
    // And ccd's own globs: `_ws_slug_residue` lists exactly the real fields.
    expect(h.sh('_ws_slug_residue demo quiet-basin').split(', ').sort())
      .toEqual(['uuid', 'workspace', 'wrapper']);
  });

  // ROOT-TOLERANT, deliberately: `chmod 500` does not stop uid 0, so under a
  // root test runner this fixture proves nothing and would fail for a reason
  // unrelated to the guard. The DIRECTORY-destination case below is the
  // any-uid stand-in (`ccd-hold.test.ts` says so in its own words) and covers
  // the same refusal for every uid.
  it.skipIf(process.getuid?.() === 0)('REFUSES when the registry directory cannot be written, and leaves no tmp', () => {
    // The `chmod 500 "$REG"` class, which `cmd_ws_hold`'s `|| die` depends on.
    h.sh(`_reg_set demo-quiet-basin uuid u1`);
    const r = h.sh(`chmod 500 "$REG"; _reg_set demo-quiet-basin wrapper claude; printf 'rc=%s' "$?"; chmod 700 "$REG"`);
    expect(r).toContain('rc=1');
    expect(existsSync(path.join(REG(h), 'demo-quiet-basin.wrapper'))).toBe(false);
    expect(readdirSync(REG(h)).filter((n) => n.endsWith('.tmp'))).toEqual([]);
  });

  it('REFUSES when the destination is a DIRECTORY — it must never move the tmp inside it', () => {
    // MEASURED (GNU coreutils 9.4): `mv -f tmp <dir>` succeeds at rc 0 and
    // puts the tmp INSIDE the directory. That is a false success, and
    // `ccd-hold.test.ts`'s "a failed registry write REFUSES" uses exactly
    // this state as its any-uid stand-in for a write failure. `-T`
    // (--no-target-directory) is what makes the refusal real; drop it and
    // this test and that one both go red.
    mkdirSync(path.join(REG(h), 'demo-quiet-basin.hold'));
    const r = h.sh(`_reg_set demo-quiet-basin hold 'program:evals wave:1/4'; printf 'rc=%s' "$?"`);
    expect(r).toContain('rc=1');
    expect(statSync(path.join(REG(h), 'demo-quiet-basin.hold')).isDirectory()).toBe(true);
    expect(readdirSync(path.join(REG(h), 'demo-quiet-basin.hold')), 'the tmp must not have been moved inside').toEqual([]);
    expect(readdirSync(REG(h)).filter((n) => n.endsWith('.tmp'))).toEqual([]);
  });

  it('two writers of DIFFERENT fields in one process do not collide on a tmp name', () => {
    // The tmp carries the field and a per-process sequence, so no two writes
    // — same process or not — ever name the same tmp. A collision would make
    // one of the two `mv` calls fail ENOENT and return 1, which at
    // `cmd_ws_hold` is a false "NOT held".
    const r = h.sh(`_reg_set demo-quiet-basin uuid u1 & _reg_set demo-quiet-basin wrapper claude & wait
                    printf '[%s][%s]' "$(_reg_get demo-quiet-basin uuid)" "$(_reg_get demo-quiet-basin wrapper)"`);
    expect(r).toContain('[u1][claude]');
  });
});
