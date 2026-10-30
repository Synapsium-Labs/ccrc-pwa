// ARCH-74 (#809), K18: the session hook's already-identical helpers and constants come from `ccrc:generated`, not
// from a hand copy. `shared/hook-helpers.mjs` is the one writer of the hook's generated region; this suite is the
// drift test (the region is current, its stamp verifies, nothing is spelled twice) and the proof the checker can
// fail (each mutation of the hook or of ccd reads as something other than 'current').
// `_launchd_class` lives inside the platform block that `macos-platform.test.ts` holds byte-identical in ccd and ccrc.
import { describe, it, expect } from 'vitest';
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path, { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  HOOK_CONSTANTS, HOOK_REGION_BEGIN, HOOK_REGION_END, applyHookRegion, checkHookRegion, ccdEpochBody,
  extractHookRegion, renderHookRegion,
} from '../../shared/hook-helpers.mjs';
import {
  AUTHDEAD_REGION_BEGIN, AUTHDEAD_REGION_END, AUTHDEAD_WRITERS, REGIONS, applyRegion, ccdFunctionDefinition, checkRegion, extractRegion,
  regionOf, renderRegion,
} from '../../shared/hook-helpers.mjs';
import { LOGLINE_REGION_BEGIN, LOGLINE_REGION_END, renderLogLineBody } from '../../shared/hook-helpers.mjs';
import { markGenerated, verifyMarker } from '../../shared/mark.mjs';
import { mkTmp } from './tmpHelpers.js';
import { ghContainedEnv } from './ccdWsHelpers.js';

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
    expect(REGIONS.map((r) => r.name)).toEqual(['hook', 'authdead', 'apicap', 'log-line']);
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

