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
import {
  HeaderBack, HeaderChips, HeaderCoordination, HeaderCrumbText, HeaderDoors, HeaderTitleText, useSessionChromeInputs,
  useSessionHeaderView,
} from '../../session/SessionHeader';
import { useSessionFlows } from '../../session/SessionFlows';
import { InspectorToggle } from '../../inspector/InspectorToggle';

export function SessionChrome(): ReactNode {
  const inputs = useSessionChromeInputs();
  const { openMenu } = useSessionFlows();
  const view = useSessionHeaderView(inputs);
  return (
    <header className="chat-head ref-session-head">
      <HeaderBack onBack={inputs.onBack} />
      {/* The title row holds the session's name beside the doors, so it stays one line; the project is a small crumb
          above it (desktop polish T3c, D-6333), where the shared header draws it before the title. */}
      <div className="ref-session-title">
        <HeaderCrumbText view={view} className="chat-crumb ref-session-crumb" />
        <h1 className="chat-title">
          <HeaderTitleText view={view} />
        </h1>
      </div>
      <HeaderDoors view={view} openMenu={openMenu} />
      {/* Rightmost of the doors, only while the rail is placed (desktop polish T3e, D-6385). */}
      <InspectorToggle />
      {/* `chat-meta` for the status line's and the details door's shared rules; `ref-chip-rail` makes it one
          scrolling row. */}
      <div className="chat-meta ref-chip-rail">
        <HeaderChips
          view={view}
          afterStatus={<HeaderCoordination view={view} />}
        />
      </div>
    </header>
  );
}
