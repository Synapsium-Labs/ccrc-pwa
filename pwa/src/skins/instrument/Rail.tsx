// Instrument's rail (W2 Task S9, D-5472): the 52px column of icon doors beside the list, inside the frame's
// `<nav aria-label="Primary">`, mounted at desk widths only (`ShellFrame`).
//
// ONE REGISTRY, `RAIL_ITEMS`, top to bottom. A route item's word is `ROUTES`' title for its id and its door is the
// registry's own "Go to" command (`commandDoor('go-<id>')`), so the rail, the palette and the keys run one command.
// The word is the item's accessible name and its tooltip, which shows on hover AND on `:focus-visible`
// (instrument.css), so a keyboard reader sees what a pointer reader sees. The item the page is on or under carries
// `aria-current="page"` and the accent rail (`topRouteOf`, the breadcrumb's reader too).
//
// RESERVED, NOT RENDERED: Activity is F4's (W4). Its entry is here so the activity log adds one flag, and no control
// that does nothing ships.
import type { ReactNode } from 'react';
import { Door, Icon, type IconName } from '@ccrc/ui';
import { commandDoor } from '../../command/door';
import { NotificationBell } from '../../fleet/NotificationBell';
import { useLocation } from '../../lib/router';
import { ROUTES, topRouteOf } from '../../lib/routes';

export type RailItem =
  /** A door to the top route `id`, at the rail's head or its foot. */
  | { readonly id: string; readonly icon: IconName; readonly foot?: true }
  /** The Web Push toggle, the shared `NotificationBell`, at the foot. */
  | { readonly id: 'bell'; readonly bell: true; readonly foot: true }
  /** A slot held for a later task, never rendered. */
  | { readonly id: string; readonly reserved: string };

export const RAIL_ITEMS: readonly RailItem[] = [
  { id: 'fleet', icon: 'layout-list' },
  { id: 'inbox', icon: 'mail' },
  { id: 'runs', icon: 'workflow' },
  { id: 'accounts', icon: 'key-round' },
  { id: 'archive', icon: 'archive' },
  { id: 'docs', icon: 'file-text' },
  { id: 'activity', reserved: 'F4, W4' },
  { id: 'bell', bell: true, foot: true },
  { id: 'settings', icon: 'settings', foot: true },
];

/** `ROUTES`' title for a rail route, so the rail never spells a place's name of its own. */
function titleOf(id: string): string {
  const route = ROUTES.find((r) => r.id === id);
  if (route === undefined) throw new Error(`RAIL_ITEMS names ${id}, which is not a route`);
  return route.title;
}

function RailEntry({ item, current }: { item: RailItem; current: string | null }): ReactNode {
  if ('reserved' in item) return null;
  if ('bell' in item) return <NotificationBell />;
  const word = titleOf(item.id);
  return (
    <Door
      className="ins-rail-item"
      glyph={<Icon name={item.icon} />}
      aria-label={word}
      aria-current={current === item.id ? 'page' : undefined}
      {...commandDoor(`go-${item.id}`)}
    >
      <span className="ins-rail-tip" aria-hidden="true">{word}</span>
    </Door>
  );
}

export function Rail(): ReactNode {
  const { path } = useLocation();
  const current = topRouteOf(path)?.id ?? null;
  const head = RAIL_ITEMS.filter((i) => !('foot' in i));
  const foot = RAIL_ITEMS.filter((i) => 'foot' in i);
  return (
    <div className="ins-rail">
      {head.map((item) => <RailEntry key={item.id} item={item} current={current} />)}
      <div className="ins-rail-foot">
        {foot.map((item) => <RailEntry key={item.id} item={item} current={current} />)}
      </div>
    </div>
  );
}
