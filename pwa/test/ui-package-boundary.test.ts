// THE PACKAGE BOUNDARY AROUND @ccrc/ui, AS TWO MECHANISMS.
//
// `design-system-boundary.test.ts` guards the boundary in one direction: the
// app may not hand-write a class the design system owns. These two guard the
// other direction — what the design system may reach DOWN into, and what the
// app may reach back IN to.
//
// Both rules already existed as prose. `ui/README.md` says of the two value
// imports below: "cheap to reverse now … expensive once more components follow
// the precedent. Do not treat these two as licence." That sentence is enforced
// by nothing, and a comment is a request where a red suite is a mechanism —
// which is this repo's own doctrine, and the reason the wave-2 button drift
// survived long enough to ship ten unstyled buttons.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { rulesOf, selectorList, subjectCompound, PWA_ROOT } from '../design/audit.mjs';
import { OWNED } from './design-system-boundary.test';

const UI_SRC = path.join(import.meta.dirname, '..', '..', 'ui', 'src');

/* ========================================================================== */
/* GUARD A — what @ccrc/ui may take from shared/                              */
/* ========================================================================== */

/** The two files allowed to import a shared/ VALUE, and nothing else ever.
 *
 *  A `import type` from shared/ is fine and ubiquitous: seven ui components
 *  carry ccrc wire types, `tsconfig.build.json`'s `rootDir: ".."` exists for
 *  exactly that, and a type import vanishes at build so it can create no
 *  runtime dependency. A bare import does not vanish. `dist/shared/*.js` then
 *  lands beside `dist/ui/`, and the /design-sync converter — the one consumer
 *  of that tree — drags update-management logic along with the button.
 *
 *  These two are recorded as reversible debt in `ui/README.md`. The list is
 *  asserted in BOTH directions, so it can neither grow (a third component
 *  following the precedent) nor go stale (one of them reversed and the entry
 *  left behind, which would quietly re-open the door for its replacement). */
const SHARED_VALUE_IMPORT_ALLOWED = ['components/build-line.tsx', 'components/mail-strip.tsx'];

/** The module specifiers in `source` that import a shared/ VALUE.
 *
 *  Three shapes count as type-only and are skipped: `import type { X } from`,
 *  a named list where EVERY specifier carries an inline `type` prefix, and a
 *  side-effect import (no `from`, so nothing is bound). Anything else binds a
 *  runtime name. The match is non-greedy across newlines because the real
 *  offender — `mail-strip.tsx` — spreads its clause over five lines. */
export function sharedValueImports(source: string): string[] {
  const out: string[] = [];
  for (const m of source.matchAll(/\bimport\s+([\s\S]*?)\s*from\s*'([^']+)'/g)) {
    const clause = (m[1] ?? '').trim();
    const spec = m[2] ?? '';
    if (!/(^|\/)\.\.\/shared\//.test(spec) && !spec.startsWith('shared/')) continue;
    if (clause.startsWith('type ')) continue;
    const named = clause.match(/^\{([\s\S]*)\}$/);
    if (named !== null) {
      const parts = (named[1] ?? '').split(',').map((s) => s.trim()).filter((s) => s !== '');
      if (parts.every((p) => p.startsWith('type '))) continue;
    }
    out.push(spec);
  }
  return out;
}

/** Every file tsc actually EMITS for `ui`, which is the set this rule governs.
 *
 *  `tsconfig.build.json` excludes `src/**\/*.stories.tsx`, so a story may
 *  value-import freely and several do — `mail-strip.stories.tsx` needs
 *  `MAIL_GATE_HELD_COUNT` to build a fixture the server would actually send.
 *  Nothing a story imports reaches `dist/`, so nothing a story imports reaches
 *  the converter, which is the whole of what this guard protects. */
function builtUiFiles(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...builtUiFiles(p));
    else if (/\.tsx?$/.test(e.name) && !e.name.endsWith('.stories.tsx')) out.push(p);
  }
  return out;
}

