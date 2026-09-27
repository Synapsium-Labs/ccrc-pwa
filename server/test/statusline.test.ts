import { describe, it, expect } from 'vitest';
import { parseStatusline, promptBoxShowing } from '../src/pane/statusline.js';

// Real captures from the fleet (cc-claude2-expoAI-assistant, cc-claude-corp-custom-tools).
const ULTRA_PANE = [
  '────────────────────────────────────────────────────────── ultracode ─',
  '',
  '  👤 team·max │ 🤖 Opus 4.8 (1M context) · xhigh │ ⎇ fix/linear-go-live-completion │ 🎯 expoAI-assistant │ ▓ ctx ████░░░░ 48% │ 💲 $23.8743 │ +699 -44 │ ⏳ limits 5h ░░░░░ 5% · 7d ████░ 72%           /rc',
  '  ⏵⏵ bypass permissions on (shift+tab to cycle) · ← for agents',
].join('\n');

describe('parseStatusline', () => {
  it('reads model, effort, ultracode and branch from a real ultracode pane', () => {
    const s = parseStatusline(ULTRA_PANE);
    expect(s.model).toBe('Opus 4.8 (1M context)');
    expect(s.effort).toBe('xhigh');
    expect(s.ultracode).toBe(true);
    expect(s.branch).toBe('fix/linear-go-live-completion');
    // D-2011: `▓ ctx ████░░░░ 48%` — the LAST number in the segment, past the
    // bar glyphs (fill/empty cells are non-digits, so counting fill cells
    // would never work as a parse strategy).
    expect(s.ctxPct).toBe(48);
  });

  it('ultracode is false when the mode divider is plain dashes', () => {
    const pane = [
      '──────────────────────────────────────────────────────────────────────',
      '  👤 gpt │ 🤖 GPT 5.6 · high │ ⎇ main │ 🎯 rp-llm │ ▓ ctx ██░░ 20%',
    ].join('\n');
    const s = parseStatusline(pane);
    expect(s).toEqual({
      model: 'GPT 5.6', effort: 'high', ultracode: false, branch: 'main', workflowActive: false,
      ctxPct: 20,
      // The bare divider directly above the row is the prompt box's bottom
      // border, so its length is the box's width.
      boxCols: 70,
    });
  });

  it('D-2011: a pane with a statusline but no ▓ ctx segment parses ctxPct as undefined', () => {
    // model/branch/effort all land — only the ctx bar itself is missing
    // (an older statusline-command.sh, or a build the operator trimmed it
    // from). Absent must stay `undefined`, never fabricated as 0 — a
    // session at 0% context and a session this parse never measured are
    // different claims.
    const s = parseStatusline('  👤 claude │ 🤖 Sonnet 5 · high │ ⎇ main │ 🎯 proj │ 💲 $1.00');
    expect(s.model).toBe('Sonnet 5');
    expect(s.branch).toBe('main');
    expect(s.ctxPct).toBeUndefined();
  });

  it('model without an effort segment still parses', () => {
    const s = parseStatusline('  👤 claude │ 🤖 Sonnet 5 │ ⎇ main │ 🎯 proj');
    expect(s.model).toBe('Sonnet 5');
    expect(s.effort).toBeUndefined();
    expect(s.ultracode).toBe(false);
  });

  it('a pane with no statusline (dialog overlay / fresh session) yields empties', () => {
    const s = parseStatusline('❯ 1. Option one\n  2. Option two\nEnter to select');
    expect(s).toEqual({
      model: undefined, effort: undefined, ultracode: false, branch: undefined, workflowActive: false,
      ctxPct: undefined,
    });
  });

  it('does NOT false-positive ultracode from chat text mentioning the word', () => {
    const s = parseStatusline('assistant: we should turn on ultracode for this\n❯ ');
    expect(s.ultracode).toBe(false);
  });

  // Finding 1 (fix round): the reviewer's three measured false-reads against
  // the glyph-only, top-down anchor this replaced. All three panes put a
  // fabricated or inert ▓ line ABOVE the real statusline row, the way chat
  // scrollback actually sits relative to the bottom-row statusline.
  it('does not fabricate ctxPct from a chat line with its own ▓ progress bar above the real statusline', () => {
    const pane = [
      'here is my progress bar: ▓▓▓▓▓▓░░ 95% done building',
      '  👤 claude │ 🤖 Sonnet 5 · high │ ⎇ main │ 🎯 proj │ ▓ ctx ████░░░░ 22%',
    ].join('\n');
    expect(parseStatusline(pane).ctxPct).toBe(22);
  });

  it('does not fabricate ctxPct from a chat line mentioning ▓ and a percent, above the real statusline', () => {
    const pane = [
      'see graph ▓ 88% coverage │ next',
      '  👤 claude │ 🤖 Sonnet 5 · high │ ⎇ main │ 🎯 proj │ ▓ ctx ████░░░░ 22%',
    ].join('\n');
    expect(parseStatusline(pane).ctxPct).toBe(22);
  });

  it('does not let inert ▓ block art above the real statusline blind the read (and D-2012 must not then clear it)', () => {
    const pane = [
      '▓▓▓▓▓▓▓▓ block art, no percent here',
      '  👤 claude │ 🤖 Sonnet 5 · high │ ⎇ main │ 🎯 proj │ ▓ ctx ████████ 91%',
    ].join('\n');
    expect(parseStatusline(pane).ctxPct).toBe(91);
  });

  it('detects a running workflow from the pane progress line', () => {
    const pane = [
      '  👤 team·max │ 🤖 Opus 4.8 · xhigh │ ⎇ main │ 🎯 proj',
      '',
      '  ◉ plan-relevance-triage  Re-assess coverage · 0/4 agents done · 37s · ↓ 204.5k tokens',
    ].join('\n');
    expect(parseStatusline(pane).workflowActive).toBe(true);
    // No workflow line → false.
    expect(parseStatusline('  🤖 Opus 4.8 · xhigh │ ⎇ main').workflowActive).toBe(false);
  });

  // A pane narrower than the statusline: Claude Code cuts the row at the
  // pane's width and ends it with `…`. Measured 2026-09-23 on four live rows
  // whose spawns ccd had stood down on as under READER_MIN_COLS (spawn rc 6):
  // the server shipped `ws/ccr…`, `ws/en…`, `docs/…` and `feat/…` as branches,
  // and the fleet card showed them as the workspace names.
  it('does not read a branch the terminal cut short', () => {
    const s = parseStatusline('  👤 acct-a │ 🤖 Opus 5.5 (1M context) · xhigh │ ⎇ ws/ccr…');
    expect(s.branch).toBeUndefined();
    // The segments before the cut were drawn whole and still read.
    expect(s.model).toBe('Opus 5.5 (1M context)');
    expect(s.effort).toBe('xhigh');
  });

  it('does not read a cut segment even when something sits after the `…`', () => {
    // The row's own trailer slot (ULTRA_PANE's `           /rc`) is on the SAME
    // row. Claude Code wraps it below a cut row in every capture measured, but
    // a last segment holding a `…` is cut whatever follows the mark — none of
    // the script's own segments ever carries one.
    const s = parseStatusline('  👤 acct-a │ 🤖 Opus 5.5 (1M context) · xhigh │ ⎇ ws/ccr…           /rc');
    expect(s.branch).toBeUndefined();
  });

  it('does not read a model the terminal cut short', () => {
    const s = parseStatusline('  👤 acct-a │ 🤖 Opus 5.5 (1M con…');
    expect(s.model).toBeUndefined();
    expect(s.effort).toBeUndefined();
  });

  // The scan used to take the FIRST line anywhere in the pane that contained
  // the glyph, so chat scrollback above the statusline outranked it. Measured
  // 2026-09-23 on the session that wrote this fix: its own diff put this
  // file's docstring on screen, and the fleet card named the workspace
  // ``ws/ccr…` became the session's branch,``.
  it('does not read a branch out of chat text above the statusline', () => {
    const pane = [
      '     truncation mark. Read as a value, `⎇ ws/ccr…` became the session\'s branch,',
      '  👤 acct-a │ 🤖 Opus 5.5 (1M context) · xhigh │ ⎇ ws/workspace-naming-trimming-bug │ 🎯 ccrc-pwa',
    ].join('\n');
    expect(parseStatusline(pane).branch).toBe('ws/workspace-naming-trimming-bug');
  });

  it('does not read a model out of chat text above the statusline', () => {
    const pane = [
      '● The 🤖 segment carries the model · effort',
      '  👤 claude │ 🤖 Sonnet 5 · high │ ⎇ main',
    ].join('\n');
    const s = parseStatusline(pane);
    expect(s.model).toBe('Sonnet 5');
    expect(s.effort).toBe('high');
  });

  it('reads the LOWEST statusline-shaped row — a row printed in chat above it is not the statusline', () => {
    // A raw run of the script in a tool's output: Claude Code indents the
    // continuation lines, so after a trim this one is led by 👤 exactly like
    // the real row. Only its position tells them apart.
    const pane = [
      '  ⎿  $ bash ~/.claude/statusline-command.sh < fixture.json',
      '     👤 claude │ 🤖 Opus 4.8 · low │ ⎇ fixture-branch │ 🎯 proj',
      '  👤 claude │ 🤖 Sonnet 5 · high │ ⎇ main │ 🎯 proj',
    ].join('\n');
    const s = parseStatusline(pane);
    expect(s.branch).toBe('main');
    expect(s.model).toBe('Sonnet 5');
  });

  it('reads no identity at all when the pane shows chat but no statusline row', () => {
    // A dialog overlay covering the statusline: whatever chat is on screen
    // is not a reading. `undefined` here is watch.ts's "measured nothing"
    // tick, which keeps the last-known identity.
    const s = parseStatusline('● see the ⎇ main segment and the 🤖 Opus 4.8 · xhigh one\n❯ 1. Yes\n  2. No');
    expect(s.branch).toBeUndefined();
    expect(s.model).toBeUndefined();
    expect(s.effort).toBeUndefined();
  });

  it('a row whose first segment is not 👤 is not the statusline', () => {
    // statusline-command.sh writes `👤 <account>` first, unconditionally. A
    // `│`-separated line without it is chat, even when it is shaped like a row.
    const s = parseStatusline('● e.g.  🤖 Opus 4.8 · xhigh │ ⎇ fixture-branch');
    expect(s.branch).toBeUndefined();
    expect(s.model).toBeUndefined();
  });

  it('a line with 👤 in its middle is not the statusline — the row is LED by it', () => {
    // An overlay hides the real row, and chat quotes one. `👤` somewhere in the
    // line is not the row's shape; `👤` at its start is.
    const s = parseStatusline('● the fixture row was 👤 claude │ ⎇ fixture-branch │ 🎯 proj\n❯ 1. Yes\n  2. No');
    expect(s.branch).toBeUndefined();
    expect(s.model).toBeUndefined();
  });

  it('reads a glyph only where it OPENS a segment of the row', () => {
    // A 👤-led line is still only a statusline where each fact is its own
    // `│` segment; a glyph in the middle of a segment's text is prose.
    const s = parseStatusline('  👤 claude, and ⎇ main is where the branch goes │ 🎯 proj');
    expect(s.branch).toBeUndefined();
  });

  it('still reads a segment that ends in … when the row goes on past it', () => {
    // Only the row's LAST segment can be the one the terminal cut; a `…`
    // with a separator after it was drawn by the statusline itself.
    const s = parseStatusline('  👤 claude │ 🤖 Sonnet 5 · high │ ⎇ wip… │ 🎯 proj');
    expect(s.branch).toBe('wip…');
  });

  // The ctx reading used to scan every line on its own, so on a pane that cut
  // the row before its fifth segment it climbed into chat: model and effort
  // from the real row, ctxPct from a sentence above it — one Statusline built
  // from two rows. It now reads the statusline row's own `▓` segment only.
  it('reads ctx only from the statusline row — a narrow row that lost its ▓ segment borrows none from chat', () => {
    const pane = [
      // A tool's output printing a ctx segment — whole, so it passes the
      // segment shape on its own; only its not being the ROW rejects it.
      '  ⎿  ▓ ctx ████████ 97%',
      '  👤 acct-a │ 🤖 Opus 5.5 (1M context) · xhigh │ ⎇ ws/ccr…',
    ].join('\n');
    const s = parseStatusline(pane);
    expect(s.model).toBe('Opus 5.5 (1M context)');
    expect(s.ctxPct).toBeUndefined();
  });

  it('reads no ctx from a ▓ segment the terminal cut short', () => {
    const s = parseStatusline('  👤 acct-a │ 🤖 Sonnet 5 · high │ ⎇ main │ 🎯 proj │ ▓ ctx ████░…');
    expect(s.ctxPct).toBeUndefined();
    expect(s.branch).toBe('main');
  });
});

