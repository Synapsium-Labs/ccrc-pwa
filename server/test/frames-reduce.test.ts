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
  FRAMES_DECORATION, FRAMES_REPLACED, PATH_LIKE, checkReducedFrame, credentialShaped, isRuleRow, reduceFrame, rowIsOurs, type FramesScan,
} from '../../shared/framesReduce.js';

const ESC = '\x1b';
const PANE = { cols: 220, rows: 50 };
const NONE: FramesScan = () => false;
const COMMITTED: FramesScan = framesScan;
const OURS = ['frames row 001 of 003 abcdefghij', 'frames earlier turn ZQX-END-turn', FRAMES_NUDGE_TEXT];
const frame = (...rows: string[]): string => rows.join('\n') + '\n';
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
    for (const row of ['  …/projects/x', '  ~/work here', '  in work/projects/x now', '  /a/b']) {
      const out = reduced(frame(row)).split('\n')[0]!;
      expect(out.trim().startsWith(Array.from(FRAMES_REPLACED.cwd).slice(0, 3).join(''))).toBe(true);
      expect(width(out)).toBe(width(row));
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
    expect(reduced(frame(rule))).toBe(frame(rule));
  });
  it('the path rule does not read that label as a path', () => {
    expect(PATH_LIKE.test('↑ 156 more')).toBe(false);
    expect(isRuleRow(rule.replace(/\x1b\[[0-9;]*m/g, ''))).toBe(true);
  });
  it('a rule row holding a private string is replaced', () => {
    const out = reduced(frame(`${'─'.repeat(20)} /srv/capture-x ${'─'.repeat(20)}`), ['/srv/capture-x']);
    expect(out).toContain(FRAMES_REPLACED.cwd);
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
    '❯ frames row 001 of 003 abcdefghij', `${'─'.repeat(70)}`, '  ? for shortcuts',
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
  it('replaces 38 model rows, 0 account rows and 5 path rows in 61 panes, never a box, rule or chip row, and keeps every width', () => {
    const total = { cwd: 0, path: 0, model: 0, account: 0 };
    let boxReplaced = 0;
    for (const f of files) {
      const text = readFileSync(path.join(dir, f), 'utf8');
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
  it('the frame size of a recorded pane is measured as the reader measures it', () => {
    expect(frameSize(readFileSync(path.join(dir, files[0]!), 'utf8')).rows).toBeGreaterThan(0);
  });
});
