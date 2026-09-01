// The workspace slug an operator types, or a Linear ticket they paste.
//
// THE BUDGET IS 31, NOT 40. `naming.ts`'s `SLUG_MAX = 40` is the BRANCH budget
// and ccd validates a branch with `_ws_branch_valid`, a different and more
// permissive rule than `_ws_slug_valid`. Reusing 40 here ships names the box
// refuses at `ccd/ccd:3742` — which is why the parity test below reads ccd's
// own regex out of the shipped file rather than trusting either number.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { SLUG_MAX, deriveBranch, slugifyWords, fitSlug } from '../src/naming.js';
import {
  WS_SLUG_MAX, WS_SLUG_MIN, NAME_REFUSALS, NAME_REFUSAL_TEXT,
  parseLinearRef, deriveWorkspaceSlug,
} from '../../shared/slug.js';
// The path to the script is spelled in ONE test file and imported everywhere
// else — `single-definition.test.ts:267` fails the build on a second spelling,
// and it caught this file writing its own. Measured: red before this import.
import { CCD } from './ccdWsHelpers.js';

const ccdSource = readFileSync(CCD, 'utf8');

/**
 * ccd's `_ws_slug_valid` regex, READ OUT OF THE SHIPPED BINARY rather than
 * re-typed here. Same idiom as `wsaudit.test.ts:53-63` and `coord-token.test.ts`'s
 * placeholder tie: the grammar has ONE definition, on the box, and this suite's
 * job is to fail the build when what we generate stops satisfying it — not to
 * hold a second copy that can drift silently.
 */
function ccdSlugPattern(): RegExp {
  const line = ccdSource.split('\n').find((l) => l.startsWith('_ws_slug_valid()'));
  expect(line, '_ws_slug_valid() not found in ccd/ccd — has it been renamed?').toBeDefined();
  const m = /=~\s+(\^\S+\$)\s*\]\]/.exec(line!);
  expect(m, `could not extract a regex from: ${line}`).not.toBeNull();
  return new RegExp(m![1]);
}

describe('the ccd parity pin', () => {
  it('extracts a regex from ccd’s own _ws_slug_valid', () => {
    // Guards the extraction itself: if this stops finding the pattern, every
    // other parity assertion below would vacuously pass.
    const re = ccdSlugPattern();
    expect(re.test('eng-1234')).toBe(true);
    expect(re.test('ENG-1234')).toBe(false);
    expect(re.test('a')).toBe(false);          // {1,30} applies to the SECOND class
    expect(re.test('a'.repeat(31))).toBe(true);
    expect(re.test('a'.repeat(32))).toBe(false);
  });

  it('agrees with our own bounds', () => {
    const re = ccdSlugPattern();
    expect(re.test('a'.repeat(WS_SLUG_MAX))).toBe(true);
    expect(re.test('a'.repeat(WS_SLUG_MAX + 1))).toBe(false);
    expect(re.test('a'.repeat(WS_SLUG_MIN))).toBe(true);
    expect(re.test('a'.repeat(WS_SLUG_MIN - 1))).toBe(false);
    // And the two budgets are NOT the same number. This is the assertion that
    // goes red if someone "tidies" slug.ts to import SLUG_MAX.
    expect(WS_SLUG_MAX).not.toBe(SLUG_MAX);
    expect(WS_SLUG_MAX).toBe(31);
  });
});

describe('parseLinearRef', () => {
  it('reads a bare identifier', () => {
    expect(parseLinearRef('ENG-1234')).toEqual({ key: 'ENG', num: '1234', titleSlug: null });
    expect(parseLinearRef('  eng-1234  ')).toEqual({ key: 'eng', num: '1234', titleSlug: null });
  });

  it('reads the canonical issue URL, with and without the trailing title', () => {
    expect(parseLinearRef('https://linear.app/acme/issue/ENG-1234/fix-the-login-flow'))
      .toEqual({ key: 'ENG', num: '1234', titleSlug: 'fix-the-login-flow' });
    expect(parseLinearRef('https://linear.app/acme/issue/ENG-1234'))
      .toEqual({ key: 'ENG', num: '1234', titleSlug: null });
  });

  it('reads Linear’s own copy-git-branch-name form, title slug and all', () => {
    // `<user>/<KEY-N>-<title>` is ONE CLICK in Linear's UI, so it is the shape
    // an operator pastes most often. Before this it fell through to "a plain
    // name": the slug came out right and the TITLE LOOKUP never fired, so the
    // headline feature silently did nothing for the commonest input.
    expect(parseLinearRef('maciek/eng-1234-fix-login'))
      .toEqual({ key: 'eng', num: '1234', titleSlug: 'fix-login' });
    expect(parseLinearRef('eng-1234-fix-login'))
      .toEqual({ key: 'eng', num: '1234', titleSlug: 'fix-login' });
    // No title segment is still a reference.
    expect(parseLinearRef('maciek/eng-1234'))
      .toEqual({ key: 'eng', num: '1234', titleSlug: null });
  });

  it('is null for anything that is not a Linear reference', () => {
    expect(parseLinearRef('fix the login flow')).toBeNull();
    expect(parseLinearRef('https://github.com/x/y/issues/3')).toBeNull();
    expect(parseLinearRef('https://linear.app/acme/team/ENG/all')).toBeNull();
    expect(parseLinearRef('')).toBeNull();
  });
});

