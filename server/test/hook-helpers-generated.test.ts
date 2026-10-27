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
import {
  AUTHDEAD_REGION_BEGIN, AUTHDEAD_REGION_END, AUTHDEAD_WRITERS, REGIONS, applyRegion, ccdFunctionDefinition, checkRegion, extractRegion,
  regionOf, renderRegion,
} from '../../shared/hook-helpers.mjs';
import { verifyMarker } from '../../shared/mark.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (f: string): string => readFileSync(path.join(root, f), 'utf8');
const hook = read('ccd/session-hook.sh');
const ccd = read('ccd/ccd');
const ccrc = read('ccd/ccrc');
const probe = read('ccd/ccd-account-health');
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

// D-7049 (ARCH-72, spec K16): the second region, the auth-dead marker's writers, byte copies of ccd's definitions for
// `ccd/ccd-account-health` (a sibling executable that sources nothing). One engine, one more row in REGIONS.
describe('the auth-dead writers region (D-7049)', () => {
  const AD = REGIONS.find((r) => r.name === 'authdead')!;
  const defOf = (src: string, name: string): string | null => ccdFunctionDefinition(src, name);

  it('is a row of the one engine, beside the hook\'s, and the module names both', () => {
    expect(REGIONS.map((r) => r.name)).toEqual(['hook', 'authdead']);
    expect(AD.begin).toBe(AUTHDEAD_REGION_BEGIN);
    expect(AD.end).toBe(AUTHDEAD_REGION_END);
    expect(regionOf(hook)).toBe(REGIONS[0]);
  });

  it('renders exactly ccd\'s three writer definitions, byte for byte, in order, stamped', () => {
    const r = renderRegion(AD, ccd);
    const inner = r.slice(AUTHDEAD_REGION_BEGIN.length + 1, r.length - AUTHDEAD_REGION_END.length - 1);
    expect(inner.split('\n')[0]).toMatch(/^# ccrc:generated 1 sha256=[0-9a-f]{64}$/);
    expect(verifyMarker(inner)).toBe('ccrc-unmodified');
    const defs = AUTHDEAD_WRITERS.map((n) => defOf(ccd, n));
    for (const [i, d] of defs.entries()) expect(d, AUTHDEAD_WRITERS[i]).not.toBeNull();
    expect(inner.split('\n').slice(1).join('\n')).toBe(`${defs.join('\n')}\n`);
  });

  it('ccd-account-health carries it, current, and holds no hand-written copy of the three outside it', () => {
    expect(regionOf(probe)).toBe(AD);
    expect(checkRegion(AD, probe, ccd)).toBe('current');
    const rest = probe.replace(extractRegion(AD, probe)!, '');
    for (const n of AUTHDEAD_WRITERS) expect(rest).not.toMatch(new RegExp(`^${n}\\(\\)`, 'm'));
    const r = spawnSync('node', [path.join(root, 'shared/hook-helpers.mjs'), '--check', path.join(root, 'ccd/ccd-account-health'), path.join(root, 'ccd/ccd')], { encoding: 'utf8' });
    expect(r.stdout.trim()).toBe('hook-helpers: current');
    expect(r.status).toBe(0);
  });

  it('reads a hand edit inside the probe\'s region as edited, and ccd\'s drift as stale', () => {
    const region = extractRegion(AD, probe)!;
    expect(checkRegion(AD, probe.replace(region, region.replace('rm -f -- "$t"; return 2', 'return 2')), ccd)).toBe('edited');
    expect(checkRegion(AD, probe, ccd.replace('_authdead_clear() { rm -f -- "$REG/$1-authdead"; }', '_authdead_clear() { rm -f "$REG/$1-authdead"; }'))).toBe('stale');
  });

  it('reads drift from ccd/ccd as stale, a hand edit as edited, and regenerates back to current', () => {
    const target = `#!/usr/bin/env bash\necho before\n${renderRegion(AD, ccd)}echo after\n`;
    expect(regionOf(target)).toBe(AD);
    expect(checkRegion(AD, target, ccd)).toBe('current');
    const moved = ccd.replace('t=$(mktemp "$REG/$1-authdead.tmp.XXXXXX") || return 1', 't=$(mktemp "$REG/$1-authdead.tmp.XXXXXX") || return 3');
    expect(moved).not.toBe(ccd);
    expect(checkRegion(AD, target, moved)).toBe('stale');
    const edited = target.replace('rm -f -- "$t"; return 2', 'rm -f -- "$t"; return 0');
    expect(edited).not.toBe(target);
    expect(checkRegion(AD, edited, ccd)).toBe('edited');
    expect(checkRegion(AD, applyRegion(AD, edited, ccd), ccd)).toBe('current');
    expect(applyRegion(AD, edited, ccd)).toBe(target);
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
