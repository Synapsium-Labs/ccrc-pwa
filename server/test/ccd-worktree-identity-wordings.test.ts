// Path identity W3 (PI7 P1, R16): the rows rung's wordings are true (path-identity spec §4.8).
// - Its two `//` remedies asked the operator to "re-point" a link. Replacing a link is how a spelling is moved off the
//   tree a session entered, so a hold must never invite it. Both now say: restore the link to its original target, or
//   stop the session and purge its row; never replace a link to clear this.
// - Its `..` detail said a `..` "follows a directory that no longer exists, or cannot otherwise be placed", which reads
//   as "outside"; but a pane that entered through that `..` while its path stood still works in the tree it named,
//   which may be this child. It now says the `..` could not be walked the way that session's own `cd` walked it, so
//   where it leads was never placed, even if it names this child.
// - The fail-shut order that makes such a row unresolvable is kept: `_ws_reclaim_resolve` refuses a `..` in the
//   unresolved rest BEFORE it re-walks a `..` in the entered head (the reverse order was reverted after a measured
//   bypass). It is pinned here by source.
// The pinned prefixes elsewhere (`ccd-child-reclaim-hardening`, `ccd-child-reclaim-verb-tail`, and
// `ccd-child-reclaim-ladder`'s `UNPLACED`) end before each remedy, so they stand unedited.
// FIXTURE HOME ONLY (`makePrHarness`): every child, row and link lives under the harness's HOME, and ccd runs as
// sourced functions. No case runs a verb or a tail, so nothing here walks `/proc`. Every spelling holding `..` is built
// by concatenation: `path.join` would normalise away the very input under test.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { makePrHarness, type PrHarness } from './ccdPrHelpers.js';
import { ccdSource } from './ccdWsHelpers.js';
import { CHILD_ID, evalOf, makeChild, type Child } from './childReclaimFixture.js';

let h: PrHarness;
beforeEach(() => { h = makePrHarness('ccrc-worktree-identity-wordings-'); });
afterEach(() => { h.cleanup(); });

/** Remedy 1: the child's OWN workdir resolves to `//` (`_ws_reclaim_workdir_shared`'s `minewhy`). */
const REMEDY_1 = '— restore the link whose target opens with // to its original target, or stop the session and purge its'
  + ' row; never replace a link to clear this';
/** Remedy 2: another row names no plain absolute workdir, or one that resolves to `//` (the `unplaced` clause). */
const REMEDY_2 = '— stop and restart each (ccd start <id> stores a plain absolute workdir), restore a link whose target opens'
  + ' with // to its original target, or stop that session and purge its row; never replace a link to clear this';
const UNPLACED = 'name no plain absolute workdir, or one that resolves to a path opening with //, so ccd cannot place them'
  + ' against this child';
const DOTDOT_CLAUSE = 'a \'..\' in it could not be walked the way that session\'s own cd walked it (it follows a directory that'
  + ' does not exist now, or a path ccd could not enter logically), so where it leads was never placed, even if it names this child';
const OLD_DOTDOT = 'a \'..\' in it follows a directory that no longer exists, or cannot otherwise be placed';
const UNRESOLVED = 'name a workdir that cannot be resolved completely (a directory or link on its path cannot be entered'
  + ' or followed, or no longer exists, so its spelling no longer says where that session lives;'
  + ` ${DOTDOT_CLAUSE}; or it holds a control character), so ccd cannot place them against this child`;

/** A registry row of another session, naming `workdir`, with no entry field (a legacy row). */
const otherRowOf = (id: string, workdir: string): void => {
  fs.writeFileSync(path.join(h.home, '.cc-sessions', `${id}.uuid`), `u-${id}`);
  fs.writeFileSync(path.join(h.home, '.cc-sessions', `${id}.workdir`), workdir);
};

/** `$HOME/worktrees` moved to `$HOME/wtreal` and replaced by a link whose target opens with `//`, so the child's own
 *  workdir resolves to a `//` spelling wherever bash's `pwd -P` keeps it (Linux, measured). Answers whether the
 *  rung's resolver kept it: read, never assumed. */