describe('what @ccrc/ui may take from shared/', () => {
  it('only the two recorded files import a shared/ value', () => {
    const holders = builtUiFiles(UI_SRC)
      .filter((f) => sharedValueImports(readFileSync(f, 'utf8')).length > 0)
      .map((f) => path.relative(UI_SRC, f).split(path.sep).join('/'))
      .sort();
    expect(
      holders,
      'import type from shared/, or move the value down into shared/ and let both sides read it',
    ).toEqual(SHARED_VALUE_IMPORT_ALLOWED);
  });

  // Guards the guard. A matcher that silently matches nothing passes this
  // suite vacuously, which is precisely how the button vocabulary drifted.
  it('reds on a value import, in every shape one is written', () => {
    expect(sharedValueImports("import { pendingTag } from '../../../shared/update-arrow';"))
      .toEqual(['../../../shared/update-arrow']);
    expect(sharedValueImports("import {\n  MAIL_GATE_HELD_MS,\n} from '../../../shared/api';"))
      .toEqual(['../../../shared/api']);
    expect(sharedValueImports("import { type MailGate, heldGate } from '../../../shared/api';"))
      .toEqual(['../../../shared/api']);
    expect(sharedValueImports("import api from '../../../shared/api';"))
      .toEqual(['../../../shared/api']);
    expect(sharedValueImports("import * as api from '../../../shared/api';"))
      .toEqual(['../../../shared/api']);
  });

  it('leaves type-only imports alone, which are the sanctioned shape', () => {
    expect(sharedValueImports("import type { MailSummary } from '../../../shared/api';"))
      .toEqual([]);
    expect(sharedValueImports("import { type MailGate, type MailSummary } from '../../../shared/api';"))
      .toEqual([]);
    expect(sharedValueImports("import type {\n  FleetHealth,\n  NodeWire,\n} from '../../../shared/api';"))
      .toEqual([]);
  });

  it('does not fire on this package’s own imports', () => {
    expect(sharedValueImports("import { cn } from '../lib/cn';")).toEqual([]);
    expect(sharedValueImports("import { motion } from 'framer-motion';")).toEqual([]);
    expect(sharedValueImports("import './mail-strip.css';")).toEqual([]);
    // a path that merely CONTAINS the word, which is not the same package
    expect(sharedValueImports("import { x } from '../lib/shared-helpers';")).toEqual([]);
  });
});

/* ========================================================================== */
/* GUARD B — what the app may reach back into                                 */
/* ========================================================================== */

/** Properties an app sheet may set on a class @ccrc/ui owns.
 *
 *  The split is between PLACING a component and REDRESSING one. An app sheet
 *  is the only place that knows a ghost button sits in a two-up action row, or
 *  that a dot is 6px inside a chat meta line — so size, spacing, flow and
 *  position are the call site's business and always were. Appearance is the
 *  component's: a colour, a border, a face or a shadow set from outside is a
 *  second definition of what the thing looks like, living in a sheet the
 *  component's own story never loads. That is how a palette drifts in one
 *  theme only, and the contrast gate cannot see it either, because it reads
 *  the rule it finds and has no opinion about which package should own it.
 *
 *  The remedy for a refused rule is the shape `ui/README.md` already
 *  sanctions: pass a modifier through `className` and let the component
 *  define what the modifier looks like.
 *
 *  Motion is allowed (`transition`, `animation`): `chat.css`'s
 *  `prefers-reduced-motion` block names `.opt` among a dozen app classes to
 *  stop them all at once, and splitting that rule by package would mean two
 *  places to look for "does this honour reduced motion".
 *
 *  Fail-CLOSED by construction: an unlisted property is refused, so a new
 *  appearance property cannot arrive unnoticed. A new LAYOUT property reds
 *  once and is added here, which is the cheap direction to be wrong in. */
const LAYOUT_PROPS = new Set([
  'display', 'position', 'inset', 'top', 'right', 'bottom', 'left', 'z-index',
  'width', 'min-width', 'max-width', 'height', 'min-height', 'max-height',
  'margin', 'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
  'margin-block', 'margin-inline',
  'padding', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
  'padding-block', 'padding-inline',
  'flex', 'flex-grow', 'flex-shrink', 'flex-basis', 'flex-direction', 'flex-wrap',
  'grid-column', 'grid-row', 'grid-area', 'grid-template-columns', 'grid-template-rows',
  'gap', 'row-gap', 'column-gap', 'order', 'box-sizing', 'aspect-ratio',
  'align-items', 'align-self', 'align-content',
  'justify-content', 'justify-self', 'justify-items', 'place-self', 'place-items',
  'overflow', 'overflow-x', 'overflow-y', 'white-space', 'overflow-wrap', 'word-break',
  'transform', 'transform-origin', 'transition', 'animation', 'will-change',
]);

/** The appearance reach-ins that predate this guard, each with its reason.
 *
 *  Asserted in both directions like the import allowlist above: a second
 *  cannot be added silently, and one that is fixed must be removed here or the
 *  census reds as stale.
 *
 *  Down from three. The two chat-banner entries called themselves an UNDO of
 *  the banner's own `color`, and were measured to be undoing nothing: Button's
 *  ghost variant declares `text-ink-primary` ON the button, and an element
 *  that declares its own colour never inherits one. Both deleted with no
 *  visual change — the stale half of this census is what would have caught
 *  them had they been written the other way round. */
