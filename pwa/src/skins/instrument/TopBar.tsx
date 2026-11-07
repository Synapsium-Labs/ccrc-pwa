// Instrument's top bar (W2 Task S9, D-5472; desk-nav Task A, D-8100), inside the frame's `<header>`, spanning every column of
// the frame's first row, so the wordmark is the frame's top-left chrome (spec §3.1). `--tap-min` tall, so it needs no pointer
// branch.
//
// Left to right on its line, which is its DOM and focus order: the bar's one `<nav aria-label="Primary">`, holding the
// wordmark door (the way home, `commandDoor('go-fleet')`, the command `g f` runs too) and the six desk doors (`DESK_DOORS`);
// the command field, a door that opens the palette (`commandDoor('open-palette')`), never a second text field, so the palette
// keeps its one input (D-5103); the bell and Settings; and `+`, New session (`commandDoor('new-session')`). The landmark holds
// the doors only (`nav-holds-doors-only`, as Refined's `AppBar` draws its nav): a palette opener, a toggle and an action are
// not navigation. Under the line the header holds the lanes row, the full accounts strip (T2c, D-6329): every lane's card,
// one instance, since the bar mounts only at the desk. No breadcrumb: every page says where it is (spec §2.4).
//
// ONE REGISTRY, `DESK_DOORS`, left to right: the console's desk places (`DESK_PLACES`, `lib/places.ts`, the one list Refined's
// desk bar and the phone's bottom bar read too), with Archive, Instrument's own door, after Accounts. A door's word is
// `ROUTES`' title for its id and its door is the registry's own "Go to" command (`commandDoor('go-<id>')`), so the bar, the
// palette and the keys run one command. The door the page is on or under carries `aria-current="page"` (`topRouteOf`), the
// wordmark door included: it is current wherever `topRouteOf` answers Fleet, on `/` and on a session
// (`home-door-follows-toprouteof`). Every place's badge is `placeBadge`'s (`fleet/navBadges.ts`; review 1466 F4), so no skin's
// door counts for itself: a badged door's accessible name reads `Inbox, 2 waiting for you`, and a `CountBadge` prints the
// number while it is above zero.
//
// A DOOR'S TWO FORMS. From `DOOR_WORDS_QUERY` (1280) a door shows its icon and its word; below it, its icon and a tip below it
// that reads the same word, shown on hover and on keyboard focus (instrument.css). Either way a counted door follows the word
// with a space and its pill, so both forms show "Inbox 2" and label in name holds at every desk width (D-7897): the tip reads
// the word, not the whole name, because the name's count is the pill's (`tip-reads-the-word`, desk-nav fix round 1). Which
// form is MOUNTED by `useMediaQuery`, never both and never CSS-hidden (`door-form-mounted`), so the text a reader is shown is
// the text label-in-name measures. Settings is an icon door with its tip at every width (`settings-icon-door`), as Refined's
// gear is.
//
// RESERVED, NOT RENDERED: Activity is F4's (W4). Its entry is here so the activity log adds one flag, and no control that does
// nothing ships.
//
// THE OVERFLOW ORDER (900 to about 1100, instrument.css): the command field takes the room the doors leave, its words shrink
// away and its ⌘K and its accessible name stay. The lanes row wraps onto more lines instead of shrinking.
import type { ReactNode } from 'react';
import { BareRow, Button, COMMAND_KEY, CountBadge, Door, Icon, KeyHint, Wordmark, type IconName } from '@ccrc/ui';
import { commandDoor } from '../../command/door';
import { COMMAND_FIELD_WORDS } from '../../command/registry';
import { AccountsStrip } from '../../fleet/AccountsStrip';
import { badgePrint, placeBadge, useNavBadges, type NavBadges } from '../../fleet/navBadges';
import { NotificationBell } from '../../fleet/NotificationBell';
import { DESK_PLACES } from '../../lib/places';
import { useLocation } from '../../lib/router';
import { ROUTES, topRouteOf } from '../../lib/routes';
import { useMediaQuery } from '../../lib/useMediaQuery';

