// Single-definition scanners, one area of the guard that used to be one file (see ./helpers.ts for the doctrine and the shared walkers).
//
// THE ROSTER CARD HAS ONE BUILDER (durability D4, #757; its wake arm R-5a, D-8201; the worktree-economy spec: "No second
// roster builder is added. The card text gets one shared builder, and the hook and the wake path both call it"). The
// builder is `roster_card` in `ccd/lib/roster-card.jq`; the session hook reaches it through ONE function,
// `_hook_roster_card`, which both of its callers (the SessionStart arm and the wake arm) call.
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { ALL, ALL_MJS, BASH, ccrcRoot, codeLines, rel } from './helpers.js';

/** Every jq program file under ccd/ (a jq module is neither bash nor TypeScript, so no other walker sees it). */
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
const JQ = jqUnder(path.join(ccrcRoot, 'ccd'));
/** Code lines only: a `#` comment in bash or jq, a `//` or `*` comment in TS and mjs, is a sentence ABOUT the card. */
const code = (f: string): string[] =>
  (f.endsWith('.ts') || f.endsWith('.tsx') || f.endsWith('.mjs') ? readFileSync(f, 'utf8').split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
    : codeLines(f));
const CORPUS = [...new Set([...BASH, ...JQ, ...ALL, ...ALL_MJS])];
const holders = (needle: string | RegExp): string[] =>
  CORPUS.filter((f) => code(f).some((l) => (typeof needle === 'string' ? l.includes(needle) : needle.test(l)))).map(rel).sort();

const HOOK = path.join(ccrcRoot, 'ccd', 'session-hook.sh');
const hookCode = (): string[] => code(HOOK);

describe('the roster card has one builder (D4, R-5a, D-8201)', () => {
  it('CONTROL: the corpus holds the hook, the builder and the TypeScript sources', () => {
    const r = CORPUS.map(rel);
    expect(r).toContain('ccd/session-hook.sh');
    expect(r).toContain('ccd/lib/roster-card.jq');
    expect(r).toContain('ccd/lib/transcript.jq');
    expect(r).toContain('server/src/watch.ts');
  });

  it('the card\'s text is spelled in exactly one file: its header, its run line and its awaiting-you line', () => {
    expect(holders('open run(s) you claim')).toEqual(['ccd/lib/roster-card.jq']);
    expect(holders('awaiting you: ')).toEqual(['ccd/lib/roster-card.jq']);
    expect(holders('more open runs: ccrc-api runs list')).toEqual(['ccd/lib/roster-card.jq']);
  });

  it('`roster_card` is defined once, and the hook loads it at exactly one site', () => {
    expect(holders(/\bdef roster_card\(/)).toEqual(['ccd/lib/roster-card.jq']);
    expect(holders(/(?<![_A-Za-z])roster_card\(/)).toEqual(['ccd/lib/roster-card.jq', 'ccd/session-hook.sh']);
    expect(hookCode().filter((l) => /(?<![_A-Za-z])roster_card\(/.test(l)), 'one jq call in the hook').toHaveLength(1);
    expect(hookCode().filter((l) => l.includes('include "roster-card"'))).toHaveLength(1);
  });

  it('the hook has one card function, and both callers go through it', () => {
    const lines = hookCode();
    expect(lines.filter((l) => /^\s*_hook_roster_card\(\)\s*\{/.test(l)), 'defined once').toHaveLength(1);
    const calls = lines.filter((l) => /\b_hook_roster_card\s+(?:"\$src"|wake)(?:\s|$)/.test(l));
    expect(calls, 'the SessionStart arm and the wake arm').toHaveLength(2);
    expect(lines.filter((l) => /\b_hook_roster_card\b/.test(l) && !/^\s*_hook_roster_card\(\)/.test(l)), 'no third caller')
      .toHaveLength(2);
  });

  it('the card\'s eligibility rule is spelled once in the hook', () => {
    const lines = hookCode();
    expect(lines.filter((l) => /^\s*_hook_roster_eligible\(\)\s*\{/.test(l))).toHaveLength(1);
    // The child test that silences the card lives in the eligibility function, not again in either caller.
    const body = readFileSync(HOOK, 'utf8');
    const fn = body.slice(body.indexOf('_hook_roster_card() {'), body.indexOf('\n}\n', body.indexOf('_hook_roster_card() {')));
    expect(fn).toContain('_hook_roster_eligible || return 0');
    expect(fn).not.toContain('.child');
  });

  it('the switch is read at one site: the marker test lives in the card function alone', () => {
    expect(hookCode().filter((l) => l.includes('coordinator-roster-card-live'))).toHaveLength(1);
    // The shadow log has one writer on the box (shared/switches.ts names it in its `default` sentence, which is prose).
    expect(BASH.filter((f) => codeLines(f).some((l) => l.includes('roster-card-shadow.log'))).map(rel)).toEqual(['ccd/session-hook.sh']);
  });
});
