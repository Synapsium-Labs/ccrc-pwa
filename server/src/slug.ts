/**
 * The workspace name an operator types, or the Linear ticket they paste.
 *
 * L1 POLICY. This decides; it does not read a file, build an argv, or answer a
 * request. `naming.ts` is its only import (for the shared slugifier), the route
 * maps its verdict to a status, and the PWA imports the same function to render
 * the preview — so the client can never disagree with the server about what a
 * name becomes.
 *
 * THE BUDGET IS 31, AND IT IS NOT `naming.ts`'s 40. That one is the BRANCH
 * budget, validated on the box by `_ws_branch_valid` (`ccd/ccd:3063-3071`); this
 * one is the SLUG budget, validated by `_ws_slug_valid` (`ccd/ccd:3403`), a
 * different and stricter rule. Reusing 40 here ships names ccd refuses at
 * `ccd/ccd:3742`, before a worktree, a branch or a registry row exists.
 * `slug.test.ts` reads ccd's own regex out of the shipped file and pins every
 * slug we generate against it, so a change to that grammar reds this suite
 * instead of reaching the fleet.
 *
 * WHY A SUBSET OF ccd's RULE, DELIBERATELY. ccd's regex also accepts a TRAILING
 * dash (`ab-` passes) and this never emits one; and ccd's floor of two
 * characters is an accident of `{1,30}` applying to the second character class,
 * undocumented and untested there (D-1127). This is not a second authority —
 * the verdict still comes from the box — it only avoids sending names that are
 * certain to be refused, and writes ccd's undocumented floor down.
 */
import { slugifyWords, fitSlug } from './naming.js';

/** ccd's `_ws_slug_valid` upper bound (`ccd/ccd:3403`), total characters. */
export const WS_SLUG_MAX = 31;
/** ccd's floor, written down for the first time — see D-1127. */
export const WS_SLUG_MIN = 2;

/**
 * A Linear issue reference. `key`/`num` keep the operator's own casing because
 * the DISPLAY title shows `ENG-1234`, uppercase, while the slug lowercases —
 * two different jobs for one parse, and folding case here would lose the half
 * the board needs.
 */
export interface LinearRef {
  key: string;
  num: string;
  /** The title slug Linear puts in the canonical URL, when one is present. */
  titleSlug: string | null;
}

/**
 * `<TEAM_KEY>-<number>`. The `{0,9}` on the key is a deliberately generous
 * bound rather than a known ceiling: Linear's UI nudges toward 2-5 characters
 * and this repo has no Linear integration to measure against. Guessing wide
 * fails toward "treat it as a ticket"; guessing narrow would silently demote a
 * real ticket to a plain name, which is the worse direction — a plain name
 * still works, but it loses the API lookup and the `[TICKET] - title` display.
 */
const IDENTIFIER = /^([A-Za-z][A-Za-z0-9]{0,9})-([0-9]{1,7})$/;

/** Linear's own host, and any subdomain of it. */
const isLinearHost = (host: string): boolean =>
  host === 'linear.app' || host.endsWith('.linear.app');

/**
 * A Linear reference, or `null` for "this is not one". `null` here is NOT an
 * overloaded failure: the caller distinguishes "not a ticket" (a plain name,
 * which is fine) from "a URL I could not read" (a refusal) by whether the input
 * was a URL at all — `deriveWorkspaceSlug` below is where that split lives,
 * because it is the one that has to answer the operator.
 */
export function parseLinearRef(input: string): LinearRef | null {
  const trimmed = input.trim();
  if (trimmed === '') return null;

  if (trimmed.includes('://')) {
    let url: URL;
    try {
      url = new URL(trimmed);
    } catch {
      return null;
    }
    if (!isLinearHost(url.hostname.toLowerCase())) return null;
    const segs = url.pathname.split('/').filter((s) => s !== '');
    const at = segs.findIndex((s) => s.toLowerCase() === 'issue');
    if (at === -1) return null;
    const m = IDENTIFIER.exec(segs[at + 1] ?? '');
    if (m === null) return null;
    const tail = segs[at + 2];
    return {
      key: m[1],
      num: m[2],
      titleSlug: tail === undefined || slugifyWords(tail) === '' ? null : tail,
    };
  }

  const m = IDENTIFIER.exec(trimmed);
  return m === null ? null : { key: m[1], num: m[2], titleSlug: null };
}

