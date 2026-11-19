// Single-definition scanners, one area of the guard that used to be one file (see ./helpers.ts for the doctrine and the shared walkers).
//
// THE MAIL HOLD'S ARMING MARKERS HAVE NO WRITER IN THE TREE (mid-turn mail plan 2026-11-19, P7 and Task 5.2; spec §3.5
// "Switches"). `$REG/mailhold-notice-live` arms E, the notice line, and `$REG/mailhold-refuse-live` arms A, the refusal;
// the operator touches each by hand on the fleet box (plan §7), as the stall watch's markers went live. So every code
// line that names one is the session hook's read of it, `[[ -e "$REG/<marker>" ]]`, and no other line anywhere, in shell,
// jq, TypeScript or a script, spells it. The fixed texts and the matcher have one home too, `ccd/lib/mail-hold.jq`, which
// the hook loads at one site.
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { ALL, ALL_MJS, BASH, ccrcRoot, codeLines, rel } from './helpers.js';

/** Every jq program file under ccd/: no other walker sees a jq module. */
const jqUnder = (dir: string): string[] => {
  const out: string[] = [];
  if (!existsSync(dir)) return out;
  for (const e of readdirSync(dir)) {
    if (e === 'node_modules') continue;
    const p = path.join(dir, e);
    if (statSync(p).isDirectory()) { out.push(...jqUnder(p)); continue; }
    if (p.endsWith('.jq')) out.push(p);
  }
  return out;
};
/** Code lines only: a `#` comment in bash or jq, a `//` or `*` comment in TS and mjs, is a sentence about a name. */
const code = (f: string): string[] =>
  (/\.(tsx?|mjs)$/.test(f) ? readFileSync(f, 'utf8').split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)) : codeLines(f));
const CORPUS = [...new Set([...BASH, ...jqUnder(path.join(ccrcRoot, 'ccd')), ...ALL, ...ALL_MJS])];
const HOOK = path.join(ccrcRoot, 'ccd', 'session-hook.sh');
const lines = (needle: string): Array<{ file: string; line: string }> =>
  CORPUS.flatMap((f) => code(f).filter((l) => l.includes(needle)).map((line) => ({ file: rel(f), line: line.trim() })));

describe('the mail hold\'s arming markers have no writer in the tree (P7)', () => {
  it('CONTROL: the corpus holds the hook, the module, the TypeScript sources and the scripts', () => {
    const r = CORPUS.map(rel);
    for (const f of ['ccd/session-hook.sh', 'ccd/lib/mail-hold.jq', 'ccd/ccd', 'server/src/watch.ts']) expect(r).toContain(f);
  });

  it.each(['mailhold-notice-live', 'mailhold-refuse-live'])('%s: every code line naming it is the hook\'s one `-e` read', (marker) => {
    const at = lines(marker);
    expect(at, `${marker}: a code line outside the hook's read names it`).toEqual([
      expect.objectContaining({ file: 'ccd/session-hook.sh' }),
    ]);
    const read = `[[ -e "$REG/${marker}" ]]`;
    expect(at[0]!.line.split(read).length - 1, `${marker}: the hook's line reads it once, with -e, and does nothing else with it`).toBe(1);
    expect(at[0]!.line.replace(read, '')).not.toContain(marker);
  });

  it('CONTROL: the read test refuses a writer on the hook\'s line', () => {
    const bad = '[[ -e "$REG/mailhold-notice-live" ]] && a=notice; : > "$REG/mailhold-notice-live"';
    expect(bad.replace('[[ -e "$REG/mailhold-notice-live" ]]', '')).toContain('mailhold-notice-live');
  });
});

describe('the mail hold\'s texts and matcher have one home, loaded at one site', () => {
  it('the fixed texts are spelled in ccd/lib/mail-hold.jq alone', () => {
    for (const t of ['urgent mail is waiting for this session', 'is held because the session you work for has urgent mail waiting',
      'retry only if the act still stands']) {
      expect([...new Set(lines(t).map((x) => x.file))], t).toEqual(['ccd/lib/mail-hold.jq']);
    }
  });
  it('`mail_hold` is defined once, and the hook includes the module at one site', () => {
    expect(lines('def mail_hold(').map((x) => x.file)).toEqual(['ccd/lib/mail-hold.jq']);
    expect(code(HOOK).filter((l) => l.includes('include "mail-hold"'))).toHaveLength(1);
    expect(lines('include "mail-hold"').map((x) => x.file)).toEqual(['ccd/session-hook.sh']);
  });
  it('the shadow log and its seen directory have one writer on the box, the hook', () => {
    expect([...new Set(lines('mail-hold-shadow').map((x) => x.file))]).toEqual(['ccd/session-hook.sh']);
  });
});
