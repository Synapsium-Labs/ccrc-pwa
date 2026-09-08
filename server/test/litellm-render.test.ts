// §6.3 — LiteLLM's model list is generated from the lane's catalogue, and the
// rest of its config is carried verbatim from a template in `deploy/`.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LitellmTemplateInvalid, MODEL_LIST_MARKER, renderLitellmConfig } from '../../shared/litellm.mjs';
import { CODEX } from './fixtures/modelCases.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(here, '..', '..');
const TEMPLATE = readFileSync(path.join(REPO, 'deploy', 'litellm-config.template.yaml'), 'utf8');

describe('the shipped template', () => {
  it('carries the marker exactly once, on its own line', () => {
    const lines = TEMPLATE.split('\n').filter((l) => l.trim() === MODEL_LIST_MARKER);
    expect(lines).toHaveLength(1);
  });

  it('carries NO reasoning key — effort has exactly one owner, the shim (§6.3)', () => {
    // A substring ban, so it covers prose as well as YAML: a comment naming a
    // `reasoning:` key is the first move of somebody adding one back.
    expect(TEMPLATE).not.toContain('reasoning:');
  });

  it('carries drop_params and the master key, which the generator must not invent', () => {
    expect(TEMPLATE).toContain('drop_params: true');
    expect(TEMPLATE).toContain('master_key: os.environ/LITELLM_MASTER_KEY');
  });
});

describe('renderLitellmConfig', () => {
  const rendered = (): string => renderLitellmConfig(TEMPLATE, CODEX);

  it('emits one entry per VISIBLE model and NO [1m] alias, for any model, and nothing for '
    + 'hidden ones (§6.3, amended 2026-09-08, Task 16c)', () => {
    // A `/model <id>[1m]` believes the client has a 1M window no measured wall
    // supports (§6.1's amendment above); LiteLLM now refuses that name loudly
    // instead of routing the request to a real entry with the wrong window.
    const out = rendered();
    expect(out).not.toMatch(/\[1m\]/);
    for (const id of ['gpt-6-astra', 'gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna',
      'gpt-5.5', 'gpt-5.4-mini', 'gpt-5.3-codex-spark']) {
      expect(out, id).toContain(`  - model_name: ${id}\n`);
      expect(out, id).toContain(`litellm_params: {model: chatgpt/${id}}`);
    }
    expect(out).not.toContain('gpt-reserve');
    expect(out).not.toContain('codex-auto-review');
  });

  it('is 7 entries for today\'s catalogue — one per visible model, no [1m] alias', () => {
    expect(rendered().split('\n').filter((l) => l.startsWith('  - model_name: '))).toHaveLength(7);
  });

  it('gives every entry mode: responses — the provider requires it', () => {
    expect(rendered().split('\n').filter((l) => l.includes('model_info: {mode: responses}')))
      .toHaveLength(7);
  });

  it('emits NO reasoning key, for any model', () => {
    // Scoped to the GENERATED block, not the whole file: the template's own
    // header comment (carried verbatim, above the marker) legitimately says
    // "reasoning" several times explaining why there is none — a whole-file
    // substring ban would fail on that prose. The template-level "carries NO
    // reasoning key" case above already bans a literal `reasoning:` key
    // anywhere, including in a comment; this one is "for any model" — the
    // entries this function generates.
    const out = rendered();
    const modelListBlock = out.slice(out.indexOf('model_list:'), out.indexOf('litellm_settings:'));
    expect(modelListBlock).not.toContain('reasoning');
  });

  it('carries the template\'s other two blocks verbatim, in order', () => {
    const out = rendered();
    expect(out).toContain('litellm_settings:\n  # The ChatGPT backend rejects');
    expect(out).toContain('drop_params: true');
    expect(out).toContain('master_key: os.environ/LITELLM_MASTER_KEY');
    expect(out.indexOf('model_list:')).toBeLessThan(out.indexOf('litellm_settings:'));
    expect(out.indexOf('litellm_settings:')).toBeLessThan(out.indexOf('general_settings:'));
  });

  it('the marker line itself is gone from the output', () => {
    expect(rendered()).not.toContain(MODEL_LIST_MARKER);
  });

  it('is deterministic — the same catalogue renders the same bytes', () => {
    expect(rendered()).toBe(rendered());
  });

  it('refuses a template with no marker rather than appending to the end', () => {
    expect(() => renderLitellmConfig('model_list: []\n', CODEX)).toThrow(LitellmTemplateInvalid);
  });

  it('refuses a template with TWO markers — the destination must be unambiguous', () => {
    expect(() => renderLitellmConfig(`${MODEL_LIST_MARKER}\n${MODEL_LIST_MARKER}\n`, CODEX))
      .toThrow(LitellmTemplateInvalid);
  });

  it('refuses a catalogue with no visible models — a config with an empty list serves nothing', () => {
    const hiddenOnly = { ...CODEX, models: CODEX.models.map((m) => ({ ...m, hidden: true })) };
    expect(() => renderLitellmConfig(TEMPLATE, hiddenOnly)).toThrow(LitellmTemplateInvalid);
  });

  it('refuses a model id carrying a character YAML would reinterpret', () => {
    // The ids go into an unquoted YAML scalar. `:` followed by a space, `#`
    // preceded by a space, and a leading `-` all change what the line means.
    // A catalogue that carried one would produce a config LiteLLM parses into
    // something else, silently.
    const nasty = { ...CODEX, models: [{ ...CODEX.models[0]!, id: 'gpt: 6', hidden: false }] };
    expect(() => renderLitellmConfig(TEMPLATE, nasty)).toThrow(LitellmTemplateInvalid);
  });
});
