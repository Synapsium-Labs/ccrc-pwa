// What a session's ROUTING RECORD says, read once, for the four consumers that
// used to each read a piece of it inline in `SessionScreen`: the two picker
// rows (intended value, inert lane, unreadable field) and the queued badge.
//
// PURE, and a function rather than a hook, because every answer here is a
// derivation of one `FleetSession` plus the wrapper's own option lists — there
// is no state, no effect and nothing to subscribe to. It came out of
// `SessionScreen` whole: ~95 lines of dense branch-by-branch reasoning sitting
// between that screen's store reads and its JSX, where it was the single
// largest thing in the file that had nothing to do with rendering.
//
// The local-write lane is NOT here. `useQueuedRoute` owns it, it is a hook with
// its own timers, and the two are mutually exclusive by design — see
// `queuedField` below.
import type { FleetSession, RouteField } from '../../../shared/api';
import { effortIsKnown, modelReadbackFor } from '../lib/models';

export interface RouteView {
  /** The value the registry says was ASKED FOR, or `null` for a field that was
   *  never routed — and also for one whose read failed this pass, which is why
   *  `classUnreadable`/`effortUnreadable` exist beside these. */
  readonly classIntended: string | null;
  readonly effortIntended: string | null;
  /** ccd will not apply this field on this lane. Never "queued": there is
   *  nothing for a badge to wait on (`PickSheet` marks the row instead). */
  readonly classInert: boolean;
  readonly effortInert: boolean;
  readonly classUnreadable: boolean;
  readonly effortUnreadable: boolean;
  /** The field whose intended value the pane has not read back yet, measured
   *  from the WIRE. `null` when `route` itself is absent — the caller then owns
   *  the answer from its local-write lane. */
  readonly wireQueuedField: RouteField | null;
}

/**
 * @param live     the fleet row, or `null` before the first frame.
 * @param wrapper  whose option lists decide what a value can read back as.
 */
