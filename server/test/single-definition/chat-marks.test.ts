// Single-definition scanners, one area of the guard (see ./helpers.ts for the doctrine and the shared walkers).
//
// Chat's recogniser table and its plugin (chat reading at a desk, Task M, D-8060). Each name below is declared in ONE file of
// the four roots, so a second list of status words, a second name grammar or a second marks plugin cannot appear beside the
// first unnoticed: Task L's `linkify` and `refHref`, and Task C's colour rules, all read this one table. Code lines only
// (`stallCode`).
import { describe, expect, it } from 'vitest';
import { ALL, rel, stallCode, stallCodeText } from './helpers.js';

const holders = (re: RegExp): string[] => ALL.filter((f) => re.test(stallCode(f))).map(rel).sort();
const decl = (name: string): RegExp =>
  new RegExp(`\\bfunction\\s+${name}\\b|\\b(?:const|let|var)\\s+${name}\\s*[:=]`);

describe("chat's marks have one recogniser table and one plugin (chat reading Task M, D-8060)", () => {
  it('CONTROL: the pattern sees a declaration and passes over a use and a comment', () => {
    expect(decl('markRuns').test('export function markRuns(text: string): readonly MarkRun[] {')).toBe(true);
    expect(decl('STATUS_WORDS').test('export const STATUS_WORDS: Readonly<Record<StatusTone, readonly string[]>> = {')).toBe(true);
    expect(decl('MARK_ATTR').test('export const MARK_ATTR = {')).toBe(true);
    expect(decl('markRuns').test("import { markRuns } from './chatMarks';")).toBe(false);
    expect(decl('STATUS_WORDS').test('for (const w of STATUS_WORDS.ok) {')).toBe(false);
    expect(stallCodeText('// const STATUS_WORDS = []\nconst x = 1;')).not.toMatch(decl('STATUS_WORDS'));
  });

  it('the grammar, the status words, the subjects, the action lead-ins and the attribute names are declared in chatMarks.ts alone', () => {
    for (const name of [
      'markRuns', 'wholeMark', 'statusTone', 'leadKind', 'leadingStatus', 'STATUS_WORDS', 'STATUS_SUBJECTS', 'ACTION_LEADS',
      'MARK_ATTR',
    ]) {
      expect(holders(decl(name)), name).toEqual(['pwa/src/lib/chatMarks.ts']);
    }
  });

  it('the marks plugin is declared in remarkChatMarks.ts alone', () => {
    expect(holders(decl('remarkChatMarks'))).toEqual(['pwa/src/lib/remarkChatMarks.ts']);
  });

  // Task L (D-8062): the resolver, the console-path decision and the arrival at a row are each declared once, so chat and
  // the ledgers ask one resolver and one path decision, and the accounts screen, the arrival's one caller, asks one arrival.
  it('the resolver, the console-path decision and the arrival are each declared once (chat reading Task L, D-8062)', () => {
    expect(holders(decl('refHref')), 'refHref').toEqual(['pwa/src/lib/chatRefs.ts']);
    expect(holders(decl('routedHref')), 'routedHref').toEqual(['pwa/src/lib/routes.ts']);
    expect(holders(decl('useArrival')), 'useArrival').toEqual(['pwa/src/lib/useArrival.ts']);
  });

  // Desktop polish Task C21 (D-8172; spec R15): which repository a PR or commit name opens is decided by one reader of what a
  // message names and one decider of the session's runs elsewhere, so a second list of file extensions, a second evidence
  // reader or a second repository reader cannot appear beside them unnoticed (review 1760 F12).
  it('the message evidence, the one repository reader and the runs-elsewhere decider are each declared once (Task C21)', () => {
    for (const name of ['FILE_EXTENSIONS', 'messageRepos', 'readRepo', 'qualifiedRepo', 'namesOtherThan']) {
      expect(holders(decl(name)), name).toEqual(['pwa/src/lib/chatRepoEvidence.ts']);
    }
    expect(holders(decl('claimsRunElsewhere')), 'claimsRunElsewhere').toEqual(['pwa/src/lib/chatRefs.ts']);
  });
});