export type DeskDoor =
  /** A door to the top route `id`. */
  | { readonly id: string; readonly icon: IconName }
  /** A slot held for a later task, never rendered. */
  | { readonly id: string; readonly reserved: string };

/** Instrument's own door among the places: Archive, after Accounts (its place before PL10). */
const ARCHIVE_AFTER = 'accounts';

/** The bar's doors after the wordmark, left to right. Bell and Settings are not doors of this list: the bar places them by
 *  hand after the command field. */
export const DESK_DOORS: readonly DeskDoor[] = [
  ...DESK_PLACES.flatMap((p): DeskDoor[] => (p.id === ARCHIVE_AFTER ? [p, { id: 'archive', icon: 'archive' }] : [p])),
  { id: 'activity', reserved: 'F4, W4' },
];

/** At and above this width each door shows its icon and its word; below it, the icon and a tip. */
export const DOOR_WORDS_QUERY = '(min-width: 1280px)';

/** `ROUTES`' title for a door's route, so the bar never spells a place's name of its own. */
function titleOf(id: string): string {
  const route = ROUTES.find((r) => r.id === id);
  if (route === undefined) throw new Error(`DESK_DOORS names ${id}, which is not a route`);
  return route.title;
}

/** The wordmark door's accessible name: the wordmark's own word first (label in name), then the place it opens. */
export const HOME_DOOR_NAME = `ccrc, ${titleOf('fleet')}`;

function DeskDoorEntry({ id, icon, current, badges, words }: {
  id: string; icon: IconName; current: string | null; badges: NavBadges; words: boolean;
}): ReactNode {
  const word = titleOf(id);
  const badge = placeBadge(id, badges);
  const count = badge.count;
  const name = count > 0 ? `${word}, ${count} ${badge.word}` : word;
  const pill = count > 0 && <CountBadge className="ins-door-count" aria-hidden="true">{badgePrint(count)}</CountBadge>;
  return (
    <Door
      className="ins-door"
      glyph={<Icon name={icon} />}
      aria-label={name}
      aria-current={current === id ? 'page' : undefined}
      {...commandDoor(`go-${id}`)}
    >
      {words
        ? <span className="ins-door-word">{word}</span>
        : <span className="ins-door-tip" aria-hidden="true">{word}</span>}
      {count > 0 && ' '}
      {pill}
    </Door>
  );
}

export function TopBar(): ReactNode {
  const { path } = useLocation();
  const current = topRouteOf(path)?.id ?? null;
  const badges = useNavBadges();
  const words = useMediaQuery(DOOR_WORDS_QUERY);
  return (
    <>
      <div className="ins-topbar">
        <nav aria-label="Primary" className="ins-doors">
          <Door
            glyph={null}
            className="ins-door ins-home"
            aria-label={HOME_DOOR_NAME}
            aria-current={current === 'fleet' ? 'page' : undefined}
            {...commandDoor('go-fleet')}
          >
            <Wordmark />
          </Door>
          {DESK_DOORS.map((d) => ('reserved' in d
            ? null
            : <DeskDoorEntry key={d.id} id={d.id} icon={d.icon} current={current} badges={badges} words={words} />))}
        </nav>
        <BareRow className="ins-command" aria-label={COMMAND_FIELD_WORDS} {...commandDoor('open-palette')}>
          <Icon name="search" />
          <span className="ins-command-words">{COMMAND_FIELD_WORDS}</span>
          <KeyHint keys={[COMMAND_KEY, 'K']} />
        </BareRow>
        <div className="ins-bar-doors">
          <NotificationBell />
          <DeskDoorEntry id="settings" icon="settings" current={current} badges={badges} words={false} />
        </div>
        <Button variant="primary" size="fit" className="ins-new" aria-label="New session" {...commandDoor('new-session')}>
          <Icon name="plus" />
        </Button>
      </div>
      <AccountsStrip />
    </>
  );
}
