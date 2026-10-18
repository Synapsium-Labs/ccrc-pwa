// THE ROLE CENSUS (D-5093, Task 14): the shared primitives read the skin's
// type and density roles, and they move no pixel in Refined doing it.
//
// Until a component reads a role, Instrument's density and type reach nothing
// (spec §2 item 9, §4.2): `skins.css` can re-point `--fs-ui`, `--fs-meta` and
// `--row-h` all it likes while every button still says `text-base`. So the
// primitives that carry a control's, a row's or a label's size say the ROLE,
// and this file holds them to it.
//
// WHY PIXEL-NEUTRAL IS PROVABLE HERE. A role replaced a scale step only where
// the role's Refined value (`tokens.css`'s `:root`, which IS Refined) is that
// step. So `text-base` -> `text-ui` is a no-op in Refined exactly while
// `--fs-ui` is `var(--fs-base)`. The "equals, in Refined" case resolves both
// and compares them; the day someone retunes a Refined role, this reds, and
// the adoption it justified has to be re-measured.
//
// THE REGISTRIES. Every `ui/src/primitives/*.tsx` that is not a story is in
// exactly one of:
//   ROLE_BEARING     — its size is a control's, a row's or a label's, so it
//                      reads the roles; any scale size it still carries is on
//                      its allowlist WITH the reason no role fits;
//   NOT_ROLE_BEARING — with the reason it carries no role (its size is its
//                      content's, an identity's, a floor's, or a later task's).
// A new primitive reds "every non-story primitive is classified" until its
// author decides which (the Global constraints: classified in the task that
// adds it).
//
// WHAT COUNTS AS A SCALE SIZE: a font-size step of the type scale
// (`text-2xs` … `text-3xl`, `text-input`), an arbitrary font size
// (`text-[26px]`), or a height (`h-*` / `min-h-*`) that is a number, a
// bracketed length or `tap`. Padding and gaps are a control's own rhythm and
// are not scanned (the plan's mapping keeps `px-3`, `px-4`, `px-1 py-2 gap-3`
// as steps by design). Role utilities (`text-ui`, `text-meta`, `text-prose`,
// `text-title`, `text-section`, `h-row`, `min-h-row`, `px-card`) are never a
// scale size.
//
// A PRIMITIVE DRESSED BY ITS OWN STYLESHEET (Task 14b). `OptionRow` carries no
// size in its TSX: its `.opt-*` rules in `option-row.css` do. Its entry names
// that sheet, and the same two scans read it in CSS spelling: a scale size is
// a `var(--fs-<step>)` or a `min-height` in px; a role is a `var(--<role>)`.
//
// THE APP SHEETS (Task 14b). `fleet.css`, `shell.css`, `chat.css` and the
// transcript's tool rows (`tool-card.css`) set type by hand, so the role
// reaches them only where a rule says it. APP_ROLE_RULES names every rule
// that now reads `--fs-ui` or `--fs-meta`, and is held in both directions: a
// registered rule that drops back to its scale step reds, and a rule that
// reads a role without being registered reds. A rule left on a step is a
// decision recorded in the PR with its reason (a page title, prose, the
// session line W2 re-measures), not an omission this census could see.
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { LIST_ROW } from '../../ui/src/primitives/list-row';

const UI_SRC = path.join(import.meta.dirname, '..', '..', 'ui', 'src');
const PRIMITIVES = path.join(UI_SRC, 'primitives');
const TOKENS = path.join(UI_SRC, 'styles', 'tokens.css');

const read = (p: string): string => readFileSync(p, 'utf8');
const stripTsComments = (s: string): string =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"])\/\/.*$/gm, '$1');

interface Allowed { readonly cls: string; readonly why: string }
interface RoleBearing {
  readonly roles: readonly string[];
  readonly allow: readonly Allowed[];
  /** The primitive's own stylesheet, when that is where its sizes live. */
  readonly sheet?: string;
}

const TAP_FLOOR: Allowed = {
  cls: 'min-h-tap',
  why: 'the 44px tap floor: a target to clear in every skin, not a density to vary',
};

