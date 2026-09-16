// The TAG-BYTES corpus: one table of file contents and the ONE state every
// reader of `$REG/pools/<project>` must answer for each.
//
// WHY THIS EXISTS, and what it is not. `fixtures/poolRule.ts` already drives one
// corpus through every spelling of the pool RULE — the verdict, given a state.
// The PARSE — the bytes on disk, given nothing — had no such table, and its
// three implementations drifted apart in four measured ways before anyone
// noticed (D-2519..D-2522), because they were two hand-kept parallel case lists
// (`project-pools-read.test.ts` and `ccd-project-pool.test.ts`) held together by
// cross-referencing comments rather than by a shared corpus. A comment is a
// request; a shared table is a mechanism.
//
// THE THREE READERS THIS IS DRIVEN THROUGH (`pool-tag-parity.test.ts`):
//   * `server/src/pools.ts` — TypeScript, via `readProjectPools` + `localIO`.
//   * `ccd/ccd` `_project_pool_state` — bash, sourced under a fixture HOME.
//   * `ccd/ccrc-doctor-checks` `_check_pools` — bash, the doctor's own copy of
//     the same cap, strip and grammar. `pool-name-parity.test.ts` pins its
//     regex BYTE-EQUAL to the other two; byte-equal is not behaviour-equal, so
//     it is driven here as well.
//
// EVERY BYTE IS WRITTEN AS AN ESCAPE, NEVER AS A LITERAL. Half these rows turn
// on a character that is INVISIBLE in an editor — U+00A0 and U+0020 are one
// pixel apart and mean opposite things here. A literal would make the table
// unreviewable and would silently survive a copy-paste through a terminal that
// normalises it.
// NOTHING ENFORCES THAT, and saying otherwise would be this file committing the
// defect it exists to catch. An earlier draft of this header claimed
// `source-bytes.test.ts` "keeps this file ASCII"; it does not — that suite bans
// NUL, DEL and the other C0 bytes and permits every byte above 0x7F. The escape
// discipline here is a CONVENTION a reviewer enforces, and the reason to keep
// it is that a reviewer must be able to SEE the input that produced a verdict.

/** What every reader must answer for one tag file's exact bytes. */
export interface PoolTagCase {
  /** Human name, used as the test title. */
  readonly name: string;
  /** The tag file's EXACT bytes — no helper newline is appended anywhere. */
  readonly bytes: string;
  /** `tagged <name>` or `malformed`. `ccd` spells the first `named <name>`;
   *  `stateWordForCcd` below is the one place that mapping is written. */
  readonly expect: { readonly state: 'tagged'; readonly name: string } | { readonly state: 'malformed' };
  /** Why this row is here — printed on failure, so a red row explains itself. */
  readonly why: string;
}

const tagged = (name: string): PoolTagCase['expect'] => ({ state: 'tagged', name });
const malformed: PoolTagCase['expect'] = { state: 'malformed' };

