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
//   | a new `<a href>` with its own class appears          | 1 red  |
//   | a `<select>`'s rule loses `--tap-min`                | 1 red  |
//   | an INLINE prose link GAINS `--tap-min`               | 1 red  |
//   | `buttonVariants` loses `min-h-tap`                   | 1 red  |
//   | the bell loses its floors, entry still SELECTOR      | 1 red  |
//   | an UNDER entry for a computed class drops its cite   | 1 red  |
//   | `.metachip` gains the floor, entry still UNDER        | 2 red  |
//
// The fifth and sixth are what make the registry evidence rather than claims:
// an entry cannot say TOKEN about a rule that has stopped declaring the floor,
// and cannot cite a selector that is not there. The seventh is the direction
// that is easy to forget — a preserved defect quietly fixed keeps an excuse
// the next reader believes.
//
// One mutation came back GREEN first and was the census being right: adding an
// attribute to an EXISTING button changes no key, because the key is the file,
// the tag and the class.
//
// The last four are the arms the first spelling of this file did not have. The
// fourth is the one worth pointing at: three anchors take their floor from
// `buttonVariants()` rather than from any stylesheet rule, so the VARIANT arm
// reads that class string — and a floor removed INSIDE `@ccrc/ui` reds a
// census in `pwa`. Re-run with a button carrying a new class, it reds.
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { buttonVariants } from '@ccrc/ui';

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