/** The primitives whose size is a control's, a row's or a label's. `roles`
 *  is what each must read; `allow` is every scale size it keeps, with why. */
const ROLE_BEARING: Readonly<Record<string, RoleBearing>> = {
  'button.tsx': {
    roles: ['text-ui'],
    allow: [
      { cls: 'text-2xs', why: "quiet's mono label sits on the 11px floor, below meta's Refined 12, so no role equals it" },
      TAP_FLOOR,
    ],
  },
  'list-row.tsx': { roles: ['min-h-row'], allow: [] },
  // D-5093 (Task 14b): the panel's side padding is the card role; the full
  // drawer arm's `px-0` is the well's edge-to-edge glass, not a padding step.
  'sheet.tsx': {
    roles: ['px-card'],
    allow: [
      { cls: 'text-lg', why: "the sheet's title is 17px, a title's size, and no role's Refined value is 17" },
      { cls: 'h-1', why: 'the grabber is a 4px bar drawn as a hint, not a row or a control' },
      { cls: 'min-h-0', why: "the body's permission to shrink inside the panel's flex column, so it scrolls: not a size" },
      { cls: 'h-[calc(100dvh-var(--safe-top)-var(--sp-6))]', why: "the full drawer arm rises to the safe-area line: the viewport's height, not a density" },
    ],
  },
  // D-5093 (Task 14b): the row's sizes are in option-row.css, so the census
  // reads them there. The label and the cursor are the row's type, the index
  // and the enter hint its meta, and the row's height the row role.
  'option-row.tsx': {
    sheet: 'option-row.css',
    roles: ['var(--fs-ui)', 'var(--fs-meta)', 'var(--row-h)'],
    allow: [
      { cls: 'var(--fs-sm)', why: "the option's sub-sentence is 13px body copy, and 13 is no role's Refined value" },
    ],
  },
  'chip.tsx': { roles: ['text-meta'], allow: [] },
  'keycap.tsx': { roles: ['text-meta'], allow: [TAP_FLOOR] },
  'door.tsx': {
    roles: ['text-meta'],
    allow: [
      { cls: 'text-2xs', why: "the door's mono label is on the 11px floor, below meta's Refined 12; only its glyph is meta" },
      TAP_FLOOR,
    ],
  },
  'radio.tsx': {
    roles: ['text-meta'],
    allow: [
      { cls: 'text-sm', why: "the option's sentence is 13px, and 13 is no role's Refined value" },
      { cls: 'h-[18px]', why: 'the native input is an 18px square inside the tap-floored row, which supplies the target' },
      TAP_FLOOR,
    ],
  },
  'bare-row.tsx': {
    roles: [],
    allow: [{ cls: 'min-h-tap', why: 'a bare row is a tap target, not a list row: it takes the floor, never --row-h' }],
  },
  'text-input.tsx': {
    roles: [],
    allow: [
      { cls: 'text-input', why: 'the 16px input floor (below it iOS zooms the page on focus), which no skin may move' },
      TAP_FLOOR,
    ],
  },
  // It wears TEXT_INPUT whole, so its 16px floor is text-input.tsx's entry;
  // a size spelled here directly would red below.
  'select.tsx': { roles: [], allow: [] },
  'back-button.tsx': {
    roles: [],
    allow: [
      { cls: 'text-[26px]', why: "the chevron's optical size: a glyph drawn as an icon, not a line of type" },
      TAP_FLOOR,
    ],
  },
};