describe('`ccrc restamp ccd/ccd-account-health` regenerates the auth-dead region (D-7049)', () => {
  // A fixture tree holding the target's own ccd/ and shared/, as `ccrc-restamp.test.ts` builds one for the hook; a
  // throwaway HOME. Nothing here runs the probe.
  const tree = (): string => {
    const t = mkTmp('ccrc-restamp-probe-');
    mkdirSync(join(t, 'ccd')); mkdirSync(join(t, 'shared'));
    for (const f of ['ccd/ccd', 'shared/mark.mjs', 'shared/hook-helpers.mjs']) copyFileSync(join(root, f), join(t, f));
    return t;
  };
  const restamp = (f: string): { code: number; stdout: string; stderr: string } => {
    const home = mkTmp('ccrc-restamp-probe-home-');
    const r = spawnSync('bash', [join(root, 'ccd', 'ccrc'), 'restamp', f], { env: ghContainedEnv(home, { ...process.env, HOME: home }), encoding: 'utf8' });
    return { code: r.status ?? -1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
  };

  it('regenerates a hand-edited region, then answers current, leaving every other byte', () => {
    const f = join(tree(), 'ccd', 'ccd-account-health');
    writeFileSync(f, probe.replace(/^# ccrc:generated 1 sha256=\S+$/m, '# ccrc:generated 1 sha256=0000').replace('rm -f -- "$t"; return 2', 'return 2'));
    const r = restamp(f);
    expect(r.code, r.stderr).toBe(0);
    expect(r.stdout).toContain('auth-dead writers regenerated');
    expect(readFileSync(f, 'utf8')).toBe(probe);
    const again = restamp(f);
    expect(again.code, again.stderr).toBe(0);
    expect(again.stdout).toContain('auth-dead writers already current');
    expect(readFileSync(f, 'utf8')).toBe(probe);
  });

  it('refuses, writing nothing, a probe whose own tree lacks the module or ccd', () => {
    const f = join(mkTmp('ccrc-restamp-probe-'), 'ccd-account-health');
    writeFileSync(f, probe);
    const r = restamp(f);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain('carries generated auth-dead writers, but its own tree lacks');
    expect(r.stderr).toContain('Nothing was written');
    expect(readFileSync(f, 'utf8')).toBe(probe);
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

// D-7321 (K5 tail, Task Q3i; D-7329): the third region, `_api_server_cap` in `ccd/ccrc-api`, a byte copy of the hook's
// `_hook_server_cap` under another name (ccrc-api sources nothing, so it cannot call the hook's). The first row whose
// source is the hook beside ccd, not ccd itself; the engine hands that text to this row only.
describe('the server-cap reader region in ccrc-api (D-7321)', () => {
  const api = read('ccd/ccrc-api');
  const AP = REGIONS.find((r) => r.name === 'apicap')!;
  const HK = REGIONS.find((r) => r.name === 'hook')!;
  const AD = REGIONS.find((r) => r.name === 'authdead')!;
  const ref = (src: string): string => ccdFunctionDefinition(src, '_hook_server_cap')!;
  const bodyOf = (def: string): string => def.slice(def.indexOf('\n') + 1);
  const innerOf = (row: typeof AP, region: string): string => region.slice(row.begin.length + 1, region.length - row.end.length - 1);

  it('ccrc-api\'s server-cap reader is current', () => {
    expect(AP, 'the engine carries an apicap row').toBeDefined();
    expect(regionOf(api)).toBe(AP);
    expect(checkRegion(AP, api, ccd, hook)).toBe('current');
    expect(extractRegion(AP, api)).toBe(renderRegion(AP, ccd, hook));
    const inner = innerOf(AP, extractRegion(AP, api)!);
    expect(inner.split('\n')[0]).toMatch(/^# ccrc:generated 1 sha256=[0-9a-f]{64}$/);
    expect(verifyMarker(inner)).toBe('ccrc-unmodified');
    const r = spawnSync('node', [path.join(root, 'shared/hook-helpers.mjs'), '--check', path.join(root, 'ccd/ccrc-api'), path.join(root, 'ccd/ccd')], { encoding: 'utf8' });
    expect(r.stdout.trim()).toBe('hook-helpers: current');
    expect(r.status).toBe(0);
  });

  it('the generated reader is named _api_server_cap', () => {
    const want = `_api_server_cap() {\n${bodyOf(ref(hook))}\n`;
    expect(AP.render(hook), 'the renderer renames the hook\'s reader').toBe(want);
    expect(ccdFunctionDefinition(AP.render(hook), '_hook_server_cap'), 'the renderer keeps no hook name line').toBeNull();
    const inner = innerOf(AP, extractRegion(AP, api)!);
    expect(inner.split('\n').slice(1).join('\n')).toBe(want);
    expect(ccdFunctionDefinition(api, '_api_server_cap')).not.toBeNull();
    expect(api).not.toMatch(/^_hook_server_cap\(\)/m);
    const rest = api.replace(extractRegion(AP, api)!, '');
    expect(rest).not.toMatch(/^_api_server_cap\(\)/m);
  });

  it('a one-byte edit inside it reads edited, and stale once re-stamped over the edit', () => {
    const region = extractRegion(AP, api)!;
    const edited = region.replace('now - at <= 180', 'now - at <= 181');
    expect(edited).not.toBe(region);
    expect(checkRegion(AP, api.replace(region, edited), ccd, hook)).toBe('edited');
    const blessed = `${AP.begin}\n${markGenerated(innerOf(AP, edited).split('\n').slice(1).join('\n'))}${AP.end}\n`;
    expect(checkRegion(AP, api.replace(region, blessed), ccd, hook)).toBe('stale');
    expect(checkRegion(AP, applyRegion(AP, api.replace(region, edited), ccd, hook), ccd, hook)).toBe('current');
  });

  it('an edit to the hook\'s reader makes ccrc-api\'s region stale', () => {
    expect(checkRegion(AP, api, ccd, hook)).toBe('current');
    const moved = hook.replace('{1,64})*$ ]] || return 1', '{1,63})*$ ]] || return 1');
    expect(moved).not.toBe(hook);
    expect(checkRegion(AP, api, ccd, moved)).toBe('stale');
    expect(checkRegion(AP, api, ccd.replace('_authdead_clear() {', '_authdead_clear()  {'), hook)).toBe('current');
  });

  it('the hook and auth-dead regions render as on the base', () => {
    expect(renderRegion(HK, ccd, hook)).toBe(extractRegion(HK, hook));
    expect(renderRegion(AD, ccd, hook)).toBe(extractRegion(AD, probe));
    expect(renderRegion(HK, ccd)).toBe(extractRegion(HK, hook));
    expect(renderRegion(AD, ccd)).toBe(extractRegion(AD, probe));
    for (const f of ['ccd/session-hook.sh', 'ccd/ccd-account-health']) {
      const r = spawnSync('node', [path.join(root, 'shared/hook-helpers.mjs'), '--check', path.join(root, f), path.join(root, 'ccd/ccd')], { encoding: 'utf8' });
      expect(r.stdout.trim(), f).toBe('hook-helpers: current');
    }
  });

  it('`ccrc restamp ccd/ccrc-api` regenerates a hand-edited region from its own tree, then answers current', () => {
    const t = mkTmp('ccrc-restamp-api-');
    mkdirSync(join(t, 'ccd')); mkdirSync(join(t, 'shared'));
    for (const f of ['ccd/ccd', 'ccd/session-hook.sh', 'shared/mark.mjs', 'shared/hook-helpers.mjs']) copyFileSync(join(root, f), join(t, f));
    const f = join(t, 'ccd', 'ccrc-api');
    writeFileSync(f, api.replace('now - at <= 180', 'now - at <= 300'));
    const home = mkTmp('ccrc-restamp-api-home-');
    const run = () => spawnSync('bash', [join(root, 'ccd', 'ccrc'), 'restamp', f], { env: ghContainedEnv(home, { ...process.env, HOME: home }), encoding: 'utf8' });
    const r = run();
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toContain('server-cap reader regenerated');
    expect(readFileSync(f, 'utf8')).toBe(api);
    const again = run();
    expect(again.status, again.stderr).toBe(0);
    expect(again.stdout).toContain('server-cap reader already current');
  });
});

// W5 Task C5i (ARCH-67; D-7078): each REGIONS row names the file it is given (`file`), the CLI's third argument and the
// engine's `ccdSrc`. `source` keeps its meaning: the text `render` reads, `ccd` (the given file) or `hook` (the
// session-hook.sh beside it). Every CLI spawn below runs the real module with a contained env.
describe('each generated region names the file it is given (C5i)', () => {
  const MODULE = path.join(root, 'shared/hook-helpers.mjs');
  const work = mkTmp('hook-helpers-c5i-');
  const cli = (...args: string[]): { code: number; stdout: string; stderr: string } => {
    const r = spawnSync('node', [MODULE, ...args], { env: ghContainedEnv(work, { PATH: process.env['PATH'] ?? '' }), encoding: 'utf8' });
    return { code: r.status ?? -1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
  };

  it('the hook, auth-dead and server-cap rows are each given ccd/ccd, and source keeps its values', () => {
    for (const n of ['hook', 'authdead', 'apicap']) {
      expect(REGIONS.find((r) => r.name === n)?.file, n).toBe('ccd/ccd');
    }
    expect(REGIONS.map((r) => r.source)).toEqual(['ccd', 'ccd', 'hook', 'ccd']);
  });

  it('CONTROL: an absent target or an absent given file exits non-zero, naming the path', () => {
    const gone = join(work, 'no-such-file');
    const a = cli('--check', path.join(root, 'ccd/session-hook.sh'), gone);
    expect(a.code).not.toBe(0);
    expect(a.stderr).toContain(gone);
    expect(a.stdout).toBe('');
    const b = cli('--check', gone, path.join(root, 'ccd/ccd'));
    expect(b.code).not.toBe(0);
    expect(b.stderr).toContain(gone);
    expect(b.stdout).toBe('');
  });
});

// C5i: `ccrc restamp` takes the file a region is given from the module's `--region-files` (detect, label, file), and
// from `--regions` (detect, label; every region given ccd/ccd) when the module predates that mode. `--regions` keeps
// its two columns byte for byte: an installed ccrc from before C5i reads it with `read -r b l`.
describe('`ccrc restamp` gives each region the file its row names (C5i)', () => {
  const MODULE = path.join(root, 'shared/hook-helpers.mjs');
  const realModule = read('shared/hook-helpers.mjs');
  const work = mkTmp('hook-helpers-c5i-restamp-');
  const cli = (mod: string, ...args: string[]): { code: number; stdout: string; stderr: string } => {
    const r = spawnSync('node', [mod, ...args], { env: ghContainedEnv(work, { PATH: process.env['PATH'] ?? '' }), encoding: 'utf8' });
    return { code: r.status ?? -1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
  };
  /** A planted tree: the given files under ccd/ and shared/, the real mark.mjs, and `module` as its engine. */
  const planted = (module: string, files: Record<string, string>): string => {
    const t = mkTmp('ccrc-restamp-c5i-');
    mkdirSync(join(t, 'ccd')); mkdirSync(join(t, 'shared'));
    copyFileSync(join(root, 'shared/mark.mjs'), join(t, 'shared/mark.mjs'));
    writeFileSync(join(t, 'shared/hook-helpers.mjs'), module);
    for (const [rel, body] of Object.entries(files)) writeFileSync(join(t, rel), body);
    return t;
  };
  const restamp = (f: string): { code: number; stdout: string; stderr: string } => {
    const home = mkTmp('ccrc-restamp-c5i-home-');
    const r = spawnSync('bash', [join(root, 'ccd', 'ccrc'), 'restamp', f], { env: ghContainedEnv(home, { ...process.env, HOME: home }), encoding: 'utf8' });
    return { code: r.status ?? -1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
  };
  /** The real module with the auth-dead row given `file` instead of ccd/ccd. */
  const authdeadGiven = (file: string): string => {
    const at = "file: 'ccd/ccd', render: renderAuthdeadBody";
    expect(realModule).toContain(at);
    return realModule.replace(at, `file: '${file}', render: renderAuthdeadBody`);
  };

  it('--regions prints exactly each row\'s detect prefix and label, two columns, nothing more', () => {
    const r = cli(MODULE, '--regions');
    expect(r.code).toBe(0);
    expect(r.stdout).toBe(REGIONS.map((x) => `${x.detect}\t${x.label}\n`).join(''));
  });

  it('--region-files prints each row\'s detect prefix, label and given file, three columns, and exits 0', () => {
    const r = cli(MODULE, '--region-files');
    expect(r.code, r.stderr).toBe(0);
    expect(r.stdout).toBe(REGIONS.map((x) => `${x.detect}\t${x.label}\t${x.file}\n`).join(''));
    for (const n of ['hook', 'authdead', 'apicap']) {
      const row = REGIONS.find((x) => x.name === n)!;
      expect(r.stdout.split('\n'), n).toContain(`${row.detect}\t${row.label}\tccd/ccd`);
    }
  });

  it('a region whose row names ccd/ccd-alt is regenerated from ccd/ccd-alt, then answers current', () => {
    const alt = ccd.replace('t=$(mktemp "$REG/$1-authdead.tmp.XXXXXX") || return 1', 't=$(mktemp "$REG/$1-authdead.tmp.XXXXXX") || return 3');
    expect(alt).not.toBe(ccd);
    const t = planted(authdeadGiven('ccd/ccd-alt'), { 'ccd/ccd': ccd, 'ccd/ccd-alt': alt, 'ccd/ccd-account-health': probe });
    const f = join(t, 'ccd/ccd-account-health');
    const r = restamp(f);
    expect(r.code, r.stderr).toBe(0);
    expect(r.stdout).toContain('auth-dead writers regenerated');
    expect(readFileSync(f, 'utf8')).toContain('|| return 3');
    const c = cli(join(t, 'shared/hook-helpers.mjs'), '--check', f, join(t, 'ccd/ccd-alt'));
    expect(c.stdout.trim()).toBe('hook-helpers: current');
    expect(c.code).toBe(0);
  });

  it('a region whose row names a file outside ccd/ is refused, naming that file, and nothing is written', () => {
    const t = planted(authdeadGiven('shared/x'), { 'ccd/ccd': ccd, 'ccd/ccd-account-health': probe.replace('rm -f -- "$t"; return 2', 'return 2') });
    const f = join(t, 'ccd/ccd-account-health');
    const before = readFileSync(f);
    const r = restamp(f);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain('carries generated auth-dead writers, but its own tree lacks');
    expect(r.stderr).toContain('or shared/x;');
    expect(r.stderr).toContain('Nothing was written');
    expect(readFileSync(f)).toEqual(before);
  });

  it('a module with no --region-files branch still regenerates the hook region from the tree\'s ccd', () => {
    const old = realModule.replaceAll("'--region-files'", "'--no-such-mode'");
    expect(old, 'the replace must take the module\'s --region-files branch away').not.toBe(realModule);
    const t = planted(old, { 'ccd/ccd': ccd, 'ccd/session-hook.sh': hook.replace('CCRC_ID_MAX=128', 'CCRC_ID_MAX=1') });
    const f = join(t, 'ccd/session-hook.sh');
    const r = restamp(f);
    expect(r.code, r.stderr).toBe(0);
    expect(r.stdout).toContain('hook helpers regenerated');
    expect(readFileSync(f, 'utf8')).toBe(hook);
  });
});

// C5i: the fourth region, the log-line redactor. `ccd/ccd-update-sync` (a sibling executable that sources nothing)
// carries a generated byte copy of ccd/ccrc's `_upd_redact`; the row is given ccd/ccrc and renders from it. These rows
// reach the row through `REGIONS` and the existing engine calls, so they red on their own assertions where it is absent.
const LL_BEGIN = '# ── BEGIN GENERATED LOG-LINE REDACTOR (shared/hook-helpers.mjs; edit it in ccd/ccrc, then regenerate) ──';
const LL_END = '# ── END GENERATED LOG-LINE REDACTOR ──';
describe('the log-line redactor region (C5i)', () => {
  const MODULE = path.join(root, 'shared/hook-helpers.mjs');
  const work = mkTmp('hook-helpers-c5i-logline-');
  const LL = REGIONS.find((r) => (r.name as string) === 'log-line');
  const upd = ccdFunctionDefinition(ccrc, '_upd_redact')!;
  /** The region as the engine must render it from `src`, built by hand (BEGIN, the stamped copy, END). */
  const byHand = (src: string): string => `${LL_BEGIN}\n${markGenerated(`${ccdFunctionDefinition(src, '_upd_redact')!}\n`)}${LL_END}\n`;
  const movedCcrc = ccrc.replace('  local home="${HOME:-}"\n  home="${home%/}"\n', '  local home="${HOME:-}"\n  home="${home%%/}"\n');
  const cli = (...args: string[]): { code: number; stdout: string; stderr: string } => {
    const r = spawnSync('node', [MODULE, ...args], { env: ghContainedEnv(work, { PATH: process.env['PATH'] ?? '' }), encoding: 'utf8' });
    return { code: r.status ?? -1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
  };
  const restamp = (f: string): { code: number; stdout: string; stderr: string } => {
    const home = mkTmp('ccrc-restamp-logline-home-');
    const r = spawnSync('bash', [join(root, 'ccd', 'ccrc'), 'restamp', f], { env: ghContainedEnv(home, { ...process.env, HOME: home }), encoding: 'utf8' });
    return { code: r.status ?? -1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
  };
  /** A planted tree holding the real ccd (which has no `_upd_redact`), the given files and the real modules. */
  const planted = (files: Record<string, string>): string => {
    const t = mkTmp('ccrc-restamp-logline-');
    mkdirSync(join(t, 'ccd')); mkdirSync(join(t, 'shared'));
    for (const f of ['ccd/ccd', 'shared/mark.mjs', 'shared/hook-helpers.mjs']) copyFileSync(join(root, f), join(t, f));
    for (const [rel, body] of Object.entries(files)) writeFileSync(join(t, rel), body);
    return t;
  };
  const SYNC_SHAPE = (region: string): string => `#!/usr/bin/env bash\nset +x\nexport LC_ALL=C\n${region}say() { printf 'x: %s\\n' "$(_upd_redact "$1" bare-host)" >&2; }\n`;

  it('is the fourth row, given ccd/ccrc, rendering from the given text', () => {
    expect(LL, 'the engine carries a log-line row').toBeDefined();
    expect(LL!.begin).toBe(LL_BEGIN);
    expect(LL!.end).toBe(LL_END);
    expect(LL!.detect).toBe('# ── BEGIN GENERATED LOG-LINE REDACTOR');
    expect(LL!.label).toBe('log-line redactor');
    expect(LL!.file).toBe('ccd/ccrc');
    expect(movedCcrc).not.toBe(ccrc);
  });

  it('renders ccd/ccrc\'s whole _upd_redact plus a newline, stamped and verifying, and never reads the hook', () => {
    expect(LL, 'the engine carries a log-line row').toBeDefined();
    const r = renderRegion(LL!, ccrc);
    expect(r).toBe(byHand(ccrc));
    const inner = r.slice(LL_BEGIN.length + 1, r.length - LL_END.length - 1);
    expect(inner.split('\n')[0]).toMatch(/^# ccrc:generated 1 sha256=[0-9a-f]{64}$/);
    expect(verifyMarker(inner)).toBe('ccrc-unmodified');
    expect(inner.split('\n').slice(1).join('\n')).toBe(`${upd}\n`);
    expect(renderRegion(LL!, ccrc, hook)).toBe(renderRegion(LL!, ccrc));
  });

  it('over a planted target, a hand edit reads edited, a change to ccrc\'s _upd_redact reads stale, and applyRegion brings it back', () => {
    expect(LL, 'the engine carries a log-line row').toBeDefined();
    const target = SYNC_SHAPE(byHand(ccrc));
    expect(regionOf(target)).toBe(LL);
    expect(checkRegion(LL!, target, ccrc)).toBe('current');
    const edited = target.replace('home="${home%/}"', 'home="${home}"');
    expect(edited).not.toBe(target);
    expect(checkRegion(LL!, edited, ccrc)).toBe('edited');
    expect(checkRegion(LL!, target, movedCcrc)).toBe('stale');
    expect(checkRegion(LL!, applyRegion(LL!, edited, ccrc), ccrc)).toBe('current');
    expect(applyRegion(LL!, edited, ccrc)).toBe(target);
    expect(checkRegion(LL!, applyRegion(LL!, target, movedCcrc), movedCcrc)).toBe('current');
  });

  it('--region-files ends the log-line row with ccd/ccrc, and --regions has a fourth two-column row', () => {
    const files = cli('--region-files');
    expect(files.code, files.stderr).toBe(0);
    expect(files.stdout.split('\n')).toContain('# ── BEGIN GENERATED LOG-LINE REDACTOR\tlog-line redactor\tccd/ccrc');
    const two = cli('--regions');
    expect(two.code).toBe(0);
    expect(two.stdout.split('\n').filter((l) => l !== '')).toHaveLength(4);
    expect(two.stdout.split('\n')).toContain('# ── BEGIN GENERATED LOG-LINE REDACTOR\tlog-line redactor');
  });

  it('`ccrc restamp` regenerates the region from the tree\'s own ccd/ccrc, then --check answers current', () => {
    const t = planted({ 'ccd/ccrc': movedCcrc, 'ccd/ccd-update-sync': SYNC_SHAPE(byHand(ccrc)) });
    const f = join(t, 'ccd/ccd-update-sync');
    const r = restamp(f);
    expect(r.code, r.stderr).toBe(0);
    expect(r.stdout).toContain('log-line redactor regenerated');
    expect(readFileSync(f, 'utf8')).toBe(SYNC_SHAPE(byHand(movedCcrc)));
    const c = spawnSync('node', [join(t, 'shared/hook-helpers.mjs'), '--check', f, join(t, 'ccd/ccrc')], { env: ghContainedEnv(work, { PATH: process.env['PATH'] ?? '' }), encoding: 'utf8' });
    expect(c.stdout.trim()).toBe('hook-helpers: current');
    expect(c.status).toBe(0);
    const again = restamp(f);
    expect(again.code, again.stderr).toBe(0);
    expect(again.stdout).toContain('log-line redactor already current');
  });

  it('renderLogLineBody copies ccd/ccrc\'s _upd_redact and throws on a text without one; the module exports the row\'s lines', () => {
    expect(LOGLINE_REGION_BEGIN).toBe(LL_BEGIN);
    expect(LOGLINE_REGION_END).toBe(LL_END);
    expect(renderLogLineBody(ccrc)).toBe(`${upd}\n`);
    expect(() => renderLogLineBody(ccd)).toThrow('ccd/ccrc has no _upd_redact to copy');
  });

  it('`ccrc restamp` over a tree without ccd/ccrc refuses, naming it, and writes nothing', () => {
    const t = planted({ 'ccd/ccd-update-sync': SYNC_SHAPE(byHand(ccrc).replace('home="${home%/}"', 'home="${home}"')) });
    const f = join(t, 'ccd/ccd-update-sync');
    const before = readFileSync(f);
    const r = restamp(f);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain(`carries generated log-line redactor, but its own tree lacks ${t}/ccd/../shared/hook-helpers.mjs or ${t}/ccd/ccrc;`);
    expect(r.stderr).toContain('Nothing was written');
    expect(readFileSync(f)).toEqual(before);
  });
});

// C5i: the shipped ccd/ccd-update-sync carries the log-line region, current against ccd/ccrc, after its `set +x` and
// `export LC_ALL=C`, with nothing but comments between it and `say`. Each row finds the region by its BEGIN line and
// asserts that line is there before it compares positions, so an absent region reds on that assertion.
describe('ccd/ccd-update-sync carries the log-line region (C5i)', () => {
  const MODULE = path.join(root, 'shared/hook-helpers.mjs');
  const work = mkTmp('hook-helpers-c5i-sync-');
  const sync = read('ccd/ccd-update-sync');
  const LL = REGIONS.find((r) => (r.name as string) === 'log-line');
  const beginAt = (): number => {
    const at = sync.indexOf(`\n${LL_BEGIN}\n`);
    expect(at, 'ccd-update-sync carries the log-line BEGIN line').toBeGreaterThanOrEqual(0);
    expect(sync.split(LL_BEGIN.slice(0, 40)).length - 1, 'exactly one log-line BEGIN line').toBe(1);
    return at + 1;
  };

  it('is current against ccd/ccrc, and no _upd_redact is defined outside it (a later definition would win)', () => {
    beginAt();
    expect(LL, 'the engine carries a log-line row').toBeDefined();
    expect(regionOf(sync)).toBe(LL);
    expect(checkRegion(LL!, sync, ccrc)).toBe('current');
    const rest = sync.replace(extractRegion(LL!, sync)!, '');
    expect(rest).not.toMatch(/(?:^|[\s;&|(){}])(?:function\s+_upd_redact\b|_upd_redact\s*\(\s*\))/m);
    expect(rest).not.toMatch(/^\s*(?:alias|eval|source|\.)\s[^\n]*_upd_redact/m);
  });

  it('--check ccd/ccd-update-sync ccd/ccrc answers current', () => {
    const r = spawnSync('node', [MODULE, '--check', path.join(root, 'ccd/ccd-update-sync'), path.join(root, 'ccd/ccrc')],
      { env: ghContainedEnv(work, { PATH: process.env['PATH'] ?? '' }), encoding: 'utf8' });
    expect(r.stdout.trim(), r.stderr).toBe('hook-helpers: current');
    expect(r.status).toBe(0);
  });

  it('sits after `export LC_ALL=C`, with only blank or comment lines between its END line and `say() {`', () => {
    const at = beginAt();
    const lc = sync.indexOf('\nexport LC_ALL=C\n');
    expect(lc, 'ccd-update-sync exports LC_ALL=C at its top level').toBeGreaterThanOrEqual(0);
    expect(at).toBeGreaterThan(lc);
    const end = sync.indexOf(`\n${LL_END}\n`, at);
    expect(end, 'the region has its END line').toBeGreaterThan(at);
    const say = sync.indexOf('\nsay() {', end);
    expect(say, 'say() is defined after the region').toBeGreaterThan(end);
    const between = sync.slice(end + LL_END.length + 2, say + 1).split('\n').filter((l) => l !== '');
    for (const l of between) expect(l, 'only comments between the region and say').toMatch(/^\s*#/);
  });

  it('lies after `set +x`, the file\'s first line of code', () => {
    const at = beginAt();
    const lines = sync.split('\n');
    const first = lines.findIndex((l, i) => i > 0 && l.trim() !== '' && !/^\s*#/.test(l));
    expect(lines[first]!.replace(/\s+#.*$/, ''), 'the first line of code').toBe('set +x');
    expect(at).toBeGreaterThan(lines.slice(0, first + 1).join('\n').length);
  });
});

// C5i: the CLI's identity check. `--write`, `--check` and `--restamp` compare the given file's basename with the
// basename of the target row's `file` once, before any render or write; a mismatch exits 2 with one sentence and writes
// nothing. By basename, because `_restamp_hook_note` passes a file it only knows is named `ccd`. Each row compares
// the target's bytes before and after, so a check that runs after the write still reds.
describe('the engine refuses a given file that is not the target row\'s (C5i)', () => {
  const MODULE = path.join(root, 'shared/hook-helpers.mjs');
  const work = mkTmp('hook-helpers-c5i-identity-');
  const cli = (...args: string[]): { code: number; stdout: string; stderr: string } => {
    const r = spawnSync('node', [MODULE, ...args], { env: ghContainedEnv(work, { PATH: process.env['PATH'] ?? '' }), encoding: 'utf8' });
    return { code: r.status ?? -1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
  };
  const refusal = (target: string, label: string, file: string, given: string): string =>
    `hook-helpers: ${target} carries the ${label} region, whose file is ${file}; ${given} is not that file\n`;
  const at = (f: string): string => path.join(root, f);
  /** The hook with one line added inside its generated region. */
  const handEditedHook = (): string => {
    const edited = hook.replace(`${HOOK_REGION_BEGIN}\n`, `${HOOK_REGION_BEGIN}\n# a hand edit\n`);
    expect(edited).not.toBe(hook);
    return edited;
  };
  const expectRefused = (r: { code: number; stdout: string; stderr: string }, sentence: string): void => {
    expect(r.stderr).toBe(sentence);
    expect(r.stdout).toBe('');
    expect(r.code).toBe(2);
  };

  it('--check ccd/session-hook.sh ccd/ccrc is refused: the hook region is given ccd', () => {
    const before = readFileSync(at('ccd/session-hook.sh'));
    expectRefused(cli('--check', at('ccd/session-hook.sh'), at('ccd/ccrc')), refusal(at('ccd/session-hook.sh'), 'hook helpers', 'ccd/ccd', at('ccd/ccrc')));
    expect(readFileSync(at('ccd/session-hook.sh'))).toEqual(before);
  });

  it('--check ccd/ccrc-api ccd/session-hook.sh is refused: the server-cap region is given ccd, not the hook', () => {
    const before = readFileSync(at('ccd/ccrc-api'));
    expectRefused(cli('--check', at('ccd/ccrc-api'), at('ccd/session-hook.sh')),
      refusal(at('ccd/ccrc-api'), 'server-cap reader', 'ccd/ccd', at('ccd/session-hook.sh')));
    expect(readFileSync(at('ccd/ccrc-api'))).toEqual(before);
  });

  it('--write <hand-edited hook copy> ccd/ccrc is refused and leaves the copy\'s bytes', () => {
    const copy = join(mkTmp('hook-helpers-c5i-write-'), 'session-hook.sh');
    writeFileSync(copy, handEditedHook());
    const before = readFileSync(copy);
    expectRefused(cli('--write', copy, at('ccd/ccrc')), refusal(copy, 'hook helpers', 'ccd/ccd', at('ccd/ccrc')));
    expect(readFileSync(copy)).toEqual(before);
  });

  it('--restamp <log-line target> <a ccd that defines _upd_redact> is refused and leaves the target\'s bytes', () => {
    const t = mkTmp('hook-helpers-c5i-restamp-');
    mkdirSync(join(t, 'ccd'));
    const sync = read('ccd/ccd-update-sync');
    const inRegion = sync.indexOf(`\n${LL_BEGIN}\n`);
    expect(inRegion, 'the shipped ccd-update-sync carries the log-line region').toBeGreaterThanOrEqual(0);
    const edited = sync.slice(0, inRegion) + sync.slice(inRegion).replace('home="${home%/}"', 'home="${home}"');
    expect(edited).not.toBe(sync);
    const f = join(t, 'ccd/ccd-update-sync');
    writeFileSync(f, edited);
    writeFileSync(join(t, 'ccd/ccd'), `${ccd}${ccdFunctionDefinition(ccrc, '_upd_redact')!}\n`);
    const before = readFileSync(f);
    expectRefused(cli('--restamp', f, join(t, 'ccd/ccd')), refusal(f, 'log-line redactor', 'ccd/ccrc', join(t, 'ccd/ccd')));
    expect(readFileSync(f)).toEqual(before);
  });

  it('the usage line names <file> and --region-files', () => {
    const r = cli('--check');
    expect(r.stderr).toBe('usage: node shared/hook-helpers.mjs --write|--check|--restamp <target> <file> | --regions | --region-files\n');
    expect(r.code).toBe(2);
  });

  it('keep-green: a given file of the row\'s basename passes, and --write over a hand-edited hook given ccd/ccd regenerates it', () => {
    const a = cli('--check', at('ccd/ccrc-api'), at('ccd/ccd'));
    expect(a.stdout.trim()).toBe('hook-helpers: current');
    expect(a.code).toBe(0);
    const b = cli('--check', at('ccd/ccd-update-sync'), at('ccd/ccrc'));
    expect(b.stdout.trim()).toBe('hook-helpers: current');
    expect(b.code).toBe(0);
    const copy = join(mkTmp('hook-helpers-c5i-write-'), 'session-hook.sh');
    writeFileSync(copy, handEditedHook());
    const w = cli('--write', copy, at('ccd/ccd'));
    expect(w.stdout.trim(), w.stderr).toBe('hook-helpers: regenerated');
    expect(w.code).toBe(0);
    expect(readFileSync(copy, 'utf8')).toBe(hook);
  });
});