const relinkChild = (c: Child): boolean => {
  fs.renameSync(path.join(h.home, 'worktrees'), path.join(h.home, 'wtreal'));
  fs.symlinkSync(`/${path.join(h.home, 'wtreal')}`, path.join(h.home, 'worktrees'));
  return h.sh(`_ws_reclaim_resolve "${c.wt}"; printf '%s' "$_WS_RESOLVED"`).startsWith('//');
};

/** `$HOME/lnk -> $HOME/elsewhere/sub`, with `$HOME/elsewhere/gone` standing: below `lnk/..` the kernel's walk continues
 *  in `elsewhere`, and a logical `cd` in `$HOME` (`ccd-child-reclaim-ladder.test.ts`'s shape). */
const plantLinkedPrefix = (): void => {
  fs.mkdirSync(path.join(h.home, 'elsewhere', 'sub'), { recursive: true });
  fs.mkdirSync(path.join(h.home, 'elsewhere', 'gone'));
  fs.symlinkSync(path.join(h.home, 'elsewhere', 'sub'), path.join(h.home, 'lnk'));
};

/** The two ways a `..` row stops resolving once `$HOME/gone` goes, one per refusal path of `_ws_reclaim_resolve`. */
const DOTDOT_SHAPES: ReadonlyArray<[string, (c: Child) => string]> = [
  ['`$HOME/gone/../<child>`: the unresolved rest holds a `..` below a directory that is gone',
    (c) => `${h.home}/gone/../${path.relative(h.home, c.wt)}`],
  ['`<lnk>/../gone/../<child>`: the logical entry of the head cannot be made',
    (c) => { plantLinkedPrefix(); return `${h.home}/lnk/../gone/../${path.relative(h.home, c.wt)}`; }],
];

/** A shell function's text, from `NAME() {` to the first line that is `}` alone; '' when there is none
 *  (`path-identity-w2-prose.test.ts`'s helper). */
function shFunction(src: string, name: string): string {
  const at = src.indexOf(`\n${name}() {`);
  if (at < 0) return '';
  const end = src.indexOf('\n}\n', at + 1);
  return end < 0 ? '' : src.slice(at + 1, end + 2);
}

/** A function's code. Its first line (the name and its header comment) is dropped, and so is every blank line and
 *  every whole-line `#` comment. Each remaining line's trailing ` #` comment is cut. */
function codeLines(fn: string): string[] {
  return fn.split('\n').slice(1).map((l) => l.split(' #')[0])
    .filter((l) => l.trim() !== '' && !l.trimStart().startsWith('#'));
}

const occurrences = (hay: string, needle: string): number => hay.split(needle).length - 1;

describe('the `//` remedies say restore a link, never re-point one (path-identity spec §4.8, R16)', () => {
  it('a row spelled `//`: unplaced, and its remedy says restore the link or stop that session and purge its row', () => {
    makeChild(h);
    fs.mkdirSync(path.join(h.home, 'elsewhere'));
    expect(evalOf(h).verdict, 'the CONTROL: without the row').toBe('reclaimable');
    const row = `/${path.join(h.home, 'elsewhere')}`;
    otherRowOf('demo-dsrow', row);
    const r = evalOf(h);
    expect(r.verdict, r.detail).toBe('unmeasured');
    expect(r.token).toBe('');
    expect(r.detail).toContain(`registry row(s) demo-dsrow ${UNPLACED} ${REMEDY_2}`);
    expect(r.detail, 'no remedy invites re-pointing').not.toContain('re-point');
    expect(r.detail, 'the value is never printed').not.toContain(row);
  }, 60_000);

  it('a CHILD whose own workdir resolves to `//`: another row cannot be placed, and the remedy says restore the link', (ctx) => {
    const c = makeChild(h);
    fs.mkdirSync(path.join(h.home, 'elsewhere'));
    const kept = relinkChild(c);
    if (process.platform !== 'darwin') expect(kept, 'the CONTROL: bash keeps the link target’s leading `//` here').toBe(true);
    if (!kept) { ctx.skip(); return; }
    otherRowOf('demo-outside', path.join(h.home, 'elsewhere'));
    const r = evalOf(h);
    expect(r.verdict, r.detail).toBe('unmeasured');
    expect(r.token).toBe('');
    expect(r.detail).toContain(`registry row(s) demo-outside cannot be placed against this child: ${CHILD_ID}'s own workdir`
      + ` resolves to a path opening with //, so ccd cannot compare another row with it ${REMEDY_1}`);
    expect(r.detail, 'no remedy invites re-pointing').not.toContain('re-point');
  }, 60_000);
});