/** Everything else, with the reason it reads no role. */
const NOT_ROLE_BEARING: Readonly<Record<string, string>> = {
  'banner.tsx': "a screen-level statement in sentence type, not a control or a row; outside Task 14's mapping",
  'collapsible-strip.tsx': "its head's height is a prop chosen per call site (tap, compact or content), not a list row's",
  'command-palette.tsx': "an overlay summoned by a key; it inherits the row and meta roles through LIST_ROW and KEYCAP, and its own sizes are left for W2's re-measure",
  'confirm.tsx': "QuickConfirm's consequence is a sentence of copy, not a control's label; its buttons are Button",
  'control-row.tsx': 'a self-grounded mono status line whose shape the shape census owns; outside Task 14\'s mapping',
  'count-badge.tsx': 'a count on the 11px floor, sized against the glyph it badges',
  'cover-screen.tsx': 'a full-viewport cover: it sets no type and no row height of its own',
  'icon.tsx': 'sized by its caller in em or by prop, so it follows the type around it',
  'limit-bar.tsx': 'draws through Meter; its label is on the 11px floor, below every Refined role',
  'meter.tsx': "its height is the meter's own token, --meter-h, which skins.css already varies",
  'skeleton.tsx': 'a placeholder sized by its caller',
  'status-dot.tsx': 'a lamp: part of the identity core, fixed across skins',
  'toast.tsx': 'a transient notice in sentence type over the page, not a row or a control of a sheet',
  'well.tsx': 'mono code in a dark well, sized by its content (the identity core)',
  'wordmark.tsx': 'the ❯ ccrc wordmark: the identity core, fixed across skins',
};

/** The roles adopted, and the step each replaced. The census resolves both in
 *  Refined's `:root` and requires them equal. */
const ADOPTED = [
  { role: 'text-ui', token: '--fs-ui', replaced: 'text-base', step: 'var(--fs-base)' },
  { role: 'text-meta', token: '--fs-meta', replaced: 'text-xs', step: 'var(--fs-xs)' },
  { role: 'min-h-row', token: '--row-h', replaced: 'min-h-[52px]', step: '52px' },
  { role: 'px-card', token: '--pad-card', replaced: 'px-4', step: 'var(--sp-4)' },
] as const;

/** The app sheets the roles reach (Task 14b), relative to the repo root. */
const APP_SHEETS: Readonly<Record<string, string>> = {
  'fleet.css': 'pwa/src/fleet/fleet.css',
  'shell.css': 'pwa/src/styles/shell.css',
  'chat.css': 'pwa/src/session/chat.css',
  'tool-card.css': 'ui/src/components/tool-card.css',
};
type TypeRole = '--fs-ui' | '--fs-meta';
/** The step each type role replaced: its Refined value (ADOPTED holds that). */
const STEP_OF: Readonly<Record<TypeRole, string>> = { '--fs-ui': '--fs-base', '--fs-meta': '--fs-xs' };

const UI: TypeRole = '--fs-ui';
const META: TypeRole = '--fs-meta';
/** Every app-sheet rule that reads a type role, by sheet and selector.
 *  `--fs-ui`: a row's or a control's label, and a sheet's copy.
 *  `--fs-meta`: timestamps, counts, chips, a row's or a sheet's meta line. */
const APP_ROLE_RULES: Readonly<Record<string, Readonly<Record<string, TypeRole>>>> = {
  'fleet.css': {
    '.fleet-count': META,
    '.pool-epoch-lag': META,
    '.offline-banner': META,
    '.status-line': META,
    '.sheet-copy': UI,
    '.acct-chev': UI,
    '.acct-change': META,
    '.proj-glyph': UI,
    '.sess-sheet-note': META,
    '.sess-hold-error': META,
    '.proj-card-count': META,
    '.proj-card-busy': META,
    '.pool-new-label': META,
    '.acct-disclosure': META,
    '.pool-note': META,
    '.proj-pending': META,
    '.fleet-archived-row, .fleet-runs-row': META,
    '.archive-total': META,
    '.archive-size': META,
    '.accounts-projection': META,
    '.mail-note': META,
    '.mail-dropped': META,
    '.mail-row .mail-body': META,
    '.run-row .run-state': META,
    '.program-start-sheet .program-start-ledger, .program-start-sheet .program-start-note': META,
    '.hotfiles-holder': META,
    '.hotfiles-expiry': META,
    '.settings-note': META,
    '.settings-release-date': META,
    '.settings-release-refused': META,
    '.settings-release-running': META,
    '.settings-node-detail': META,
    '.settings-theme-name': UI,
  },
  'shell.css': {
    '.shell-accounts .account-gauge-label': META,
    '.shell-accounts .acct-pct': META,
  },
  'chat.css': {
    '.chat-coord': META,
    '.metachip-glyph': META,
    '.pr-lede': UI,
    '.pr-facts': META,
    '.pr-label': META,
    '.pr-title': UI,
    '.reap-rows dt': META,
    '.reap-note': META,
    '.reap-sensitive': META,
    '.reap-children-list': META,
    '.menu-item': UI,
    '.menu-hint': META,
    '.chat-banner--offline': META,
    '.chat-banner--missing .banner-path': META,
    '.pending-error': META,
    '.msg-plain-note': META,
    '.msg-working': META,
    '.draft-copy, .dlg-copy': UI,
    '.draft-cancel, .dlg-later': UI,
    '.opt-wait': META,
    '.slash-desc': META,
    '.history-when': META,
    '.history-outcome': META,
    '.history-obs, .history-dec': META,
    '.history-corr': META,
    '.history-refusal': META,
    '.history-row--gap, .history-gap': META,
  },
  // The transcript's tool rows live in @ccrc/ui's sheet, not chat.css (D-5463).
  'tool-card.css': {
    '.tool-sum': META,
    '.tool-dur': META,
    '.tool-chev': META,
    '.ask-answer': META,
  },
};

