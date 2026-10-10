// Two app rules that say the same thing are a component that has not been
// written yet — and this is the census that will not let a third appear.
//
// WHY THIS EXISTS. Every design-system wave so far found its duplicates by
// READING: `.accounts-door`/`.settings-door` byte-identical, `.btn-primary`
// written out at 54 call sites, three copies of ten declarations behind
// `TextInput`, five copies of eleven behind the quiet control. Each was found
// by a person noticing, and the stylesheet usually said so itself in a comment
// — "Same self-grounded pair as `.coord-toggle` … not reinvented" — which is a
// request that the next copy also be a copy, not a mechanism that stops one.
//
// The fifth copy of the quiet control proved the point. `.program-start-go`
// carried the same eleven declarations in the same file as the four being
// folded, and nobody had connected it to them; a census written for the four
// came back red naming it. That is the whole argument for this file: the
// reading does not scale, and the stylesheet is 5.3k lines.
//
// WHAT IT DOES. It clusters every app rule of four declarations or more by
// what it DECLARES — property and value, normalised and sorted — and calls two
// rules the same shape when they agree on 72% of their declarations. Every
// cluster it finds must be REGISTERED below with a reason, or this reds. The
// registry is checked in both directions, so an entry whose cluster has been
// migrated away is stale and reds too: a list of excuses nobody can delete is
// how a census rots.
//
// 72% IS MEASURED, NOT CHOSEN. At 0.80 the four quiet-control rules still
// cluster but `.program-start-door` (one font size apart) splits off, which is
// precisely the copy a reader would miss. At 0.65 it starts pairing rules that
// merely share a flex idiom — `.chat-meta` with `.update-banner-actions` — and
// the registry fills with noise that teaches nobody anything. 0.72 is the
// window where a cluster means "one shape, written twice".
//
// WHAT IT IS NOT. It is not a style linter and it has no opinion about
// whether a cluster SHOULD be a component. Several below should not be: two
// rules can share declarations and mean different things, and the registry is
// where that gets argued once instead of rediscovered every wave. What it
// refuses is the silent third copy.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const read = (...seg: string[]): string =>
  readFileSync(path.join(import.meta.dirname, '..', 'src', ...seg), 'utf8');

/** The app's own stylesheets. `@ccrc/ui`'s are deliberately out of scope: a
 *  duplicate THERE is a duplicate inside one package, which its own reviews
 *  see, and the drift this guard exists for is the app re-inventing what the
 *  design system already has. */
const SHEETS: [string, string][] = [
  ['fleet.css', read('fleet', 'fleet.css')],
  ['chat.css', read('session', 'chat.css')],
  ['shell.css', read('styles', 'shell.css')],
  ['base.css', read('styles', 'base.css')],
];

interface Rule { sheet: string; sel: string; decls: string[] }

/** Top-level rules only, comments stripped. A nested at-rule's body is skipped
 *  by construction: this matches `selector { … }` with no braces inside, so a
 *  `@media` wrapper never becomes a "rule" and its children are matched on
 *  their own — which is what we want, since a media query's override is a
 *  fragment, not a shape. */
