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

// `slugifyWords`/`fitSlug` live in `shared/slug.ts`, not here: the PWA needs
// them too (the sheet previews the slug the server will derive), and a
// server-only copy is exactly the drift `single-definition.test.ts` exists
// to fail the build over. Re-exported so this module's own consumers keep
// finding them one hop from `deriveBranch`.
import { slugifyWords, fitSlug } from '../../shared/slug.js';
export { slugifyWords, fitSlug };

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
  const slug = slugifyWords(title);
  if (slug === '') return null;
  return `ws/${fitSlug(slug, SLUG_MAX).slug}`;
}
