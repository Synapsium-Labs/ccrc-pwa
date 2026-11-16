// ARCH-74 (#809), K18: characterization of the session hook's already-identical helpers and constants, written green
// against the hand-copied code BEFORE they are generated. It pins what the generation must not change: the values
// of the three constants the hook spells, the behaviour of `_hook_epoch_ms`, and the two `_launchd_class` bodies.
// The hook's compaction-lock region is not pinned here: it differs from ccd's on purpose and is not generated.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (f: string): string => readFileSync(path.join(root, f), 'utf8');
const hook = read('ccd/session-hook.sh');
const ccd = read('ccd/ccd');
const ccrc = read('ccd/ccrc');

const fnBody = (src: string, name: string): string => {
  const m = new RegExp(`^${name}\\(\\) \\{[^\\n]*\\n([\\s\\S]*?)\\n\\}$`, 'm').exec(src);
  expect(m, `${name} must be findable`).not.toBeNull();
  return m![1]!;
};

describe('the hook\'s constants', () => {
  it('spells the project class, the project bound and the id bound at these values', () => {
    expect(hook).toMatch(/^CCRC_PROJ_CLASS='A-Za-z0-9\._-'$/m);
    expect(hook).toMatch(/^CCRC_PROJ_MAX=64$/m);
    expect(hook).toMatch(/^CCRC_ID_MAX=128$/m);
  });
});

describe('_hook_epoch_ms', () => {
  const run = (pre: string): string => {
    const script = `${hook.match(/^_hook_epoch_ms\(\) \{\n[\s\S]*?\n\}\n/m)![0]}\n${pre}\n_hook_epoch_ms`;
    return spawnSync('bash', ['-c', script], { encoding: 'utf8', env: { PATH: process.env.PATH ?? '' } }).stdout;
  };
  it('answers 13 digits from EPOCHREALTIME and from the date fallback alike', () => {
    expect(run(':')).toMatch(/^[0-9]{13}$/);
    expect(run('unset EPOCHREALTIME')).toMatch(/^[0-9]{13}$/);
  });
  it('has the same body as ccd\'s _plat_epoch_ms', () => {
    expect(fnBody(hook, '_hook_epoch_ms')).toBe(fnBody(ccd, '_plat_epoch_ms'));
  });
  it('slices a planted reading into seconds and the first three fraction digits, dot or comma', () => {
    // `unset` strips the dynamic builtin, so the planted value is a plain variable that holds still.
    expect(run('unset EPOCHREALTIME; EPOCHREALTIME=1700000000.999999')).toBe('1700000000999');
    expect(run('unset EPOCHREALTIME; EPOCHREALTIME=1700000000,5')).toBe('1700000000500');
  });
});

// Every expansion of `EPOCHREALTIME` reads the clock anew. Seconds from one expansion and the fraction from another
// can straddle a second boundary and answer about 1000 ms in the past: measured under CPU load, about 4 in 10,000
// two-read calls ran backwards by 992-999 ms, and none in 10,059 one-read calls. The session hook's approval wait took
// such a reading as its deadline (`waitS` 1), found `now < deadline` false before its first poll and ended silently
// with no ruling read. A trap cannot step the clock between two expansions inside one command, so this pins the shape:
// the branch reads the variable once into a local and splits only that local.
describe('the epoch helpers read EPOCHREALTIME once', () => {
  const branch = (src: string, name: string): string => {
    const m = /if \[ -n "\$\{EPOCHREALTIME:-\}" \]; then\n([\s\S]*?)\n\s*fi\n/.exec(fnBody(src, name));
    expect(m, `${name} must keep its EPOCHREALTIME branch`).not.toBeNull();
    return m![1]!;
  };
  it.each([
    ['ccd/ccd', ccd, '_plat_epoch_ms'],
    ['ccd/ccrc', ccrc, '_plat_epoch_ms'],
    ['ccd/session-hook.sh', hook, '_hook_epoch_ms'],
  ] as const)('%s: the branch expands EPOCHREALTIME exactly once, into a local it then splits', (_f, src, name) => {
    const code = branch(src, name);
    expect(code.match(/\$\{?EPOCHREALTIME\b/g) ?? [], 'each expansion is a separate clock read').toHaveLength(1);
    expect(code).toMatch(/^\s*local e="\$EPOCHREALTIME" s f; s="\$\{e%%\[\.,\]\*\}" f="\$\{e#\*\[\.,\]\}"$/m);
  });
  it('ccrc carries ccd\'s body', () => {
    expect(fnBody(ccrc, '_plat_epoch_ms')).toBe(fnBody(ccd, '_plat_epoch_ms'));
  });
});

describe('_launchd_class', () => {
  it('is spelled byte for byte the same in ccd and ccrc', () => {
    expect(fnBody(ccd, '_launchd_class')).toBe(fnBody(ccrc, '_launchd_class'));
  });
});
