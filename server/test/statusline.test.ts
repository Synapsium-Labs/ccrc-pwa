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
      model: undefined, effort: undefined, ultracode: false, branch: undefined, workflowActive: undefined,
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
    // A statusline row and no workflow line below it → a measured false.
    expect(parseStatusline('  👤 team·max │ 🤖 Opus 4.8 · xhigh │ ⎇ main').workflowActive).toBe(false);
    // No `👤` row at all → nothing below it was seen: unmeasured, not false.
    expect(parseStatusline('  🤖 Opus 4.8 · xhigh │ ⎇ main').workflowActive).toBeUndefined();
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
    // Below the row too: a Workflow row opens with its bullet (`◯`/`◉`/`⏸`).
    const pane = layout([], '─'.repeat(182), ['❯\u00a0'], ['  by then we had 2/4 agents done, roughly']);
    expect(parseStatusline(pane).workflowActive).toBe(false);
    // Its count followed by ` · `, as a row's is: the count reader alone would
    // take this one, so only the missing bullet keeps it out.
    const dotted = layout([], '─'.repeat(182), ['❯\u00a0'], ['  by then 2/4 agents done · the rest queued']);
    expect(parseStatusline(dotted).workflowActive).toBe(false);
  });

  // No `👤` row, so no "below" to read: an overlay, or a pane mid-render. That
  // is UNMEASURED (`undefined`), never a measured `false` — FleetWatcher keeps
  // the last reading across it rather than dropping a running Workflow's card
  // to idle (and firing "✓ Finished") for as long as the overlay is up.
  it('measures nothing without a statusline row: undefined, not false', () => {
    expect(parseStatusline(WF).workflowActive).toBeUndefined();
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

  // A FINISHED Workflow's row stays mounted for ~30 s after the run ends, with
  // the same glyph and shape as a running one; only its count has caught up
  // (`3/3`, or `2/3 agents done · 1 failed` — 2.1.280 counts a failed agent
  // apart from the done ones, and its own "complete" is done + failed ≥ total),
  // and its clock stops. Read as running, it held the orchestrator's card `busy`
  // — and the "turn finished" push back — for that half minute.
  //
  // Real 2.1.280 rows (private tmux, mock API), each under its real footer.
  // Sampled every ~100 ms through a three-phase workflow, each phase's new
  // agents were counted on the repaint that finished the last (0/1 → 1/3,
  // 2/3 → 3/4). NOT ALWAYS: a script that awaits a timer between agents, or
  // worktree-isolated agents being torn down, reads N/N with its clock running
  // (measured by review), so the count alone can call a running workflow
  // finished. From 2.1.277 (measured through 2.1.283) that is masked — Claude
  // Code's own live status reads busy while any workflow runs, and fleet.ts
  // consults this row only where that file did not measure idle for such a
  // build — so it bites only where that status is unreadable. It read `0/0`
  // for one sample at launch.
  const footer = (row: string) => [
    '─'.repeat(220), '❯ ', '─'.repeat(220),
    '  👤 cfg │ 🤖 Opus 5.5 (1M context) · medium │ ⎇ ws/rig-branch │ 🎯 repo │ ▓ ctx ░░░░░░░░ 0% │ 💲 $0.0376',
    '  ⏸ manual mode on · ← for agents',
    row,
  ].join('\n');
  const DONE_3 = '  ◯ triage  Rig probe workflow' + ' '.repeat(146) + '3/3 agents done · 1m 15s · ↓ 3.6k tokens';
  const DONE_4 = '  ◯ twophase  Phase probe' + ' '.repeat(151) + '4/4 agents done · 16s · ↓ 4.8k tokens';
  const FAIL_ROW = (count: string) => '  ◯ rv5fail  Fail probe' + ' '.repeat(148) + count;

  it('does not read a finished Workflow\'s lingering row as running', () => {
    expect(parseStatusline(footer(DONE_3)).workflowActive).toBe(false);
    expect(parseStatusline(footer(DONE_4)).workflowActive).toBe(false);
  });

  it('counts a failed agent as finished: 2 done + 1 failed of 3 is a finished run', () => {
    expect(parseStatusline(footer(FAIL_ROW('2/3 agents done · 1 failed · 6s · ↓ 2.4k tokens'))).workflowActive).toBe(false);
  });

  it('still reads a run with a failure but agents left as running', () => {
    expect(parseStatusline(footer(FAIL_ROW('1/3 agents done · 1 failed · 5s · ↓ 1.2k tokens'))).workflowActive).toBe(true);
  });

  it('still reads every mid-run count as running, across phase changes', () => {
    for (const count of ['0/1 agents done · 0s', '1/3 agents done · 5s · ↓ 1.2k tokens', '2/3 agents done · 9s · ↓ 2.4k tokens', '3/4 agents done · 11s · ↓ 3.6k tokens']) {
      expect([count, parseStatusline(footer('  ◯ twophase  Phase probe' + ' '.repeat(151) + count)).workflowActive]).toEqual([count, true]);
    }
  });

  it('reads a 0/0 row as running — the launch row; a run that died before its first agent is indistinguishable, a known limit', () => {
    expect(parseStatusline(footer('  ◯ twophase  Phase probe' + ' '.repeat(151) + '0/0 agents done · 0s')).workflowActive).toBe(true);
  });

  it('reads a running row beside a finished one as running', () => {
    const both = footer(DONE_3) + '\n  ◯ twophase  Phase probe' + ' '.repeat(151) + '1/3 agents done · 5s';
    expect(parseStatusline(both).workflowActive).toBe(true);
  });

  // 2.1.280 puts the count after ONE space, not padding, once the description
  // is cut to `…` or dropped (a narrow pane). Real rows (private tmux, mock
  // API, the rig's narrow run: e1 done, e2 failed, e3 running), captured at
  // 120 and 60 columns; the 120-column one is READER_MIN_COLS wide.
  it('reads a 2.1.280 count after one space: a description cut to `…`, and none at all', () => {
    const running = [
      '  ◯ narrowprobe  A deliberately long description for the narrow pane … 1/3 agents done · 1 failed · 6s · ↓ 1.2k tokens',
      '  ◯ narrowprobe 1/3 agents done · 1 failed · 9s · ↓ 1.2k',
    ];
    for (const row of running) expect([row, parseStatusline(footer(row)).workflowActive]).toEqual([row, true]);
    // The same run finished (2 done + 1 failed of 3), same width, same shape.
    const done = '  ◯ narrowprobe  A deliberately long description for the narrow pane… 2/3 agents done · 1 failed · 17s · ↓ 2.4k tokens';
    expect(parseStatusline(footer(done)).workflowActive).toBe(false);
  });

  // At 36 columns 2.1.280 cuts the row raw, with no `…`, just past the number
  // after the count's ` · `. With a failure that number opens `1 failed`, the
  // word cut off (the first two rows: real, from the same run). With none it
  // opens the CLOCK: the parts are `[count, clock, tokens].join(" · ")`, so a
  // no-failure run cut there ends `· 7` (the third: format-derived, not
  // captured). The two cannot be told apart, so the number is never read as
  // failures — an ambiguous row reads RUNNING (fail toward busy), and a
  // finished run with a failure, cut this way, holds its card for the ~30 s it
  // lingers where fleet.ts consults the row at all.
  it('reads a row cut after `· N` as running — the number may be a clock, not a failed count', () => {
    for (const row of [
      '  ◯ narrowprobe 1/3 agents done · 1', // running, `1 failed` cut
      '  ◯ narrowprobe 2/3 agents done · 1', // FINISHED (2 + 1 failed of 3), cut the same way
      '  ◯ narrowprobe 1/3 agents done · 7', // running, no failures, `7s` cut
      // Synthesized: the real 36-column row cut one and three columns earlier.
      // A count is still read when the ` · ` after it is cut to `·`, or when
      // the row ends at the count.
      '  ◯ narrowprobe 1/3 agents done · ',
      '  ◯ narrowprobe 1/3 agents done ',
    ]) expect([row, parseStatusline(footer(row)).workflowActive]).toEqual([row, true]);
    // Synthesized: the word survives, so it IS a failed count (2 + 1 of 3).
    expect(parseStatusline(footer('  ◯ narrowprobe 2/3 agents done · 1 failed')).workflowActive).toBe(false);
  });

  // NOT CAPTURED — derived from 2.1.280's format strings: the paused glyph
  // `⏸` and the statuses `[["paused", "usage limit resets …"], ["paused",
  // "usage limit"], ["paused"]]`. A workflow pauses on a usage limit only
  // under subscriber auth, which the API-key rig cannot reach. A paused row
  // carries no count, and only a RUNNING task is ever paused.
  it('reads a 2.1.280 row paused on a usage limit as running', () => {
    const paused = '  ⏸ triage  Rig probe workflow' + ' '.repeat(120) + 'paused · usage limit resets at 3pm';
    expect(parseStatusline(footer(paused)).workflowActive).toBe(true);
    // Cut raw at a narrow pane's edge, the way 2.1.280 cuts its count rows
    // (`2/3 agents done · 1` at 36 columns, above): still paused.
    expect(parseStatusline(footer('  ⏸ triage paused · usage li')).workflowActive).toBe(true);
    // The footer's own `⏸ manual mode on · ← for agents` line, alone, is not one.
    expect(parseStatusline(footer('')).workflowActive).toBe(false);
  });
});

