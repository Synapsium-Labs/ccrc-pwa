// The command layer (D-5103): the palette, the shortcut sheet and the global
// keys, mounted once beside the app. `main.tsx` renders it after `<App/>`
// inside the root boundary, because `app.tsx` is held by an in-flight change;
// W2's shells take the mount.
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  COMMAND_KEY, CommandPalette, KeyHint, RESET_LIST, Sheet, type CommandPaletteOption,
} from '@ccrc/ui';
import { useAuthLost } from '../lib/auth';
import { navigate, useLocation } from '../lib/router';
import { setSkin } from '../lib/skin';
import { setTheme } from '../lib/theme';
import { useFleetStore } from '../stores/fleet';
import { baseCommands, fleetOrder } from './commands';
import { available, rankCommands, type CommandContext, type CommandPage } from './registry';
import { useShortcuts } from './useShortcuts';

/** Is a command's answer a page to open, rather than nothing? */
function isPage(r: void | CommandPage): r is CommandPage {
  return typeof r === 'object' && r !== null;
}

export function CommandLayer(): ReactNode {
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

  const ordered = useMemo(() => fleetOrder(sessions, runs), [sessions, runs]);
  const ctx = useMemo<CommandContext>(() => ({
    path,
    sessions: ordered,
    navigate: (href) => navigate(href),
    setSkin,
    setTheme: (choice) => setTheme(choice),
    openShortcuts: () => setSheet(true),
  }), [path, ordered]);
  const ctxRef = useRef(ctx);
  ctxRef.current = ctx;

  const commands = useMemo(() => baseCommands(), []);
  useShortcuts({ enabled, commands, context: () => ctxRef.current, onPalette: () => setOpen(true) });

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
