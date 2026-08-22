import {
  isActorClass, isDecSurface, isLifecycleAct, isLifecycleOutcome,
  LC_ACT_UNKNOWN, LC_OUTCOME_UNKNOWN,
  type LifecycleAct, type LifecycleDec, type LifecycleMeas, type LifecycleObs,
  type LifecycleOutcome,
} from '../../../shared/api.js';

/**
 * L1: pure, clock-free, `fs`-free, fastify-free. It imports the vocabulary
 * GUARDS and the two degrade NAMES from `shared/api.js` and nothing else —
 * never the act LIST, because a second enumeration of it here would trip
 * `single-definition.test.ts`'s "enumerated only where the compiler enforces
 * exhaustiveness" rule. It imports neither `./db.js` nor `node:sqlite`, which
 * the coord-ring scan in that same file checks.
 *
 * PURE AND TOTAL, and that is D8's whole re-measurement proof: no clock, no
 * lookup, no registry, no other row, and no path returns anything but a
 * `JournalRow`. `raw` holds the line VERBATIM on every path, so the
 * reconstruction drill is byte equality rather than resemblance, and a field a
 * NEWER ccd writes that this build cannot model is re-projectable later from
 * `raw` without re-reading the fleet box.
 *
 * NOTE THE ONE SANCTIONED WIRE/COLUMN RENAME: ccd writes the SUBJECT of the
 * act as `id`; the row calls it `sessionId`, because `id` is
 * `lifecycle_events`' own autoincrement key. One rename, here, once.
 */
export interface JournalRow {
  readonly uid: string | null;
  readonly at: number | null;
  readonly act: LifecycleAct;
  /** The act token ccd wrote when this build cannot name it; null whenever
   *  `act` is not `LC_ACT_UNKNOWN` (`shared/api.ts:4003-4005`'s invariant on
   *  `LifecycleEvent.badact`, and `parseJournalLine` re-establishes it rather
   *  than trusting the line: the journal is append-only on a box with a
   *  single UNIX user, so a forged line pairing a VALID `act` with a
   *  caller-supplied `badact` is a real input this parser must not believe). */
  readonly badact: string | null;
  readonly outcome: LifecycleOutcome;
  /** `badact`'s twin on the outcome side (`shared/api.ts:4007-4010`); null
   *  whenever `outcome` is not `LC_OUTCOME_UNKNOWN`, same invariant, same
   *  reason it is re-established rather than trusted. */
  readonly badoutcome: string | null;
  readonly verb: string | null;
  readonly sessionId: string | null;
  readonly tx: string | null;
  readonly refusal: string | null;
  /** ccd's one line for a person. DISPLAY-ONLY — nothing parses it back. */
  readonly detail: string | null;
  /** The line said `"truncated":true` — `_lc_json` shed fields to fit
   *  `LC_LINE_MAX`. Carried so an absent family and a DROPPED family are two
   *  facts rather than one NULL. */
  readonly truncated: boolean;
  readonly obs: LifecycleObs | null;
  readonly dec: LifecycleDec | null;
  readonly meas: LifecycleMeas | null;
  /** NEVER null here, unlike `LifecycleEvent.raw`: this type is what the
   *  parser produces, and it produces the bytes on every path. */
  readonly raw: string;
}

type Obj = Record<string, unknown>;

const rec = (v: unknown): Obj | null =>
  v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : null;
const s = (o: Obj, k: string): string | null => (typeof o[k] === 'string' ? (o[k] as string) : null);
const n = (o: Obj, k: string): number | null =>
  typeof o[k] === 'number' && Number.isFinite(o[k]) ? (o[k] as number) : null;
const b = (o: Obj, k: string): boolean | null => (typeof o[k] === 'boolean' ? (o[k] as boolean) : null);

