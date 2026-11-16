// Model + effort option lists for the session pickers.
//
// D-8406: A MODEL'S NAME COMES FROM THE LANE, NEVER FROM THIS FILE. Each model row names the model its class maps to on
// the session's lane, as that lane's own files say it: the class registry (`registryFileName`, `shared/models.mjs`) says
// which model a class maps to, and the catalogue says what that model is called. `GET /api/models/:lane` reads both
// (`LaneModelsRead`, `shared/models.ts`), the same facts `ccrc models <lane> show` prints. A model advance moves the
// registry, and the row's label follows it with no code change. When the lane has no registry, or it or its catalogue
// cannot be read, a row reads its class name alone ("Opus class"), never a model name this file remembers: the
// labels it used to hard-code went stale on the gpt lane once that lane's registry moved on. `model-name-census.test.ts`
// keeps a model display name out of `pwa/src` for good. WHICH LIST a lane gets is the roster's lane kind's to decide
// (D-8686, re-plan R1), with the temporary wrapper fallback named once, in `modelListProvider`.
//
// Routing spec 2026-09-14 §5.3, slice 4, Task 5: a tap no longer sends
// `/model <alias>` or `/effort <level>` — it writes the routing record
// through `POST /api/sessions/:id/route` (`SessionScreen.tsx`'s `pick`) and
// ccd types it, session-only keystrokes. `no-routing-keystroke-from-server
// .test.ts` is the census that keeps a slash-command literal out of this
// file (and every other one under `pwa/src`/`server/src`) for good. A row's
// route value is the CLASS alias, whatever label the row shows.
//
// D-2015: the fable alias on the gpt lane used to name a deliberate sentinel
// (`ccrc-unavailable-fable`) so `/model fable` failed loudly rather than
// silently landing somewhere — the lane had only three tiers. It has four now.
// The alias is set in ONE place, the lane's `settings.json` `env` block
// (`deploy/models-op.mjs`'s materialiser writes it from the registry, `shared/modelenv.mjs` names its keys).
import type { RosterWire, RouteField } from '../../../shared/api';
import { CLASSES, type LaneClassModel, type LaneModelsRead, type ModelClass } from '../../../shared/models';
import type { ProviderId } from '../../../shared/providers';
import { EFFORT_LADDER, type EffortRung } from '../../../shared/routing-ladder';
import { managedCodex } from '../accounts/connectFlow';

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
  /** Routing slice 6, Task 4, ruling S6-R5 (fix round 2): true when THIS
   *  field's own read measured UNREADABLE this pass (`route.unreadable`
   *  names it) rather than genuinely never having been written. Forces
   *  `active` to false on every row, overriding even the loose live-pane
   *  fallback `intended === null` would otherwise take (that fallback
   *  asserts "this field currently reads as row X", a claim an unreadable
   *  read never established). No separate badge carve-out is needed: an
   *  unreadable field is also absent from `route.fields`, so `intended` is
   *  already null and the wire-derived queued check already requires a
   *  non-null `intended` to fire. */
  unreadable?: boolean;
  /** Routing slice 6, Task 4, whole-branch review M1: ccd's own `.degraded`
   *  stamp for this session (`FleetSession.route.degraded`) — the class it
   *  IS serving because no candidate lane could serve the intended one
   *  (spec §5.4's `measured-unservable` arm: ccd degrades one class rung for
   *  the relaunch and stamps the class it served). It is a CLASS, so only
   *  `modelOptions` consults it; the effort picker passes nothing. The
   *  intended class stays in `fields` and is restored at the next settle on
   *  a lane that can serve it, which is exactly why this is rendered BESIDE
   *  the intended row rather than by moving the active row onto the served
   *  class — the record still says what was asked for. */
  degraded?: string | null;
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
  /** Whole-branch review M1: the DISPLAY LABEL of the class ccd is serving
   *  instead of this row's own — set on the ACTIVE row only, and only when
   *  `RoutingOverride.degraded` names a class DIFFERENT from that row's
   *  alias. Same-class is not rendered: "serving" a row's own model beside
   *  that active row states nothing, and a stale stamp ccd has already restored
   *  from would otherwise read as a live ceiling. The label comes from THIS
   *  lane's own option list (the served class's model label, not `haiku`,
   *  where the lane names it); a class no row here carries falls back to the raw stamped word
   *  rather than being dropped — a degradation the reader cannot name is
   *  still a degradation. */
  degradedTo?: string;
}

/** D-8686 (re-plan R1; spec §2.6, D17): the roster facts a lane's model list is chosen by — `RosterWire`'s lane-kind
 *  half as the server derives it once (`rosterKindOf`, `shared/roster.ts`), never a field of its own. `undefined` is a
 *  wrapper the roster has no row for (not arrived yet, or unrostered), as `entryFor` (`lib/accounts.ts`) answers. */
