import { describe, it, expect } from 'vitest';
import { ROUTE_WRITABLE_FIELDS } from '../../shared/api';
import { EFFORT_LADDER } from '../../shared/routing-ladder';
import { modelOptions, effortOptions, type PickOption } from '../src/lib/models';

/**
 * The session pickers' one pin. `modelOptions` is wrapper-aware — the gpt
 * overflow lane maps Claude Code's model ALIASES onto Codex tiers through
 * `~/.local/bin/ccgpt`'s exports and `~/.claude-gpt/settings.json`'s env block
 * (and settings WINS: Claude Code Object.assigns settings env over the process
 * environment at runtime).
 *
 * Routing spec 2026-09-14 §5.3, slice 4, Task 5: a row no longer carries a
 * slash `command` — it carries the routing record write a tap performs
 * (`route: {field, value}`), which `SessionScreen`'s `pick` sends through
 * `POST /api/sessions/:id/route`.
 *
 * D-2015: the `fable` alias on that lane used to name a loud sentinel
 * (`ccrc-unavailable-fable`) because the lane had only three tiers. The Codex
 * catalogue now offers `gpt-6-astra`, the alias names it, and the picker has to
 * offer the row — otherwise the tier is reachable only by typing `/model fable`,
 * which is exactly the knowledge a phone-first console exists to remove.
 */
describe('modelOptions', () => {
  const routes = (w: string, cur: string | null = null) =>
    modelOptions(w, cur).map((o: PickOption) => `${o.route.field}=${o.route.value}`);

  it('offers the gpt lane four tiers, astra on the fable alias', () => {
    expect(routes('gpt')).toEqual([
      'class=fable',
      'class=opus',
      'class=sonnet',
      'class=haiku',
    ]);
    expect(modelOptions('gpt', null).map((o) => o.label)).toEqual([
      'GPT-6 Astra',
      'GPT-5.6 Sol',
      'GPT-5.6 Terra',
      'GPT-5.6 Luna',
    ]);
  });

  it('never offers a bare "Default" on the gpt lane', () => {
    // Routing to `class=default` resolves through ANTHROPIC_MODEL, which the
    // wrapper owns; offering it would present a row whose meaning the
    // console cannot state.
    expect(routes('gpt')).not.toContain('class=default');
  });

  it('leaves the Anthropic lanes untouched, ending in class=default', () => {
    expect(routes('claude')).toEqual([
      'class=opus',
      'class=sonnet',
      'class=fable',
      'class=haiku',
      'class=default',
    ]);
    expect(modelOptions('claude', null).map((o) => o.label)).not.toContain('GPT-6 Astra');
  });

  it('carries the readback key the read-back effect matches the live model string against', () => {
    // Same keys the "highlights the live tier" test above matches `active`
    // against — `readback` IS that key, reused (models.ts's own comment on
    // `PickOption.readback`) so `SessionScreen`'s read-back effect can tell
    // when a fleet frame agrees with a queued `class` write without
    // re-deriving the option list.
    expect(modelOptions('gpt', null).map((o) => o.readback)).toEqual([
      'astra', 'sol', 'terra', 'luna',
    ]);
    expect(modelOptions('claude', null).map((o) => o.readback)).toEqual([
      'opus', 'sonnet', 'fable', 'haiku',
      // Default's readback is the empty string. `SessionScreen`'s `pick`
      // never consults it for `class=default` — that value clears `queued`
      // immediately on the 2xx response (absence is not readable, there is
      // no distinguishing model string to read back), so this key is
      // populated but structurally unused for that one row. It still has to
      // be a real string, not undefined, so no caller has to special-case an
      // absent field on a type that promises one.
      '',
    ]);
  });

  it('every row writes a field ROUTE_WRITABLE_FIELDS knows, and never carries a command key', () => {
    for (const wrapper of ['gpt', 'claude']) {
      for (const o of modelOptions(wrapper, null)) {
        expect(ROUTE_WRITABLE_FIELDS as readonly string[], o.label).toContain(o.route.field);
        expect('command' in o, o.label).toBe(false);
      }
    }
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
    expect(effortOptions('gpt', 'high', false).map((o) => o.label)).not.toContain('Ultracode');
    expect(effortOptions('claude', 'high', false).map((o) => o.label)).toContain('Ultracode');
  });

  it('every row writes the effort field, ultracode included, and Auto writes effort=auto', () => {
    for (const wrapper of ['gpt', 'claude']) {
      for (const o of effortOptions(wrapper, null, false)) {
        expect(o.route.field, o.label).toBe('effort');
        expect('command' in o, o.label).toBe(false);
      }
    }
    expect(effortOptions('claude', null, false).find((o) => o.label === 'Auto')?.route)
      .toEqual({ field: 'effort', value: 'auto' });
    expect(effortOptions('claude', null, false).find((o) => o.label === 'Ultracode')?.route)
      .toEqual({ field: 'effort', value: 'ultracode' });
  });

  // The picker's five slider stops come from EFFORT_LADDER (shared/routing-ladder.ts)
  // rather than five hand-built rows — Auto and Ultracode are the picker's own
  // labelled superset on top of the ladder, never part of it.
  const levelRows = (opts: PickOption[]) =>
    opts.filter((o) => o.label !== 'Auto' && o.label !== 'Ultracode');

  it('the five level rows equal EFFORT_LADDER in order, capitalised', () => {
    const rows = levelRows(effortOptions('claude', null, false));
    expect(rows.map((o) => o.route.value)).toEqual([...EFFORT_LADDER]);
    expect(rows.map((o) => o.label)).toEqual(
      EFFORT_LADDER.map((v) => v[0]!.toUpperCase() + v.slice(1)),
    );
  });

  it('control: the five stops match the spec\'s own hand-written list — not a value derived from EFFORT_LADDER itself, so a reordered or shortened ladder reds this', () => {
    const rows = levelRows(effortOptions('claude', null, false));
    expect(rows.map((o) => o.route.value)).toEqual(['low', 'medium', 'high', 'xhigh', 'max']);
  });

  it('pins the full row order — Auto last, Ultracode spliced before Max on a non-gpt wrapper only — against a hand-written literal, not the ladder itself', () => {
    expect(effortOptions('claude', null, false).map((o) => o.label)).toEqual([
      'Low', 'Medium', 'High', 'Xhigh', 'Ultracode', 'Max', 'Auto',
    ]);
    expect(effortOptions('gpt', null, false).map((o) => o.label)).toEqual([
      'Low', 'Medium', 'High', 'Xhigh', 'Max', 'Auto',
    ]);
  });
});
