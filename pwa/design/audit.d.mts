// Types for design/audit.mjs. The auditor is plain ESM because the GATE has to
// run it with bare `node design/contrast-check.mjs`, with no build step and no
// loader — so the types live beside it rather than in it.
//
// This file is a hand-written surface and therefore a drift risk of exactly
// the kind the auditor exists to close, so it is kept deliberately small and
// the suite checks the shape at RUNTIME: contrast.test.ts asserts the exact
// key set of the report and of every registry, which fails if the
// implementation and this declaration disagree about anything the tests touch.

export type RGBA = [number, number, number, number];
export type Theme = Record<string, string>;

export interface Themes {
  DARK: Theme;
  LIGHT: Theme;
}

export interface Rule {
  file: string;
  selector: string;
  body: string;
}

export interface MeasuredPair {
  /** "LIGHT chat.css .pr-body-preview" — theme first, then the rule. */
  label: string;
  ratio: number;
  floor: number;
  ok: boolean;
  /** "var(--ink-on-well) on var(--bg-well)" */
  detail: string;
}

export interface KeyframeTrough {
  file: string;
  name: string;
  /** The lowest opacity any stop sets, or null if a stop is not a literal. */
  min: number | null;
  /** "chat.css working-dot 0.25" */
  key: string;
}

export interface StaleEntries {
  grounds: string[];
  exempt: string[];
  inherited: string[];
  opacity: string[];
  keyframes: string[];
}

export interface AuditCounts {
  rules: number;
  selfGrounded: number;
  selfGroundedContexts: number;
  pseudo: number;
  /** Rules grounded on a self-grounded ancestor their own selector names. */
  descendant: number;
  inherited: number;
  faded: number;
  keyframes: number;
  /** Rules that set a colour whose ground no route could recover. */
  uncovered: number;
}

export interface AuditReport {
  sheets: string[];
  themes: Themes;
  measured: MeasuredPair[];
  /** Structural defects: unregistered fades, unparsed colours, stale entries. */
  problems: string[];
  stale: StaleEntries;
  /** The auditor's own blind spot, enumerated: `file selector` for every rule
   *  that sets a colour and whose ground is not recoverable from the
   *  stylesheets. Not failures — the honest limit of a parser without a DOM. */
  uncovered: string[];
  counts: AuditCounts;
  fades: { key: string; value: number }[];
  troughs: KeyframeTrough[];
}

export interface Ground {
  under: readonly string[];
  floor?: number;
  why: string;
}

export type OpacityEntry =
  | { noText: string }
  | { pairs: readonly (readonly [string, string, readonly string[], number])[] };

export const PWA_ROOT: string;
export const GROUNDS: Record<string, Ground>;
export const SELF_GROUNDED_EXEMPT: Record<string, string>;
export const INHERITED_GROUNDS: Record<string, Ground>;
export const OPACITY_REGISTRY: Record<string, OpacityEntry>;
export const KEYFRAME_TROUGHS: Record<string, string>;

export function stylesheets(root?: string): string[];
export function loadThemes(root?: string): Themes;
export function blockBody(src: string, open: string): string;
export function resolveColor(expr: string, theme: Theme, depth?: number): RGBA;
export function over(fg: RGBA, bg: RGBA): RGBA;
export function contrast(a: RGBA, b: RGBA): number;
export function ratio(
  fgExpr: string,
  bgChain: readonly string[],
  theme: Theme,
  opacity?: number,
): number;
export function selectorList(sel: string): string[];
/** The compounds of one complex selector, ancestors first, subject last. */
export function compoundChain(sel: string): string[];
export function subjectCompound(sel: string): string;
/** The compound qualifiers `sel` adds to `base`'s subject element, `''` if it
 *  restates the same subject under a different ancestor chain, or null if it
 *  is not a variant of `base` at all. */
export function variantSuffix(sel: string, base: string): string | null;
export function rulesOf(root: string, rel: string): Rule[];
export function ruleKey(r: Rule): string;
/** The value of a rule's LAST declaration of `prop` — the value the browser
 *  paints — or null if it declares none. */
export function declOf(body: string, prop: string): string | null;
/** The last of `background` / `background-color` in source order: the two
 *  write the same cascaded value, so neither one is a fallback for the other. */
export function bgOf(body: string): string | null;
/** The background IMAGE a rule paints — the `background-image` longhand or an
 *  image function inside the `background` shorthand — or null. An image cannot
 *  be reduced to one colour, so a non-null answer is a gate FAILURE, not a
 *  measurement: `bgOf` alone used to skip such a rule in silence. */
export function bgImageOf(body: string): string | null;
/** What a rule paints its own element with. `paints` is false only when the
 *  rule supplies no ground at all and the audit must look elsewhere for one. */
export function paintOf(body: string): {
  colour: string | null;
  image: string | null;
  paints: boolean;
};
export function opacityNumber(raw: string): number | null;
export function keyframeTroughs(root?: string): KeyframeTrough[];
export function audit(root?: string): AuditReport;