export type LaneKindFacts = Pick<RosterWire, 'kind' | 'managed' | 'telemetry'>;
/** The two option lists a picker shows. */
export type ModelList = 'anthropic' | 'openai';

/** Whose model list `modelOptions` picks for a lane (D-8686). THE ROSTER DECIDES: a lane whose row reads `kind: 'codex'`
 *  with `managed: true` gets the dedicated list, and one whose row reads `telemetry: 'anthropic'` gets the Anthropic
 *  list. `managed: true` is part of the test because `kind: 'codex'` alone means only an `openai` provider, including a
 *  launcher ccrc merely records (runbook step 7; `managedCodex`, `accounts/connectFlow.ts`, is its one definition).
 *  Only a row that says neither, or no row, leaves the wrapper to decide. The dedicated list has its own row order, no
 *  `Default` row and no Ultracode; every row's label comes from the lane's own files on both lists (D-8406). */
export function modelListProvider(wrapper: string, entry: LaneKindFacts | undefined): ModelList {
  if (managedCodex(entry)) return 'openai';
  if (entry?.telemetry === 'anthropic') return 'anthropic';
  // TEMPORARY, the 2026-11-16 route's exception to D17 (the plan's "Re-plan of 2026-11-16", Task 21; spec §2.6's
  // note): until the owner has measured the server box's roster, a row that says neither keeps the wrapper check.
  // It goes with the definition of done's item 4, and `models-lane-kind.test.ts`'s census flips to none then.
  return wrapper === 'gpt' ? 'openai' : 'anthropic';
}

/** The class rows' order on each list, as the picker has always shown them: the dedicated lane leads with its most
 *  capable class, the Anthropic list with the everyday one. Classes only, so a class this build adds is a row here. */
const CLASS_ORDER: Readonly<Record<ModelList, readonly ModelClass[]>> = {
  openai: ['fable', 'opus', 'sonnet', 'haiku'],
  anthropic: ['opus', 'sonnet', 'fable', 'haiku'],
};

/** A class's own name, the row label when the lane cannot name its model ("Opus class"), and the sublabel when it
 *  can. Derived from the class word, never spelled per class. */
export function classWord(cls: ModelClass): string {
  return `${cls.charAt(0).toUpperCase()}${cls.slice(1)} class`;
}

/** D-8406: the label the lane's own files give a class's model — the catalogue's label for the model the registry maps
 *  the class to — or `null` when they give none (no read yet, no registry, an unreadable one, no catalogue row, or a
 *  class unavailable on this lane). The one place a model's display name enters this app. */
export function laneClassLabel(lane: LaneModelsRead | null, cls: ModelClass): string | null {
  return lane?.kind === 'read' ? lane.classes[cls].label : null;
}

/** D-8686 (re-plan R1): the effort levels the catalogue lists for the model `cls` maps to on this lane, as
 *  `GET /api/models/:lane` carries them (`LaneClassModel.efforts`), or `null` when the lane does not say: no read
 *  yet, an absent or unreadable registry, a value that is not a class (`''`, `default`, a word from a newer build),
 *  an empty class, no catalogue row for its model, or an older server. `[]` (the row lists none) is passed on as
 *  it is: `effortOptions` decides what it means. Pure. */
export function laneClassEfforts(lane: LaneModelsRead | null, cls: string | null): readonly string[] | null {
  if (lane?.kind !== 'read' || cls === null || !(CLASSES as readonly string[]).includes(cls)) return null;
  return lane.classes[cls as ModelClass].efforts;
}

/** A model string folded for a loose comparison: lowercase, and every run of anything but a letter or a digit one
 *  `-`. The pane may print a model id (`gpt-6.1-sol[1m]`), a title-cased label, or a family name with a context
 *  suffix ("… (1M context)"); folding both sides lets a row's key match each of them. */
const fold = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

/** Whether the live model string `live` names the row key `key` (a model id, or an Anthropic family word): the folded
 *  key inside the folded string, so a context suffix or a case change does not defeat it. An empty key names nothing:
 *  a row whose model this lane cannot name never matches the pane by accident. Pure. */
export function liveModelNames(live: string | null, key: string): boolean {
  const k = fold(key);
  return k !== '' && fold(live ?? '').includes(k);
}

