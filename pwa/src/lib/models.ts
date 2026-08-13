// Model + effort option lists for the session pickers. Wrapper-aware: the gpt
// overflow lane maps the Anthropic aliases (opus/sonnet/haiku) onto GPT-5.6
// Sol/Terra/Luna via the ccgpt env, and has NO Fable — so its list differs.
// `/model <alias>` and `/effort <level>` set directly (no picker needed).

export interface PickOption {
  label: string;
  sublabel?: string;
  command: string; // slash command sent to the session, e.g. "/model opus"
  active: boolean; // matches the session's current model/effort
}

/** Model chooser rows. `current` is the pane statusline display name
 *  ("Opus 5 (1M context)", "GPT-5.6 Sol") — matched loosely so the 1M suffix
 *  doesn't defeat the highlight.
 *
 *  Labels are the family's CURRENT latest (the `/model <alias>` command sends a
 *  bare family alias, which the harness auto-resolves to the newest in that
 *  family — `opus` → Opus 5 on Anthropic API as of CC v2.1.219+). Bump a label
 *  when a family's newest name changes; the alias itself never needs touching. */
export function modelOptions(wrapper: string, current: string | null): PickOption[] {
  const c = (current ?? '').toLowerCase();
  const row = (label: string, alias: string, key: string, sublabel?: string): PickOption => ({
    label, sublabel, command: `/model ${alias}`, active: key !== '' && c.includes(key),
  });
  if (wrapper === 'gpt') {
    return [
      row('GPT-5.6 Sol', 'opus', 'sol', 'Fable / Opus class'),
      row('GPT-5.6 Terra', 'sonnet', 'terra', 'Sonnet class'),
      row('GPT-5.6 Luna', 'haiku', 'luna', 'Haiku class'),
    ];
  }
  return [
    row('Opus 5', 'opus', 'opus'),
    row('Sonnet 5', 'sonnet', 'sonnet'),
    row('Fable 5', 'fable', 'fable'),
    row('Haiku 4.5', 'haiku', 'haiku'),
    row('Default', 'default', ''),
  ];
}

/** Effort chooser rows. Ultracode is xhigh + workflow orchestration (a super-
 *  mode, not a level) and is invalid on the gpt lane, so it's offered only for
 *  Anthropic wrappers. */
export function effortOptions(
  wrapper: string,
  effort: string | null,
  ultracode: boolean,
): PickOption[] {
  const e = (effort ?? '').toLowerCase();
  const opts: PickOption[] = [
    { label: 'Low', command: '/effort low', active: e === 'low' },
    { label: 'Medium', command: '/effort medium', active: e === 'medium' },
    { label: 'High', command: '/effort high', active: e === 'high' },
    { label: 'Xhigh', command: '/effort xhigh', active: e === 'xhigh' && !ultracode },
    { label: 'Max', command: '/effort max', active: e === 'max' },
    { label: 'Auto', command: '/effort auto', active: e === 'auto' },
  ];
  if (wrapper !== 'gpt') {
    opts.splice(4, 0, {
      label: 'Ultracode',
      sublabel: 'xhigh + workflow orchestration',
      command: '/effort ultracode',
      active: ultracode,
    });
  }
  return opts;
}
