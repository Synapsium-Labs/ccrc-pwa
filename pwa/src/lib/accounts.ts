// Wrapper → jargon-free account label + color-token map. The ONLY place the
// wrapper names are translated for humans (plan: "Move to another account",
// never "swap wrapper"). Color is always a token custom-property NAME —
// components resolve it via var(...) so both themes flow through tokens.css.
//
// TRANSITIONAL, AND DELETED BY THE NEXT TASK. This used to be a projection of
// `shared/api.ts`'s `ACCOUNTS` literal; Stage 2a Task 6 deleted that literal,
// because the roster is runtime data now (`~/.ccrc/accounts.json`, parsed by
// `shared/roster.ts`) and the server ships it to this app on
// `GET /api/accounts` as `AccountsResponse.roster`. Task 7 of the same plan is
// what threads that wire roster through the store and turns the three
// functions below into lookups against it — at which point `PRODUCTION_ROSTER`
// goes away entirely.
//
// It is a hand-typed copy of roster data in the meantime, which is exactly what
// this stage exists to abolish, so it is worth being precise about why it is
// here rather than one task earlier or later: these functions are SYNCHRONOUS
// and called during render by eight component modules, so they cannot become
// async or roster-parameterised without the store work Task 7 owns — and
// widening `Wrapper` (this task) and reading the roster in the PWA (the next
// one) cannot both be one commit without the compiler going dark across two
// packages at once. Nothing new may be added to it, and no other module may
// import it: it is frozen at the five accounts the deleted `ACCOUNTS` literal
// carried, on purpose, so it can only ever be deleted and never grown.

interface TransitionalAccount {
  label: string;
  colorVar: string;
  homeAble: boolean;
}

const PRODUCTION_ROSTER: Record<string, TransitionalAccount> = {
  claude: { label: 'team·max', colorVar: '--acct-claude', homeAble: true },
  claude2: { label: 'alt·max', colorVar: '--acct-claude2', homeAble: true },
  'claude-corp': { label: 'team·shared', colorVar: '--acct-corp', homeAble: true },
  // Opt-in only: a lane a session reaches solely by being sent there on
  // purpose, never one ccd's `_ws_least_loaded` chooses on its own.
  gpt: { label: 'gpt', colorVar: '--acct-gpt', homeAble: false },
  // `--ink-tertiary` is neutral meta-gray, not a hue: dev0 is a recognised
  // account that has never had a colour of its own assigned. Task 7 gives every
  // account a real hue from the roster and this fallback stops being a colour
  // any account actually renders in.
  'claude-dev0': { label: 'lab·dev0', colorVar: '--ink-tertiary', homeAble: true },
};

/** The accounts a session may call HOME — ccd's `_ws_least_loaded` landing
 *  spots, and the set `homeAbleLabelList` speaks for. */
export const HOME_ABLE_WRAPPERS: readonly string[] =
  Object.keys(PRODUCTION_ROSTER).filter((w) => PRODUCTION_ROSTER[w]!.homeAble);

/** The canonical list for account pickers (`SwapSheet`'s `pickableWrappers`,
 *  `AccountsScreen`'s `rowOrder`). Both callers union in any extra wrapper a
 *  live session actually reports, so a server that knows a 6th account still
 *  shows it — which is what keeps this app usable at all while the roster it
 *  really wants is still on its way (see the file header). */
export const KNOWN_WRAPPERS: readonly string[] = Object.keys(PRODUCTION_ROSTER);

/** Human label for an account, e.g. 'claude2' → 'alt·max'. Unknown wrappers
 *  fall back to the raw name — never hide an account the server reports. */
export function accountLabel(wrapper: string): string {
  return PRODUCTION_ROSTER[wrapper]?.label ?? wrapper;
}

/** "team·max, alt·max and team·shared" — the HOME_ABLE accounts by their
 *  human labels, joined for the one-line "nothing can take a new workspace"
 *  message (AccountsScreen's projection line, ProjectCard's addLabel).
 *
 *  `gpt` is deliberately excluded from `HOME_ABLE_WRAPPERS` (it is
 *  opt-in-only, never a landing spot ccd chooses on its own) and is never
 *  consulted for this fact — even though it renders as an account row on the
 *  very same accounts screen. That is exactly why a "nothing is placeable"
 *  message must name these accounts individually rather than claim "all
 *  accounts": an enabled gpt sitting in the same list would make that claim
 *  false on its face. Same discipline ccd's own placement refusal already
 *  uses (ccd/ccd's `cmd_ws_add`: `claude:disabled claude2:disabled
 *  claude-corp:disabled`, never "all accounts"). */
export function homeAbleLabelList(): string {
  const labels = HOME_ABLE_WRAPPERS.map(accountLabel);
  return labels.length <= 1 ? labels.join('') : `${labels.slice(0, -1).join(', ')} and ${labels.at(-1)}`;
}

/** Token custom-property name for the account's chip color, e.g. 'claude' →
 *  '--acct-claude' (tint is `${colorVar}-tint`). Unknown wrappers get neutral
 *  meta-gray ink — never a status hue, so it can't be misread as state. */
export function accountColorVar(wrapper: string): string {
  return PRODUCTION_ROSTER[wrapper]?.colorVar ?? '--ink-tertiary';
}