/** Model chooser rows for the session on `wrapper`, named from that lane's own model files (`lane`, D-8406; `null`
 *  before the first read). `current` is the pane statusline's model string — a model id on a lane with a registry, a
 *  family name such as "<Family> <version> (1M context)" on an Anthropic one — matched loosely (`liveModelNames`), so
 *  a context suffix does not defeat the highlight. `routing` (S6 Task 4) overrides `active` with the recorded intent
 *  when the session's `route` rides the wire — see `RoutingOverride`'s own docstring.
 *
 *  EACH ROW: its route is `{class: <alias>}`, the bare class alias the lane resolves (a tap sends nothing else); its
 *  label is the catalogue's label for the model the registry maps the class to, with the class name as the sublabel,
 *  or the class name alone when the lane cannot name that model; its readback key is the registry's model id. A class
 *  the registry says is unavailable on this lane (a `null` slot) has no row.
 *
 *  WITH NO REGISTRY, the readback stays what it was: on the Anthropic list the bare FAMILY word (the class alias
 *  itself), which the statusline's family name carries whatever its version, so the row stays lit across a release;
 *  on the dedicated list nothing, since there the pane prints a model id no class word is part of. When two rows'
 *  keys both appear in the live string, the longer key alone is lit (an id that extends another names its own row). */
export function modelOptions(
  wrapper: string, entry: LaneKindFacts | undefined, lane: LaneModelsRead | null, current: string | null,
  routing?: RoutingOverride,
): PickOption[] {
  const intended = routing?.intended ?? null;
  const inert = routing?.inert ?? false;
  const unreadable = routing?.unreadable ?? false;
  const degraded = routing?.degraded ?? null;
  const list = modelListProvider(wrapper, entry);
  const classes = lane?.kind === 'read' ? lane.classes : null;
  const keyOf = (cls: ModelClass): string => (classes !== null ? classes[cls].model ?? '' : list === 'anthropic' ? cls : '');
  const shown = CLASS_ORDER[list].filter((cls) => classes === null || classes[cls].model !== null);
  // The longest key the live string names, so an id that is a prefix of another lights only its own row.
  const best = Math.max(0, ...shown.map(keyOf).filter((k) => liveModelNames(current, k)).map((k) => fold(k).length));
  const row = (label: string, alias: string, key: string, sublabel?: string): PickOption => {
    const live = key !== '' && liveModelNames(current, key) && fold(key).length === best;
    const active = unreadable ? false : intended !== null ? alias === intended : live;
    return {
      label, ...(sublabel !== undefined ? { sublabel } : {}), route: { field: 'class', value: alias }, readback: key, active,
      ...(active && inert ? { inertOnThisLane: true } : {}),
    };
  };
  /** Whole-branch review M1: the `.degraded` stamp, attached to the ACTIVE
   *  row as a LABEL. Resolved over the finished list (a row cannot name
   *  another row's label while it is being built) and only where the served
   *  class differs from the row's own — see `PickOption.degradedTo`. */
  const withDegraded = (opts: PickOption[]): PickOption[] => {
    if (degraded === null) return opts;
    const label = opts.find((o) => o.route.value === degraded)?.label ?? degraded;
    return opts.map((o) => (o.active && o.route.value !== degraded ? { ...o, degradedTo: label } : o));
  };
  const rows = shown.map((cls) => {
    const label = laneClassLabel(lane, cls);
    return label === null ? row(classWord(cls), cls, keyOf(cls)) : row(label, cls, keyOf(cls), classWord(cls));
  });
  // `Default` is the Anthropic list's alone: on the dedicated lane it resolves through `ANTHROPIC_MODEL`, which the
  // lane's env owns, and a row whose meaning the console cannot state is not offered.
  return withDegraded(list === 'openai' ? rows : [...rows, row('Default', 'default', '')]);
}

/** The model row's own `readback` for a routing `class` alias, on this
 *  lane's option list — `null` for an alias no row carries (an
 *  out-of-vocabulary value ccd wrote from a build ahead of this one, or a class unavailable on this lane) and for a
 *  row whose model this lane cannot name yet (an empty key: nothing the pane prints could confirm it, D-8406).
 *  `SessionScreen`'s wire-derived queued check reuses this rather than
 *  re-deriving the alias→key table a second time. */
export function modelReadbackFor(
  wrapper: string, entry: LaneKindFacts | undefined, lane: LaneModelsRead | null, alias: string,
): string | null {
  const key = modelOptions(wrapper, entry, lane, null).find((o) => o.route.value === alias)?.readback;
  return key === undefined || key === '' ? null : key;
}

/** D-8406: `GET /api/models/:lane`'s answer, held to its shape: the lane's `LaneModelsRead`, or `null` for anything
 *  else (an older server's 404 body, a malformed answer). A `read` must carry every class with a model and a label that
 *  are each a string or null, and (D-8686) an `efforts` that is an array of strings, or null; one that does not is not
 *  trusted for any class. An `efforts` that is absent (an older server) or null reads as `null`, "not known": absence
 *  permits. The ONE reader of that wire. Pure. */