/** Every `selector { body }` of a sheet, nested ones included (the inner rule
 *  of an @media or @layer block is what matches), selectors whitespace-folded. */
function appRules(sheet: string): { selector: string; body: string }[] {
  const css = stripCssComments(read(path.join(UI_SRC, '..', '..', APP_SHEETS[sheet]!)));
  const out: { selector: string; body: string }[] = [];
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selector = (m[1] ?? '').trim().replace(/\s+/g, ' ');
    if (selector === '' || selector.startsWith('@')) continue;
    out.push({ selector, body: m[2] ?? '' });
  }
  return out;
}
const TYPE_ROLE_READ = /var\(--fs-(ui|meta)\)/g;

const SCALE_SIZE =
  /(?<=^|[\s'"`:])((?:min-)?h-(?:tap|\d+(?:\.\d+)?|\[[^\]\s]+\])|text-(?:2xs|xs|sm|base|md|lg|xl|2xl|3xl|input|\[\d+(?:\.\d+)?(?:px|rem|em)\]))(?=$|[\s'"`])/g;
const ROLE_UTILITY = /(?<=^|[\s'"`:])(text-(?:ui|meta|prose|title|section)|(?:min-)?h-row|p[xy]?-card)(?=$|[\s'"`])/g;
/** The same two scans in a stylesheet's spelling. `min-height: 52px` is
 *  normalised to `min-height:52px` so an allowlist entry has one spelling.
 *  A literal size inside `font:` or `font-size:` is a scale size too, held to
 *  the standard the TSX scan holds `text-[15px]` to: it comes back as
 *  `font-size:15px`, whichever of the two properties spelled it. */
const CSS_SCALE_SIZE = /var\(--fs-(?:2xs|xs|sm|base|md|lg|xl|2xl|3xl|input)\)|min-height:\s*\d+(?:\.\d+)?px/g;
const CSS_LITERAL_FONT = /\bfont(?:-size)?\s*:[^;{}]*?(?<![\w.-])(\d+(?:\.\d+)?(?:px|rem|em))\b/g;
const CSS_ROLE = /var\(--(?:fs-(?:ui|meta|prose|page|section)|row-h|pad-card)\)/g;
const stripCssComments = (s: string): string => s.replace(/\/\*[\s\S]*?\*\//g, '');

const primitiveFiles = (): string[] =>
  readdirSync(PRIMITIVES).filter((f) => f.endsWith('.tsx') && !f.endsWith('.stories.tsx')).sort();

const sourceOf = (file: string): string => stripTsComments(read(path.join(PRIMITIVES, file)));
const sheetOf = (file: string): string | undefined => ROLE_BEARING[file]?.sheet;
const cssOf = (sheet: string): string => stripCssComments(read(path.join(PRIMITIVES, sheet)));
const scaleSizes = (file: string): Set<string> => {
  const sheet = sheetOf(file);
  const tsx = sourceOf(file).match(SCALE_SIZE) ?? [];
  const css = sheet === undefined ? [] : (cssOf(sheet).match(CSS_SCALE_SIZE) ?? []).map((m) => m.replace(/:\s+/, ':'));
  const literal = sheet === undefined ? [] : [...cssOf(sheet).matchAll(CSS_LITERAL_FONT)].map((m) => `font-size:${m[1]}`);
  return new Set([...tsx, ...css, ...literal]);
};
const roleUtilities = (file: string): Set<string> => {
  const sheet = sheetOf(file);
  const tsx = sourceOf(file).match(ROLE_UTILITY) ?? [];
  const css = sheet === undefined ? [] : (cssOf(sheet).match(CSS_ROLE) ?? []);
  return new Set([...tsx, ...css]);
};

/** The declarations of tokens.css's top-level `:root` blocks — Refined — and,
 *  separately, those of every `:root` inside an @media block, so a role
 *  redeclared at a width (or under reduced motion) is seen. */
function refinedRoot(): { root: Map<string, string>; atWidth: Map<string, string> } {
  const css = read(TOKENS).replace(/\/\*[\s\S]*?\*\//g, '');
  const decls = (body: string, into: Map<string, string>): void => {
    for (const d of body.split(';')) {
      const m = /^\s*(--[\w-]+)\s*:\s*([\s\S]+?)\s*$/.exec(d);
      if (m?.[1] !== undefined && m[2] !== undefined) into.set(m[1], m[2]);
    }
  };
  const MEDIA_ROOT = /@media[^{]*\{\s*:root\s*\{([^}]*)\}\s*\}/g;
  const atWidth = new Map<string, string>();
  for (const m of css.matchAll(MEDIA_ROOT)) decls(m[1] ?? '', atWidth);
  const root = new Map<string, string>();
  for (const m of css.replace(MEDIA_ROOT, '').matchAll(/(?:^|\n)\s*:root\s*\{([^}]*)\}/g)) decls(m[1] ?? '', root);
  return { root, atWidth };
}

function resolve(value: string, root: Map<string, string>, seen = new Set<string>()): string {
  const name = /^var\((--[\w-]+)\)$/.exec(value.trim())?.[1];
  if (name === undefined) return value.trim();
  if (seen.has(name)) throw new Error(`cycle at ${name}`);
  const next = root.get(name);
  if (next === undefined) throw new Error(`${name} has no :root value`);
  return resolve(next, root, new Set([...seen, name]));
}

describe('the role census (D-5093)', () => {
  it('every non-story primitive is classified', () => {
    const files = primitiveFiles();
    const both = files.filter((f) => f in ROLE_BEARING && f in NOT_ROLE_BEARING);
    const neither = files.filter((f) => !(f in ROLE_BEARING) && !(f in NOT_ROLE_BEARING));
    const gone = [...Object.keys(ROLE_BEARING), ...Object.keys(NOT_ROLE_BEARING)].filter((f) => !files.includes(f));
    expect(both, 'a primitive in both registries').toEqual([]);
    expect(neither, 'a primitive in neither registry: decide whether it reads a role').toEqual([]);
    expect(gone, 'a registry entry with no primitive behind it').toEqual([]);
    for (const [f, why] of Object.entries(NOT_ROLE_BEARING)) expect(why.length, `${f} states a reason`).toBeGreaterThan(20);
  });

  it('no role-bearing primitive carries a scale size outside its allowlist', () => {
    const outside: string[] = [];
    for (const [file, entry] of Object.entries(ROLE_BEARING)) {
      const allowed = new Set(entry.allow.map((a) => a.cls));
      for (const cls of scaleSizes(file)) if (!allowed.has(cls)) outside.push(`${file}: ${cls}`);
    }
    expect(outside, 'a scale size where a role belongs — use the role, or allowlist it with the reason no role fits').toEqual([]);
  });

  it('every role-bearing primitive reads the roles it adopted', () => {
    const missing: string[] = [];
    for (const [file, entry] of Object.entries(ROLE_BEARING)) {
      const has = roleUtilities(file);
      for (const r of entry.roles) if (!has.has(r)) missing.push(`${file}: ${r}`);
    }
    expect(missing).toEqual([]);
  });

  it('every allowlist entry still matches a class in its primitive, and states a reason', () => {
    const stale: string[] = [];
    for (const [file, entry] of Object.entries(ROLE_BEARING)) {
      const has = scaleSizes(file);
      for (const a of entry.allow) {
        if (!has.has(a.cls)) stale.push(`${file}: ${a.cls}`);
        expect(a.why.length, `${file}: ${a.cls} states a reason`).toBeGreaterThan(20);
      }
    }
    expect(stale, 'an allowlist entry for a class its primitive no longer carries').toEqual([]);
  });

  it('each adopted role equals, in Refined, the step it replaced', () => {
    const { root, atWidth } = refinedRoot();
    for (const a of ADOPTED) {
      expect(root.get(a.token), `${a.token} in :root`).toBe(a.step);
      const stepPx = a.step.startsWith('var(') ? resolve(a.step, root) : a.step;
      expect(resolve(root.get(a.token)!, root), `${a.role} resolves to ${a.replaced}'s value`).toBe(stepPx);
      expect(stepPx, `${a.token} resolves to a length`).toMatch(/^\d+px$/);
      // Pixel-neutral at every width: Refined never redeclares an adopted
      // role in a width block, and neither does the step it replaced.
      expect(atWidth.has(a.token), `${a.token} redeclared in a :root width block`).toBe(false);
      if (a.step.startsWith('var(')) expect(atWidth.has(a.step.slice(4, -1)), `${a.step} redeclared at a width`).toBe(false);
    }
  });

  it('every registered app-sheet rule reads its role, never the step it replaced (Task 14b)', () => {
    const wrong: string[] = [];
    for (const [sheet, rules] of Object.entries(APP_ROLE_RULES)) {
      const all = appRules(sheet);
      for (const [selector, role] of Object.entries(rules)) {
        const bodies = all.filter((r) => r.selector === selector).map((r) => r.body);
        if (bodies.length === 0) { wrong.push(`${sheet} ${selector}: no such rule`); continue; }
        const typed = bodies.filter((b) => /var\(--fs-/.test(b));
        if (!typed.some((b) => b.includes(`var(${role})`))) wrong.push(`${sheet} ${selector}: does not read ${role}`);
        if (typed.some((b) => b.includes(`var(${STEP_OF[role]})`))) wrong.push(`${sheet} ${selector}: still reads ${STEP_OF[role]}`);
      }
    }
    expect(wrong, 'an adopted app-sheet rule is back on its scale step, or gone').toEqual([]);
  });

  it('every app-sheet rule that reads a type role is registered, with that role (Task 14b)', () => {
    const unregistered: string[] = [];
    for (const sheet of Object.keys(APP_SHEETS)) {
      for (const r of appRules(sheet)) {
        for (const m of r.body.matchAll(TYPE_ROLE_READ)) {
          const role = `--fs-${m[1]}` as TypeRole;
          if (APP_ROLE_RULES[sheet]?.[r.selector] !== role) unregistered.push(`${sheet} ${r.selector}: ${role}`);
        }
      }
    }
    expect(unregistered, 'a rule reads a role this census does not know: register it').toEqual([]);
  });

  it("LIST_ROW's height is the row role", () => {
    expect(LIST_ROW.split(/\s+/)).toContain('min-h-row');
    expect(LIST_ROW).not.toMatch(/(^|\s)min-h-(?!row(\s|$))/);
  });

  it('the scan sees something — it is not vacuously green', () => {
    expect(primitiveFiles().length).toBeGreaterThan(20);
    expect(scaleSizes('button.tsx').has('min-h-tap')).toBe(true);
    expect(scaleSizes('back-button.tsx').has('text-[26px]')).toBe(true);
    expect(refinedRoot().root.get('--fs-base')).toBe('15px');
    expect(scaleSizes('option-row.tsx').size + roleUtilities('option-row.tsx').size).toBeGreaterThan(2);
    expect(Object.values(APP_ROLE_RULES).reduce((n, r) => n + Object.keys(r).length, 0)).toBeGreaterThan(40);
    expect(appRules('chat.css').length).toBeGreaterThan(200);
  });
});