export function routeView(live: FleetSession | null, wrapper: string): RouteView {
  const routeInfo = live?.route ?? null;
  const classIntended = routeInfo?.fields.class ?? null;
  const effortIntended = routeInfo?.fields.effort ?? null;
  const classInert = routeInfo?.inert.includes('class') ?? false;
  const effortInert = routeInfo?.inert.includes('effort') ?? false;
  // Fix round 2, finding 1 (ruling S6-R5): a field named in `route.unreadable`
  // is UNKNOWN, not "never routed" — its own read failed this pass, so it is
  // ALSO absent from `route.fields` (never both). `classIntended`/
  // `effortIntended` above are already `null` for it, same as a genuinely
  // never-routed field, but that would otherwise fall back to the loose
  // live-pane match (`modelOptions`/`effortOptions`'s own `intended === null`
  // branch) and light a row anyway — a claim this read never established.
  // `RoutingOverride.unreadable` forces no active row for exactly this field,
  // on top of the queued badge already skipping it for having no `intended` to
  // compare.
  //
  // Whole-branch review, fix wave #5: `routeInfo.unreadable` is REQUIRED on
  // a freshly-assembled `FleetSession.route` and on anything that has been
  // through `reviveRoute` (the persisted-snapshot path), but the live
  // `fleet` WS frame is never revived — `stores/fleet.ts`'s `asFleetMsg`
  // casts the raw frame straight to `FleetMsg` — so a frame from an older
  // server that predates this key arrives with `route` non-null and
  // `route.unreadable` genuinely `undefined`. `routeInfo?.unreadable`
  // alone still throws on `.includes` in that case; read it tolerantly
  // ONCE here, the one place either field below is derived from it.
  const routeUnreadable = routeInfo?.unreadable ?? [];
  const classUnreadable = routeUnreadable.includes('class');
  const effortUnreadable = routeUnreadable.includes('effort');
  // The intended value's readback vs. the live read-back: `live.effort`
  // directly for effort (`ultracode` is its own boolean, not an effort
  // string — the same split `pick`'s own read-back effect already makes),
  // the model display name for class, reusing `modelOptions`' own loose
  // comparison through `modelReadbackFor`. An INERT field is never
  // "queued" — ccd will not apply it on this lane, so there is nothing for a
  // badge to wait on (`PickSheet` marks its row `inertOnThisLane` instead).
  //
  // Fix round 1, finding 1: two more conditions never light this badge,
  // mirroring the pre-existing LOCAL-write carve-out (`pick`'s own "neither
  // value leaves a mark the pane can read back" comment) instead of leaving
  // the wire path with none of it:
  //   - `effort: 'auto'` / `class: 'default'` are ccd's absent-equivalents
  //     (`ccd/ccd:16189-16192`'s `_route_apply_now` types NOTHING for
  //     `auto` — "the live level stands" — so `live.effort` can never read
  //     back `auto`, and a wrapper's own default has no distinguishing
  //     model string `default` could ever match). Both AGREE unconditionally.
  //   - an intended value that names no row on THIS wrapper's own option
  //     list (`effortIsKnown` false, or `modelReadbackFor` null) is a word
  //     ccd itself will never confirm here — a rejected/stale/foreign-build
  //     registry value (the registry read behind `route` is deliberately
  //     unvalidated). Nothing on this pane can ever read it back, so it is
  //     UNMEASURABLE, not queued forever: no picker row highlights it either
  //     (`activeFor`/`modelOptions`'s exact-match `active` finds no row),
  //     so a permanent badge next to no active row is doubly wrong.
  const wireQueuedField: RouteField | null = routeInfo === null ? null : (() => {
    if (effortIntended !== null && !effortInert && effortIntended !== 'auto' && effortIsKnown(wrapper, effortIntended)) {
      // Fix wave #2: `xhigh` and `ultracode` share the SAME wire value —
      // `live.effort: 'xhigh'` — with `ultracode` distinguished only by the
      // separate `live.ultracode` boolean (`effortOptions`'s own
      // `activeFor`, models.ts:151-153, already carries this guard for the
      // picker rows). Without it, an intended `xhigh` reads a live
      // ultracode pane's `effort: 'xhigh'` as agreement and never queues —
      // an unapplied `xhigh` write silently reporting itself confirmed.
      const agrees = effortIntended === 'ultracode'
        ? live?.ultracode === true
        : effortIntended === 'xhigh'
          ? live?.effort === 'xhigh' && live?.ultracode !== true
          : live?.effort === effortIntended;
      if (!agrees) return 'effort';
    }
    if (classIntended !== null && !classInert && classIntended !== 'default') {
      const readback = modelReadbackFor(wrapper, classIntended);
      const liveModel = (live?.model ?? '').toLowerCase();
      // Fix wave #3: a degraded session (`routeInfo.degraded` names the
      // class ccd is actually SERVING because no candidate lane could
      // serve the intended one, spec §5.4) can never read the intended
      // class back on `live.model` while the degrade stands — ccd's own
      // `_route_wanted` types the SERVED class, not the intended one, into
      // the pane. Without also agreeing on the served class, the badge
      // never clears for as long as the degrade lasts, even though ccd is
      // doing exactly what it can and the intended row already carries its
      // own `degradedTo` note (`PickSheet`, whole-branch review M1).
      const degradedClass = routeInfo?.degraded ?? null;
      const degradedReadback = degradedClass !== null ? modelReadbackFor(wrapper, degradedClass) : null;
      const agrees = readback !== null && (
        liveModel.includes(readback)
        || (degradedReadback !== null && liveModel.includes(degradedReadback))
      );
      if (readback !== null && !agrees) return 'class';
    }
    return null;
  })();

  return {
    classIntended, effortIntended, classInert, effortInert,
    classUnreadable, effortUnreadable, wireQueuedField,
  };
}
