// The command layer (D-5103): the palette, the shortcut sheet and the global
// keys, mounted once. `app.tsx` mounts it above the skin frame (D-5467), so a
// skin switch never remounts it and an open palette keeps its query. It is
// also where every door's command runs (`door.ts`, D-5469).
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  COMMAND_KEY, CommandPalette, KeyHint, RESET_LIST, Sheet, type CommandPaletteOption,
} from '@ccrc/ui';
import { useAuthLost } from '../lib/auth';
import { navigate, useLocation } from '../lib/router';
import { setSkin } from '../lib/skin';
import { setTheme } from '../lib/theme';
import { CONTENT_ID } from '../skins/frame';
import { useFleetStore } from '../stores/fleet';
import { useSessionCommandTarget } from '../session/SessionFlows';
import { baseCommands, fleetOrder } from './commands';
import { available, rankCommands, type CommandContext, type CommandPage } from './registry';
import { DOOR_EVENT } from './door';
import { useShortcuts } from './useShortcuts';

/** How long a closing palette may hold focus before the layer restores it:
 *  forty ticks of 25 ms, a second, well past any exit animation. */
const RESTORE_TICK_MS = 25;
const RESTORE_TRIES = 40;

/** Is a command's answer a page to open, rather than nothing? */
function isPage(r: void | CommandPage): r is CommandPage {
  return typeof r === 'object' && r !== null;
}

/** What the layer needs from the shell: the fleet flows' New session door
 *  (`useFleetFlows().openNewSession`), handed down by `app.tsx`. */
export interface CommandLayerProps {
  openNewSession: () => void;
}

