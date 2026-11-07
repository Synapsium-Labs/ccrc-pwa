// Instrument's top bar (W2 Task S9, D-5472), inside the frame's `<header>`, spanning every column of the frame's first
// row, so the wordmark is the frame's top-left chrome (spec §3.1). `--tap-min` tall, so it needs no pointer branch.
//
// Left to right on its line: `Wordmark`; the desk doors (`DESK_DOORS`), in the bar's one `<nav aria-label="Primary">`; the
// breadcrumb (`breadcrumb`, from `ROUTES`' titles and the session header's own words); the command field, a door that opens
// the palette (`commandDoor('open-palette')`), never a second text field, so the palette keeps its one input (D-5103); the
// bell and Settings; and `+`, New session (`commandDoor('new-session')`). Under the line the header holds the lanes row, the
// full accounts strip (T2c, D-6329): every lane's card, one instance, since the bar mounts only at the desk.
//
// ONE REGISTRY, `DESK_DOORS`, left to right: the console's desk places (`DESK_PLACES`, `lib/places.ts`, the one list Refined's
// desk bar and the phone's bottom bar read too), with Archive, Instrument's own door, after Accounts. A door's word is
// `ROUTES`' title for its id and its door is the registry's own "Go to" command (`commandDoor('go-<id>')`), so the bar, the
// palette and the keys run one command. The door the page is on or under carries `aria-current="page"` (`topRouteOf`).
// Every place's badge is `placeBadge`'s (`fleet/navBadges.ts`; review 1466 F4), so no skin's door counts for itself: a
// badged door's accessible name reads `Inbox, 2 waiting for you`, and a `CountBadge` prints the number while it is above zero.
//
// RESERVED, NOT RENDERED: Activity is F4's (W4). Its entry is here so the activity log adds one flag, and no control that does
// nothing ships.
//
// THE OVERFLOW ORDER (900 to about 1100, instrument.css): the breadcrumb's middle crumbs truncate first, then the
// command field's words shrink away and its ⌘K and its accessible name stay. The lanes row wraps onto more lines
// instead of shrinking.
import type { ReactNode } from 'react';
import { BareRow, Button, COMMAND_KEY, CountBadge, Door, Icon, KeyHint, Wordmark, type IconName } from '@ccrc/ui';
import { commandDoor } from '../../command/door';
import { COMMAND_FIELD_WORDS } from '../../command/registry';
import { AccountsStrip } from '../../fleet/AccountsStrip';
import { breadcrumb } from '../../fleet/breadcrumb';
import { badgePrint, placeBadge, useNavBadges, type NavBadges } from '../../fleet/navBadges';
import { NotificationBell } from '../../fleet/NotificationBell';
import { DESK_PLACES } from '../../lib/places';
import { useLocation } from '../../lib/router';
import { ROUTES, topRouteOf } from '../../lib/routes';
import { useFleetStore } from '../../stores/fleet';

export type DeskDoor =
  /** A door to the top route `id`. */
  | { readonly id: string; readonly icon: IconName }
  /** A slot held for a later task, never rendered. */
  | { readonly id: string; readonly reserved: string };

/** Instrument's own door among the places: Archive, after Accounts (its place before PL10). */
const ARCHIVE_AFTER = 'accounts';

export const DESK_DOORS: readonly DeskDoor[] = [
  ...DESK_PLACES.flatMap((p): DeskDoor[] => (p.id === ARCHIVE_AFTER ? [p, { id: 'archive', icon: 'archive' }] : [p])),
  { id: 'activity', reserved: 'F4, W4' },
];

/** `ROUTES`' title for a door's route, so the bar never spells a place's name of its own. */
function titleOf(id: string): string {
  const route = ROUTES.find((r) => r.id === id);
  if (route === undefined) throw new Error(`DESK_DOORS names ${id}, which is not a route`);
  return route.title;
}

function DeskDoorEntry({ id, icon, current, badges }: { id: string; icon: IconName; current: string | null; badges: NavBadges }): ReactNode {
  const word = titleOf(id);
  const badge = placeBadge(id, badges);
  const count = badge.count;
  const name = count > 0 ? `${word}, ${count} ${badge.word}` : word;
  return (
    <Door
      className="ins-door"
      glyph={<Icon name={icon} />}
      aria-label={name}
      aria-current={current === id ? 'page' : undefined}
      {...commandDoor(`go-${id}`)}
    >
      <span className="ins-door-tip" aria-hidden="true">{name}</span>
      {count > 0 && <CountBadge className="ins-door-count" aria-hidden="true">{badgePrint(count)}</CountBadge>}
    </Door>
  );
}

export function TopBar(): ReactNode {
  const { path } = useLocation();
  const sessions = useFleetStore((s) => s.sessions);
  const current = topRouteOf(path)?.id ?? null;
  const badges = useNavBadges();
  const crumbs = breadcrumb(path, sessions);
  return (
    <>
      <div className="ins-topbar">
        <Wordmark className="ins-wordmark" />
        <nav aria-label="Primary" className="ins-doors">
          {DESK_DOORS.map((d) => ('reserved' in d ? null : <DeskDoorEntry key={d.id} id={d.id} icon={d.icon} current={current} badges={badges} />))}
        </nav>
        <ol className="ins-crumbs" aria-label="Breadcrumb">
          {crumbs.map((c, i) => (
            <li key={i} className="ins-crumb" title={c} aria-current={i === crumbs.length - 1 ? 'page' : undefined}>{c}</li>
          ))}
        </ol>
        <BareRow className="ins-command" aria-label={COMMAND_FIELD_WORDS} {...commandDoor('open-palette')}>
          <Icon name="search" />
          <span className="ins-command-words">{COMMAND_FIELD_WORDS}</span>
          <KeyHint keys={[COMMAND_KEY, 'K']} />
        </BareRow>
        <div className="ins-bar-doors">
          <NotificationBell />
          <DeskDoorEntry id="settings" icon="settings" current={current} badges={badges} />
        </div>
        <Button variant="primary" size="fit" className="ins-new" aria-label="New session" {...commandDoor('new-session')}>
          <Icon name="plus" />
        </Button>
      </div>
      <AccountsStrip />
    </>
  );
}
