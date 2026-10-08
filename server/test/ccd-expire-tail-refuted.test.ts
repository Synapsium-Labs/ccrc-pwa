// ws-expire takes ws-reclaim's tail (spec §5.6), so the tail's word for a
// PROVEN refusal is the expiry's too (child reclamation wave 7). Each shape is
// planted INSIDE the tail's first act (`seam`), after the in-lock ladder passed
// and the pin and the `expire:children` breadcrumb were written. That is the
// window the tail's re-ask exists for. One shape is planted while a RESUMED expiry
// was down. What could not be asked stays `worktree-remove-failed`.
// FIXTURE HOME ONLY (`makePrHarness`): the unit and the pane are stubbed
// (`EXP_STUBS`); every repository, row and leaf is under the HOME.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import { makePrHarness, type PrHarness } from './ccdPrHelpers.js';
import { WS_ADD } from './ccdWsHelpers.js';
import {
  EXP_BRANCH, EXP_ID, EXP_STUBS, expireEvalOf, expireVerb, makeArchived, type Archived,
} from './wsExpireFixture.js';
import { FAMILIES, assertRefuted, assertUnproven, seam, seamRan, type Target } from './containmentRefutedFamilies.js';

let h: PrHarness;
beforeEach(() => { h = makePrHarness('ccrc-expire-refuted-'); });
afterEach(() => { h.cleanup(); });
const WAIT = 'CCD_RECLAIM_TMPROOT_WAIT_S=2;';
const T = (a: Archived): Target => ({ act: 'expire', id: EXP_ID, wt: a.wt, main: a.main, branch: EXP_BRANCH });
const expirable = (): string => {
  const e = expireEvalOf(h);
  expect(e.verdict, `the CONTROL: ${e.detail}`).toBe('expirable');
  return e.token;
};

describe('a PROVEN refusal is containment-refuted — ws-expire, planted inside the tail’s first act (spec §5.6)', () => {
  for (const fam of FAMILIES) {
    it(fam.name, () => {
      const a = makeArchived(h);
      const shape = fam.make(h, T(a));
      const r = expireVerb(h, expirable(), { pre: WAIT + seam(shape.plant) });
      expect(seamRan(h), 'the CONTROL: the shape was planted inside the tail').toBe(true);
      assertRefuted(h, r, T(a), shape, 'children');
    }, 120_000);
  }

  it('a RESUMED expiry at `worktree` too: SHARED, planted while the act was down', () => {
    const a = makeArchived(h);
    const shape = FAMILIES[0]!.make(h, T(a));
    h.sh(`${EXP_STUBS} _WS_RCL_ACT=expire; _ws_expire_eval ${EXP_ID} >/dev/null`
      + ` && _ws_reclaim_pin ${EXP_ID} "${a.wt}" "${a.main}" "$REAP_BRANCH" "$EXPIRE_ARCHIVED_AT"`
      + ` && _ws_tombstone ${EXP_ID} '[]' "$(_ws_reclaim_tomb_fields "$EXPIRE_ARCHIVED_AT" present)" >/dev/null`
      + ` && _reg_set ${EXP_ID} reaping expire:worktree`);
    expect(h.reg(EXP_ID, 'reaping'), 'the CONTROL: interrupted at `worktree`').toBe('expire:worktree');
    const tok = h.sh(`${EXP_STUBS} _WS_RCL_ACT=expire; _ws_expire_resume_eval ${EXP_ID} worktree >/dev/null; printf '%s' "$REAP_TOKEN"`);
    h.sh(shape.plant);
    assertRefuted(h, expireVerb(h, tok, { pre: WAIT }), T(a), shape, 'worktree');
  }, 120_000);
});

describe('what could not be asked stays worktree-remove-failed — ws-expire', () => {
  it('a tree that stands with no worktree record (its admin directory removed inside the tail’s first act)', () => {
    const a = makeArchived(h);
    const r = expireVerb(h, expirable(),
      { pre: WAIT + seam(`rm -rf "${path.join(a.main, '.git', 'worktrees', 'quiet-dune')}";`) });
    expect(seamRan(h)).toBe(true);
    assertUnproven(h, r, T(a), `${a.main} has no worktree record for the tree at ${a.wt}`, 'children');
  }, 120_000);

  it('a nested checkout whose git directory cannot be read — never folded into a proof', () => {
    const a = makeArchived(h);
    h.makeGhRepo('demo2', 'o/r2');
    h.sh(`${WS_ADD} CCD_WS_SLUG=still-harbor cmd_ws_add demo2`);
    const wt2 = path.join(h.home, 'worktrees', 'demo2', 'still-harbor');
    const bogus = path.join(a.wt, 'bogus');
    const r = expireVerb(h, expirable(), { pre: WAIT + seam(
      `rm -rf "${wt2}"; mkdir -p "${bogus}"; echo 'gitdir: /nowhere' > "${bogus}/.git";`) });
    expect(seamRan(h)).toBe(true);
    assertUnproven(h, r, T(a), 'could not read the git directory of the checkout at', 'children');
  }, 120_000);
});
