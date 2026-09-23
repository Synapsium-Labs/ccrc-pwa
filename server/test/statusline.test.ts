import { describe, it, expect } from 'vitest';
import { parseStatusline } from '../src/pane/statusline.js';

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
