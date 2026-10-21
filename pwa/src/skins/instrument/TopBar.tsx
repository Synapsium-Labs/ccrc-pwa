// Instrument's top bar (W2 Task S9, D-5472), inside the frame's `<header>`, spanning every column of the frame's first
// row, the rail's included, so the wordmark is the frame's top-left chrome (spec §3.1). `--tap-min` tall, so it needs
// no pointer branch.
//
// Left to right: `Wordmark`; the breadcrumb (`breadcrumb`, from `ROUTES`' titles and the session header's own words);
// the command field, a door that opens the palette (`commandDoor('open-palette')`), never a second text field, so the
// palette keeps its one input (D-5103); the LED lane meters, the shared compact gauges in their `led` arrangement, one
// door to /accounts; and `+`, New session (`commandDoor('new-session')`).
//
// THE OVERFLOW ORDER (900 to about 1100, instrument.css): the breadcrumb's middle crumbs truncate first, then the
// meters wrap to "+n" (the gauges measure their own fit), then the command field's words shrink away and its ⌘K and
// its accessible name stay.
import type { ReactNode } from 'react';
import { BareRow, Button, COMMAND_KEY, Icon, KeyHint, Wordmark } from '@ccrc/ui';
import { commandDoor } from '../../command/door';
import { AccountsStrip } from '../../fleet/AccountsStrip';
import { breadcrumb } from '../../fleet/breadcrumb';
import { useLocation } from '../../lib/router';
import { useFleetStore } from '../../stores/fleet';

/** The command field's words, and its accessible name. */
export const COMMAND_FIELD_WORDS = 'Search or run a command';

export function TopBar(): ReactNode {
  const { path } = useLocation();
  const sessions = useFleetStore((s) => s.sessions);
  const crumbs = breadcrumb(path, sessions);
  return (
    <div className="ins-topbar">
      <Wordmark className="ins-wordmark" />
      <ol className="ins-crumbs" aria-label="Breadcrumb">
        {crumbs.map((c, i) => (
          <li key={i} className="ins-crumb" aria-current={i === crumbs.length - 1 ? 'page' : undefined}>{c}</li>
        ))}
      </ol>
      <BareRow className="ins-command" aria-label={COMMAND_FIELD_WORDS} {...commandDoor('open-palette')}>
        <Icon name="search" />
        <span className="ins-command-words">{COMMAND_FIELD_WORDS}</span>
        <KeyHint keys={[COMMAND_KEY, 'K']} />
      </BareRow>
      <div className="ins-meters">
        <AccountsStrip compact="led" />
      </div>
      <Button variant="primary" size="fit" className="ins-new" aria-label="New session" {...commandDoor('new-session')}>
        <Icon name="plus" />
      </Button>
    </div>
  );
}
