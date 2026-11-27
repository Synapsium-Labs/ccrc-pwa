// `_plat_uuid` (ccd/ccd) — one uuid, or a non-zero. Never anything else.
//
// The value becomes `$REG/<id>.uuid`, the key `_sync_uuid` follows a session
// by across a swap, so a wrong one is worse than a refusal: it is a session
// nobody can follow. Measured on a Windows box under MSYS2, the chain behind
// /proc was worse than empty:
//
//   /proc/sys/kernel/random/uuid   absent — MSYS2 has no /proc/sys
//   uuidgen                        not installed
//   python3                        the Microsoft Store app-execution ALIAS,
//                                  which installed Python on first run and
//                                  printed `Downloading: …` / `Extracting: …`
//                                  to STDOUT ahead of the uuid
//
// so `$(_plat_uuid)` answered three lines with a uuid at the bottom, rc 0.
//
// Every source is replaced by a shell FUNCTION (a function wins over PATH in
// bash), `cat` included — which is how the /proc arm is made to fail on a
// Linux box too, so this file asks the same questions on every platform.
import { describe, it, expect } from 'vitest';
import { makeCcdHarness } from './ccdWsHelpers.js';

const h = makeCcdHarness('ccrc-platuuid-');
const V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const ANY = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const NO_PROC = 'cat() { return 1; }; ';
const NO_UUIDGEN = 'uuidgen() { return 127; }; ';
const NO_OD = 'od() { return 1; }; ';
const NO_PY = 'python3() { return 1; }; ';

/** rc and stdout, without letting a non-zero throw the answer away. */
function mint(stubs: string): { rc: number; out: string } {
  const r = h.sh(`${stubs} u=$(_plat_uuid 2>/dev/null); printf '%s|%s' "$?" "$u"`);
  const bar = r.indexOf('|');
  return { rc: Number(r.slice(0, bar)), out: r.slice(bar + 1) };
}

describe('_plat_uuid', () => {
  it('mints a v4 from /dev/urandom when /proc and uuidgen are both unavailable — the MSYS2 box', () => {
    const r = mint(NO_PROC + NO_UUIDGEN + NO_PY);
    expect(r.rc).toBe(0);
    expect(r.out).toMatch(V4);
  });

  it('two mints differ — the bytes are read, not a constant', () => {
    expect(mint(NO_PROC + NO_UUIDGEN + NO_PY).out).not.toBe(mint(NO_PROC + NO_UUIDGEN + NO_PY).out);
  });

  it('takes ONLY the uuid from a python3 that printed install noise first', () => {
    const noisy = 'python3() { printf "Downloading: .....\\nExtracting: .....\\n7d3c1f0e-2a4b-4c5d-8e6f-0a1b2c3d4e5f\\n"; }; ';
    const r = mint(NO_PROC + NO_UUIDGEN + NO_OD + noisy);
    expect(r).toEqual({ rc: 0, out: '7d3c1f0e-2a4b-4c5d-8e6f-0a1b2c3d4e5f' });
  });

  it('REFUSES rather than hand out something that is not a uuid', () => {
    // The negative control the arms above cannot be: a source that answered at
    // rc 0 with the wrong shape must not become a registry row.
    const junk = 'python3() { printf "Downloading: .....\\nExtracting: .....\\n"; }; ';
    const r = mint(NO_PROC + NO_UUIDGEN + NO_OD + junk);
    expect(r.rc).not.toBe(0);
    expect(r.out).toBe('');
  });

  it('refuses when every source is gone', () => {
    const r = mint(NO_PROC + NO_UUIDGEN + NO_OD + NO_PY);
    expect(r.rc).not.toBe(0);
    expect(r.out).toBe('');
  });

  it('lowercases an uppercase uuidgen, so one session never has two spellings', () => {
    const upper = 'uuidgen() { echo 7D3C1F0E-2A4B-4C5D-8E6F-0A1B2C3D4E5F; }; ';
    expect(mint(NO_PROC + upper)).toEqual({ rc: 0, out: '7d3c1f0e-2a4b-4c5d-8e6f-0a1b2c3d4e5f' });
  });

  it('is unchanged on the ordinary box: a /proc answer is taken as it is', () => {
    const r = mint('');
    expect(r.rc).toBe(0);
    expect(r.out).toMatch(ANY);
  });
});
