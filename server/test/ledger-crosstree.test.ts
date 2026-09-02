// F7's ledger guard, half one: the PURE decision, over fixtures.
//
// The hole this closes has fired three times. `deviation-refs.test.ts`'s
// collision scan reads ONE checkout, so two branches each holding one of the two
// definitions are BOTH green, and the pair only co-resides after the loser merges
// — one merge too late. Three properties fix it, and each was measured before it
// was written (D-1294, D-1295):
//
//   1. CROSS-TREE — compare this branch's definitions against origin/main's,
//      without merging.
//   2. SUBJECT-FREE, for allocator-era numbers only — the allocator issues each
//      number once for one purpose, so two DEFINING files is a defect regardless
//      of wording. Today's scan additionally requires two distinct SUBJECTS,
//      which is what the pre-allocator grandfathering needs; scoping the new rule
//      to n >= 211 leaves GRANDFATHERED untouched and its "may only SHRINK"
//      invariant intact.
//   3. WIDER RECOGNITION than ENTRY's `—\s*(.+)$`, which demands the subject on
//      the same line: real definitions in today's plans are invisible to it,
//      D-1158 among them — one of the five numbers this program actually lost.
//      No cardinal here, deliberately (D-1320): the totals move with every plan,
//      and a count in a comment is stale by its own commit. What is stable is the
//      SHAPE, and every shape below is copied from a real plan.
import { describe, it, expect } from 'vitest';
import { crossTreeCollisions, definitionsIn, LEDGER_ALLOCATOR_ERA, projectEra,
         unallocatedDefinitions } from '../src/coord/ledger.js';

const f = (path: string, text: string): { path: string; text: string } => ({ path, text });

