// Single-definition scanners, one area of the guard that used to be one file (see ./helpers.ts for the doctrine and the shared walkers).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { ARCHIVE_REFUSALS, SWAP_REFUSALS } from '../../../shared/api.js';
import { ALL, BASH, ccrcRoot, codeLines, here, holdersOf, prose, rel, stallCode, stallCodeText } from './helpers.js';


// D-5045 (plan docs/superpowers/plans/2026-10-15-ask-server-half.md, Task 1). APPENDED, for the reason the blocks above
// state: `session-hook.test.ts`'s citation audit cites this file by line. An AskUserQuestion's free-text row is named by
// ONE placeholder rule, in `shared/ask-menu.ts`. `answerDialog`'s guard reads it through `pane/dialog.ts`'s
// `freeTextRow`, and the free-text route (D-5047) and the drawer's menu taps (D-5008) are to import it, never spell it:
// a second spelling that drifts reads the free-text row as an ordinary option, and Enter on it while it is empty
// rejects the whole ask. The structural backstop's "Chat about this" rule shares that home. Code lines only
// (`stallCode`): prose names both rows in quotes. KNOWN WIDTH: a spelling assembled from pieces is not seen.
describe('the free-text row\'s placeholder is spelled once, in shared/ask-menu.ts (D-5045)', () => {
  const PLACEHOLDER = /type\s+something/i;
  const CHAT = /chat\s+about\s+this/i;
  const holders = (re: RegExp): string[] => ALL.filter((f) => re.test(stallCode(f))).map(rel).sort();

  it('CONTROL: the patterns see a regex literal and a string, and pass over comment lines', () => {
    expect(PLACEHOLDER.test('const FREE = /^Type something\\.?$/i;')).toBe(true);
    expect(PLACEHOLDER.test("if (label === 'type something') return 3;")).toBe(true);
    expect(CHAT.test("const CHAT = /chat about this/i;")).toBe(true);
    expect(stallCodeText('// the empty "Type something." row\n * Chat about this\nconst x = 1;')).not.toMatch(PLACEHOLDER);
    expect(stallCodeText('// the empty "Type something." row\n * Chat about this\nconst x = 1;')).not.toMatch(CHAT);
  });

  it('the placeholder is spelled on a code line in shared/ask-menu.ts and nowhere else', () => {
    expect(holders(PLACEHOLDER)).toEqual(['shared/ask-menu.ts']);
  });

  it('the Chat row is spelled in shared/ask-menu.ts and nowhere else: the sheet half deleted its older copy (D-5090)', () => {
    // `DialogSheet.tsx`'s `CHAT_ABOUT_RE` drove the "answer in your own words" path that answered Chat about this and
    // declined the whole ask (diagnosis root cause 5). The sheet half deleted it with `respond()` (D-5090): own words go
    // through the free-text row, and the sheet reads the Chat row through `CHAT_ABOUT_ROW_RE`, as every reader does.
    expect(holders(CHAT)).toEqual(['shared/ask-menu.ts']);
  });

  it('the guard reads the L0 rules: pane/dialog.ts imports and tests both, and answerDialog asks freeTextRow', () => {
    const dialog = stallCode(path.join(ccrcRoot, 'server/src/pane/dialog.ts'));
    for (const name of ['FREE_TEXT_PLACEHOLDER_RE', 'CHAT_ABOUT_ROW_RE']) {
      expect(dialog, `pane/dialog.ts does not import ${name} from L0`)
        .toMatch(new RegExp(`import\\s*\\{[^}]*\\b${name}\\b[^}]*\\}\\s*from\\s*'(?:\\.\\./)+shared/ask-menu\\.js'`));
      expect(dialog, `pane/dialog.ts does not test ${name}`).toMatch(new RegExp(`\\b${name}\\.test\\(`));
    }
    expect(stallCode(path.join(ccrcRoot, 'server/src/inject/send.ts'))).toMatch(/\bfreeTextRow\s*\(/);
  });
  // shared/ask-menu.ts's L0 ring is held by server/test/rings/shared-imports.test.ts (D-6045).
});


// D-5047 (plan docs/superpowers/plans/2026-10-15-ask-server-half.md, Task 3). APPENDED, as the D-5045 block above. The
// free-text route types nothing until the menu's footer shows the external-editor hint ("ctrl+g to edit in Vim"), which
// Claude Code paints while the cursor is on a free-text row. The hint is ONE rule, in `shared/ask-menu.ts`, read through
// `pane/dialog.ts`'s `editHintShown`; D-5048's multiSelect route reads the same predicate. A second spelling that
// drifts would let one route type into a row the other calls unfocused. Code lines only (`stallCode`).
describe('the free-text row\'s edit hint is spelled once, in shared/ask-menu.ts (D-5047)', () => {
  const HINT = /to\s+edit\s+in/i;
  const holders = (): string[] => ALL.filter((f) => HINT.test(stallCode(f))).map(rel).sort();

  it('CONTROL: the pattern sees a regex literal, and passes over comment lines', () => {
    expect(HINT.test('const HINT = /to edit in/;')).toBe(true);
    expect(stallCodeText('// the footer gains "ctrl+g to edit in Vim"\nconst x = 1;')).not.toMatch(HINT);
  });

  it('the hint is spelled on a code line in shared/ask-menu.ts and nowhere else', () => {
    expect(holders()).toEqual(['shared/ask-menu.ts']);
  });

  it('the focus proof reads it: pane/dialog.ts imports and tests the L0 rule, and answerDialogText asks editHintShown', () => {
    const dialog = stallCode(path.join(ccrcRoot, 'server/src/pane/dialog.ts'));
    expect(dialog).toMatch(/import\s*\{[^}]*\bEDIT_HINT_RE\b[^}]*\}\s*from\s*'(?:\.\.\/)+shared\/ask-menu\.js'/);
    expect(dialog).toMatch(/\bEDIT_HINT_RE\.test\(/);
    expect(stallCode(path.join(ccrcRoot, 'server/src/inject/send.ts'))).toMatch(/\beditHintShown\s*\(/);
  });
});


// D-5048 (plan docs/superpowers/plans/2026-10-15-ask-server-half.md, Task 4). APPENDED, as the blocks above. A
// multiSelect question is read into `Dialog.multi`, and so answered by `POST /api/sessions/:id/dialog/multi`, only when
// the unnumbered row that commits it (`Next`, or `Submit` on the last question) is on screen: that row marks the layout
// whose keys were measured. ONE rule, `COMMIT_ROW_RE` in `shared/ask-menu.ts`, read by `pane/dialog.ts`'s `multiMenu`.
// A second spelling that drifts would let one reader call a menu answerable that the other does not. Code lines only
// (`stallCode`). KNOWN WIDTH: only the two words as one alternation are seen; a bare 'Next' or 'Submit' string is
// common UI copy and is not scanned.
describe('the multiSelect commit row is spelled once, in shared/ask-menu.ts (D-5048)', () => {
  const COMMIT = /\bnext\s*\|\s*submit\b|\bsubmit\s*\|\s*next\b/i;
  const holders = (): string[] => ALL.filter((f) => COMMIT.test(stallCode(f))).map(rel).sort();

  it('CONTROL: the pattern sees a regex literal either way round, and passes over comment lines', () => {
    expect(COMMIT.test('const ROW = /^(?:next|submit)$/i;')).toBe(true);
    expect(COMMIT.test("const ROW = /^(Submit|Next)$/;")).toBe(true);
    expect(stallCodeText('// the row reads Next|Submit\nconst x = 1;')).not.toMatch(COMMIT);
  });

  it('the commit row is spelled on a code line in shared/ask-menu.ts and nowhere else', () => {
    expect(holders()).toEqual(['shared/ask-menu.ts']);
  });

  it('the parse reads it: pane/dialog.ts imports and tests the L0 rule, and answerDialogMulti reads Dialog.multi', () => {
    const dialog = stallCode(path.join(ccrcRoot, 'server/src/pane/dialog.ts'));
    expect(dialog).toMatch(/import\s*\{[^}]*\bCOMMIT_ROW_RE\b[^}]*\}\s*from\s*'(?:\.\.\/)+shared\/ask-menu\.js'/);
    expect(dialog).toMatch(/\bCOMMIT_ROW_RE\.test\(/);
    expect(stallCode(path.join(ccrcRoot, 'server/src/inject/send.ts'))).toMatch(/\bdialog\.multi\b/);
  });
});


// (This block sat at the end of the file so a citation of the file by line kept resolving; the file is split by area now
// and the rule is retired, see the note at the head of ./helpers.ts.)

describe("one 'tmux unreachable' sentence (design-system wave)", () => {
  // SEVEN COPIES, and three of them carried a comment saying the string was
  // "SessionLine's chip's own `tmux unreachable — <reason>`, never a second
  // copy". Every one of those was the second copy. The sentence is operator
  // COPY, so it lives in the PWA (`pwa/src/fleet/substrateWords.ts`) rather
  // than beside `substrateFault` in L0, and this is what keeps it there.
  //
  // Invisible to every census on this branch by construction: it is not a
  // stylesheet rule, not an element, not a two-word class literal and not a
  // leaf's attribute set — one template literal, in seven files.
  const SENTENCE = /`tmux unreachable — \$\{/;

  it('is composed in exactly one file, and that file is substrateWords.ts', () => {
    const holders = ALL.filter((f) => SENTENCE.test(readFileSync(f, 'utf8'))).map(rel);
    expect(holders).toEqual(['pwa/src/fleet/substrateWords.ts']);
  });

  it('and every surface that showed it still reaches it', () => {
    // The other direction: a fold that deleted the callers instead of pointing
    // them at the word would satisfy the test above and lose the tooltip.
    for (const f of [
      'pwa/src/fleet/SessionActionsSheet.tsx', 'pwa/src/fleet/ArchiveSheet.tsx',
      // D-5545: the fleet row's and the header's facts are decided in `sessionFacts.ts` now, not `SessionMeta.tsx`.
      'pwa/src/fleet/sessionFacts.ts', 'pwa/src/screens/SessionScreen.tsx',
      'pwa/src/session/SessionFlows.tsx', 'pwa/src/session/PrSheet.tsx', // W2 Task S2d: the ⋯ menu moved there
    ]) {
      expect(readFileSync(path.join(ccrcRoot, f), 'utf8'), f)
        .toMatch(/substrateFaultT(ext|itle)\(/);
    }
  });
});


// D-5089 (plan docs/superpowers/plans/2026-10-15-ask-sheet-half.md, Task 1). APPENDED at the very end, for the reason
// the note above the 'tmux unreachable' block states: `session-hook.test.ts` cites this file by line. The sheet tells
// AskUserQuestion's review screen by its last line ("Ready to submit your answers?") and its two rows, and reads its
// summary up to that line (`pwa/src/session/askLive.ts`'s `isAskReview` and `reviewSummary`; D-6325 deleted the
// summary reader, and the sheet's review prints Claude's headers instead). Those are screen facts,
// so each is ONE rule in `shared/ask-menu.ts` beside the server half's four, and the sheet imports them. A second
// spelling that drifts would let one reader call a screen the review that the other does not. Code lines only
// (`stallCode`): prose names the screen in quotes. KNOWN WIDTH: `Cancel` is common copy and is not scanned, and nor is
// the heading "Review your answers", whose words are also the sheet's own title for the screen.
describe('the review screen\'s rows and last line are spelled once, in shared/ask-menu.ts (D-5089)', () => {
  const READY = /ready\s+to\s+submit/i;
  const SUBMIT = /submit\s+answers/i;
  const holders = (re: RegExp): string[] => ALL.filter((f) => re.test(stallCode(f))).map(rel).sort();

  it('CONTROL: the patterns see a regex literal and a string, and pass over comment lines', () => {
    expect(READY.test('const READY = /ready to submit your answers\\?$/i;')).toBe(true);
    expect(SUBMIT.test("if (label === 'Submit answers') return 1;")).toBe(true);
    const prose = '// the "Ready to submit your answers?" line\n * 1. Submit answers\nconst x = 1;';
    expect(stallCodeText(prose)).not.toMatch(READY);
    expect(stallCodeText(prose)).not.toMatch(SUBMIT);
  });

  it('the ready line is spelled on a code line in shared/ask-menu.ts and nowhere else', () => {
    expect(holders(READY)).toEqual(['shared/ask-menu.ts']);
  });

  it('the Submit answers row is spelled on a code line in shared/ask-menu.ts, and the sheet\'s fixed label beside it and nowhere else', () => {
    // D-6325: the pane's row is still told by ONE rule (`REVIEW_SUBMIT_ROW_RE`). The review the sheet draws no longer
    // prints the pane's label for it: its word is the sheet's own, `SUBMIT_ANSWERS` in `askLive.ts` (which the
    // transcript's Answer control reads too), so that one pwa file spells it, as a label to show and not a rule to match.
    expect(holders(SUBMIT)).toEqual(['pwa/src/session/askLive.ts', 'shared/ask-menu.ts']);
  });

  it('the sheet reads the L0 rules: askLive.ts imports and tests each review rule', () => {
    const live = stallCode(path.join(ccrcRoot, 'pwa/src/session/askLive.ts'));
    const fromL0 = (name: string): RegExp =>
      new RegExp(`import\\s*\\{[^}]*\\b${name}\\b[^}]*\\}\\s*from\\s*'(?:\\.\\./)+shared/ask-menu(?:\\.js)?'`);
    // D-6325: `reviewSummary`, the one reader of the ready line and the heading in the sheet, is deleted (the review's
    // summary is Claude's headers now), so askLive.ts reads the review only through `reviewRows`, below.
    for (const name of ['REVIEW_READY_RE', 'REVIEW_HEADING_RE']) {
      expect(live, `askLive.ts spells ${name} again`).not.toMatch(new RegExp(`\\b${name}\\b`));
    }
    // Decision `ask-review-lenient-arm`: the two rows are told by ONE L0 reader, `reviewRows`, which the sheet and the
    // server's frame log both call, so neither spells the row rules again. It tests each of them; askLive imports it.
    expect(live, 'askLive.ts does not import reviewRows from L0').toMatch(fromL0('reviewRows'));
    const menu = stallCode(path.join(ccrcRoot, 'shared/ask-menu.ts'));
    for (const name of ['REVIEW_READY_RE', 'REVIEW_SUBMIT_ROW_RE', 'REVIEW_CANCEL_ROW_RE']) {
      expect(menu, `reviewRows does not test ${name}`).toMatch(new RegExp(`\\b${name}\\.test\\(`));
    }
  });
});


// D-5231 (plan docs/superpowers/plans/2026-10-16-working-state-and-interruptions.md, Task 1). APPENDED at the very end,
// for the reason the notes above state: `session-hook.test.ts` cites this file by line. THE DELEGATED-TASK RULE — the
// six non-delegating kinds and the three terminal statuses — has one TypeScript home, `shared/api.ts`, which the
// server's and the PWA's wording read. The hook's `jq` in `ccd/session-hook.sh` is the documented second spelling, held
// equal by `session-hook-background.test.ts` (it iterates these lists and reads the jq's back as sets, D-6117), not by
// this scan. A drifting TypeScript copy would split readers; `isDelegatedTask`, which nothing called, is gone (D-6117).
describe('the delegated-task rule is declared once, in shared/api.ts (D-5231)', () => {
  const VALUE_DEF = (name: string): RegExp => new RegExp(`^\\s*(?:export\\s+)?(?:const|let|var)\\s+${name}\\b`, 'm');
  const FUNCTION_DEF = (name: string): RegExp =>
    new RegExp(`^\\s*(?:export\\s+)?(?:function\\s+${name}\\b|(?:const|let|var)\\s+${name}\\s*=)`, 'm');
  // The two rarest of the nine words, quoted: a hand-copied list carries them, and no other code names them.
  const RARE = /(['"`])(?:auto-mode-scan|memory-import)\1/;

  it('CONTROL: the patterns see a declaration and a quoted copy, and not an import, a use or prose', () => {
    expect(VALUE_DEF('NON_DELEGATING_TASK_KINDS').test('const NON_DELEGATING_TASK_KINDS = [];')).toBe(true);
    expect(VALUE_DEF('NON_DELEGATING_TASK_KINDS').test("import { NON_DELEGATING_TASK_KINDS } from '../../shared/api.js';")).toBe(false);
    expect(VALUE_DEF('TERMINAL_TASK_STATUSES').test('for (const s of TERMINAL_TASK_STATUSES) {}')).toBe(false);
    expect(FUNCTION_DEF('isDelegatedTask').test('const isDelegatedTask = (t) => true;')).toBe(true);
    expect(FUNCTION_DEF('isDelegatedTask').test('if (isDelegatedTask(t)) n++;')).toBe(false);
    expect(RARE.test("const K = ['shell', 'memory-import'];")).toBe(true);
    expect(RARE.test('the `memory-import` kind never holds busy')).toBe(true);
    expect(RARE.test('the memory-import kind, in prose')).toBe(false);
  });

  it('declares NON_DELEGATING_TASK_KINDS and TERMINAL_TASK_STATUSES once, in shared/api.ts; isDelegatedTask nowhere (D-6117)', () => {
    for (const name of ['NON_DELEGATING_TASK_KINDS', 'TERMINAL_TASK_STATUSES']) {
      expect(ALL.filter((f) => VALUE_DEF(name).test(readFileSync(f, 'utf8'))).map(rel), name).toEqual(['shared/api.ts']);
    }
    expect(ALL.filter((f) => FUNCTION_DEF('isDelegatedTask').test(readFileSync(f, 'utf8'))).map(rel)).toEqual([]);
  });

  it('quotes the rare kinds on a code line in shared/api.ts and nowhere else across the four roots', () => {
    expect(ALL.filter((f) => RARE.test(stallCode(f))).map(rel)).toEqual(['shared/api.ts']);
  });
});


