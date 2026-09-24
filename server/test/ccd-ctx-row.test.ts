// ccd's `_pane_ctx_pct` reads context pressure off the STATUSLINE ROW only —
// the bash twin of server/src/pane/statusline.ts's row-scoped read (#174). It
// used to take the TOPMOST `ctx…NN%` anywhere in the capture window, so chat
// quoting a swap.log line one row above the prompt box outranked the real
// segment below it and could type `/compact` on a session nowhere near its wall.
//
// FIXTURE HOME ONLY (makeCcdHarness). No tmux: the function is handed text.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import { makeCcdHarness, type CcdHarness } from './ccdWsHelpers.js';
import { parseStatusline } from '../src/pane/statusline.js';

let h: CcdHarness;
beforeEach(() => { h = makeCcdHarness('ccrc-ccd-ctx-row-'); });
afterEach(() => { h.cleanup(); });

/** `_pane_ctx_pct` over `pane`, through a file so the rows stay rows. */
const ccdPct = (pane: string): string => {
  fs.writeFileSync(`${h.home}/pane.txt`, pane);
  return h.sh('_pane_ctx_pct "$(cat "$HOME/pane.txt")" || :');
};

// Real Claude Code 2.1.280 bottom rows (private tmux captures, both renderers):
// top rule, the `❯` box, bottom rule, the `👤` statusline row, the mode row.
const RULE = '─'.repeat(120);
const ROW = (ctx: string): string =>
  `  👤 acct-a │ 🤖 Opus 5.5 (1M context) · xhigh │ ⎇ ws/quiet-mesa │ 🎯 demo │ ${ctx} │ 💲 12.3456 │ +12 -3`;
const PANE = (above: string[], ctx: string): string =>
  [...above, '', RULE, '❯ ', RULE, ROW(ctx), '  ⏵⏵ bypass permissions on (shift+tab to cycle)'].join('\n');

const CASES: [string, string][] = [
  ['the real segment', PANE(['⏺ Done.'], '▓ ctx ████░░░░ 45%')],
  ['a swap.log line quoted in chat above the box', PANE(['⏺ The log says: auto-compact demo-x: ctx 97% >= 50%'], '▓ ctx ████░░░░ 45%')],
  ['a ctx-shaped line printed by a tool', PANE(['  ⎿  ▓ ctx ████████ 97%'], '▓ ctx ██░░░░░░ 20%')],
  ['an impostor statusline row printed by a tool', PANE(['  ⎿  👤 fake │ ▓ ctx ████████ 99%'], '▓ ctx ██░░░░░░ 20%')],
  ['a row that carries no ctx segment, under a ctx line in chat', [
    '⏺ ctx pressure was 97% before', '', RULE, '❯ ', RULE,
    '  👤 acct-a │ 🤖 Opus 5.5 (1M context) · xhigh │ ⎇ main', '  ⏵⏵ bypass permissions on'].join('\n')],
  ['a segment the terminal cut short', [RULE, '❯ ', RULE, '  👤 acct-a │ 🤖 Opus 5.5 · xhigh │ ⎇ main │ 🎯 demo │ ▓ ctx ██…'].join('\n')],
  ['no statusline row at all', '⏺ ctx 88%\n❯ '],
  // Claude Code indents a tool's CONTINUATION lines by five spaces, so a
  // statusline-shaped line printed by a tool trims to a `👤` start — the
  // impostor shape measured on real captures. Only being the LOWEST rejects it.
  ['an impostor row on a tool\'s continuation line', PANE(['  ⎿  $ bash statusline-command.sh', '     👤 fake │ ▓ ctx ████████ 99%'], '▓ ctx ██░░░░░░ 20%')],
  ['a ▓ inside another segment is not the ctx segment', [RULE, '❯\u00a0', RULE,
    '  👤 acct-a │ 🎯 demo ▓ ctx ██ 99% │ ▓ ctx ████░░░░ 45%'].join('\n')],
  ['upper-case CTX', PANE([], '▓ CTX ████░░░░ 7%')],
  ['a segment with no space after ctx', PANE([], '▓ ctx97%')],
];

/** A case's pane by its NAME — never by index, which an insertion shifts. */
const pane = (name: string): string => {
  const hit = CASES.find(([n]) => n === name);
  if (!hit) throw new Error(`no case named ${name}`);
  return hit[1];
};

describe('_pane_ctx_pct reads the statusline ROW, never the chat above it', () => {
  it('takes the number from the 👤-led row\'s own ▓ segment', () => {
    expect(ccdPct(pane('the real segment'))).toBe('45');
  });

  it('a ctx-shaped line anywhere above the row does not outrank it', () => {
    expect(ccdPct(pane('a swap.log line quoted in chat above the box'))).toBe('45');
    expect(ccdPct(pane('a ctx-shaped line printed by a tool'))).toBe('20');
    expect(ccdPct(pane('an impostor statusline row printed by a tool'))).toBe('20');
  });

  it('the LOWEST 👤 row is the statusline — a tool\'s continuation line above it is not', () => {
    expect(ccdPct(pane('an impostor row on a tool\'s continuation line'))).toBe('20');
  });

  it('a ▓ only counts where it OPENS a segment of the row', () => {
    expect(ccdPct(pane('a ▓ inside another segment is not the ctx segment'))).toBe('45');
  });

  it('a row with no ctx segment reads NOTHING — not the chat above it', () => {
    expect(ccdPct(pane('a row that carries no ctx segment, under a ctx line in chat'))).toBe('');
  });

  it('a cut segment and a missing row read nothing', () => {
    expect(ccdPct(pane('a segment the terminal cut short'))).toBe('');
    expect(ccdPct(pane('no statusline row at all'))).toBe('');
  });
});

// The segment reader itself, through a glyph whose segment CAN be cut and still
// look like a value — the branch. ctx cannot show the cut rule working: a cut
// ctx segment also fails the `NN%`-at-the-end check, so it reads nothing twice.
describe('_pane_statusline_seg: the cut rule, read through the ⎇ segment', () => {
  const seg = (pane: string, glyph: string): string => {
    fs.writeFileSync(`${h.home}/pane.txt`, pane);
    return h.sh(`_pane_statusline_seg "$(cat "$HOME/pane.txt")" "${glyph}" || :`);
  };
  it('a LAST segment holding Claude Code\'s `…` is a prefix, not a value', () => {
    const pane = [RULE, '❯\u00a0', RULE, '  👤 acct-a │ 🤖 Opus 5.5 · xhigh │ ⎇ ws/ccr…'].join('\n');
    expect(seg(pane, '⎇')).toBe('');
    expect(parseStatusline(pane).branch).toBeUndefined();
  });
  it('a `…` in a segment the row goes on past was drawn by the statusline itself', () => {
    const pane = [RULE, '❯\u00a0', RULE, '  👤 acct-a │ ⎇ wip… │ 🎯 demo'].join('\n');
    expect(seg(pane, '⎇')).toBe('wip…');
    expect(parseStatusline(pane).branch).toBe('wip…');
  });
});

// ONE RULE, TWO READERS. The server's chip and ccd's compactor must agree on
// what a pane says, or the PWA shows 45% on a session ccd compacts as 97%.
describe('statusline parity: ccd and the server read the same ctx off every pane', () => {
  for (const [name, text] of CASES) {
    it(name, () => {
      const ts = parseStatusline(text).ctxPct;
      expect(ccdPct(text)).toBe(ts === undefined ? '' : String(ts));
    });
  }
});