describe('definitionsIn — what counts as DEFINING a number', () => {
  it('reads both heading forms and the bullet form', () => {
    expect(definitionsIn([f('a.md', '### D-12 (bug) — subject')]).map((d) => d.n)).toEqual([12]);
    expect(definitionsIn([f('a.md', '- **D-108 (2026-08-20)** — subject')]).map((d) => d.n)).toEqual([108]);
    expect(definitionsIn([f('a.md', '## D-296 — subject')]).map((d) => d.n)).toEqual([296]);
  });

  it('reads the colon form and the WRAPPED form that ENTRY cannot see (D-1294)', () => {
    // Exactly PR #38's spelling of D-1158 — an em-dash at end of line with the
    // subject on the next — and build 9b's colon form. deviation-refs' ENTRY
    // matches neither, which is why half of the first incident was undetectable
    // even in a fully merged tree.
    expect(definitionsIn([f('a.md', '- **D-1158** (2026-08-31, found by running the suite) —\n  the subject')])
      .map((d) => d.n)).toEqual([1158]);
    expect(definitionsIn([f('b.md', '- **D-211** (Task 3): the entry')]).map((d) => d.n)).toEqual([211]);
  });

  it('is not fooled by a prose REFERENCE — this scans entries, not mentions', () => {
    expect(definitionsIn([f('a.md', 'see D-108 for the ruling')])).toEqual([]);
    expect(definitionsIn([f('a.md', 'The fix (D-1157) landed.')])).toEqual([]);
  });

  it('is not fooled by a LINE-INITIAL BOLDED citation, which is the shape this repo writes', () => {
    // The first version of this suite tested only MID-LINE mentions, and a
    // prefix-only DEFINITION called all four of these definitions. Every string
    // here is copied from a real plan on main. The second is the exact prose a
    // wave writes when it RECORDS a ledger collision — so a prefix-only rule reds
    // on the narrative describing the incident this guard exists to detect, and
    // tells the author to renumber a deviation they only cited.
    expect(definitionsIn([f('a.md', '- **D-149 sweep:** any task that touches the EXEMPT table')])).toEqual([]);
    expect(definitionsIn([f('a.md', '- **D-172, D-173 and D-174 were re-used** by this branch')])).toEqual([]);
    expect(definitionsIn([f('a.md', "- **D-291's wait — `startedSessionFor`.** It asks whether")])).toEqual([]);
    expect(definitionsIn([f('a.md', '- **D-1026 changes the shape the operator approved** (`ready: false`)')])).toEqual([]);
  });

  it('still reads all four ways a REAL entry opens', () => {
    // The other direction, so the tightening cannot quietly swallow entries: the
    // bold close, the em-dash, the parenthetical and the bare colon.
    const forms = [
      '- **D-900** — subject',            // bold close
      '## D-901 — subject',               // em-dash after a heading
      '### D-902 (bug) — subject',        // parenthetical
      '- **D-903**: subject',             // colon
      '- **D-904** (2026-08-20) — subject',
    ];
    expect(definitionsIn(forms.map((t, i) => f(`p${i}.md`, t))).map((d) => d.n))
      .toEqual([900, 901, 902, 903, 904]);
  });

  it('excludes a dotted SUB-entry, which cites its parent rather than defining it', () => {
    expect(definitionsIn([f('a.md', '- **D-310.1** — a finding under D-310')])).toEqual([]);
  });

  // ── D-1322 ────────────────────────────────────────────────────────────────
  // The first lookahead caught the whole-phrase-bold citation (tested above) and
  // MISSED the individually-bolded one, which is how every collision record in
  // this program is actually written — including the one D-1310's own entry
  // quotes. Wave 8 will narrate "D-1243 was taken by PR #42" about a number main
  // really defines, so the first shape below is not hypothetical: it is next
  // wave's red suite, with the remedy "renumber NOW" printed against a number the
  // branch only cited.
  it('is not fooled by INDIVIDUALLY bolded citations — the shape a collision record uses', () => {
    expect(definitionsIn([f('a.md', '- **D-1231** and **D-1232** were re-used by this branch')])).toEqual([]);
    expect(definitionsIn([f('a.md', '- **D-1157** and **D-1158** were taken by PR #38')])).toEqual([]);
    expect(definitionsIn([f('a.md', '- **D-1243** was taken by PR #42, and this wave renumbered')])).toEqual([]);
    // The range citation, which every wave's closing paragraph writes.
    expect(definitionsIn([f('a.md', '**D-1039..D-1045** (seven). **D-1046 is the only number left.**')])).toEqual([]);
    expect(definitionsIn([f('a.md', '**D-1209**, allocated fresh from the allocator (floor now 1210).')])).toEqual([]);
    // A trailing bold with no entry punctuation after it is a citation too.
    expect(definitionsIn([f('a.md', '**D-1153**.')])).toEqual([]);
  });

  it('reads the BARE-BOLD entry, which both ENTRY and the first draft were blind to', () => {
    // Four plans on main open every entry this way — build 8, stage 2e, the
    // worker skill, upstream-launcher-locks. A re-definition of any of those
    // numbers was silently missed by a guard whose subject is not missing one.
    // Strings copied verbatim from `origin/main`.
    expect(definitionsIn([f('a.md', '**D-297 — the `_spawn` split demoted a process-fatal error.** Task 3 gave')])
      .map((d) => d.n)).toEqual([297]);
    expect(definitionsIn([f('a.md', '**D-301 (was D-B8-5) — four guards were decorated, not pinned.** Review')])
      .map((d) => d.n)).toEqual([301]);
    expect(definitionsIn([f('a.md', '**D-99 — the remote-control switch is a FILE, not a config key.**')])
      .map((d) => d.n)).toEqual([99]);
  });

  it('does not let the bare-bold arm swallow a mid-sentence bold reference', () => {
    // The widened prefix is line-ANCHORED, so the arm can only ever fire at the
    // start of a line. This is the assertion that says so rather than assuming it.
    expect(definitionsIn([f('a.md', 'the fix for **D-297 — the split** landed in Task 3')])).toEqual([]);
    expect(definitionsIn([f('a.md', '  **D-297 — indented under a list item**')])).toEqual([]);
  });

  // ── D-1323 ────────────────────────────────────────────────────────────────
  it('does not read a QUOTED entry inside a code fence as a definition', () => {
    const quoting = [
      'This is the line the review argued about:',
      '',
      '```',
      '- **D-1231** — the entry another plan defines',
      '### D-1232 — and a heading form too',
      '```',
      '',
      '- **D-1300** — this plan\'s own entry, outside the fence',
    ].join('\n');
    expect(definitionsIn([f('a.md', quoting)]).map((d) => d.n)).toEqual([1300]);
    // Tilde fences too, and a fence carrying an info string.
    expect(definitionsIn([f('b.md', '~~~md\n- **D-1231** — quoted\n~~~')])).toEqual([]);
    expect(definitionsIn([f('c.md', '```markdown\n### D-1231 — quoted\n```')])).toEqual([]);
  });

  it('scans a file whose fence is never CLOSED whole, rather than going quiet after it', () => {
    // The fail-loud arm. An unclosed fence would otherwise put everything after
    // it "inside" a block, and a guard that silently stops reporting is worse
    // than one that over-reports — this is the direction the ambiguity resolves
    // in, asserted rather than described.
    const stray = ['```', 'an opened block nobody closed', '- **D-1300** — a real entry after it'].join('\n');
    expect(definitionsIn([f('a.md', stray)]).map((d) => d.n)).toEqual([1300]);
  });

  it('lets a ```` block quote a ``` block — the shape wave 1’s plan actually holds', () => {
    // Parity counting gets this backwards: it opens on the outer fence, closes on
    // the FIRST inner one, and reads the quoted block's middle as ordinary prose.
    // `2026-08-28-program-leverage-wave1-f1.md:216` is exactly this shape — a
    // ````markdown block quoting two ``` blocks — so the case is copied from the
    // corpus, not invented. A fence closes only on the same character at the same
    // length or longer.
    const nested = [
      '````markdown',
      '# a quoted document',
      '```',
      '- **D-1231** — quoted inside the quoted block',
      '```',
      '- **D-1232** — quoted in the outer block',
      '````',
      '- **D-1300** — this plan’s own entry',
    ].join('\n');
    expect(definitionsIn([f('a.md', nested)]).map((d) => d.n)).toEqual([1300]);
    // …and the other character never closes it: `~~~` cannot end a ``` block, so
    // a file that tries reads as never-closed and is scanned whole.
    expect(definitionsIn([f('b.md', '```\n- **D-1231** — quoted\n~~~')]).map((d) => d.n)).toEqual([1231]);
  });

  it('does not treat a fence with an info string as a CLOSING fence', () => {
    // ```` ```md ```` opens; only a bare run closes. Without this the block below
    // would close on its second line and the entry would read as a definition.
    expect(definitionsIn([f('a.md', '```md\n```js\n- **D-1231** — still quoted\n```')])).toEqual([]);
  });

  it('names the file each definition came from', () => {
    expect(definitionsIn([f('plans/x.md', '- **D-900** — s')])).toEqual([{ file: 'plans/x.md', n: 900 }]);
  });
});

