// The hand-kept skill-name sites, read once for every suite that holds a relation between the skill trees they name
// (Overlord W1, Task 3). Before this file, install-history-skill.test.ts and install-linear-skill.test.ts each carried
// their own copy of this harness; each now reads it from here with its own pair.
//
// A site is a function body of `ccd/ccrc` or `ccd/ccrc-doctor-checks`, or deploy.sh's agent arm. Comment lines are
// dropped, because a site is what it runs. The four spellings (FORMS) are the four the sites use.
import fs from 'node:fs';
import path from 'node:path';

const REPO = path.resolve(__dirname, '../..');
const read = (rel: string): string => fs.readFileSync(path.join(REPO, rel), 'utf8');

/** One bash function's body, defined at column 0 of a file. */
export function fnBody(rel: string, name: string): string {
  const m = new RegExp(`\\n${name}\\(\\) \\{[^\\n]*\\n([\\s\\S]*?)\\n\\}\\n`).exec(read(rel));
  if (!m) throw new Error(`${rel} has no ${name}() defined at column 0`);
  return m[1]!;
}

/** deploy.sh's agent arm, from its `if` to the arm's `else`. */
export function agentArm(): string {
  const d = read('deploy/deploy.sh');
  return d.slice(d.indexOf('if [ "$TARGET" = "agent" ]'), d.indexOf('\nelse\n'));
}

/** Every hand-kept site, by the name a suite's titles use. */
export const SITES: ReadonlyArray<readonly [string, () => string]> = [
  ['ccd/ccrc _acct_provision', () => fnBody('ccd/ccrc', '_acct_provision')],
  ['ccd/ccrc _acct_unprovision', () => fnBody('ccd/ccrc', '_acct_unprovision')],
  ['ccd/ccrc _inst_skills', () => fnBody('ccd/ccrc', '_inst_skills')],
  ['ccd/ccrc _uninst_cc_sessions', () => fnBody('ccd/ccrc', '_uninst_cc_sessions')],
  ['ccd/ccrc-doctor-checks _check_skills', () => fnBody('ccd/ccrc-doctor-checks', '_check_skills')],
  ['ccd/ccrc-doctor-checks _fix_skills', () => fnBody('ccd/ccrc-doctor-checks', '_fix_skills')],
  ['deploy/deploy.sh agent arm', agentArm],
];

export const code = (t: string): string => t.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');

/** Each spelling, and the short names it finds in a site's code. */
export const FORMS: ReadonlyArray<readonly [string, (t: string) => string[]]> = [
  ['install-<x>-skill.sh', (t) => [...t.matchAll(/install-([a-z]+)-skill\.sh/g)].map((m) => m[1]!)],
  ['ccrc-<x>', (t) => [...t.matchAll(/(?<![\w./-])ccrc-([a-z]+)\b/g)].map((m) => m[1]!)],
  ['<x>-skill', (t) => [...t.matchAll(/(?<![\w-])([a-z]+)-skill\b(?![.\w-])/g)].map((m) => m[1]!)],
  ['for name in <x> …', (t) => [...t.matchAll(/\bfor name in ([a-z][a-z ]*); do/g)]
    .flatMap((m) => m[1]!.trim().split(/\s+/))],
];

/** A one-way relation: a site that names every skill of `if` names `then` too. `sameSpelling` (the default) asks it in
 *  every spelling the site names `if` in; without it, in any spelling at all, for a tree that is not on a per-home
 *  list (the staged Overlord skill). */
export interface SitePair { if: readonly string[]; then: string; sites: readonly string[]; sameSpelling?: boolean }

/** The spellings in which a body names every skill of `pair.if`, and those of them that leave out `pair.then`. */
export function siteRelation(body: string, pair: Pick<SitePair, 'if' | 'then' | 'sameSpelling'>): { named: string[]; missing: string[] } {
  const c = code(body);
  const named: string[] = [];
  const missing: string[] = [];
  let anywhere = false;
  for (const [form, names] of FORMS) {
    const got = new Set(names(c));
    if (got.has(pair.then)) anywhere = true;
    if (!pair.if.every((n) => got.has(n))) continue;
    named.push(form);
    if (!got.has(pair.then)) missing.push(form);
  }
  if (pair.sameSpelling === false) return { named, missing: named.length > 0 && !anywhere ? named : [] };
  return { named, missing };
}

/** Every pair, over each of its sites. */
export function namedImpliesNamed(pairs: readonly SitePair[]): Array<{ site: string; pair: SitePair; named: string[]; missing: string[] }> {
  return pairs.flatMap((pair) => pair.sites.map((site) => {
    const reader = SITES.find(([s]) => s === site);
    if (!reader) throw new Error(`no hand-kept site is named ${site}`);
    return { site, pair, ...siteRelation(reader[1](), pair) };
  }));
}