export const POOL_TAG_CASES: readonly PoolTagCase[] = [
  // ---- the legal writers (ruling 2: a shell redirect is a legal writer) ----
  { name: 'a bare name', bytes: 'pool-a', expect: tagged('pool-a'),
    why: 'the ordinary case; `printf pool-a > tag`' },
  { name: 'trailing newline', bytes: 'pool-a\n', expect: tagged('pool-a'),
    why: '`echo pool-a > tag` is a legal writer, so its newline is not malformed' },
  { name: 'trailing space', bytes: 'pool-a ', expect: tagged('pool-a'),
    why: 'ASCII space is stripped by both readers' },
  { name: 'trailing tab', bytes: 'pool-a\t', expect: tagged('pool-a'),
    why: "ASCII tab is in the C locale's [[:space:]] and in the spelled-out JS class" },
  { name: 'trailing CR+LF', bytes: 'pool-a\r\n', expect: tagged('pool-a'),
    why: 'an editor writing CRLF is still a legal writer' },
  { name: 'trailing VT (U+000B)', bytes: 'pool-a\u000B', expect: tagged('pool-a'),
    why: 'VT is in the C locale [[:space:]] and in the spelled-out JS class. Without this row the \\v could be deleted from that class and every other row would stay green - found by mutation review, not by reasoning' },
  { name: 'trailing FF (U+000C)', bytes: 'pool-a\u000C', expect: tagged('pool-a'),
    why: 'FF, same as VT: the sixth character of the class had nothing pinning it' },
  { name: 'a DIFFERENT legal name', bytes: 'pool-b-2\n', expect: tagged('pool-b-2'),
    why: 'every other legal row is `pool-a`, so a reader that returned the constant `pool-a` would pass them all. This pins the NAME PAYLOAD, and exercises a digit and a second hyphen while it is here' },

  // ---- the strip's CLASS: the four that diverged, plus the two that did ----
  // ---- not but were locale-dependent on ccd's side (D-2519 / D-2520)    ----
  { name: 'trailing U+00A0 NBSP', bytes: 'pool-a\u00A0', expect: malformed,
    why: 'D-2519: JS \\s strips NBSP and C [[:space:]] does not; the server used to answer `tagged pool-a` where ccd answered `malformed`' },
  { name: 'trailing U+2007 FIGURE SPACE', bytes: 'pool-a\u2007', expect: malformed,
    why: 'D-2519: same divergence as NBSP' },
  { name: 'trailing U+202F NARROW NBSP', bytes: 'pool-a\u202F', expect: malformed,
    why: 'D-2519: same divergence as NBSP' },
  { name: 'trailing U+FEFF BOM', bytes: 'pool-a\uFEFF', expect: malformed,
    why: 'D-2519: JS \\s includes the BOM; no [[:space:]] does' },
  { name: 'trailing U+3000 IDEOGRAPHIC SPACE', bytes: 'pool-a\u3000', expect: malformed,
    why: 'D-2520: glibc strips this under en_US.UTF-8 and NOT under C, so ccd gave two answers for these same bytes until it shadowed the locale' },
  { name: 'trailing U+205F MEDIUM MATH SPACE', bytes: 'pool-a\u205F', expect: malformed,
    why: 'D-2520: same locale flip as U+3000' },
  { name: 'trailing U+0085 NEL', bytes: 'pool-a\u0085', expect: malformed,
    why: 'the control that proves the rows above are about the CLASS and not about non-ASCII generally: JS \\s excludes NEL, so this one always agreed' },

  // ---- the GRAMMAR: bash's [a-z] is a collation range (D-2522) ----
  { name: 'U+00E9 inside the name', bytes: 'pool-\u00E9', expect: malformed,
    why: 'D-2522: bash [a-z] ACCEPTS e-acute by collation under en_US.UTF-8 while the TypeScript regex rejects it; the ccd VERB would write this tag and the server would call it malformed' },
  { name: 'U+00F1 inside the name', bytes: 'pool-\u00F1', expect: malformed,
    why: 'D-2522: same collation acceptance as U+00E9' },
  { name: 'an uppercase letter', bytes: 'Pool-a', expect: malformed,
    why: 'the ASCII control for the collation rows: rejected by both engines in every locale' },
  { name: 'a LEADING space', bytes: ' pool-a', expect: malformed,
    why: 'the strip is trailing-only on purpose; a leading space is a hand-edit nobody meant' },

  // ---- the CAP boundary, one byte apart (D-1850 / D-2010 / D-2521) ----
  { name: '63 bytes, all ASCII', bytes: `pool-a${' '.repeat(57)}`, expect: tagged('pool-a'),
    why: 'one byte UNDER the cap: both readers strip back to a name' },
  { name: '64 bytes, all ASCII', bytes: `pool-a${' '.repeat(58)}`, expect: malformed,
    why: 'D-2010: the cap is `>= 64`, and `> 64` would pass exactly this input' },
  { name: "over ccd's BYTE cap but under the server's UTF-16 cap",
    bytes: `pool-a${'\u3000'.repeat(30)}`, expect: malformed,
    why: 'D-2521: 96 bytes / 36 UTF-16 units. ccd trips its byte cap; the server does not trip its unit cap and must reach `malformed` through the ASCII strip leaving a non-ASCII byte for the grammar to reject. The two get there by different routes, which is exactly why the answer has to be pinned' },

  // ---- the other malformed arms ----
  { name: 'an embedded NUL', bytes: 'pool-a\u0000junk', expect: malformed,
    why: 'bash drops NUL in a captured string, so `pool-a\\0junk` would otherwise read as the legal-looking token `pool-ajunk`' },
  { name: 'an empty file', bytes: '', expect: malformed,
    why: 'zero bytes is not one pool name; both readers fail the grammar on the empty string' },
];

/** The word `ccd`'s `_project_pool_state` prints for an expected state. THE ONE
 *  PLACE the two vocabularies are mapped — `tagged`/`named` is a spelling
 *  difference and nothing more, and writing it twice is how it becomes more. */
export const stateWordForCcd = (e: PoolTagCase['expect']): string =>
  e.state === 'tagged' ? `named ${e.name}` : 'malformed';

// Agreement check at import: a corpus that lost its teeth passes everything.
// These assert the table still COVERS what it was built to cover, so deleting
// the interesting rows is a red suite rather than a quiet green one.
{
  const need = (cond: boolean, msg: string): void => {
    if (!cond) throw new Error(`poolTag fixture: ${msg}`);
  };
  need(POOL_TAG_CASES.length >= 20, `expected >= 20 rows, found ${POOL_TAG_CASES.length}`);
  need(POOL_TAG_CASES.some((c) => c.expect.state === 'tagged'), 'no row expects `tagged`');
  need(POOL_TAG_CASES.some((c) => c.expect.state === 'malformed'), 'no row expects `malformed`');
  // The rows this table exists for: a non-ASCII byte that is NOT in C's
  // [[:space:]]. Without at least one, every divergence it was built to catch
  // could come back unnoticed.
  need(
    POOL_TAG_CASES.some((c) => /[^\x00-\x7F]/.test(c.bytes)),
    'no row carries a non-ASCII byte — the strip-class and collation rows are gone',
  );
  // Both sides of the cap boundary, which is the pair D-2010 turns on.
  // MEASURED IN BYTES, because `ccd`'s cap is a BYTE cap (D-2520's shadow) and
  // `String.length` counts UTF-16 code units. Writing `.length` here and calling
  // it "bytes" in the message would be D-2521's own confusion, in the file that
  // ships D-2521's correction — which is precisely how that one survived.
  const byteLen = (s: string): number => Buffer.byteLength(s, 'utf8');
  need(POOL_TAG_CASES.some((c) => byteLen(c.bytes) === 63), 'no 63-byte row');
  need(POOL_TAG_CASES.some((c) => byteLen(c.bytes) === 64), 'no 64-byte row');
  // And the row that separates the two caps: over ccd's BYTE cap while under
  // the server's UTF-16 unit cap. Losing it would leave the two caps' DISAGREEMENT
  // untested while every other row still passed.
  need(POOL_TAG_CASES.some((c) => byteLen(c.bytes) >= 64 && c.bytes.length < 64),
    'no row sits over the byte cap and under the UTF-16 unit cap');
  // Every name is distinct, or `it.each` titles collide and one row hides another.
  need(new Set(POOL_TAG_CASES.map((c) => c.name)).size === POOL_TAG_CASES.length,
    'two rows share a name');
}
