// ARCH-74 (#809), K18: the session hook's already-identical helpers and constants come from `ccrc:generated`, not
// from a hand copy. `shared/hook-helpers.mjs` is the one writer of the hook's generated region; this suite is the
// drift test (the region is current, its stamp verifies, nothing is spelled twice) and the proof the checker can
// fail (each mutation of the hook or of ccd reads as something other than 'current').
// `_launchd_class` lives inside the platform block that `macos-platform.test.ts` holds byte-identical in ccd and ccrc.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  HOOK_CONSTANTS, HOOK_REGION_BEGIN, HOOK_REGION_END, applyHookRegion, checkHookRegion, ccdEpochBody,
  extractHookRegion, renderHookRegion,
} from '../../shared/hook-helpers.mjs';
import { verifyMarker } from '../../shared/mark.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (f: string): string => readFileSync(path.join(root, f), 'utf8');
const hook = read('ccd/session-hook.sh');
const ccd = read('ccd/ccd');
const ccrc = read('ccd/ccrc');
const block = (src: string): string => {
  const s = src.indexOf('# ── THE PLATFORM LAYER');
  const e = src.indexOf('# ── END PLATFORM LAYER');
  return s >= 0 && e > s ? src.slice(s, e) : '';
};
const outside = (src: string): string => { const b = block(src); return b === '' ? src : src.replace(b, ''); };
const codeLines = (src: string): string[] => src.split('\n').filter((l) => !/^\s*#/.test(l));

describe('the hook\'s generated region', () => {
  it('exists, is stamped, and is exactly what the generator renders from ccd', () => {
    expect(extractHookRegion(hook), 'the hook must carry the generated region').not.toBeNull();
    expect(checkHookRegion(hook, ccd)).toBe('current');
    expect(extractHookRegion(hook)).toBe(renderHookRegion(ccd));
  });

  it('carries a stamp over its own body that verifies', () => {
    const region = extractHookRegion(hook)!;
    const inner = region.slice(HOOK_REGION_BEGIN.length + 1, region.length - HOOK_REGION_END.length - 1);
    expect(inner.split('\n')[0]).toMatch(/^# ccrc:generated 1 sha256=[0-9a-f]{64}$/);
    expect(verifyMarker(inner)).toBe('ccrc-unmodified');
  });

  it('holds _hook_epoch_ms with ccd\'s _plat_epoch_ms body and the three constants, and nothing else', () => {
    const region = extractHookRegion(hook)!;
    expect(region).toContain(`_hook_epoch_ms() {\n${ccdEpochBody(ccd)}\n}\n`);
    expect(codeLines(region).filter((l) => /^[A-Z_]+=/.test(l)).sort()).toEqual([
      `CCRC_ID_MAX=${HOOK_CONSTANTS.CCRC_ID_MAX}`,
      `CCRC_PROJ_CLASS='${HOOK_CONSTANTS.CCRC_PROJ_CLASS}'`,
      `CCRC_PROJ_MAX=${HOOK_CONSTANTS.CCRC_PROJ_MAX}`,
    ]);
  });

  it('is the only definition: no hand-copied helper or constant outside it', () => {
    const rest = hook.replace(extractHookRegion(hook)!, '');
    expect(rest).not.toMatch(/^_hook_epoch_ms\(\)/m);
    expect(rest).not.toMatch(/^CCRC_(PROJ_CLASS|PROJ_MAX|ID_MAX)=/m);
  });

  it('keeps ccd\'s register-id cap equal to the id bound', () => {
    expect(ccd).toMatch(new RegExp(`^_REG_ID_MAX=${HOOK_CONSTANTS.CCRC_ID_MAX}$`, 'm'));
  });

  it('is reachable from the command line: --check passes on the shipped pair', () => {
    const r = spawnSync('node', [path.join(root, 'shared/hook-helpers.mjs'), '--check', path.join(root, 'ccd/session-hook.sh'), path.join(root, 'ccd/ccd')], { encoding: 'utf8' });
    expect(r.stdout.trim()).toBe('hook-helpers: current');
    expect(r.status).toBe(0);
  });
});

describe('the drift check can fail', () => {
  const region = (): string => extractHookRegion(hook)!;
  it('reads a hand edit of the copied body as edited', () => {
    expect(checkHookRegion(hook.replace(region(), region().replace('f="${f}000"', 'f="${f}00"')), ccd)).toBe('edited');
  });
  it('reads a hand edit of a constant as edited', () => {
    expect(checkHookRegion(hook.replace(region(), region().replace('CCRC_PROJ_MAX=64', 'CCRC_PROJ_MAX=65')), ccd)).toBe('edited');
  });
  it('reads a change to ccd\'s epoch body as stale', () => {
    expect(checkHookRegion(hook, ccd.replace('f="${f}000"; printf \'%s%s\' "$s" "${f:0:3}"', 'f="${f}000"; printf \'%s%s\' "$s" "${f:0:4}"'))).toBe('stale');
  });
  it('reads a missing region as missing, and refuses to regenerate one', () => {
    const bare = hook.replace(region(), '');
    expect(checkHookRegion(bare, ccd)).toBe('missing');
    expect(() => applyHookRegion(bare, ccd)).toThrow();
  });
  it('regenerates a stale region back to current', () => {
    const drifted = hook.replace(region(), region().replace('CCRC_ID_MAX=128', 'CCRC_ID_MAX=129'));
    expect(checkHookRegion(applyHookRegion(drifted, ccd), ccd)).toBe('current');
  });
});

describe('_launchd_class sits in the platform block', () => {
  it('is defined inside the block in ccd and in ccrc, and nowhere outside it', () => {
    for (const [name, src] of [['ccd', ccd], ['ccrc', ccrc]] as const) {
      expect(block(src), `${name}: inside the block`).toMatch(/^_launchd_class\(\) \{$/m);
      expect(outside(src), `${name}: not outside the block`).not.toMatch(/^_launchd_class\(\) \{$/m);
    }
  });
});