describe('crossTreeCollisions — one merge earlier', () => {
  it('fires when branch and base define one allocator-era number in DIFFERENT plans', () => {
    const hits = crossTreeCollisions(
      [f('wave6.md', '- **D-1157** — my subject')],
      [f('d1157.md', '- **D-1157** — their subject')]);
    expect(hits.map((h) => h.n)).toEqual([1157]);
    expect(hits[0]!.files).toEqual(['d1157.md', 'wave6.md']);
  });

  it('does NOT fire on the same file in both trees — that is one definition seen twice', () => {
    // The ordinary case: every unmerged plan on this branch is also on main. If
    // this fired, the guard would be red on every branch forever and would be
    // switched off within a day.
    expect(crossTreeCollisions(
      [f('a.md', '- **D-1157** — s')], [f('a.md', '- **D-1157** — s')])).toEqual([]);
  });

  it('is SUBJECT-FREE: identical wording in two files is still two definitions', () => {
    // deviation-refs' collisions() requires two DISTINCT subjects and would
    // return [] here. An allocator-era number is issued once, for one purpose;
    // two defining files is the defect whatever they happen to say.
    expect(crossTreeCollisions(
      [f('a.md', '- **D-900** — same words')],
      [f('b.md', '- **D-900** — same words')])).toHaveLength(1);
  });

  it('leaves the pre-allocator era alone — GRANDFATHERED must never have to grow', () => {
    // Widening the SUBJECT extraction instead would have surfaced six sub-211
    // collisions (D-73/142/143/144/149/172), every one of which would have had to
    // join a set whose own rule says it may only SHRINK.
    expect(crossTreeCollisions([f('a.md', '- **D-72** — x')], [f('b.md', '- **D-72** — y')])).toEqual([]);
    expect(crossTreeCollisions([f('a.md', '- **D-210** — x')], [f('b.md', '- **D-210** — y')])).toEqual([]);
    // 211 is the first allocator-era number and IS in scope.
    expect(crossTreeCollisions([f('a.md', '- **D-211** — x')], [f('b.md', '- **D-211** — y')]))
      .toHaveLength(1);
    expect(LEDGER_ALLOCATOR_ERA).toBe(211);
  });

  it('catches the WRAPPED spelling across trees — the D-1158 shape, end to end', () => {
    const hits = crossTreeCollisions(
      [f('wave6.md', '- **D-1158** (spec premise corrected) — capsUsage reaches the PWA nowhere')],
      [f('d1157.md', '- **D-1158** (2026-08-31, found by running the full suite for D-1157) —\n  the census could never fire')]);
    expect(hits.map((h) => h.n), 'the wrapped definition was invisible').toEqual([1158]);
  });

  it('reports each colliding number once, with every file that defines it, sorted', () => {
    const hits = crossTreeCollisions(
      [f('b.md', '- **D-900** — x'), f('a.md', '- **D-900** — y')],
      [f('c.md', '- **D-900** — z')]);
    expect(hits).toHaveLength(1);
    expect(hits[0]!.files).toEqual(['a.md', 'b.md', 'c.md']);
  });

  it('is silent on two empty trees, and on trees that share nothing', () => {
    expect(crossTreeCollisions([], [])).toEqual([]);
    expect(crossTreeCollisions([f('a.md', '- **D-900** — x')], [f('b.md', '- **D-901** — y')])).toEqual([]);
  });

  it('orders its answer by number, so a diff of two runs is readable', () => {
    const hits = crossTreeCollisions(
      [f('a.md', '- **D-900** — x\n- **D-800** — y')],
      [f('b.md', '- **D-900** — z\n- **D-800** — w')]);
    expect(hits.map((h) => h.n)).toEqual([800, 900]);
  });
});

