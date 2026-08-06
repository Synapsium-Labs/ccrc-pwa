// WCAG 2.1 contrast gate for the ccrc "phosphor & ink" design system.
// Run: node design/contrast-check.mjs — every ratio quoted in tokens.css comes
// from here, and this is the command the plan, the reviews and the release
// chain all name.
//
// It used to be a hand-typed copy of tokens.css (a `D` and an `Lt` table of
// hexes) measured against a hand-typed list of token pairs. That shape is
// exactly why a 2.44:1 blocker and a fifteen-pair opacity failure both shipped
// with this gate printing ALL 94 PASS: a pair nobody typed is a pair nothing
// measures, and a table nobody re-typed is a table that drifts (deviations 86
// and 87 were both "the table and the stylesheet disagree").
//
// Now: the palettes are PARSED from src/styles/tokens.css, and the pairs come
// in two halves.
//
//   * TOKEN PAIRS (below) — combinations the design system promises to hold
//     wherever they are used, including as defensive floors for combinations
//     with no live use site today. These are a deliberate hand-written
//     contract, not a copy: only the labels and the pairing are typed here,
//     never a colour.
//   * THE STYLESHEETS — design/audit.mjs reads every .css file under src/ and
//     measures what the rules actually say. Nobody registers anything.
//
// A failure in either half is a FAIL row and a non-zero exit.
import { audit, contrast, resolveColor } from './audit.mjs';

const report = audit();
const { DARK, LIGHT } = report.themes;

/** A token pair is named by its tokens.css custom property; the hex is looked
 *  up per theme, so there is no second copy of the palette to keep in sync. */
const palette = (theme) => {
  const of = (name) => {
    const c = resolveColor(`var(${name})`, theme);
    if (c[3] !== 1) throw new Error(`${name} is translucent; token pairs must be opaque`);
    return c;
  };
  return {
    page: of('--bg-page'), surface: of('--bg-surface'), raised: of('--bg-raised'),
    well: of('--bg-well'), sheet: of('--bg-sheet'), edgeStrong: of('--edge-strong'),
    inkP: of('--ink-primary'), inkS: of('--ink-secondary'), inkT: of('--ink-tertiary'),
    inkWell: of('--ink-on-well'),
    accent: of('--accent'), accentInk: of('--ink-on-accent'), accentTint: of('--accent-tint'),
    busy: of('--status-busy'), busyText: of('--status-busy-text'), idle: of('--status-idle'),
    att: of('--status-attention'), attText: of('--status-attention-text'), attTint: of('--status-attention-tint'),
    dead: of('--status-dead'), deadText: of('--status-dead-text'), deadTintSolid: of('--status-dead-tint-solid'),
    done: of('--status-done'), doneText: of('--status-done-text'),
    cleanup: of('--status-cleanup'), cleanupText: of('--status-cleanup-text'),
    claude: of('--acct-claude'), claudeT: of('--acct-claude-tint'),
    claude2: of('--acct-claude2'), claude2T: of('--acct-claude2-tint'),
    corp: of('--acct-corp'), corpT: of('--acct-corp-tint'),
    gpt: of('--acct-gpt'), gptT: of('--acct-gpt-tint'),
    track: of('--limit-track'), lOk: of('--limit-ok'), lWarn: of('--limit-warn'), lCrit: of('--limit-critical'),
    diffAdd: of('--diff-add'), diffDel: of('--diff-del'),
    accentOnWell: of('--accent-on-well'),
    // --pr-merged (tokens.css) aliases --acct-claude2, so it resolves to that
    // same hex per theme rather than being a second colour to keep in sync.
    prMerged: of('--pr-merged'),
  };
};

const hex = (c) => '#' + [0, 1, 2].map((i) => Math.round(c[i]).toString(16).padStart(2, '0')).join('');

