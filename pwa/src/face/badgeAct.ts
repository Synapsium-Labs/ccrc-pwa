// badgeAct — what the installed icon's count does for a frame (the Overlord face plan, Task 10; L1: pure, no navigator).
//
// `count` is the Waiting on you door's count (`useNavBadges().waitingItems`); `last` is the count last WRITTEN to the badge,
// `null` before any write. "Not heard yet" (count null) and "heard that nothing waits" (0) are two different answers:
// the first leaves the badge as it was, the second clears it.
export type BadgeAct = { readonly kind: 'set'; readonly n: number } | { readonly kind: 'clear' } | { readonly kind: 'leave' };

/** null (not heard yet) leaves the badge as it was; 0 clears it; more sets it. A count equal to the last one written leaves it. */
export function badgeAct(count: number | null, last: number | null): BadgeAct {
  if (count === null) return { kind: 'leave' };
  if (count === last) return { kind: 'leave' };
  if (count === 0) return { kind: 'clear' };
  return { kind: 'set', n: count };
}
