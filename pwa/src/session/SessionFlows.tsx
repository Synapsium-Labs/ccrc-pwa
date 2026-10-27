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
import { createContext, useContext, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { ReactNode } from 'react';
import { substrateFault, type FleetSession } from '../../../shared/api';
import { ListRow, Sheet, cn } from '@ccrc/ui';
import { commandDoor } from '../command/door';
import type { SessionCommandTarget } from '../command/registry';
import { navigate } from '../lib/router';
import { sessionDocsHref } from '../docs/docsLinks';
import { isPutAway, restoreReachesEnsure } from '../fleet/ArchiveSheet';
import { substrateFaultText } from '../fleet/substrateWords';
import { PrSheet } from './PrSheet';
import { UNCHECKED_PR, hasPrCap, prDoorWord } from './PrKeycap';

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

/** One item of the ⋯ menu: its command, its words, and whether it is offered enabled. */
export interface SessionMenuEntry {
  id: 'open-terminal' | 'session-pr' | 'session-model' | 'session-effort' | 'open-history' | 'session-docs'
    | 'session-swap' | 'session-archive' | 'session-restore';
  label: string;
  enabled: boolean;
  /** The reason a gated item is disabled (the substrate chip's own words), on `title`. */
  title?: string;
  danger?: boolean;
  /** Docs only: the branch its hint names, and where it goes. */
  docs?: { href: string; branch: string | null };
}

/** The ⋯ menu for `session`, in the order it draws: the one reader of every item's gate, which the menu renders and
 *  the commands' `when` asks. `null` is a deep link before its first fleet frame. */
export function sessionMenu(session: FleetSession | null): SessionMenuEntry[] {
  // The substrate gate (spec §4): under a standing fault the console cannot SEE this session, so Archive (and a main
  // checkout's Restore) — an offer to act on a pane nobody can measure — refuses, disabled with the reason on
  // `title` (the chip's own `tmux unreachable — <reason>`, from `substrateWords.ts`). Read through `substrateFault`:
  // the frame is cast, not revived, so an older server's row lacks the key at runtime.
  const fault = session === null ? null : substrateFault(session);
  const faultTitle = fault === null ? undefined : substrateFaultText(fault);
  // The menu's Docs item (docs design 4.8), from the one builder the actions sheet's row also calls. No item while no
  // row has arrived, and none when the builder answers null (the project fails the project grammar).
  const docsLink = session === null ? null : sessionDocsHref(session);
  const entries: SessionMenuEntry[] = [
    { id: 'session-model', label: 'Change model', enabled: true },
    { id: 'session-effort', label: 'Change effort', enabled: true },
    { id: 'open-history', label: 'History', enabled: true },
  ];
  if (docsLink !== null) {
    entries.push({ id: 'session-docs', label: 'Docs', enabled: true, docs: { href: docsLink.href, branch: docsLink.branch } });
  }
  // The header's doors, each with its word (desktop polish T3c, D-6333): below 900 the header's doors are glyphs and this
  // sheet is where a phone reads what each is. They run the same commands the header's doors do (`open-terminal` and
  // `session-pr`, in the host's `run` below), at every width; at the desk they repeat a visible door. The PR door is a
  // workspace's alone (`hasPrCap`), and its word is the cap's own (`prDoorWord`).
  entries.push({ id: 'open-terminal', label: 'Terminal', enabled: true });
  if (hasPrCap(session)) entries.push({ id: 'session-pr', label: prDoorWord(session.pr ?? UNCHECKED_PR), enabled: true });
  // Gated like Archive below (branch review): this item opens the SAME SwapSheet as the actions sheet's gated opener,
  // and SwapSheet's confirm fires api.swap with no substrate check of its own — so an ungated door here was a swap
  // reachable with no gate anywhere.
  entries.push({ id: 'session-swap', label: 'Move to another account', enabled: fault === null, title: faultTitle });
  // Archive for every session, Restore for one already put away (workspace lifecycle §5.2) — never both. Archive is
  // gated like Move above: it ends the pane. It needs the row to choose its words, so a deep link that has not seen
  // its first frame yet offers it disabled. Restore is gated exactly where it IS Restart's request
  // (`restoreReachesEnsure`: a main checkout posts `/ensure`); a workspace's `ws-restore` is a different verb and
  // stays ungated, as in the actions sheet.
  if (session !== null && isPutAway(session)) {
    const ensure = restoreReachesEnsure(session);
    entries.push({
      id: 'session-restore', label: 'Restore', enabled: !(fault !== null && ensure), title: ensure ? faultTitle : undefined,
    });
  } else {
    entries.push({
      id: 'session-archive', label: 'Archive', enabled: fault === null && session !== null, title: faultTitle, danger: true,
    });
  }
  return entries;
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
// so the host publishes its target here while it is mounted, and the layer subscribes. One slot: one session screen
// is mounted at a time; a host clears it on unmount only if it is still the one published.
let target: SessionCommandTarget | null = null;
const listeners = new Set<() => void>();
function publish(next: SessionCommandTarget | null): void {
  target = next;
  for (const l of listeners) l();
}
function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => { listeners.delete(l); };
}

/** The open session's command target, or null off a session screen (`CommandLayer`'s `ctx.session`). */
export function useSessionCommandTarget(): SessionCommandTarget | null {
  return useSyncExternalStore(subscribe, () => target, () => null);
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
    publish(mine);
    return () => { if (target === mine) publish(null); };
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