const pairs = (T, name) => [
  [`${name} ink-primary / surface`, T.inkP, T.surface, 4.5],
  [`${name} ink-primary / raised`, T.inkP, T.raised, 4.5],
  [`${name} ink-primary / page`, T.inkP, T.page, 4.5],
  [`${name} ink-primary / sheet`, T.inkP, T.sheet, 4.5],
  [`${name} ink-primary / accent-tint`, T.inkP, T.accentTint, 4.5],
  [`${name} ink-secondary / surface`, T.inkS, T.surface, 4.5],
  // Also the exact pair the fleet-polish task's two new icon buttons use
  // (.proj-card-add, .sess-actions: ink-secondary glyph on a bg-raised
  // fill) — a new USE SITE of an already-gated combination, not a new one.
  // Their bg-raised/edge-subtle affordance itself (fill vs the surface
  // behind it, and the 1px border vs either) is deliberately NOT gated
  // here: both measure ~1.1-1.3:1 in both themes (raised is barely a shade
  // off surface by design), nowhere near the 3:1 non-text floor, and no
  // token substitution fixes that without inventing a new one — every
  // other raised+edge-subtle affordance in this file (.proj-search,
  // .account-gauge, .notice, .acct-list .acct-row) is exempt for the same
  // reason tokens.css gives hairlines: "decorative — no contrast claim".
  [`${name} ink-secondary / raised`, T.inkS, T.raised, 4.5],
  [`${name} ink-secondary / sheet`, T.inkS, T.sheet, 4.5],
  [`${name} ink-tertiary / surface`, T.inkT, T.surface, 4.5],
  [`${name} ink-tertiary / raised`, T.inkT, T.raised, 4.5],
  [`${name} ink-tertiary / page`, T.inkT, T.page, 4.5],
  [`${name} ink-on-well / well`, T.inkWell, T.well, 4.5],
  [`${name} ink-on-accent / accent`, T.accentInk, T.accent, 4.5],
  // Every mono "working" readout on a card ground: the chat header's
  // .status-line--busy and (this branch) the fleet row's
  // .sess-state--working — both sit on .chat-head / .proj-card, i.e. surface.
  [`${name} busy-text / surface`, T.busyText, T.surface, 4.5],
  [`${name} busy dot / surface (UI 3:1)`, T.busy, T.surface, 3],
  [`${name} busy dot / page (UI 3:1)`, T.busy, T.page, 3],
  [`${name} busy dot / lamp well (UI 3:1)`, T.busy, T.well, 3],
  [`${name} idle dot / surface (UI 3:1)`, T.idle, T.surface, 3],
  [`${name} idle dot / lamp well (UI 3:1)`, T.idle, T.well, 3],
  // `done` and `cleanup` (Build 2) — the two-glyph rule's new buckets. Both
  // dots sit on --bg-surface (a project card) and --bg-well (.sess-lamp),
  // exactly like busy/attention/idle/dead above; the state word (a row's
  // `.sess-state--*`, currently unstyled and inheriting ink-secondary) has no
  // pair of its own for the same reason `.sess-state--exited` doesn't — it
  // never overrides colour. `-text` is measured anyway, as a defensive floor
  // for the day something DOES paint with it directly (the class every other
  // status token in this list already keeps).
  [`${name} done dot / surface (UI 3:1)`, T.done, T.surface, 3],
  [`${name} done dot / lamp well (UI 3:1)`, T.done, T.well, 3],
  [`${name} done-text / surface`, T.doneText, T.surface, 4.5],
  [`${name} cleanup dot / surface (UI 3:1)`, T.cleanup, T.surface, 3],
  [`${name} cleanup dot / lamp well (UI 3:1)`, T.cleanup, T.well, 3],
  [`${name} cleanup-text / surface`, T.cleanupText, T.surface, 4.5],
  [`${name} attention-text / att-tint`, T.attText, T.attTint, 4.5],
  // Three readouts share this ground now: the chat header's
  // .status-line--attention, the fleet row's .sess-state--waiting, and the
  // project card header's .proj-card-attn dot — all sit on .chat-head /
  // .proj-card, i.e. surface.
  [`${name} attention-text / surface`, T.attText, T.surface, 4.5],
  [`${name} attention dot / surface (UI 3:1)`, T.att, T.surface, 3],
  [`${name} attention dot / lamp well (UI 3:1)`, T.att, T.well, 3],
  // .proj-card-attn (".proj-group-attn"'s replacement — the project header's
  // "waiting on you" glyph) sits on the card surface now, not the bare page:
  // every project always has a card ground since this branch's reshape, so
  // the literal dot/page scenario this pair was written for no longer has a
  // live counterpart. Kept anyway as a defensive floor on the raw dot hue
  // (rather than dropped as "nothing renders this"): test/contrast.test.ts
  // pins this exact pair, and a future header that DOES land directly on the
  // page — no card ground, same glyph-at-3:1 shape — should find the gate
  // already watching rather than silently uncovered.
  [`${name} attention dot / page (UI 3:1)`, T.att, T.page, 3],
  // Originally the `+` affordance's projected-account line when the landing
  // account was near its ceiling (.proj-add-acct[data-low], 11px body text at
  // 4.5 — which is why it took attention-TEXT and not the dot hue: LIGHT's
  // dot (#B27400) reads 3.58 here and would fail this threshold). That element
  // is gone (ccrc/fleet-polish Task 4 dropped the visible headroom flag
  // entirely), but this pair is kept for the same reason as the dot/page pair
  // above: a defensive floor on the raw attention-text/page combination that
  // test/contrast.test.ts still pins, so any future text that lands directly
  // on the page at this size/hue finds the gate already watching.
  [`${name} attention-text / page`, T.attText, T.page, 4.5],
  // The chat header's .status-line--dead and (this branch) the fleet row's
  // .sess-warn critical-limit glyph both take dead-text on a surface ground.
  [`${name} dead-text / surface`, T.deadText, T.surface, 4.5],
  [`${name} dead dot / surface (UI 3:1)`, T.dead, T.surface, 3],
  [`${name} dead dot / lamp well (UI 3:1)`, T.dead, T.well, 3],
  // --status-dead-tint-solid IS the 12% wash pre-composited on a card, so this
  // no longer mixes anything here; tokens.css owns the 12% and audit.mjs pins
  // the solid token against the translucent one it derives from.
  [`${name} dead-text / EXIT-badge pill (12% dead over surface)`, T.deadText, T.deadTintSolid, 4.5],
  [`${name} acct claude / tint`, T.claude, T.claudeT, 4.5],
  [`${name} acct claude2 / tint`, T.claude2, T.claude2T, 4.5],
  [`${name} acct corp / tint`, T.corp, T.corpT, 4.5],
  [`${name} acct gpt / tint`, T.gpt, T.gptT, 4.5],
  // The fleet row's .sess-acct label takes the account hue directly (no
  // tint pill, unlike the pickers above) straight on the project card's
  // surface ground — a genuinely new combination this branch introduces.
  [`${name} acct claude / surface (sess-acct)`, T.claude, T.surface, 4.5],
  [`${name} acct claude2 / surface (sess-acct)`, T.claude2, T.surface, 4.5],
  [`${name} acct corp / surface (sess-acct)`, T.corp, T.surface, 4.5],
  [`${name} acct gpt / surface (sess-acct)`, T.gpt, T.surface, 4.5],
  // The PR keycap's merged dot (--pr-merged, tokens.css) on the keycap's own
  // background (--bg-raised). A non-text graphical object, so 3:1, not 4.5.
  [`${name} pr-merged / raised (UI 3:1)`, T.prMerged, T.raised, 3],
  [`${name} limit ok / track (UI 3:1)`, T.lOk, T.track, 3],
  [`${name} limit warn / track (UI 3:1)`, T.lWarn, T.track, 3],
  [`${name} limit crit / track (UI 3:1)`, T.lCrit, T.track, 3],
  // The ask sheet's two accent-on-quiet-ground texts. Both are 11px
  // (--text-2xs), so both are body text at 4.5 — not the 3:1 UI threshold.
  [`${name} ask header chip / accent-tint`, T.accent, T.accentTint, 4.5],
  [`${name} preview toggle / sheet`, T.accent, T.sheet, 4.5],
  [`${name} diff-add / well`, T.diffAdd, T.well, 4.5],
  [`${name} diff-del / well`, T.diffDel, T.well, 4.5],
  // The code block's COPY / COPIED label. --accent flips with the theme and the
  // light one is tuned for paper, so on a well — which is dark in BOTH themes —
  // it read 3.03:1 and shipped that way. --accent-on-well is the well spelling
  // of the accent; both floors are the 4.5 body floor because the label is 11px
  // (--text-2xs), not a glyph. Two grounds, because the affordance is on the
  // BAR and the bar is on the well.
  [`${name} accent-on-well / well`, T.accentOnWell, T.well, 4.5],
  [`${name} accent focus ring / page (UI 3:1)`, T.accent, T.page, 3],
  // The selected fleet row inverts (.sess-line--active: background
  // --ink-primary), so its 12px meta line takes --edge-strong ON the slab — a
  // hairline token used as text, which is the ONE genuinely new combination
  // this treatment introduces. Everything else it needs is already gated and
  // ratios are symmetric: the label's ink (--bg-page on --ink-primary) is
  // `ink-primary / page`, the ··· glyph is `ink-secondary / page`, and the four
  // dots on the lamp plate are the `* dot / lamp well` pairs.
  // Do NOT add "dot on the selected slab" pairs: pairs() runs every entry in
  // BOTH themes (line below), and those dots measure 1.55-2.87 in dark, which
  // would redden the gate for a state that cannot occur — the plate is what
  // they actually sit on.
  [`${name} selected-row meta ink / slab`, T.edgeStrong, T.inkP, 4.5],
];

