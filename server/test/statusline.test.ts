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
  });

  it('ultracode is false when the mode divider is plain dashes', () => {
    const pane = [
      '──────────────────────────────────────────────────────────────────────',
      '  👤 gpt │ 🤖 GPT 5.6 · high │ ⎇ main │ 🎯 rp-llm │ ▓ ctx ██░░ 20%',
    ].join('\n');
    const s = parseStatusline(pane);
    expect(s).toEqual({ model: 'GPT 5.6', effort: 'high', ultracode: false, branch: 'main' });
  });

  it('model without an effort segment still parses', () => {
    const s = parseStatusline('  👤 claude │ 🤖 Sonnet 5 │ ⎇ main │ 🎯 proj');
    expect(s.model).toBe('Sonnet 5');
    expect(s.effort).toBeUndefined();
    expect(s.ultracode).toBe(false);
  });

  it('a pane with no statusline (dialog overlay / fresh session) yields empties', () => {
    const s = parseStatusline('❯ 1. Option one\n  2. Option two\nEnter to select');
    expect(s).toEqual({ model: undefined, effort: undefined, ultracode: false });
  });

  it('does NOT false-positive ultracode from chat text mentioning the word', () => {
    const s = parseStatusline('assistant: we should turn on ultracode for this\n❯ ');
    expect(s.ultracode).toBe(false);
  });
});