/**
 * Why a name could not be used. THREE CONDITIONS, NEVER ONE BOOLEAN: "you
 * typed nothing usable", "you typed one character" and "that URL has no issue
 * id in it" are three different things for the operator to do next, and
 * collapsing them is the overloaded null CLAUDE.md forbids at a seam.
 * `slug.test.ts` asserts each reason separately, so the collapse cannot ship
 * behind a green suite.
 */
export const NAME_REFUSAL_TEXT = {
  'no-usable-characters': 'That has no letters or numbers in it.',
  'too-short': 'A name needs at least two characters.',
  'url-not-recognised': "That link isn't a Linear issue — paste the issue URL, or type a name.",
} as const;

export type NameRefusal = keyof typeof NAME_REFUSAL_TEXT;

/**
 * The runtime list, DERIVED from the table rather than hand-kept beside it —
 * `PR_REASONS`' own idiom (`shared/api.ts`). A fourth reason cannot ship
 * without its sentence.
 */
export const NAME_REFUSALS = Object.keys(NAME_REFUSAL_TEXT) as NameRefusal[];

/**
 * What the operator asked for.
 *
 * `auto` is a REQUEST, not an absence: an empty field means "draw me one", and
 * the route must then omit the argv token entirely rather than send `''`.
 * `['ws-add','demo','']` reaches ccd, fails `[[ -n "$slug" ]]`, passes
 * `[[ -z "$slug" ]]` (`ccd/ccd:3742-3746`), draws a random adjective-noun and
 * exits 0 — so the route would answer 200 for a workspace nobody named.
 */
export type SlugAsk =
  | { kind: 'auto' }
  | { kind: 'named'; slug: string; shortened: boolean; ticket: LinearRef | null }
  | { kind: 'refused'; reason: NameRefusal };

export function deriveWorkspaceSlug(input: string): SlugAsk {
  const trimmed = input.trim();
  if (trimmed === '') return { kind: 'auto' };

  // A URL is a CLAIM about where the work is described. If we cannot read it we
  // say so, rather than slugifying it into `https-github-com-x-y-issues-3` —
  // a legal slug and a terrible name.
  const isUrl = trimmed.includes('://');
  const ticket = parseLinearRef(trimmed);
  if (isUrl && ticket === null) return { kind: 'refused', reason: 'url-not-recognised' };

  let candidate: string;
  if (ticket !== null) {
    const base = `${ticket.key.toLowerCase()}-${ticket.num}`;
    candidate = ticket.titleSlug === null ? base : `${base}-${slugifyWords(ticket.titleSlug)}`;
  } else {
    // Linear's copy-branch-name form is `<user>/<key>-<n>-<title>`. Taking the
    // TAIL rather than mapping `/`→`-` is the difference between
    // `eng-1234-fix-login` and `maciek-eng-1234-fix-login`, which spends 7 of
    // 31 characters on somebody's name. Only when the tail still has something
    // in it — otherwise fall back to the whole string and let the refusal
    // arms below name what is wrong.
    const at = trimmed.lastIndexOf('/');
    const tail = at === -1 ? trimmed : trimmed.slice(at + 1);
    candidate = slugifyWords(slugifyWords(tail) === '' ? trimmed : tail);
  }

  if (candidate === '') return { kind: 'refused', reason: 'no-usable-characters' };

  // Fit BEFORE the floor check: a 1-character result can only come from a
  // 1-character candidate (the cut never produces a shorter legal name than
  // its own word boundary), but ordering it this way means the floor is the
  // last word on what ships, whatever a future cut rule does.
  const fitted = fitSlug(candidate, WS_SLUG_MAX);
  if (fitted.slug.length < WS_SLUG_MIN) return { kind: 'refused', reason: 'too-short' };

  return { kind: 'named', slug: fitted.slug, shortened: fitted.shortened, ticket };
}
