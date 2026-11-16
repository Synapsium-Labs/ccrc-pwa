# Overlord W1a, timers PR D: departures from the plan (Tasks 10 to 12)

Each departure from `w1a-timers.md` is named by a slug. No D-number is taken here: the coordinator folds these into the
programme's ledger. This note sits beside `departures.md` (PR A), `departures-pr-b.md` and `departures-pr-c.md`, none of
which this pull request edits. The spec departure this PR builds, **timer-gate-fails-open-like-every-gate**, is in
`departures.md`'s spec list.

## Pending timers on the card (Task 10)

- **timer-lines-in-one-block** — the plan's "one line per timer ... inside the card's own untrusted-text wrapper" is built
  as one trusted line, `Pending timers: <n> pending; the next is due at <UTC>.`, then ONE untrusted block holding one line
  per timer, oldest due first (id breaking a tie): `timer <id>, due <UTC>, <binding>: <preview>`, where the binding is
  `run <n>`, `programme <slug>` or `no run or programme`. The id, due time and binding ride inside the fence with the
  preview, so only the count and the next due time are row text outside it. The block's pointer is `in \`ccrc-api timer
  list\``.
- **timer-preview-escaped-where-drawn** — the preview is drawn through the card's `fieldLine` (`oneLine`, uncut), and the
  programme slug through `oneLine`, so a line break in a note cannot pose as a row. This is the card's one-line rule that
  PR A's preview-ellipsis-inside-the-sixty left for where the line is drawn.
- **timer-block-cap-from-the-largest-cap** — the block's byte cap is the largest `timerCap` of any role (50, the Overlord
  row's) times one line's cap (300 bytes for the head, plus the preview's 60 code points at the widest escape), so no block
  at any role's cap is ever cut. Pinned: twenty timers of sixty four-byte characters each render uncut, and a coordinator
  card with 50 timers, 200 notes and 100 mails at their caps keeps every page at most `CARD_PAGE_CHARS` and under
  `TOOL_RESULT_CUT_BYTES - 1000`, in ASCII and in four-byte characters. The check is in the render suite (pure), not the
  route suite, which this pull request does not claim.
- **timer-section-after-mail** — the section sits after the outstanding mail in every renderer but the Overlord's one line:
  for the coordinator before the notes and the checkpoint, for the worker, the reviewer and the plain session last.
- **timers-are-not-body-facts** — `BODY_FACTS` is unchanged, so a session holding only pending timers still carries the
  never-empty line, which names runs, claims and coordinator intent and stays true. The never-empty mutants (R6 to R9) pin
  those lists byte for byte; none moved.
- **card-block-mutant-m8** — `CARD_BLOCK_SET` (`sim/cardMutants.ts`) gains M8, the timers block unwrapped, killed by its new
  case "a timer preview is fenced". The floor is unchanged.
- **reads-pins-gain-timers** — the render suite's every-fact-unmeasured pins for the worker, reviewer and plain cards gain
  `unmeasured:timers`, because each renderer now reads the fact; the never-silent sweep's fact list gains `timers`.
- **preview-only-in-the-facts** — the gatherer carries `timerPreview`'s cut and never the note, so the snapshot's stored
  facts and its hash hold the preview only (pinned: the end of a long note is absent from `snapshotFactsJson`).

## `ccrc-api timer` (Task 11)

- **count-measured-at-eighty-one** — the table stood at seventy-eight rows at this branch's base (the plan's seventy-four
  predates the note door's four), so the three timer rows take it to eighty-one, at both prose sites, `toHaveLength`,
  `routeKeys().size`, and `WORDS` (which gains seventy-nine to eighty-one).
- **timer-duration-refusal-word** — a duration that is not `<n>m`, `<n>h` or `<n>d` refuses locally as `bad-duration`, a new
  client word (`3w`, `2`, `0h`, `2.5h`, `2H`, an empty string). The count is one to nine digits, so the client's arithmetic
  never overflows; the bounds stay the server's (`45d` is sent, and the server refuses it `timer-too-late`).
- **timer-flags-checked-locally** — `--run` is a positive integer of at most fifteen digits (so jq's number is exact),
  `--programme` passes `SAFE_RE`, each may be given once, and a set that binds both is refused `bad-args` here, unsent; the
  server refuses the same body `bad-request`.
- **timer-typed-identity-is-bad-args** — a typed identity is refused `bad-args`, unsent, on every timer verb: any flag in
  the first place, `--json`, `--by`, `--fromId`, `--byId`, and every flag but `set`'s `--run` and `--programme`.
- **timer-body-rides-the-intent-slot** — `main` carries the body `parse_timer` built through the same local that carries
  `parse_intent`'s, so the client has one slot for a body it synthesized, and a timer body is never read from a file or
  stdin.
- **mutations-by-hand** — measured by hand, each restored from a saved copy and compared byte for byte: dropping the gate
  reds the no-call case; letting `set` accept another flag reds the three typed-pair cases on `set`; letting `list` take an
  argument reds the list-argument case; building the body with `json_escape` reds the control-character case (and the
  `--run` case, whose number it drops).
- The client's shellcheck pin (0) holds.

## Worker clause 17, and the word (Task 12)

- **clause-17-net-minus-ninety-one** — the clause grew by 52 bytes and the trim removed 143 (the sentence that restates
  clause 2, opening "Real, reviewed work sitting on a branch of your own making"), so `ccd/worker-skill/SKILL.md` went from
  35,672 bytes at the merge base to 35,581 at the head, and its cap in `skill-size-caps.json` is lowered to 35,581. The
  clause stays ASCII, with no double quote and no "workflow".
- **stop-clause-verdict-lists-problems** — `stopClauseVerdict(line)` answers the list of problems it finds, empty when every
  member is admitted, so the row asserts `[]` on the real clause and a non-empty list on each fixture. The fixtures replace
  the real clause's timer member with a background shell, a Monitor, "a timer", "a timer that fires" and "until a timer
  fires". Measured: dropping the fourth shape reds the real clause; widening it to any "timer" reds the "a timer", "a timer
  that fires" and "until a timer fires" fixtures. The comment block keeps "or until a timer fires" after "asks" in the mail
  member as the known evasion, and says why: it names no timer anything accepted.
- **word-commit-carries-its-case** — the commit that adds `timers-v1` also adds the timer suite's case that `SERVER_CAPS`
  holds the word and that a current file of the defaults sends every timer verb. No suite pins the whole word list, so no
  other `SERVER_CAPS` suite changed (each was run).

## Claims

- **additive-rows-in-held-files** — `shared/continuity-card.ts` and `server/test/ccrc-api.test.ts` (the anchor's claims) and
  `server/src/continuity/card.ts`, `server/test/sim/probeSets.ts` and `ccd/ccrc-api` (probes PR B's) were held when this
  pull request started. The brief rules that each piece edits only its own rows and the second to land merges `main` once
  and takes the union, so this pull request adds rows there and touches none of theirs; both holders were mailed which rows.

## Growth (PR D)

Measured with `GROWTH_CHECK=1` after `git fetch origin`, green: `shared/api.ts` +4 net (+5, -1), the only growth-listed
file this pull request touches. The worker `SKILL.md` is 91 bytes smaller.
