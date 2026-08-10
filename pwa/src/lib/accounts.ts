import { ACCOUNTS, HOME_ABLE_WRAPPERS, KNOWN_WRAPPERS, isWrapper } from '../../../shared/api';

// Wrapper → jargon-free account label + color-token map — a PROJECTION of
// `shared/api.ts`'s `ACCOUNTS` roster (the account/wrapper concept's one
// home; see its own docstring for why this used to be a second, hand-typed
// copy of the same four-then-five accounts). The ONLY place the wrapper
// names are translated for humans (plan: "Move to another account", never
// "swap wrapper"). Color is always a token custom-property NAME —
// components resolve it via var(...) so both themes flow through tokens.css.

/** `HOME_ABLE_WRAPPERS` and `KNOWN_WRAPPERS` (`shared/api.ts`) re-exported
 *  here — this module used to hand-maintain its own copy of both. */
export { HOME_ABLE_WRAPPERS, KNOWN_WRAPPERS };

/** Human label for an account, e.g. 'claude2' → 'alt·max'. Unknown wrappers
 *  fall back to the raw name — never hide an account the server reports. */
export function accountLabel(wrapper: string): string {
  return isWrapper(wrapper) ? ACCOUNTS[wrapper].label : wrapper;
}

/** "team·max, alt·max and team·shared" — the HOME_ABLE accounts by their
 *  human labels, joined for the one-line "nothing can take a new workspace"
 *  message (AccountsScreen's projection line, ProjectCard's addLabel).
 *
 *  `gpt` is deliberately excluded from `HOME_ABLE_WRAPPERS` (it is
 *  opt-in-only, never a landing spot ccd chooses on its own) and is never
 *  consulted for this fact — even though it renders as an account row on the
 *  very same accounts screen. That is exactly why a "nothing is placeable"
 *  message must name these three individually rather than claim "all
 *  accounts": an enabled gpt sitting in the same list would make that claim
 *  false on its face. Same discipline ccd's own placement refusal already
 *  uses (ccd/ccd ~1041-1049: `claude:disabled claude2:disabled
 *  claude-corp:disabled`, never "all accounts"). */
export function homeAbleLabelList(): string {
  const labels = HOME_ABLE_WRAPPERS.map(accountLabel);
  return labels.length <= 1 ? labels.join('') : `${labels.slice(0, -1).join(', ')} and ${labels.at(-1)}`;
}

/** Token custom-property name for the account's chip color, e.g. 'claude' →
 *  '--acct-claude' (tint is `${colorVar}-tint`). Unknown wrappers get neutral
 *  meta-gray ink — never a status hue, so it can't be misread as state.
 *  `claude-dev0` is "known" (it is in `ACCOUNTS`) but has no hue of its own
 *  assigned yet, so its roster entry points at this same fallback token — see
 *  `ACCOUNTS['claude-dev0']`'s own comment. */
export function accountColorVar(wrapper: string): string {
  return isWrapper(wrapper) ? ACCOUNTS[wrapper].colorVar : '--ink-tertiary';
}
