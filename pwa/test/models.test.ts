import { describe, it, expect } from 'vitest';
import { modelOptions, effortOptions } from '../src/lib/models';

/**
 * The session pickers' one pin. `modelOptions` is wrapper-aware — the gpt
 * overflow lane maps Claude Code's model ALIASES onto Codex tiers through
 * `~/.local/bin/ccgpt`'s exports and `~/.claude-gpt/settings.json`'s env block
 * (and settings WINS: Claude Code Object.assigns settings env over the process
 * environment at runtime).
 *
 * D-2015: the `fable` alias on that lane used to name a loud sentinel
 * (`ccrc-unavailable-fable`) because the lane had only three tiers. The Codex
 * catalogue now offers `gpt-6-astra`, the alias names it, and the picker has to
 * offer the row — otherwise the tier is reachable only by typing `/model fable`,
 * which is exactly the knowledge a phone-first console exists to remove.
 */
describe('modelOptions', () => {
  const commands = (w: string, cur: string | null = null) => modelOptions(w, cur).map((o) => o.command);

  it('offers the gpt lane four tiers, astra on the fable alias', () => {
    expect(commands('gpt')).toEqual([
      '/model fable',
      '/model opus',
      '/model sonnet',
      '/model haiku',
    ]);
    expect(modelOptions('gpt', null).map((o) => o.label)).toEqual([
      'GPT-6 Astra',
      'GPT-5.6 Sol',
      'GPT-5.6 Terra',
      'GPT-5.6 Luna',
    ]);
  });

  it('never offers a bare "Default" on the gpt lane', () => {
    // `/model default` resolves through ANTHROPIC_MODEL, which the wrapper owns;
    // offering it would present a row whose meaning the console cannot state.
    expect(commands('gpt')).not.toContain('/model default');
  });

  it('leaves the Anthropic lanes untouched', () => {
    expect(commands('claude')).toEqual([
      '/model opus',
      '/model sonnet',
      '/model fable',
      '/model haiku',
      '/model default',
    ]);
    expect(modelOptions('claude', null).map((o) => o.label)).not.toContain('GPT-6 Astra');
  });

  it('highlights the live tier from the statusline display name, and only that one', () => {
    const active = (w: string, cur: string) => modelOptions(w, cur).filter((o) => o.active).map((o) => o.label);
    expect(active('gpt', 'gpt-6-astra')).toEqual(['GPT-6 Astra']);
    expect(active('gpt', 'gpt-5.6-sol')).toEqual(['GPT-5.6 Sol']);
    expect(active('gpt', 'gpt-5.6-terra')).toEqual(['GPT-5.6 Terra']);
    expect(active('gpt', 'gpt-5.6-luna')).toEqual(['GPT-5.6 Luna']);
    // The 1M-context suffix the Anthropic lanes render must not defeat the match.
    expect(active('claude', 'Opus 5 (1M context)')).toEqual(['Opus 5']);
  });

  it('matches a tier name case-insensitively, as the pane may title-case it', () => {
    expect(modelOptions('gpt', 'GPT-6 Astra').filter((o) => o.active).map((o) => o.label)).toEqual(['GPT-6 Astra']);
  });
});

describe('effortOptions', () => {
  it('withholds ultracode from the gpt lane and offers it everywhere else', () => {
    expect(effortOptions('gpt', 'high', false).map((o) => o.command)).not.toContain('/effort ultracode');
    expect(effortOptions('claude', 'high', false).map((o) => o.command)).toContain('/effort ultracode');
  });
});
