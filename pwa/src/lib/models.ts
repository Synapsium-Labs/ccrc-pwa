// Model + effort option lists for the session pickers. Wrapper-aware: the gpt
// overflow lane maps the Anthropic aliases onto Codex tiers via the ccgpt env —
// opus/sonnet/haiku onto GPT-5.6 Sol/Terra/Luna, and fable onto GPT-6 Astra.
//
// Routing spec 2026-09-14 §5.3, slice 4, Task 5: a tap no longer sends
// `/model <alias>` or `/effort <level>` — it writes the routing record
// through `POST /api/sessions/:id/route` (`SessionScreen.tsx`'s `pick`) and
// ccd types it, session-only keystrokes. `no-routing-keystroke-from-server
// .test.ts` is the census that keeps a slash-command literal out of this
// file (and every other one under `pwa/src`/`server/src`) for good.
//
// D-2015: the fable alias on that lane used to name a deliberate sentinel
// (`ccrc-unavailable-fable`) so `/model fable` failed loudly rather than
// silently landing somewhere — the lane had only three tiers. It has four now.
// The alias is set in TWO places, `~/.local/bin/ccgpt`'s exports and
// `~/.claude-gpt/settings.json`'s `env` block, and SETTINGS WINS: Claude Code
// Object.assigns settings env over the process environment at runtime. Both are
// box tooling outside this repo; this list only has to agree with them.
import type { RouteField } from '../../../shared/api';
import { EFFORT_LADDER, type EffortRung } from '../../../shared/routing-ladder';

export interface PickOption {
  label: string;
  sublabel?: string;
  /** The routing record write a tap on this row performs — ONE field, ONE
   *  value, `api.route(id, field, value)`'s own argument pair. */
  route: { field: RouteField; value: string };
  /** The lowercase key `active` already matches the live pane string on
   *  (`row`'s own `key` argument below) — reused so `SessionScreen`'s
   *  read-back check can tell when the fleet frame agrees with a QUEUED
   *  `class` write without re-deriving the option list. Unconsulted for an
   *  `effort` row (that read-back compares `live.effort`/`live.ultracode`
   *  directly), but always populated so no caller has to special-case an
   *  absent field on a type that promises one. */
  readback: string;
  active: boolean; // matches the session's current model/effort
}

/** Model chooser rows. `current` is the pane statusline display name
 *  ("Opus 5 (1M context)", "GPT-5.6 Sol") — matched loosely so the 1M suffix
 *  doesn't defeat the highlight.
 *
 *  Labels are the family's CURRENT latest (the routing record's `class` value
 *  is the bare family alias, which the harness auto-resolves to the newest in
 *  that family — `opus` → Opus 5 on Anthropic API as of CC v2.1.219+). Bump a
 *  label when a family's newest name changes; the alias itself never needs
 *  touching. */
export function modelOptions(wrapper: string, current: string | null): PickOption[] {
  const c = (current ?? '').toLowerCase();
  const row = (label: string, alias: string, key: string, sublabel?: string): PickOption => ({
    label, sublabel, route: { field: 'class', value: alias }, readback: key,
    active: key !== '' && c.includes(key),
  });
  if (wrapper === 'gpt') {
    return [
      row('GPT-6 Astra', 'fable', 'astra', 'Fable class'),
      row('GPT-5.6 Sol', 'opus', 'sol', 'Opus class'),
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

/** The five level rows' labels are the ladder rung capitalised, nothing more
 *  (`xhigh` -> `Xhigh`) — exactly today's hand-typed labels, so no rendered
 *  text changes. */
const capitalise = (rung: EffortRung): string => rung[0]!.toUpperCase() + rung.slice(1);

/** Effort chooser rows. The five level rows are `EFFORT_LADDER`'s own five
 *  stops, in ladder order — the ladder is the single source for what a
 *  routing decision walks (`shared/routing-ladder.ts`), and this picker adds
 *  its own LABELLED SUPERSET on top: `Auto` (the absence of a typed value,
 *  never a ladder rung) and, for Anthropic wrappers, `Ultracode` (xhigh +
 *  workflow orchestration — a super-mode, not a level, and invalid on the
 *  gpt lane). Ultracode is still the `effort` field's own value
 *  (`{effort: 'ultracode'}`) — there is no separate routing field for it. */
export function effortOptions(
  wrapper: string,
  effort: string | null,
  ultracode: boolean,
): PickOption[] {
  const e = (effort ?? '').toLowerCase();
  const level = (label: string, value: string, active: boolean): PickOption =>
    ({ label, route: { field: 'effort', value }, readback: value, active });
  const activeFor = (rung: EffortRung): boolean =>
    rung === 'xhigh' ? e === 'xhigh' && !ultracode : e === rung;
  const opts: PickOption[] = [
    ...EFFORT_LADDER.map((rung) => level(capitalise(rung), rung, activeFor(rung))),
    level('Auto', 'auto', e === 'auto'),
  ];
  if (wrapper !== 'gpt') {
    opts.splice(4, 0, {
      label: 'Ultracode',
      sublabel: 'xhigh + workflow orchestration',
      route: { field: 'effort', value: 'ultracode' },
      readback: 'ultracode',
      active: ultracode,
    });
  }
  return opts;
}
