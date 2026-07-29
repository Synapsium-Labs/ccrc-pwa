// WCAG 2.1 contrast checker for the ccrc "phosphor & ink" token set.
// Run: node contrast-check.mjs — every ratio quoted in tokens.css comes from here.
const lin = (c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const L = (hex) => {
  const [r, g, b] = [1, 3, 5].map((i) => lin(parseInt(hex.slice(i, i + 2), 16) / 255));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const cr = (a, b) => {
  const [hi, lo] = [L(a), L(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};
// alpha-composite fg over bg (for the 12%-alpha EXIT-badge pill)
const chan = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const mix = (fg, bg, a) => {
  const f = chan(fg), b = chan(bg);
  return "#" + f.map((c, i) => Math.round(a * c + (1 - a) * b[i]).toString(16).padStart(2, "0")).join("");
};

const D = {
  page: "#0B0D0C", surface: "#141715", raised: "#1C201D", well: "#070808",
  sheet: "#181C19",
  inkP: "#ECF0EC", inkS: "#ADB6AE", inkT: "#8B948C", inkWell: "#DEE4DE",
  accent: "#45D67E", accentInk: "#082312", accentTint: "#12291B",
  busy: "#45D67E", busyText: "#57E08B", idle: "#7C867D",
  att: "#F2B84B", attText: "#F2B84B", attTint: "#2E2413",
  dead: "#E06A55", deadText: "#E8836F",
  claude: "#6FD6EA", claudeT: "#0E2A31",
  claude2: "#C7A7F4", claude2T: "#241C38",
  corp: "#96B4F4", corpT: "#16233B",
  gpt: "#F0A3C8", gptT: "#331B28",
  track: "#242A25", lOk: "#45D67E", lWarn: "#F2B84B", lCrit: "#E06A55",
  diffAdd: "#57E08B", diffDel: "#F08A78",
};
const Lt = {
  page: "#F4F6F3", surface: "#FFFFFF", raised: "#EAEEEA", well: "#141715",
  sheet: "#FFFFFF",
  inkP: "#1A201B", inkS: "#4E5850", inkT: "#5F6962", inkWell: "#DEE4DE",
  accent: "#0E7B3F", accentInk: "#FFFFFF", accentTint: "#DFF2E5",
  busy: "#178A48", busyText: "#106E39", idle: "#6C766E",
  att: "#B27400", attText: "#8A5A0A", attTint: "#F7E9CF",
  dead: "#B2402C", deadText: "#B2402C",
  claude: "#0A6377", claudeT: "#DAF0F6",
  claude2: "#6D3FB4", claude2T: "#EDE6FA",
  corp: "#2F55B8", corpT: "#E3EAFA",
  gpt: "#A62667", gptT: "#FAE3EE",
  track: "#E3E7E2", lOk: "#178A48", lWarn: "#B27400", lCrit: "#B2402C",
  diffAdd: "#57E08B", diffDel: "#F08A78",
};

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
  [`${name} dead-text / EXIT-badge pill (12% dead over surface)`, T.deadText, mix(T.dead, T.surface, 0.12), 4.5],
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
  [`${name} limit ok / track (UI 3:1)`, T.lOk, T.track, 3],
  [`${name} limit warn / track (UI 3:1)`, T.lWarn, T.track, 3],
  [`${name} limit crit / track (UI 3:1)`, T.lCrit, T.track, 3],
  // The ask sheet's two accent-on-quiet-ground texts. Both are 11px
  // (--text-2xs), so both are body text at 4.5 — not the 3:1 UI threshold.
  [`${name} ask header chip / accent-tint`, T.accent, T.accentTint, 4.5],
  [`${name} preview toggle / sheet`, T.accent, T.sheet, 4.5],
  [`${name} diff-add / well`, T.diffAdd, T.well, 4.5],
  [`${name} diff-del / well`, T.diffDel, T.well, 4.5],
  [`${name} accent focus ring / page (UI 3:1)`, T.accent, T.page, 3],
];

let fail = 0, n = 0;
for (const [label, fg, bg, min] of [...pairs(D, "DARK "), ...pairs(Lt, "LIGHT")]) {
  const r = cr(fg, bg);
  const ok = r >= min;
  if (!ok) fail++;
  n++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${r.toFixed(2).padStart(6)}  (min ${min})  ${label}  ${fg} on ${bg}`);
}
console.log(fail ? `\n${fail} FAILURES of ${n}` : `\nALL ${n} PASS`);
// The gate is the last link of `npx vitest run && npm run build && node
// design/contrast-check.mjs`, so a failing pair has to be a non-zero exit —
// printing "N FAILURES" and exiting 0 makes every chain green over a live
// violation.
process.exitCode = fail ? 1 : 0;