// The prompt box's width, off its bottom border. Layout from real Claude Code
// 2.1.280 captures on private tmux servers (both renderers): top rule, the `❯`
// input row, bottom rule, the `👤` statusline row, the mode row — every rule
// exactly as long as the pane is wide, at every width from 20 to 220.
const box = (cols: number, row: string): string => [
  '⏺ Done — the suite is green.',
  '',
  '─'.repeat(cols),
  '❯\u00a0',
  '─'.repeat(cols),
  row,
  '  ⏵⏵ bypass permissions on (shift+tab to cycle)',
].join('\n');
const ROW = '  👤 acct-a │ 🤖 Opus 5.5 (1M context) · xhigh │ ⎇ main │ 🎯 proj │ ▓ ctx ████░░░░ 45%';

describe('parseStatusline: boxCols', () => {
  it('reads the width of the rule directly above the statusline row', () => {
    expect(parseStatusline(box(220, ROW)).boxCols).toBe(220);
    expect(parseStatusline(box(150, ROW)).boxCols).toBe(150);
  });

  it('reads it off a CUT row too — a narrow pane is exactly what it measures', () => {
    const s = parseStatusline(box(60, '  👤 acct-a │ 🤖 Opus 5.5 (1M context) · xhigh │ ⎇ ws/cc…'));
    expect(s.boxCols).toBe(60);
    expect(s.branch).toBeUndefined();
  });

  it('steps over the auto-continue footer Claude Code draws between the border and the row', () => {
    // Real 2.1.280 subscriber-limit panes with auto-continue on (both renderers).
    const pane = [
      '─'.repeat(160), '❯\u00a0', '─'.repeat(160),
      '  ⚠ Usage limit reached · continuing automatically at 5:49pm · esc to cancel',
      ROW, '  ⏸ manual mode on · ← for agents',
    ].join('\n');
    expect(parseStatusline(pane).boxCols).toBe(160);
    expect(promptBoxShowing(pane)).toBe(true);
  });

  it('reads nothing when the line above the row is not a bare rule', () => {
    // A blank line between them: whatever this is, it is not the prompt box.
    expect(parseStatusline(['─'.repeat(200), '', ROW].join('\n')).boxCols).toBeUndefined();
    // The TOP border can carry a title; the bottom one never does, and a
    // titled line is not a width.
    expect(parseStatusline(['─'.repeat(180) + ' ultracode ─', ROW].join('\n')).boxCols).toBeUndefined();
  });

  it('reads nothing off an indented rule — tool output under `⎿` is not the prompt box', () => {
    const pane = ['  ⎿  ' + '─'.repeat(150), '     👤 fake │ 🤖 Fake Model 1 · low │ ⎇ decoy'].join('\n');
    expect(parseStatusline(pane).boxCols).toBeUndefined();
  });

  it('reads nothing without a statusline row, whatever rules are on screen', () => {
    expect(parseStatusline(['─'.repeat(220), '❯ 1. Yes, proceed', '─'.repeat(220)].join('\n')).boxCols).toBeUndefined();
  });

  it('reads the rule above the LOWEST row — an impostor row printed in chat above the box does not steer it', () => {
    const pane = [
      '─'.repeat(40),
      '  👤 fake │ 🤖 Fake Model 1 · low │ ⎇ decoy',
      box(200, ROW),
    ].join('\n');
    expect(parseStatusline(pane).boxCols).toBe(200);
  });
});

