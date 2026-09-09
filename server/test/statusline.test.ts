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
});