function rules(): Rule[] {
  const out: Rule[] = [];
  for (const [sheet, src] of SHEETS) {
    const clean = src.replace(/\/\*[\s\S]*?\*\//g, '');
    for (const m of clean.matchAll(/([^{}@]+)\{([^{}]*)\}/g)) {
      const sel = (m[1] ?? '').trim().replace(/\s+/g, ' ');
      if (sel === '' || sel.startsWith('@')) continue;
      const decls = (m[2] ?? '')
        .split(';')
        .map((d) => d.trim().replace(/\s+/g, ' '))
        .filter((d) => d !== '')
        .sort();
      // Four is the floor. Below it a "shape" is a couple of declarations that
      // any two rules might share by accident — `display: flex; gap: …` is an
      // idiom, not a component.
      if (decls.length >= 4) out.push({ sheet, sel, decls });
    }
  }
  return out.sort((a, b) => (a.sheet + a.sel < b.sheet + b.sel ? -1 : 1));
}

const SAME = 0.72;

function jaccard(a: string[], b: string[]): number {
  const A = new Set(a);
  const B = new Set(b);
  let both = 0;
  for (const x of A) if (B.has(x)) both += 1;
  return both / (A.size + B.size - both);
}

/** Greedy clustering against a seed, in a stable order — the first rule in
 *  sheet/selector order seeds, and everything close to IT joins. Not
 *  transitive on purpose: A-B close and B-C close does not make A-C one
 *  shape, and a transitive walk would chain unrelated rules into one giant
 *  cluster the moment a bridging rule appeared. */
function clusters(): Rule[][] {
  const all = rules();
  const taken = new Set<number>();
  const out: Rule[][] = [];
  for (let i = 0; i < all.length; i += 1) {
    if (taken.has(i)) continue;
    const seed = all[i];
    if (seed === undefined) continue;
    const group = [seed];
    taken.add(i);
    for (let j = i + 1; j < all.length; j += 1) {
      const other = all[j];
      if (taken.has(j) || other === undefined) continue;
      if (jaccard(seed.decls, other.decls) >= SAME) {
        group.push(other);
        taken.add(j);
      }
    }
    if (group.length >= 2) out.push(group);
  }
  return out;
}

/** A cluster's identity: its members, named. Stable across edits that do not
 *  change WHICH rules are the same shape — so tuning a value inside one of
 *  them does not churn this file. */
const keyOf = (g: Rule[]): string =>
  g.map((r) => `${r.sheet} ${r.sel}`).sort().join(' + ');

/** EVERY duplicated shape in the app, with the reason it is still two rules.
 *
 *  An entry here is a decision, not an exemption: either these rules mean
 *  different things and always will, or this is the next migration and the
 *  reason says what is blocking it. Adding a line is cheap and that is fine —
 *  what it is not is silent. */
const REGISTERED: Record<string, string> = {
  // ── NEXT: one shape, written twice, and nothing stopping the fold ───────
  'chat.css .dlg-later + chat.css .draft-cancel':
    'NEXT. The quiet way out of a sheet — transparent, ink-secondary, UI type '
    + 'at the tap floor, with a colour transition. Seven declarations twice. A '
    + '`Button` tone, not a new component; see the quiet variant for the shape '
    + 'of that argument.',
  'chat.css .menu-item + fleet.css .acct-list .acct-row':
    'NEXT, and the biggest left: FOURTEEN declarations, identical, in two '
    + 'different stylesheets. A pressable list row with a bottom hairline. '
    + 'Living in two files is how it escaped every wave that read one.',
  'chat.css .pr-title-input + fleet.css .pool-new-input':
    'NEXT, and it needs no new component: `TextInput` already ships this exact '
    + 'shape and exports `TEXT_INPUT`. Two call sites that never migrated — '
    + 'the cheapest eight declarations in this registry.',
  'fleet.css .bucket-head-unseen + fleet.css .mail-badge-count':
    'NEXT. A count pill in attention ink, six declarations twice. '
    + '`.settings-badge` is a third carrier of the same idea in a quieter '
    + 'tone, so the fold is a `CountBadge` with a tone axis, not a copy.',
  'fleet.css .caps-control .caps-note + fleet.css .coord-banner .coord-error':
    'NEXT, and it belongs to a component that already exists: both are the '
    + 'note that wraps to its own line INSIDE a `<ControlRow>` — '
    + '`flex-basis: 100%`, no margin, `--fs-2xs`, dead ink. A slot on the row, '
    + 'not a component of its own.',
  'fleet.css .fleet-archived-row + fleet.css .fleet-runs-row':
    'NEXT. Two full-width bare row buttons, ten declarations each, identical: '
    + 'no chrome, left-aligned, mono, at the tap floor. One shape with the '
    + 'pair below it.',
  'fleet.css .proj-archived-toggle + fleet.css .proj-released-toggle':
    'NEXT, with the pair above. The same bare row button one font step down '
    + 'with a flex gap — thirteen declarations twice. Four rules, two shapes, '
    + 'one component.',
  'chat.css .reap-ignored + chat.css .reap-size + fleet.css .hotfiles-path':
    'NEXT. A path that may be long: block, mono at `--fs-xs`, secondary ink, '
    + '`word-break: break-word`. THREE copies across two stylesheets, which is '
    + 'one more than it takes to call something a shape.',
  'chat.css .chat-banner--offline::before + fleet.css .offline-banner::before':
    'NEXT, and the pseudo-element is the tell: two offline strips each draw '
    + 'their own 6px attention dot the same way. banner.tsx already names the '
    + 'strip as the thing that "stays its own rule until it earns a component" '
    + '— two copies of its dot is it earning one.',
  'shell.css .block-screen + shell.css .login-screen':
    'NEXT. Two full-viewport covers, twelve declarations each, both at '
    + '`--z-block`. One `CoverScreen` — and the shared z-index is deliberate, '
    + 'not drift: shell.css argues that at equal z the block screen paints on '
    + 'top, which is the right order.',

  // ── DIFFERENT THINGS: these rules agree and will keep agreeing ──────────
  ['chat.css .chat-meta + fleet.css .settings-node-actions '
    + '+ fleet.css .settings-release-actions + fleet.css .update-banner-actions']:
    'DIFFERENT THINGS. Five declarations — flex, centred, wrapping, one gap '
    + 'token, one row-gap — which is the most common five in the tree. This is '
    + 'a utility that these elements write as a rule because they already have '
    + 'classes for other reasons.',
  'chat.css .compaction--sys .compaction-label + fleet.css .sess-subagent-name':
    'DIFFERENT THINGS. Four declarations that spell `truncate`: min-width 0, '
    + 'hidden, ellipsis, nowrap. A component here would be a `<span>` with a '
    + 'utility on it.',
  'chat.css .dlg-copy + chat.css .draft-copy':
    'DIFFERENT THINGS. Four declarations, all of them the type ramp — base '
    + 'size, normal leading, secondary ink, one margin. The repetition is the '
    + 'TOKENS working, not a shape waiting to be named.',
  'fleet.css .abandon-sheet, .archive-conflict-sheet + fleet.css .update-move-sheet':
    'DIFFERENT THINGS. Three sheet BODIES sharing a grid and a padding. '
    + '`Sheet` already owns the panel around them; this is the content box '
    + 'inside it, and a component for it would be a div.',
  'fleet.css .accounts-row + fleet.css .auth-block':
    'DIFFERENT THINGS. A settings row and the passkey block share a card '
    + 'idiom — surface, hairline, r-md, a 4px grid gap — and nothing else. '
    + 'Folding them means a component whose only content is padding.',
  'fleet.css .acct-none + fleet.css .proj-none, .proj-error':
    'DIFFERENT THINGS. Two empty-state paragraphs agreeing on the type ramp '
    + 'and a padding. The sentence is the whole of each one; there is no shape '
    + 'under it to extract.',
  ['fleet.css .child-reclaim-banner .child-reclaim-item + fleet.css .settings-node-head '
    + '+ fleet.css .settings-release-head']:
    'DIFFERENT THINGS. Four declarations of wrapping flex with a min-width '
    + 'floor — the same idiom as the actions rows above, in a different part '
    + 'of the tree.',
  'fleet.css .proj-abroad + fleet.css .proj-elsewhere':
    'DIFFERENT THINGS, one divider idiom: a hairline above a stacked list. '
    + 'Six declarations of pure layout with no appearance beyond the border. '
    + 'A component here would carry nothing.',
  'fleet.css .proj-abroad-line + fleet.css .proj-crossing':
    'DIFFERENT THINGS. Two inline meta lines in tertiary ink at `--fs-2xs`, '
    + 'inside the same card, saying different things about a project. Six '
    + 'declarations, all of them the ramp.',
  'fleet.css .proj-dir + fleet.css .sheet-panel .proj-ready-why':
    'DIFFERENT THINGS. Both sit in column 2 of a grid in mono `--fs-2xs`; the '
    + 'overlap is that grid and that ramp, and neither is a shape either one '
    + 'owns.',
  ['fleet.css .run-row .run-child-reclaim + fleet.css .run-row .run-crossing '
    + '+ fleet.css .run-row .run-dispatch + fleet.css .run-row .run-kind']:
    'DIFFERENT THINGS, and one row\'s own vocabulary: four inline meta slots '
    + 'that agree because they are siblings in one component. The fix for '
    + 'these, if any, is `.run-row > *` — not a shared component. `.run-row` '
    + 'is itself a block no wave has reached.',
  ['fleet.css .sess-acct + fleet.css .sess-held, .sess-lifecycle, .sess-swapblocked, '
    + '.sess-ask-state + fleet.css .sess-stranded']:
    'DIFFERENT THINGS. Mono plus the same four-declaration truncation as the '
    + 'pair above, on three slots of the session line. Siblings in one '
    + 'component, again.',
  ['fleet.css .settings-nodes + fleet.css .settings-releases '
    + '+ fleet.css .update-move-sheet .update-move-list']:
    'DIFFERENT THINGS. Four declarations that spell "a list with no bullets": '
    + 'grid, none, 0, 0. Three lists of three different things.',
};

describe('every duplicated shape in the app stylesheets is registered', () => {
  const found = clusters();

  it('found clusters to judge — the census is not vacuously empty', () => {
    // Without this it passes by finding nothing, which is how a census dies:
    // a parser change stops matching rules and the guard goes quiet rather
    // than red. Measured 14 clusters over 5,459 lines of app CSS today.
    expect(found.length).toBeGreaterThanOrEqual(10);
    expect(found.flat().length).toBeGreaterThanOrEqual(25);
  });

  it('names no shape this registry has not seen', () => {
    const unregistered = found.map(keyOf).filter((k) => REGISTERED[k] === undefined);
    expect(unregistered).toEqual([]);
  });

  it('carries no stale entry — a migrated shape leaves this file', () => {
    const live = new Set(found.map(keyOf));
    expect(Object.keys(REGISTERED).filter((k) => !live.has(k))).toEqual([]);
  });

  it('gives every entry a reason that says which kind it is', () => {
    // Two verdicts and no third: this is the next migration, or these rules
    // mean different things. "Leave it for now" is not a verdict.
    for (const [k, why] of Object.entries(REGISTERED)) {
      expect(why.startsWith('NEXT') || why.startsWith('DIFFERENT THINGS'), k).toBe(true);
      expect(why.length, k).toBeGreaterThan(60);
    }
  });
});