describe('deriveWorkspaceSlug', () => {
  // ── the auto arm: an empty field is a REQUEST, not a mistake ──
  it('an empty field asks for ccd’s own generated name', () => {
    // Load-bearing: the route must then OMIT the argv token entirely. Sending
    // `''` reaches ccd, fails `[[ -n "$slug" ]]`, passes `[[ -z "$slug" ]]`,
    // draws a random adjective-noun and exits 0 — a 200 for a workspace
    // nobody named. `workspaces-route.test.ts` pins the argv half.
    expect(deriveWorkspaceSlug('')).toEqual({ kind: 'auto' });
    expect(deriveWorkspaceSlug('   ')).toEqual({ kind: 'auto' });
  });

  // ── the ticket arms ──
  it('a bare ticket becomes its own slug', () => {
    expect(deriveWorkspaceSlug('ENG-1234')).toEqual({
      kind: 'named', slug: 'eng-1234', shortened: false,
      ticket: { key: 'ENG', num: '1234', titleSlug: null },
    });
  });

  it('a pasted URL keeps the title Linear already put in it', () => {
    expect(deriveWorkspaceSlug('https://linear.app/acme/issue/ENG-1234/fix-the-login-flow'))
      .toMatchObject({ kind: 'named', slug: 'eng-1234-fix-the-login-flow', shortened: false });
  });

  it('a branch-form paste keeps its ticket, so the title lookup can fire', () => {
    expect(deriveWorkspaceSlug('maciek/eng-1234-fix-login')).toMatchObject({
      kind: 'named', slug: 'eng-1234-fix-login',
      ticket: { key: 'eng', num: '1234', titleSlug: 'fix-login' },
    });
  });

  it('takes the tail of Linear’s git-branch form rather than spending 7 characters on a username', () => {
    // `maciek/eng-1234-fix-login` → mapping `/`→`-` would produce
    // `maciek-eng-1234-fix-login` and eat 7 of the 31 characters on somebody's
    // name. The tail is the part that identifies the work.
    expect(deriveWorkspaceSlug('maciek/eng-1234-fix-login'))
      .toMatchObject({ kind: 'named', slug: 'eng-1234-fix-login' });
  });

  it('a plain name is slugified', () => {
    expect(deriveWorkspaceSlug('Fix the login flow'))
      .toEqual({ kind: 'named', slug: 'fix-the-login-flow', shortened: false, ticket: null });
    expect(deriveWorkspaceSlug('a___b...c'))
      .toMatchObject({ kind: 'named', slug: 'a-b-c' });
  });

  // ── EACH REFUSAL ASSERTED SEPARATELY ──
  // A test that only checked "it was refused" would stay GREEN if the three
  // reasons were collapsed into one boolean — which is exactly the overloaded
  // null CLAUDE.md forbids at a seam. These three cases are the mechanism.
  it('refuses a name with nothing usable in it, by that reason', () => {
    expect(deriveWorkspaceSlug('!!!')).toEqual({ kind: 'refused', reason: 'no-usable-characters' });
    expect(deriveWorkspaceSlug('—— ··· ——')).toEqual({ kind: 'refused', reason: 'no-usable-characters' });
  });

  it('refuses a one-character name, by that reason', () => {
    // ccd's undocumented floor, written down for the first time: `{1,30}`
    // applies to the SECOND character class, so a 1-char slug is refused by
    // the box and nothing in ccd-workspaces.test.ts covers it.
    expect(deriveWorkspaceSlug('x')).toEqual({ kind: 'refused', reason: 'too-short' });
    expect(deriveWorkspaceSlug('!a!')).toEqual({ kind: 'refused', reason: 'too-short' });
  });

  it('refuses an unrecognised URL, by that reason — never slugifies it', () => {
    // `https-github-com-x-y-issues-3` would be a legal slug and a terrible
    // name. A URL is a claim about WHERE the work is described; if we cannot
    // read it, we say so.
    expect(deriveWorkspaceSlug('https://github.com/x/y/issues/3'))
      .toEqual({ kind: 'refused', reason: 'url-not-recognised' });
    expect(deriveWorkspaceSlug('https://linear.app/acme/team/ENG/all'))
      .toEqual({ kind: 'refused', reason: 'url-not-recognised' });
  });

  it('every refusal reason has exactly one sentence, and the list is derived', () => {
    // The PR_REASONS idiom: the runtime list comes FROM the type, so a fourth
    // reason cannot ship without its sentence. `single-definition.test.ts`
    // polices the second copy; this polices the missing one.
    expect(NAME_REFUSALS).toEqual(Object.keys(NAME_REFUSAL_TEXT));
    for (const r of NAME_REFUSALS) {
      expect(NAME_REFUSAL_TEXT[r], r).toMatch(/\S/);
    }
  });

  // ── the 31-character budget ──
  it('cuts at a word boundary and says it shortened', () => {
    // 32 characters, so the cut is real and lands mid-word.
    const r = deriveWorkspaceSlug('eng-1234 fix login redirect loop');
    expect(r).toMatchObject({ kind: 'named', shortened: true });
    expect((r as { slug: string }).slug).toBe('eng-1234-fix-login-redirect');
  });

  it('never exceeds the budget, never ends in a dash, and always starts alphanumeric', () => {
    const re = ccdSlugPattern();
    const inputs = [
      'ENG-1234', 'https://linear.app/a/issue/ENG-1234/' + 'word-'.repeat(20),
      'Ünïcødé tïtlé', 'a/b\\c:d', '.lock', 'trailing-', '1234',
      'Refactoringtheauthenticationmiddlewarepipeline',
      'x '.repeat(60), 'ab '.repeat(40), 'ENG-1234 ' + 'y'.repeat(60),
    ];
    for (const i of inputs) {
      const r = deriveWorkspaceSlug(i);
      if (r.kind !== 'named') continue;
      expect(r.slug.length, i).toBeLessThanOrEqual(WS_SLUG_MAX);
      expect(r.slug, i).not.toMatch(/-$/);
      // THE POINT OF THE WHOLE SUITE: whatever we produce, the box accepts.
      expect(r.slug, i).toMatch(re);
    }
  });

  it('a slug can never spell a flag, which is why ccd needs no parse change', () => {
    // `cmd_ws_add`'s strip loop matches --no-rc/--surface/--actor in ANY
    // position (ccd/ccd:3639-3667), so a slug that could begin with `-` would
    // be a live argv-injection seam. Every accepted slug begins [a-z0-9] by
    // construction — ccd makes the same argument for --no-rc at ccd:3635.
    for (const i of ['--no-rc', '-­-surface agent', '--actor x', '-mesa', '---']) {
      const r = deriveWorkspaceSlug(i);
      if (r.kind !== 'named') continue;
      expect(r.slug[0], i).toMatch(/[a-z0-9]/);
    }
  });
});