/** `LifecycleMeas.atticsrc`'s three declared members, narrowed the same way
 *  `s`/`n`/`b` narrow every other scalar: absent, wrong-typed and
 *  out-of-vocabulary all fall to `null` alike, because — unlike `cg` and
 *  `surface` — this field's type has no fourth `'unknown'` member to receive
 *  a garbage token, so there is nowhere type-safe to preserve one. The raw
 *  byte is never lost: it is still sitting in `JournalRow.raw` verbatim.
 *
 *  FIX ROUND 1, F3: the membership check used to be a hand-written
 *  `Set(['worktree','registry','none'])` plus an `as LifecycleMeas['atticsrc']`
 *  cast — a SECOND, unenforced copy of the union `shared/api.ts:3874`
 *  declares. The reviewer proved it was inert by adding a fourth member
 *  (`'branchref'`) to that union and getting `tsc --noEmit` clean: a real
 *  fourth attic source would have silently landed on `null` — the field's
 *  "never measured" value — for every such row, forever, with no compile
 *  error and no red test. `ATTICSRC_MAP` below is the same
 *  `LIFECYCLE_ACT_MAP`/`LIFECYCLE_MEAS_KEY_MAP` idiom this file already uses
 *  for the act list and the meas key list: a `Record` keyed by the type
 *  itself, so a member added to `LifecycleMeas['atticsrc']` without a
 *  matching map entry is `TS2741`/`TS2739`, and a stray map entry with no
 *  type member is `TS2353` — the membership check and the type can no longer
 *  drift apart silently. */
const ATTICSRC_MAP: Record<NonNullable<LifecycleMeas['atticsrc']>, true> = {
  worktree: true, registry: true, none: true,
};
const ATTICSRC: ReadonlySet<string> = new Set(Object.keys(ATTICSRC_MAP));
const atticsrc = (o: Obj, k: string): LifecycleMeas['atticsrc'] => {
  const v = o[k];
  return typeof v === 'string' && ATTICSRC.has(v)
    ? (v as NonNullable<LifecycleMeas['atticsrc']>) : null;
};

/** Each reviver returns an object LITERAL, so a member added to the interface
 *  in `shared/api.ts` and forgotten here is a compile error rather than a
 *  silently-dropped field — the exact mechanism `reviveFleetSession`
 *  (`shared/api.ts:1509-1640`) relies on. They are exported because the STORE
 *  reads the same JSON back out of `obsJson`/`decJson`/`measJson` through
 *  them: one definition, both directions. */
export function reviveObs(v: unknown): LifecycleObs | null {
  const o = rec(v);
  if (o === null) return null;
  const cg = s(o, 'cg');
  return {
    // THREE CONDITIONS, THREE VALUES, and the split is `corroboration`'s
    // input: `null` = no cgroup was read at all (-> 'unmeasured');
    // `'unknown'` = one was read and matched none of the four shapes
    // (-> 'not-comparable'); a member = what was seen. Collapsing the first
    // two would make an unread /proc look like a disagreement.
    cg: cg === null ? null : isActorClass(cg) ? cg : 'unknown',
    // NEVER DROPPED (D2). `null` means the line carried none; `''` would be a
    // measured-empty cgroup path, which is a different fact.
    cgraw: s(o, 'cgraw'),
    pid: n(o, 'pid'), ppid: n(o, 'ppid'),
    pane: s(o, 'pane'), paneWhy: s(o, 'paneWhy'),
    tty: b(o, 'tty'), ssh: s(o, 'ssh'),
  };
}

export function reviveDec(v: unknown): LifecycleDec | null {
  const o = rec(v);
  if (o === null) return null;
  const surface = s(o, 'surface');
  return {
    // `'none'` = ccd passed no flag; a member of `StopSurface` = what was
    // declared; `'unknown'` = a surface word this build cannot model, which
    // is also where a `dec` object carrying no `surface` key at all lands —
    // ccd always writes one, so its absence is a malformed line and not a
    // fourth condition to invent a value for.
    //
    // FIX ROUND 1, F3 (related, lower priority): this used to hand-roll
    // `surface === 'none' ? 'none' : isStopSurface(surface) ? surface :
    // 'unknown'` when `isDecSurface` (`shared/api.ts:3679`) already says the
    // same thing — its own docstring (`:3678`) exists so "there is one
    // door". Functionally identical (verified: `isDecSurface(null)` is
    // `false` the same way the hand-rolled check was, so an absent `surface`
    // key still lands on `'unknown'`), just one fewer place to edit tomorrow.
    surface: isDecSurface(surface) ? surface : 'unknown',
    actor: s(o, 'actor'),
    reason: s(o, 'reason'),
  };
}

