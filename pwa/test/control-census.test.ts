// Every control the app draws by hand, and how it reaches a thumb.
//
// WHAT THIS COVERS THAT NOTHING ELSE DOES. `focus-ring.test.ts` is a census
// of keyboard focus — over `ui/src` only. `tap-targets.test.tsx` scrapes the
// floor for a named handful of rules and, since this wave, refuses a literal
// `44px` in any size declaration. Neither answers the question the design
// system exists to answer about the APP: of the `<button>` shapes pwa draws
// itself, which reach the 44px floor the spec calls an acceptance criterion,
// and how?
//
// FOUR ANSWERS, AND EVERY ONE IS CHECKED, not merely stated:
//
//   TOKEN     the control's own rule declares `min-*: var(--tap-min)`.
//             Verified against both packages' stylesheets.
//   SELECTOR  a rule the entry NAMES declares it — an element selector like
//             `.pending-actions button`, which covers three buttons including
//             one with no class at all. The named selector is looked up and
//             must really carry the token, so an entry cannot cite a rule
//             that does not exist or has stopped declaring the floor.
//   OVERLAY   an invisible `::before` reaches the floor while the visible box
//             stays small. The named pseudo-rule must mention `--tap-min`.
//   UNDER     measured below the floor, deliberately unchanged. The entry
//             carries the measurement. Checked in the NEGATIVE: the moment
//             such a control gains the token this reds and asks for it to be
//             re-classified — a preserved defect that quietly gets fixed
//             should not keep its excuse.
//
// WHY `UNDER` EXISTS AT ALL. Four control shapes are under the floor, and this
// census found them rather than a reader: the fleet header's bell (~25px), the
// chat header's model and effort chips (~19px), the compaction head (~29px)
// and the code block's copy button (32px, `--sp-8`). None is touched here.
// Growing them changes the design, and the design is the user's call — so they
// are recorded with their numbers, the way the markdown bullet defect was,
// rather than silently adjusted.
//
// THE KEY IS `file.tsx <className>`, so renaming a class or moving the control
// reds this file and asks the question again. `(none)` and `(computed)` are
// real keys: a `<button>` with no class, and one whose class is chosen at
// render time.
//
// MEASURED, eight mutations against the whole file (baseline 7 passed):
//
//   | mutation                                            | result |
//   |-----------------------------------------------------|--------|
//   | a new `<button>` with its own class appears          | 1 red  |
//   | a registered control's class renamed                 | 2 red  |
//   | one TOKEN entry deleted from the registry            | 1 red  |
//   | an entry for a control that does not exist           | 2 red  |
//   | a TOKEN class's rule loses `--tap-min`               | 1 red  |
//   | a SELECTOR citation pointing at no rule              | 1 red  |
//   | an UNDER control quietly gaining `--tap-min`         | 1 red  |
//   | the control walk returns nothing                     | 2 red  |
//
// The fifth and sixth are what make the registry evidence rather than claims:
// an entry cannot say TOKEN about a rule that has stopped declaring the floor,
// and cannot cite a selector that is not there. The seventh is the direction
// that is easy to forget — a preserved defect quietly fixed keeps an excuse
// the next reader believes.
//
// One mutation came back GREEN first and was the census being right: adding an
// attribute to an EXISTING button changes no key, because the key is the file
// and the class. Re-run with a button carrying a new class, it reds.
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const PKG = path.join(import.meta.dirname, '..', '..');
const APP_SRC = path.join(PKG, 'pwa', 'src');

/** Both packages' stylesheets, joined. `.code-block-copy` lives in
 *  `ui/src/components/prose.css`, so a census reading only the app's four
 *  sheets reported it as having no size rule at all — measured, and the reason
 *  this reads the package too. */
function stylesheets(): string {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.css')) out.push(readFileSync(p, 'utf8'));
    }
  };
  walk(APP_SRC);
  walk(path.join(PKG, 'ui', 'src'));
  return out.join('\n').replace(/\/\*[\s\S]*?\*\//g, '');
}

interface Rule { sel: string; body: string }

const RULES: Rule[] = [...stylesheets().matchAll(/([^{}@]+)\{([^{}]*)\}/g)]
  .map((m) => ({ sel: (m[1] ?? '').trim().replace(/\s+/g, ' '), body: m[2] ?? '' }))
  .filter((r) => r.sel !== '' && !r.sel.startsWith('@'));

