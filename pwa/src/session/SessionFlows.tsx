// The session's flows, lifted above its chrome (W2 Task S2d, D-5466): the ⋯ menu and the PR sheet.
//
// `SessionHeader` used to hold both as its own state and render both sheets. In the two skins the session's chrome
// is a skin's part, so a switch replaces it (spec §5.4: an open ⋯ menu or PR sheet must survive), and a skin whose
// chrome is not `SessionHeader` would have no owner for them unless it copied them. So `SessionScreen` hosts this
// component at one fixed position, and a part opens a sheet through `useSessionFlows()`. It is S2a's lift
// (`FleetFlows`), for the session. Every sheet is a portalled layer, so where this mounts moves no pixel.
//
// THE MENU'S ITEMS ARE REGISTRY COMMANDS (§The door table). Each item is built with `commandDoor(id)`, so the menu,
// the palette and any later door run one command through the one `CommandLayer`. The layer reaches this session
// through the target this host publishes (`useSessionCommandTarget`), which answers whether an item is offered with
// the menu's own gate (`sessionMenu`, the substrate fault included), so the palette can never offer what the menu
// shows disabled.
import { createContext, useContext, useLayoutEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { FleetSession } from '../../../shared/api';
import { ListRow, Sheet, cn } from '@ccrc/ui';
import { commandDoor } from '../command/door';
import { createTargetSlot } from '../command/targetSlot';
import type { SessionCommandTarget } from '../command/registry';
import { navigate } from '../lib/router';
import { PrSheet } from './PrSheet';
import { hasPrCap } from './prCap';
import { sessionMenu, type SessionMenuEntry } from './sessionMenu';

/** What the session screen does for each flow the menu or a door opens. */
export interface SessionActions {
  changeModel: () => void;
  changeEffort: () => void;
  openHistory: () => void;
  moveAccount: () => void;
  archive: () => void;
  restore: () => void;
  openTerminal: () => void;
  /** `PrSheet`'s merged phase "Clean up…" hands off here. */
  reapWorkspace: () => void;
}

/** How a part opens one of the flows. */
export interface SessionFlowDoors {
  openMenu: () => void;
  openPr: () => void;
}

/** One row of the session menu: a label, and — for the ones that answer a slash command — the command itself,
 *  dimmed, read by nobody. Built with `commandDoor`, never a handler of its own.
 *
 *  `aria-hidden` on the hint is deliberate and was already: the label is the accessible name, and "/model" read
 *  aloud after it is noise. */
function MenuItem({ entry, hint }: { entry: SessionMenuEntry; hint?: ReactNode }): ReactNode {
  return (
    <ListRow
      className={cn('menu-item', entry.danger === true && 'menu-item--danger', entry.docs !== undefined && 'docs-menu-item')}
      disabled={!entry.enabled}
      title={entry.title}
      {...commandDoor(entry.id)}
    >
      <span className="menu-label">{entry.label}</span>
      {hint !== undefined && <span className="menu-hint" aria-hidden="true">{hint}</span>}
    </ListRow>
  );
}

/** The hint beside an item. A NODE, not a string, and `server/test/no-routing-keystroke-from-server.test.ts` is why:
 *  two of these hints ARE the slash commands, and that census refuses a quote immediately before `/effort` or
 *  `/model` anywhere under `pwa/src` — the record is the arbiter and ccd is the one typer, so a routing keystroke
 *  must not exist as a string literal in this app even as a label. They are JSX text here, as they always were. */
function hintOf(entry: SessionMenuEntry): ReactNode {
  switch (entry.id) {
    case 'session-model': return <>/model</>;
    case 'session-effort': return <>/effort</>;
    case 'open-history': return 'journal';
    case 'session-docs': return entry.docs?.branch ?? 'default';
    default: return undefined;
  }
}

const SessionFlowsContext = createContext<SessionFlowDoors | null>(null);

/** How a part opens the ⋯ menu or the PR sheet. THROWS outside its host, as `useFleetChrome()` does: a part that
 *  forgot the host would otherwise render a ⋯ that opens nothing, and say nothing. */
export function useSessionFlows(): SessionFlowDoors {
  const doors = useContext(SessionFlowsContext);
  if (doors === null) throw new Error('useSessionFlows() outside SessionFlows: the session screen hosts it');
  return doors;
}

// THE TARGET THE COMMAND LAYER READS. The layer is mounted above the frame (D-5467) and this host inside the ladder,
// so the host publishes its target in the shared slot (`command/targetSlot.ts`) while it is mounted, and the layer
// subscribes. One slot: one session screen is mounted at a time; a host clears it on unmount only if it is still the
// one published.
const slot = createTargetSlot<SessionCommandTarget>();

/** The open session's command target, or null off a session screen (`CommandLayer`'s `ctx.session`). */
export function useSessionCommandTarget(): SessionCommandTarget | null {
  return slot.useValue();
}

export interface SessionFlowsProps {
  session: FleetSession | null;
  /** The menu sheet's title: the project, or the deep link's fallback before the first frame. */
  title: string;
  actions: SessionActions;
  children?: ReactNode;
}

export function SessionFlows({ session, title, actions, children }: SessionFlowsProps): ReactNode {
  const [menuOpen, setMenuOpen] = useState(false);
  const [prOpen, setPrOpen] = useState(false);
  const entries = sessionMenu(session);

  // Read at run time, never closed over: the layer may run a command a render after this host last published.
  const latest = useRef({ entries, actions, session });
  latest.current = { entries, actions, session };

  const [doors] = useState<SessionFlowDoors>(() => ({
    openMenu: () => setMenuOpen(true),
    openPr: () => setPrOpen(true),
  }));

  const [mine] = useState<SessionCommandTarget>(() => {
    const offers = (id: string): boolean => {
      const { entries: now, session: s } = latest.current;
      if (id === 'open-terminal') return true;
      if (id === 'session-pr') return hasPrCap(s);
      return now.some((e) => e.id === id && e.enabled);
    };
    return { offers, run: (id) => {
      // THE GATE IS ASKED AGAIN HERE, at the moment it runs: a palette list ranked a frame before a substrate fault
      // arrived must not reach a swap (whose sheet has no gate of its own) through a stale row.
      if (!offers(id)) return;
      const { entries: now, actions: act } = latest.current;
      // Menu taps close the sheet first so the follow-up surface (swap sheet, archive sheet, arriving model dialog)
      // never fights it for the bottom edge.
      setMenuOpen(false);
      switch (id) {
        case 'session-model': act.changeModel(); break;
        case 'session-effort': act.changeEffort(); break;
        case 'open-history': act.openHistory(); break;
        case 'session-docs': {
          const href = now.find((e) => e.id === 'session-docs')?.docs?.href;
          if (href !== undefined) navigate(href);
          break;
        }
        case 'session-swap': act.moveAccount(); break;
        case 'session-archive': act.archive(); break;
        case 'session-restore': act.restore(); break;
        case 'open-terminal': act.openTerminal(); break;
        case 'session-pr': setPrOpen(true); break;
        default: break;
      }
    } };
  });

  useLayoutEffect(() => {
    slot.publish(mine);
    return () => slot.clear(mine);
  }, [mine]);

  return (
    <SessionFlowsContext.Provider value={doors}>
      {children}
      <Sheet open={menuOpen} onClose={() => setMenuOpen(false)} eyebrow="session" title={title}>
        <div className="menu">
          {entries.map((e) => <MenuItem key={e.id} entry={e} hint={hintOf(e)} />)}
        </div>
      </Sheet>
      <PrSheet
        session={session}
        open={prOpen}
        onClose={() => setPrOpen(false)}
        onReap={() => { setPrOpen(false); actions.reapWorkspace(); }}
      />
    </SessionFlowsContext.Provider>
  );
}
