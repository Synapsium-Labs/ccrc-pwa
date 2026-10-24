// The fleet's global banners, stacked (W2 Task S2c; D-5471, D-5472). Refined's app bar and Instrument's shell
// both place a banner stack, so it is built once here and each skin only places it.
//
// WHAT IT DOES. It renders the applicable banners in `BANNER_ORDER`'s rank order: every alert and every pinned
// line, and the first two of the rest; the others fold behind a quiet "+n more" that expands them in place. Nothing
// is dropped, and no banner's own role changes: the stack decides only which slots are hidden. A banner that is not
// folded announces as before; a folded one is out of the accessibility tree and announces once expanded.
//
// WHAT IT KEEPS. Every banner stays mounted, applicable or not, folded or not, exactly as each was before the
// stack: a banner carries state (the fleet host's Reboot confirm, the halt's Ack, the passkey
// line's posture read), so folding it must never unmount it. A folded slot is `hidden`, which takes it out of the
// page and out of the accessibility tree; a slot draws no box of its own (`.banner-slot`, fleet.css), so a sticky
// banner stays sticky against the fleet column.
//
// WHO DECIDES "APPLICABLE". Each banner module exports a `<name>Shows(…)` predicate over the same inputs its
// render reads, and the caller passes its answer as `shows`. The stack never reads a banner's DOM.
import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { Button } from '@ccrc/ui';
import './fleet.css';

/** `alert` is never folded; `status` is an ordinary banner; `door` is a line that is a control (the passkey
 *  notice is a button to /accounts, with no live region of its own). */
export type BannerRole = 'alert' | 'status' | 'door';

export interface BannerRank {
  /** Lower ranks first. */
  readonly rank: number;
  readonly role: BannerRole;
  /** The module that renders it, or null for a line `FleetScreen` writes inline. The source scan in
   *  `fleet-pieces.test.tsx` reads this. */
  readonly module: string | null;
  /** Never folded and never counted toward the two, like an alert, though its role is `status`. */
  readonly pinned?: true;
}

/** Every global banner: one per fleet, above the list. */
export type BannerId = 'fleet-host' | 'halt' | 'substrate' | 'offline' | 'connecting' | 'notice' | 'passkey';

/** A `Record` over the id union, so a new banner id without a rank is a compile error. The ranks are the order
 *  the fleet rendered its banners in before the stack, so a fleet with two or fewer looks as it did. */
export const BANNER_ORDER: Readonly<Record<BannerId, BannerRank>> = {
  'fleet-host': { rank: 1, role: 'status', module: 'FleetHostBanner' },
  halt: { rank: 2, role: 'status', module: 'HaltBanner' },
  substrate: { rank: 4, role: 'status', module: 'SubstrateBanner' },
  // The connection lines say every other line on the screen is stale, so they are pinned: whatever else applies,
  // "Reconnecting…" and "Last known state" stay in sight (and announced). Their rank keeps the order main drew.
  offline: { rank: 5, role: 'status', module: null, pinned: true },
  connecting: { rank: 6, role: 'status', module: null, pinned: true },
  notice: { rank: 7, role: 'status', module: null },
  passkey: { rank: 8, role: 'door', module: 'PasskeyNotice' },
};

/** Banner modules that are not the fleet's, each with the reason it stays where it renders. */
export const LOCAL_BANNERS: Readonly<Record<string, string>> = {
  CoordBanner: 'the Runs screen\'s coordinator line, about that screen\'s runs; it renders there, never above the fleet',
  ChildReclaimBanner: 'the Runs screen\'s reclaim line, about that screen\'s children; it renders there, never above the fleet',
  KickoffRecovery: 'inside the Start programme sheet, about that sheet\'s own kickoff',
  ExpiryAttention: 'inside ChildReclaimBanner, one list per reclaim; a part of a local banner',
  DeadCoordinatorAttention: 'inside ChildReclaimBanner, one list per reclaim; a part of a local banner',
  AttentionList: 'the list the two attention parts render; a part of a local banner, never a banner itself',
};

/** How many banners that are neither alerts nor pinned show before the fold. */
export const BANNER_FOLD_AT = 2;

export interface BannerItem<Id extends string = BannerId> {
  readonly id: Id;
  /** Distinguishes repeated ids (one notice per store notice). */
  readonly key?: string | number;
  /** The banner module's own predicate, asked by the caller. */
  readonly shows: boolean;
  readonly node: ReactNode;
}

/** Pure: each item in rank order with whether it is folded, and how many are foldable at all. */
export function foldBanners<Id extends string>(
  items: readonly BannerItem<Id>[], order: Readonly<Record<Id, BannerRank>>, expanded: boolean,
): { slots: { item: BannerItem<Id>; folded: boolean }[]; more: number } {
  // `sort` is stable, so repeated ids (the notices) keep the caller's order.
  const sorted = [...items].sort((a, b) => order[a.id].rank - order[b.id].rank);
  let open = 0;
  let more = 0;
  const slots = sorted.map((item) => {
    if (!item.shows || order[item.id].role === 'alert' || order[item.id].pinned === true) return { item, folded: false };
    open += 1;
    if (open <= BANNER_FOLD_AT) return { item, folded: false };
    more += 1;
    return { item, folded: !expanded };
  });
  return { slots, more };
}

export function BannerStack<Id extends string = BannerId>({ items, order }: {
  items: readonly BannerItem<Id>[];
  /** Defaults to {@link BANNER_ORDER}; a test passes its own. */
  order?: Readonly<Record<Id, BannerRank>>;
}): ReactNode {
  const [expanded, setExpanded] = useState(false);
  const { slots, more } = foldBanners(items, order ?? (BANNER_ORDER as unknown as Readonly<Record<Id, BannerRank>>), expanded);
  // Once nothing is foldable the control goes, and so does its expanded state: the next banner past the two folds
  // again rather than arriving already open.
  useEffect(() => { if (more === 0) setExpanded(false); }, [more]);
  return (
    <>
      {slots.map(({ item, folded }) => (
        <div key={item.key === undefined ? item.id : `${item.id}:${item.key}`} className="banner-slot" data-banner={item.id} hidden={folded}>
          {item.node}
        </div>
      ))}
      {more > 0 && (
        <div className="banner-more">
          <Button
            variant="quiet"
            size="fit"
            aria-expanded={expanded}
            aria-label={expanded ? 'Show fewer banners' : `${more} more ${more === 1 ? 'banner' : 'banners'}`}
            onClick={() => setExpanded((e) => !e)}
          >
            {expanded ? 'Show fewer' : `+${more} more`}
          </Button>
        </div>
      )}
    </>
  );
}
