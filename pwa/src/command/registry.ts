// The command registry (D-5103): what a command is, and how a query ranks
// them. Pure: no store, no DOM. Both skins reach the same registry (the ⌘K
// palette in each, and Instrument's top-bar field in W2), so a command added
// here is in every skin, the palette and the shortcut sheet at once.
import type { FleetSession } from '../../../shared/api';

/** What a command may read and do. Built by `CommandLayer` per run, so a
 *  command never holds a stale store snapshot. */
export interface CommandContext {
  /** The path in force, `/s/<id>` on a session. */
  path: string;
  /** The fleet in the fleet screen's own order (`fleetOrder`). */
  sessions: readonly FleetSession[];
  navigate: (href: string) => void;
  setSkin: (choice: string) => void;
  setTheme: (choice: string) => void;
  openShortcuts: () => void;
}

/** A second list a command opens in place of running: "Switch theme…" opens
 *  the themes, and choosing one runs it. One level; a page never opens a page. */
export interface CommandPage {
  title: string;
  commands: readonly Command[];
}

export interface Command {
  /** Unique across the registry (`command-registry.test.ts`). */
  id: string;
  title: string;
  /** Said beside the title in the palette, and heads its rows in the sheet. */
  group: string;
  /** The shortcut, one entry per key pressed in turn (`['g', 'r']`, `[']']`).
   *  `useShortcuts` binds exactly these, and the sheet lists exactly these, so
   *  a key can never be bound and unlisted or listed and unbound. */
  keys?: readonly string[];
  /** Offered only when true. Absent means always. */
  when?: (ctx: CommandContext) => boolean;
  /** Do it, or answer the page it opens. */
  run: (ctx: CommandContext) => void | CommandPage;
}

/** How well `query` matches `title`, or null for no match. Higher is better.
 *  Case-insensitive. A subsequence (`gta` in "Go to Accounts") matches; a
 *  contiguous run scores above one, a run starting a word above that, and a
 *  run starting the title highest of all — prefix-weighted, so "runs" puts
 *  "Runs board" above "Go to Runs" above "Rerun the suites". */
function score(query: string, title: string): number | null {
  const q = query.toLowerCase();
  const t = title.toLowerCase();
  if (t.startsWith(q)) return 4;
  const at = t.indexOf(q);
  if (at > 0 && /[^a-z0-9]/.test(t[at - 1]!)) return 3;
  // A later occurrence may start a word even when the first does not.
  for (let i = t.indexOf(q, at + 1); i > 0; i = t.indexOf(q, i + 1)) {
    if (/[^a-z0-9]/.test(t[i - 1]!)) return 3;
  }
  if (at >= 0) return 2;
  let j = 0;
  for (const ch of t) if (ch === q[j]) j += 1;
  return j === q.length ? 1 : null;
}

/** The commands that match `query`, best first. Equal scores keep the
 *  registry's order, and an empty query is the whole list as given. */
export function rankCommands(query: string, commands: readonly Command[]): Command[] {
  const q = query.trim();
  if (q === '') return [...commands];
  const scored: { c: Command; s: number; i: number }[] = [];
  commands.forEach((c, i) => {
    const s = score(q, c.title);
    if (s !== null) scored.push({ c, s, i });
  });
  return scored.sort((a, b) => b.s - a.s || a.i - b.i).map((x) => x.c);
}

/** The commands offered in `ctx`: `when` asked of each. */
export function available(commands: readonly Command[], ctx: CommandContext): Command[] {
  return commands.filter((c) => c.when === undefined || c.when(ctx));
}