// D-5238 (plan docs/superpowers/plans/2026-10-16-working-state-and-interruptions.md, Task 9). APPENDED at the very end,
// for the reason the note above the 'tmux unreachable' block states. The turn verdict's READS have one home,
// `server/src/turnverdict.ts` (`turnVerdictFor`, `liveRowFor`, `liveWordFor`); the RULE has one home,
// `server/src/coord/archiveDoor.ts` (`stopVerdict`). The dispatch gate reaches them through its required
// `DispatchRunDeps.turnVerdict` port, never through a second copy of either. Code lines only (`stallCode`).
describe('the turn verdict\'s reads and rule each have one home (D-5238)', () => {
  const holders = (re: RegExp): string[] => ALL.filter((f) => re.test(stallCode(f))).map(rel).sort();

  it('CONTROL: the patterns see a definition and a call, and pass over comment lines', () => {
    expect(/\bfunction stopVerdict\b/.test('export function stopVerdict(r: StopReadings): TurnVerdict {')).toBe(true);
    expect(/\bstopVerdict\(/.test("return stopVerdict({ configDir: 'none' });")).toBe(true);
    expect(stallCodeText('// stopVerdict( in prose\n * stopVerdict(\nconst x = 1;')).not.toMatch(/\bstopVerdict\(/);
  });

  it('the rule is defined once, in coord/archiveDoor.ts', () => {
    expect(holders(/\bfunction stopVerdict\b|\bconst stopVerdict\b/)).toEqual(['server/src/coord/archiveDoor.ts']);
  });

  it('the rule is CALLED only from turnverdict.ts (its definition aside)', () => {
    expect(holders(/(?<!function )\bstopVerdict\(/)).toEqual(['server/src/turnverdict.ts']);
  });

  it('the reads are defined once, in turnverdict.ts', () => {
    for (const name of ['turnVerdictFor', 'liveRowFor', 'liveWordFor']) {
      expect(holders(new RegExp(`\\bfunction ${name}\\b|\\bconst ${name}\\s*=`)), name).toEqual(['server/src/turnverdict.ts']);
    }
  });

  it('dispatch.ts reads no live file of its own: it asks the turnVerdict port', () => {
    const dispatch = stallCode(path.join(ccrcRoot, 'server/src/coord/dispatch.ts'));
    expect(dispatch).toMatch(/turnVerdict: deps\.turnVerdict\b/);
    expect(dispatch).not.toMatch(/readLiveStateMeasured|readLiveState\b|panePid\(/);
  });
});


// D-5299 (plan docs/superpowers/plans/2026-10-17-coordinator-first-routing.md, Task 12). APPENDED at the very end, for
// the reason the note above the 'tmux unreachable' block states. The approval classifier, its class map and the
// command redactor each have one home: `server/src/coord/approvalguard.ts` (`approvalClass`, `APPROVAL_CLASS_MAP`)
// and `server/src/coord/redact.ts` (`redactCommand`). The hook's bash copy of the `forbidden` match (Task 14) is a
// documented second copy held equal by the shared corpus, not a TypeScript definition. Code lines only (`stallCode`).
describe('the approval classifier, its class map and the redactor each have one home (D-5299)', () => {
  const holders = (re: RegExp): string[] => ALL.filter((f) => re.test(stallCode(f))).map(rel).sort();

  it('CONTROL: the patterns see a definition and pass over a call and comment lines', () => {
    expect(/\bfunction approvalClass\b|\bconst approvalClass\s*=/.test('export function approvalClass(tool: string) {')).toBe(true);
    expect(/\bfunction approvalClass\b|\bconst approvalClass\s*=/.test("const c = approvalClass('Bash', input, ctx);")).toBe(false);
    expect(/\bAPPROVAL_CLASS_MAP\s*=/.test('export const APPROVAL_CLASS_MAP = {')).toBe(true);
    expect(stallCodeText('// function redactCommand( in prose\n * function redactCommand(\nconst x = 1;')).not.toMatch(/\bfunction redactCommand\b/);
  });

  it('approvalClass is defined once, in coord/approvalguard.ts', () => {
    expect(holders(/\bfunction approvalClass\b|\bconst approvalClass\s*=/)).toEqual(['server/src/coord/approvalguard.ts']);
  });

  it('the class map is defined once, beside it, and its three words are quoted as a set nowhere else', () => {
    expect(holders(/\bAPPROVAL_CLASS_MAP\s*=/)).toEqual(['server/src/coord/approvalguard.ts']);
    // A hand-copied class list carries all three words quoted on one line.
    expect(holders(/(['"`])forbidden\1[^\n]*(['"`])escalate\2[^\n]*(['"`])ordinary\3|(['"`])ordinary\4[^\n]*(['"`])escalate\5[^\n]*(['"`])forbidden\6/)).toEqual([]);
  });

  it('redactCommand is defined once, in coord/redact.ts', () => {
    expect(holders(/\bfunction redactCommand\b|\bconst redactCommand\s*=/)).toEqual(['server/src/coord/redact.ts']);
  });

  // D-5867 (Task C1l, ARCH-66 (#801)): the egress rule patterns' one home is `shared/redact.mjs`. `.mjs` is not in
  // `ALL`, so the home is read by path; the TypeScript holders are `ALL`'s.
  it('the egress rule patterns have one home, shared/redact.mjs: no TypeScript file spells one', () => {
    const FRAGMENTS = [/hooks\\\.slack\\\.com/, /gh\[pousr\]_/, /\bSECRET_NAME_TEST\b/, /\(\?:Proxy-\)\?Authorization/];
    const home = readFileSync(path.join(ccrcRoot, 'shared', 'redact.mjs'), 'utf8');
    for (const f of FRAGMENTS) {
      expect(f.test(home), `${f} in shared/redact.mjs`).toBe(true);
      expect(holders(f), `${f} in a .ts file`).toEqual([]);
    }
    expect(FRAGMENTS[0]!.test('const SLACK = /(hooks\\.slack\\.com\\/)/;'), 'CONTROL: the pattern sees a spelling').toBe(true);
  });
});


// D-5232's mechanism (plan docs/superpowers/plans/2026-10-16-working-state-and-interruptions.md, Task 9b). APPENDED at
// the very end, for the reason the notes above state. THE SERVER'S CAPABILITY WORDS (`SERVER_CAPS`, derived from
// `SERVER_CAP_MAP`), the file they are recorded in (`SERVER_CAPS_FILE`) and its lease (`SERVER_CAPS_LEASE_S`) have one
// TypeScript home, `shared/api.ts`: `/health` advertises the list and `server/src/update/serverCaps.ts` writes it. The
// bash spellings (`ccd/ccd-update-sync`'s grammar and file name; from Tasks 2 and 10, `ccd/session-hook.sh`'s file
// name, lease and grammar) are documented second copies held equal by tests that iterate over these values
// (`ccd-update-sync.test.ts`'s shared table), not by this text scan.
describe('the server\'s capability words, their file and its lease are declared once, in shared/api.ts (D-5232)', () => {
  const VALUE_DEF = (name: string): RegExp => new RegExp(`^\\s*(?:export\\s+)?(?:const|let|var)\\s+${name}\\b`, 'm');
  // The seed word, quoted on a code line: a hand-copied list carries it.
  const WORD = /(['"`])dispatch-live-gate-v1\1/;
  const holders = (re: RegExp): string[] => ALL.filter((f) => re.test(stallCode(f))).map(rel).sort();

  it('CONTROL: the patterns see a declaration and a quoted copy, and not an import, a use or prose', () => {
    expect(VALUE_DEF('SERVER_CAPS').test('export const SERVER_CAPS: readonly ServerCap[] = [];')).toBe(true);
    expect(VALUE_DEF('SERVER_CAPS').test("import { SERVER_CAPS } from '../../shared/api.js';")).toBe(false);
    expect(VALUE_DEF('SERVER_CAPS').test('const SERVER_CAPS_FILE = 1;')).toBe(false);
    expect(VALUE_DEF('SERVER_CAPS_LEASE_S').test('if (age > SERVER_CAPS_LEASE_S) return;')).toBe(false);
    expect(WORD.test("const caps = ['dispatch-live-gate-v1'];")).toBe(true);
    expect(stallCodeText('// the dispatch-live-gate-v1 word, in prose\nconst x = 1;')).not.toMatch(WORD);
  });

  it('declares SERVER_CAP_MAP, SERVER_CAPS, SERVER_CAPS_FILE and SERVER_CAPS_LEASE_S exactly once, in shared/api.ts', () => {
    for (const name of ['SERVER_CAP_MAP', 'SERVER_CAPS', 'SERVER_CAPS_FILE', 'SERVER_CAPS_LEASE_S']) {
      expect(ALL.filter((f) => VALUE_DEF(name).test(readFileSync(f, 'utf8'))).map(rel), name).toEqual(['shared/api.ts']);
    }
  });

  it('quotes the seed word on a code line in shared/api.ts and nowhere else across the four roots', () => {
    expect(holders(WORD)).toEqual(['shared/api.ts']);
  });

  it('the grammar\'s three functions are defined once, in shared/api.ts', () => {
    for (const name of ['renderServerCaps', 'parseServerCaps', 'isServerCapWord']) {
      expect(holders(new RegExp(`\\bfunction ${name}\\b|\\bconst ${name}\\s*=`)), name).toEqual(['shared/api.ts']);
    }
  });
});


// D-5302 (plan docs/superpowers/plans/2026-10-17-coordinator-first-routing.md, Task 3; spec §9). APPENDED. An ask's
// push body is built in ONE place, `askPushBody` in `server/src/askbody.ts`, from the hook envelope; both raise sites
// pushed `dialog.title || 'Claude has a question'` and 14 of 36 measured bodies were a lone border glyph. The fallback
// string is spelled on a code line there and nowhere else, `askPushBody` is defined there and nowhere else, and no
// raise site in `watch.ts` reaches for `dialog.title` as a body any more. Code lines only (`stallCode`).
describe('the ask push body is built once, in server/src/askbody.ts (D-5302)', () => {
  const FALLBACK = /Claude has a question/;
  const DEFINES = /\bfunction\s+askPushBody\b|\baskPushBody\s*=\s*(?:\(|function\b)/;
  const holders = (re: RegExp): string[] => ALL.filter((f) => re.test(stallCode(f))).map(rel).sort();

  it('CONTROL: the patterns see a string and a definition, and pass over comment lines', () => {
    expect(FALLBACK.test("body: dialog.title || 'Claude has a question',")).toBe(true);
    expect(DEFINES.test('export function askPushBody(hs, dialog) {')).toBe(true);
    expect(DEFINES.test('const askPushBody = (hs, dialog) => x;')).toBe(true);
    expect(stallCodeText("// the push says 'Claude has a question'\nconst x = 1;")).not.toMatch(FALLBACK);
  });

  it('the fallback body is spelled on a code line in server/src/askbody.ts and nowhere else', () => {
    expect(holders(FALLBACK)).toEqual(['server/src/askbody.ts']);
  });

  it('askPushBody is defined in server/src/askbody.ts and nowhere else', () => {
    expect(holders(DEFINES)).toEqual(['server/src/askbody.ts']);
  });

  it("the ask raise sites (watch.ts and coord/questions.ts) call askPushBody, and no body there reads dialog.title", async () => {
    const watch = stallCode(path.join(ccrcRoot, 'server/src/watch.ts'));
    // W3 Q3d (D-7028, named exception 2): the hold, its payload builder and the re-seed moved into
    // `coord/questions.ts`, so the sites are counted over the two files together; the totals are today's. The moved
    // text is read by symbol (`askHoldPayload`, `createQuestions`) and the import from the parse, never as a literal
    // pin over the file (the literal-pin ratchet, `advance-switches.test.ts`).
    const { parsedFile, sourceOfSymbol } = await import('../scan/symbols.js');
    const QUESTIONS = path.join(ccrcRoot, 'server/src/coord/questions.ts');
    const questions = ['askHoldPayload', 'createQuestions'].map((n) => stallCodeText(sourceOfSymbol(QUESTIONS, n))).join('\n');
    const both = `${watch}\n${questions}`;
    expect(watch).toMatch(/import\s*\{[^}]*\baskPushBody\b[^}]*\}\s*from\s*'\.\/askbody\.js'/);
    expect(parsedFile(QUESTIONS).imports.some((e) => e.specifier === '../askbody.js' && e.names.includes('askPushBody') && !e.typeOnly)).toBe(true);
    // Two since D-5925: the first raise (watch.ts), and `askHoldPayload` (coord/questions.ts), the one builder of a held
    // push. `hold()`, the approval hold (`holdApproval`, plan Task 16) and the restart re-seed all build through it.
    expect(both.match(/body:\s*askPushBody\(/g) ?? []).toHaveLength(2);
    expect(both.match(/\bev\s*=\s*askHoldPayload\(/g) ?? []).toHaveLength(2);
    expect(both.match(/\bev:\s*askHoldPayload\(/g) ?? []).toHaveLength(2);
    expect(watch).not.toMatch(/body:\s*dialog\.title/);
    expect(questions).not.toMatch(/body:\s*dialog\.title/);
  });

  // D-5356 (coordinator ruling `approval-push-body-tool-only-until-redactor`): until the redactor is applied where
  // the approval summary enters the wire (Task 16), the push body module reads no approval `summary` (the command),
  // directly or through `hookAskSummary`, and the fixed phrase is spelled there only.
  it('D-5356: askbody.ts never reads an approval summary, and the fixed phrase is spelled there only', () => {
    const askbody = stallCode(path.join(ccrcRoot, 'server/src/askbody.ts'));
    expect(askbody).not.toMatch(/\.summary\b|\bsummary\s*[,}]|\bhookAskSummary\b/);
    expect(stallCodeText('const { tool, summary } = a;')).toMatch(/\bsummary\s*[,}]/);   // CONTROL
    expect(holders(/permission requested/)).toEqual(['server/src/askbody.ts']);
  });
});


// D-5290 (plan docs/superpowers/plans/2026-10-17-coordinator-first-routing.md, Task 5; spec §5.2). APPENDED. ONE
// `raise` decides every ask hold (it was `watch.ts#tryHold` until W3 Q3d, D-7028, moved it into the watcher's
// `Questions` instance; named exception 2): it is defined once, in `server/src/coord/questions.ts`, inside
// `createQuestions`; it is the only caller of `hold` (the mint) and the only reader of the claimant rule there, so no
// raise site can hold on its own checks; and `watch.ts`'s first sighting, deferred first raise and amendment branch all
// call it. Its parent-live check reads the dead-coordinator sweep's own predicate, `claimantMeasuredDead`, defined once
// in `server/src/coord/reclaim.ts` and read by both. Code lines only (`stallCode`).
describe('one raise decides every ask hold (D-5290)', () => {
  const holders = (re: RegExp): string[] => ALL.filter((f) => re.test(stallCode(f))).map(rel).sort();
  // The hold's `raise` is async (it awaits the claimant rule); `notice.ts`'s synchronous `function raise` is the notice
  // funnel's own step, a different function, and the pattern passes over it.
  const DEFINES_RAISE = /\bconst\s+raise\s*=\s*async\s*\(|\basync\s+raise\s*\(|\basync\s+function\s+raise\b/;
  const DEFINES_DEAD = /\bfunction\s+claimantMeasuredDead\b|\bclaimantMeasuredDead\s*=\s*\(/;
  const MINT = /(?<![.\w])hold\(/g;
  const QUESTIONS = path.join(ccrcRoot, 'server/src/coord/questions.ts');

  it('CONTROL: the patterns see a definition and pass over a call, the immediate raise and a comment line', () => {
    expect(DEFINES_RAISE.test('  const raise = async (')).toBe(true);
    expect(DEFINES_RAISE.test('await this.questions.raise(r, dialog, hs, actions, recs)')).toBe(false);
    expect(DEFINES_RAISE.test('const raise = (): void => {')).toBe(false);
    expect(DEFINES_RAISE.test('async function raise(r) {')).toBe(true);
    expect(DEFINES_RAISE.test('function raise(deps: NoticeDeps, event: NoticeRecord): NoticeOutcome {')).toBe(false);
    expect(DEFINES_DEAD.test('export function claimantMeasuredDead(v: ClaimantVerdict): boolean {')).toBe(true);
    expect(stallCodeText('// const raise = async (\nconst x = 1;')).not.toMatch(DEFINES_RAISE);
    expect('const mint = hold(r, dialog);'.match(MINT) ?? []).toHaveLength(1);
    expect('this.hold(r); holdApproval(r); const hold = (r) => r;'.match(MINT) ?? []).toHaveLength(0);
  });

  it('raise is defined in server/src/coord/questions.ts, inside createQuestions, and nowhere else', async () => {
    expect(holders(DEFINES_RAISE)).toEqual(['server/src/coord/questions.ts']);
    const { symbolOf } = await import('../scan/symbols.js');
    expect(symbolOf(QUESTIONS, 'createQuestions.raise').kind).toBe('variable-function');
  });

  it("the mint runs only inside raise, which reads the claimant rule; no run-series read elsewhere; watch.ts calls it from all three raise paths", async () => {
    // By symbol, never as a literal pin over the file (the literal-pin ratchet, `advance-switches.test.ts`).
    const { parsedFile, symbolOf } = await import('../scan/symbols.js');
    const raw = parsedFile(QUESTIONS).text;
    const raise = symbolOf(QUESTIONS, 'createQuestions.raise');
    const body = stallCodeText(raw.slice(raise.start, raise.end));
    const rest = stallCodeText(raw.slice(0, raise.start) + raw.slice(raise.end));
    const watch = stallCode(path.join(ccrcRoot, 'server/src/watch.ts'));
    expect(body.match(MINT) ?? []).toHaveLength(1);
    expect(rest.match(MINT) ?? []).toHaveLength(0);
    expect(watch).not.toMatch(/\bthis\.hold\(/);
    // D-5530 (plan Task 16): the claimant decision moved, whole, into `coord/heldFor.ts`, which the approvals mint
    // reads too: `raise` calls it, and neither file reads the child's run series (`bindingRunsOf`, which replaced
    // `parentOfSession`: ARCH-62 slice 2) anywhere else. heldFor reads it through `bindingsOf(id).parent` (ARCH-42:
    // `childParentRead`, bindingReads.ts, through the store's one query), the one parent read it shares with the drift lane.
    expect(body).toMatch(/\bheldFor\(/);
    expect(rest).not.toMatch(/\.bindingRunsOf\(/);
    expect(watch).not.toMatch(/\.bindingRunsOf\(/);
    expect(watch.match(/\bthis\.questions\.raise\(/g) ?? []).toHaveLength(3);
    const heldForSrc = stallCode(path.join(ccrcRoot, 'server/src/coord/heldFor.ts'));
    expect(heldForSrc).toMatch(/\.bindingsOf\(childId\)\.parent\(/);
    expect(heldForSrc).toMatch(/\bclaimantMeasuredDead\(/);
  });

  it('claimantMeasuredDead is defined in server/src/coord/reclaim.ts and read by the dead-coordinator sweep', () => {
    expect(holders(DEFINES_DEAD)).toEqual(['server/src/coord/reclaim.ts']);
    const watch = stallCode(path.join(ccrcRoot, 'server/src/watch.ts'));
    expect(watch).toMatch(/const dead = ids\.filter\(\(id\) => claimantMeasuredDead\(/);
  });
});


// D-5293 (plan docs/superpowers/plans/2026-10-17-coordinator-first-routing.md, Task 8; spec §5.3). APPENDED. The
// parent's hold and the operator's answer route read ONE eligibility rule, `answerableAsk` in `server/src/askkey.ts`:
// `askActions` (the hold's sole gate, D-2173) reads it and spells none of its tests, and `answerAsk` reads it before
// the pane. Both routes that press through `answerAsk` read their body with ONE reader, `readAskAnswer` in
// `server/src/inject/ask.ts`, and neither route respells the `optionIndexes` check. Code lines only (`stallCode`).
describe('one eligibility rule and one answer body for the parent and the operator (D-5293)', () => {
  const definesFn = (name: string): RegExp =>
    new RegExp(`\\bfunction\\s+${name}\\b|\\b${name}\\s*=\\s*(?:\\(|function\\b|async\\b)`);
  const holders = (re: RegExp): string[] => ALL.filter((f) => re.test(stallCode(f))).map(rel).sort();
  const INDEX_CHECK = /typeof\s+\w+\s*===\s*'number'/;
  const ELIGIBILITY_TESTS = /\.questions\.length|\bmultiSelect\b|\.options\.length|\.label\.trim\(\)/;
  /** The code between two literal anchors, both asserted, the closing one after the opening one. */
  const between = (name: string, text: string, from: string, to: string): string => {
    const a = text.indexOf(from);
    expect(a, `${name}: the opening anchor is gone`).toBeGreaterThan(-1);
    const b = text.indexOf(to, a + from.length);
    expect(b, `${name}: the closing anchor is gone`).toBeGreaterThan(a);
    return text.slice(a, b);
  };

  it('CONTROL: the patterns see a definition, an index check and an eligibility test, and pass over comments', () => {
    expect(definesFn('answerableAsk').test('export function answerableAsk(ask) {')).toBe(true);
    expect(definesFn('readAskAnswer').test('const readAskAnswer = (b) => b;')).toBe(true);
    expect(definesFn('answerableAsk').test('if (!answerableAsk(ask)) return null;')).toBe(false);
    expect(INDEX_CHECK.test("optionIndexes.every((n) => typeof n === 'number')")).toBe(true);
    expect(ELIGIBILITY_TESTS.test('if (ask.questions.length !== 1) return null;')).toBe(true);
    expect(ELIGIBILITY_TESTS.test('if (q.multiSelect === true) return null;')).toBe(true);
    expect(stallCodeText('// q.multiSelect === true\nconst x = 1;')).not.toMatch(ELIGIBILITY_TESTS);
  });

  it('answerableAsk is defined in server/src/askkey.ts and readAskAnswer in server/src/inject/ask.ts, nowhere else', () => {
    expect(holders(definesFn('answerableAsk'))).toEqual(['server/src/askkey.ts']);
    expect(holders(definesFn('readAskAnswer'))).toEqual(['server/src/inject/ask.ts']);
  });

  it('askActions reads answerableAsk and spells none of its tests', () => {
    const body = between('askActions', stallCode(path.join(ccrcRoot, 'server/src/askkey.ts')),
      'export function askActions(', '\n}\n');
    expect(body).toMatch(/\banswerableAsk\(ask\)/);
    expect(body).not.toMatch(ELIGIBILITY_TESTS);
  });

  it('answerAsk reads answerableAsk before it captures the pane', () => {
    const body = between('answerAsk', stallCode(path.join(ccrcRoot, 'server/src/inject/ask.ts')),
      'export async function answerAsk(', '\n}\n');
    const gate = body.indexOf('answerableAsk(hs.ask)');
    expect(gate, 'answerAsk reads answerableAsk').toBeGreaterThan(-1);
    expect(gate, 'and before the capture').toBeLessThan(body.indexOf('d.tmux.capture('));
  });

  it('both answer routes read their body with readAskAnswer and neither respells the index check', () => {
    const operator = between('POST /api/sessions/:id/ask', stallCode(path.join(ccrcRoot, 'server/src/server.ts')),
      "app.post('/api/sessions/:id/ask'", "app.get('/api/sessions/:id/commands'");
    const parent = between('POST /api/asks/:id/answer', stallCode(path.join(ccrcRoot, 'server/src/coord/routes.ts')),
      "app.post('/api/asks/:id/answer'", "app.post('/api/asks/:id/release'");
    for (const [name, code] of [['operator', operator], ['parent', parent]] as const) {
      expect(code, name).toMatch(/\breadAskAnswer\(/);
      expect(code, name).not.toMatch(INDEX_CHECK);
      expect(code, name).not.toMatch(/Array\.isArray\(\s*(?:body\.)?optionIndexes\b/);
    }
  });
});


// D-5294, D-5295 (plan docs/superpowers/plans/2026-10-17-coordinator-first-routing.md, Task 6; spec §5.4, §5.5,
// §6.7). APPENDED. The ask window has ONE home and ONE deadline computation: `ASK_GRACE_MS` (180 s) is defined in
// `server/src/askwindow.ts` and read by name on a code line nowhere else in the source roots, so the hold's sweep
// deadline and the brief's "notified at" both go through `askNotifyAt`, defined there too. The fence renderer for a
// child's text in a coordinator's mail, `untrustedBlock`, is defined in `server/src/coord/untrusted.ts` alone, its
// preface spelled there alone, and the brief calls it. Code lines only (`stallCode`).
describe('the ask window, its deadline and the untrusted-data fence are each defined once (D-5294, D-5295)', () => {
  const holders = (re: RegExp): string[] => ALL.filter((f) => re.test(stallCode(f))).map(rel).sort();
  const defines = (name: string): RegExp =>
    new RegExp(`\\bfunction\\s+${name}\\b|\\b(?:const|let|var)\\s+${name}\\s*=`);

  it('CONTROL: the patterns see a definition and a read, and pass over comment lines', () => {
    expect(defines('askNotifyAt').test('export function askNotifyAt(heldAt: number): number {')).toBe(true);
    expect(defines('askNotifyAt').test('const askNotifyAt = (t) => t;')).toBe(true);
    expect(/\bASK_GRACE_MS\b/.test('return { until: now + ASK_GRACE_MS };')).toBe(true);
    expect(stallCodeText('// the window is ASK_GRACE_MS\nconst x = 1;')).not.toMatch(/\bASK_GRACE_MS\b/);
  });

  it('ASK_GRACE_MS is 180 000, defined in server/src/askwindow.ts', () => {
    const src = stallCode(path.join(ccrcRoot, 'server/src/askwindow.ts'));
    expect(src).toMatch(/export const ASK_GRACE_MS = 180_000;/);
    expect(holders(defines('ASK_GRACE_MS'))).toEqual(['server/src/askwindow.ts']);
  });

  it('ASK_GRACE_MS is read on a code line in server/src/askwindow.ts and nowhere else', () => {
    expect(holders(/\bASK_GRACE_MS\b/)).toEqual(['server/src/askwindow.ts']);
  });

  // D-5925: the restart re-seed is the second reader, and it reads the deadline from the row's own mint time.
  // W3 Q3d (D-7028, named exception 2): the hold and the re-seed are `coord/questions.ts#createQuestions`'s members, so
  // the two reads are counted in that factory's body; the file's read side (`askQuestion`, W3 Q3b) lifts a row with a
  // third, outside it (slug q3d-notify-at-count). `watch.ts` reads it nowhere.
  it('askNotifyAt is defined in server/src/askwindow.ts alone; the hold reads it once for both uses, the restart re-seed once from the row', async () => {
    expect(holders(defines('askNotifyAt'))).toEqual(['server/src/askwindow.ts']);
    const { sourceOfSymbol } = await import('../scan/symbols.js');
    const questions = stallCodeText(sourceOfSymbol(path.join(ccrcRoot, 'server/src/coord/questions.ts'), 'createQuestions'));
    const watch = stallCode(path.join(ccrcRoot, 'server/src/watch.ts'));
    expect(questions.match(/\baskNotifyAt\(/g) ?? []).toHaveLength(2);
    expect(watch).not.toMatch(/\baskNotifyAt\(/);
    expect(questions).toMatch(/renderAskBrief\([^)]*\buntil\)/);
    expect(questions).toMatch(/return \{ until, askId,/);
    expect(questions).toMatch(/until: askNotifyAt\(row\.at\)/);
  });

  it('untrustedBlock and its preface live in server/src/coord/untrusted.ts alone, and the brief calls it', async () => {
    expect(holders(defines('untrustedBlock'))).toEqual(['server/src/coord/untrusted.ts']);
    expect(holders(/untrusted data written by a model/)).toEqual(['server/src/coord/untrusted.ts']);
    // W3 Q3d (D-7028, named exception 2): the ask brief (`renderAskBrief`) moved with the hold into coord/questions.ts,
    // read here by symbol (the literal-pin ratchet, `advance-switches.test.ts`).
    const { sourceOfSymbol } = await import('../scan/symbols.js');
    const brief = stallCodeText(sourceOfSymbol(path.join(ccrcRoot, 'server/src/coord/questions.ts'), 'renderAskBrief'));
    expect(brief).toMatch(/\buntrustedBlock\(asked, UNTRUSTED_CAP_BYTES,/);
  });
});


// D-5370 (`stop-worker-at-run-done`). APPENDED, for the reason the stall-watch blocks above state. The stop-done lane
// ships LIVE (the operator's ruling), and its kill switch `$REG/stop-done-disabled` is the operator's to touch and
// remove BY HAND, beside `stall-watch-disabled` — so no line of shell names it, its one TS holder on a code line is its
// definer (an L1 file that reaches no `node:` module and so cannot write it), and the files that name its constant are
// the definer and the lane, neither of which reaches a write. Its numbers and its holds are spelled once, in the definer.
describe('D-5370: the stop-done lane’s kill switch has no writer, and its constants one home', () => {
  const NAME = 'stop-done-disabled';
  const DEFINER = 'shared/switches.ts'; // the kill switch's switchboard row since D-5855; stopDone.ts re-exports it
  /** The lane's numbers and holds stay in their own L1 definer. */
  const LANE_DEFINER = 'server/src/stopDone.ts';
  it('no shell line names it, and its one TS holder is its definer, which reaches no node: module', () => {
    expect(holdersOf(NAME), 'a line of shell names it — a writer, or a reader this design never had').toEqual([]);
    expect(ALL.filter((f) => stallCode(f).includes(NAME)).map(rel).sort(), `spelled on a code line outside ${DEFINER}`)
      .toEqual([DEFINER]);
    expect(stallCode(path.join(ccrcRoot, DEFINER))).not.toMatch(/from\s+['"]node:|import\s*\(\s*['"]node:|\brequire\s*\(/);
  });
  it('the files that name STOP_DONE_DISABLED_MARKER are the definer, its re-exporter and the lane, and none reaches a write', () => {
    const WRITE = /\b(?:writeFile|appendFile|rename|symlink|copyFile|mkdir|truncate|unlink|rm)(?:Sync)?\s*\(|\.write\w*\s*\(/;
    expect(WRITE.test('await deps.io.writeFile(`${dir}/${m}`, "");'), 'CONTROL: the pattern sees a write').toBe(true);
    const holders = ALL.filter((f) => stallCode(f).includes('STOP_DONE_DISABLED_MARKER')).map(rel).sort();
    expect(holders).toEqual(['server/src/sleepLane.ts', LANE_DEFINER, DEFINER]);
    for (const f of holders) expect(stallCode(path.join(ccrcRoot, f)), `${f} reaches a write`).not.toMatch(WRITE);
  });
  it('each of its constants and its hold list is declared once: the kill switch in its row, the rest in the lane', async () => {
    for (const c of ['STOP_DONE_GRACE_MS', 'STOP_DONE_PER_PASS', 'STOP_DONE_MEASURES_PER_PASS', 'STOP_DONE_SWEEP_MS',
      'STOP_DONE_RETRY_MS', 'STOP_DONE_DISABLED_MARKER', 'STOP_DONE_HOLDS', 'STOP_DONE_HOLD_MAP']) {
      const decl = new RegExp(`\\b(?:const|let|var)\\s+${c}\\b`);
      // The cadence is the `sleepRunDone` row's, declared in the L0 lane table and re-exported by the definer (D-7045).
      expect(ALL.filter((f) => decl.test(stallCode(f))).map(rel), c)
        .toEqual([c === 'STOP_DONE_DISABLED_MARKER' ? DEFINER : c === 'STOP_DONE_SWEEP_MS' ? 'server/src/laneSchedule.ts' : LANE_DEFINER]);
    }
    const [lane, table] = await Promise.all([import('../../src/stopDone.js'), import('../../src/laneSchedule.js')]);
    expect(lane.STOP_DONE_SWEEP_MS, 'the definer re-exports the table\'s constant').toBe(table.STOP_DONE_SWEEP_MS);
  });
});


// D-5373 `idle-compact-nudge`: APPENDED, the stall pins' reason. The lane's kill switch is a hand-touched registry
// marker with no writer in the tree, on the `stall-watch-disabled` precedent; and the prompt the lane types is
// compared by EQUALITY in the transcript parser, so a second literal would be a second rule.
describe('idle-compact-nudge: the kill switch has no writer, and the prompt is spelled once (D-5373)', () => {
  it('idle-compact-nudge-disabled: no shell line names it, and its one TS holder is its pure definer', () => {
    const name = 'idle-compact-nudge-disabled';
    const definer = 'shared/switches.ts'; // its switchboard row since D-5855; idlenudge.ts re-exports it
    expect(holdersOf(name), `${name}: a line of shell names it`).toEqual([]);
    expect(ALL.filter((f) => stallCode(f).includes(name)).map(rel).sort(), `${name}: spelled on a code line outside ${definer}`)
      .toEqual([definer]);
    expect(stallCode(path.join(ccrcRoot, definer)), `${definer} reaches a node: module — it could write the marker`)
      .not.toMatch(/from\s+['"]node:|import\s*\(\s*['"]node:|\brequire\s*\(/);
  });
  it("the nudge prompt's sentence is spelled on a code line in shared/api.ts alone", () => {
    const needle = 'Continue with your open tasks.';
    expect(ALL.filter((f) => stallCode(f).includes(needle)).map(rel).sort()).toEqual(['shared/api.ts']);
  });
});


// D-5240 (working-state spec §5.9): the swap route's refusal words are declared once, as `SWAP_REFUSALS` in L0, and
// they ARE archive's two spellings for the same two facts (bound by reference there, so this row holds the binding).
// The quoted-literal scan above already allows `session-busy` and `status-unknown` in `shared/api.ts` and the audit
// alone, so the server's swap guard and the PWA's sheet cannot spell either; this row pins that ccd's two swap
// refusals are read in one place, `ccdSwapRefusal` (`server/src/swapguard.ts`), off the declaration.
describe('the swap route spells its refusal words once (D-5240)', () => {
  it('SWAP_REFUSALS is exactly archive\'s session-busy and status-unknown, and hibernation\'s hibernated (D-5242)', () => {
    expect(SWAP_REFUSALS).toEqual({ sessionBusy: ARCHIVE_REFUSALS.sessionBusy, statusUnknown: ARCHIVE_REFUSALS.statusUnknown,
      hibernated: 'hibernated' });
  });
  it('ccd\'s swap refusals are read only by ccdSwapRefusal, in swapguard.ts', () => {
    const holders = ALL.filter((f) => /\bfunction ccdSwapRefusal\b/.test(readFileSync(f, 'utf8'))).map(rel);
    expect(holders).toEqual(['server/src/swapguard.ts']);
    expect(ALL.filter((f) => /`ccd: \$\{code\}:`/.test(readFileSync(f, 'utf8'))).map(rel)).toEqual(['server/src/swapguard.ts']);
  });
});


// D-5301 (plan docs/superpowers/plans/2026-10-17-coordinator-first-routing.md, Task 10; spec §8). APPENDED. The
// session role is enumerated once (`SESSION_ROLE_MAP`, its list derived by `Object.keys`), narrowed by one guard, and
// DERIVED once, by `sessionRoleOf` from the registry's `.child` reading; `server/src/fleet.ts` is the one place the
// wire field is computed, and it computes it through that function. Code lines only (`stallCode`).
describe('the session role is enumerated, narrowed and derived once, in shared/api.ts (D-5301)', () => {
  const holders = (re: RegExp): string[] => ALL.filter((f) => re.test(stallCode(f))).map(rel).sort();

  it('CONTROL: the patterns see a definition and pass over comment lines', () => {
    expect(/\bSESSION_ROLE_MAP\s*[:=]/.test('const SESSION_ROLE_MAP: Record<SessionRole, true> = {')).toBe(true);
    expect(/\bsessionRoleOf\s*=/.test('export const sessionRoleOf = (child) => x;')).toBe(true);
    expect(stallCodeText('// const SESSION_ROLE_MAP = {}\nconst x = 1;')).not.toMatch(/\bSESSION_ROLE_MAP\s*[:=]/);
  });

  it('SESSION_ROLE_MAP, SESSION_ROLES, isSessionRole and sessionRoleOf are each defined in shared/api.ts and nowhere else', () => {
    expect(holders(/\bSESSION_ROLE_MAP\s*[:=]/)).toEqual(['shared/api.ts']);
    expect(holders(/\bSESSION_ROLES\s*[:=]/)).toEqual(['shared/api.ts']);
    expect(holders(/\bfunction\s+isSessionRole\b|\bisSessionRole\s*=/)).toEqual(['shared/api.ts']);
    expect(holders(/\bfunction\s+sessionRoleOf\b|\bsessionRoleOf\s*=/)).toEqual(['shared/api.ts']);
  });

  it('SESSION_ROLES is derived from its map, never a hand-kept list', () => {
    const api = readFileSync(path.join(ccrcRoot, 'shared/api.ts'), 'utf8');
    expect(api).toMatch(/export const SESSION_ROLES: readonly SessionRole\[\] =\s*\n?\s*Object\.keys\(SESSION_ROLE_MAP\)/);
    expect(api).not.toMatch(/SESSION_ROLES[^=]*=\s*\[/);
  });

  it("the wire field is computed in server/src/fleet.ts only, through sessionRoleOf of the registry's child", () => {
    expect(holders(/\brole:\s*sessionRoleOf\(/)).toEqual(['server/src/fleet.ts']);
    expect(stallCode(path.join(ccrcRoot, 'server/src/fleet.ts'))).toMatch(/\brole:\s*sessionRoleOf\(r\.child\)/);
  });
});


// D-5298 (plan docs/superpowers/plans/2026-10-17-coordinator-first-routing.md, Task 11b; spec §6.4). APPENDED. The
// switch-over floor `RUNS_ATTRIBUTION_SINCE` (the first release tag carrying Task 11a's client) is defined once, in
// shared/api.ts, and read on a code line only by `fleetCarriesRunsAttribution`, defined once beside `buildAgreement`
// in server/src/fleetstate.ts; `POST /api/runs` (server/src/coord/routes.ts) is that function's one caller. Code
// lines only (`stallCode`).
describe('the runs-attribution switch-over is defined once, read once (D-5298)', () => {
  const holders = (re: RegExp): string[] => ALL.filter((f) => re.test(stallCode(f))).map(rel).sort();

  it('CONTROL: the patterns see a definition and a call, and pass over comment lines', () => {
    expect(/\bRUNS_ATTRIBUTION_SINCE\s*=/.test("export const RUNS_ATTRIBUTION_SINCE = 'v0.0.239';")).toBe(true);
    expect(/\bfleetCarriesRunsAttribution\(/.test('fleetCarriesAttribution: fleetCarriesRunsAttribution(')).toBe(true);
    expect(stallCodeText('// RUNS_ATTRIBUTION_SINCE = x\nconst x = 1;')).not.toMatch(/\bRUNS_ATTRIBUTION_SINCE\b/);
  });

  it('RUNS_ATTRIBUTION_SINCE is defined in shared/api.ts alone and read on a code line in fleetstate.ts alone', () => {
    expect(holders(/\bRUNS_ATTRIBUTION_SINCE\s*=/)).toEqual(['shared/api.ts']);
    expect(holders(/\bRUNS_ATTRIBUTION_SINCE\b/)).toEqual(['server/src/fleetstate.ts', 'shared/api.ts']);
  });

  it('fleetCarriesRunsAttribution is defined in fleetstate.ts and called by the open route alone', () => {
    expect(holders(/\bfunction\s+fleetCarriesRunsAttribution\b/)).toEqual(['server/src/fleetstate.ts']);
    expect(holders(/\bfleetCarriesRunsAttribution\(/)).toEqual(['server/src/coord/routes.ts', 'server/src/fleetstate.ts']);
  });
});


// CCRC HISTORY W1-B3 (spec 2026-10-05 §8.6, §9.11 O14): the card line's HOOK HALF. APPENDED after the last
// describe, with no import line, for the reason the blocks above state; lib is imported dynamically. The hook
// cannot import lib.mjs (no fork on the hook's path), so it spells the grammar, the cap and the two directory
// names once each, in bash, and this binds every one of those spellings to lib's single definition.
describe('ccrc history card line: the hook and lib spell one grammar, one cap and one prefix (spec 2026-10-05 §8.6, O14)', () => {
  const HOOK_SH = path.join(ccrcRoot, 'ccd', 'session-hook.sh');
  type Lib = Record<string, unknown>;
  const lib = async (): Promise<Lib> => (await import('../../../ccd/history/lib.mjs')) as unknown as Lib;
  /** The value of a top-level `NAME='…'` or `NAME="…"` or `NAME=<digits>` assignment, from code lines only. */
  const assigned = (lines: readonly string[], name: string): string[] =>
    lines.flatMap((l) => {
      const m = new RegExp(`^${name}=(?:'([^']*)'|"([^"]*)"|([0-9]+))$`).exec(l);
      return m ? [m[1] ?? m[2] ?? m[3]!] : [];
    });

  /** The hook spells its bracket ranges as explicit lists (D-5064: a range widens under a UTF-8 collating locale).
   *  This maps exactly those three lists back to lib's ranges and nothing else, so a list that loses or gains a
   *  character is no range and still differs from lib's pattern. */
  const lists = (re: string): string =>
    re.replaceAll('[0123456789abcdef]', '[0-9a-f]').replaceAll('[0123456789]', '[0-9]').replaceAll('[123456789]', '[1-9]');

  it('CONTROL: the extractor reads each quoting, and refuses an indented or commented line', () => {
    expect(assigned(["A='x y'", 'A="$HOME/z"', 'A=512'], 'A')).toEqual(['x y', '$HOME/z', '512']);
    expect(assigned(["  A='x'", "# A='x'", "AB='x'"], 'A')).toEqual([]);
    expect(codeLines(HOOK_SH).some((l) => l.startsWith('HISTORY_CARD_RE=')), 'the hook defines the grammar').toBe(true);
  });

  it('the hook\'s one HISTORY_CARD_RE literal is lib\'s CARD_LINE_PATTERN, character for character, and begins with CARD_PREFIX', async () => {
    const l = await lib();
    const defs = assigned(codeLines(HOOK_SH), 'HISTORY_CARD_RE');
    expect(defs, 'HISTORY_CARD_RE is assigned once, single-quoted').toHaveLength(1);
    expect(lists(defs[0]!)).toBe(l['CARD_LINE_PATTERN']);
    expect(defs[0]!.startsWith(`^${String(l['CARD_PREFIX'])}`)).toBe(true);
    expect((l['CARD_LINE_RE'] as RegExp).source).toBe(new RegExp(lists(defs[0]!)).source);
  });

  it('CONTROL: the list normaliser maps exactly the three lists, so a list that lost a character still differs from lib\'s ranges', () => {
    expect(lists('[0123456789abcdef]{8}[0123456789]x[123456789]')).toBe('[0-9a-f]{8}[0-9]x[1-9]');
    expect(lists('[012345678abcdef]')).toBe('[012345678abcdef]');
    expect(lists('[0123456789abcdeg]')).toBe('[0123456789abcdeg]');
    expect(lists('[0-9a-f]'), 'a range is not rewritten: it stays a range, which the reader scan refuses').toBe('[0-9a-f]');
  });

  it('the reader\'s UUID grammar is lib\'s UUID_RE (the lists, normalised), so the hook and the CLI accept one family of generations and session ids', async () => {
    const l = await lib();
    const lines = codeLines(HOOK_SH).filter((x) => /^\s*local uuid_re='/.test(x));
    expect(lines, 'uuid_re is assigned once, in the reader').toHaveLength(1);
    const re = /local uuid_re='([^']*)'/.exec(lines[0]!)![1]!;
    expect(new RegExp(lists(re)).source).toBe((l['UUID_RE'] as RegExp).source);
  });

  it('`History: ` is spelled on one hook code line, the grammar\'s', () => {
    expect(codeLines(HOOK_SH).filter((x) => x.includes('History: ')).map((x) => x.slice(0, x.indexOf('=')))).toEqual(['HISTORY_CARD_RE']);
  });

  it('HISTORY_CARD_MAX is CARD_LINE_MAX, and the read and the reserve are spelled from it, never as 512 or 513', async () => {
    const l = await lib();
    const code = codeLines(HOOK_SH);
    expect(assigned(code, 'HISTORY_CARD_MAX')).toEqual([String(l['CARD_LINE_MAX'])]);
    // The delegation spool's jq definitions (#448) spell its own 512-byte path bound, `def maxpath: 512;`, a different
    // quantity: that one token is set aside, and any other 512 or 513 on any line, that one included, still counts.
    expect(code.filter((x) => /(?<![\w.])51[23](?![\w.])/.test(x.replace('def maxpath: 512;', ''))), 'a hand-kept 512 or 513').toEqual([`HISTORY_CARD_MAX=${String(l['CARD_LINE_MAX'])}`]);
    const spelled = code.filter((x) => x.includes('HISTORY_CARD_MAX + 1'));
    expect(spelled.length, 'the read and the reserve').toBe(2);
    expect(spelled.some((x) => /\bread -r -N "\$\(\( HISTORY_CARD_MAX \+ 1 \)\)"/.test(x)), 'the read').toBe(true);
    expect(spelled.some((x) => /HISTORY_CARD_RESERVE=\$\(\( HISTORY_CARD_MAX \+ 1 \)\)$/.test(x)), 'the reserve').toBe(true);
  });

  it('the card and scope directories are spelled once each, under HISTORY_ROOT_REL, named as lib names them', async () => {
    const l = await lib();
    const code = codeLines(HOOK_SH);
    const root = String(l['HISTORY_ROOT_REL']);
    for (const [name, dir] of [['HISTORY_CARD_DIR', l['CARD_DIR']], ['HISTORY_SCOPE_DIR', l['SCOPE_DIR']]] as const) {
      expect(assigned(code, name), name).toEqual([`$HOME/${root}/${String(dir)}`]);
      expect(code.filter((x) => x.includes(`${root}/${String(dir)}`)), `${root}/${String(dir)} spelled twice`).toHaveLength(1);
    }
    expect(code.filter((x) => x.includes(`${root}/${String(l['RECALL_OFF_DIR'])}/`)), 'the recall-off path, once').toHaveLength(1);
  });

  it("SCOPE_MARKER_MAX_AGE_MS is the hook's COMPACT_CARD_MAX_AGE in ms: the window a consumption's marker is read within is the one the reader serves within (ruling RC3)", async () => {
    const l = await lib();
    const age = assigned(codeLines(HOOK_SH), 'COMPACT_CARD_MAX_AGE');
    expect(age, 'COMPACT_CARD_MAX_AGE is assigned once, in whole seconds').toHaveLength(1);
    expect(Number(age[0]) * 1000).toBe(l['SCOPE_MARKER_MAX_AGE_MS']);
  });
});


// D-5299 / D-5391 (plan docs/superpowers/plans/2026-10-17-coordinator-first-routing.md, Task 15). APPENDED. The
// children's deny list (`CHILD_DENY_RULES`), its path-qualified switch (`CHILD_DENY_PATH_QUALIFIED`) and the spawn
// record's two value shapes have one TypeScript home, `shared/api.ts`; the record's two readers have one,
// `server/src/registry.ts`. The installer's bash list is a documented second copy, held equal by iteration
// (`install-session-hooks.test.ts`), not by this text scan.
describe('the children\'s deny list, its switch and the spawn record\'s readers each have one home (D-5299, D-5391)', () => {
  const holders = (re: RegExp): string[] => ALL.filter((f) => re.test(stallCode(f))).map(rel).sort();
  const decl = (c: string): RegExp => new RegExp(`\\b(?:const|let|var|function)\\s+${c}\\b`);
  it('CONTROL: the pattern sees a declaration and passes over a use', () => {
    expect(decl('CHILD_DENY_RULES').test('export const CHILD_DENY_RULES: readonly string[] = [')).toBe(true);
    expect(decl('CHILD_DENY_RULES').test('expect(CHILD_DENY_RULES).toEqual(x);')).toBe(false);
  });
  it('each constant is declared once, in shared/api.ts', () => {
    for (const c of ['CHILD_DENY_RULES', 'childDenyRules', 'CHILD_DENY_PATH_QUALIFIED', 'DENY_SETTINGS_DIGEST', 'CHILD_SHELL_PATH']) {
      expect(holders(decl(c)), c).toEqual(['shared/api.ts']);
    }
  });
  it('each reader is declared once, in server/src/registry.ts', () => {
    for (const c of ['denySettingsOf', 'childShellOf']) expect(holders(decl(c)), c).toEqual(['server/src/registry.ts']);
  });
});


// D-5695 / D-5696 (plan docs/superpowers/plans/2026-10-19-claude-binary-lifecycle-w1-observe.md, CB1a's Frozen clause,
// carried into CB1b). The Claude Code build grammar and the version-untrusted floor are defined once, in
// `shared/claudeVersion.ts`. Comment lines are skipped (`stallCodeText`): a sentence ABOUT the floor is not a copy of
// it. `liveStatusCoversDelegation` (`server/src/livestate.ts`) asks the lexicon rather than parsing and comparing on
// its own.
describe('the Claude Code version grammar and its floor are defined once, in shared/claudeVersion.ts (D-5695, D-5696)', () => {
  const FLOOR = /(?<![\d.])2\.1\.277(?![\d.])/;
  const BODY = String.raw`(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)`;
  it('CONTROL: the scan sees a code line and passes over a comment line', () => {
    expect(FLOOR.test(stallCodeText("const F = '2.1.277';"))).toBe(true);
    expect(FLOOR.test(stallCodeText(' * below 2.1.277 (unmeasured)'))).toBe(false);
    expect(FLOOR.test('2.1.2770')).toBe(false);
  });
  it('the floor is defined once: one code line in the four roots spells 2.1.277', () => {
    const holders = ALL.filter((f) => FLOOR.test(stallCode(f))).map(rel).sort();
    expect(holders).toEqual(['shared/claudeVersion.ts']);
  });
  it('the grammar\'s body is spelled once, and livestate parses no version of its own', () => {
    const holders = ALL.filter((f) => stallCode(f).includes(BODY)).map(rel).sort();
    expect(holders).toEqual(['shared/claudeVersion.ts']);
    const live = stallCode(path.join(ccrcRoot, 'server', 'src', 'livestate.ts'));
    expect(live).not.toMatch(/\(\\d\+\)\\\.\(\\d\+\)/);
    expect(live).toMatch(/from '\.\.\/\.\.\/shared\/claudeVersion\.js'/);
  });
});


// D-5242 (`hibernate-long-idle-sessions`, plan Task 17a). APPENDED, for the reason the stall-watch blocks above state.
// Hibernation's four operator settings — `hibernate-live`, `hibernate-disabled`, `hibernate-after-hours` and the
// per-session `<id>.no-hibernate` — are touched and removed BY HAND in `$REG`, like `stall-watch-disabled`: nothing in
// the tree writes one. The TS half: the one file that spells each on a code line is its definer, an L1 file that
// reaches no `node:` module and so cannot write it, and the files that name its constant reach no write either. The
// shell half asks for no WRITER, not no holder: plan Task 16's `cmd_hibernate` reads `.no-hibernate` at the act, and a
// read is not a write. The hold list is spelled once.
describe('D-5242: hibernation’s markers have no writer, and its holds one home', () => {
  const DEFINER = 'server/src/coord/hibernate.ts';
  /** D-5855: the two switches are rows of the switchboard, which defines them; `hibernate.ts` re-exports them. The
   *  hours file and the per-session suffix stay in `hibernate.ts`. */
  const SWITCH_DEFINER = 'shared/switches.ts';
  const definerOf = (name: string): string =>
    (name === 'hibernate-live' || name === 'hibernate-disabled' ? SWITCH_DEFINER : DEFINER);
  const MARKERS = [
    ['hibernate-live', 'HIBERNATE_LIVE_MARKER'], ['hibernate-disabled', 'HIBERNATE_DISABLED_MARKER'],
    ['hibernate-after-hours', 'HIBERNATE_AFTER_HOURS_FILE'], ['no-hibernate', 'NO_HIBERNATE_SUFFIX'],
  ] as const;
  const SHELL_WRITE = /(?:>>?|\btouch\b|\btee\b|\b_reg_set\b|\bprintf\b[^|]*>|\bcp\b|\bmv\b|\bln\b|\binstall\b)/;
  const TS_WRITE = /\b(?:writeFile|appendFile|rename|symlink|copyFile|mkdir|truncate|unlink|rm)(?:Sync)?\s*\(|\.write\w*\s*\(/;
  it.each(MARKERS)('%s: no line of shell writes it', (name) => {
    expect(SHELL_WRITE.test(`touch "$REG/${name}"`), 'CONTROL: the pattern sees a write').toBe(true);
    const writers = BASH.flatMap((f) => codeLines(f).filter((l) => l.includes(name) && SHELL_WRITE.test(l)).map((l) => `${rel(f)}: ${l.trim()}`));
    expect(writers, `${name}: a line of shell writes it`).toEqual([]);
  });
  it.each(MARKERS)('%s: its one TS holder is its definer, which reaches no node: module', (name) => {
    // `hibernate-live` and `hibernate-disabled` contain no other marker; `no-hibernate` is not a substring of the three
    // `hibernate-…` names, so each scan finds its own word only.
    expect(ALL.filter((f) => stallCode(f).includes(`'${name}'`) || stallCode(f).includes(`"${name}"`)
      || stallCode(f).includes(`\`${name}`) || stallCode(f).includes(`/${name}`)).map(rel).sort(),
    `${name} spelled on a code line outside ${definerOf(name)}`).toEqual([definerOf(name)]);
    expect(stallCode(path.join(ccrcRoot, definerOf(name)))).not.toMatch(/from\s+['"]node:|import\s*\(\s*['"]node:|\brequire\s*\(/);
  });
  it.each(MARKERS)('%s: the files that name its constant reach no write', (name, constant) => {
    const holders = ALL.filter((f) => stallCode(f).includes(constant)).map(rel).sort();
    expect(holders, `${constant}: nobody names it`).toContain(definerOf(name));
    for (const f of holders) expect(stallCode(path.join(ccrcRoot, f)), `${f} reaches a write`).not.toMatch(TS_WRITE);
  });
  it('HIBERNATE_HOLDS, its map and its constants are declared once, in the definer', async () => {
    for (const c of ['HIBERNATE_HOLDS', 'HIBERNATE_HOLD_MAP', 'HIBERNATE_AFTER_MS_DEFAULT', 'HIBERNATE_SWEEP_MS',
      'HIBERNATE_SHADOW_LINE_MS', 'HIBERNATE_AFTER_HOURS_MIN', 'HIBERNATE_AFTER_HOURS_MAX',
      ...MARKERS.map(([, k]) => k)]) {
      const decl = new RegExp(`\\b(?:const|let|var)\\s+${c}\\b`);
      const home = MARKERS.find(([, k]) => k === c)?.[0];
      // The cadence is the `sleepIdleHours` row's, declared in the L0 lane table and re-exported by the definer (D-7045).
      expect(ALL.filter((f) => decl.test(stallCode(f))).map(rel), c)
        .toEqual([c === 'HIBERNATE_SWEEP_MS' ? 'server/src/laneSchedule.ts' : home === undefined ? DEFINER : definerOf(home)]);
    }
    const [lane, table] = await Promise.all([import('../../src/coord/hibernate.js'), import('../../src/laneSchedule.js')]);
    expect(lane.HIBERNATE_SWEEP_MS, 'the definer re-exports the table\'s constant').toBe(table.HIBERNATE_SWEEP_MS);
  });
  it('PRESENCE_OPEN_TTL_MS is declared once, in shared/api.ts beside PRESENCE_TTL_MS', () => {
    const decl = /\b(?:const|let|var)\s+PRESENCE_OPEN_TTL_MS\b/;
    expect(ALL.filter((f) => decl.test(stallCode(f))).map(rel)).toEqual(['shared/api.ts']);
  });
});


// D-6631 (fleet disk retention DR-19; spec 2026-10-23 sections 2.3 and 4). The orphan-worktree lane ships SHADOW behind two
// markers, `orphan-tree-live` and `orphan-tree-rescue-live`, set BY HAND in `$REG`. Nothing in the tree writes either:
// the one file that spells each on a code line is the switchboard (L0, no `node:` import), and every file that names its
// constant reaches no write. The verb's argv has one composing site, and `--force` has none.
describe('D-6631: the orphan lane\'s markers have no writer, and its verb one composer', () => {
  const DEFINER = 'shared/switches.ts';
  const MARKERS = [['orphan-tree-live', 'ORPHAN_TREE_LIVE_MARKER'], ['orphan-tree-rescue-live', 'ORPHAN_TREE_RESCUE_LIVE_MARKER']] as const;
  const SHELL_WRITE = /(?:>>?|\btouch\b|\btee\b|\b_reg_set\b|\bprintf\b[^|]*>|\bcp\b|\bmv\b|\bln\b|\binstall\b)/;
  const TS_WRITE = /\b(?:writeFile|appendFile|rename|symlink|copyFile|mkdir|truncate|unlink|rm)(?:Sync)?\s*\(|\.write\w*\s*\(/;
  it.each(MARKERS)('%s: no line of shell writes it', (name) => {
    expect(SHELL_WRITE.test(`touch "$REG/${name}"`), 'CONTROL: the pattern sees a write').toBe(true);
    const writers = BASH.flatMap((f) => codeLines(f).filter((l) => l.includes(name) && SHELL_WRITE.test(l)).map((l) => `${rel(f)}: ${l.trim()}`));
    expect(writers, `${name}: a line of shell writes it`).toEqual([]);
  });
  it.each(MARKERS)('%s: its one TS holder is the switchboard, which reaches no node: module', (name) => {
    expect(ALL.filter((f) => stallCode(f).includes(`'${name}'`) || stallCode(f).includes(`"${name}"`)
      || stallCode(f).includes(`\`${name}`) || stallCode(f).includes(`/${name}`)).map(rel).sort(),
    `${name} spelled on a code line outside ${DEFINER}`).toEqual([DEFINER]);
    expect(stallCode(path.join(ccrcRoot, DEFINER))).not.toMatch(/from\s+['"]node:|import\s*\(\s*['"]node:|\brequire\s*\(/);
  });
  it.each(MARKERS)('%s: the files that name its constant reach no write', (_name, constant) => {
    const holders = ALL.filter((f) => stallCode(f).includes(constant)).map(rel).sort();
    expect(holders, `${constant}: nobody names it`).toContain(DEFINER);
    for (const f of holders) expect(stallCode(path.join(ccrcRoot, f)), `${f} reaches a write`).not.toMatch(TS_WRITE);
  });
  it('CCD_ARGV.wsOrphan is composed by the executor alone, and nothing composes --force beside it', () => {
    const composers = ALL.filter((f) => stallCode(f).includes('CCD_ARGV.wsOrphan(')).map(rel).sort();
    expect(composers).toEqual(['server/src/coord/collectOrphanTree.ts']);
    for (const f of ['server/src/orphanTreeLane.ts', 'server/src/coord/collectOrphanTree.ts', 'server/src/orphanTreeSweep.ts']) {
      expect(stallCode(path.join(ccrcRoot, f)), `${f} spells --force`).not.toContain('--force');
    }
  });
});


// D-5242 (plan Task 17b). APPENDED, for the reason the stall-watch blocks above state. The wake budget has one home
// (`coord/wakeBudget.ts`, its rule and its two figures) and ONE list it is applied to (`FleetWatcher.admitWake`, the only
// caller of `wakeAdmit`); the live act's constants are hibernation's definer's, and each lane's declared actor is
// spelled once, in its own L1 file.
describe('D-5242: the wake budget and the live act have one home each (Task 17b)', () => {
  const decl = (c: string): RegExp => new RegExp(`\\b(?:const|let|var)\\s+${c}\\b`);
  it.each([
    ['WAKE_BURST', 'server/src/coord/wakeBudget.ts'], ['WAKE_WINDOW_MS', 'server/src/coord/wakeBudget.ts'],
    ['HIBERNATE_PER_SWEEP', 'server/src/coord/hibernate.ts'], ['HIBERNATE_ACT_LINE_MS', 'server/src/coord/hibernate.ts'],
    ['HIBERNATE_SWEEP_ACTOR', 'server/src/coord/hibernate.ts'], ['STOP_DONE_ACTOR', 'server/src/stopDone.ts'],
    ['MAIL_WAKE_FLOOR_MS', 'server/src/watch.ts'],
  ])('%s is declared once, in %s', (c, home) => {
    expect(ALL.filter((f) => decl(c).test(stallCode(f))).map(rel), c).toEqual([home]);
  });
  it('wakeAdmit is defined once and applied by the watcher alone: one window for the server', () => {
    expect(ALL.filter((f) => /\bexport function wakeAdmit\b/.test(stallCode(f))).map(rel)).toEqual(['server/src/coord/wakeBudget.ts']);
    expect(ALL.filter((f) => /\bwakeAdmit\(/.test(stallCode(f)) && !/\bexport function wakeAdmit\b/.test(stallCode(f))).map(rel))
      .toEqual(['server/src/watch.ts']);
  });
  it('the lanes\' actor words are code-line literals in their definers alone', () => {
    for (const [word, home] of [['sweep:hibernate', 'server/src/coord/hibernate.ts'], ['sweep:stop-done', 'server/src/stopDone.ts']] as const) {
      expect(ALL.filter((f) => stallCode(f).includes(`'${word}'`)).map(rel), word).toEqual([home]);
    }
  });
});


// D-5297 / D-5299 (plan docs/superpowers/plans/2026-10-17-coordinator-first-routing.md, Task 14). APPENDED. The
// approval wait's constants and the two canonical forms have one TypeScript home, `shared/api.ts`. Their documented
// second copies are held equal by iteration, never by this text scan: the hook's bash copies of the wait ceiling,
// the stop states and the digest's jq program (`session-hook-approval-wait.test.ts`, over `digest-corpus.json`), the
// hook's forbidden match (`session-hook-approval-deny.test.ts`, over Task 12's corpus), and the verifier's canonical
// form (`approval-verify.test.ts`, over a record corpus).
describe('the approval wait\'s constants and canonical forms each have one home (D-5297, D-5299)', () => {
  const holders = (re: RegExp): string[] => ALL.filter((f) => re.test(stallCode(f))).map(rel).sort();
  const decl = (c: string): RegExp => new RegExp(`\\b(?:const|let|var|function)\\s+${c}\\b`);
  it('CONTROL: the pattern sees a declaration and passes over a use', () => {
    expect(decl('approvalDigestBytes').test('export function approvalDigestBytes(hookInput) {')).toBe(true);
    expect(decl('approvalDigestBytes').test('const c = approvalDigestBytes(payload);')).toBe(false);
  });
  it('each is declared once, in shared/api.ts', () => {
    for (const c of ['APPROVAL_HOOK_WAIT_S', 'APPROVAL_HOOK_VERSIONS', 'APPROVAL_CWD_TRUSTED', 'APPROVAL_HOOK_STOP_STATES',
      'APPROVAL_SIGNING_PUB_FILE', 'APPROVAL_SIGNING_KEY_FILE', 'APPROVAL_REQUEST_MAX_BYTES', 'canonicalJson',
      'approvalDigestBytes', 'approvalRulingBytes']) {
      expect(holders(decl(c)), c).toEqual(['shared/api.ts']);
    }
  });
});


// D-5298 / D-5441 (plan docs/superpowers/plans/2026-10-17-coordinator-first-routing.md, Task 16). APPENDED. The
// approvals server half's vocabulary and constants each have one TypeScript home: the state map, the retention, the
// release reasons, the refusal words and the three file names in `shared/api.ts`; the countdown window and its one
// selection in `server/src/askwindow.ts` beside `ASK_GRACE_MS`; the claimant decision both lanes read in
// `server/src/coord/heldFor.ts`. The doctor's bash spelling of the journal's name and the deny file's are documented
// second copies, held by `approvals-doctor.test.ts` and `approvals-routes.test.ts`, which import the TypeScript ones.
describe('the approvals server half\'s vocabulary and windows each have one home (D-5298, D-5441)', () => {
  const holders = (re: RegExp): string[] => ALL.filter((f) => re.test(stallCode(f))).map(rel).sort();
  const decl = (c: string): RegExp => new RegExp(`\\b(?:const|let|var|function)\\s+${c}\\b|\\btype\\s+${c}\\s*=`);
  it('CONTROL: the pattern sees a declaration and passes over a use', () => {
    expect(decl('ApprovalState').test('import { type ApprovalState, isApprovalState } from')).toBe(false);
    expect(decl('approvalWindowMs').test('export function approvalWindowMs(agentId: string): number {')).toBe(true);
    expect(decl('approvalWindowMs').test('const notifyAt = now + approvalWindowMs(agentId);')).toBe(false);
  });
  it('the shared vocabulary is declared once, in shared/api.ts', () => {
    for (const c of ['APPROVAL_STATE_MAP', 'ApprovalState', 'isApprovalState', 'APPROVAL_INPUT_RETENTION_DAYS',
      'ApprovalReleaseReason', 'APPROVAL_RELEASE_REASON_MAP', 'ApprovalRefusal', 'APPROVAL_REASON_MAX_CHARS',
      'CHILD_DENY_SETTINGS_FILE', 'APPROVAL_CHILD_SHELL', 'APPROVAL_REFUSALS_LOG']) {
      expect(holders(decl(c)), c).toEqual(['shared/api.ts']);
    }
  });
  it('the countdown window and its selection live beside ASK_GRACE_MS', () => {
    for (const c of ['APPROVAL_COUNTDOWN_WINDOW_MS', 'approvalWindowMs', 'ASK_GRACE_MS']) {
      expect(holders(decl(c)), c).toEqual(['server/src/askwindow.ts']);
    }
  });
  it('the one claimant decision lives in coord/heldFor.ts, and the hold and the mint both read it', () => {
    expect(holders(decl('heldFor'))).toEqual(['server/src/coord/heldFor.ts']);
    // The raise ladder's call moved into `coord/questions.ts` (`raiseApproval`, D-7029; W3 Q3e, named exception 2), and
    // so did the hold's (`raise`, D-7028; W3 Q3d, named exception 2), so `watch.ts` leaves the list; the rule handler's
    // call keeps `coord/routes.ts` in it until Q3f.
    expect(holders(/\bheldFor\(/)).toEqual(['server/src/coord/heldFor.ts', 'server/src/coord/questions.ts', 'server/src/coord/routes.ts']);
  });
  it('the 60 000 ms window is spelled nowhere but its home', () => {
    expect(holders(/\b60_000\b[^\n]*(?:approval|countdown)|(?:approval|countdown)[^\n]*\b60_000\b/i)).toEqual(['server/src/askwindow.ts']);
  });
});


// D-5300 (plan docs/superpowers/plans/2026-10-17-coordinator-first-routing.md, Task 17). APPENDED. The daily digest
// has one TypeScript home for each of its decisions: the default hour, its override reader, the window, the two
// "is this a coordinator's decision" predicates the digest AND the correction route read, the build and the mail's
// subject in `server/src/coord/digest.ts`; its wire vocabulary in `shared/api.ts`.
describe('the daily digest\'s hour, predicates and vocabulary each have one home (D-5300)', () => {
  const holders = (re: RegExp): string[] => ALL.filter((f) => re.test(stallCode(f))).map(rel).sort();
  const decl = (c: string): RegExp => new RegExp(`\\b(?:const|let|var|function)\\s+${c}\\b|\\btype\\s+${c}\\s*=|\\binterface\\s+${c}\\b`);
  it('CONTROL: the pattern sees a declaration and passes over a use', () => {
    expect(decl('DigestLine').test('import { type DigestLine, type DigestTotals } from')).toBe(false);
    expect(decl('DIGEST_HOUR_UTC').test('export const DIGEST_HOUR_UTC = 7;')).toBe(true);
    expect(decl('DIGEST_HOUR_UTC').test('return DIGEST_HOUR_UTC;')).toBe(false);
    expect(decl('DigestLine').test('export interface DigestLine {')).toBe(true);
  });
  it('the hour, the window and the predicates live in coord/digest.ts', () => {
    for (const c of ['DIGEST_HOUR_UTC', 'readDigestHour', 'digestWindow', 'digestDayFor', 'parseDigestDay', 'askDecision',
      'approvalDecision', 'buildDigest', 'digestPushCopy', 'digestCorrectionSubject', 'correctDigestRow', 'isDigestKebab']) {
      expect(holders(decl(c)), c).toEqual(['server/src/coord/digest.ts']);
    }
  });
  it('the wire vocabulary is declared once, in shared/api.ts', () => {
    for (const c of ['DigestLine', 'DIGEST_LINE_KINDS', 'DigestLineKind', 'DigestRowKind', 'DigestTotals', 'DigestAnswer', 'DigestCorrectBody',
      'DigestCorrectAnswer', 'DIGEST_REFUSALS', 'DigestRefusal', 'DIGEST_HOUR_FILE', 'DIGEST_CORRECTION_MAX_CHARS',
      'DIGEST_COMMAND_CHARS']) {
      expect(holders(decl(c)), c).toEqual(['shared/api.ts']);
    }
  });
  it('the correction subject and the override file name are spelled nowhere but their homes', () => {
    expect(holders(/Operator correction on/)).toEqual(['server/src/coord/digest.ts']);
    expect(holders(/'digest-hour'/)).toEqual(['shared/api.ts']);
  });
  it('the digest and the correction read the same two predicates', () => {
    expect(holders(/\baskDecision\(/)).toEqual(['server/src/coord/digest.ts']);
    const src = stallCode(path.join(ccrcRoot, 'server', 'src', 'coord', 'digest.ts'));
    expect(src.match(/\baskDecision\(/g)).toHaveLength(3);
    expect(src.match(/\bapprovalDecision\(/g)).toHaveLength(3);
  });
});


// D-5511, D-5516 (plan docs/superpowers/plans/2026-10-18-accounts-connect.md, Task A7). APPENDED. The account gate,
// the audit and the AccountOps port: the sub union, the acts, the outcomes, the key-plane codes, the gate's refusal
// words, the retention, the sub bounds and the origin class each have one home in `shared/api.ts`; the gate, the audit
// writer and the arm choice each have one home under `server/src/accounts/`; and the table's name is spelled only by
// its migration and its writer.
describe('the account gate, the audit and the AccountOps port each have one home (D-5511, D-5516)', () => {
  const holders = (re: RegExp): string[] => ALL.filter((f) => re.test(stallCode(f))).map(rel).sort();
  const decl = (c: string): RegExp => new RegExp(`\\b(?:const|let|var|function|class)\\s+${c}\\b|\\btype\\s+${c}\\s*=|\\binterface\\s+${c}\\b`);
  it('CONTROL: the pattern sees a declaration and passes over a use', () => {
    expect(decl('ACCOUNT_SUBS').test('export const ACCOUNT_SUBS = [')).toBe(true);
    expect(decl('ACCOUNT_SUBS').test("import { ACCOUNT_SUBS } from '../../shared/api.js';")).toBe(false);
    expect(decl('AccountAudit').test('export class AccountAudit {')).toBe(true);
    expect(decl('AccountAudit').test('const audit = new AccountAudit(coord.db);')).toBe(false);
  });
  it('the vocabulary is declared once, in shared/api.ts', () => {
    for (const c of ['ACCOUNT_SUBS', 'AccountSub', 'ACCOUNT_SUB_TIMEOUT_MS', 'ACCOUNT_OP_KILL_GRACE_MS', 'ACCOUNT_OP_OUTPUT_MAX_BYTES',
      'ACCOUNT_ACTS', 'AccountAct', 'ACCOUNT_LANELESS_ACTS', 'ACCOUNT_OUTCOMES', 'AccountOutcome', 'ACCOUNT_KEY_PLANE_CODES',
      'AccountKeyPlaneCode', 'ACCOUNT_AUDIT_RETENTION_DAYS', 'ACCOUNT_GATE_REFUSALS', 'AccountGateRefusal', 'AccountOriginClass']) {
      expect(holders(decl(c)), c).toEqual(['shared/api.ts']);
    }
  });
  it('the gate, the audit and the port each live in their one file', () => {
    for (const c of ['createAccountGate', 'accountOriginClass', 'AccountGateDeps', 'AccountGate']) {
      expect(holders(decl(c)), c).toEqual(['server/src/accounts/gate.ts']);
    }
    for (const c of ['AccountAudit', 'actorOf', 'AccountActor', 'knownFleetIdentity', 'AccountEventInput']) {
      expect(holders(decl(c)), c).toEqual(['server/src/accounts/audit.ts']);
    }
    for (const c of ['AccountOps', 'accountOpsFor', 'accountSpawnEnv', 'localAccountOps', 'remoteAccountOps', 'AccountOpResult']) {
      expect(holders(decl(c)), c).toEqual(['server/src/accounts/ops.ts']);
    }
  });
  it('the table is named only by its migration and its writer', () => {
    expect(holders(/\baccount_events\b/)).toEqual(['server/src/accounts/audit.ts', 'server/src/coord/schema.ts']);
  });
  it('the arm is chosen in one place, and constructed by the composition root alone', () => {
    expect(holders(/\baccountOpsFor\(/)).toEqual(['server/src/accounts/ops.ts', 'server/src/index.ts']);
    expect(holders(/\blocalAccountOps\(/)).toEqual(['server/src/accounts/ops.ts']);
  });
});


// D-5517, D-5518, D-5513 (plan docs/superpowers/plans/2026-10-18-accounts-connect.md, Task A12). The state word, its
// thresholds and the lane-state grammar have one home in `shared/accounts.ts`, L0 beside the words; the wire shapes one
// in `shared/api.ts`; the roster is swapped by `reloadRoster` alone; reconcile, the lanes wire and the lane-state read
// each have one file.
describe('the state word, the roster reload and the lanes wire each have one home (D-5517, D-5518)', () => {
  const holders = (re: RegExp): string[] => ALL.filter((f) => re.test(stallCode(f))).map(rel).sort();
  const decl = (c: string): RegExp => new RegExp(`\\b(?:const|let|var|function|class)\\s+${c}\\b|\\btype\\s+${c}\\s*=|\\binterface\\s+${c}\\b`);
  it('CONTROL: the pattern sees a declaration and passes over a use', () => {
    expect(decl('stateWordFor').test('export function stateWordFor(i: StateWordInput): AccountStateAnswer {')).toBe(true);
    expect(decl('stateWordFor').test('state: stateWordFor({ disabled, authDead })')).toBe(false);
    expect(/\bcfg\.roster\s*=(?!=)/.test('    cfg.roster = roster;')).toBe(true);
    expect(/\bcfg\.roster\s*=(?!=)/.test('if (ownRosterFpOf?.roster !== deps.cfg.roster)')).toBe(false);
  });
  it('the words, their thresholds and the lane-state grammar are declared once, in shared/accounts.ts', () => {
    for (const c of ['stateWordFor', 'ACCOUNT_STATE_WORDS', 'AccountStateWord', 'AccountStateAnswer', 'StateWordInput',
      'SIGNED_IN_WITHIN_MS', 'MINTED_TOKEN_LIFETIME_MS', 'MINTED_TOKEN_EXPIRING_MS', 'CREDIT_EXPIRING_FRACTION',
      'MINTED_KEY_EXPIRING_MS', 'WINDOW_LIMITED_PCT', 'LaneState', 'LaneStateRead', 'laneStateOf', 'laneNotReadyReason',
      'KEY_HINT_RE', 'LANE_IDENTITY_MAX']) {
      expect(holders(decl(c)), c).toEqual(['shared/accounts.ts']);
    }
  });
  it('the wire shapes are declared once, in shared/api.ts', () => {
    for (const c of ['LaneWire', 'AccountsConnect', 'LANE_NOT_READY_REASONS', 'LaneNotReadyReason', 'ACCOUNT_CAPS', 'AccountCap']) {
      expect(holders(decl(c)), c).toEqual(['shared/api.ts']);
    }
  });
  it('the roster is swapped in one place, and reconcile, the lanes wire and the lane-state read each live in one file', () => {
    expect(holders(/\bcfg\.roster\s*=(?!=)/)).toEqual(['server/src/config.ts']);
    for (const c of ['reloadRoster', 'rosterAnswerOf', 'RosterAnswer']) expect(holders(decl(c)), c).toEqual(['server/src/config.ts']);
    expect(holders(decl('reconcilingAccountOps'))).toEqual(['server/src/accounts/reconcile.ts']);
    for (const c of ['lanesWire', 'accountsConnect']) expect(holders(decl(c)), c).toEqual(['server/src/accounts/lanes.ts']);
    expect(holders(decl('readLaneStates'))).toEqual(['server/src/limits.ts']);
    expect(holders(decl('LANE_STATE_DIR_NAME'))).toEqual(['shared/agent-protocol.ts']);
  });
});


// D-5513, D-5622 (plan docs/superpowers/plans/2026-10-18-accounts-connect.md, Task A8). APPENDED. The agent's typed
// `account` op: the argv builder and its bounds have one home in `shared/account-argv.ts`, which BOTH `AccountOps`
// arms call; the op's wire vocabulary and the node-id grammar one home in `shared/agent-protocol.ts`; the agent's
// spawn port one home in `agent/src/accountop.ts`.
describe("the account op's builder, wire vocabulary and spawn port each have one home (D-5513, D-5622)", () => {
  const holders = (re: RegExp): string[] => ALL.filter((f) => re.test(stallCode(f))).map(rel).sort();
  const decl = (c: string): RegExp => new RegExp(`\\b(?:const|let|var|function|class)\\s+${c}\\b|\\btype\\s+${c}\\s*=|\\binterface\\s+${c}\\b`);
  it('CONTROL: the pattern sees a declaration and passes over a use', () => {
    expect(decl('buildAccountArgv').test('export function buildAccountArgv(sub: unknown')).toBe(true);
    expect(decl('buildAccountArgv').test('const built = buildAccountArgv(sub, id, fields, false);')).toBe(false);
  });
  it('the builder and its bounds are declared once, in shared/account-argv.ts', () => {
    for (const c of ['ACCOUNT_ARGV_REFUSALS', 'AccountArgvRefusal', 'ACCOUNT_SUB_ARGV', 'ACCOUNT_STDIN_MAX_BYTES', 'buildAccountArgv',
      'isAccountStdin', 'isAccountLaneId', 'isAccountSub', 'AccountArgvBuilt']) {
      expect(holders(decl(c)), c).toEqual(['shared/account-argv.ts']);
    }
  });
  it('the wire vocabulary and the node-id grammar are declared once, in shared/agent-protocol.ts', () => {
    for (const c of ['ACCOUNT_OP', 'AccountOpReq', 'AccountOpOutcome', 'AccountOpAnswer', 'readAccountOpAnswer',
      'accountOpRequestTimeoutMs', 'ACCOUNT_OP_DRAIN_MS', 'NODE_ID_RE']) {
      expect(holders(decl(c)), c).toEqual(['shared/agent-protocol.ts']);
    }
  });
  it("the agent's spawn port lives in agent/src/accountop.ts", () => {
    for (const c of ['makeAccountOpSpawn', 'AccountOpSpawn', 'AccountSpawnBounds', 'accountSpawnBounds', 'decodeAccountStdin', 'readFleetIdentity']) {
      expect(holders(decl(c)), c).toEqual(['agent/src/accountop.ts']);
    }
  });
  it('one builder for both arms: it is called by the agent op and the server port, and nowhere else', () => {
    expect(holders(/\bbuildAccountArgv\(/)).toEqual(['agent/src/server.ts', 'server/src/accounts/ops.ts', 'shared/account-argv.ts']);
    expect(holders(/\breadAccountOpAnswer\(/)).toEqual(['server/src/accounts/ops.ts', 'shared/agent-protocol.ts']);
  });
});


// D-5935 (plan docs/superpowers/plans/2026-10-20-sheet-desktop-arm-and-session-workflow-controls-.md, Task P3-6a).
// Inserted here, above every open PR's hunk and below every line cited by number. Which workflow controls a Claude
// Code version has is server-only knowledge: `WORKFLOW_CONTROLS`, its recipe and drive types and its slot list are
// declared once, in server/src/workflows/controls.ts, so the table never reaches `shared/` (the PWA bundle) or the PWA
// itself, where the PWA would start deciding what a version can do. The act names are the wire's, declared once in
// shared/workflows.ts.
describe('the workflow-control table is defined once, in server/src (D-5935)', () => {
  const holders = (re: RegExp, planted: readonly (readonly [string, string])[] = []): string[] =>
    [...ALL.map((f) => [rel(f), stallCode(f)] as const), ...planted].filter(([, t]) => re.test(t)).map(([p]) => p).sort();
  const decl = (c: string): RegExp => new RegExp(`\\b(?:const|let|var|function|class)\\s+${c}\\b|\\btype\\s+${c}\\s*=|\\binterface\\s+${c}\\b`);
  const SERVER_ONLY = ['WORKFLOW_CONTROLS', 'WORKFLOW_CONTROL_SLOTS', 'WorkflowControlSlot', 'WorkflowControlDrive',
    'WorkflowControlRecipe', 'WorkflowControlTable'] as const;
  it('CONTROL: the pattern sees a declaration and passes over a use; a copy in shared/ is seen beside the original', () => {
    expect(decl('WORKFLOW_CONTROLS').test('export const WORKFLOW_CONTROLS: WorkflowControlTable = {};')).toBe(true);
    expect(decl('WorkflowControlDrive').test('export type WorkflowControlDrive =')).toBe(true);
    expect(decl('WORKFLOW_CONTROLS').test('const recipe = WORKFLOW_CONTROLS[version];')).toBe(false);
    expect(holders(decl('WORKFLOW_CONTROLS'), [['shared/workflows.ts', 'export const WORKFLOW_CONTROLS = {};']]))
      .toEqual(['server/src/workflows/controls.ts', 'shared/workflows.ts']);
  });
  it('the table and its types are declared once, in server/src/workflows/controls.ts', () => {
    for (const c of SERVER_ONLY) expect(holders(decl(c)), c).toEqual(['server/src/workflows/controls.ts']);
  });
  it('WorkflowControlAct is declared once, in shared/workflows.ts', () => {
    expect(holders(decl('WorkflowControlAct'))).toEqual(['shared/workflows.ts']);
  });
  it('nothing under shared/ or pwa/ names the table', () => {
    expect(holders(/\bWORKFLOW_CONTROLS\b/).filter((p) => !p.startsWith('server/src/'))).toEqual([]);
  });
});


// Docs W5 part 1, Task 1 (spec 2026-10-01 3.11, amended 2026-10-13): the permalink builder, its answer type and the
// one private URL assembler are declared once, in shared/docs.ts. A second `githubUrlAt` anywhere in the four roots
// is a second assembler (M3.17's drift), and a second `githubPermalink` is a second Share link rule. APPENDED after
// the file's last line, as its own describe: `session-hook.test.ts`'s citation audit cites this file by line, so the
// docs section H block's TYPES and FUNCTIONS lists above are never edited. The same two declaration patterns as that
// block, with a planted CONTROL: a third file holding a copy makes the holder list two long.
// The function pattern accepts `async`, `default` and `declare` (and a generator star) before `function`, with a
// planted control for each. It is a line-anchored regex, NOT EXHAUSTIVE, and not a parser: the evasions it still
// misses are listed in the second CONTROL below (a method, a re-export, a CommonJS assignment, a copy in a comment or
// string, a function expression bound by none of `const`, `let` or `var`).
describe('docs section H, W5: GithubPermalink, githubPermalink and githubUrlAt are declared once, in shared/docs.ts', () => {
  const TYPES = ['GithubPermalink'] as const;
  const FUNCTIONS = ['githubPermalink', 'githubUrlAt'] as const;
  const TYPE_DEF = (name: string): RegExp =>
    new RegExp(`^\\s*(?:export\\s+)?(?:declare\\s+)?(?:type\\s+${name}\\b\\s*(?:<[^>\\n]*>)?\\s*=|interface\\s+${name}\\b)`, 'm');
  // Any run of `export`, `default`, `declare` and `async` before `function [*] NAME` or `const|let|var NAME`.
  const FN_DEF = (name: string): RegExp =>
    new RegExp(`^\\s*(?:(?:export|default|declare|async)\\s+)*(?:function(?:\\s*\\*\\s*|\\s+)${name}\\b|(?:const|let|var)\\s+${name}\\b)`, 'm');
  // The holders of a declaration over the four roots, plus any planted [path, text] pairs, sorted.
  const holders = (def: RegExp, planted: readonly (readonly [string, string])[] = []): string[] =>
    [...ALL.map((f) => [rel(f), readFileSync(f, 'utf8')] as const), ...planted]
      .filter(([, text]) => def.test(text)).map(([p]) => p).sort();

  it('CONTROL: the patterns see a declaration, a local copy and an arrow copy, and not an import, a call or another name', () => {
    expect(TYPE_DEF('GithubPermalink').test('export type GithubPermalink =')).toBe(true);
    expect(TYPE_DEF('GithubPermalink').test("type GithubPermalink = { ok: true; url: string };"), 'a local copy').toBe(true);
    expect(TYPE_DEF('GithubPermalink').test('export type GithubPermalinkRow = {'), 'another name').toBe(false);
    expect(FN_DEF('githubPermalink').test('export function githubPermalink(github: DocsGithub, ref: Ref,')).toBe(true);
    expect(FN_DEF('githubUrlAt').test('function githubUrlAt(slug: string, at: string, target: GithubTarget):')).toBe(true);
    expect(FN_DEF('githubUrlAt').test('const githubUrlAt = (slug: string): string => slug;'), 'an arrow copy').toBe(true);
    expect(FN_DEF('githubPermalink').test("import { githubPermalink } from '../../../shared/docs.js';"), 'an import').toBe(false);
    expect(FN_DEF('githubPermalink').test('  const link = githubPermalink(github, ref, commit, target);'), 'a call').toBe(false);
    expect(FN_DEF('githubUrlAt').test('function githubUrlAtCommit('), 'another name').toBe(false);
  });

  it('CONTROL: the function pattern sees an async, a default, a declare-d and a generator copy', () => {
    for (const text of [
      'export async function githubPermalink(',
      'async function githubPermalink(',
      'export default function githubUrlAt(',
      'export default async function githubUrlAt(',
      'export declare function githubPermalink(',
      'declare function githubPermalink(',
      'export function* githubPermalink(',
      'export declare const githubUrlAt:',
      'export const githubUrlAt = async (slug: string) => slug;',
    ]) {
      const name = text.includes('githubUrlAt') ? 'githubUrlAt' : 'githubPermalink';
      expect(FN_DEF(name).test(text), text).toBe(true);
    }
    expect(FN_DEF('githubPermalink').test('export async function githubPermalinks('), 'another name').toBe(false);
    expect(FN_DEF('githubPermalink').test('  await githubPermalink(github, ref);'), 'an awaited call').toBe(false);
  });

  it('CONTROL: what the function pattern still misses is named here, and a miss is not a pass', () => {
    // NOT EXHAUSTIVE. These evasions are known and stay unseen: an object or class method (`githubPermalink(x) {`),
    // a re-export under the name (`export { other as githubPermalink }`), a CommonJS assignment
    // (`exports.githubPermalink = `), a copy inside a block comment or string, and a
    // function expression that no `const`, `let` or `var` binds.
    for (const text of [
      '  githubPermalink(github: DocsGithub) {',
      'export { other as githubPermalink };',
      'exports.githubPermalink = function () {};',
    ]) expect(FN_DEF('githubPermalink').test(text), text).toBe(false);
  });

  it('CONTROL: a third file holding a copy is seen beside shared/docs.ts', () => {
    expect(holders(FN_DEF('githubPermalink'), [['pwa/src/docs/planted.ts', 'function githubPermalink(x: string) {}']]))
      .toEqual(['pwa/src/docs/planted.ts', 'shared/docs.ts']);
  });

  for (const name of TYPES) {
    it(`declares ${name} exactly once, in shared/docs.ts`, () => {
      expect(holders(TYPE_DEF(name))).toEqual(['shared/docs.ts']);
    });
  }
  for (const name of FUNCTIONS) {
    it(`defines ${name} exactly once, in shared/docs.ts`, () => {
      expect(holders(FN_DEF(name))).toEqual(['shared/docs.ts']);
    });
  }
});


// W3 Task Q3b (D-7026; ARCH-56 (#791); plan docs/superpowers/plans/2026-10-26-consolidation-w3-questions.md). APPENDED
// after the file's last line, with its own imports here (ES imports hoist), so no line above moves: the citation audit
// cites this file by line. The question tables (asks, approvals) are read through `coord/questions.ts`: the readers Q3b
// moved (the fleet frame, the digest and its correction, the drift lane, `GET /api/asks` and `GET /api/approvals/:id`)
// call no question-store method of their own. Measured by W3's census query (`census-w3/questions.ts`), which reads
// the syntax tree; a planted CONTROL tree shows a new direct call is seen.
import { mkdirSync as q3bMkdir, mkdtempSync as q3bMkdtemp, writeFileSync as q3bWrite } from 'node:fs';
import { tmpdir as q3bTmpdir } from 'node:os';
import { questionStoreCallsOutside } from '../census-w3/questions.js';

describe('the question tables are read through coord/questions.ts (D-7026)', () => {
  /** The readers Q3b moved: every call in these files, and every call inside these two routes. */
  const MOVED_FILES = ['server/src/fleet.ts', 'server/src/coord/digest.ts', 'server/src/coord/driftLane.ts'];
  const MOVED_ROUTES = ['server/src/coord/routes.ts | GET /api/asks', 'server/src/coord/routes.ts | GET /api/approvals/:id'];
  const direct = (root?: string): string[] => questionStoreCallsOutside(root)
    .filter((c) => MOVED_FILES.includes(c.file) || MOVED_ROUTES.includes(`${c.file} | ${c.symbol}`))
    .map((c) => `${c.file} | ${c.symbol} | ${c.method}`);
  const tree = (files: Record<string, string>): string => {
    const t = q3bMkdtemp(path.join(q3bTmpdir(), 'q3b-reads-'));
    for (const [p, body] of Object.entries(files)) {
      q3bMkdir(path.dirname(path.join(t, p)), { recursive: true });
      q3bWrite(path.join(t, p), body);
    }
    return t;
  };

  it('CONTROL: a direct store call in a moved file, or in a moved route, is seen; one through coord/questions.ts is not', () => {
    const t = tree({
      'server/src/fleet.ts': "function readCurrentAsks(coord: CoordStore) { return coord.currentAsksFor([]); }\n",
      'server/src/coord/routes.ts': [
        'export function registerCoordRoutes(app: App, coord: CoordStore) {',
        "  app.get('/api/approvals/:id', async () => coord.approvalById(1));",
        "  app.get('/api/approvals/:id/ruling', async () => coord.approvalById(1));",
        "  app.get('/api/asks', async () => openFor(coord, 'p'));",
        '}', ''].join('\n'),
    });
    expect(direct(t)).toEqual([
      'server/src/coord/routes.ts | GET /api/approvals/:id | approvalById',
      'server/src/fleet.ts | readCurrentAsks | currentAsksFor',
    ]);
  });

  it('the fleet frame, the digest, its correction, the drift lane and the two GET routes call no question-store method', () => {
    expect(direct()).toEqual([]);
  });

  it('each moved reader imports its read from coord/questions.ts', () => {
    for (const [file, names] of [
      ['server/src/fleet.ts', ['currentFor']],
      ['server/src/coord/digest.ts', ['decidedIn', 'forCorrection']],
      ['server/src/coord/driftLane.ts', ['heldForDrift']],
      ['server/src/coord/routes.ts', ['approvalFor', 'openFor']],
    ] as const) {
      const code = stallCode(path.join(ccrcRoot, file));
      for (const n of names) {
        expect(code, `${file} imports ${n} from coord/questions.ts`)
          .toMatch(new RegExp(`import\\s*\\{[^}]*\\b${n}\\b[^}]*\\}\\s*from\\s*'\\./(?:coord/)?questions\\.js'`));
      }
    }
  });
});

// W3 Task Q3b (D-7026). APPENDED, as the block above. All question state lives in instances of
// `coord/questions.ts#createQuestions`, as closure locals (plan §Global constraints): a module-scope carrier would make
// every `buildServer` and `FleetWatcher` in one process share it (Review focus 8). So the module declares no top-level
// `let`, and no top-level `const` bound to a `new Map`, `new Set` (or a weak one) or an array literal. A top-level
// declaration is one at column 0 (the tree's formatting: a body is indented). KNOWN WIDTH: state hidden behind a
// function call (`const held = makeMap()`) or a top-level object literal is not seen.
describe('coord/questions.ts declares no module-scope state (D-7026)', () => {
  const LET = /^(?:export\s+)?(?:let|var)\s/m;
  const CONST_STATE = /^(?:export\s+)?const\s+\w+\s*(?::[^=\n]+)?=\s*(?:new\s+(?:Map|Set|WeakMap|WeakSet)\b|\[)/m;
  const moduleState = (text: string): boolean => LET.test(stallCodeText(text)) || CONST_STATE.test(stallCodeText(text));

  it('MUTATION: a top-level let, Map, Set or array is seen; the same inside the factory, or in a comment, is not', () => {
    for (const planted of [
      'let held = 0;',
      'export let held: number | null = null;',
      'const heldAsks = new Map<string, number>();',
      'const seen: Set<number> = new Set();',
      'const inputs = new WeakMap();',
      'export const queue: string[] = [];',
    ]) expect(moduleState(`import type { X } from './x.js';\n${planted}\nexport function createQuestions() { return {}; }\n`), planted).toBe(true);
    expect(moduleState([
      'export function createQuestions() {',
      '  const heldAsks = new Map<string, number>();',
      '  let reseedLoaded = false;',
      '  return {};',
      '}',
      '// let held = 0;',
      ' * const heldAsks = new Map();',
      "const KINDS = Object.freeze({ ask: true });",
    ].join('\n'))).toBe(false);
  });

  it('the real file declares none', () => {
    expect(moduleState(readFileSync(path.join(ccrcRoot, 'server/src/coord/questions.ts'), 'utf8'))).toBe(false);
  });
});

// W3 Task Q3c (D-7027). APPENDED, as the blocks above. One question sweep: `tick` calls exactly one method that reaches
// a question lapse, release or prune (`census-w3/questions.ts#questionSweepEntries`), and it is `sweepQuestions`. The
// pin is exact, never "at most": an at-most pin would pass on an empty list with nothing measured. `sweepQuestions` is
// not `async` and contains no `await`, so neither half waits for the other, and `sweepApprovals` contains no `await`,
// so its whole body runs inside `tick`'s synchronous turn (Review focus 7). On this tip the walk is
// real, inside `watch.ts`: `sweepQuestions` -> `sweepAsks` -> `askPass` reaches `releaseAsk`, and `sweepQuestions` ->
// `sweepApprovals` reaches `lapseApproval`. Q3d keeps the pin green by extending the walk. The census module and the
// symbol reader are imported inside the tests, so this block only appends.
describe('one question sweep (D-7027)', () => {
  const WATCH = path.join(ccrcRoot, 'server/src/watch.ts');
  const headAndCode = (src: string): { head: string; code: string } => {
    const code = stallCodeText(src);
    const open = code.indexOf('{');
    return { head: code.slice(0, open), code };
  };
  const synchronous = (src: string): boolean => {
    const { head, code } = headAndCode(src);
    return !/\basync\b/.test(head) && !/\bawait\b/.test(code);
  };

  it('one question sweep: tick calls exactly sweepQuestions', async () => {
    const { questionSweepEntries } = await import('../census-w3/questions.js');
    expect(questionSweepEntries().map((s) => s.method)).toEqual(['sweepQuestions']);
  });

  it('sweepQuestions is not async and contains no await', async () => {
    const { sourceOfSymbol } = await import('../scan/symbols.js');
    expect(synchronous(sourceOfSymbol(WATCH, 'FleetWatcher.sweepQuestions'))).toBe(true);
  });

  it('sweepApprovals contains no await: its whole body runs inside tick\'s synchronous turn', async () => {
    const { sourceOfSymbol } = await import('../scan/symbols.js');
    expect(stallCodeText(sourceOfSymbol(WATCH, 'FleetWatcher.sweepApprovals'))).not.toMatch(/\bawait\b/);
  });

  it('the walk is real: sweepQuestions dispatches both halves, which reach releaseAsk and lapseApproval', async () => {
    const { sourceOfSymbol } = await import('../scan/symbols.js');
    const code = (name: string): string => stallCodeText(sourceOfSymbol(WATCH, `FleetWatcher.${name}`));
    expect(code('sweepQuestions')).toMatch(/\bthis\.sweepAsks\(\s*registryRead\s*\)/);
    expect(code('sweepQuestions')).toMatch(/\bthis\.sweepApprovals\(\s*\)/);
    expect(code('sweepAsks')).toMatch(/\bthis\.askPass\(/);
    expect(code('askPass')).toMatch(/\bstore\.releaseAsk\(/);
    expect(code('sweepApprovals')).toMatch(/\bcoord\.lapseApproval\(/);
  });

  it('MUTATION: a second sweep tick calls is counted; an async or awaiting sweepQuestions is seen', async () => {
    const { mkdtempSync, mkdirSync, writeFileSync, rmSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { questionSweepEntries } = await import('../census-w3/questions.js');
    const watch = (tickBody: string): string => [
      'export class FleetWatcher {',
      `  async tick(): Promise<void> { ${tickBody} }`,
      '  sweepQuestions(r: unknown): void { void this.sweepAsks(r); void this.sweepApprovals(); }',
      '  async sweepAsks(r: unknown): Promise<void> { await this.askPass(r); }',
      '  private async askPass(r: unknown): Promise<void> { this.deps.coord.releaseAsk(1, 2); }',
      '  async sweepApprovals(): Promise<void> { this.deps.coord.lapseApproval(1); }',
      '  sweepOther(): void { this.deps.coord.lapseApproval(2); }',
      '}',
    ].join('\n');
    const entries = (tickBody: string): string[] => {
      const t = mkdtempSync(path.join(tmpdir(), 'ccrc-one-sweep-'));
      try {
        mkdirSync(path.join(t, 'server/src'), { recursive: true });
        writeFileSync(path.join(t, 'server/src/watch.ts'), watch(tickBody));
        return questionSweepEntries(t).map((s) => s.method);
      } finally { rmSync(t, { recursive: true, force: true }); }
    };
    expect(entries('this.sweepQuestions(x);')).toEqual(['sweepQuestions']);
    expect(entries('this.sweepQuestions(x); this.sweepOther();')).not.toEqual(['sweepQuestions']);
    expect(entries('void this.sweepAsks(x); void this.sweepApprovals();')).not.toEqual(['sweepQuestions']);
    expect(entries('')).not.toEqual(['sweepQuestions']);
    expect(synchronous('sweepQuestions(r: X): void {\n  void this.sweepAsks(r);\n  void this.sweepApprovals();\n}')).toBe(true);
    expect(synchronous('async sweepQuestions(r: X): Promise<void> {\n  void this.sweepAsks(r);\n}')).toBe(false);
    expect(synchronous('sweepQuestions(r: X): void {\n  void (async () => { await this.sweepAsks(r); })();\n}')).toBe(false);
    expect(synchronous('sweepQuestions(r: X): void {\n  // no await here\n  void this.sweepAsks(r);\n}')).toBe(true);
  });
});
