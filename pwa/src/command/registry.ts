// The command registry (D-5103): what a command is, and how a query ranks
// them. Pure: no store, no DOM. Both skins reach the same registry (the ⌘K
// palette in each, and Instrument's top-bar field in W2), so a command added
// here is in every skin, the palette and the shortcut sheet at once.
import type { FleetSession, RunSummary } from '../../../shared/api';

/** Instrument's command field's words and accessible name (`TopBar.tsx`). The palette's words live here, beside what
 *  a command is, so the field and the palette say them from one home. */
export const COMMAND_FIELD_WORDS = 'Search or run a command';

/** What the palette's first level says when neither a command nor a session matches. */
export const SEARCH_EMPTY = 'No session or command matches.';

/** The fewest characters of a trimmed query that may find a search-only entry (a session at the first level, D-6714). */
export const SEARCH_MIN = 2;

/** What a command may read and do. Built by `CommandLayer` per run, so a
 *  command never holds a stale store snapshot. */
export interface CommandContext {
  /** The path in force, `/s/<id>` on a session. */
  path: string;
  /** The fleet in the fleet screen's own order (`fleetOrder`). */
  sessions: readonly FleetSession[];
  /** The open runs (the store's runs frame), so a session's entry can name the programmes it coordinates (D-6714). */
  runs: readonly RunSummary[];
  navigate: (href: string) => void;
  setSkin: (choice: string) => void;
  setTheme: (choice: string) => void;
  openShortcuts: () => void;
  /** The fleet flows' New session sheet (`useFleetFlows().openNewSession`, D-5468). */
  openNewSession: () => void;
  openPalette: () => void;
  /** The palette is showing: a command that opens it is not offered inside it. */
  paletteOpen: boolean;
  /** The session screen's flows (`SessionFlows`, W2 Task S2d), while one is mounted: null elsewhere, so a session
   *  command is offered only on a session route. */
  session: SessionCommandTarget | null;
  /** The inspector rail's flip (`InspectorRail`, desktop polish T3e, D-6385), while a part places one: null elsewhere,
   *  so its command is offered only where there is a rail to show or hide. */
  inspector: InspectorCommandTarget | null;
}

/** What a session command reaches (D-5466): the open session's flows, which say whether an item is offered (its
 *  gate, the ⋯ menu's own) and run it. One answer for the menu, the palette and every door. */
export interface SessionCommandTarget {
  offers: (id: string) => boolean;
  run: (id: string) => void;
}

/** What the inspector command reaches: whether the rail is shown now, and the one flip that shows or hides it. */
export interface InspectorCommandTarget {
  shown: boolean;
  toggle: () => void;
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
  /** More words it is found by, each scored as the title is: the best of the title and these counts (D-6714). */
  terms?: readonly string[];
  /** Among entries of equal score, a lower tier ranks first. Absent on a command, so commands keep their order. */
  tier?: number;
  /** Found only by a search: never in the empty list, only by a trimmed query of `SEARCH_MIN` characters or more and
   *  a contiguous match, and ranked after every entry that is not search-only (a session at the first level). */
  searchOnly?: boolean;
  /** The option's exact accessible name, when its title and group would not say it (D-6714). */
  label?: string;
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

/** The lowest score that is a contiguous run of the query (a substring), not a scattered subsequence. */
const CONTIGUOUS = 2;

/** An entry's score: the best `score` of its title and each of its terms, or null when none matches. */
function bestScore(query: string, c: Command): number | null {
  let best = score(query, c.title);
  for (const term of c.terms ?? []) {
    const s = score(query, term);
    if (s !== null && (best === null || s > best)) best = s;
  }
  return best;
}

/** The entries that match `query`, best first (D-6714): every entry that is not search-only before every search-only
 *  one, then by score, then by tier (lower first), then in the order given. A command carries no tier and is never
 *  search-only, so the commands rank as they always did. An empty query is the list as given, less the search-only
 *  entries, and a search-only entry needs `SEARCH_MIN` characters and a contiguous match. */
export function rankCommands(query: string, commands: readonly Command[]): Command[] {
  const q = query.trim();
  if (q === '') return commands.filter((c) => c.searchOnly !== true);
  const scored: { c: Command; s: number; i: number; late: number; tier: number }[] = [];
  commands.forEach((c, i) => {
    const s = bestScore(q, c);
    if (s === null) return;
    const late = c.searchOnly === true;
    if (late && (q.length < SEARCH_MIN || s < CONTIGUOUS)) return;
    scored.push({ c, s, i, late: late ? 1 : 0, tier: c.tier ?? 0 });
  });
  return scored.sort((a, b) => a.late - b.late || b.s - a.s || a.tier - b.tier || a.i - b.i).map((x) => x.c);
}

/** The commands offered in `ctx`: `when` asked of each. */
export function available(commands: readonly Command[], ctx: CommandContext): Command[] {
  return commands.filter((c) => c.when === undefined || c.when(ctx));
}
