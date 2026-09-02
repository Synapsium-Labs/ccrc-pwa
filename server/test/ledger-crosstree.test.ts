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
//   3. PREFIX-ONLY recognition — ENTRY's `—\s*(.+)$` demands the subject on the
//      same line, and 29 real definitions in today's plans are invisible to it,
//      D-1158 among them: one of the five numbers this program actually lost.
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