// ultracode and the Workflow row, read where Claude Code draws them — the top
// border of the prompt box, and the footer below the statusline row — and not
// off any line that happens to contain the words. Both used to scan the whole
// pane, so this repository's own fixtures, shown in a diff or a Read, set them.
const ULTRA_BORDER = '─'.repeat(170) + ' ultracode ─';
const layout = (above: string[], top: string, box: string[], below: string[] = []): string => [
  ...above, '', top, ...box, '─'.repeat(182), ROW, '  ⏵⏵ bypass permissions on (shift+tab to cycle)', ...below,
].join('\n');

describe('parseStatusline: ultracode is the prompt box\'s top-border title', () => {
  it('reads the title on the border above the box', () => {
    expect(parseStatusline(layout([], ULTRA_BORDER, ['❯\u00a0'])).ultracode).toBe(true);
  });

  it('reads it past a TALL draft — the box grows with every line, and the walk has no bound', () => {
    // Measured on 2.1.280: a 20-line draft put the titled border 23 rows above
    // the statusline row; a 16-row walk bound read ultracode false there.
    const draft = ['❯ line 1', ...Array.from({ length: 19 }, (_, i) => `  line ${i + 2}`), ''];
    expect(parseStatusline(layout([], ULTRA_BORDER, draft)).ultracode).toBe(true);
  });

  it('reads it past a multi-line draft in the box', () => {
    const draft = ['❯ first line of a draft', '  second line', '  ─── a rule the user typed? no: ─ in text', '  third'];
    expect(parseStatusline(layout([], ULTRA_BORDER, draft)).ultracode).toBe(true);
  });

  it('is false when the top border carries no title', () => {
    expect(parseStatusline(layout([], '─'.repeat(182), ['❯\u00a0'])).ultracode).toBe(false);
  });

  it('does not read a titled-border line printed in chat above an untitled box', () => {
    // A Read of this very file, or a quoted capture, above the box.
    const pane = layout(['⏺ The fixture reads:', ULTRA_BORDER, '  and the parser should…'], '─'.repeat(182), ['❯\u00a0']);
    expect(parseStatusline(pane).ultracode).toBe(false);
  });

  it('does not read a diff of the fixture either', () => {
    const pane = layout([`+  '${ULTRA_BORDER}',`], '─'.repeat(182), ['❯\u00a0']);
    expect(parseStatusline(pane).ultracode).toBe(false);
  });

  it('reads nothing without a statusline row, whatever titled rules are on screen', () => {
    expect(parseStatusline([ULTRA_BORDER, '❯\u00a0', '─'.repeat(182)].join('\n')).ultracode).toBe(false);
  });

  it('reads no title for a row with chat directly above it — that row is not under a box', () => {
    // The overlay residual's shape: the real row is hidden, and the lowest
    // `👤` line left is one printed in chat. The walk stops at the first line
    // that is neither blank nor the box, so it never climbs into the chat.
    const pane = [ULTRA_BORDER, '⏺ Here is the statusline it prints:', '     👤 fake │ 🤖 Fake Model 1 · low'].join('\n');
    expect(parseStatusline(pane).ultracode).toBe(false);
  });
});