/** Every hand-drawn CONTROL, keyed by file and class.
 *
 *  NOT JUST `<button>`, which is what this census covered for one commit and
 *  is the blind spot that commit left: the app draws SEVENTEEN interactive
 *  elements that are not buttons — a `role="link"` strip, two `<select>`s,
 *  two `<textarea>`s, two radios, a `<div onClick>` and eight `<a>`s — and a
 *  census that says "every hand-drawn control" while reading one tag name is
 *  making a claim it does not check.
 *
 *  WHAT COUNTS AS ONE. A `<button>`; an `<a>` with an `href` or an `onClick`;
 *  `<select>` and `<textarea>`; a checkbox or radio `<input>`; anything
 *  carrying `role="button"`, `"link"` or `"switch"`; and a lowercase element
 *  with an `onClick` of its own. What does NOT count is `tabIndex={-1}`
 *  without a handler: `.bucket-head-label` is a programmatic focus target,
 *  not a control, and treating it as one would ask a `<span>` to be 44px for
 *  nobody's benefit. */
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
        const tag = open.tagName.getText();
        let cls = '(none)';
        let role: string | null = null;
        let type: string | null = null;
        let onClick = false;
        let href = false;
        for (const a of open.attributes.properties) {
          if (!ts.isJsxAttribute(a)) continue;
          const name = a.name.getText();
          const init = a.initializer;
          const lit = init !== undefined && ts.isStringLiteral(init) ? init.text : null;
          if (name === 'className') cls = lit ?? (init === undefined ? '(none)' : '(computed)');
          if (name === 'role') role = lit;
          if (name === 'type') type = lit;
          if (name === 'onClick') onClick = true;
          if (name === 'href') href = true;
        }
        const lower = tag[0] === tag[0]?.toLowerCase();
        const interactive =
          tag === 'button'
          || (tag === 'a' && (href || onClick))
          || tag === 'select' || tag === 'textarea'
          || (tag === 'input' && (type === 'checkbox' || type === 'radio'))
          || role === 'button' || role === 'link' || role === 'switch'
          || (onClick && lower && tag !== 'button' && tag !== 'a');
        if (interactive) {
          const line = src.getLineAndCharacterOfPosition(n.getStart()).line + 1;
          const key = `${path.relative(APP_SRC, file)} <${tag}> ${cls}`;
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
  'fleet/MailBadge.tsx <button> mail-badge': 'TOKEN. The mail door in the fleet header.',
  'fleet/NewSessionSheet.tsx <button> acct-change': 'TOKEN. The change-account line above the project list.',
  'fleet/NewSessionSheet.tsx <button> acct-disclosure': 'TOKEN. The routing row disclosure.',
  'fleet/PasskeyNotice.tsx <button> passkey-notice': 'TOKEN. A standing fact about the box, tappable to act on it.',
  'fleet/PoolList.tsx <button> pool-row': 'TOKEN. Both rows of the pool picker.',
  'fleet/ProjectCardHead.tsx <button> proj-card-add': 'TOKEN, and OVERLAY below: the rule carries the token and the ::before carries the hit area.',
  'fleet/ProjectCardHead.tsx <button> proj-card-pool': "TOKEN. The card's pool tag.",
  'fleet/ProjectCardHead.tsx <button> proj-card-toggle': 'TOKEN. The card head — one of the six floors this wave converted from a literal.',
  'fleet/SessionLine.tsx <button> sess-actions': 'TOKEN, and OVERLAY below.',
  'fleet/SessionMeta.tsx <button> sess-subagents': 'TOKEN. The subagent toggle, a real un-nested button.',
  'fleet/SwapSheet.tsx <button> acct-disclosure': "TOKEN. NewSessionSheet's disclosure rule, same class.",
  'screens/AccountsScreen.tsx <button> accounts-session': 'TOKEN. A session row on the accounts screen.',
  'screens/AuthSection.tsx <button> accounts-session': 'TOKEN. Revoke, on a passkey row — the SAME class the\n    session rows above it use, which is why the auth section leaving AccountsScreen for its own file put a\n    second key under one class rather than moving one.',
  'screens/AccountsScreen.tsx <button> proj-card-pool acct-pool-chip': "TOKEN. The card's pool tag, reused as a chip.",
  'screens/FleetScreen.tsx <button> fab': 'TOKEN by VALUE, not by name — see FLOOR_BY_VALUE.',
  'screens/FleetScreen.tsx <button> notice-x': 'TOKEN. The notice dismiss.',
  'screens/MailScreen.tsx <button> mail-chip': 'TOKEN. Both filter chips.',
  'screens/RunRow.tsx <button> run-abandon': 'TOKEN. The abandon door.',
  'screens/RunRow.tsx <button> run-open': 'TOKEN. The open door.',
  'screens/RunRow.tsx <button> run-resume': 'TOKEN. The resume door.',
  'session/ChatList.tsx <button> jump-latest': 'TOKEN. The jump-to-latest affordance.',
  'session/Composer.tsx <button> draft-cancel': 'TOKEN. The draft cancel.',
  'session/Composer.tsx <button> send-btn': 'TOKEN. Send.',
  'session/Composer.tsx <button> slash-item': 'TOKEN. A slash-command row — one of the six floors this wave converted from a literal.',
  'session/DialogSheet.tsx <button> dlg-details-toggle': 'TOKEN. The details disclosure.',
  'session/EnvelopeSheet.tsx <button> dlg-later': 'TOKEN. Both "Not now" rows, rendered by TerminalCta — which lives beside the envelope sheet and is imported back by the controller.',
  'session/DialogSheet.tsx <button> dlg-reply-send': 'TOKEN. Send, beside the reply field.',
  'session/DialogSheet.tsx <button> opt-preview-toggle': 'TOKEN. The option preview disclosure.',

  // ── not buttons: the seventeen the first spelling of this census missed ──
  'fleet/AccountsStrip.tsx <div> accounts-strip':
    'TOKEN. A `role="link"` div with `tabIndex={0}` and a keydown handler — '
    + 'the strip D-161 calls the only door to /accounts. `.accounts-strip` '
    + 'declares the floor.',
  'fleet/NewSessionSheet.tsx <select> route-select':
    'TOKEN. `.route-select` declares the floor; all three routing fields wear '
    + 'it through `RouteField`.',
  'screens/FleetScreen.tsx <select> route-select fleet-class-select':
    'TOKEN. The same rule, with the head\'s own width modifier beside it.',
  'fleet/SessionLine.tsx <div> sess-body':
    'TOKEN. Not a control so much as the row\'s convenience forwarder for the '
    + 'dead space between cells — its own comment argues at length why it is a '
    + 'div and not a button. It declares the floor anyway, because it IS what '
    + 'a thumb lands on, and one of the six literals this branch converted was '
    + 'this rule.',
  'screens/SettingsScreen.tsx <input> (none)':
    'SELECTOR .settings-option. The radios are 18px by design — a radio IS '
    + 'small — and the hit area is the LABEL that wraps each one, which '
    + 'declares the floor. Both call sites (the notification/channel/auto '
    + 'groups through `RadioFieldset`, and the theme picker through '
    + '`ThemeRow`) render the input inside that label.',
  'session/Composer.tsx <textarea> composer-input':
    'TOKEN by VALUE — see FLOOR_BY_VALUE. `padding: 10px 0` around '
    + '`--fs-input` (16px) at `--lh-normal` (1.5) is 10 + 24 + 10 = 44 exactly, '
    + 'and the rule\'s own comment reads "1 → 6 lines, then inner scroll". The '
    + 'single-line state IS the floor; `var(--tap-min)` here would fight the '
    + 'line-box arithmetic rather than express it.',
  'session/PrSheet.tsx <a> (computed)':
    'VARIANT buttonVariants. Three "Open on GitHub" anchors wearing the design '
    + 'system\'s own ghost button — `buttonVariants()` carries `min-h-tap` in '
    + 'its base, which this census checks rather than trusts. An anchor, not a '
    + 'button, because it navigates to GitHub; the styling is the button\'s.',
  'session/MessageBubble.tsx <a> (none)':
    'INLINE. Links inside a sentence — react-markdown\'s `a` mapping and the '
    + 'bare-URL splitter. WCAG 2.2 SC 2.5.8 exempts a target that is "in a '
    + 'sentence or block of text", and it has to: giving a link in prose a '
    + '44px box would reflow the prose around every link.',
  'session/MessageBubble.tsx <a> msg-img-link':
    'INLINE, with a different reason: the anchor wraps an IMAGE and '
    + '`.msg-img-link` is `height: auto`, so the target is whatever the image '
    + 'measures. An attachment thumbnail is already far above the floor; a '
    + 'min-height here would letterbox a wide one.',
  'session/PrSheet.tsx <textarea> pr-body-preview':
    'UNDER, 40px in its one-line state: `--sp-2` (8px) around '
    + '`--fs-input` at `--lh-normal`. It is a BODY PREVIEW — `max-height: '
    + '40vh` with its own scroll — so one line is not a state it is ever in '
    + 'with content; the measurement is recorded rather than the claim that it '
    + 'cannot happen.',

  // ── the rest, argued one at a time ───────────────────────────────────────
  'fleet/NotificationBell.tsx <button> (computed)':
    'SELECTOR .bell. It was UNDER at about 25px — 4px of padding around '
    + '`--fs-lg` at line-height 1 — while `.settings-bell-row .bell`, the SAME '
    + 'component in Settings, declared both floors. Two copies of one '
    + 'component, drifted; this census found it. The header copy now carries '
    + 'the floors too, measured to fit: the head\'s right group needs 244px of '
    + 'min-content with 294px at 390px, this adds 19px, and the group wraps '
    + 'anyway (D-3303).',
  'fleet/SessionMeta.tsx <button> sess-held':
    "SELECTOR .sess-line. Inline text in the row's meta line, not a box of its "
    + 'own: what gets tapped is the ROW, and the row declares the floor. Its own '
    + 'rule sets type and truncation and no geometry at all.',
  'fleet/SessionLine.tsx <button> sess-open':
    'SELECTOR .sess-body. Documented and separately tested: the floor lives on '
    + "`.sess-body`, the block the row's click forwarder is on, and "
    + '`fleet-css.test.ts` asserts `.sess-open` must NOT regain a `min-height`. '
    + 'It is the label LINE inside the tap surface, not the surface.',
  'fleet/BucketBar.tsx <button> bucket-head-seen':
    'UNDER, 24px by `--sp-6`, and ARGUED in the stylesheet at length: WCAG 2.2 '
    + "SC 2.5.8's floor, chosen because the `::before` overlay the two OVERLAY "
    + 'entries use would overhang neighbours that are INERT, turning a near-miss '
    + 'that does nothing today into an irreversible activation. The only safe '
    + 'direction here is growing the visible box, which is a design change.',
  'session/PendingBubble.tsx <button> (none)':
    'SELECTOR .pending-actions button. The `Discard` button, with no class at '
    + 'all — and covered anyway, because the floor is on an ELEMENT selector. '
    + 'This is the entry that argues for the SELECTOR arm: a census keyed on '
    + 'classes alone would have had nothing to say about it.',
  'session/PendingBubble.tsx <button> pending-retry':
    'SELECTOR .pending-actions button. The same rule.',
  'session/PendingBubble.tsx <button> pending-send-it':
    'SELECTOR .pending-actions button. The same rule, and chat.css says so in '
    + 'its own words: it inherits min-height from `.pending-actions button`, so '
    + 'the tap target is the shared token.',
  'session/MessageBubble.tsx <button> code-block-copy':
    'UNDER `--tap-min` and ABOVE the WCAG floor: 32px by `--sp-8`, declared '
    + 'in `ui/src/components/prose.css`, against SC 2.5.8\'s 24. A deliberate '
    + 'token rather than an oversight. Left as it is this wave for the reason '
    + 'the operator chose that floor: the copy button sits on the code well\'s '
    + 'bar beside the language label, and a 44px bar is a different code block.',
  'session/MessageBubble.tsx <button> compaction-head':
    'UNDER `--tap-min` and ABOVE the WCAG floor: about 29px — `--sp-2` (8px) '
    + 'above and below `--fs-sm` (13px) at line-height 1 — against SC '
    + '2.5.8\'s 24. A full-width disclosure, so it is easy to hit horizontally '
    + 'and short only vertically. Left as it is this wave: it already clears '
    + 'the floor the operator chose, and 44 would add 15px to EVERY compaction '
    + 'marker in a transcript.',
  'session/SessionHeader.tsx <button> (computed)':
    'UNDER .metachip, 24px. The effort chip — `metachip` or '
    + '`metachip--ultra` — on the same rule as the model chip below. The '
    + 'citation is REQUIRED because the class is computed: see '
    + 'CITES_A_RULE.',
  'session/SessionHeader.tsx <button> metachip metachip--model':
    'UNDER `--tap-min`, and that is now a DECISION rather than an oversight: '
    + '24px by `--sp-6`, WCAG 2.2 SC 2.5.8, on `.bucket-head-seen`\'s terms. '
    + 'They measured about 19px — `padding: 3px 9px` around `--fs-2xs` at '
    + 'line-height 1 plus a hairline, the smallest controls in the app, found '
    + 'by this census and not by a reader. The overlay that would reach 44 '
    + 'would overhang the OTHER chip, and both are live choosers; growing the '
    + 'visible box is the only safe direction, and a 44px pill in a meta row '
    + 'is a different design. The operator chose the WCAG floor.',
};

