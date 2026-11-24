# Program: overlord

Spec: `docs/superpowers/specs/2026-11-09-overlord-design.md` (approved by the operator on 2026-11-10: H1 to H45, R1 to R17; on `main` since #2605. R18, the operator's ruling of 2026-11-12, since #2705; R19 to R23, the operator's rulings of 2026-11-12 to 2026-11-19, since #2719, #2792, #2871 and #3051)
Plans: `docs/superpowers/plans/2026-11-10-overlord/`, one file per piece, listed under Waves
Research: `docs/superpowers/research/2026-11-10-overlord-model-check/` (two model checks of the spec's machines)
Workspace: the Overlord programme's coordinator (slug `overlord`); issue #2491

## Waves

| # | scope | PRs | state |
|---|---|---|---|
| spec | The hardened edition of the spec, on top of rev 8 | #2513 | merged |
| spec | The model check's fixes: 24 unsettled readings and one design fault | #2529 | merged |
| spec | The builders' gaps closed, and the ratchet's scope put to the operator | #2533 | merged |
| spec | The second model check's fixes: 38 findings in authority, restore, requests and pushes; I11 and I12 | #2538 | merged |
| spec | The third round's fixes: 80 findings from an audit of every decider table and a model of accounts, privacy and joint faults; I13 | #2539 | merged |
| spec | The seams of the four follow-ups closed: 29 restatements brought into line, the door gate order completed | #2542 | merged |
| spec | The fourth round's fixes: 32 findings in the evidence behind trust, the decision model and the judges; I14 to I16; what each kind of trust takes to earn | #2543 | merged |
| spec | The operator's approval, the rulings on the review's fifteen questions, R16 and R17 (H40 to H45) | #2605 | merged |
| W0a | The spike, Tasks 1 to 7: the rig's scenarios and stand-ins, and the first model re-run on the approved edition. Changes nothing that runs | #2632; plan `w0-spike.md` | merged |
| W0b | The spike, Tasks 8 to 11 (fleet reads, the subject, account facts, the quiz baseline), then Task 12 for both halves | #2711; plan `w0-spike.md` | merged (ed8a3b318) |
| W1a, foundations | The mail-pace table | #2528; plan `w1a-mail-pace.md` | merged |
| W1a, foundations | Each role skill's contract moved first, behind a notice that tells a session how to see a cut | #2555 (supersedes #2530) | merged |
| spec | The operator's ruling on the ratchet's scope | #2556 | merged |
| W1a, foundations | The coordinator skill made lean: its procedures in reference files, the wave lifecycle one file per step | #2557, #2558 and #2560 (the tests, first); #2559 | merged |
| W1a, foundations | The cap on each `SKILL.md`, and each contract held inside what a compaction keeps | #2565; plan `w1a-skill-ratchet.md` | merged |
| W1a, foundations | Ports for time and chance | #2623; plan `w1a-time-ports.md` | merged |
| W1a, foundations | One role vocabulary: `FLEET_ROLES` and `roleOf` | #2624; plan `w1a-roles.md` | merged |
| W1a, foundations | The trigger table and the case lane, in shadow | #2644; plan `w1a-triggers-cases.md` | merged (962f88b64) |
| W1a, foundations | The simulator's skeleton and the first model | #2649; plan `w1a-simulator.md` | merged (c8c7a116f) |
| spec | R18: the account pools the operator names replace reserved accounts | #2705 | merged (4489396ce) |
| spec | R19: renewals the operator does not feel (the operator, 2026-11-12) | #2719 | merged |
| spec | The W1a builds' corrections | #2812 | merged |
| spec | R20: self-set follow-up timers and measured responses (the operator, 2026-11-14) | #2792 | merged |
| spec | R21: two answer marks on Waiting on you, the spec delta and the plan (the operator, 2026-11-15) | #2871 | merged |
| spec | The W1 plans' corrections folded in; the operator's answers to items 345, 327 and 328 | #2888, #2901 | merged |
| spec | R22 and R23: the brakes, run acts, the dispatch cap and autonomy mode (the operator, 2026-11-19) | #3051 | merged |
| W1a plans | The machine's pieces (with the invited-reply plan), the face's plan, the timers plan | #2728, #2729, #2795 | merged |
| W1a plans | The replay quiz's record path: history's single-arm mode and `quiz-record` | #2984; plan `docs/superpowers/plans/2026-11-17-overlord-quiz-record.md` | merged |
| W1a, the machine | The Overlord's mail-pace row; an invited reply is never refused by the peer bound (W0b's proposal 11) | #2737, #2738 | merged |
| W1a, the machine | The renewal deciders, pure; the card's facts and renderers for every role; context readings; the hook's report of every start; `hibernate --roll --fresh`; the generation step under crash, gap and freeze | #2733, #2732, #2739, #2740, #2742, #2744 | merged |
| W1a, the machine | The generations lane, in shadow; the card door and its follow-up; compaction instructions by role and the PreCompact refusal arm, dark | #2786; #2793, #2823; #2787 | merged |
| W1a, the machine | Probes (the round and its grading, the door and spot probes, the follow-up); notes; the anchor, dark behind its switch | #2785, #2802, #2828; #2796; #2803 | merged |
| W1a, the machine | Timers: the record and its rules, the doors, the lane and the role timer, what a session sees, the operator's view and cancel | #2797, #2798, #2800, #2805, #2804 | merged |
| W1a, the machine | Launch profiles: one per role at every spawn; the profile lane in shadow; the plain-auto-memory row | #2763, #2794, #2799 | merged |
| W1a, the machine | The renewal act, dark until `continuity` is live; Renew now and the hand-offs to the renewal lane | #2852, #2934 | merged |
| W1a, the machine | Account organization: its label and relation, the Accounts screen, the rescue's tie-break, the Overlord's renewal after a resume into another organization | #2920, #2954, #2955, #2958; plan #2910 | merged |
| W1a, the machine | The weekly replay quiz, its baseline and the arming guard; the quiz's record path (the single-arm mode, `quiz-record`) | #2839; #2988, #2991 | merged |
| W1a, the machine | The weekly quiz runs, records and confirms itself | #3169 | merged (the operator's no-chores direction, 2026-11-22) |
| W1a, the machine | The weekly quiz's repair: a trigger that cannot starve, and a starved trigger said in words | run 3508, no PR yet | in build (opened 2026-11-23) |
| W1a, the machine | The pilot's three stale checks against the current Claude Code build (tools, plugins, persistence) | not opened | planned; waits on run 3508's readings |
| W1a, the machine | The coordinator skill's recall clause (clause 23, after the two clauses that merged first) | #2919 | reviewed and accepted (review 3411); open, not queued; waiting on the replay baseline, so on the two rows above |
| W1a, the machine | `continuity-v1` and the arming of the W1a lanes | not started | waits for the recall clause and the baseline |
| W1a, the machine | The contract's restore budget raised to fit the four waiting coordinator clauses (operator item 326) | #2845 | merged |
| W1, the face | The face's design system (art, `Character`, `overlord_`, the Orb icons); the face in the app (mood, character choice, every bar, splash, badge); the cool-down (items 218, 219); one hearing rule, every surface through `useHeard` | #2741; #2781; #2791; #2824, #2835; plan #2729 | merged |
| W1 plans | The index (#2814, folded in #2885) and one plan per piece: #2815 to #2818, #2829 to #2832, #2853 to #2856, #2861 to #2864, #2866 to #2869, #2874 to #2876, #2881 to #2883. Plans in `docs/superpowers/plans/2026-11-14-overlord-w1/` | those PRs | merged |
| W1 | Vocabulary: injected prompts and their census, the refusal words, the trigger kind | #2840 | merged |
| W1 | The `ccrc-overlord` skill: its references, staging and the role-skill deny | #2833 | merged |
| W1 | The journal kernel moved to K; the shared append-only port and chained-journal file adapter; the file's verified head | #2848; #2880; #2985 | merged |
| W1 | Authority journal: the journal, its fold, writer and boot coherence (A); Confirm the restore, one transaction behind the step-up (C) | #2895; #3204 | merged |
| W1 | Authority journal B: the authority witness, its exchange and the ladder's two rows | #3215 | in fix round (review 3372: two critical, eight important, two minor); head conflicts with main; fixes are local and unpushed; waiting for its turn to absorb main |
| W1 | Pool set: the set in L0 and its library (A1), the session's side (A2), every reader's side (A3), `ccd pool-answer` and the capability floor (B1), `--below-cap` and the push on a lost set (B2) | #2836, #2846, #2857, #2877, #2887 | merged |
| W1 | Push outbox (the record and its rules, then the one sender); response record (A, B) | #2838, #2859; #2884, #2914 | merged |
| W1 | Designation: the row, its term, create and retire (A); the model class and account set doors (C) | #2950; #2992 | merged. B (restart and the sweep) not started |
| W1 | Gates: actor columns and the operator doors through `CallerIdentity` (A); the gate order as one decider (B) | #2993; #3076 | merged |
| W1 | The ladder, its rung door, Pause and off; refusals on the other write lanes (A) | #2994; #2996 | merged |
| W1 | ccd's Overlord arms: keep-awake and the long-lived library (A), the hold-down, stand-down and crossing end (B), the fresh pick in three steps (C1, C2) | #2898, #2945, #2957, #2971 | merged |
| W1 | Serviceability: billing and continuity facts, the three inputs, their Settings door (A) | #2878 | merged |
| W1 | Serviceability B: `limit_samples`, `poolRunway`, the load lines, the runway read, the 95% ladder row | #3210 | waiting: wave-done at its head after review 3330's fix round; conflicts with main; waiting for its turn to absorb |
| W1 | Private store: the store, its journal and safety nets (A); the console's prompt recorded, then nudged (B) | #2896; #3034 | merged |
| W1 | Portfolio: the rank, its one writer, the read and rank doors (A); who ratified each goals version (B) | #2842; #2904 | merged |
| W1 | Board and history: the read-only history op on the agent (A) | #2841 | merged |
| W1 | Sandbox: the launch profile measured and rendered (A); the overlord workspace, digest probes, launch-surface-v1 and the no-mods check (A2) | #2847; #2889 | merged |
| W1 | Sandbox B: the sandbox check, surface arm and settle step (#3205); the hook's surface arm as a PR of its own (#3213) | #3205, #3213 | waiting: #3213 holds at its reviewed head, its review report waits on item 606; #3205 conflicts in the ladder files and holds; #3213 lands before #3205 |
| W1 | Door process: the act-key claim door (A1), the spawn step and the door with `ccrc-api` inside (A2), the hook's reports and the witness (B1), the model events and the reader and typed-model arms (B2) | #3035, #3057, #3099, #3201 | merged |
| W1 | Renewal readings: the seam, the fitted ceiling and the backstop (A); the raised term, the changed class and the probes-failed-twice latch (C) | #2962; #3209 | merged. B, D, E and F not started |
| W1 | The isolation word, measured by both sides | #3208 | merged (5102a69aa3), accepted at the review cap |
| W1 | Answer marks (R21): on Waiting on you items (A), on asks the operator has (B), "could handle this" on tasks (C) | #2879, #2892, #2902 | merged |
| W1 | The sequence, its writer, its stamps and its retention lane (A) | #3218 | waiting: wave-done at its head after review 3379's fixes; conflicts with main; waiting for its turn to absorb |
| W1 | The inbox, messages and acknowledge doors, the read runner and the coalesced wake | #3220 | in review (run 3506, round 3 of 3, on its held head); the head conflicts with main and a second merge waits on item 615 |
| W1 | Home and Settings, PR A: the console's home and places, with the Overlord's door | #3207 | waiting on item 607: its two prepared files are to be integrated with main by the operator's keeper |
| W1 | Not started: the sequence's PR B and the monitor, designation B, the Overlord's timers, the board's B, readiness, home B and C, chat, `overlord-v1` | plans merged | planned |
| W1 | The Overlord clause (§11.4) | not built | waits for the recall clause (#2919); the contract's room is settled (#2845) |
| W2 plans | The index, one plan per piece, the fold: #2917; #2921 to #2925, #2928, #2930 to #2933, #2935 to #2938; #2952. Plans in `docs/superpowers/plans/2026-11-16-overlord-w2/` | those PRs | merged |
| W2 | The pieces that need nothing from W1, built first: the vocabulary, row revisions, private names (A, B), the decision-model port and its arming (A, B), overlaps A, remaining work (A, B), done tests A, forecasts and health (A, B) | #2939; #2965; #2940, #2961; #2948, #2990; #2949; #2951, #3002; #2964; #2987, #3003 | merged |
| W2 | Route and follow up, the rest: the act catalogue, act rows, journal and reads, the request record and ids, the coordinator and operator doors, relay, follow-up, inbox band 3, label queue, the board's and home's W2 parts, W2 Settings, overlaps B, done tests B, `overlord-route-v1` | plans merged | planned; most wait on W1 pieces |
| D-8126 | A4 calls made for you, Overturn and Seen; A5 the decide-by-default clause 21; A6 the detectors that act; A7 the server owns its faults; A9 the rule after compaction | #3072, #3100, #3080, #3079, #3146 | merged (taken into this programme by the operator's direction of 2026-11-19). A10 is a measurement due about 30 days after A9's rollout mail; A8 and the cap counting are not this programme's |
| Capacity | Waiting workers sleep and hold no slot: the design and plan (D-8789 to D-8793); an own-run hold passes the run-done sleep; an idle worker sleeps after 30 minutes, in shadow; a run holds a dispatch slot only while its worker works; a refused coordinator is mailed when a slot frees; follow-up round 1; the in-place bind (W1-4b, D-6096) | #3091, #3092, #3101, #3103, #3117, #3133, #3134 | merged. W1-5 (D-6097) not built |
| Mid-turn mail | The design and plan; PR 0 (the rig check); PR 1 (delivery times on `MailSummary`); PR 2 (urgent mail's sender rule); PR 3 (the `mailhold` route field); PR 4 (the projection and its decider); PR 5 (the notice line and refusal, shadow); PR 6 (the subagent ack refusal, shadow); PR 2b and 4b (urgent mail at the ingress, the reclaim repoint) | #3054, #3059; #3063; #3065; #3073; #3064; #3087; #3067; #3083; #3147 | merged |
| Mail and redaction | An optional idempotency key on mail sends; Gitleaks-derived known-token rows and one PEM block rule; the PEM and escaped-break follow-up | #3056; #3052; #3060 | merged |
| Approvals through coordinators and the Overlord | The plan (the operator's direction of 2026-11-18); PR 0 (a child with a stale deny digest is routed); PR 1 (the census); PR 2 (the envelope list); PR 3 (the park, built and inert) and its 3v and 3c; prevention (reviewers and briefs remove only literal paths) | #3036; #3045; #3043; #3061; #3106, #3140, #3141; #3038 | merged |
| No chores for the operator (2026-11-22) | The test box's tool sync takes a home; the build capture runner's design and first PR; a new Claude Code release needs no operator; capture PR 3a | #3167; #3171, #3168; #3170; #3198 | merged |
| No chores for the operator (2026-11-22) | Capture PR 2: copy missing builds before retrying capture | #3239 | waiting on item 605: the operator's keeper is to publish a replacement head; main has moved on and the worker may absorb it once after that |
| Test box and settings pieces | Managed node PR 3; every admin act has a time limit; a light parity check; the run cap derived from the fleet host; Settings › Integrations; a Do item can carry a note to the coordinator | #3233; #3225; #3241; #3224; #3230; #3228 | merged |
| Test fixes | Two merge-queue flakes; the docs bar's focus case; the digest page's one-post case; the collector's resume cases | #2820; #2953; #2968; #2981 | merged |
| W3 | Brief first, then answer first (two steps) | not planned yet | follows W2 |
| W4 | Learn | not planned yet | follows W3 |
| W4b | The fleet playbook | not planned yet | follows W3 |
| W5 | Start and re-kick | not planned yet | follows W3 |
| W6 | Propose and report | not planned yet | follows W4 and W5 |

## Decisions & deviations

- **The operator approved the spec on 2026-11-10** (#2605): the calls C1 to C60 and H1 to H39, the rulings on the
  review's fifteen questions, and two new rulings, R16 and R17, which add H40 to H45 (§6.9). They change nothing in
  the W0 or W1a plans; they bite from W1 and W3.
- **The operator handed the first wave to this coordinator on 2026-11-11** (W0 and the four W1a foundations left),
  approved the order below the same day, and gave the coordinator autonomy for 24 hours. The split install is parked
  (Later in the spec). W1 onward is out of scope until D-8126's build lands.
- **The order (2026-11-11).** W0a, the role table and the time ports run first, in parallel, on three workers: they
  share no file. The trigger table and case lane follows the role table, because both edit `stall.ts`'s import block
  and two of this programme's claims must not overlap, and it follows #2606, because both add a `coord.db` migration
  and the slot is measured again before merge. The simulator follows the time ports (it imports their fake), and its
  Task 6 follows W0a's Task 7 (it moves W0's model under the test tree). W0b waits for the operator's setup item.
- **Routing (2026-11-11).** Every piece is the matrix's "worker executing a spec'd plan" row: Opus · high, Sonnet ·
  high subagents, workflows off, `compact 40`. Each piece's PR gets a review run on the held-out panel.
- **W0's open questions (2026-11-11).** Questions 3, 4, 6, 7 and 8 take the plan's recommendation as this
  coordinator's call: two runs (W0a, W0b), reuse the continuity spike's scratch accounts now that its loan has ended,
  the model stays as it is, captures are not committed as fixtures, and the `scenarios-overlord/` set is the
  re-measurement on a class advance. Questions 1 (the rig's bypass exception) and 2 (the replay baseline) are the
  operator's, raised as items; question 5 (lanes) is in the setup item, and ruling 6 now allows another provider's
  lane as a fallback, so the operator may name one.
- **A plan's gap is closed in the spec, not recorded as a deviation.** Each plan was reviewed by reading the spec as
  its builder would. Where the spec left a choice open, #2533 settles it in the text, and the plan's placeholder
  entry was removed. That took the plans from 47 placeholder deviations to 31. What remains is a decision of the
  plan's own, or a real departure from the spec.
- **W0 does not write a second model.** The model that checked the spec is the first model. W0's Task 7 re-runs it
  on the merged edition, and the simulator piece moves it under the test tree.
- **W1a is planned in two parts.** The foundations need no W0 measurement and no prerequisite spec, and each is
  useful to coordinators today. So they are planned and built first, one pull request each. The generation machine
  waits for W0, because its renewal act, its anchor slot and its preconditions rest on what W0 measures.
- **The skill-size ratchet needs a ruling of its own.** It binds every programme, not only this one. Measured on
  `main` over 14 days, the coordinator skill's `SKILL.md` grew in 17 of 18 commits, and its largest reference file in
  17 of 17. Once the ratchet merges, a pull request that grows a skill file fails in the merge queue, unless it adds a
  pinned clause or puts the new text in a new reference file. So #2530 is a draft until the operator rules on its
  scope: every skill file, or `SKILL.md` only. It is ruling 16. The other foundations need no ruling.
- **Ruling 16 is made (2026-11-10).** Cap each `SKILL.md`, hold each contract inside what a compaction keeps, and
  optimise the skills. Reference files are not capped. #2555 builds it: each role skill's contract is now the first
  section of its file, behind a notice that tells a session how to see a cut, and a test holds the contract inside
  16,000 bytes. No sentence of a contract changed. The coordinator's contract has about 2,300 bytes left.
- **The coordinator skill is lean (2026-11-10).** Its `SKILL.md` went from 55,886 bytes to 23,583: the contract, a map
  of where each procedure lives, and the sections a coordinator needs at every step. The steps of a wave, the API
  calls and the cross-project wave moved to `references/wave-steps.md`, `api.md` and `cross-project.md`. The wave
  lifecycle, one file of 155,109 bytes, is now a short index and ten parts, one per step. No rule was added, removed
  or reworded: every moved section is the original text. A coordinator reads the part for the step it is on, and reads
  it again after a compaction. The tests went first (#2557, #2558, #2560) and pass on both layouts, so the move itself
  (#2559) needed no test edit. The worker skill keeps its sections: a worker needs them every wave, and it ships no
  references of its own.
- **A clause shorter is not a clause better.** The long clauses of the coordinator contract carry rules, and the
  sentences that read like rationale are pinned by tests on purpose. They were left as they are.
- **The deviation block (minted 2026-11-11 at run 1774's open) is fifty numbers from D-8202.** D-8202 to D-8231 are
  the plans' 30 recorded decisions. They are defined in the index plan, `docs/superpowers/plans/2026-11-10-overlord.md`,
  because the deviation guard reads definitions from the top level of `docs/superpowers/plans/` only; each piece's plan
  gives the whole entry with its old slug in brackets. D-8225 (one-mulberry32) belongs to the time-ports plan, and the
  simulator plan cites it. The numbers after those stay unwritten until a departure needs one: a worker names a
  departure it finds by a plain-words slug in its wave-done, and this coordinator issues the next free number and
  defines it in the index plan on a ledger PR before the worker's PR merges. D-8232 to D-8234 are the first three so
  issued (2026-11-11), for the time ports: the SQL clock pattern also catches SQLite's date functions called with no
  time value, the ambient scan also sees `AbortSignal.timeout` and the timers modules, and the fake refuses re-entry.
  D-8235 and D-8236 are the role table's two (the table's runtime guard, and the stall pin's one more import). Its
  third departure, deviations-in-a-note, is the process rule in the next bullet and takes no number. D-8237 to D-8239
  are W0a's three, all of method: the rig tooling beyond the files Task 2 named, the scenario arms split one
  environment to a run, and the force arm pinning its setting sources. D-8240 is the simulator's: the reach
  invariant's clock stops while the server is down. D-8241 is the trigger table's: the case read looks back two
  windows, so a consumed episode does not count again unless its rows span more than 14 days. D-8242 is the simulator's second: its world bounds the scheduled
  calls, so a zero-delay re-arm fails instead of hanging. D-8243 is W0b's: it runs on the fleet's own accounts.
  D-8244 to D-8250 are W0b's departures, issued on 2026-11-12 and defined in the index plan: W0-23 deferred to the
  pool design and W0-24 deferred under R18 (scope); a synthetic deny rule in the subject's project and the
  background-shell arm of W0-21 (method); the fleet reads' scope, this project's history and 14- and 9-day windows
  (scope); W0-22's canary taken from the session-start hook, and its lanes chosen by headroom (shape). The last number
  of the block, D-8251, is the fresh start's growth waiver for `ccd/ccd` (#2742); D-8630 is the anchor's, for
  `ccd/session-hook.sh` (#2803). Both are defined in the index plan. Since 2026-11-12 the programme's pieces were
  issued no block of their own: each records its departures by slug in its task note, and a number was issued only
  where a guard or a plan asked for one (D-8789 to D-8793 for the capacity plan, #3091; D-8920, D-8931 and D-8932 for
  three small pieces; D-8945 to D-8947 for the light parity check).
- **Review 1780 on the time ports (2026-11-11), at 65415597a.** Panel verdict: no critical finding. One important
  finding was kept by two of three refuters: the ambient scan missed the `globalThis.`, `?.` and `node:process` forms.
  Six minor findings and five observations; one raised-important finding (a zero-delay re-arm hangs the fake's
  `advance`) was refuted by majority as the plan's own semantics. Lenses: correctness, 1 important and 5 minor; spec
  and rings, 1 minor; does-it-reproduce, nothing (every suite reproduced, and 33 mutants of the scan each went red but
  one). Ruled: fix the important finding and four minors (a refused draw consumes no draw, `'subsec'`, a red row for
  the alias map, an L1 pin for the rules file); record two minors as known gaps; drop the deferred item on the system
  adapter's header, which states the spec's own classification. The additions fall under D-8232 and D-8233.
- **Review 1781 on the role table (2026-11-11), at 16efd101a.** Panel verdict: nothing confirmed at any lens (34
  agents, 9 advisory survivors, 13 refuted); thirteen mutations each turned their test red, and the characterization
  pins are green at the move and view commits. Ruled: key the Task 5 pin on the symbol, as the carried constraint
  says, rather than number a departure for reading the whole file; narrow one pin's title; add a line to the note.
- **Review 1782 on the time ports' fix round (2026-11-11), at b4a8fb9c9.** The first round's five fixed findings are
  closed, each measured by mutation. One important regression came with the round: the import-alias map took in any
  helper named like a clock or chance member, so an aliased import of one read as ambient (latent, no hit in the
  tree). Five minors: two unpinned guards, `'subsec'` with modifiers, the note's wording, and more recorded gaps.
  Ruled: fix all six in a second, last round. The index's wording of D-8232 and D-8233 is corrected here to match.
- **Review 1783 on W0a (2026-11-11), at 3465cf67c.** No critical finding; 12 important and 5 minor, most of them
  rows or spec paragraphs that claim more than their committed scenario shows (the D-6798 conflict rested on an
  uncommitted run), plus four rig holes: the bypass scope was a spelling check, a positional argument could ride a
  launch, a `cd` leaked out of a snapshot, and the mock's main-request marker lived outside the tree. The refute pass
  was reduced: the reviewer verified six findings itself and left the rest unrefuted. Ruled: one fix round. Re-measure
  the D-6798 row from a committed scenario, close the rig holes with tests, word every row as what the tree reproduces,
  and keep design consequences out of the spec's "As measured" paragraphs.
- **Review 1784 on the role table's fix round (2026-11-11), at 26aa56730.** Nothing confirmed; five advisory
  findings. The pin is keyed on the symbol and red under its mutations. Ruled: accept. A branch-only commit id in the
  piece's note and the pin's move to the symbol (the carried constraint's own form) need no change. A member-call
  width and a missing positive control on one pin are recorded here as known widths. #2624 merged at 26aa56730.
- **Review 1786 on the time ports' second fix round (2026-11-11), at 3d4c2b2b6.** Four minor findings and nothing
  blocking: four SQL rows unpinned (named and numbered parameters after `'subsec'`), and three forms unrecorded (a
  cast, a global reached through another global, a non-literal modifier). This round's reviewer measured the
  three-file range by mutation itself instead of running the panel; the first two rounds ran it. Ruled: accept, and
  carry the four rows and three gaps to the simulator piece's brief. #2623 merged at 3d4c2b2b6.
- **Review 1787 on W0a's fix round (2026-11-11), at c12025181.** Every first-round item closed or mostly closed;
  nothing blocking. Three important: a bypass nested one JSON level deeper still passed the rig's check from outside
  `scenarios-overlord/`, and two spec sentences still claimed more than was measured. Eight minors. The refute pass
  was partial and the spec lens stopped unfinished; the report says so. Ruled: one last fix round, which closes the
  nested route with a recursive scan and a raw-text backstop, and takes five of the minors.
- **Neither the role table nor the time ports added the role table's files to `TIME_PORT_FILES`,** because each
  landed without the other. The trigger table's piece adds them, beside its own files.
- **Reviews 1793, 1802, 1814 and 1817 on the trigger table (2026-11-11).** Round one (1793, at e5983d990) found five
  important items. F1, an occurrence is one run, arm and key, is the spec's §10.5 definition and stays; a test pins the
  known width (three queued deliveries behind one gate are three occurrences of `mail-stuck`). The rest were fixed: a
  case never opens below its evidence (`casesDue` skips an episode later than `now`), four missing reds, and a failed
  run read is warned and answered as `unread: 'runs'`. Round two (1802) found that the rewritten test no longer pinned
  "a failed read lowers the count"; fixed with a test only. Round three (1814) found four minors and nothing blocking.
  Ruled: accept. The merge queue then put #2644 out: #2444 had landed a `coord.db` migration 57 first. The cap was
  lifted by one round, the worker took `main` and moved its migration to 58 with its body unchanged, and round four
  (1817) found nothing. Recorded, not fixed: the read-bound sentence is broad for an episode wholly older than 28
  days (no count goes wrong); the note's line 3 still speaks of a fold; the D-8241 residual has no test (shadow, so a
  wrong count, never a wrong act); the tick test sees only the dispatch, and no oracle grid input is later than now.
- **Open for W4b (2026-11-11, review 1793 F1).** A per-delivery arm (`mail-stuck`, `coord-deaf`, the quiet ladder's
  moving key) counts one stall more than once, because an occurrence is one run, arm and key. The lane runs in shadow,
  so this changes no act. Whether the spec's definition should change is the question for the cases going live in
  W4b, where the shadow counts show how often it happens.
- **Reviews 1796, 1813 and 1816 on the simulator (2026-11-11).** Round one (1796, at e6ad26dd9) judged D-8240 sound
  against spec I1 and D-8242 sound with a false premise, and found five important items: `simulate` could not see an
  async rejection; four more decider mutants (M5 to M8) survived all 32 seeds; the runner's failing-baseline arm had no
  red row; the model had two homes; D-8242's premise. Ruled: make `simulate` async and fix M5 and M6 in the scenario,
  so both join the mutant set; M7 and M8 stay known survivors; the research copy stays as W0's record with one header
  line pointing at the test copy. Round two (1813) found five minors; one, a pending promise passing silently, was
  fixed with the rest in a short last round: `settle()` throws on a pending call, two runs at once are refused, the
  redundant microtask turn is gone, and the boot phase and the three resets are pinned. Round three (1816) found four
  minors and nothing blocking. Ruled: accept. Recorded, not fixed: `settle()`'s throw names no scenario or seed; two
  `sawTwo = false` resets are equivalent mutants; a crash leaves a cancelled server call's promise pending, which
  would trip the throw (no async lane does this yet); the advisories of round one, in the note's known limits.
- **Open for the spec (2026-11-11, review 1796 F2).** Both coordinator-blocked invariants fail only towards the
  operator: a push that comes late or not at all. Nothing checks a push that comes early or too often, so mutants M7
  (rung 1 on first sight of held mail) and M8 (rung 2 at minute 0) survive. Spec Table 11.7b names no such invariant.
  Whether it needs a "no push before its cause" invariant is the spec's question, for the wave that turns the push
  lane on.
- **Owed by the time-ports owner (2026-11-11).** Three local `mulberry32` copies that D-8225's nine missed;
  `fakeTime.ts`'s "one of nine local copies" comment; `time-ports-contract.test.ts`'s title after docs-grammar's copy;
  and the scan gaps the simulator's note adds (`(process as any).hrtime()`, `global.globalThis.Math.random()`, and
  `date('subsec', col)`). None is the simulator's to fix.
- **Open for the stall code's owner (2026-11-11, the simulator plan's question 2).** After a restart, a re-opened
  coord-blocked episode can push rung 1 after a rung 2, because the run-less push latch is in memory (D-3751).
  `stall.ts` documents "pushes it once more", not a lower push. The simulator's worked example states the rung never
  falls between boots, and counts the re-opened edge. Whether a lower push is intended is not this programme's to
  decide; a fix, if any, is a change of its own.
- **Reviews 1789 to 1791 on W0a (2026-11-11).** Round three (1789, full panel) closed the nested-JSON route and found
  two more at the rig's bypass boundary: a `mainMarker` starting with `-` read as a node option, so scenario data ran
  code, and escaped YAML or loose-JSON spellings of the mode. The review-round cap was extended by one for them, the
  only extension in the programme so far, because the boundary is a safety one and the rounds were converging. Round
  four (1790) found a two-document scenario file whose first document was never checked, and line terminators the
  continuation join missed, and no route from data to code. Round five (1791) read the one commit that closed them and
  found four minors only: the CRLF alternative is unpinned, a byte-order mark passes, and two wording points. Ruled:
  accept, and record the minors here. #2632 merged at 6e2341647.
- **W0b runs on the fleet's own accounts (the operator's ruling, 2026-11-11).** "Use accounts from any pool": no
  scratch accounts and no pool-tagged project. Item 155 is withdrawn and replaced by item 163, which asks for one test
  session on any account, consent, a few console acts and the account readings. What the scratch accounts guarded is
  kept by rule: the subject is never asked to type `/model` or `/effort` with a value (W0a measured a typed `/model`
  saving the account's default, and D-8149 the plain `/effort` form), it is the only session swapped, and no reading
  touches a credential or a value. W0b's plan records this as a departure from its setup lines 1 to 3 when it runs.
- **R18: account pools replace reserved accounts (the operator, 2026-11-12).** "I don't think I want to reserve any
  accounts specifically for overlord, what I'd like to do instead, is identify which account pools overlord may use
  accounts from. That provides the right balance." Item 156 (reserve accounts in W1) was withdrawn. Run 1856 wrote it
  into the spec: the set lives on the designation, written only by the operator's doors and a Settings row; the pool
  rule's session side widens to a set, so placement keeps one decider; an untagged account serves only by an explicit
  yes; an empty set never designates; and a read-only `ccd pool-answer` tells the renewal lane whether the Overlord
  must move back inside the set. Reviews 1858 (nine findings), 1860 (seven) and 1862 (six minors, carried to W1)
  closed it. Two calls are the coordinator's, marked in "Where things stand": a deliberate `--cross-pool` move holds
  until the next renewal of any kind, and widening the set takes a step-up. The operator approved both (item 178), and
  #2705 merged at 4489396ce.
- **W0b's answers (run 1820, #2711, 2026-11-11 and 2026-11-12).** On the fleet's own accounts, with the operator's
  console acts:
  - the deadlines stand (W0-06, W0-26);
  - every account carries project memory, skills and plugins, so W1a raises an operator item on auto memory, and the
    no-mods check stays required (W0-09, W0-19);
  - real fallback notices are unmeasured, so the conservative branch stands (W0-12);
  - typed and mailed texts were done alike, rated 5 on all ten pairs, and the gate dominates, so the Overlord gets its
    own `MAIL_PACE` row (W0-20); two invited replies were held by `peer-quota` and never delivered;
  - an idle swap and an interrupting swap each passed 3 of 3, and a background shell is lost across a swap (W0-21);
  - two of the fleet's own lanes passed every check, so the operator may set those records in W1 (W0-22);
  - W0-23 and W0-24 are deferred under R18; the sweep showed no Fable use that week;
  - the replay baseline is B (W0-28, item 168).

  Reviews 1868 (four findings and eleven advisories), 1870 (four) and 1871 (none) closed it. Ruled: W0-24's use in the
  shared Fable test is W1's call (C46); the `sevenPct` read that chose the lanes was within consent (D-8250).
- **Open for the coordinator (2026-11-12), W0b's proposals.** Proposal 11: an invited reply is never refused by the
  peer bound (exempt replies from the pair bound, hold rather than refuse, give a retry hint); W0-20 measured the
  failure on today's sessions, so it is a follow-up issue outside this programme, for the operator to decide on.
  (It was then built here as #2738, with its plan in #2728.) Proposal 12: the renewal lane nudges a resumed session that lost a background task (W1a's machine).
- **A work branch cannot edit an existing plan file** (2026-11-11, measured on #2623) unless its commit carries a
  Ledger-Edit trailer, as W0a's did: the ledger-guard CI step refuses it. So a worker writes its departures, its rulings within the plan and its deferred minors in a new note
  beside its plan (the time ports' is `2026-11-10-overlord/w1a-time-ports/departures.md`), and this coordinator folds
  the departures into the plan and the index on a ledger PR. Later briefs say so. Since 2026-11-17 a new task note
  goes under `docs/superpowers/programs/overlord/<task>.md`, because the ledger guard's layout arm (#2986) refuses a
  new file under `docs/superpowers/plans/`.
- **The spec was verified in four rounds.** The first model covers the hold, readiness, generation and push machines:
  1.86 million states over 15 scenarios, 24 readings the text had left unsettled, and one design fault. #2529 writes
  each settled reading into the spec. The second covers authority, restore, requests, commands, the push budget and
  playbook entries: 2.07 million states over 73 runs and 38 findings, one a blocker (a restore that lost acts read
  as coherent). #2538 writes those in, and adds two invariants, because 31 of 40 planted faults broke none of I1 to
  I10. The first model is the simulator's first model, which the simulator plan moves under the test tree. The
  second is W1's authority and restore model, done early. The third round is two pieces. One enumerates every
  decider table over its whole domain: total, ordered safely, monotonic, and agreeing with its restatements. The
  other models the reservation arithmetic, the operator's messages, the privacy rules and the joint cases of a
  restore. Together they made 80 findings, and #2539 writes them in. A last reader went through every line the
  follow-ups changed and found 29 passages that still stated an old rule. #2542 closes them. The fourth round models
  what judges the Overlord and how trust is earned: 32 findings, written in by #2543.
- **Trust is slow to earn at the starting values, and the spec now says how slow.** The fourth round computed what
  each gate takes (the spec's Table 9.5b). A kind of answer leaves shadow after 30 answers if the operator examines
  every accept, and about 300 if two in five. A routine answer given alone needs 59 clean blind answers in its cell
  at a `lambda` of 1. So the Overlord mostly briefs and recommends for its first months. The dials are the
  operator's, in rulings 8 and 15.
- **A cell for an answer of class none is the fleet's.** The model's fix scoped a cell to one programme, which put
  about 470 questions between a programme and its first routine answer. #2543 scopes it to the fleet, and keeps a
  grant's scope for an answer under a grant. This is the operator's to overturn.
- **On a reserved account the Overlord's load reads its reserve.** The third round found that guests at their
  ceiling held a reserved account near the Overlord's soft line, so it left with most of its reserve unspent. The
  model's fix lowered the guests' ceiling from 58% of the account to 30%. The operator had ruled that a fenced
  account is waste, so #2539 keeps the guests' ceiling and changes what the Overlord's lines read instead.
  Superseded by R18 (#2705): no account is reserved, so there is no guest and no reserve.
- **The ask-or-act example was wrong by three.** At the starting weights a routine answer needs about sixty blind
  answers with none overturned, not about twenty. Ruling 15 now carries the figure, and the figure at a setting
  of 3.
- **Calls in #2538 and #2539 are the operator's to overturn.** #2539's description lists eleven more, and #2543's
  eight. In #2538: A renewal voids a staged act. After a boot the rung is capped at `advise`, not `chat`, until a
  witness answers. The Overlord cannot drop a request that waits on the operator.
- **The operator's directions to the hardening review** are recorded in the spec's §2: built to run in containers; a
  decision model for the yes-or-no questions code cannot decide; accounts reserved for the Overlord and never
  fenced off, with auto memory off for every role. R18 (#2705) replaced the reservation with the account pools the
  operator names; nothing is fenced off, and the auto-memory direction stands.
- **The spec supersedes rev 8.** The coordinator's workspace branch takes `main`'s copy of the spec file whole.

### Since #2712 (2026-11-12 to 2026-11-23)

The rulings below are the operator's or this coordinator's. A piece's own departures are in its task note, under
`docs/superpowers/plans/2026-11-14-overlord-w1/` and `docs/superpowers/programs/overlord/`; they are not repeated here.

- **The operator's rulings R19 to R23, and what they ask of later waves.** R19 (2026-11-12): renewals and the account
  moves that cause them must not be felt (#2719). R20 (11-14): a session sets itself follow-up timers, and the Overlord
  measures how the operator responds to each message (#2792). R21 (11-15): two marks on Waiting on you, "the Overlord
  could answer this" and "I'm unsure", which train it and grant nothing (#2871, built as #2879, #2892, #2902); the
  operator approved §9.5.1, technical detail earned from measured outcomes, as written (item 345), and ruled that each
  Overlord reply is recorded in the private store at the end of its turn (item 327) (#2901). R22 (11-19): the brakes,
  lifting a review cap, stopping or abandoning or reclaiming a run, and dispatch-cap proposals join the Overlord's acts.
  R23 (11-19): an autonomy mode, and autonomy for coordinators (#3051). The operator added the same day that autonomy
  mode acts straight away, with no per-kind shadow earning at the `autonomous` rung or for a coordinator's autonomy;
  the W3 step-two plan's brief must say so. R23's clauses are not in the contract's budget (#2845): they need a raise
  or a shortening at W3 or W4.
- **The face's operator answers (2026-11-13).** Item 192: all fourteen moods, the Orb icon and the shipped fonts. Item
  195: a renewed coordinator is probed on its current thread, with the newest ruling in its checkpoint, in W1a. Item
  196: the face is in every top bar now. Items 218 and 219 (11-14) cool the face down before it calms and narrow Crying
  and Dizzy (#2791); the cool-down time is to be tuned later.
- **A second autonomy window (the operator, 2026-11-14).** Twenty-four hours of autonomy, and as much parallel work
  across workspaces as the box allows. The plans mark which pieces need nothing first, and the W2 vocabulary, private
  names, the decision-model port, remaining work and forecasts were built among those, ahead of the rest of W1.
- **The replay baseline must be real (the operator, 2026-11-17).** The W1a lanes wait for a true quiz baseline, never
  "not taken". The record path was built (#2988, #2991, plan #2984). A single-arm run skips W2's pilot acts, by a
  recorded ruling that covers this measure only. The weekly spend cap is 5 million token-equivalents. This coordinator
  ruled that every admitted family is measured, and that a refused family is left refused with no clamp. On 2026-11-22
  the operator asked for no manual quiz task, so #3169 makes the quiz run, record and confirm itself.
- **Approvals go through the coordinator and the Overlord (the operator, 2026-11-18).** A permission prompt must not
  reach the operator directly. The diagnosis found a child's prompt that reached the lane, lapsed after 180
  seconds, and was answered by the operator 91 minutes later, and 11 of 48 live children carrying a stale deny digest
  that made the hook skip the lane silently. So the stale-digest routing was the first PR (#3045), and the park was
  built inert (#3106). The plan is
  `docs/superpowers/plans/2026-11-18-overlord-approvals.md`.
- **D-8126's build and the capacity drafts are this programme's (the operator's direction, 2026-11-19).** The waves A4
  to A7, A9 and A10 of D-8126 are taken in; A8 and the cap counting are not. The capacity drafts are adopted and landed
  in order, and W1-4b (D-6096) is taken in. The coordinator contract now has twenty-two clauses on main: clause 21
  decides by default (#3100) and clause 22 is the plan clause. The recall clause is the 23rd (#2919), and the Overlord
  clause comes after it.
- **No chores for the operator (the operator, 2026-11-22).** A task the system can do is never handed to the
  operator: the quiz, the capture switch, a new Claude Code release, a lane switch. Four runs were dispatched, and each
  merged: the test box's tool sync takes a home (#3167), the quiz runs itself (#3169), a release needs no operator
  (#3170), and the capture runner (#3171, #3168). Arming the park lane, the anchor slot and the W1a lanes is to be the
  coordinator's, through their doors, not the operator's.
- **The capture runner's build source is the fleet (2026-11-22).** It copies the exact build version the fleet runs,
  read-only, over the admin lane, hash-verified at both ends, into a scratch home only. No egress and no credential
  is involved. A deadline with the runner not alive and nothing recorded gives no verdict and a retry (a big call,
  built in PR 2). The note is `docs/superpowers/programs/overlord/capture-runner.md`.
- **The judge's codes (2026-11-19 to 2026-11-22).** A reviewed, green PR whose only blocking judge code is
  `proof-not-built` lands (the operator's standing yes, item 480). `rules-mixed` is accepted by precedent and named in
  the PR body, with no split. A devops or code-owner approval code never parks a PR (the operator, 2026-11-22).
- **Ten W1 pieces ran in parallel (dispatched 2026-11-22).** The sandbox check, the inbox, serviceability B, the
  sequence, the authority journal's B and C, the isolation word, the door process's B2, home A and renewal readings C.
  Peers share a file by each taking their own hunks: no packets between them, and the second lander merges main and
  keeps both sides. A file frozen by another programme's open run still takes a packet first. A consumer port with a
  stand-in covers a fact that has not landed.
- **One licensed absorption per PR (2026-11-23).** Each PR may merge main once, for a measured conflict, when it is
  next to land, on the coordinator's mail that names the base. Reviews run on the current head before that, so fix
  rounds happen outside the landing window. A second merge, or any replacement of a head, is the operator's keeper's
  (the keeper is the actor the operator runs for such acts; no session of this programme is one).
  A PR whose conflict makes it unmergeable cannot be enqueued, so there is no ejection route either.
- **The landing order (2026-11-23).** Renewal readings C, the isolation word and capture PR 2 conflict pairwise
  (measured: capture and renewal in the schema and its database pin; capture and isolation in the architecture spec;
  renewal and isolation in the ladder test). Renewal landed first (#3209), isolation second, taking its one absorption
  for the ladder test only (#3208). Capture is third, behind item 605. The inbox absorbs next, then the others as each
  conflict is re-measured at the new main. `server/src/auth/gate.ts` is the hot file: every lander re-conflicts the
  next.
- **Accepted at the review cap, with the cutoff.** At the cap, a finding is fixed only if it is one line and already
  tested; the rest go to the PR body's Known limits. Renewal readings C (#3209) was accepted at review 3472, with three
  minor advisories added. The isolation word (#3208) was accepted at review 3483, the sixth and last, with four minor
  notes: a vacuous uniqueness line and two stale case titles in the ladder test, README hashes in the note that cannot
  be reproduced, boot tests that read host ids in memory, and hand mutants that cannot be replayed.
- **Renewal F1, a big call the operator may overturn (2026-11-23).** The probes-failed-twice latch is raised once; a
  refused, thrown or crash-lost raise is not asked again. Accepted as built, with a Known limits line. The obligation
  that goes with it: make the raise recoverable, which needs a stored reason for the degrade, before any rung above
  `chat` depends on this latch.
- **Authority B's two calls, big, the operator may overturn (2026-11-23).** A witness that reports a rollback counts
  for the narrowing that Confirm reads, and a held tuple is never replaced by a term-wise lower offer. Both depart from
  the plan's text. Review 3372 found two critical and eight important findings. The fixes for findings 3 to 11 stay
  local and unpushed, since a PR that conflicts gets no CI. At its one absorption the PR wires its exchange in place of
  main's stand-in witness adapter, because Confirm (#3204) merged first. Then one push, CI, one wave-done and one review
  (round 2 of 3). Finding 12, that the red-first order was not measured, is a known limit.
- **The review cap counts a review that never ran.** Renewal's rounds included a review that never ran, so it had used
  2 of 3 after one real round. Inbox's round 3497 was abandoned by the server before any reviewer started, yet it still
  counts: the next review is round 3 of 3. The cap is lifted with `runs review-rounds` and a reason that names the
  never-run round. For Inbox, the review that ran on the held head is round 3, and the later second merge gets its own narrow
  review.
- **The one re-enqueue (2026-11-23).** The isolation word's PR was dequeued after a queue run failed one case of the
  test-box package file, which re-pairs at the same tag and timed out at its 20-second limit. The same case took 1.8
  seconds in the PR's own run of the same tree, and the file is not the isolation word's. The cause is unmeasured. The
  verdict, the checks, the landing entry and the probe were re-read clean, and the PR was enqueued once more and
  merged (#3208). A second dequeue for an unrelated red is a stop for the operator, with the queue run named, not a
  third attempt.
- **The disk block (2026-11-23).** The fleet host refused a new review workspace, with 9 GB free against a 10 GB floor
  and the disk near full. The server opened no workspace and later abandoned that review run, which still counted as a
  round. A review is dispatched only when free space is safely over the floor: the host rounds free space down to whole
  GiB, so 10,178 MiB counts as 9. A refused dispatch burns a round. About nineteen review workspaces from closed runs
  were still on disk; the server's reclaim owns them. Free space was back at 11.6 GiB at 09:10Z and the inbox's review
  (run 3506) was dispatched. A composed brief is capped at 8,192 bytes with its prefix, and a first brief of 9,554 bytes
  was refused as oversize.
- **The weekly quiz finding and its repair (2026-11-23).** Week 47 stands `failed`, `pilot-failed`: under settings
  mode `restricted` the pilot's persistence, plugins, skill and tools checks fail on the build then current. Week 48
  never started: the weekly timer fires 30 minutes after it becomes active and six hours after its last run ended, it
  has been active since 2026-11-22 20:45Z, and it has never fired. Its next elapse slid with each reload of the user
  manager (346 distinct reloads in 11 hours, the longest gap 14.3 minutes), and the later rule has no base because the
  one run on record ended before the timer was last started. That a reload re-bases the first rule is this
  coordinator's reading of the mechanism; the sliding is measured. Run 3508 (opened 2026-11-23, no D-number) builds
  the repair. Its first brief also had the runner take the driver's fallback settings mode once. The worker read the
  driver before building, as the brief asked, and found that fallback cannot pass the pilot on that build: the build
  reports the Agent tool under another wire name while the driver compares the literal name; plugins that ship with
  the build load whatever the settings and the check wants none; one probe leaves a subagent's transcript on disk
  with session persistence off; and the skill check is unknown under fallback. So the fallback path was withdrawn the
  same day (a big call the operator may overturn). Run 3508 is now the wall-clock trigger and a starved trigger said
  in words. Week 47 is not reopened. A separate piece will rule on the pilot's three stale checks: the first reading
  is that the wire name is an alias and not a weakening, that the plugins check admits only what the build marks as
  its own, and that the persistence check guards the history store from quiz text and is not waived. Until then the
  quiz runs each week and stops at its pilot word, once a week. No session runs a manual quiz or changes a live
  setting. Known limit: the real timer cannot be proven until the release reaches the box; the coordinator reads the
  box after. The recall clause stays held on the baseline.
- **Operator items open (2026-11-23).** Item 605: the keeper publishes capture PR 2's replacement head. Item 606 (plain-words
  report files): reviews 3366 and 3370 of the sandbox PRs wait on the operator's word on how a report file is written. Item 607: the keeper integrates main into home A's PR with two prepared
  files. Item 615 (decide): may a worker make a second merge of main when the coordinator has measured the conflict and
  named the base. The recommendation is a standing yes for this programme's W1 PRs. It would also let home A's worker
  do item 607. Until the operator answers, no second sync.
- **Hook refusals (2026-11-17 and 2026-11-22).** A hook refusal is reported, never routed around: a refused call is
  not retried by changing its wording, tool, form or session. One scoped word went to the four no-chores runs of
  2026-11-22: where the hook refused a note or a mail body for its words only, the worker could redo it with the plain
  file tools and plain words, list it in the wave-done, and stop if that was refused too or if the act reached the
  guarded thing. Whether a reviewer may file a held report that way is the operator's to say (item 606); until then
  the two sandbox reviews hold their reports.

## Carried constraints

- **Characterization first.** Every foundation that moves code pins today's behaviour first, green on the old code.
  The move commit changes only what the plan names.
- **Every guard has its mutation.** Each plan names, for each new guard, the mutation that turns its test red.
- **Additive wire, absent permits.** Nothing in W0 or W1a bumps `FLEET_PROTO`. A new field is read by one reader, and
  an older peer may omit it.
- **Keying the mail pace by role changes behaviour for one case.** A session with declared coordinator intent and no
  open run reads the worker's pace today. Moving the pace onto `roleOf` gives it the coordinator's. That change is a
  commit of its own, with its own test, in the role-table work, never in the mail-pace plan.
- **`FLEET_ROLES` holds data only.** It is an L0 table and imports nothing. What a role does lives in L1 records
  keyed by role (`MAIL_PACE`, the renewal triggers), each total over the roles.
- **The skill-size ratchet lands before the recall clause.** That clause's pull request is then the first to use the
  one allowed raise.
- **A source pin is keyed on a symbol.** A test that pins what a function reads takes the function's text through
  `server/test/scan/symbols.ts#sourceOfSymbol`, never the whole file as text. The literal-pin ratchet fails the
  other form.
- **Public repository.** Plans, commits, branch names and issues carry no private names, hosts, accounts or people.
- **A kept `Cancel` is a scheduler** (review 1780, O1). A file that keeps the `Cancel` from `scheduler.after(…)` on an
  object field or at module scope schedules, so it is L4, but the ring rule's timer reader sees only `setTimeout` and
  `setInterval`. The first piece that keeps one (the renewal lane) teaches the reader `.after(` first. The simulator
  bounds the scheduled calls per world instead (D-8242), so a zero-delay re-arm fails rather than hanging.
- **A simulator predicate that reads sweep times assumes the simulator's beat** (review 1816 F1). CB-reach's
  threshold arm is exact only where sweeps fire at the boot's phase plus whole sweeps, as in the simulator. D-8214 runs
  a simulator predicate unchanged in the W1 monitor, where sweeps drift, so the monitor carries the real sweep phase or
  keeps the plan's looser bound, `max(m + COORD_BLOCKED_HELD_MS, steadySince) + STALL_SWEEP_MS`. The same holds for
  D-8240's down rule, which a monitor that sees only boots cannot apply.
- **An async lane in the simulator runs after the timers** (the simulator's known limit). A continuation after an
  `await` runs after the whole `runUntil`, so an async lane is not interleaved with the timers, and only microtasks
  are drained. A W1 piece that tests an async lane in the simulator says so, or extends the world.
- **R18's minors, for the W1 plan** (review 1862). The tick path's verdict site (`stuck=pool`) as well as the rc-4
  arm; the agent whitelist row and argument form for `ccd pool-answer`, and its exit codes and grammar; the
  `projection` word applies fleet-wide; a rescue can land on a `prefer --cross-pool` home until the next renewal; and
  what follows a pool-set rollback.
- **The sweep's per-session account can differ from its per-account attribution** for a session that moved between
  lanes (review 1871). A W1 reader of `perSession` says which one it means.
- **Three unrelated 20-second-limit timeouts, cause unmeasured** (watch items, 2026-11-22 and 2026-11-23). One update
  rollback case (a PR's run, which passed at 19.3 s on its single retry; the file is identical to main's), one topology
  case (timed out on the sandbox hook PR's first attempt, 14.2 s on its second), and one test-box re-pair case (the
  queue run that dequeued the isolation word; 1.8 s in the PR run). Each is a different file and none is a PR's own
  change. A second dequeue for an unrelated red is a stop for the operator, not a retry.
- **One prompt-record case reads the real home disk** and is red on a nearly full box (seen on the inbox PR, 2026-11-23).
  It is test isolation, not the inbox's; whoever owns the prompt record fixes it.
- **The isolation plan's safety sentence** (its plan, around lines 440 to 443) is scoped to the isolation tests, per the
  coordinator's ruling on the PR's third note. It is a ledger edit to that plan on a branch of its own. Also owed
  from that PR: the labelled README diff form for the hash in its task note, Table 7.5a's wording in plan lines 58
  and 923, and optional wiring-input pins before the rung becomes observable.
- **No test pins the `notice` field** of the ladder rows `unwitnessed-third` and `probes-failed-twice` (the isolation
  reviewer's observation). Add a pin before either row's notice matters.
- **The restore reader `termRaised()`** in `overlordRestoreState.ts` has no production caller, because renewal readings
  C uses the per-generation decider. Retire it, re-point it, or amend the authority-journal plan's hand-off.
- **W3 reuses the existing model-behind predicate** (#3238, another programme's merge, 2026-11-23). W3's evaluation-due
  decision calls `aliasModelBehind` in `shared/model-aliases.mjs`, the age-free part of the doctor's session-behind
  test; it does not derive one. Unmeasured or unreadable is never behind. The automatic roll that uses it is an
  idle-roll evidence producer, not a second renewal decider, so one fact keeps one writer. W3's worker reads the
  residuals note that #3238 added before designing the model-digest arm.
- **Sequence A and Inbox share the acknowledgement stamp** (2026-11-22). The second lander of the two owns the
  acknowledgement stamp and its census entry; the queue, delivery and settlement stamps remain outstanding. Authority C's
  and the provisional migration number's second-lander duties are unchanged. A migration number is measured again at
  every absorb: the numbers are taken in landing order and a later PR renumbers (renewal readings C holds 122).
- **Ladder stamps stay in the sequence's PR B,** not in PR A.
- **Sandbox hook (#3213) and the sandbox check (#3205) stay together** (2026-11-22): no split. The arm is the profile's
  whole door namespace, not one reader per door, and the PR claims no live enforcement.
- **The recall clause is renumbered to 23 and holds.** Its count word, its cap (main's plus 201) and clause 17's
  length changed with the number, each hunk agreed by its holder on 2026-11-22. If main moves again, the hunks need
  fresh agreement.
- **The Overlord clause waits on the recall clause** and on D-8126's clause 21 and the plan clause, both on main. It
  takes the next free number at its merge.
- **The PreCompact refusal's JSON block form is unmeasured.** W0-13 measured an exit code that the hook's contract
  cannot use. Measure the block form before anything writes `precompact=refuse`. The order of a turn's first prompt
  and an automatic PreCompact is unmeasured too, and the arm fails open there. The other carries of review 1902 went
  into builders' briefs; a piece's own note records what it still owes.

## Next-wave brief

State as of 2026-11-23 09:30Z, with main at 58e412e1e7.

- **Where to start.** Read the spec's "In short", §14 (the build order) and "Where things stand". Then read the plan
  of the piece you take, and its task note if it has one. Each plan is self-contained.
- **Done.** W0 (#2632, #2711), the W1a foundations, and the W1a machine except the recall clause and `continuity-v1`.
  W1 is built through the vocabulary, the skill, the journal kernel and the authority journal's A and C, the pool set,
  the push outbox and response record, the designation's A and C, the gates, the ladder, the other write lanes, ccd's
  arms, serviceability A, the private store, the portfolio, the history op, the sandbox's A and A2, the door process,
  renewal readings A and C, the isolation word and the answer marks. W2 has its plans and its first twelve pieces. The
  Waves table has each PR.
- **Open runs, and what each waits on.**
  - Inbox, #3220 (run 3295): its review, run 3506, is round 3 of 3 on the held head. The head conflicts with main
    in one file. A second merge waits on item 615. Then CI, and one narrow review of the merge.
  - Authority B, #3215 (run 3299): in its first fix round, fixes local. It waits for its turn to absorb main (once),
    then wires its exchange in place of the stand-in witness adapter, then one push.
  - Serviceability B, #3210 (run 3296) and Sequence A, #3218 (run 3297): each sent a wave-done at its head, each
    conflicts with main, each waits for its turn to absorb. Measure the conflict at the new main before naming a base.
  - Sandbox, #3213 (run 3332, held) and #3205 (run 3294): wait on item 606 for their review reports, and on the landing
    order (#3213 first). #3205 conflicts in the ladder files.
  - Home A, #3207 (run 3302): waits on item 607.
  - Capture PR 2, #3239 (run 3237): waits on item 605. Capture's wiring (PR 3b) is a new run after it.
  - The recall clause, #2919 (run 2245): accepted, held until the replay baseline is confirmed.
  - The weekly quiz's repair (run 3508): in build, narrowed to the trigger. After it merges and the release reaches
    the box, read the box. Then open the piece for the pilot's three stale checks, from the readings in its note.
- **Queue next, as dispatch slots and the disk allow.** Designation B (after sandbox B), the sequence's PR B (after A),
  the board's B (after the inbox), readiness (after its dependencies), renewal readings B, D, E and F, the Overlord's
  timers, home B and C, chat, the `overlord-v1` plan and the Overlord clause (after the recall clause); then the W2
  pieces that wait on them, and D-8126's A10 measurement, due about 30 days after A9's rollout mail. W1-5 is not built.
  Dispatch a review only with free space safely over the floor.
- **What the operator has been asked.** Item 605: publish capture PR 2's replacement head (the operator's keeper).
  Item 606: how a review report file is written (plain-words report files), which holds two sandbox reviews. Item 607:
  integrate main into home A's PR with its two prepared files (the keeper). Item 615: may a worker make a second merge of
  main when the coordinator has measured the conflict and named the base; the recommendation is a standing yes for this
  programme's W1 PRs. The Overlord's account pools are named in Settings once W1's set row is live (R18). Three
  big calls stand until the operator overturns them: Renewal F1, and Authority B's two.
- **Standing rules a coordinator keeps.**
  - Land only through the merge queue, with the head pinned by the landing entry. Never an admin merge. Never touch the
    queue once a PR is in it. One re-enqueue after an unrelated timeout, then stop for the operator.
  - One licensed absorption of main per PR, on the coordinator's mail naming the base, when the PR is next to land. A
    second sync, or any replacement of a head, is the operator's keeper's. A conflicting PR cannot be enqueued.
  - Review in a separate worktree at an exact head, reported to the coordinator, who closes the review with the reviewer's
    measured tip. Three rounds is the cap, and a review that never ran counts. Lift it with a reason that names the
    round. At the cap, fix only a one-line, already-tested finding; the rest are Known limits in the PR body.
  - Open the next wave's run before closing the last. After a MERGED mail, prove MERGED at the pinned head, then close
    the run final and require `released:true`.
  - A brief is at most 8,192 bytes with its prefix. Keep saved server answers out of the scan folder, and name a report
    file by its name only, never a path, in any mail.
  - Peers share a file by their own hunks, and the second lander keeps both sides. A file frozen by another
    programme's open run takes a packet first.
- **What to report.** Each piece ends with its pull request merged through the queue, its note's departures recorded,
  and this ledger's row updated on a `ledger/overlord` branch. Fold each piece's note into this ledger as it lands.