describe('parseStatusline: workflowActive is the footer\'s Workflow row', () => {
  const WF = '  ◉ plan-relevance-triage  Re-assess coverage · 0/4 agents done · 37s · ↓ 204.5k tokens';

  it('reads a Workflow row under the statusline row', () => {
    expect(parseStatusline(layout([], '─'.repeat(182), ['❯\u00a0'], [WF])).workflowActive).toBe(true);
  });

  it('does not read the same row quoted in chat above the box', () => {
    expect(parseStatusline(layout([WF], '─'.repeat(182), ['❯\u00a0'])).workflowActive).toBe(false);
  });

  it('does not read a sentence that merely contains the count', () => {
    // Below the row too: the count must OPEN one of the row's ` · ` parts.
    const pane = layout([], '─'.repeat(182), ['❯\u00a0'], ['  by then we had 2/4 agents done, roughly']);
    expect(parseStatusline(pane).workflowActive).toBe(false);
  });

  it('reads nothing without a statusline row', () => {
    expect(parseStatusline(WF).workflowActive).toBe(false);
  });

  // Claude Code 2.1.280, real private-tmux captures (mock API, a Workflow held
  // running), trimmed to the rows below the prompt box: the count is
  // right-aligned after padding, with no ` · ` before it.
  it('reads a real 2.1.280 Workflow row, at full width and at 60 columns', () => {
    const wide = [
      '─'.repeat(220), '❯\u00a0', '─'.repeat(220),
      '  👤 cfg │ 🤖 Opus 5.5 (1M context) · xhigh │ ⎇ ws/rig-branch │ 🎯 repo │ ▓ ctx ░░░░░░░░ 0% │ 💲 $0.0116',
      '  ⏸ manual mode on · ← for agents',
      '',
      '  ◯ triage  Rig probe workflow' + ' '.repeat(168) + '0/3 agents done · 2s',
    ].join('\n');
    expect(parseStatusline(wide).workflowActive).toBe(true);
    const narrow = [
      '─'.repeat(48) + ' ultracode ─', '❯\u00a0', '─'.repeat(60),
      '  👤 cfg │ 🤖 Opus 5.5 (1M context) · xhigh │ ⎇ ws/rig-br…',
      '  ⏸ manual mode on · ← for agents', '', '',
      '  ◯ triage  Rig probe workflow        0/3 agents done · 9s',
    ].join('\n');
    const s = parseStatusline(narrow);
    expect(s.workflowActive).toBe(true);
    // The same capture's top border is 2.1.280's real ultracode title.
    expect(s.ultracode).toBe(true);
  });
});