describe('the extraction out of deriveBranch', () => {
  it('deriveBranch still behaves exactly as it did', () => {
    // The extraction is a refactor, not a behaviour change. naming.test.ts is
    // the full contract; these are the two cases that would catch a slip in
    // the seam itself.
    expect(deriveBranch('Brainstorm Helix and slide notes integration'))
      .toBe('ws/brainstorm-helix-and-slide-notes');
    expect(deriveBranch('!!!')).toBeNull();
  });

  it('slugifyWords and fitSlug are the pieces, and they are shared not copied', () => {
    expect(slugifyWords('Fix the PR sheet')).toBe('fix-the-pr-sheet');
    expect(slugifyWords('!!!')).toBe('');
    expect(fitSlug('abcdefghij', 10)).toEqual({ slug: 'abcdefghij', shortened: false });
    expect(fitSlug('abcde-fghij', 8)).toEqual({ slug: 'abcde', shortened: true });
    // The boundary guard deriveBranch already documents: a cut landing ON a
    // dash drops nothing back.
    expect(fitSlug('abcde-fghij', 5)).toEqual({ slug: 'abcde', shortened: true });
    // No dash at all in the cut — hard-cut rather than emit nothing.
    expect(fitSlug('abcdefghij', 4)).toEqual({ slug: 'abcd', shortened: true });
  });
});