/** OVERLAY entries name the pseudo-rule that reaches the floor. */
const OVERLAYS: Record<string, string> = {
  'fleet/ProjectCardHead.tsx <button> proj-card-add': '.proj-card-add::before',
  'fleet/SessionLine.tsx <button> sess-actions': '.sess-actions::before',
};

/** The TOKEN entries that reach the floor by VALUE rather than by name.
 *
 *  `.fab` is `height: 56px`, twelve pixels ABOVE it, because a floating action
 *  button is the one control sized for the thumb that is already moving;
 *  `var(--tap-min)` there would SHRINK it. `.composer-input` is `padding: 10px
 *  0` around `--fs-input` at `--lh-normal` — 10 + 24 + 10 = 44 exactly — and
 *  the token there would fight the line-box arithmetic instead of expressing
 *  it. Both say so in their own entries. */
const FLOOR_BY_VALUE = ['fab', 'composer-input'];

/** The class half of a key — past the file and past the `<tag>`. */
const classOfKey = (key: string): string => key.slice(key.indexOf('> ') + 2);

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


  it('verifies every VARIANT claim against the design system itself', () => {
    // The anchors wearing `buttonVariants()` get their floor from @ccrc/ui's
    // own class string, not from a stylesheet rule — so this reads the string.
    const cited = Object.entries(CONTROLS).filter(([, v]) => v.startsWith('VARIANT'));
    expect(cited.length, 'the VARIANT arm has entries').toBeGreaterThan(0);
    for (const [k, v] of cited) {
      expect(v, k).toContain('buttonVariants');
      expect(buttonVariants({ variant: 'ghost' }), k).toContain('min-h-tap');
    }
  });

  it('keeps every INLINE control genuinely inline', () => {
    // WCAG 2.2 SC 2.5.8 exempts a target in a sentence or block of text. The
    // check that keeps this arm honest is the negative: an INLINE entry whose
    // class GAINS a floor is no longer inline prose, and the entry is wrong.
    const grown = Object.entries(CONTROLS)
      .filter(([, v]) => v.startsWith('INLINE'))
      .filter(([k]) => {
        const cls = classOfKey(k);
        return !cls.startsWith('(') && cls.split(/\s+/).some(classHasFloor);
      })
      .map(([k]) => k).sort();
    expect(grown, 'this now declares --tap-min — it is not an inline target').toEqual([]);
  });


  it('makes a control with a computed or absent class cite the rule that answers for it', () => {
    // THE HOLE THIS CLOSES, measured. `.bell` gained both floors and this
    // census stayed green: its key's class is `(computed)`, the TOKEN check
    // skips such a key as unverifiable and the UNDER negative skipped it too
    // — so an entry saying "UNDER, about 25px" survived the control no longer
    // being under anything. A verdict nothing can check is a comment.
    //
    // So a key with no literal class must name a selector after its verdict,
    // and the arms above verify that selector: TOKEN and SELECTOR require it
    // to declare the floor, UNDER requires it NOT to. INLINE and VARIANT have
    // their own evidence and need none.
    const needsCite = Object.entries(CONTROLS)
      .filter(([k]) => classOfKey(k).startsWith('('))
      .filter(([, v]) => !v.startsWith('INLINE') && !v.startsWith('VARIANT'));
    expect(needsCite.length, 'there are computed-class controls to check').toBeGreaterThan(2);
    const bare = needsCite
      .filter(([, v]) => /^[A-Z]+[.,]/.test(v) || !/^[A-Z]+ \S/.test(v))
      .map(([k]) => k).sort();
    expect(bare, 'this class is computed or absent — name the rule that answers for it').toEqual([]);
    const wrong = needsCite.filter(([, v]) => {
      const sel = /^[A-Z]+ (.+?)[.,](?:\s|$)/.exec(v)?.[1] ?? '';
      if (sel === '') return true;
      const floored = selectorHasFloor(sel) || sel.split(/\s+/).every((p) => !p.startsWith('.'))
        ? selectorHasFloor(sel)
        : classHasFloor(sel.replace(/^\./, ''));
      return v.startsWith('UNDER') ? floored : !floored;
    }).map(([k]) => k).sort();
    expect(wrong, 'the cited rule does not say what the verdict claims').toEqual([]);
  });

  it('reads the app and the stylesheets at all', () => {
    expect(controls().size).toBeGreaterThan(30);
    expect(RULES.length).toBeGreaterThan(500);
    expect(RULES.filter((r) => /--tap-min/.test(r.body)).length).toBeGreaterThan(20);
  });
});