/**
 * `LifecycleMeas`'s full twenty-five keys, and only those — a 26th key is a
 * compile error here (TS2353) exactly as it is on the interface itself
 * (`shared/api.ts`'s own `LIFECYCLE_MEAS_KEY_MAP`).
 *
 * DEVIATION FROM `task-29-brief.md`'s LITERAL CODE SAMPLE, recorded here
 * rather than silently: the brief's "Produces" section and its `reviveMeas`
 * sample model only TEN keys (`project`..`held`) and its shipped test
 * asserts `Object.keys(r.meas!)` is exactly those ten, with `workdir` given
 * as an example of a key that stays in `raw` only. That was true of
 * `LifecycleMeas` at an earlier draft of this plan; it has not been true of
 * the shipped interface since wave 2 (Task 21, commit `4a9fa17`/`fbbfe98`,
 * "widen LifecycleMeas to the 23 keys ccd actually emits") and wave 3's fix
 * round (Task 24, commit `b54891f`, restoring `atticsrc`/`manifestBytes`) —
 * both landed on this branch before Task 28 ran, so the `LifecycleMeas` this
 * file imports already has twenty-five required readonly members. A literal
 * modelling only ten of them does not merely mis-model — it fails to
 * typecheck (TS2741/TS2739), which `server/test/typecheck-tests.test.ts`
 * would catch. `shared/api.ts`'s own docstring on `LifecycleMeas` (:3814-
 * 3858, quoted sentence at :3821) states the twenty-five as "A RULING, NOT AN
 * OVERSIGHT" [FIX ROUND 1, F6: corrected from a mis-measured :3828-:3854 —
 * STANDING RULE 2], and
 * `server/test/lifecycle-wire.test.ts` and `server/test/ccd-lifecycle-
 * contain.test.ts` both already pin the twenty-five independently of this
 * file. Per STANDING RULE 6 ("when a brief's prose and its code sample
 * disagree, the CODE SAMPLE wins") this is stronger than a prose/sample
 * split: it is the brief's sample against code two tasks already shipped on
 * this very branch, so the shipped code is what `parseJournalLine` is built
 * against. The corresponding test case in `journalparse.test.ts` is adjusted
 * to match (see the comment there) and the deviation is written up in
 * `task-29-report.md`.
 *
 * What the brief's "ten declared, rest lives in raw" design intent survives
 * as: any key a future ccd emits that is NOT one of these twenty-five still
 * never reaches `meas` — it is still recoverable only from `raw`, verbatim.
 */
export function reviveMeas(v: unknown): LifecycleMeas | null {
  const o = rec(v);
  if (o === null) return null;
  return {
    project: s(o, 'project'), workspace: s(o, 'workspace'), branch: s(o, 'branch'),
    uuid: s(o, 'uuid'), wrapper: s(o, 'wrapper'), tip: s(o, 'tip'),
    attic: n(o, 'attic'), atticsrc: atticsrc(o, 'atticsrc'),
    archivedAt: n(o, 'archivedAt'), archivedReason: s(o, 'archivedReason'),
    manifestBytes: n(o, 'manifestBytes'), held: s(o, 'held'),
    workdir: s(o, 'workdir'), base: s(o, 'base'), old: s(o, 'old'),
    rc: n(o, 'rc'), mode: s(o, 'mode'), inUnit: n(o, 'inUnit'),
    from: s(o, 'from'), dropped: n(o, 'dropped'), registered: n(o, 'registered'),
    state: s(o, 'state'), bytes: n(o, 'bytes'), resumed: s(o, 'resumed'),
    tombstone: s(o, 'tombstone'),
  };
}

const UNMODELLED: Omit<JournalRow, 'raw'> = {
  uid: null, at: null, act: LC_ACT_UNKNOWN, badact: null, outcome: LC_OUTCOME_UNKNOWN,
  badoutcome: null, verb: null, sessionId: null, tx: null, refusal: null, detail: null,
  truncated: false, obs: null, dec: null, meas: null,
};

