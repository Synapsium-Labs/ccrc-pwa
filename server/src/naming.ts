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
 * Lowercase, every non-alphanumeric run to one dash, no leading or trailing
 * dash. `''` when there is nothing alphanumeric to keep — a real answer, not a
 * failure: the two callers treat it differently (`deriveBranch` returns null
 * and makes no call; `deriveWorkspaceSlug` refuses with a named reason).
 *
 * EXTRACTED, NOT COPIED. `slug.ts` needs the identical transformation at a
 * different budget, and a second spelling of it is what
 * `single-definition.test.ts` exists to fail the build over.
 */
export function slugifyWords(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

/**
 * `slug` cut to fit `max`, at a word boundary where there is one, plus whether
 * anything was dropped. `shortened` is the caller's business, not decoration:
 * the PWA tells the operator their name did not fit before they commit to a
 * slug they cannot rename.
 *
 * Two details the naive form gets wrong, both inherited from `deriveBranch`
 * where this logic was first written and measured:
 *   * `slug[max] === '-'` means the cut ALREADY landed on a word boundary, so
 *     there is nothing to drop back over — a blind `lastIndexOf` would throw
 *     the last whole word away.
 *   * no `-` at all in the first `max` characters (one long word) means there
 *     is no boundary to find, and the rule hard-cuts rather than emitting
 *     nothing.
 *
 * The trailing-dash strip is belt-and-braces: `slugifyWords` collapses dash
 * runs, so a cut can only land after a dash when `slug[max] === '-'`, and that
 * arm excludes it already. It is written anyway because the guarantee is what
 * callers depend on, and a future cut rule must not be able to break it
 * silently.
 */
export function fitSlug(slug: string, max: number): { slug: string; shortened: boolean } {
  if (slug.length <= max) return { slug, shortened: false };
  const cut = slug.slice(0, max);
  const kept = slug[max] === '-' ? cut : (() => {
    const at = cut.lastIndexOf('-');
    return at === -1 ? cut : cut.slice(0, at);
  })();
  return { slug: kept.replace(/-+$/, ''), shortened: true };
}

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
  const slug = slugifyWords(title);
  if (slug === '') return null;
  return `ws/${fitSlug(slug, SLUG_MAX).slug}`;
}
