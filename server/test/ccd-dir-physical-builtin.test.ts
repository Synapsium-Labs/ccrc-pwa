// `_ws_dir_physical` (child reclamation, spec §5.6) reads `pwd -P` through
// `builtin`, in a subshell that first unsets every function named after a
// command it calls: `builtin`, `cd`, `pwd`, `printf`. The `builtin` keyword
// already gets past a function named `cd`, `pwd` or `printf`, so only the
// unset stops a WRITABLE function named `builtin` from answering for it. A
// READONLY one survives the unset; the newline suite's sentinel case pins
// that, and this file pins the writable one.
// FIXTURE HOME ONLY: every directory is under the harness's HOME.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { makeCcdHarness, type CcdHarness } from './ccdWsHelpers.js';

let h: CcdHarness;
beforeEach(() => { h = makeCcdHarness('ccrc-dir-physical-builtin-'); });
afterEach(() => { h.cleanup(); });

/** The helper's rc, `_WS_PHYS` and `_WS_PHYS_WHY`. */
const phys = (dir: string, pre = ''): { rc: string; phys: string; why: string } => {
  const [rc = '', p = '', why = ''] = h.sh(`${pre} _ws_dir_physical "${dir}"; rc=$?;`
    + ` printf '%s\\x1f%s\\x1f%s' "$rc" "$_WS_PHYS" "$_WS_PHYS_WHY"`).split('\x1f');
  return { rc, phys: p, why };
};

/** A writable `builtin` that lies for `pwd` and passes every other builtin through. */
const LYING_BUILTIN = 'builtin() { if [[ "$1" == pwd ]]; then command printf "/elsewhere\\n";'
  + ' else command builtin "$@"; fi; };';

describe('_ws_dir_physical — a WRITABLE function named `builtin` cannot answer for it', () => {
  it('a lying `builtin` in the caller’s shell is unset before the read: the physical path, never its lie', () => {
    const vol = path.join(h.home, 'vol');
    fs.mkdirSync(vol);
    fs.symlinkSync(vol, path.join(h.home, 'root'));
    expect(h.sh(`${LYING_BUILTIN} builtin cd -- "${vol}" && builtin pwd -P`),
      'the CONTROL: in the caller’s own shell the function is live, and lies').toBe('/elsewhere');
    const a = phys(path.join(h.home, 'root'), LYING_BUILTIN);
    expect(a.rc, a.why).toBe('0');
    expect(a.phys, 'the lying builtin was unset before the read').toBe(fs.realpathSync(vol));
    expect(a.why).toBe('');
  }, 60_000);
});