describe('unallocatedDefinitions — a number nobody asked for', () => {
  const defs = (...pairs: [string, number][]) => pairs.map(([file, n]) => ({ file, n }));

  it('names an allocator-era number defined with no allocation row', () => {
    expect(unallocatedDefinitions(defs(['a.md', 1066]), new Set([274, 1065])))
      .toEqual([{ n: 1066, files: ['a.md'] }]);
  });

  it('says nothing about a number the allocator issued', () => {
    expect(unallocatedDefinitions(defs(['a.md', 1066]), new Set([274, 1066]))).toEqual([]);
  });

  it('derives the era PER PROJECT from its own first issued number', () => {
    // The first version hardcoded 211 (this repo's first allocator-era number)
    // plus a 211..224 bootstrap set, and the sweep applies this to EVERY project
    // on the box — so the second project to adopt the allocator would have had
    // most of its own hand-numbered history named as "never allocated". The
    // allocator already knows each project's answer and it costs one MIN(n).
    expect(projectEra(new Set([274, 300, 1066]))).toBe(274);
    expect(projectEra(new Set())).toBeNull();
    // Below the project's own era: hand-numbered before the allocator existed
    // for it, so nobody could have asked.
    expect(unallocatedDefinitions(defs(['a.md', 211], ['a.md', 273]), new Set([274]))).toEqual([]);
    // At and above it: reportable.
    expect(unallocatedDefinitions(defs(['a.md', 274], ['a.md', 275]), new Set([274])).map((o) => o.n))
      .toEqual([275]);
  });

  it('reports nothing for a project the allocator has never issued for', () => {
    // No era means no claim. Reporting every definition as an orphan because a
    // project has not adopted the allocator would be a warning nobody can act on.
    expect(unallocatedDefinitions(defs(['a.md', 900], ['a.md', 901]), new Set())).toEqual([]);
  });

  it('collects every file that defines the same unallocated number', () => {
    expect(unallocatedDefinitions(defs(['b.md', 900], ['a.md', 900]), new Set([274])))
      .toEqual([{ n: 900, files: ['a.md', 'b.md'] }]);
  });
});