let fail = 0, n = 0;

console.log(`# token pairs — the design system's standing contract`);
for (const [label, fg, bg, min] of [...pairs(palette(DARK), 'DARK '), ...pairs(palette(LIGHT), 'LIGHT')]) {
  const r = contrast(fg, bg);
  const ok = r >= min;
  if (!ok) fail++;
  n++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${r.toFixed(2).padStart(6)}  (min ${min})  ${label}  ${hex(fg)} on ${hex(bg)}`);
}

console.log(`\n# stylesheets — ${report.sheets.join(', ')}`);
console.log(
  `# ${report.counts.rules} rules, ${report.counts.selfGrounded} self-grounded, `
  + `${report.counts.pseudo} pseudo-element children, ${report.counts.descendant} named-ancestor descendants, `
  + `${report.counts.inherited} inherited-ground, `
  + `${report.counts.faded} element fades, ${report.counts.keyframes} keyframe blocks`,
);
// The blind spot, PRINTED rather than described. Every round of this gate has
// been forged the same way — it measures the shapes someone thought of — so the
// count of rules it could not ground belongs in the output next to the count of
// rules it could. These are not failures: they are colour rules whose ground is
// genuinely inherited from an ancestor the selector does not name, which is DOM
// knowledge a stylesheet parser cannot recover. `--uncovered` lists them.
console.log(
  `# ${report.counts.uncovered} rules set a colour with no ground this auditor can recover`
  + ' — run with --uncovered to list them',
);
if (process.argv.includes('--uncovered')) for (const k of report.uncovered) console.log(`#   ${k}`);
for (const m of report.measured) {
  if (!m.ok) fail++;
  n++;
  console.log(`${m.ok ? 'PASS' : 'FAIL'}  ${m.ratio.toFixed(2).padStart(6)}  (min ${m.floor})  ${m.label}  ${m.detail}`);
}

// A structural problem — an unregistered fade, an unparsed colour, a registry
// entry pointing at a rule that no longer exists — is a gate failure in its
// own right. It means the audit could not measure something, which is the
// state every defect this gate has ever missed was in.
for (const p of report.problems) {
  fail++;
  n++;
  console.log(`FAIL  ------  (audit)  ${p}`);
}

console.log(fail ? `\n${fail} FAILURES of ${n}` : `\nALL ${n} PASS`);
// The gate is the last link of `npx vitest run && npm run build && node
// design/contrast-check.mjs`, so a failing pair has to be a non-zero exit —
// printing "N FAILURES" and exiting 0 makes every chain green over a live
// violation.
process.exitCode = fail ? 1 : 0;