export function parseJournalLine(line: string): JournalRow {
  let parsed: unknown;
  try { parsed = JSON.parse(line); } catch { return { ...UNMODELLED, raw: line }; }
  const o = rec(parsed);
  if (o === null) return { ...UNMODELLED, raw: line };

  const actRaw = s(o, 'act');
  const act: LifecycleAct = isLifecycleAct(actRaw) ? actRaw : LC_ACT_UNKNOWN;
  const outRaw = s(o, 'outcome');
  const outcome: LifecycleOutcome = isLifecycleOutcome(outRaw) ? outRaw : LC_OUTCOME_UNKNOWN;
  const badact = s(o, 'badact');
  const badoutcome = s(o, 'badoutcome');
  return {
    uid: s(o, 'uid'),
    at: n(o, 'at'),
    act,
    // ccd degrades an undeclared act itself and names it in `badact`
    // (`lifecycle-vocabulary.test.ts` is what makes that true). This build
    // degrades a SECOND time for a token ccd knew and it does not, and keeps
    // whichever token is actually there — never both, never neither. A
    // non-string `act` (wrong type, not merely off-vocabulary) collapses to
    // the same `badact: null` as a wholly absent `act` key: only a STRING
    // token is a meaningful "bad word" to echo back, and either way the raw
    // bytes are still sitting in `raw`, verbatim.
    //
    // FIX ROUND 1, F2 (a forging vector, closed): this used to be
    // `badact ?? (act === LC_ACT_UNKNOWN ? actRaw : null)`, which reads
    // ccd's OWN `badact` key first regardless of what `act` turned out to
    // be — so a forged line reading `{"act":"destroy","badact":"forged"}`
    // came out as `{act:'destroy', badact:'forged'}`, violating
    // `shared/api.ts:4003-4005`'s invariant ("null whenever `act` is not
    // `LC_ACT_UNKNOWN`. The two are never both set.") on a line this parser
    // itself produced. The journal is append-only on a box with a single
    // UNIX user — identity there is attribution, not authentication
    // (`CLAUDE.md`) — so any session can append a line, and this parser is
    // the boundary that has to re-establish the invariant the writer
    // enforces (`ccd/ccd:1417-1422`'s `_lc_emit`, which only ever sets
    // `badact`/`badoutcome` for a token that FAILED its vocabulary match,
    // never alongside a matched one) rather than trust it off the wire.
    // ONE condition now: `badact` only exists to answer "what did `act`
    // degrade FROM", so it is read at all only when `act` actually is the
    // degrade value, and ccd's own token (when ccd already computed one)
    // wins over re-deriving it from `actRaw`.
    badact: act === LC_ACT_UNKNOWN ? (badact ?? actRaw) : null,
    outcome,
    // `badoutcome` — F1: previously dropped entirely (no field on
    // `JournalRow`, `o['badoutcome']` never read), even though ccd writes it
    // today (`ccd/ccd:1351`, `:1417-1422`) and `LifecycleEvent.badoutcome`
    // (`shared/api.ts:4007-4010`) already declares it with the identical
    // invariant `badact` has: "null whenever `outcome` is not
    // `LC_OUTCOME_UNKNOWN`... neither sends a reader to `raw` for it."
    // Without this, "ccd said an outcome word this build can't model",
    // "the line carried no outcome", and "outcome was a non-string" were one
    // value for three conditions — exactly what `badact` exists to prevent
    // on the act side. Same one-condition shape as `badact` above, same
    // forging concern, same fix.
    badoutcome: outcome === LC_OUTCOME_UNKNOWN ? (badoutcome ?? outRaw) : null,
    verb: s(o, 'verb'),
    sessionId: s(o, 'id'),
    tx: s(o, 'tx'),
    // `refusal`, NEVER `refused` — D15. The spelling is half of what keeps
    // `wsaudit.test.ts` green with no edit.
    refusal: s(o, 'refusal'),
    detail: s(o, 'detail'),
    truncated: b(o, 'truncated') === true,
    obs: reviveObs(o['obs']), dec: reviveDec(o['dec']), meas: reviveMeas(o['meas']),
    raw: line,
  };
}
