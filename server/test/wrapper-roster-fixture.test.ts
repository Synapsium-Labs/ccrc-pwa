// Cross-language fixture test — increment 1a of
// docs/superpowers/specs/2026-08-10-architecture-ddd-clean-solid.md. The
// account/wrapper roster this file drives against lives at `shared/api.ts`'s
// `ACCOUNTS`.
//
// This increment does NOT change ccd's bash to read `ACCOUNTS` at runtime —
// that is a bigger change than "an account gets a TypeScript type" and is
// explicitly out of scope (see the spec's increment 2, and this file's own
// header). ccd keeps its own copies (`_cfg_dir`, `_id_wrapper`,
// `VALID_WRAPPERS`, `_is_valid_wrapper`) forever, as far as this increment is
// concerned — what stops the two drifting apart is a test that RUNS the bash
// and checks its answers against the roster, every suite run, rather than a
// comment asking a future author not to.
//
// `_cfg_dir`, `_id_wrapper`, `VALID_WRAPPERS` and `_is_valid_wrapper` are
// executed for real, via the isolated-HOME `sh()` idiom every other ccd test
// file in this directory uses (see ccdWsHelpers.ts's own docstring for why
// HOME is the isolation boundary and `cwd: home` matters).
//
// `install-session-hooks.sh`'s default `homes` array is the one exception:
// invoked with no `--homes` argv it falls back to four literal
// `"$HOME/.claude*"` paths, and even though every entry is skipped when the
// directory doesn't exist (`[[ -d "$dir" ]] || continue` — so running it
// under a fixture HOME would in fact be inert), there is no way to run it
// and OBSERVE what its default list was without either parsing the source or
// instrumenting the script itself. Per this task's own instruction ("if a
// bash copy cannot be executed safely in a test, assert on its parsed source
// text instead and SAY SO") — this asserts on the parsed source text.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ACCOUNTS, type Wrapper } from '../../shared/api.js';
import { makeCcdHarness, type CcdHarness } from './ccdWsHelpers.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const ccrcRoot = path.resolve(here, '..', '..');
const WRAPPERS = Object.keys(ACCOUNTS) as Wrapper[];

let h: CcdHarness;
beforeEach(() => { h = makeCcdHarness('ccrc-wrapper-roster-'); });
afterEach(() => { h.cleanup(); });

describe('ccd VALID_WRAPPERS agrees with ACCOUNTS.homeAble', () => {
  it('is exactly the home-able wrappers, in ACCOUNTS declaration order', () => {
    const got = h.sh('echo "${VALID_WRAPPERS[@]}"').split(/\s+/).filter(Boolean);
    const want = WRAPPERS.filter((w) => ACCOUNTS[w].homeAble);
    expect(got).toEqual(want);
  });
});

describe('ccd _is_valid_wrapper agrees with ACCOUNTS.ccdValid', () => {
  it('accepts exactly the ccd-valid wrappers, and rejects every other one', () => {
    for (const w of WRAPPERS) {
      const ok = h.sh(`_is_valid_wrapper '${w}' && echo yes || echo no`) === 'yes';
      expect(ok, w).toBe(ACCOUNTS[w].ccdValid);
    }
  });
});

describe('ccd _cfg_dir agrees with ACCOUNTS.configDirSuffix', () => {
  it('maps every ccd-valid wrapper onto the roster\'s own config dir, and nothing onto the rest', () => {
    // `_cfg_dir`'s case statement has no branch at all for a wrapper ccd
    // does not know about (`claude-dev0` today) — no default arm, so it
    // echoes nothing. That silence, not a thrown error, is exactly what
    // `configDirFor` (server/src/config.ts) treats as "answer undefined".
    for (const w of WRAPPERS) {
      const got = h.sh(`_cfg_dir '${w}'`);
      const want = ACCOUNTS[w].ccdValid ? path.join(h.home, ACCOUNTS[w].configDirSuffix) : '';
      expect(got, w).toBe(want);
    }
  });
});

describe('ccd _id_wrapper agrees with ACCOUNTS.idPrefix, for the wrappers ccd knows', () => {
  it('resolves a synthetic id under each ccd-valid wrapper\'s idPrefix to that wrapper', () => {
    for (const w of WRAPPERS) {
      if (!ACCOUNTS[w].ccdValid) continue; // ccd's own case statement has no branch for this one — see below
      const id = `${ACCOUNTS[w].idPrefix}fixture-slug`;
      expect(h.sh(`_id_wrapper '${id}'`), w).toBe(w);
    }
  });

  // The bash-side twin of the exact bug `idHomeWrapper` (server/src/fleet.ts)
  // fixed in TypeScript: ccd's own `_id_wrapper` case statement has no
  // `claude-dev0-*` branch, so an id under that prefix falls through to the
  // shorter `claude-*` branch and comes back `claude` — still true today,
  // BY DESIGN of this increment (constraint D: the bash is not touched).
  // Pinning it here, rather than leaving it an unverified assumption, is
  // what turns a future ccd fix — or an accidental regression the other
  // direction — into a red test instead of a silent divergence from
  // `ACCOUNTS['claude-dev0'].ccdValid === false`.
  it('is silent on claude-dev0 — the one wrapper ACCOUNTS knows and ccd does not', () => {
    expect(ACCOUNTS['claude-dev0'].ccdValid).toBe(false);
    const id = `${ACCOUNTS['claude-dev0'].idPrefix}fixture-slug`;
    expect(h.sh(`_id_wrapper '${id}'`)).toBe('claude');
  });
});

describe('install-session-hooks.sh default homes agrees with ACCOUNTS.hooksAble', () => {
  // Not executed — see this file's header. Parses the literal `homes=(...)`
  // array the script falls back to when no `--homes` argv is given.
  it('installs into exactly the hooksAble config dirs, as literal $HOME/<suffix> paths, in ACCOUNTS order', () => {
    const src = readFileSync(path.join(ccrcRoot, 'ccd', 'install-session-hooks.sh'), 'utf8');
    const m = /else homes=\(([^)]*)\); fi/.exec(src);
    expect(m, 'install-session-hooks.sh\'s default `homes=(...)` fallback line').not.toBeNull();
    const got = [...(m as RegExpExecArray)[1].matchAll(/"\$HOME\/([^"]+)"/g)].map((mm) => mm[1]);
    const want = WRAPPERS.filter((w) => ACCOUNTS[w].hooksAble).map((w) => ACCOUNTS[w].configDirSuffix);
    expect(got).toEqual(want);
  });
});