export function asLaneModelsRead(raw: unknown): LaneModelsRead | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const models = (raw as { models?: unknown }).models;
  if (typeof models !== 'object' || models === null) return null;
  const kind = (models as { kind?: unknown }).kind;
  if (kind === 'absent' || kind === 'unreadable') return { kind };
  if (kind !== 'read') return null;
  const classes = (models as { classes?: unknown }).classes;
  if (typeof classes !== 'object' || classes === null) return null;
  const strOrNull = (v: unknown): v is string | null => v === null || typeof v === 'string';
  const out = {} as Record<ModelClass, LaneClassModel>;
  for (const cls of CLASSES) {
    const c = (classes as Record<string, unknown>)[cls];
    if (typeof c !== 'object' || c === null) return null;
    const { model, label, efforts } = c as { model?: unknown; label?: unknown; efforts?: unknown };
    if (!strOrNull(model) || !strOrNull(label)) return null;
    if (efforts !== undefined && efforts !== null && !(Array.isArray(efforts) && efforts.every((e) => typeof e === 'string'))) {
      return null;
    }
    out[cls] = { model, label, efforts: efforts === undefined || efforts === null ? null : [...(efforts as string[])] };
  }
  return { kind: 'read', classes: out };
}

/** Whether a class's readback can be measured on this lane (D-6334): the lane's provider is known and the list
 *  `modelOptions` picks for it is that provider's own. Anywhere else the readback words are not the lane's model
 *  ids, so "asked" or "queued" would be a claim nothing here can check. `null` (not measurable) is never true. */
export function classReadbackMeasurable(
  wrapper: string, entry: LaneKindFacts | undefined, provider: ProviderId | null,
): boolean {
  return provider !== null && provider === modelListProvider(wrapper, entry);
}

/** The sublabel of a level row the lane's catalogue does not list for the model the session runs (D-8686). */
const NOT_LISTED = 'not listed for this model';

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
 *  against the recorded intent — see `RoutingOverride`'s own docstring.
 *
 *  D-8686 (re-plan R1): on the dedicated list, `efforts` (the levels the catalogue lists for the model of the class
 *  the session runs, `laneClassEfforts`) narrows the five level rows to the ladder rungs it names, in ladder order; a
 *  word off the ladder is never a row, and a list with no ladder rung leaves `Auto` alone. The one exception is the
 *  rung the recorded intent (or, with none, the pane's live level) names: it stays a lit row, sublabelled as not
 *  listed, so a recorded level never goes invisible. `null` (the lane does not say) and `[]` (the row lists none,
 *  which `parseRegistry`'s own effort check reads as no constraint) leave all five rungs. On the Anthropic list `efforts` is ignored. `Auto` is last on every list, and Ultracode is spliced at index
 *  4 only off the dedicated list, which always has all five rungs there, so index 4 is still "before Max". */
export function effortOptions(
  wrapper: string,
  entry: LaneKindFacts | undefined,
  efforts: readonly string[] | null,
  effort: string | null,
  ultracode: boolean,
  routing?: RoutingOverride,
): PickOption[] {
  const e = (effort ?? '').toLowerCase();
  const intended = routing?.intended ?? null;
  const inert = routing?.inert ?? false;
  const unreadable = routing?.unreadable ?? false;
  const level = (label: string, value: string, active: boolean, sublabel?: string): PickOption => ({
    label, sublabel, route: { field: 'effort', value }, readback: value, active,
    ...(active && inert ? { inertOnThisLane: true } : {}),
  });
  const activeFor = (rung: EffortRung): boolean => unreadable
    ? false
    : intended !== null ? rung === intended : (rung === 'xhigh' ? e === 'xhigh' && !ultracode : e === rung);
  const list = modelListProvider(wrapper, entry);
  const narrowed = list === 'openai' && efforts !== null && efforts.length > 0 ? efforts : null;
  // The rung the intent or the pane names stays a row even when the catalogue omits it, so a recorded level never goes
  // invisible; it is named as not listed. `effortIsKnown` reads the catalogue alone, so it stays unmeasurable.
  const rungs = narrowed === null ? EFFORT_LADDER : EFFORT_LADDER.filter((rung) => narrowed.includes(rung) || activeFor(rung));
  const opts: PickOption[] = [
    ...rungs.map((rung) => level(
      capitalise(rung), rung, activeFor(rung), narrowed !== null && !narrowed.includes(rung) ? NOT_LISTED : undefined,
    )),
    level('Auto', 'auto', unreadable ? false : intended !== null ? intended === 'auto' : e === 'auto'),
  ];
  if (list !== 'openai') {
    opts.splice(4, 0, level(
      'Ultracode', 'ultracode', unreadable ? false : intended !== null ? intended === 'ultracode' : ultracode,
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
export function effortIsKnown(
  wrapper: string, entry: LaneKindFacts | undefined, efforts: readonly string[] | null, value: string,
): boolean {
  return effortOptions(wrapper, entry, efforts, null, false).some((o) => o.route.value === value);
}
