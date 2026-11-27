// The box frames recipe's reducer and the receiver's check (Desktop polish wave 187; plan
// docs/superpowers/plans/2026-11-26-box-frames-recipe.md section 5.2; the capture owner's calls 1549 and 1558, and its yes to
// packet 2 with the corrected rule 2). One case or more per rule, the owner's four rule-2 cases, the coordinator's two
// rule-row cases, idempotence, and the over-replacement on the recorded 2.1.300 panes, pinned as measured.
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { CANARY } from '../../shared/private-names.mjs';
import { framesScan } from '../../shared/framesScan.mjs';
import { FRAMES_NUDGE_TEXT, FRAMES_RECIPE_VERSION, framesOurs } from '../../shared/framesCapture.js';
import { FRAMES_PARTS, frameSize, FRAMES_VERSION_SHAPE } from '../../shared/framesResult.js';
import {
  FRAMES_DECORATION, FRAMES_REPLACED, FRAMES_STATUS_TEXT, PATH_LIKE, checkReducedFrame, credentialShaped, isRuleRow, reduceFrame, rowIsOurs, statusRowOf, type FramesScan,
} from '../../shared/framesReduce.js';

const ESC = '\x1b';
const PANE = { cols: 220, rows: 50 };
const NONE: FramesScan = () => false;
const COMMITTED: FramesScan = framesScan;
const OURS = ['frames row 001 of 003 abcdefghij', 'frames earlier turn ZQX-END-turn', FRAMES_NUDGE_TEXT];
const frame = (...rows: string[]): string => rows.join('\n') + '\n';
/** The capture's status row, which sits directly under the frame's lowest rule (rule 8, review 4069's F3). */
const STATUS = `  ${FRAMES_STATUS_TEXT}`;
const reduced = (f: string, privates: readonly string[] = [], ours: readonly string[] = OURS): string => {
  const r = reduceFrame(f, PANE, ours, privates, NONE);
  if (r.kind !== 'reduced') throw new Error(`refused: ${r.refusal}`);
  return r.text;
};
const width = (row: string): number => Array.from(row.replace(/\x1b\[[0-9;:]*m/g, '')).length;

describe('rule 1: the shape gate', () => {
  it('refuses a frame with a hyperlink, never strips it', () => {
    expect(reduceFrame(frame(`${ESC}]8;;x${ESC}\\link`), PANE, OURS, [], NONE)).toEqual({ kind: 'refused', refusal: 'not-a-frame' });
  });
  it('refuses a frame over the cap', () => {
    expect(reduceFrame(frame('x'.repeat(221)), PANE, OURS, [], NONE)).toEqual({ kind: 'refused', refusal: 'not-a-frame' });
  });
  // Review 4069's F1, the coordinator's ruling: by Unicode class, one case per class, on a row that is ours and on one that is not.
  for (const [name, c] of [
    ['a C1 control (a one-character CSI)', '\u009b'], ['a format character (a bidi isolate)', '⁦'], ['a format character (a joiner)', '‍'],
    ['the line separator', ' '], ['the paragraph separator', ' '], ['a lone surrogate', '\ud800'], ['a private-use character', ''],
  ] as const) {
    it(`refuses a frame holding ${name} whole, on our row and on a foreign one, here and in the receiver's check`, () => {
      expect(reduceFrame(frame(`❯ frames row 001 of 003${c} abcdefghij`), PANE, OURS, [], NONE)).toEqual({ kind: 'refused', refusal: 'not-a-frame' });
      expect(reduceFrame(frame(`  plain${c} row`), PANE, OURS, [], NONE)).toEqual({ kind: 'refused', refusal: 'not-a-frame' });
      expect(checkReducedFrame(frame(`  plain${c} row`), PANE, OURS, NONE)).toEqual({ ok: false, refusal: 'not-a-frame' });
    });
  }
});

describe('a wrap through a private string or a path (review 4069, F2, the coordinator\'s ruling)', () => {
  const HOME = '/home/user-a';
  const WORK = '/srv/capture-x/work';
  // The box's strings as the runner gives them: the home, the user, the host and its short form, the capture's working directory.
  const BOX = [HOME, 'user-a', 'host-a.example', 'host-a', WORK];
  const refusedHere = (f: string, privates: readonly string[] = BOX): unknown => reduceFrame(f, PANE, OURS, privates, NONE);
  const REFUSED = { kind: 'refused', refusal: 'private-shape' };

  it('the reviewer\'s first frame: a home path wrapped across two rows is refused whole on the box', () => {
    expect(refusedHere(frame('working in /home/use', 'r-a/projects/x', 'ter/work'))).toEqual(REFUSED);
  });
  it('the reviewer\'s second frame: a path wrapped after the private string is refused whole on the box', () => {
    expect(refusedHere(frame(`cwd ${HOME}/proj`, 'ectname/src'))).toEqual(REFUSED);
  });
  for (const p of BOX) {
    it(`every split point of ${p}, with and without colour codes between the halves, refuses the frame whole`, () => {
      const cps = Array.from(p);
      for (let k = 1; k < cps.length; k++) {
        const [head, tail] = [cps.slice(0, k).join(''), cps.slice(k).join('')];
        expect(refusedHere(frame(`  some text ${head}`, `${tail} more text`)), `${head}|${tail}`).toEqual(REFUSED);
        expect(refusedHere(frame(`  some text ${head}${ESC}[0m`, `${ESC}[2m${tail} more text`)), `${head}|SGR|${tail}`).toEqual(REFUSED);
        expect(refusedHere(frame(`│ some text ${head} │`, `│ ${tail} more text │`)), `${head}|border|${tail}`).toEqual(REFUSED);
      }
    });
  }
  it('a path-like token run to a full-width row\'s last column and going on below is refused whole, with no string known', () => {
    const edge = `  see ${'x'.repeat(PANE.cols - 14)} /srv/ab`;
    expect(Array.from(edge)).toHaveLength(PANE.cols);
    expect(refusedHere(frame(edge, 'cdef rest'), [])).toEqual(REFUSED);
    expect(checkReducedFrame(frame(edge, 'cdef rest'), PANE, OURS, NONE)).toEqual({ ok: false, refusal: 'private-shape' });
  });
  it('a full-width row of words, or a rule row, above a row that begins with a slash is not a wrapped path', () => {
    const words = `  ${'word '.repeat(43)}wor`;
    expect(Array.from(words)).toHaveLength(PANE.cols);
    expect(reduced(frame(words, 'next words'))).toBe(frame(words, 'next words'));
    const ruled = frame('─'.repeat(PANE.cols), '  /help for help', '─'.repeat(30), STATUS);
    expect(reduced(ruled)).toBe(ruled);
  });

  // The server has none of the box's strings: it refuses by shape what a box without the fix sent.
  it('the receiver refuses the reviewer\'s first frame as the box sent it before this round: a token cut at a row\'s end', () => {
    const sent = frame(`${FRAMES_REPLACED.cwd} `, `${Array.from(FRAMES_REPLACED.cwd).slice(0, 16).join('')}`, 'ter/work');
    expect(checkReducedFrame(sent, PANE, OURS, NONE)).toEqual({ ok: false, refusal: 'private-shape' });
  });
  it('the receiver refuses the reviewer\'s second frame as the box sent it before this round: a whole token, then a row going on with a path', () => {
    const sent = frame(`${FRAMES_REPLACED.cwd}${' '.repeat(2)}`, 'ectname/src');
    expect(checkReducedFrame(sent, PANE, OURS, NONE)).toEqual({ ok: false, refusal: 'private-shape' });
  });
  it('the class: a cut token anywhere, either end, and a path\'s tail after any token or after a row run to the edge', () => {
    for (const f of [frame('  see ‹model here'), frame('  odel› and more'), frame('  ‹working dir› x'), frame(`  ${FRAMES_REPLACED.model} then ‹acc`)]) {
      expect(checkReducedFrame(f, PANE, OURS, NONE), f).toEqual({ ok: false, refusal: 'private-shape' });
    }
    for (const t of Object.values(FRAMES_REPLACED)) {
      expect(checkReducedFrame(frame(`│ ${t}     │`, '│ a/b more │'), PANE, OURS, NONE), t).toEqual({ ok: false, refusal: 'private-shape' });
    }
    const edge = `  ${'x'.repeat(PANE.cols - 2)}`;
    expect(checkReducedFrame(frame(edge, 'yz/q'), PANE, OURS, NONE)).toEqual({ ok: false, refusal: 'private-shape' });
  });
  it('a whole token with no path after it, and a path row after a row of ours, pass the receiver', () => {
    expect(checkReducedFrame(frame(`  ${FRAMES_REPLACED.model}  `, '  ? for shortcuts'), PANE, OURS, NONE)).toEqual({ ok: true });
    expect(checkReducedFrame(frame(`> ${FRAMES_NUDGE_TEXT.slice(0, 60)}`, `  ${FRAMES_NUDGE_TEXT.slice(60, 120)}`), PANE, OURS, NONE)).toEqual({ ok: true });
  });
});

describe('a short user or host name is matched as a whole word (review 4069, F4, the coordinator\'s ruling)', () => {
  it('a name of one to three characters, bounded by the edge or a character not a letter, digit, dot, dash or underscore, is replaced', () => {
    for (const [name, row] of [['bo', '  logged in as bo today'], ['b', '  user b on this box now'], ['srv', '  (srv) answered from here']] as const) {
      expect(reduced(frame(row), [name]).split('\n')[0]!.trim(), row).toBe(FRAMES_REPLACED.cwd);
    }
  });
  it('inside a longer word, or joined by a dot, dash or underscore, it is not the name', () => {
    for (const row of ['  bob and boat are here', '  see bo.x and bo-y and bo_z', '  x9bo and bo9']) expect(reduced(frame(row), ['bo'])).toBe(frame(row));
  });
  it('a longer name is matched anywhere, as before', () => {
    expect(reduced(frame('  xuser-ax here and more words'), ['user-a']).split('\n')[0]!.trim()).toBe(FRAMES_REPLACED.cwd);
  });
  it('a short name wrapped across two rows is refused whole', () => {
    expect(reduceFrame(frame('  logged in as b', 'o today'), PANE, OURS, ['bo'], NONE)).toEqual({ kind: 'refused', refusal: 'private-shape' });
  });
});

describe('rule 2: ours after the closed decoration list (the owner\'s four cases)', () => {
  it('a box row with its glyph and our text is kept byte for byte, SGR and all', () => {
    const row = `${ESC}[2m❯ ${ESC}[0mframes row 001 of 003 abcdefghij   `;
    expect(reduced(frame(row))).toBe(frame(row));
  });
  it('an earlier turn\'s row of the mail notice, with its marker, is kept: path and all', () => {
    const row = `${ESC}[48;5;237m> ${FRAMES_NUDGE_TEXT.slice(0, 200)}${ESC}[0m`;
    expect(reduced(frame(row))).toBe(frame(row));
  });
  it('the same row with one foreign word after our text is read by the later rules, and replaced', () => {
    const row = `> ${FRAMES_NUDGE_TEXT.slice(0, 150)} intruder`;
    const out = reduced(frame(row)).split('\n')[0]!;
    expect(out.startsWith(`> ${FRAMES_REPLACED.cwd}`)).toBe(true);
    expect(width(out)).toBe(width(row));
  });
  it('a row holding only decoration is not ours', () => {
    expect(rowIsOurs('│      │', OURS.map((o) => o.replace(/\s+/g, '')))).toBe(false);
    expect(rowIsOurs('❯ ', OURS.map((o) => o.replace(/\s+/g, '')))).toBe(false);
  });
  it('a wrapped turn\'s fragment is ours', () => {
    expect(rowIsOurs(`  ${FRAMES_NUDGE_TEXT.slice(40, 120)}`, [FRAMES_NUDGE_TEXT.replace(/\s+/g, '')])).toBe(true);
  });
  it('the decoration list is closed: borders, the glyph, the turn markers and spaces', () => {
    expect(FRAMES_DECORATION).toEqual(['│', '╭', '╮', '╰', '╯', '❯', '>', '⏺', '●', '⎿', ' ', ' ']);
  });
});

describe('rules 3 to 6: a row replaced keeps its width and its border', () => {
  it('rule 3: an exact private string', () => {
    const row = '│ cwd: /srv/capture-x/captures/abc │';
    const out = reduced(frame(row), ['/srv/capture-x']).split('\n')[0]!;
    expect(out).toBe(`│ ${FRAMES_REPLACED.cwd}${' '.repeat(width(row) - 4 - width(FRAMES_REPLACED.cwd))} │`);
  });
  it('rule 4: a path cut short, with an ellipsis or a home mark, or two components', () => {
    for (const row of ['  …/projects/x and more words', '  ~/work here and more words', '  in work/projects/x now and later', '  /a/b and some more words']) {
      const out = reduced(frame(row)).split('\n')[0]!;
      expect(out.trim()).toBe(FRAMES_REPLACED.cwd);
      expect(width(out)).toBe(width(row));
    }
  });
  it('a row too narrow for its whole token refuses the frame: a token is never cut short to fit (review 4069, F2)', () => {
    // Before this round such a row became the token's first characters (`‹wo`), which the server cannot tell from a cut.
    for (const row of ['  …/projects/x', '  ~/work here', '  /a/b', '  Haiku', '  plan']) {
      expect(reduceFrame(frame(row), PANE, OURS, [], NONE), row).toEqual({ kind: 'refused', refusal: 'private-shape' });
    }
  });
  it('rule 5: a model name, rule 6: an account or a plan', () => {
    expect(reduced(frame('  Haiku 9.9 · whatever')).trim()).toBe(FRAMES_REPLACED.model);
    expect(reduced(frame('  API Usage Billing')).trim()).toBe(FRAMES_REPLACED.account);
    expect(reduced(frame('  Claude Max')).trim()).toBe(FRAMES_REPLACED.account);
  });
  it('a plain build row is kept', () => {
    expect(reduced(frame('  ? for shortcuts'))).toBe(frame('  ? for shortcuts'));
  });
});

describe('rule 7: a rule row\'s label is kept byte for byte (the coordinator\'s condition 2)', () => {
  const rule = `${ESC}[38;5;244m${'─'.repeat(90)} ↑ 156 more ${'─'.repeat(90)}${ESC}[0m`;
  it('a rule row carrying an arrow, a number and a word survives reduction unchanged', () => {
    expect(reduced(frame(rule, STATUS))).toBe(frame(rule, STATUS));
  });
  it('the path rule does not read that label as a path', () => {
    expect(PATH_LIKE.test('↑ 156 more')).toBe(false);
    expect(isRuleRow(rule.replace(/\x1b\[[0-9;]*m/g, ''))).toBe(true);
  });
  it('a rule row whose label rules 4 to 6 would catch refuses the frame: never kept, never rewritten', () => {
    for (const label of ['…/work/x', 'Haiku 9', 'Claude Max']) {
      expect(reduceFrame(frame(`${'─'.repeat(20)} ${label} ${'─'.repeat(20)}`, STATUS), PANE, OURS, [], NONE)).toEqual({ kind: 'refused', refusal: 'private-shape' });
    }
  });
  it('a rule row holding a private string is replaced', () => {
    const out = reduced(frame(`${'─'.repeat(20)} /srv/capture-x ${'─'.repeat(20)}`, STATUS), ['/srv/capture-x']);
    expect(out).toContain(FRAMES_REPLACED.cwd);
  });
});

describe('rule 8: the status position holds exactly the capture\'s status text (review 4069, F3, the capture owner\'s condition)', () => {
  const RULE = '─'.repeat(60);
  const box = (...under: string[]): string => frame(RULE, '❯ frames row 001 of 003 abcdefghij', RULE, ...under);
  const REFUSED = { kind: 'refused', refusal: 'status-row' };
  it('the text alone in that row passes, kept byte for byte, SGR and indent included, with a hint row under it', () => {
    for (const f of [box(STATUS), box(STATUS, '  ? for shortcuts'), box(`${ESC}[2m  ${FRAMES_STATUS_TEXT}${ESC}[0m   `)]) expect(reduced(f), f).toBe(f);
  });
  it('the text followed by any other text refuses the frame whole, a branch, a path or a mark at the row\'s far end', () => {
    for (const s of [`${STATUS} · main`, `${STATUS} ~/work`, `${STATUS}${' '.repeat(80)}● high`, `  ${FRAMES_STATUS_TEXT}x`]) {
      expect(reduceFrame(box(s), PANE, OURS, [], NONE), s).toEqual(REFUSED);
    }
  });
  it('a different text there refuses: the build\'s own hint, a mode row, a status of another layer, words of ours', () => {
    for (const s of ['  ? for shortcuts', '  ⏵⏵ auto mode on (shift+tab to cycle)', '  👤 cfg │ 🎯 repo', '  frames row 001 of 003 abcdefghij', `  ${FRAMES_STATUS_TEXT.slice(0, -1)}`]) {
      expect(reduceFrame(box(s), PANE, OURS, [], NONE), s).toEqual(REFUSED);
    }
  });
  it('a second status row refuses, wherever under the box it is drawn', () => {
    expect(reduceFrame(box(STATUS, STATUS), PANE, OURS, [], NONE)).toEqual(REFUSED);
    expect(reduceFrame(box(STATUS, '  ? for shortcuts', `  note ${FRAMES_STATUS_TEXT} again`), PANE, OURS, [], NONE)).toEqual(REFUSED);
  });
  it('an empty status position refuses: the lowest rule is the last row, or the row under it is blank', () => {
    expect(reduceFrame(box(), PANE, OURS, [], NONE)).toEqual(REFUSED);
    expect(reduceFrame(frame(RULE, '❯ x', RULE).slice(0, -1), PANE, OURS, [], NONE)).toEqual(REFUSED);
    expect(reduceFrame(box('   ', STATUS), PANE, OURS, [], NONE)).toEqual(REFUSED);
  });
  it('the position is under the LOWEST rule: a status text under an upper rule only is a second row or a refused one', () => {
    expect(reduceFrame(frame(RULE, STATUS, '❯ x', RULE, '  ? for shortcuts'), PANE, OURS, [], NONE)).toEqual(REFUSED);
    expect(statusRowOf([RULE, '❯ x', RULE, STATUS, ''])).toBe(3);
  });
  it('a frame with no rule row has no box and no status position: the rule does not apply, every other rule does', () => {
    expect(statusRowOf(['  plain row', ''])).toBeNull();
    expect(reduced(frame('  plain row'))).toBe(frame('  plain row'));
  });
  it('the server\'s check refuses the same frames, and clears the one the box keeps', () => {
    for (const f of [box(`${STATUS} · main`), box('  ? for shortcuts'), box(STATUS, STATUS), box()]) {
      expect(checkReducedFrame(f, PANE, OURS, NONE), f).toEqual({ ok: false, refusal: 'status-row' });
    }
    expect(checkReducedFrame(box(STATUS, '  ? for shortcuts'), PANE, OURS, NONE)).toEqual({ ok: true });
  });
});

describe('rule 9: the scans refuse the whole frame', () => {
  it('a hit of the committed private-name matcher', () => {
    expect(reduceFrame(frame('plain row'), PANE, OURS, [], () => true)).toEqual({ kind: 'refused', refusal: 'private-name' });
  });
  it('the shared scan finds the committed canary on a row, and on a clean frame finds nothing', () => {
    expect(reduceFrame(frame(`  note ${CANARY} here`), PANE, OURS, [], COMMITTED)).toEqual({ kind: 'refused', refusal: 'private-name' });
    expect(framesScan(frame('  ? for shortcuts', '  plain row'))).toBe(false);
  });
  it('a private shape left on a row not ours: an address, a long hex run', () => {
    expect(reduceFrame(frame('  host 10.1.2.3 here'), PANE, OURS, [], NONE)).toEqual({ kind: 'refused', refusal: 'private-shape' });
    expect(reduceFrame(frame(`  id ${'ab'.repeat(16)}`), PANE, OURS, [], NONE)).toEqual({ kind: 'refused', refusal: 'private-shape' });
  });
  it('the masker over the whole frame, our rows included', () => {
    const key = 'sk-ant-api03-abcdefghijkl';
    expect(reduceFrame(frame(`❯ ${key}`), PANE, [key], [], NONE)).toEqual({ kind: 'refused', refusal: 'masked' });
  });
  it('a colour change inside a key does not split it past the masker', () => {
    expect(reduceFrame(frame(`  sk-ant-${ESC}[2mapi03-abcdefghijkl${ESC}[0m`), PANE, OURS, [], NONE)).toEqual({ kind: 'refused', refusal: 'masked' });
  });
  it('loopback passes', () => {
    expect(reduced(frame('  at 127.0.0.1 only'))).toBe(frame('  at 127.0.0.1 only'));
  });
  it('no fixed text of any case trips the masker\'s shapes or the committed matcher', () => {
    for (const p of FRAMES_PARTS) for (const t of framesOurs(p.case, p.pane)) {
      expect(credentialShaped(t)).toBe(false);
      expect(COMMITTED(t)).toBe(false);
    }
  });
});

describe('rule 10, and the receiver\'s check', () => {
  const mixed = frame(
    '  Haiku 9.9 · Claude Max', '  cwd /srv/capture-x/captures/abc', `${'─'.repeat(30)} ↑ 9 more ${'─'.repeat(30)}`,
    '❯ frames row 001 of 003 abcdefghij', `${'─'.repeat(70)}`, STATUS, '  ? for shortcuts',
  );
  it('idempotent: a reduced frame reduces to itself', () => {
    const once = reduced(mixed, ['/srv/capture-x']);
    expect(reduced(once)).toBe(once);
  });
  it('the receiver clears a reduced frame', () => {
    expect(checkReducedFrame(reduced(mixed, ['/srv/capture-x']), PANE, OURS, NONE)).toEqual({ ok: true });
  });
  it('the receiver refuses a frame the reducer would still change, and one the live masker would', () => {
    expect(checkReducedFrame(mixed, PANE, OURS, NONE)).toEqual({ ok: false, refusal: 'private-shape' });
    expect(checkReducedFrame(frame('plain row'), PANE, OURS, NONE, () => true)).toEqual({ ok: false, refusal: 'masked' });
  });
  it('the version folds in the reducer\'s probe answers', () => {
    expect(FRAMES_RECIPE_VERSION).toMatch(FRAMES_VERSION_SHAPE);
  });
});

describe('over-replacement on the recorded 2.1.300 panes (the coordinator\'s condition 3, measured and pinned)', () => {
  const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'panes');
  const files = readdirSync(dir).filter((f) => f.startsWith('cc300'));
  const BIG = { cols: 1000, rows: 1000 };
  /** What the 61 recorded panes hold directly under their lowest rule, measured: each was drawn with no status line set. */
  const UNDER_THE_LOWEST_RULE = [
    '4. Chat about this', '5. Chat about this', 'paste again to expand',
    '←  ☒ Caching  ☒ Tracing  ✔ Submit  →', '←  ☒ Database  ☒ Deployment  ☒ Monitoring  ☒ Licensing  ✔ Submit  →',
    '←  ☒ Drink  ☒ Features  ☒ Tools  ✔ Submit  →', '←  ☒ Engine  ☒ Order  ☒ Notes  ☒ Region  ✔ Submit  →',
    '←  ☒ Pets  ☐ Size  ☒ Mode  ✔ Submit  →', '←  ☒ Tools  ☒ Sizes  ✔ Submit  →', '←  ☒ Tools  ✔ Submit  →',
    '⏵⏵ auto mode on (shift+tab to cycle)', '⏵⏵ auto mode on (shift+tab to cycle) · ← for agents', '❯ 4. Chat about this',
  ];
  /** A recorded pane as our settings would draw it: the capture's status row put directly under its lowest rule (rule 8),
   *  every row it drew kept. A pane with no rule row is left as it is. */
  const underOurSettings = (text: string): string => {
    const rows = text.split('\n');
    let low = -1;
    rows.forEach((l, i) => { if (isRuleRow(l.replace(/\x1b\[[0-9;:]*m/g, ''))) low = i; });
    return low < 0 ? text : [...rows.slice(0, low + 1), STATUS, ...rows.slice(low + 1)].join('\n');
  };
  it('replaces 38 model rows, 0 account rows and 5 path rows in 61 panes, never a box, rule or chip row, and keeps every width', () => {
    // The panes were not drawn under the capture's settings, so each gets the status row ours would draw (above); the
    // counts are the rules' over every row the build drew, as they were before rule 8.
    const total = { cwd: 0, path: 0, model: 0, account: 0 };
    let boxReplaced = 0;
    for (const f of files) {
      const text = underOurSettings(readFileSync(path.join(dir, f), 'utf8'));
      const r = reduceFrame(text, BIG, [], [], NONE);
      expect(r.kind, f).toBe('reduced');
      if (r.kind !== 'reduced') continue;
      for (const k of Object.keys(total) as (keyof typeof total)[]) total[k] += r.replaced[k];
      const before = text.split('\n');
      const after = r.text.split('\n');
      expect(after.map(width)).toEqual(before.map(width));
      // The box: from the last glyph row up to the rule above it, down to the closing rule.
      const plain = before.map((l) => l.replace(/\x1b\[[0-9;:]*m/g, ''));
      let g = -1;
      plain.forEach((l, i) => { if (/^\s*❯/.test(l)) g = i; });
      if (g < 0) continue;
      let top = g; while (top > 0 && !isRuleRow(plain[top - 1]!)) top--;
      let bot = g; while (bot < plain.length - 1 && !isRuleRow(plain[bot + 1]!)) bot++;
      for (let i = Math.max(0, top - 1); i <= Math.min(plain.length - 1, bot + 1); i++) if (after[i] !== before[i]) boxReplaced++;
      for (const [i, l] of plain.entries()) if (/\[Pasted text #\d+/.test(l)) expect(after[i]).toBe(before[i]);
    }
    expect(files).toHaveLength(61);
    expect(total).toEqual({ cwd: 0, path: 5, model: 38, account: 0 });
    expect(boxReplaced).toBe(0);
  });
  it('as recorded, every pane with a rule row is refused status-row: none holds the capture\'s status text under its lowest rule', () => {
    const under = new Map<string, number>();
    let ruled = 0;
    for (const f of files) {
      const text = readFileSync(path.join(dir, f), 'utf8');
      const plain = text.split('\n').map((l) => l.replace(/\x1b\[[0-9;:]*m/g, ''));
      let low = -1;
      plain.forEach((l, i) => { if (isRuleRow(l)) low = i; });
      const r = reduceFrame(text, BIG, [], [], NONE);
      if (low < 0) { expect(r.kind, f).toBe('reduced'); continue; }
      ruled++;
      expect(r, f).toEqual({ kind: 'refused', refusal: 'status-row' });
      const row = (plain[low + 1] ?? '').trim();
      under.set(row, (under.get(row) ?? 0) + 1);
    }
    expect(ruled).toBe(61);
    expect(under.has(FRAMES_STATUS_TEXT)).toBe(false);
    // What the build drew there (no status line was configured): a hint, the mode row, an ask dialog's last row, or nothing.
    expect([...under.keys()].sort()).toEqual(UNDER_THE_LOWEST_RULE);
  });
  it('the frame size of a recorded pane is measured as the reader measures it', () => {
    expect(frameSize(readFileSync(path.join(dir, files[0]!), 'utf8')).rows).toBeGreaterThan(0);
  });
});