export function CommandLayer({ openNewSession }: CommandLayerProps): ReactNode {
  const { path } = useLocation();
  const sessions = useFleetStore((s) => s.sessions);
  const runs = useFleetStore((s) => s.runs);
  const blocked = useFleetStore((s) => s.blocked);
  const { lost } = useAuthLost();
  const enabled = !lost && !blocked;

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [page, setPage] = useState<CommandPage | null>(null);
  const [sheet, setSheet] = useState(false);

  const close = (): void => {
    setOpen(false);
    setQuery('');
    setPage(null);
  };

  // FOCUS GOES BACK WHERE IT CAME FROM, never to <body> (spec §5.4, W2 Task
  // S2b, D-5679). The palette's close leaves focus on the body (measured in jsdom on
  // main: Escape from a palette opened in the composer left it there), so the
  // layer puts it back on what had it when the palette opened, or, when a
  // command took that away (a route change, a skin switch that replaced a
  // part), on the main landmark.
  const opener = useRef<Element | null>(null);
  // NEVER BEHIND A COVER (D-5679). The login and block screens cover a
  // non-inert app: a restore while one is up would put the passphrase's
  // keystrokes into the composer behind it. Read at restore time, not closed
  // over, because the cover arrives in the same commit that closes the palette.
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;
  const openPalette = useCallback((): void => {
    if (!open) opener.current = document.activeElement;
    setOpen(true);
  }, [open]);
  const wasOpen = useRef(false);
  useEffect(() => {
    if (open) {
      wasOpen.current = true;
      return undefined;
    }
    if (!wasOpen.current) return undefined;
    wasOpen.current = false;
    const back = opener.current;
    opener.current = null;
    // After the palette's own close has run its course, not inside this
    // commit: while its layer animates out (`data-state="closed"`, still
    // mounted) its focus trap would pull focus straight back, and it drops
    // focus on the body as it unmounts. Measured in Chromium at 1280: a
    // restore at 0 ms was undone that way. So wait for the closing layer to
    // go, a bounded number of short ticks.
    let tries = 0;
    let t = 0;
    const restore = (): void => {
      if (document.querySelector('[role="dialog"][data-state="closed"]') !== null && tries < RESTORE_TRIES) {
        tries += 1;
        t = window.setTimeout(restore, RESTORE_TICK_MS);
        return;
      }
      if (!enabledRef.current) return;
      const active = document.activeElement;
      if (active !== null && active !== document.body) return;
      const content = document.getElementById(CONTENT_ID);
      const target = back instanceof HTMLElement && back !== document.body && back.isConnected ? back : content;
      target?.focus({ preventScroll: true });
      // An opener still connected can refuse focus (the phone swap hides the
      // fleet column with display: none): the main landmark, not the body.
      if (document.activeElement === document.body) content?.focus({ preventScroll: true });
    };
    t = window.setTimeout(restore, 0);
    return () => window.clearTimeout(t);
  }, [open]);

  const ordered = useMemo(() => fleetOrder(sessions, runs), [sessions, runs]);
  // The open session's flows (W2 Task S2d): its commands are offered only while a session screen hosts them.
  const session = useSessionCommandTarget();
  const ctx = useMemo<CommandContext>(() => ({
    path,
    sessions: ordered,
    navigate: (href) => navigate(href),
    setSkin,
    setTheme: (choice) => setTheme(choice),
    openShortcuts: () => setSheet(true),
    openNewSession,
    openPalette,
    paletteOpen: open,
    session,
  }), [path, ordered, openNewSession, openPalette, open, session]);
  const ctxRef = useRef(ctx);
  ctxRef.current = ctx;

  const commands = useMemo(() => baseCommands(), []);
  useShortcuts({ enabled, commands, context: () => ctxRef.current, onPalette: openPalette });

  // A door's click (D-5469): the same command, the same context, offered
  // under the same `when`. A command that answers a page opens the palette on
  // that page, as choosing it in the palette would.
  useEffect(() => {
    if (!enabled) return undefined;
    const onDoor = (e: Event): void => {
      const id = (e as CustomEvent<string>).detail;
      const c = available(commands, ctxRef.current).find((x) => x.id === id);
      if (c === undefined) return;
      const answer = c.run(ctxRef.current);
      if (isPage(answer)) {
        setPage(answer);
        setQuery('');
        setOpen(true);
      }
    };
    window.addEventListener(DOOR_EVENT, onDoor);
    return () => window.removeEventListener(DOOR_EVENT, onDoor);
  }, [enabled, commands]);

  // The login and block screens cover everything: nothing of this layer
  // stays open over them.
  useEffect(() => {
    if (enabled) return;
    close();
    setSheet(false);
  }, [enabled]);

  const list = useMemo(() => (page === null ? available(commands, ctx) : page.commands), [page, commands, ctx]);
  const ranked = useMemo(() => rankCommands(query, list), [query, list]);
  const options = useMemo<CommandPaletteOption[]>(
    () => ranked.map((c) => ({ id: c.id, title: c.title, group: c.group, keys: c.keys })),
    [ranked],
  );

  const run = (id: string): void => {
    const c = ranked.find((x) => x.id === id);
    if (c === undefined) return;
    const answer = c.run(ctxRef.current);
    if (isPage(answer)) {
      setPage(answer);
      setQuery('');
    } else {
      close();
    }
  };

  // The sheet lists what `useShortcuts` binds: the registry's own keys, plus
  // the one chord the layer itself owns.
  const rows: { id: string; title: string; keys: readonly string[] }[] = [
    { id: 'palette', title: 'Open the command palette', keys: [COMMAND_KEY, 'K'] },
    ...commands.flatMap((c) => (c.keys === undefined ? [] : [{ id: c.id, title: c.title, keys: c.keys }])),
  ];

  return (
    <>
      <CommandPalette
        open={open && enabled}
        onClose={close}
        query={query}
        onQueryChange={setQuery}
        options={options}
        onRun={run}
        onBack={page === null ? undefined : () => { setPage(null); setQuery(''); }}
        label={page === null ? 'Command palette' : page.title}
        placeholder={page === null ? 'Type a command' : `${page.title}…`}
      />
      <Sheet open={sheet && enabled} onClose={() => setSheet(false)} title="Keyboard shortcuts">
        <ul className={RESET_LIST}>
          {rows.map((c) => (
            <li key={c.id} className="flex min-h-11 items-center gap-3 border-b border-edge-subtle py-2">
              <span className="min-w-0 flex-1 font-ui text-base text-ink-primary">{c.title}</span>
              <KeyHint keys={c.keys} />
            </li>
          ))}
        </ul>
        <p className="mt-3 font-ui text-sm text-ink-secondary">
          Ctrl+K opens the palette too. The single keys work outside text fields, with no Ctrl, Alt or {COMMAND_KEY} held;
          an empty message box passes [, ] and ? on, and keeps the g chords as text.
          {/* D-5457: the empty-composer rule, useShortcuts.ts. */}
        </p>
      </Sheet>
    </>
  );
}