const APPEARANCE_CENSUS: Record<string, string> = {
  "fleet.css .acct-list .acct-row[data-disabled='true'] .limit-fill":
    'greys a condemned lane’s gauge: nothing runs there to refresh the statusline, '
    + 'so a frozen crit-red bar reads as live pressure on a row that says expired. '
    + 'The honest fix is a disabled variant on LimitBar, which has three bands and no fourth.',
};

/** Every declared property name in a rule body, custom properties included. */
export function propsOf(body: string): string[] {
  return [...new Set(
    [...body.matchAll(/(?:^|;|\{)\s*(--[a-z-]+|[a-z-]+)\s*:/g)].map((m) => m[1] ?? ''),
  )];
}

/** True when the rule's SUBJECT — its rightmost compound — is a ui-owned class.
 *
 *  The subject is what the rule restyles. `.sheet-panel .proj-ready` has an
 *  owned ANCESTOR and an app subject: that is the app scoping its own class
 *  inside a design-system container, which is ordinary and not this rule's
 *  business. `.chat-meta .dot` is the reverse and is. */
export function reachesIntoUi(selector: string): boolean {
  const subject = subjectCompound(selector);
  return OWNED.some((c) => new RegExp(`\\.${c}(?![\\w-])`).test(subject));
}

const APP_SHEETS = [
  'src/fleet/fleet.css',
  'src/session/chat.css',
  'src/styles/shell.css',
  'src/styles/base.css',
];

/** Every `<sheet> <selector>` in the app that redresses a ui-owned class. */
function appearanceReachIns(): string[] {
  const out: string[] = [];
  for (const rel of APP_SHEETS) {
    for (const r of rulesOf(PWA_ROOT, rel)) {
      for (const one of selectorList(r.selector)) {
        if (!reachesIntoUi(one)) continue;
        const bad = propsOf(r.body).filter((p) => !LAYOUT_PROPS.has(p));
        if (bad.length > 0) out.push(`${r.file} ${one.trim()}`);
      }
    }
  }
  return [...new Set(out)].sort();
}

describe('what the app may reach back into', () => {
  it('no app sheet redresses a ui-owned class outside the recorded census', () => {
    expect(
      appearanceReachIns(),
      'pass a modifier through className and let the component define what it looks like',
    ).toEqual(Object.keys(APPEARANCE_CENSUS).sort());
  });

  it('the census carries no stale entry', () => {
    const live = new Set(appearanceReachIns());
    expect(Object.keys(APPEARANCE_CENSUS).filter((k) => !live.has(k))).toEqual([]);
  });

  // Guards the guard, on both halves: the subject test and the property split.
  it('reads the subject, not the ancestor', () => {
    expect(reachesIntoUi('.chat-meta .dot')).toBe(true);
    expect(reachesIntoUi('.sess-line--active .sess-lamp > .dot')).toBe(true);
    expect(reachesIntoUi('.btn-ghost.settings-move')).toBe(true);
    // an owned ANCESTOR scoping an app class is the app's own business
    expect(reachesIntoUi('.sheet-panel .proj-ready')).toBe(false);
    expect(reachesIntoUi('.opts .opt-inert')).toBe(false);
    // and a substring is not the class
    expect(reachesIntoUi('.chat-dot')).toBe(false);
    expect(reachesIntoUi('.dot-rail')).toBe(false);
  });

  it('refuses appearance and permits placement', () => {
    expect(propsOf('color: red; width: 2px').filter((p) => !LAYOUT_PROPS.has(p)))
      .toEqual(['color']);
    expect(propsOf('background: var(--x)').filter((p) => !LAYOUT_PROPS.has(p)))
      .toEqual(['background']);
    expect(propsOf('border: 1px solid red').filter((p) => !LAYOUT_PROPS.has(p)))
      .toEqual(['border']);
    expect(propsOf('font: 600 12px/1 var(--f)').filter((p) => !LAYOUT_PROPS.has(p)))
      .toEqual(['font']);
    expect(propsOf('flex: none; padding: 0 var(--sp-3); min-height: 44px')
      .filter((p) => !LAYOUT_PROPS.has(p))).toEqual([]);
    expect(propsOf('transition: none').filter((p) => !LAYOUT_PROPS.has(p))).toEqual([]);
  });

  it('sees a custom property, which is how a token override would hide', () => {
    expect(propsOf('--ink-primary: red').filter((p) => !LAYOUT_PROPS.has(p)))
      .toEqual(['--ink-primary']);
  });
});