// Claude Code 2.1.281+ redrew the row: `◯ <name>  <pill>  N/M · <clock> · ↓ <n>
// tokens`. No description, no `agents done`, and NO FAILED COUNT (a failure
// only colours the bullet, which a plain `capture-pane -p` does not carry).
// The pill is 20, 12 or 8 cells of `▰`/`▱` (`█`/`░` under Ghostty), filled
// `floor(done·W/total)`: every cell full iff done ≥ total > 0, every cell
// empty on a 0-total launch — so "any empty cell" is #194's rule minus the
// failed count this build never prints.
//
// Every row below is a real private-tmux capture (mock API; 2.1.281, 2.1.282
// and 2.1.283 draw them identically), unless its test says otherwise. The rig
// ran three agents: e1 done at 1 s, e2 fails, e3 done at 12 s. `footer281` is
// the 2.1.283 pane from the prompt box down, the rig's own `tmux focus-events
// off …` notice cut from the end of the 👤 row.
describe('parseStatusline: workflowActive on 2.1.281+ Workflow rows', () => {
  const MODE_283 = '  ⏵⏵ auto mode on (shift+tab to cycle) · ← for agents';
  const MODE_281 = '  ⏸ manual mode on · ← for agents';
  const footer281 = (row: string, mode = MODE_283) => [
    '─'.repeat(220), '❯\u00a0', '─'.repeat(220),
    '  👤 cfg │ 🤖 Opus 5.5 (1M context) · medium │ ⎇ ws/rig-branch │ 🎯 repo │ ▓ ctx ░░░░░░░░ 0% │ 💲 $0.0115',
    mode, '', row,
  ].join('\n');
  const RUN_1_3 = '  ◯ allprobe  ▰▰▰▰▰▰▱▱▱▱▱▱▱▱▱▱▱▱▱▱  1/3 · 7s · ↓ 1.2k tokens';
  const ALL_DONE = '  ◯ allprobe  ▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰  3/3 · 13s · ↓ 3.6k tokens';

  it('reads a running row: the launch, one agent done, two of three done', () => {
    const running = [
      '  ◯ allprobe  ▱▱▱▱▱▱▱▱▱▱▱▱▱▱▱▱▱▱▱▱  0/3 · 0s',
      RUN_1_3,
      '  ◯ allprobe  ▰▰▰▰▰▰▰▰▰▰▰▰▰▱▱▱▱▱▱▱  2/3 · 5s · ↓ 2.4k tokens',
    ];
    for (const row of running) expect([row, parseStatusline(footer281(row)).workflowActive]).toEqual([row, true]);
  });

  it('reads it under the 2.1.281/282 footer, whose own `⏸ manual mode on` line is not a paused row', () => {
    expect(parseStatusline(footer281(RUN_1_3, MODE_281)).workflowActive).toBe(true);
    expect(parseStatusline(footer281('', MODE_281)).workflowActive).toBe(false);
  });

  // NOT CAPTURED — constructed from source: `/pause-memory` adds the
  // right-column mode label `memory paused` (`<flag>()?["memory paused"]:[]`,
  // in every binary from 2.1.277 to 2.1.284, handed to the footer's right
  // column as `modeLabels`), and in a wide pane with no notification that
  // column shares the MODE line's row — a real capture shows `● high ·
  // /effort` doing exactly that. A `⏸` line whose body opens `<word> mode on`
  // is the footer's mode line, never a Workflow row, whatever the right
  // column says.
  it('does not read the footer\'s `⏸ … mode on` line as paused when a right-aligned `memory paused` shares its row', () => {
    const right = (mode: string) => mode + ' '.repeat(220 - mode.length - 'memory paused'.length) + 'memory paused';
    for (const mode of [MODE_281, '  ⏸ plan mode on (shift+tab to cycle)']) {
      expect([mode, parseStatusline(footer281('', right(mode))).workflowActive]).toEqual([mode, false]);
    }
    // A running row under that same footer still reads.
    expect(parseStatusline(footer281(RUN_1_3, right(MODE_281))).workflowActive).toBe(true);
  });

  // A 0-total launch has no count segment at all (it appears only once
  // totalAgents > 0). #194 reads 0/0 as running; this is the same row. A run
  // that died before its first agent lingers identically (measured: `2s`,
  // clock stopped, live status already idle) — the same known limit as 0/0.
  it('reads a zero-agent launch row, which has no count, as running', () => {
    expect(parseStatusline(footer281('  ◯ zeroprobe  ▱▱▱▱▱▱▱▱▱▱▱▱▱▱▱▱▱▱▱▱  0s')).workflowActive).toBe(true);
  });

  // Resized during the run (2.1.283): the count is the FIRST segment dropped
  // as the pane narrows, then the clock; below ~42 columns the pill shrinks
  // to 12, then 8 cells. The 60-column block is the whole real capture from
  // the prompt box down.
  it('reads a narrowed row once the count, then the clock, are dropped and the pill shrinks', () => {
    const at60 = (row: string) => [
      '────────────────────────────────────────────────────────────',
      '❯\u00a0',
      '────────────────────────────────────────────────────────────',
      '  👤 cfg │ 🤖 Opus 5.5 (1M context) · medium │ ⎇ ws/rig-b…',
      '  ⏵⏵ auto mode on (shift+tab to cycle) · ← for agents',
      '                                        ◐ medium · /effort',
      '',
      row,
    ].join('\n');
    const rows = [
      '  ◯ narrowprobe  ▰▰▰▰▰▰▱▱▱▱▱▱▱▱▱▱▱▱▱▱  8s · ↓ 1.2k tokens', // 60 columns
      '  ◯ narrowprobe  ▰▰▰▰▰▰▱▱▱▱▱▱▱▱▱▱▱▱▱▱  ↓ 1.2k', // 50
      '  ◯ narrowprobe  ▰▰▰▰▱▱▱▱▱▱▱▱  ↓ 1.2k', // 42: a 12-cell pill
    ];
    for (const row of rows) expect([row, parseStatusline(at60(row)).workflowActive]).toEqual([row, true]);
  });

  it('does not read a finished row whose pill is full, nor a pill cut by `…`', () => {
    expect(parseStatusline(footer281(ALL_DONE)).workflowActive).toBe(false);
    // Synthesized: no capture has shown Claude Code cutting its own pill (it
    // picks a 20/12/8-cell one that fits), so a cut pill is an unmeasured
    // shape and is not read — not even one whose visible cells include an
    // empty one.
    for (const row of ['  ◯ allprobe  ▰▰▰▰…', '  ◯ allprobe  ▰▰▰▰▰▰▱▱…']) {
      expect([row, parseStatusline(footer281(row)).workflowActive]).toEqual([row, false]);
    }
  });

  // NOT CAPTURED — the Ghostty pill (`█`/`░`, `hasGeometricShapesInkBleedBug`)
  // and the footer selection's `❯ ` prefix are source-read. Derived from the
  // real rows by substitution, never retyped.
  it('reads the Ghostty pill and a row the footer selection is on', () => {
    const ghostty = (row: string) => row.replace(/▰/g, '█').replace(/▱/g, '░');
    expect(parseStatusline(footer281(ghostty(RUN_1_3))).workflowActive).toBe(true);
    expect(parseStatusline(footer281(ghostty(ALL_DONE))).workflowActive).toBe(false);
    expect(parseStatusline(footer281(RUN_1_3.replace(/^ {2}/, '❯ '))).workflowActive).toBe(true);
  });

  // THE KNOWN LIMIT, PINNED. This is the rig's finished run (e2 failed): the
  // row stayed on screen for 30 s after Claude Code's live status went idle,
  // and it reads as RUNNING, because 2.1.281+ prints no failed count. A killed
  // run (`k/M`) reads the same. fleet.ts therefore must not let this row
  // override an idle that a 2.1.277+ live-status file affirmatively measured
  // (fleet.test.ts pins that gate).
  it('reads a finished run with a failed agent as running — a known limit fleet.ts gates around', () => {
    expect(parseStatusline(footer281('  ◯ allprobe  ▰▰▰▰▰▰▰▰▰▰▰▰▰▱▱▱▱▱▱▱  2/3 · 13s · ↓ 2.4k tokens')).workflowActive).toBe(true);
  });

  // NOT CAPTURED — derived from the 2.1.281/2.1.283 format strings: bullet
  // `⏸` iff the row carries `pausedStatuses`, drawn with no pill as
  // `paused · usage limit resets …`, then `paused · usage limit`, then `paused`
  // as the pane narrows.
  it('reads a row paused on a usage limit as running, at each width\'s status', () => {
    for (const row of ['  ⏸ allprobe  paused · usage limit resets at 3pm', '  ⏸ allprobe  paused · usage limit', '  ⏸ allprobe  paused']) {
      expect([row, parseStatusline(footer281(row)).workflowActive]).toEqual([row, true]);
    }
  });

  // NOT CAPTURED — background-task rows share the footer container and the
  // `◯` bullet (source-read). None carries a pill or a count of its own.
  // `◯ Draw a bar ▰▰▱▱` is a description that merely ENDS in pill glyphs: a
  // Workflow's pill follows its name column after TWO spaces, never one. The
  // last QUOTES a count in its activity text, one space in, with its own clock
  // after two spaces: a 2.1.280 count is followed by ` · ` or ends the row.
  it('does not read a background-task row as a Workflow', () => {
    for (const row of [
      '  ◯ main', '  ◯ 2 idle agents', '  ◯ Explore the repo  Searching for workflow rows  12s · ↓ 3.4k tokens', '  ◯ Draw a bar ▰▰▱▱',
      '  ◯ Verify the parser  Grep 1/4 agents done  12s · ↓ 3.4k tokens',
    ]) {
      expect([row, parseStatusline(footer281(row)).workflowActive]).toEqual([row, false]);
    }
  });
});
