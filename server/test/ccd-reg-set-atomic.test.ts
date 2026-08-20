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
    expect(body, 'the destination is reached by rename only').toMatch(/mv\s+-[a-zA-Z]*T[a-zA-Z]*\s/);
  });

  it('leaves NO tmp file behind on the success path, and its tmp is invisible to every registry glob', () => {
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
