// Refined's session chrome (W2 Task S7c, D-5471; spec §5.3, Session, phone and laptop rows): the short header.
//
// Back (phone only: the desk hides every `.back-btn` in the detail pane), a title row with the doors on its edge, and
// ONE chip rail that scrolls sideways inside itself: the status first, then who it works for, the lane, the model, the
// effort, the branch and every other fact (`SessionDetails`), so the header stays the card's superset in two rows
// instead of the shared header's wrapping block. All of it from `sessionHeaderView`, through the shared header's own
// pieces, so a word or a chip changes in one place.
//
// What it does NOT hold: the `esc` cap (Refined's Stop is the send slot's, W2 Task S7b), any sheet (the ⋯ menu and the
// PR sheet are `SessionFlows`', opened through `useSessionFlows()`), and any Escape binding (the session screen's
// `useEscapeInterrupt`). So a skin switch that replaces this part loses nothing that is open.
import type { ReactNode } from 'react';
import { TypedLabel } from '@ccrc/ui';
import {
  HeaderBack, HeaderChips, HeaderCoordination, HeaderDoors, useSessionChromeInputs, useSessionHeaderView,
} from '../../session/SessionHeader';
import { useSessionFlows } from '../../session/SessionFlows';
import { metaChipTone } from '../../session/chipTones';

export function SessionChrome(): ReactNode {
  const inputs = useSessionChromeInputs();
  const { openMenu } = useSessionFlows();
  const view = useSessionHeaderView(inputs);
  return (
    <header className="chat-head ref-session-head">
      <HeaderBack onBack={inputs.onBack} />
      {/* The title row holds the name alone, so it stays one line beside the doors; the crumb (the workspace's branch)
          is the rail's first chip after the status, in full, where the shared header wraps it under the name. */}
      <div className="ref-session-title">
        <h1 className="chat-title">{view.title}</h1>
      </div>
      <HeaderDoors view={view} openMenu={openMenu} />
      {/* `chat-meta` for the status line's and the details door's shared rules; `ref-chip-rail` makes it one
          scrolling row. */}
      <div className="chat-meta ref-chip-rail">
        <HeaderChips
          view={view}
          afterStatus={(
            <>
              {view.crumb !== null && (
                <span className={metaChipTone('plain')} title={view.crumb}>
                  <TypedLabel className="chat-crumb" text={view.crumb} />
                </span>
              )}
              <HeaderCoordination view={view} />
            </>
          )}
        />
      </div>
    </header>
  );
}
