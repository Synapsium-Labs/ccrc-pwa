# Design-system audit — close-out: every item, what delivered it, what keeps it

**Date:** 2026-10-11. **Status:** CLOSED. Every item of the audit's queue is delivered — eight
landed, one refused with the measurement that refused it — and both items that needed the
operator's ruling were ruled and landed. Nothing in the queue is open, deferred or in progress.

**The audit:** `docs/superpowers/specs/2026-10-11-design-system-audit.html`, in this repo as
HTML beside `2026-10-07-box-token-lifecycle-design.html`. It was a claude.ai artifact twice and
was lost twice — the first link deleted out from under the session, the republished one reported
"artifact not found" by its own watch within the minute. A record that can disappear while you
read it is not a record, so the operator's question "artifact again, or into the repo?" is
answered here, in the tree, by the file existing.

**Why this document exists at all.** The audit page says what each item BECAME. It does not say
which commit delivered it or which red suite now keeps it true, and a queue whose closure lives
only in a conversation is a queue nobody can re-audit. This is the mapping, and it is the last
artifact of the wave.

**AND IT IS CHECKED, because prose is a request.** `server/test/closeout-claims.test.ts` reads
this file: every commit the table cites must resolve as a commit AND be an ancestor of this
branch (a hash from someone else's branch is a citation to nowhere), every suite it names as a
mechanism must exist (a renamed guard turns the table into a list of reassurances), the audit
page it maps must be present, the `**Status:** CLOSED` line above must say so, and all twelve
rows must be there — a close-out that quietly dropped one would still read as complete.
Measured: changing one digit of one cited hash is 1 red. What that test deliberately does NOT
judge is whether an item was a good idea or whether the mechanism named is the right one; those
are judgements, and the line is the one `design-declaration.test.ts` draws when it checks that a
posture was declared and never which one.

**Anchors** are this branch at `ebb216ab`; the audit was first measured at `a05de021`. Line
numbers are not quoted — trust the shipped source's own comments over this file.

**Deviation numbers:** this document defines none and mints none. It deliberately carries no
`D-<n>` token at all: the ledger floor is seeded from the highest one in `plans/` and `specs/`
and only ever rises, so a mention in a document that allocates nothing would burn a band
forever.

## Design

**Posture:** none

**Why:** this document is a RECORD of work already shipped and already ruled. It renders
nothing and proposes nothing. The two items in it that changed what the operator sees — V1 and
V2 — were not designed against a canvas and could not have been: each was a single measured
dimension (a control's visible box, against WCAG 2.5.5's 44px and 2.5.8's 24px) with its
trade-off already written out in the stylesheet, and what they needed was a ruling, which they
got in conversation. A canvas would have depicted the same two numbers.

## The queue, item by item

| # | item | verdict | commit | what keeps it |
|---|---|---|---|---|
| 1 | guard the class-string constants | landed before this wave's close | `a05de021` | `design-system-boundary.test.ts`'s `skinConstants` — ownership derived from the export statements, so a new primitive is covered the day it lands |
| 2 | name the shared glyphs | landed before this wave's close | `a05de021` | the same guard's second surface, plus the three `*_GLYPH` exports |
| 3 | stable contrast-gate key | LANDED | `08a35466` | `audit.mjs` reports a selector two sheets declare; `audit-refusals.test.ts` pins both arms, and deleting the loop is 1 red (measured) |
| 4 | fold the app-internal duplicate clusters | LANDED, nine of them | `4cc91d40` | `shape-census.test.ts`, whose registry is checked in both directions — a folded cluster's entry is stale and reds |
| 5 | `Select` primitive | LANDED | `a7b75d5d` | `fleet-css.test.ts` pins the tailwind-merge replacement where it used to pin a specificity tie; `tap-targets.test.tsx` reads the floor off `SELECT` |
| 6 | hoist the mail-strip / task-strip skins | LANDED, four of five | `8ecd1df7` | the same census; the fifth cluster's entry now states the ground argument that keeps it twinned |
| 7 | `Radio` / `RadioFieldset` primitive | LANDED | `cbb79f00` | `tap-targets.test.tsx` reads `min-h-tap` off `RADIO_OPTION`; `focus-ring.test.ts` counts the input |
| 8 | Storybook test-runner and axe in CI | LANDED | `8e08ec7d` | the `storybook-a11y` job — 152 stories through headless chromium, green on its first run |
| 9 | typed variant axes for `Chip` and `Well` | **REFUSED** | `f2f42dd9` | the refusal is the deliverable: both component headers carry the measurement, so the next audit meets the answer instead of the question |
| 10 | token reference page | LANDED | `f2f42dd9` | it reads the CSSOM, so it cannot drift from the palette it shows; `build-storybook` in CI proves it compiles |
| V1 | the two session-header meta chips to 44px | RULED, LANDED | `6072ccfc` | `control-census.test.ts` — re-registered TOKEN/SELECTOR, and its UNDER arm's count asserts 2 |
| V2 | the seen chip and the compaction disclosure to 44px | RULED, LANDED | `6072ccfc` | the same census, plus `fleet-css.test.ts`'s own floor assertion |

### Why #9 is a delivery and not a gap

The audit asked for a `tone` axis on two components. Measured instead of argued: `Chip`'s three
modifiers are `--acct-active` on its tint (an account alias, ccrc routing vocabulary),
`--ink-tertiary` on `--bg-raised` (a contrast decision whose own rule carries its 3.17:1
measurement) and `font-family: mono` (not a tone at all). One word cannot mean an account
vocabulary, one screen's contrast argument and a typeface. `Well`'s five call-site classes are
per-box layout — naming them would put the design system in charge of five layouts it cannot
see. Both headers now carry that, which is what stops the next reader re-opening it.

**The other half WAS applied, in the app.** The audit's observation — "the call sites already
spell tones as free-form strings" — was right, and refusing the axis left it standing:
`className="chip--activ"` compiled, rendered an unskinned pill and said nothing. The modifier is
an app decision, so the type that catches the typo belongs in the app:
`pwa/src/session/chipTones.ts` names the three chip tones and the four meta-chip tones as unions
behind `chipTone()` / `metaChipTone()`, and the seven call sites in `SessionHeader` go through
them. `markup-census.test.ts` pins both directions — every tone the map can produce must name a
rule some stylesheet declares (a renamed rule is a silent no-op), and the map is the only place
those strings may be typed. Nothing about the rendering changed; they are the same seven class
strings chat.css has always skinned.

## What the work found that reading the source could not

Four defects, none visible to an audit, because every guard in this repo reads SOURCE and
vitest runs with `css: false`.

| defect | how it surfaced | fix | mechanism |
|---|---|---|---|
| `cn` dropped a utility on the way to the DOM — `TEXT_INPUT` and `SELECT` rendered with NO ink utility, `Well` and `ControlRow` in the UI family rather than mono, seven strings in all | writing `Select` and reading the merged string | `cn.ts` declares the two renamed families as their real groups | `utility-pairs.test.ts` measures the composed CONSTANTS, not the per-file literals — the only source that can see it, since `TEXT_INPUT` is five literals with comments between them |
| `Well` — a scrollable `<pre>` no keyboard could focus | axe `scrollable-region-focusable`, first time a browser rendered the package | `tabIndex={0}` and the focus ring, both overridable | `storybook-a11y` |
| `TypedLabel` — `aria-label` on a roleless `<span>`, so the accessibility tree DROPPED the stable name that is the component's whole purpose | axe `aria-prohibited-attr` | `role="img"` | `storybook-a11y` |
| two story fixtures modelling the app's own call sites wrong — a nameless `Keycap`, an unnamed `CoverScreen` dialog | axe `button-name`, `aria-dialog-name` | the labels the real call sites already pass | `storybook-a11y` |

## The merge, and the two guards that earned their keep on it

`e45df884` merged `origin/main`. Two conflicts, both real: `SettingsScreen.tsx` (main added the
box-token card while this branch moved the update plane's reading surface out) and a citation
headline where two disjoint deltas met (this branch's `197 -> 202`, main's `197 -> 196`; the
headline is the SUM of the merged map, 201, and the test agrees).

Then main's new card met this branch's new guards. Its *Rotate now* had arrived as
`<button className="btn-ghost settings-check">` — the `Button` primitive's own class, written by
hand, six lines from a sibling in the same file that uses the component. Both guards named it:
`control-census` as an unregistered hand-drawn control, `design-system-boundary` as a class the
primitive owns. It is `<Button variant="ghost">` now.

`76a1c8a0` is the other half of the same story: `design-declaration.test.ts` is this branch's
guard and its scope boundary is a filename date, so merging the trees asked two of main's plans
a posture question that did not exist when they were filed. Both answered `none`, in their own
words, appended at the end of each file so no citation anchor moves.

## Verification at close

- `pwa`: **4031 tests / 138 files**, `tsc` clean. `ui`: `tsc` clean, `themes:check` clean,
  `build-storybook` clean, **152 stories pass axe in chromium**.
- Contrast gate: **ALL 3372 PASS**. It was 3456 before the wave; the drop is five rules now
  measured once instead of twice — the same pixels, grouped. Not a coverage loss, and the
  census's both-directions checks are what say so.
- CI on `ebb216ab`: every REQUIRED leg green — `test (server)`, `test (pwa)`, `test (agent)`,
  `build-pwa`, `node floor`, `probe-macos`, `typecheck (server)`, all five server shards, and
  `storybook-a11y`.
- `test-macos` and the `full-suite` aggregate are red, and both are additive and non-required by
  this repo's own design. The failing FILE SET there is non-deterministic, measured rather than
  assumed: main's daily fails 6, this branch at `76a1c8a0` failed the same 6, at `ebb216ab`
  failed 8, and a re-run of that same job on that same commit failed 10. One unchanged tree, two
  attempts, two different sets. The six that appear in every run are identical to main's own
  daily — the repo's standing macOS debt, not this branch's. The surplus is always `ccd-*` and
  always a process path (a row compaction lock, `timeout`'s 124, a SIGTERM to a process group
  inside `docs_helper.py`) in the suite's own fixture trees.

## Not in this wave (owner, why)

- **shadcn interop.** The operator's standing goal is that `@ccrc/ui` CONSUMES shadcn rather
  than being replaced by it. Nothing here moves toward or against it; the four known blockers
  are unchanged.
- **RTL.** Refused earlier and still refused: three logical properties against about 26
  physical ones, on a single-operator English console.
- **A seventh census.** The audit's "already settled" list is in the page for this reason — six
  censuses and five design tests already exist, each mutation-tested, and adding a second
  mechanism for something that has one is churn.

## Review Focus

1. The gate's key change (`08a35466`) is the one edit with reach: ~350 registry keys lost a
   filename. The thing to check is not the keys but the two arms of the new uniqueness
   mechanism, and that the gate's row count moved for the stated reason.
2. `cn.ts` (`a7b75d5d`). It changes what every component renders. Both declared groups are
   load-bearing — deleting either is one red — and the guard reads the composed constants.
3. V1 and V2 (`6072ccfc`) are the only visual changes in the wave. V1's floor is on
   `button.metachip` and NOT on `.metachip`, which is what leaves `.metachip--branch` — a span,
   a label — at 24px. That distinction is the whole safety argument.