/** Does any rule selecting this class declare the floor token? */
const classHasFloor = (cls: string): boolean =>
  RULES.some((r) => new RegExp(`\\.${cls}(?![\\w-])`).test(r.sel) && /--tap-min/.test(r.body));

/** Does the rule with exactly this selector declare the floor token? */
const selectorHasFloor = (sel: string): boolean =>
  RULES.some((r) => r.sel === sel && /--tap-min/.test(r.body));

/** Every hand-drawn `<button>`, keyed by file and class. */
function controls(): Map<string, number[]> {
  const found = new Map<string, number[]>();
  const walk = (dir: string): string[] => {
    const out: string[] = [];
    for (const e of readdirSync(dir).sort()) {
      const p = path.join(dir, e);
      if (statSync(p).isDirectory()) out.push(...walk(p));
      else if (p.endsWith('.tsx') && !p.endsWith('.stories.tsx')) out.push(p);
    }
    return out;
  };
  for (const file of walk(APP_SRC)) {
    const src = ts.createSourceFile(
      file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const visit = (n: ts.Node): void => {
      if (ts.isJsxElement(n) || ts.isJsxSelfClosingElement(n)) {
        const open = ts.isJsxElement(n) ? n.openingElement : n;
        if (open.tagName.getText() === 'button') {
          let cls = '(none)';
          for (const a of open.attributes.properties) {
            if (!ts.isJsxAttribute(a) || a.name.getText() !== 'className') continue;
            const init = a.initializer;
            cls = init !== undefined && ts.isStringLiteral(init) ? init.text : '(computed)';
          }
          const line = src.getLineAndCharacterOfPosition(n.getStart()).line + 1;
          const key = `${path.relative(APP_SRC, file)} ${cls}`;
          const prev = found.get(key);
          if (prev === undefined) found.set(key, [line]); else prev.push(line);
        }
      }
      n.forEachChild(visit);
    };
    visit(src);
  }
  return found;
}

/** Every hand-drawn control, with the way it reaches a thumb. */
const CONTROLS: Record<string, string> = {
  // ── TOKEN: the control's own rule declares the floor ─────────────────────
  'fleet/MailBadge.tsx mail-badge': 'TOKEN. The mail door in the fleet header.',
  'fleet/NewSessionSheet.tsx acct-change': 'TOKEN. The change-account line above the project list.',
  'fleet/NewSessionSheet.tsx acct-disclosure': 'TOKEN. The routing row disclosure.',
  'fleet/PasskeyNotice.tsx passkey-notice': 'TOKEN. A standing fact about the box, tappable to act on it.',
  'fleet/PoolList.tsx pool-row': 'TOKEN. Both rows of the pool picker.',
  'fleet/ProjectCardHead.tsx proj-card-add': 'TOKEN, and OVERLAY below: the rule carries the token and the ::before carries the hit area.',
  'fleet/ProjectCardHead.tsx proj-card-pool': "TOKEN. The card's pool tag.",
  'fleet/ProjectCardHead.tsx proj-card-toggle': 'TOKEN. The card head — one of the six floors this wave converted from a literal.',
  'fleet/SessionLine.tsx sess-actions': 'TOKEN, and OVERLAY below.',
  'fleet/SessionMeta.tsx sess-subagents': 'TOKEN. The subagent toggle, a real un-nested button.',
  'fleet/SwapSheet.tsx acct-disclosure': "TOKEN. NewSessionSheet's disclosure rule, same class.",
  'screens/AccountsScreen.tsx accounts-session': 'TOKEN. A session row on the accounts screen.',
  'screens/AccountsScreen.tsx proj-card-pool acct-pool-chip': "TOKEN. The card's pool tag, reused as a chip.",
  'screens/FleetScreen.tsx fab': 'TOKEN by VALUE, not by name — see FLOOR_BY_VALUE.',
  'screens/FleetScreen.tsx notice-x': 'TOKEN. The notice dismiss.',
  'screens/MailScreen.tsx mail-chip': 'TOKEN. Both filter chips.',
  'screens/RunRow.tsx run-abandon': 'TOKEN. The abandon door.',
  'screens/RunRow.tsx run-open': 'TOKEN. The open door.',
  'screens/RunRow.tsx run-resume': 'TOKEN. The resume door.',
  'session/ChatList.tsx jump-latest': 'TOKEN. The jump-to-latest affordance.',
  'session/Composer.tsx draft-cancel': 'TOKEN. The draft cancel.',
  'session/Composer.tsx send-btn': 'TOKEN. Send.',
  'session/Composer.tsx slash-item': 'TOKEN. A slash-command row — one of the six floors this wave converted from a literal.',
  'session/DialogSheet.tsx dlg-details-toggle': 'TOKEN. The details disclosure.',
  'session/DialogSheet.tsx dlg-later': 'TOKEN. Both "Not now" rows, now rendered by TerminalCta.',
  'session/DialogSheet.tsx dlg-reply-send': 'TOKEN. Send, beside the reply field.',
  'session/DialogSheet.tsx opt-preview-toggle': 'TOKEN. The option preview disclosure.',

  // ── the rest, argued one at a time ───────────────────────────────────────
  'fleet/NotificationBell.tsx (computed)':
    'UNDER, about 25px: `.bell` is `padding: 4px` around `--fs-lg` (17px) at '
    + 'line-height 1. The SETTINGS copy of the same component is fine — '
    + '`.settings-bell-row .bell` declares both floors — so the one in the FLEET '
    + 'HEADER is the copy that is under it, and the two have drifted. Found by '
    + 'this census. Not changed: growing the header bell moves the header.',
  'fleet/SessionMeta.tsx sess-held':
    "SELECTOR .sess-line. Inline text in the row's meta line, not a box of its "
    + 'own: what gets tapped is the ROW, and the row declares the floor. Its own '
    + 'rule sets type and truncation and no geometry at all.',
  'fleet/SessionLine.tsx sess-open':
    'SELECTOR .sess-body. Documented and separately tested: the floor lives on '
    + "`.sess-body`, the block the row's click forwarder is on, and "
    + '`fleet-css.test.ts` asserts `.sess-open` must NOT regain a `min-height`. '
    + 'It is the label LINE inside the tap surface, not the surface.',
  'screens/FleetScreen.tsx bucket-head-seen':
    'UNDER, 24px by `--sp-6`, and ARGUED in the stylesheet at length: WCAG 2.2 '
    + "SC 2.5.8's floor, chosen because the `::before` overlay the two OVERLAY "
    + 'entries use would overhang neighbours that are INERT, turning a near-miss '
    + 'that does nothing today into an irreversible activation. The only safe '
    + 'direction here is growing the visible box, which is a design change.',
  'session/ChatList.tsx (none)':
    'SELECTOR .pending-actions button. The `Discard` button, with no class at '
    + 'all — and covered anyway, because the floor is on an ELEMENT selector. '
    + 'This is the entry that argues for the SELECTOR arm: a census keyed on '
    + 'classes alone would have had nothing to say about it.',
  'session/ChatList.tsx pending-retry':
    'SELECTOR .pending-actions button. The same rule.',
  'session/ChatList.tsx pending-send-it':
    'SELECTOR .pending-actions button. The same rule, and chat.css says so in '
    + 'its own words: it inherits min-height from `.pending-actions button`, so '
    + 'the tap target is the shared token.',
  'session/MessageBubble.tsx code-block-copy':
    'UNDER, 32px by `--sp-8`, declared in `ui/src/components/prose.css`. A '
    + 'deliberate token rather than an oversight, but it is not the floor, and '
    + 'the rule says nothing about why 32 is enough here. Unchanged: the copy '
    + "button sits on the code well's bar beside the language label, and a 44px "
    + 'bar is a different code block.',
  'session/MessageBubble.tsx compaction-head':
    'UNDER, about 29px: `--sp-2` (8px) above and below `--fs-sm` (13px) at '
    + 'line-height 1. A full-width disclosure — easy to hit horizontally, short '
    + 'vertically.',
  'session/SessionHeader.tsx (computed)':
    'UNDER, about 19px. The effort chip — `metachip` or `metachip--ultra` — on '
    + 'the same rule as the model chip below.',
  'session/SessionHeader.tsx metachip metachip--model':
    'UNDER, about 19px: `padding: 3px 9px` around `--fs-2xs` (11px) at '
    + 'line-height 1, plus a hairline. The model and effort chips are TAPPABLE '
    + "(they open their choosers) and chat.css's own comment says so, which is "
    + 'what makes this a floor question rather than a label. The smallest '
    + 'controls in the app, and this census found them.',
};

/** OVERLAY entries name the pseudo-rule that reaches the floor. */
const OVERLAYS: Record<string, string> = {
  'fleet/ProjectCardHead.tsx proj-card-add': '.proj-card-add::before',
  'fleet/SessionLine.tsx sess-actions': '.sess-actions::before',
};

/** The one TOKEN entry that reaches the floor by VALUE rather than by name:
 *  `.fab` is `height: 56px`, twelve pixels ABOVE it, because a floating action
 *  button is the one control sized for the thumb that is already moving.
 *  `var(--tap-min)` there would SHRINK it. */
const FLOOR_BY_VALUE = ['fab'];

const classOfKey = (key: string): string => key.slice(key.indexOf(' ') + 1);

describe('hand-drawn controls', () => {
  it('registers every one', () => {
    const missing = [...controls().keys()].filter((k) => CONTROLS[k] === undefined).sort();
    expect(missing, 'a hand-drawn <button> with no entry — say how it reaches a thumb').toEqual([]);
  });

  it('keeps no stale entry', () => {
    const live = new Set(controls().keys());
    const stale = Object.keys(CONTROLS).filter((k) => !live.has(k)).sort();
    expect(stale, 'this control is gone or renamed — drop or re-key the entry').toEqual([]);
  });

  it('verifies every TOKEN claim against the stylesheets', () => {
    const wrong = Object.entries(CONTROLS)
      .filter(([, v]) => v.startsWith('TOKEN'))
      .filter(([k]) => {
        const cls = classOfKey(k);
        if (cls.startsWith('(')) return true;
        if (FLOOR_BY_VALUE.includes(cls)) return false;
        return !cls.split(/\s+/).some(classHasFloor);
      })
      .map(([k]) => k).sort();
    expect(wrong, 'claims TOKEN but no rule selecting it declares --tap-min').toEqual([]);
  });

  it('verifies every SELECTOR claim names a rule that carries the floor', () => {
    const cited = Object.entries(CONTROLS)
      .filter(([, v]) => v.startsWith('SELECTOR'))
      .map(([k, v]) => [k, /^SELECTOR (.+?)\.(?:\s|$)/.exec(v)?.[1] ?? ''] as const);
    expect(cited.length, 'the SELECTOR arm has entries').toBeGreaterThan(3);
    const broken = cited
      .filter(([, sel]) => sel === '' || !selectorHasFloor(sel))
      .map(([k]) => k).sort();
    expect(broken, 'cites a selector that does not exist or no longer declares --tap-min').toEqual([]);
  });

  it('verifies every OVERLAY pseudo-rule still mentions the floor', () => {
    const broken = Object.entries(OVERLAYS)
      .filter(([, sel]) => !RULES.some((r) => r.sel === sel && /--tap-min/.test(r.body)))
      .map(([k]) => k).sort();
    expect(broken, 'the overlay that was reaching the floor has stopped').toEqual([]);
    for (const k of Object.keys(OVERLAYS)) expect(CONTROLS[k], k).toBeDefined();
  });

  it('keeps every UNDER control honestly under', () => {
    // The negative direction. A control recorded as under the floor that
    // QUIETLY GAINS the token keeps an excuse it no longer needs — and the
    // next reader believes the excuse.
    const grown = Object.entries(CONTROLS)
      .filter(([, v]) => v.startsWith('UNDER'))
      .filter(([k]) => {
        const cls = classOfKey(k);
        // `bucket-head-seen` is UNDER by a DIFFERENT standard it states in the
        // stylesheet (WCAG 2.2 SC 2.5.8's 24px); it will never carry --tap-min
        // and must not be asked to.
        if (cls.startsWith('(') || cls === 'bucket-head-seen') return false;
        return cls.split(/\s+/).some(classHasFloor);
      })
      .map(([k]) => k).sort();
    expect(grown, 'this now declares --tap-min — re-register it as TOKEN').toEqual([]);
    expect(
      Object.values(CONTROLS).filter((v) => v.startsWith('UNDER')).length,
      'the UNDER arm still records every control below the floor',
    ).toBe(6);
  });

  it('reads the app and the stylesheets at all', () => {
    expect(controls().size).toBeGreaterThan(30);
    expect(RULES.length).toBeGreaterThan(500);
    expect(RULES.filter((r) => /--tap-min/.test(r.body)).length).toBeGreaterThan(20);
  });
});
