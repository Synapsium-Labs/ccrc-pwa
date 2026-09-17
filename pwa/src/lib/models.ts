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

/**
 * Routing slice 6, Task 4: the intended-value override an option list is
 * built with once a session carries `FleetSession.route`. `intended`, when
 * non-null, replaces the loose live-pane comparison for `active` with an
 * EXACT match against the row's own routing value — the recorded intent,
 * not what the pane happens to display yet. `inert`, true only when ccd's
 * own `.inert` names this field on the CURRENT lane, marks whichever row
 * `active` lands on as `inertOnThisLane` — a row can be active-and-inert
 * (ccd wrote the field, but this lane will never apply it) as easily as
 * active-and-pending. Omitted entirely (not just `{intended: null}`), a
 * caller gets EXACTLY today's live-comparison behaviour — the
 * "route: null, nothing changes" contract (S6-R4). */
export interface RoutingOverride {
  intended: string | null;
  inert: boolean;
}

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
  active: boolean; // matches the session's current model/effort, or (S6 Task 4) the intended record when one rides the wire
  /** S6 Task 4: set on the ACTIVE row only, and only when the caller passed
   *  `inert: true` — this field is on ccd's `.inert` list for the session's
   *  current lane. The sheet renders a marker instead of a queued badge;
   *  `SessionScreen` never treats an inert field as queued (there is nothing
   *  to wait for a confirmation that will never come). */
  inertOnThisLane?: boolean;
}

/** Model chooser rows. `current` is the pane statusline display name
 *  ("Opus 5 (1M context)", "GPT-5.6 Sol") — matched loosely so the 1M suffix
 *  doesn't defeat the highlight. `routing` (S6 Task 4) overrides `active` with
 *  the recorded intent when the session's `route` rides the wire — see
 *  `RoutingOverride`'s own docstring.
 *
 *  Labels are the family's CURRENT latest (the routing record's `class` value
 *  is the bare family alias, which the harness auto-resolves to the newest in
 *  that family — `opus` → Opus 5 on Anthropic API as of CC v2.1.219+). Bump a
 *  label when a family's newest name changes; the alias itself never needs
 *  touching. */
export function modelOptions(wrapper: string, current: string | null, routing?: RoutingOverride): PickOption[] {
  const c = (current ?? '').toLowerCase();
  const intended = routing?.intended ?? null;
  const inert = routing?.inert ?? false;
  const row = (label: string, alias: string, key: string, sublabel?: string): PickOption => {
    const active = intended !== null ? alias === intended : (key !== '' && c.includes(key));
    return {
      label, sublabel, route: { field: 'class', value: alias }, readback: key, active,
      ...(active && inert ? { inertOnThisLane: true } : {}),
    };
  };
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

/** The model row's own `readback` for a routing `class` alias, on the given
 *  wrapper's option list — `null` for an alias no row on this wrapper's list
 *  carries (an out-of-vocabulary value ccd wrote from a build ahead of this
 *  one). `SessionScreen`'s wire-derived queued check reuses this rather than
 *  re-deriving the alias→key table a second time. */
export function modelReadbackFor(wrapper: string, alias: string): string | null {
  return modelOptions(wrapper, null).find((o) => o.route.value === alias)?.readback ?? null;
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
 *  (`{effort: 'ultracode'}`) — there is no separate routing field for it.
 *  `routing` (S6 Task 4) overrides every row's `active` with an exact match
 *  against the recorded intent — see `RoutingOverride`'s own docstring. */
export function effortOptions(
  wrapper: string,
  effort: string | null,
  ultracode: boolean,
  routing?: RoutingOverride,
): PickOption[] {
  const e = (effort ?? '').toLowerCase();
  const intended = routing?.intended ?? null;
  const inert = routing?.inert ?? false;
  const level = (label: string, value: string, active: boolean, sublabel?: string): PickOption => ({
    label, sublabel, route: { field: 'effort', value }, readback: value, active,
    ...(active && inert ? { inertOnThisLane: true } : {}),
  });
  const activeFor = (rung: EffortRung): boolean =>
    intended !== null ? rung === intended : (rung === 'xhigh' ? e === 'xhigh' && !ultracode : e === rung);
  const opts: PickOption[] = [
    ...EFFORT_LADDER.map((rung) => level(capitalise(rung), rung, activeFor(rung))),
    level('Auto', 'auto', intended !== null ? intended === 'auto' : e === 'auto'),
  ];
  if (wrapper !== 'gpt') {
    opts.splice(4, 0, level(
      'Ultracode', 'ultracode', intended !== null ? intended === 'ultracode' : ultracode,
      'xhigh + workflow orchestration',
    ));
  }
  return opts;
}

/** Whether an `effort` routing value names a row on this wrapper's own
 *  option list (fix round 1, finding 1) — `false` for a word ccd itself
 *  would never write for this lane (a rejected or stale registry value; the
 *  registry read behind `FleetSession.route` is deliberately unvalidated,
 *  `registry.ts`'s field reads, so an out-of-vocabulary word can ride the
 *  wire) and for `ultracode` on the `gpt` lane, which `effortOptions` never
 *  lists there. `SessionScreen`'s wire-derived queued check uses this to
 *  tell "ccd will never confirm this — treat it as unmeasurable, not
 *  perpetually queued" apart from "confirmed and just disagrees right now",
 *  the same split `modelReadbackFor` makes for `class`. */
export function effortIsKnown(wrapper: string, value: string): boolean {
  return effortOptions(wrapper, null, false).some((o) => o.route.value === value);
}