describe('the `..` detail is true of a row that is the child (path-identity spec §4.8, R16)', () => {
  it.each(DOTDOT_SHAPES)('%s: while `gone` stands the row IS the child (the CONTROL); once it goes, unmeasured, and the detail says where it leads was never placed', (_what, spell) => {
    const c = makeChild(h);
    fs.mkdirSync(path.join(h.home, 'gone'));
    const raw = spell(c);
    otherRowOf('demo-dotdot', raw);
    const shared = evalOf(h);
    expect(shared.verdict, `the CONTROL: with \`gone\` standing the row resolves to the child — ${shared.detail}`).toBe('containment-unproven');
    expect(shared.detail).toContain('is also named by registry row(s) demo-dotdot');
    fs.rmdirSync(path.join(h.home, 'gone'));
    const r = evalOf(h);
    expect(r.token, `the evaluation minted a destructive token — ${r.verdict}: ${r.detail}`).toBe('');
    expect(r.verdict, r.detail).toBe('unmeasured');
    expect(r.detail).toContain(`registry row(s) demo-dotdot ${UNRESOLVED}`);
    expect(r.detail, 'the old sentence is gone').not.toContain(OLD_DOTDOT);
    expect(r.detail, 'the value is never printed').not.toContain('gone/..');
  }, 60_000);
});

describe('the source: no remedy invites re-pointing, and the fail-shut order stands (path-identity spec §4.8)', () => {
  it('`_ws_reclaim_workdir_shared`’s code says "re-point" nowhere, and each new wording exactly once', () => {
    const fn = shFunction(ccdSource(), '_ws_reclaim_workdir_shared');
    expect(fn, 'the CONTROL: the rung is found').not.toBe('');
    const code = codeLines(fn).join('\n');
    expect(code).not.toContain('re-point');
    expect(occurrences(code, REMEDY_1), 'remedy 1').toBe(1);
    expect(occurrences(code, REMEDY_2), 'remedy 2').toBe(1);
    expect(occurrences(code, 'never replace a link to clear this'), 'both remedies, and no third').toBe(2);
    expect(occurrences(code, DOTDOT_CLAUSE), 'the `..` detail').toBe(1);
    expect(code, 'the old `..` sentence').not.toContain(OLD_DOTDOT);
  });

  it('`_ws_reclaim_resolve` refuses a `..` in the unresolved rest BEFORE it re-walks one in the entered head', () => {
    const code = codeLines(shFunction(ccdSource(), '_ws_reclaim_resolve')).map((l) => l.trim());
    const rest = code.indexOf('case "/$rest/" in */../*) return 1 ;; esac');
    const head = code.findIndex((l) => l.startsWith('case "/$head/" in */../*) _ws_reclaim_resolve '));
    expect(rest, 'the rest’s refusal stands').toBeGreaterThanOrEqual(0);
    expect(head, 'the head’s re-walk stands').toBeGreaterThanOrEqual(0);
    expect(head, 'the rest is refused first').toBeGreaterThan(rest);
    expect(code.filter((l) => l.includes('*/../*)')), 'exactly those two `..` tests').toHaveLength(2);
  });
});
