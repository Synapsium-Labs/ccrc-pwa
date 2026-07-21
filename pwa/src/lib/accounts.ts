// Wrapper → jargon-free account label + color-token map. The ONLY place the
// wrapper names are translated for humans (plan: "Move to another account",
// never "swap wrapper"). Color is always a token custom-property NAME —
// components resolve it via var(...) so both themes flow through tokens.css.
const ACCOUNTS: Record<string, { label: string; colorVar: string }> = {
  claude: { label: 'team·max', colorVar: '--acct-claude' },
  claude2: { label: 'alt·max', colorVar: '--acct-claude2' },
  'claude-corp': { label: 'team·shared', colorVar: '--acct-corp' },
  gpt: { label: 'gpt', colorVar: '--acct-gpt' },
};

/** The four accounts in ccd's rotation order — the canonical list for account
 *  pickers. Callers union in any extra wrapper the fleet reports so a server
 *  that grows a fifth account still shows up. */
export const KNOWN_WRAPPERS: readonly string[] = ['claude', 'claude2', 'claude-corp', 'gpt'];

/** Human label for an account, e.g. 'claude2' → 'alt·max'. Unknown wrappers
 *  fall back to the raw name — never hide an account the server reports. */
export function accountLabel(wrapper: string): string {
  return ACCOUNTS[wrapper]?.label ?? wrapper;
}

/** Token custom-property name for the account's chip color, e.g. 'claude' →
 *  '--acct-claude' (tint is `${colorVar}-tint`). Unknown wrappers get neutral
 *  meta-gray ink — never a status hue, so it can't be misread as state. */
export function accountColorVar(wrapper: string): string {
  return ACCOUNTS[wrapper]?.colorVar ?? '--ink-tertiary';
}
