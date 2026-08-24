/**
 * The branch name a workspace takes from the `ai-title` Claude Code already
 * wrote. No model call, no API key, no credits: the name exists and was paid
 * for on the first prompt.
 *
 * The `ws/` namespace is KEPT deliberately. `2026-07-28-ccrc-workspace-
 * lifecycle-design.md:62-64` chose it so a machine-created branch is
 * "namespaced, self-describing, sorts together"; a title-derived `feat/` or
 * `docs/` would need a judgement this has no way to make well and would
 * surrender that property for nothing.
 */

/** The slug budget, EXCLUDING the three characters of `ws/`. */
export const SLUG_MAX = 40;

/**
 * `null` when the title has nothing alphanumeric in it — not an empty string.
 * `ws/${''}` is `ws/`, and ccd's own `_ws_branch_valid` (`ccd/ccd:3063-3071`)
 * DOES refuse a name that starts or ends with a slash, so the box would answer
 * `bad-branch` rather than ever create that ref — but sending the call anyway
 * would still burn the one-attempt-per-(id, derived-branch) retry budget on a
 * name nobody chose, for a title that has nothing to give. A caller that gets
 * `null` makes no call at all, which is the spec's own rule: "a title that
 * slugifies to the empty string ... is not a rename — no call is made."
 *
 * The character class is a subset of what ccd's `_ws_branch_valid`
 * (`ccd/ccd:3063-3071`) permits, on purpose — but this is NOT a second copy of
 * that rule. The rule has one definition, on the box; this only avoids sending
 * names that are certain to be refused, and the verdict still comes back as
 * `bad-branch`.
 */
export function deriveBranch(title: string): string | null {
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  if (slug === '') return null;
  if (slug.length <= SLUG_MAX) return `ws/${slug}`;

  // Cut at SLUG_MAX, then drop back to the last `-` at or before the cut. Two
  // details the naive form gets wrong:
  //   * `slug[SLUG_MAX] === '-'` means the cut ALREADY landed on a word
  //     boundary, so there is nothing to drop back over — a blind
  //     `lastIndexOf` would throw the last whole word away.
  //   * no `-` at all in the first SLUG_MAX characters (one long word) means
  //     there is no boundary to find, and the rule hard-cuts rather than
  //     emitting nothing.
  const cut = slug.slice(0, SLUG_MAX);
  if (slug[SLUG_MAX] === '-') return `ws/${cut}`;
  const at = cut.lastIndexOf('-');
  return `ws/${at === -1 ? cut : cut.slice(0, at)}`;
}
