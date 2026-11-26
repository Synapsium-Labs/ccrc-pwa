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
| W1a, the machine | The weekly quiz's repair: a trigger that cannot starve, and a starved trigger said in words | #3252 | merged (33cc21c00e) |
| W1a, the machine | The pilot's three stale checks against the current Claude Code build (tools, plugins, persistence) | #3253 | merged (d5a032c409) |
| W1a, the machine | The quiz chooses its account each week by the fleet's one room rule | #3262 | merged (e29f704d47) |
| W1a, the machine | The quiz pilot's stage B: a re-pilot keyed on what can change its outcome, the staged skill, the plugin settings, the persistence shape | #3267 | merged (99743009a9) |
| W1a, the machine | The coordinator skill's recall clause (clause 23, after the two clauses that merged first) | #2919 | merged (a3fb5d1a2a); the hold on the replay baseline was dropped on 2026-11-24 |
| W1a, the machine | `continuity-v1` and the arming of the W1a lanes | the word is merged and in `SERVER_CAP_MAP`; the arming is not started | the arming waits for the replay baseline (the recall clause is merged) |
| W1a, the machine | The contract's restore budget raised to fit the four waiting coordinator clauses (operator item 326) | #2845 | merged |
| W1, the face | The face's design system (art, `Character`, `overlord_`, the Orb icons); the face in the app (mood, character choice, every bar, splash, badge); the cool-down (items 218, 219); one hearing rule, every surface through `useHeard` | #2741; #2781; #2791; #2824, #2835; plan #2729 | merged |
| W1 plans | The index (#2814, folded in #2885) and one plan per piece: #2815 to #2818, #2829 to #2832, #2853 to #2856, #2861 to #2864, #2866 to #2869, #2874 to #2876, #2881 to #2883. Plans in `docs/superpowers/plans/2026-11-14-overlord-w1/` | those PRs | merged |
| W1 | Vocabulary: injected prompts and their census, the refusal words, the trigger kind | #2840 | merged |
| W1 | The `ccrc-overlord` skill: its references, staging and the role-skill deny | #2833 | merged |
| W1 | The journal kernel moved to K; the shared append-only port and chained-journal file adapter; the file's verified head | #2848; #2880; #2985 | merged |
| W1 | Authority journal: the journal, its fold, writer and boot coherence (A); Confirm the restore, one transaction behind the step-up (C) | #2895; #3204 | merged |
| W1 | Authority journal B: the authority witness, its exchange and the ladder's two rows | #3370 (supersedes #3215, closed 2026-11-25 when its worker died); run 3744 | merged (911372c399, 2026-11-25 14:27:53Z) after reviews 3764, 3787 and 3801. #3215's last review (3732, round 6 of 6) found no defect |
| W1 | Pool set: the set in L0 and its library (A1), the session's side (A2), every reader's side (A3), `ccd pool-answer` and the capability floor (B1), `--below-cap` and the push on a lost set (B2) | #2836, #2846, #2857, #2877, #2887 | merged |
| W1 | Push outbox (the record and its rules, then the one sender); response record (A, B) | #2838, #2859; #2884, #2914 | merged |
| W1 | Designation: the row, its term, create and retire (A); the model class and account set doors (C) | #2950; #2992 | merged. B (Rebind and Restart, the first start's deadline, the set before each renewal): #3346, run 3652, merged (80b994c831, 2026-11-25 12:03:50Z) |
| W1 | Gates: actor columns and the operator doors through `CallerIdentity` (A); the gate order as one decider (B) | #2993; #3076 | merged |
| W1 | The ladder, its rung door, Pause and off; refusals on the other write lanes (A) | #2994; #2996 | merged |
| W1 | ccd's Overlord arms: keep-awake and the long-lived library (A), the hold-down, stand-down and crossing end (B), the fresh pick in three steps (C1, C2) | #2898, #2945, #2957, #2971 | merged |
| W1 | Serviceability: billing and continuity facts, the three inputs, their Settings door (A) | #2878 | merged |
| W1 | Serviceability B: `limit_samples`, `poolRunway`, the load lines, the runway read, the 95% ladder row | #3367 (supersedes #3210); run 3746 | merged (58acf1d450), migration slot 126 |
| W1 | Private store: the store, its journal and safety nets (A); the console's prompt recorded, then nudged (B) | #2896; #3034 | merged |
| W1 | Portfolio: the rank, its one writer, the read and rank doors (A); who ratified each goals version (B) | #2842; #2904 | merged |
| W1 | Board and history: the read-only history op on the agent (A) | #2841 | merged |
| W1 | Board and history: the history door (B1) | #3348; run 3653 | merged (2f140376dd) |
| W1 | Sandbox: the launch profile measured and rendered (A); the overlord workspace, digest probes, launch-surface-v1 and the no-mods check (A2) | #2847; #2889 | merged |
| W1 | Sandbox B: the sandbox check, surface arm and settle step (#3205); the hook's surface arm as a PR of its own (#3213) | #3205, #3213 | merged: #3213 (70ebe6d876), then #3205 (f00f030a28) |
| W1 | Sandbox: the carried pins of reviews 3366 and 3598, and a failed re-read answers `unread` | #3371; run 3758 | merged (657477678e, 2026-11-25 10:16:46Z) |
| W1 | Door process: the act-key claim door (A1), the spawn step and the door with `ccrc-api` inside (A2), the hook's reports and the witness (B1), the model events and the reader and typed-model arms (B2) | #3035, #3057, #3099, #3201 | merged |
| W1 | Renewal readings: the seam, the fitted ceiling and the backstop (A); the raised term, the changed class and the probes-failed-twice latch (C); `notLocal` from the transcript resolver (B); model drift and the readers running (E); turns and the operator's quiet (F) | #2962; #3209; #3343; #3350; #3352 | merged: B (c4c3157866), E (676d955d23), F (a4b94d0bc1). D, the account readings: #3377, run 3773, merged (bc65307b1a). G waits on home B and H on readiness |
| W1 | Four more console routes write the operator mark, and the drawer's throttle survives a clock step back | #3373; run 3757 | merged (13776b93d3, 2026-11-25 11:31:19Z) |
| W1 | The isolation word, measured by both sides | #3208 | merged (5102a69aa3), accepted at the review cap |
| W1 | Answer marks (R21): on Waiting on you items (A), on asks the operator has (B), "could handle this" on tasks (C) | #2879, #2892, #2902 | merged |
| W1 | The sequence, its writer, its stamps and its retention lane (A) | #3218 | merged (7e1f9752fe, 2026-11-25 00:17:27Z), migration slot 125 |
| W1 | The inbox, messages and acknowledge doors, the read runner and the coalesced wake | #3220 | merged (01ee0e850c) |
| W1 | Home and Settings, PR A: the console's home and places, with the Overlord's door | #3207 | merged (6965b6d830) |
| W1 | The sequence, PR B1: every W1 change is stamped (the message movers, the ladder's writers, the receipt duty, the kept line) | #3395; run 3820 | merged (2f59263e25, 2026-11-25 21:50:09Z) |
| W1 | The sequence, PR B2: the invariant monitor, in shadow | #3394; run 3821 | merged (ad35cf5538, 2026-11-26 00:55:35Z) after reviews 3843 and 3878, migration slot 129 |
| W1 | The sequence, PR C: the cursor read's door, the operator's read of the monitor's record, the `sequence` door tool, and the carries of review 3878 | run 3886 | stage 1 built locally; stage 2 (the routes, the door rows, the censuses) waits for the readiness door on main |
| W1 | The Overlord's timers: the role as a setter of the one timer lane | #3388; run 3796 | merged (4fa87d73f8, 2026-11-25 22:18:23Z), migration slot 128 |
| W1 | Readiness: the measured word, its lane, its read and what the operator is told | run 3866 | stage 2 building since 2026-11-26 00:58Z on main ad35cf5538; its migration number is final only at its last merge before the queue |
| W1 | The `overlord-v1` plan, `docs/superpowers/plans/2026-11-25-overlord-w1-overlord-v1.md` | #3401; run 3867 | merged (3b55d40019, 2026-11-26 02:22:53Z) after plan reviews 3877, 3885 and 3889; the last review's corrections are folded into the plan by this ledger edit (call 1374) |
| W1 | Not started: the board's later parts, home B and C, chat, renewal readings G and H, the `overlord-v1` build | plans merged | planned; each waits as the Next-wave brief says |
| W1 | The Overlord clause (§11.4), clause 24 | #3354; plan `docs/superpowers/plans/2026-11-25-overlord-w1-coordinator-clause.md` | merged (1ec2db8ec3); D-9022 to D-9025 |
| W2 plans | The index, one plan per piece, the fold: #2917; #2921 to #2925, #2928, #2930 to #2933, #2935 to #2938; #2952. Plans in `docs/superpowers/plans/2026-11-16-overlord-w2/` | those PRs | merged |
| W2 | The pieces that need nothing from W1, built first: the vocabulary, row revisions, private names (A, B), the decision-model port and its arming (A, B), overlaps A, remaining work (A, B), done tests A, forecasts and health (A, B) | #2939; #2965; #2940, #2961; #2948, #2990; #2949; #2951, #3002; #2964; #2987, #3003 | merged |
| W2 | Route and follow up, the rest: the act catalogue, act rows, journal and reads, the request record and ids, the coordinator and operator doors, relay, follow-up, inbox band 3, label queue, the board's and home's W2 parts, W2 Settings, overlaps B, done tests B, `overlord-route-v1` | plans merged | planned; most wait on W1 pieces |
| D-8126 | A4 calls made for you, Overturn and Seen; A5 the decide-by-default clause 21; A6 the detectors that act; A7 the server owns its faults; A9 the rule after compaction | #3072, #3100, #3080, #3079, #3146 | merged (taken into this programme by the operator's direction of 2026-11-19). A10 is a measurement due about 30 days after A9's rollout mail; A8 and the cap counting are not this programme's |
| Capacity | Waiting workers sleep and hold no slot: the design and plan (D-8789 to D-8793); an own-run hold passes the run-done sleep; an idle worker sleeps after 30 minutes, in shadow; a run holds a dispatch slot only while its worker works; a refused coordinator is mailed when a slot frees; follow-up round 1; the in-place bind (W1-4b, D-6096) | #3091, #3092, #3101, #3103, #3117, #3133, #3134 | merged. W1-5 (D-6097) not built |
| Mid-turn mail | The design and plan; PR 0 (the rig check); PR 1 (delivery times on `MailSummary`); PR 2 (urgent mail's sender rule); PR 3 (the `mailhold` route field); PR 4 (the projection and its decider); PR 5 (the notice line and refusal, shadow); PR 6 (the subagent ack refusal, shadow); PR 2b and 4b (urgent mail at the ingress, the reclaim repoint) | #3054, #3059; #3063; #3065; #3073; #3064; #3087; #3067; #3083; #3147 | merged |
| Mail and redaction | An optional idempotency key on mail sends; Gitleaks-derived known-token rows and one PEM block rule; the PEM and escaped-break follow-up | #3056; #3052; #3060 | merged |
| Approvals through coordinators and the Overlord | The plan (the operator's direction of 2026-11-18); PR 0 (a child with a stale deny digest is routed); PR 1 (the census); PR 2 (the envelope list); PR 3 (the park, built and inert) and its 3v and 3c; prevention (reviewers and briefs remove only literal paths) | #3036; #3045; #3043; #3061; #3106, #3140, #3141; #3038 | merged |
| No chores for the operator (2026-11-22) | The test box's tool sync takes a home; the build capture runner's design and first PR; a new Claude Code release needs no operator; capture PR 3a | #3167; #3171, #3168; #3170; #3198 | merged |
| No chores for the operator (2026-11-22) | Capture PR 2: copy missing builds before retrying capture | #3276, which replaced #3239 | merged (e0e8989c05) |
| No chores for the operator (2026-11-22) | Capture PR 3b: the wiring | #3347; run 3657 | merged (09c8f5d502, 2026-11-25 10:07:06Z); it arms the capture runner once a release carrying it is on the test box. Its review carries are run 3774 |
| No chores for the operator (2026-11-22) | The capture wiring's review carries | #3378; run 3774 | merged (22a9f35fd2, 2026-11-25 13:45:57Z). Acceptance (a build recorded through the product) is not yet read |
| Test box and settings pieces | Managed node PR 3; every admin act has a time limit; a light parity check; the run cap derived from the fleet host; Settings › Integrations; a Do item can carry a note to the coordinator | #3233; #3225; #3241; #3224; #3230; #3228 | merged |
| Test fixes | Two merge-queue flakes; the docs bar's focus case; the digest page's one-post case; the collector's resume cases | #2820; #2953; #2968; #2981 | merged |
| Test fixes | The generation day's 200 seeds run as ten bounded ranges of twenty, every edge checked over their union | #3356; run 3697 | merged (f432478cab) |
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

### Since #3251 (2026-11-23 to 2026-11-24)

The bullets below correct some sentences of the subsection above. Where they differ, these are the rule now. The
subsection above is left as it was written.

- **The operator's items are answered or overtaken (2026-11-24).** The operator asked why this programme was waiting
  on them, and ruled that nothing here needs their hand. Item 605 (publish capture PR 2's replacement head) was
  answered that the programme handles it itself, and withdrawn; the work went to a new run instead (call 813, below).
  Item 607 (integrate main into home A's PR) was answered the same way and withdrawn: the Home worker made its own
  merge. Item 606
  (plain-words report files) was withdrawn, and the two held sandbox reviews filed their reports once, in plain words
  (call 816). The earlier "no second sync" instruction was about the test box's tool sync, not about merges of PRs.
  This coordinator misread it, and item 615's premise was that misreading.
- **A standing yes on item 615, and call 815 (2026-11-24).** The operator answered item 615 with a standing yes for
  this programme's W1 PRs: a worker may make a further ordinary merge of main when the coordinator has measured the
  conflict and named the base. Call 815 (big) put it to work the same day for Inbox, Home A and Authority B. The shape
  is a merge commit, never a rebase, a force-push or the PR page's update button. A PR still takes one push per round.
  The rule on "one licensed absorption" above is superseded; the Carried constraints say what stands.
- **The two-step merge shape (calls 884, 887, 891).** A PR that must wait for others builds step one at once: a local
  ordinary merge of main whose commit holds the resolution only, then the second-lander wiring as commits of their own,
  unpushed. Step two is a final base the coordinator names after the PRs ahead of it land: one more merge, the
  migration slot moved, one push, a wave-done, and a last review that reads everything. Call 884 gave this shape to
  Sequence A and call 887 to Authority B. Call 891 published Sequence A at a provisional slot 124. Capture took 124, so
  Sequence A moved to 125.
- **Inbox (#3220, merged 01ee0e850c).** Review 3506 held the merge: 0 critical, 2 important, 5 minor. Call 584 fixed an
  end-to-end replay test of the mail pass and the residual statements, and took two minors as Known limits. A narrow
  review, 3614, read fix round 2 and the merges: no code defect. Its two notes were answered by the standing yes and
  by two residuals added to the PR body (call 848, land). The review cap was lifted from 3 to 6 for the rounds after
  the never-run review 3497. A queue run dequeued the PR once, on a browser case in a file the PR does not touch; one
  re-enqueue merged it. Carry: the mail pass's body sits at its 150-line cap.
- **Home A (#3207, merged 6965b6d830).** Review 3368 (round 2) was incomplete, because a lens died at the weekly limit,
  and it left four advisories unruled. Review 3613 (round 3, complete): no critical or important finding, one finding
  that matters (F1) and seven minor. Call 859: land. F1 is that the Overlord place's wait for its capability has no
  test that fails if the wait is removed; the place cannot be reached before the capability ships. It is a known
  limit, and the case is owed by the next home PR, under ticket `home-a-review-carries`.
- **Sandbox surface (#3213, merged 70ebe6d876) and Sandbox B (#3205, merged f00f030a28).** Reviewer 3370's panel record
  was cut off, so it filed no report, and review 3598 replaced it (round 3): 0 critical or important, 15 minors
  refuted, 27 mutants run and 2 survived. Call 831 accepted #3213 as built, with the pins ticketed
  (`sandbox-surface-arm-pins`). Review 3366 of #3205 (round 3) found 0 critical or important and 11 minor. Call 817
  accepted it with one merge of main and its words fixed, the four door-pin gaps as Known limits
  (`sandbox-b-door-pins`), and one carried constraint: the server relies on the hook's order, so designation B's sweep
  retries and logs a settle that is stale or lost. Narrow reviews 3615 (call 852) and 3637 (call 889) followed.
- **Capture PR 2 (#3276, merged e0e8989c05; it replaced #3239).** A commit on top of the old range could not pass the
  history guard, so call 813 (big) opened a fresh run (3595) that merged the kept candidate into a clean branch.
  #3239 was closed with a pointer and run 3237 closed as superseded. The worker found a hardening gap in the build copy
  before any review, and call 822 (big) ordered a fix round first. Containment review 3623 found 13 things, none
  critical and none that lets the service user reach beyond itself; its one important finding was a hole in the
  coordinator's own ruling, and call 865 (big) ordered a second fix round. Review 3641 (round 2) found no break and
  killed 46 of 46 mutants. Call 901 (big): land, with the carries going to the wiring PR under ticket
  `capture-pr2-review-carries`. As the PR bodies say: the copy acts only inside a proved box root; the builds store is
  checked when a build is copied and is not proof against the capture's own user; the cure, the capture as a user of
  its own, is ticketed.
- **Sequence A (#3218, accepted, in the merge queue at cce47c34cf, migration slot 125).** Review 3400 (round 3) met
  both of its requirements and found 8 minor; call 876 built part one of fix round 3 locally. Review 3646 found the
  merge and the wiring sound. Call 914 (big): fix round 4 locally; the message movers and the census of their callers
  go to Sequence PR B (ticket `sequence-b-message-stamps`); that the merge commit and two commits after it are red
  trees, good for bisect only, is a known limit in the PR body. Narrow review 3675 (fix round 4 and the slot merge)
  found 0 critical or important and 2 minor. Call 958: land; the carries go to ticket `sequence-a-review-carries`.
- **Authority B (#3215, in fix round 3).** Review 3372 (round 1) found two critical and eight important findings. Review
  3526 (round 2) found one important finding: any parsing tuple from any host raised the witness maxima without bound.
  Call 629 (big) was revised the same day: one constant in the witness policy bounds the raise only, and the residual
  is a Known limit. Review 3679 (round 3, last) found no critical finding. Call 959 (big): F1, a witness counter above
  the ceiling that Confirm cannot clear, is accepted as the ceiling's cost, with its words made true, a case that pins
  the stuck state, and the cure ticketed (`authority-witness-above-ceiling`). F2 stands: the PR had raised a
  composition-root pin row that is never raised, because its own isolation case read that file as text. The case is
  re-keyed and the row goes back to 37. The other carries go to ticket `authority-b-review-carries`.
- **Serviceability B (#3210, fix round 2 built locally).** The PR sat from 2026-11-22 on a hold for refuters that
  review 3382 had not run. Call 870 (big) ended the hold, because findings that a reviewer measured are enough for a
  fix round. Fix round 2: a projected crossing at or before now reads as unmeasured, never as reached; an exhausted
  window beside an unknown one is unknown; the rest is tests and words. Two findings (F9, F12) are Known limits under
  ticket `serviceability-b-review-carries`. The last review round reads the fix round and the merge together. The PR
  goes after Authority B and takes the next migration slot.
- **Recall (#2919, merged a3fb5d1a2a).** The box's shared GitHub account queued it on 2026-11-24. Call 890 read that as
  an operator's act and dropped the hold on the replay baseline; the reading was wrong (see the draft rule), but the
  PR was already reviewed and accepted (review 3411), so the hold stays dropped. The queue removed it once for a checks
  timeout, and one re-enqueue at the reviewed head merged it. The line above that says the recall clause stays held on
  the baseline is overtaken. The Overlord clause is unblocked.
- **Every Overlord PR is a draft until the coordinator accepts it (call 923, 2026-11-24).** Something that uses the
  box's shared GitHub account queued ready, green PRs before any review, and queued them again within seconds of a
  removal: Overlord PRs #2919 and #3218 among them, and other programmes' PRs too. Calls 890 and the note on #3218
  read these as the operator's clicks; that reading was wrong. No shipped code on `main` enqueues, and no process was
  seen. The landing programme's coordinator answered that it does not enqueue them, and the Desktop polish
  programme's coordinator raised an operator item, so this programme raised none. At landing the coordinator marks the
  PR ready, runs the whole gate, then enqueues, with the enqueue as its own command.
- **The merge queue starved on 2026-11-24 (calls 951, 952).** `main` did not move for about three hours: 17 runs
  were queued, pull request runs waited over 80 minutes to start, and groups were removed for a checks timeout at 60
  minutes. Earlier the same day three queue runs had failed on the growth cap of `shared/api.ts`, which stands at its cap.
  Call 952: this coordinator cancelled four merge-group runs whose queue branches were proven absent from the remote,
  and nothing else; one more followed on the same proof. The landing programme raised the starvation as an operator
  item and withdrew it, because three PRs landed within the next hour. Watch item: a superseded queue group's run is
  not cancelled when the group is rebuilt. Call 951 is below.
- **Packets for another programme's held files.** A file held by another programme's claim takes a packet first, and
  the holder's yes is the answer. A copy to this coordinator is a status, not a question. The landing programme's
  coordinator answers packets for the files its run holds, such as the README, directly: the diff goes inline in the
  body against a named full `main` id, with its size and checksum. The worker that holds the files only relays what it is sent. Put that route in
  every brief that may touch the README. The gate's route counts and the README's lane count are moved by several
  Overlord PRs (Authority B, designation B, board B1, the capture wiring). Identical header lines merge silently and
  the census then fails in the queue, so each later lander re-derives them at its final merge. The landing
  programme's PR #2837 will add a field to the landing round-trip snapshot in the other-lanes pin test; a branch that
  rewrites that snapshot then merges to ours plus that field.
- **Gate-code files go to the history programme first.** Before a brief that edits one of the four gate-code files is
  dispatched, the history programme's coordinator is asked. Three quiz PRs (#3253, #3262, #3267) each edited one with
  no ask, after the one-edit waiver, and so did #3052 (this programme, eight lines). The history programme's
  coordinator found it on 2026-11-24, held nothing and recorded a residual in its own ledger. The rulings behind those
  edits were this programme's alone. A resumed history review is to read them, and any further edit goes to that
  coordinator before dispatch.
- **Lessons of the landing days.** A full commit id in a mail is copied from command output, never typed: a typed
  40-character id was wrong after its tenth character, and a second mail corrected it. A review brief is measured in
  bytes before dispatch and kept under 8,088 bytes from the first draft, because a draft needed four trims to fit
  the 8,192-byte cap. After proving MERGED, the coordinator mails the worker at once, since the server's merged notice
  reaches only the coordinator. A review report is copied to the coordinator's own store when its review run closes,
  because the reviewer's folder is reclaimed once the reviewed work run closes final. A review writes each lens's
  findings to a file as the lens finishes, since two reports were lost to a refused write. A private-name scan that
  crashes with no verdict is not a pass: scan alone, then push as its own command. Where a hook refused a note or a
  report for the words it named, the writer used the plain file tool and plain words, and a second refusal is a stop.
- **Watch items (unmeasured causes).** Timeouts at the 20-second limit under load: the installer's "kept record is
  written LAST" case (the same file dequeued #3092 on 2026-11-20) and its graph-exclude case (Capture PR 2's run, red
  twice, green on a third attempt). The generation-day simulation timed out at 600 seconds in one queue run (#3262),
  and a sheet-stack browser case failed one queue run (#3220); each passed on the one re-enqueue. The masking test's
  timing cases go red under load on `main` too. The growth cap of `shared/api.ts` is at its line: a PR that adds a line
  there replaces one. The test box's checkout cannot resolve the `ui` package from a PWA source file, and two real-tmux
  cases of the session hook test failed there even alone; both pass locally and in CI. A worktree without the agent
  package's dependencies fails the server test type check in agent sources. The box's REST quota for GitHub reached 0
  twice (reads then go through GraphQL).
- **The weekly quiz line, four PRs (2026-11-23 to 2026-11-24).** #3252 (merged 33cc21c00e): the wall-clock trigger and a
  starved trigger said in words (reviews 3513, 3519, 3521; accepted at the cap, call 619; ticket `quiz-doctor-run-age`).
  #3253 (merged d5a032c409): the pilot's three stale checks (reviews 3522, 3528, 3533; call 592 set the rulings and
  call 652 accepted it at the cap; ticket `quiz-repilot-kill-window`). #3262 (merged e29f704d47): the quiz reads limits by
  the fleet's one room rule and chooses its account each week, because week 48 stood waiting for room on a rule the
  fleet does not use (call 633, big; reviews 3545, 3549, 3553; call 714). #3267 (merged 99743009a9): stage B, whose
  re-pilot key is the Claude Code build, the quiz's own code and the staged skill, not the release tag (call 734, big;
  reviews 3563, 3565, 3567; call 758). After release v0.0.1420 reached the box the new timer loaded and fired for the
  first time (the one-time run at the reload, call 594). Week 48's first pilot failed, and its second, on a later
  build, passed the tools check and failed persistence, plugins and the skill. One pilot is left that week. Stage B is
  first measured when a release that carries #3267 is on the box; week 49 starts on 2026-11-30.
- **The calls of the evening of 2026-11-24.** Call 925 (big): the capture wiring (#3347) lands with its refusals
  tested and states one limit as a property: a pass speaks for the bytes the box held when the build ran, and the
  builds store is not proof against the capture's own user. It changes no capture frame; the cure is ticketed, and the
  Desktop polish programme is told before any such change. Call 938: Authority B holds its wave-done until #3286
  merges. Call 951 replaced it when the starved queue dropped #3286: the PR's run was also red on three causes (a test
  file lacking a reason word added on `main`, a pin count of 37 against 38, and a shell trap error in a pool
  characterization case read as load), so one fix commit, one push, and the wave-done at once with CI labelled
  pending, the landing still needing green checks on the tip that lands. Call 952: the cancellations
  above. Call 958: Sequence A lands. Call 959: Authority B's review rulings above. Call 962: renewal readings E and F
  are dispatched as runs 3683 and 3684 on `main` 66eb018733, as drafts, peers of run 3654 on the wiring file. PR E may
  add one store delegate and PR F may touch the watch file by one line. Their briefs carry the landing-packet route
  and the rule that a pin is never raised. Call 917 (2026-11-24) had dispatched designation B, board B1 and renewal
  readings B as runs 3652, 3653 and 3654; new dispatches were held on 2026-11-24 while CI was starved and released
  when the landing programme withdrew its item.
- **The W1 map of what is buildable (2026-11-24).** Building now: designation B (run 3652), board B1 (run 3653),
  renewal readings B, E and F (runs 3654, 3683, 3684) and the capture wiring (run 3657). Blocked: the Overlord's timers
  wait on designation B; readiness waits on designation B, serviceability B and Sequence A and B; home B waits on
  designation B, readiness and serviceability B; renewal readings D waits on serviceability B, G on home B, and H on
  readiness and D; Sequence B waits on Sequence A and its two tickets. Home C and chat A and B are blocked as well; their
  dependencies are in the W1 index. The Overlord clause has no plan file. Spec §11.4 gives its wording in
  full, and the operator's approval is needed only for a shortening of existing clauses; the contract's room was settled
  by #2845. So nothing waits on the operator: one run writes the short plan and builds the clause, its pin, its count
  word and its cap raise, and it lands before W2 opens.

### Since #3351 (2026-11-25, 02:30Z to 10:15Z)

The calls below are this coordinator's, from call 978 to call 1127. Big calls are marked; the operator may overturn any
of them. Where these bullets differ from the subsections above, these are the rule now.

- **What landed, in merge order.** Each landed through the merge queue at its reviewed head.

  | PR | Piece | Merge | Reviews | Accepted by |
  |---|---|---|---|---|
  | #3218 | Sequence A | 7e1f9752fe, 00:17:27Z | 3646, 3675 | call 958 |
  | #3352 | Renewal readings F | a4b94d0bc1, 03:16:33Z | (see the PR) | call 1004; re-enqueued once by call 1037 |
  | #3354 | The Overlord clause, clause 24 | 1ec2db8ec3, 03:16:33Z | 3723 | call 1042 |
  | #3356 | The generation day's time bound | f432478cab, 03:59:19Z | 3720 | call 1045 |
  | #3350 | Renewal readings E | 676d955d23, 05:31:43Z | 3710, 3736 | call 1070 |
  | #3348 | Board B1, the history door | 2f140376dd, 07:14:59Z | 3730 (closed failed), 3749 | call 1093 |
  | #3343 | Renewal readings B | c4c3157866, 08:22:49Z | 3696, 3718, 3742, 3756 | call 1102 |
  | #3367 | Serviceability B (supersedes #3210) | 58acf1d450, 09:07:40Z | 3330 and 3382 on #3210; 3761 | call 1111 |
  | #3347 | Capture PR 3b, the wiring | 09c8f5d502, 10:07:06Z | 3687, 3733 and 3755 (both closed failed), 3765 | call 1116 (big) |
  | #3371 | The sandbox's carried pins | 657477678e, 10:16:46Z | 3766 | call 1114; re-enqueued once by call 1121 |

  *Table: the Overlord PRs that landed on 2026-11-25. #3371 merged a minute after this fold's snapshot; its run's close
  follows the worker's MERGED mail.*
- **The capture wiring (#3347).** Call 996 (big) sent it to fix round 1 after review 3687: the build must start with no
  shell between tmux and it, the pane's command built in one place, the fault list, the start-up prune, and the build
  copy's termination case, measured and fixed in this PR. Call 1003: a pane can never start the fixed start program alone.
  Call 1007 gave its run the standing answer to a hook refusal that matched words only: redo it once in plain words and
  report it. Call 1047: in the pane, `SHELL` names one fixed system shell, and a missing one is refused before any tmux
  call. Reviewer 3733 stalled on background lenses and was closed failed; so was 3755. Call 1112 lifted the cap from 3 to
  6 and opened a third attempt, review 3765, whose lenses ran in the foreground one at a time. It found no containment
  finding and ten minor ones, none holding. Call 1116 (big): land at the reviewed tip, which arms the capture runner. The
  PR touches one line of a shared file that the PWA reaches only through an import it never calls, so no browser run was
  owed before the queue. The Desktop polish programme's coordinator was mailed the merge id, as owed since call 925.
  Call 1127 dispatched the carries as run 3774 (ticket `capture-3b-review-carries`).
- **Authority B (#3215, then #3370).** Calls 993, 1002 and 1027 set its last local round: restore an exact pin on the
  lane table's tail, the recovery words, and one push after the local merge. Narrow review 3732 (round 6 of 6) found no
  defect; call 1059: land as it stood. Call 1060 held its enqueue while the Desktop polish programme's #3289 was ahead
  in the queue and conflicted in the app shell: the worker prepared a merge that keeps the witness exchange out of a
  Docs tab, with a case, to push only if #3289 merged first. #3289 left the queue, so #3215 was enqueued as it stood.
  The queue then ejected it for its own fault: a browser test lists the exact POST routes, and the PR added one. Call
  1069 sent it to a fix round with the `full-ci` label. Its worker's turn then ended on a server error and every later
  delivery failed, so call 1079 opened a fresh child, run 3744, which merged the old tip into its own branch, cured the
  browser test, added the Docs tab gate, and opened #3370. #3215 was closed with a pointer to #3370. Review 3764 found
  nothing holding; call 1115: accepted in substance, with one last round (one merge of main, the note's lines, one case
  for the sign-in term of the shell effect), a full CI run on the exact tip, then one narrow review (round 2 of 3) and
  landing.
- **Serviceability B (#3210, then #3367).** Call 1075 flipped the order: Serviceability lands before Authority B. Its
  worker ran on the same account as Authority B's and died the same way. Call 1082 opened a fresh child, run 3746, which
  took the dead worker's unpushed local commits, merged main and opened #3367. #3210 was closed with a pointer. A
  further routine call let the new worker edit the gate's two files on the coordinator's ruling while the dead worker's
  claims stood. #3367's first PR run was red for a real reason (a test built a watcher without quieting it), fixed with
  one more merge. Call 1108: a browser part cancelled at its job deadline with no failing file counts as measured, as all
  three parts were green on the previous tip and the PR reaches the front end only by a type import. Review 3761 found
  nothing holding; call 1111: land.
- **Designation B (#3346).** Call 1021 (big): Restart refuses `overlord-attempt-pending` while an attempt is pending; a
  real-watcher case and a production go-live adapter case; words on what Live arms; the rest of review 3695 carried to
  `designation-b-review-carries`. Call 1077 (big, it changes 1021) after review 3740: Restart refuses only inside the
  attempt's deadline; past it Restart fails the attempt through the existing writer and goes on, with no new mechanism;
  a rebind's go-live stamps the old designation retired before the new one live; the newest live designation line is
  kept by retention if that is small, else ticket `sequence-kept-line-after-rebind`. Call 1095 (big) after review 3754:
  Restart first drains every owed stop and refuses, starting nothing, when a stop stays owed, as Rebind does; one merge
  of main in the same round. Review 3768 found nothing holding (five minor); a routine call the same turn accepted it in
  substance, with a last small round committed locally and no push until the coordinator names a base after #3371.
- **Renewal readings B (#3343).** A big call after review 3718 set fix round 2, the last: a case through the default
  arm, and a believed absence confirmed through measured reads, unmeasured on any unreadable answer. Call 1080 after
  review 3742 accepted the code and asked for one more merge of main once E had landed. Review 3756 (round 4, the cap
  lifted) found nothing critical or important; call 1102: land.
- **Renewal readings E (#3350) and F (#3352).** Call 1004 accepted F. Call 1020 (big) sent E to fix round 1: call the
  store's reads through the store, with a real-store wiring case, and have both unmarked operator paths (the terminal
  drawer's input and the submit route) write the operator mark through the prompt route's one writer, with its keying.
  E was not to land before the mark writes were in it. Call 1054: one more ordinary merge after F landed, keeping both
  sides. Review 3736 found nothing holding; call 1070: land, with the four console routes that still write no mark as
  their own small PR (ticket `overlord-quiet-four-unmarked-routes`, call 1099, run 3757, #3373).
- **The Overlord clause (#3354).** Call 997 (big): the clause's room comes from the compaction note before the contract,
  not from shortening clauses (D-9022). Call 1025: the skill's rollout revision word stays, and the bump is owed at the
  first build that can send a coordinator a relay (D-9024). Review 3723 found nothing; call 1042: land.
- **The generation day's bound (#3356).** Call 1036: one PR, with the judge's size word accepted. Review 3720 found the
  seeds identical to main's in both modes and seven mutations red; call 1045: land with the bound as built. It removes
  the flake that ejected PRs from the queue.
- **Board B1 (#3348).** Calls 1017 and 1029: stop the 332-file local pass, run the files that matter, push, and read the
  fast run's selection. Review 3730's close was refused as stale, because the worker had committed a prepared merge on
  this coordinator's word while the review read: this coordinator's slip. Call 1063 (big) closed it failed and used its
  report as evidence for fix round 1; its F3, the history row in the door process, is deferred to ticket
  `history-door-process-row`, which this coordinator settles in the door-process plan before the board piece. Review 3749
  found nothing critical or important; call 1093: land.
- **The sandbox's carried pins (#3371).** Call 1100 dispatched it (run 3758): review 3366's door pins, and a failed
  re-read answers `unread` while `stale` stays for changed evidence, with one log line. Call 1107: the worker adds the one
  floor key line itself, since the file's claim was held by a dead session. Review 3766 found one advisory; call 1114:
  land. The queue removed it once for a timeout in another programme's test file; call 1121: one re-enqueue at the same
  head, and a second loss on that case goes to that file's owner.
- **The two dead workers.** Both of this programme's workers on one account failed every turn from about 04:45Z (a server
  error, then a model not found), and this coordinator's own session was moved off that account. A coordinator cannot
  abandon a working run, and a spent child cannot take a new run, so the cure was a fresh child each (calls 1079 and
  1082). Runs 3299 and 3296 stay open until the operator ends them (items 663 and 662); item 661 reports the failing
  account. While a dead session's process reads as running, its claims renew themselves.
- **New runs on main 09c8f5d502 (calls 1126, 1127).** Renewal readings D (run 3773, ticket `w1-renewal-readings-d`): plan
  Task 7; its holds input stays `not-wired` until PR H, it touches the watch file only by packet to designation B, and it
  says what its merge arms. The
  capture carries (run 3774, ticket `capture-3b-review-carries`): the copy program's one assignment, gate G1 made one
  object and red both ways with its poll pinned, the real-tmux case, the builder's refusal, the words, and the task
  notes corrected on its own branch. Its review needs a containment lens.
- **The capture lane's second recipe (call 1131, big).** The Desktop polish programme adds a delivery recipe to the
  capture runner (its own run) and asked what starts a delivery capture. Ruling: no new door. The capture lane starts one
  delivery capture for a build after that build passes its trust capture, and the result rides the capture state's
  existing read; no route, client verb or console surface starts a capture, since the box token is held by every
  session. Conditions: the server sends a delivery job only to a box that reports knowing the recipe, and the reader
  refuses an answer that does not echo it; the result is information only and decides nothing; a fault of the box is no
  verdict, retried by the lane's back-off, and a delivery capture sorts after trust; nothing imports the driver file, no
  route reaches it, and it refuses a socket outside the capture's scratch root; timings come from the one timing
  object; the PR counts as a front-end PR at landing. Packets for the shared capture contract come to this coordinator
  first. This coordinator mails that programme when run 3774's PR merges.
- **The queue on 2026-11-25.** `shared/api.ts` stands exactly at its growth cap. #3344 (not this programme's) added one
  line there, so both growth suites failed in every queue group that held it, and something re-enqueued it after each
  removal. The landing programme's coordinator turned it into a draft. A PR of this programme that adds a code line to
  that file removes one, and the coordinator checks that file's diff in every wave-done.
- **Mechanics.** The review cap is lifted with `runs review-rounds`, decided before the extra round opens. `runs advance`
  to `working` carries the verified fingerprint. An item for the operator carries a kind, a need-by, a title, what, how
  and why.
- **Follow-up tickets added since the last fold.** Each rides the PR or run it names.
  - `renewal-readings-b-review-carries`: review 3718 F7 and review 3756 F1 (no case runs E's door readings and
    not-local in one call).
  - `renewal-readings-e-review-carries`: review 3736's minors.
  - `renewal-readings-f-review-carries`: the minors of F's review.
  - `sandbox-pins-review-carries`: review 3766's advisory (the doc of `unread` names two of its three causes).
  - `authority-b2-review-carries`: review 3764 F3 and F4, and a browser case for the witness exchange.
  - `capture-3b-review-carries`: review 3765's findings; now run 3774.
  - `board-b1-review-carries`: review 3730's carries, and review 3749 F1, F2 and F4 (the client grammar's differences and
    the extras type).
  - `history-door-process-row`: review 3730 F3, readers against fenced rows (above).
  - `sequence-kept-line-after-rebind`: the newest live designation line kept by retention (call 1077).
  - `designation-b-review-carries`: review 3695's A2, A3, A6 and A7.
  - `serviceability-b-review-carries`: review 3382's F9 and F12 (unchanged).
  - `generation-day-sim-review-carries`: review 3720's minors.
  - `overlord-quiet-four-unmarked-routes`: run 3757, #3373.
  - `w1-renewal-readings-d`: run 3773.
  - `overlord-quiet-unmarked-operator-paths` stays open in the plan, though E's fix round did the work: the ticket-done
    door refused it because E's PR had already closed E's own ticket. It is to be closed by hand.
- **Watch items.** The fleet test slice's memory cap kills whole-file and whole-project runs under load (seen by four
  workers); CI covers the same checks, and an item is raised only if it blocks a landing. Load flakes seen in queue runs:
  the single-definition vocabularies case at its 20-second bound, one installer case, the secret-mask slow bench at 20
  seconds, one harness-integrity case at 20 seconds, and a review-routes case of another programme. Three files are red on
  a clean `main` in a worker checkout but green in the queue (the inbox client's closed-stdout case, a containment
  loopback case, and the mutation floors' two PWA mood sets): the local environment.

#### The merged task notes, folded

Each note is under `docs/superpowers/programs/overlord/`. Departures by slug; none took a D-number except the clause's.

- **Renewal readings B (`w1-renewal-readings-b.md`).** Departures: `not-local-unwired-keeps-w1`,
  `not-local-carrier-unmeasured-has-its-own-reason`, `not-local-start-reasons-keep-the-detail`,
  `not-local-resolver-throw-is-the-field-catch`, `not-local-fork-takes-the-turn-guard`,
  `not-local-stop-at-the-start-is-after-it`, `isolation-reader-is-server-deps`, `not-local-source-pin-on-parsed-file`,
  `start-by-id-tests-in-own-file`, `not-local-absence-confirmed-by-a-measured-search` (it replaced fix round 1's fresh
  walk), `not-local-complete-is-not-a-measured-absence` (a plan correction: the resolver's `complete` is not a measured
  absence), `not-local-first-turn-running-is-unmeasured`, `not-local-ask-refuses-a-moved-registry-row` and
  `registry-lookup-named-in-the-run-session-census`. Armed on merge: the coordinators' and the Overlord's due records gain
  the `not-local` reading; in shadow it is recorded only.
- **Renewal readings E (`w1-renewal-readings-e.md`).** Departures: `door-readings-floor-is-the-start-rows-receipt`,
  `one-delegate-for-the-reader-events`, `drift-sidecar-must-postdate-the-start`, `drift-input-carries-the-usage-word`,
  `door-reads-optional-on-the-wiring`, `door-readings-tests-in-own-files`, `class-changed-k5-imports-nothing`,
  `sidecar-read-derives-read-failure`, `switch-target-class-unused-by-drift`, and from fix round 1
  `the-keying-adds-overlord-for-the-designated-session`, `drawer-marks-once-per-two-seconds`,
  `unread-designation-writes-no-mark` and `overlord-prompts-still-mark-through-the-nudge`. Armed on merge: `model-drift`
  is a hard row of the Overlord, so on a live lane a measured `true` drains it at its next turn end; `readersRunning`
  reaches the soft permit. Corrections (review 3736): the note's "36 of 36" is the count before fix round 1, and the door
  suite has 37 cases at the tip; "input through any console path keeps the break shut" is too broad, since four console
  routes wrote no mark until #3373; the round's scope beyond the plan's "others 0" (the mark's keying, the prompt
  hand-offs and three lines of the server's route file) has no slug of its own.
- **Renewal readings F (`w1-renewal-readings-f.md`).** Departures: `overlord-quiet-read-in-the-lane`,
  `turns-store-through-watcher-deps`, `turns-why-passed-through`, `turns-tests-in-own-file` and
  `overlord-quiet-without-store-is-no-activity` (checked, no change). Armed on merge: the Overlord's `turns` and its
  operator quiet are measured in the lane, in shadow until `continuity` is live.
- **The Overlord clause (`w1-coordinator-clause.md`).** Departures: `coord-clause-room-from-compaction-note` (D-9022),
  `coord-clause-index-shortening-not-needed` (D-9023), `coord-clause-condition-held-by-the-build`,
  `coord-clause-revision-word-unchanged` (D-9024), `held-files-by-packet` and `coord-clause-plan-dated-path` (D-9025).
  Armed on merge: clause 24 is in the contract, which ends 10 bytes inside its budget. What it asks waits on
  `overlord-v1`, held by the build, except its last sentence (waves left as a range), which binds from the release and is
  harmless. Corrections (review 3723): the plan and the note say the named doors answer the capability refusal, while
  today the client answers an unknown verb; D-9024's phrase is to be tightened; the index needs a row for the plan's
  dated path.
- **The generation day's bound (`generation-day-sim-bound.md`).** No departure and no D-number; no product code changed.
  Armed on merge: nothing.
- **Board B1 (`w1-board-history-b1.md`).** Departures: `history-door-in-its-own-routes-file`,
  `history-door-bound-allows-the-pair`, `history-request-read-after-the-gate`, `history-row-fenced`,
  `read-runner-answer-kind`, `history-line-outcome-words`, `history-mask-pinned-in-the-door-test` and
  `history-client-grammar-in-jq`. Armed on merge: the history door answers a caller that is the Overlord and passes the
  gate; no migration, ccd verb, exec grant or history gate-code file. Owed by this coordinator: the board and history
  plan's lines that still read the history row as unfenced, and the door-process plan against the read tool's rule
  (ticket `history-door-process-row`).
- **Serviceability B (`w1-serviceability.md`).** Departures: `a-stored-sample-rolls-at-read`,
  `the-first-reset-ends-the-proof`, `a-projection-is-never-past` and `an-unknown-window-withholds-regain` (each a plan
  correction), `ts-mutants-ride-mutant-sets`, `an-unmeasured-window-voids-a-future-crossing`, `one-window-proves-past`,
  `load-lines-read-no-share`, `runway-read-lists-enabled-anthropic-accounts-by-pool`, `sampler-store-is-its-own-port`,
  `sample-selection-stays-in-the-lane`, `departures-in-the-programme-note` and `the-runway-read-is-the-index-fold`.
  Armed on merge: the sampler writes rows every five minutes; only the runway read reads them; the 95% row reads `lifted`
  until an Overlord exists. Correction: the note asks for the migration to be re-checked at the final base; it landed at
  slot 126, as the note says. The note names the dead run 3296; the PR was carried by run 3746.
- **Capture PR 3b (`capture-runner-pr3b.md`).** Departures: `refuse-links-not-rehash`, `store-checks-before-the-stream`,
  `unknown-life-is-no-verdict`, `closed-admissions-end-the-wait`, `capture-tmux-outside-the-socket-lookup`,
  `recorder-named-not-imported`, `desk-composed-in-two`, `start-without-a-shell`, `capture-shell-fixed` and
  `link-at-the-name-healed`, with three points left (the drive's failure line, the private server's session name, the
  lane's header). Armed on merge: the capture runner, once a release carrying it is on the test box; a pass makes a build
  trusted, and a fault of the box is never a failed verdict. Corrections (review 3765): the passages that credit the
  real-tmux case with the login-refusing shell no longer hold, since the capture server's default shell is now set, so
  that case no longer separates the no-shell cure; `capture-shell-fixed` fixes the pane's `SHELL` value, which tmux always
  sets, and the pane also carries names the spec's §2.3 did not list (now folded into the spec); the run id the note gives
  for the real-tmux cases belongs to a later head; a blank line splits the last mutant table. Run 3774 corrects the notes
  on its branch.
- **The sandbox's carried pins (`w1-sandbox-pins.md`).** Departures: `f3-door-held-by-the-settle-drain`,
  `f5-unread-line-covers-the-first-read-too`, `n2-two-cases` and `floor-key-on-ruling`. Armed on merge: a settle whose
  re-read fails answers `unread` and writes one log line; the word reaches no frame, row or console.
- **Owed to a note not yet merged.** Authority B's note recorded the first merge of its round, not 61b98f1e5b, the merge
  review 3732 read (393 gate tests, 80 flag-aware rows, census 306/303/191/112; review 3732 F1). Run 3744's last round
  adds lines for its own merges and the Docs tab gate (review 3764 F1, call 1115). At #3370's landing, check the note and
  correct here what it still misses.

#### The W1 map of what is buildable (2026-11-25 10:15Z)

Merged since the last map: Sequence A, renewal readings B, E and F, board B1, serviceability B, the capture wiring, the
Overlord clause and the sandbox's pins. Building: designation B (run 3652), Authority B (run 3744), the four console
routes (run 3757), renewal readings D (run 3773) and the capture carries (run 3774). Waiting: the Overlord's timers wait
on designation B; Sequence B (tickets `sequence-b-message-stamps`, `sequence-a-review-carries`) waits on Authority B;
readiness waits on designation B and Sequence B; home B waits on designation B and readiness, and home C and chat follow
as the W1 index says; renewal readings G waits on home B and H on readiness and D; the board's later parts follow this
coordinator's settling of `history-door-process-row`. The quiz tickets (`quiz-repilot-kill-window`,
`quiz-doctor-run-age`) reach a history gate-code file, so the history programme's coordinator is asked before any brief.

### Since #3376 (2026-11-25, 10:25Z to 22:45Z)

The calls below are this coordinator's, from call 1134 to call 1319. All are routine; the one big call of the day, 1131,
is in the subsection above. Where these bullets differ from the subsections above, these are the rule now.

- **What landed, in merge order.** Each landed through the merge queue at its reviewed head, on its first pass.

  | PR | Piece | Merge | Reviews | Accepted by |
  |---|---|---|---|---|
  | #3376 | This ledger, to 10:25Z | bd4e28b691, 11:12:36Z | none (documents) | the coordinator |
  | #3373 | Four more console routes write the operator mark | 13776b93d3, 11:31:19Z | 3772 | call 1141 |
  | #3346 | Designation B | 80b994c831, 12:03:50Z | five rounds, the last 3782 | call 1153 |
  | #3378 | The capture wiring's carries | 22a9f35fd2, 13:45:57Z | 3789 | call 1193 |
  | #3370 | Authority B | 911372c399, 14:27:53Z | 3764, 3787, 3801 | call 1201 |
  | #3377 | Renewal readings D | bc65307b1a, 15:27:35Z | 3797, 3817 | call 1225 |
  | #3395 | Sequence B1: every W1 change is stamped | 2f59263e25, 21:50:09Z | 3852, 3857 | call 1302 |
  | #3388 | The Overlord's timers | 4fa87d73f8, 22:18:23Z | 3841, 3860 | call 1307 |

  *Table: the Overlord PRs that landed between 10:25Z and 22:45Z on 2026-11-25.*
- **The four console routes (#3373).** Review 3772 found nothing holding and seven minor points. Call 1141: land at the
  reviewed tip. A refusal that arrives after keys have landed writes no mark; that stands as built, as a known limit.
  The other six ride ticket `quiet-routes-review-carries`.
- **Designation B (#3346).** The coordinator named its base (main 25ed1ee2dd); the one merge differed from the
  mechanical tree only in the gate's two files and the continuity routes file. Review 3782 (round 5) found nothing
  holding. Call 1153: land. Rebind does not read owed stops while Restart does; the asymmetry is accepted as recorded,
  with its reason and a case carried in `designation-b-review-carries`. The branch changes a string in a shared file the
  console renders, so the coordinator ran the full CI workflow on the exact tip before marking it ready.
- **The capture carries (#3378).** Call 1134 refused the worker's request to run real-tmux cases outside its temp root:
  pure helpers with unit cases on the measured strings instead, and CI runs the real cases. Review 3789 found nothing
  holding and seven word points. Call 1193: land; the words ride ticket `capture-carries-review-words`.
- **Authority B (#3370).** Review 3787 (round 2) found nothing holding. Call 1168 took its two test points and the
  wording into the merge round that #3346's landing forced: one merge of main 0a07d29f54, differing from the mechanical
  tree in exactly four files (the gate's two, the box-token census, the Overlord doors census), counts re-derived to 310
  scanned, 307 HTTP, 194 gated, 113 exempt. Review 3801 (round 3 of 3) also read a throwaway merge with the programme
  lifecycle change that had landed meanwhile, and found two note gaps. Call 1201: land; ticket
  `authority-b-round3-carries`. The Desktop polish programme's coordinator was mailed before the enqueue and on MERGED.
- **Renewal readings D (#3377).** Review 3797 found five guards with no red case and two product points. Call 1187, fix
  round 1: a case and a mutant for each guard; the Overlord's own account is left out of the outside-the-set rule; the
  designation is read before the pool answer and the account facts, so nothing is read while nobody is designated. The
  second limits read is accepted, with its ordering reason in the note. Review 3817 found four wording points. Call
  1225: land; ticket `readings-d-review-carries`.
- **Sequence PR B, split in two (call 1216).** The plan's PR B is the invariant monitor; three tickets had added the
  unstamped message movers, their callers' census, the journal's receipt duty, Sequence A's carried cases and the kept
  line after a rebind. One PR would have passed 1,500 lines across two concerns. B1 (run 3820) completes what is
  stamped; B2 (run 3821) builds the monitor; seams by packet; B1 lands first.
  - **B1 (#3395).** Call 1218: no message mover has a coordination transaction that commits with its move, since the
    private store is another file, so each message line is stamped in its own transaction right after the move commits,
    in the same synchronous segment, only when the state word changed. A failed stamp changes no answer and logs once; a
    line lost to a stop between the two commits is a stated gap that a reader takes as unmeasured. Call 1220: every
    latch-raise line carries the server's actor kind, because the kind says who decided; the row keeps its raiser. This
    departs from the sequence plan's question 6 for that cause. Review 3852 found no behaviour defect. Call 1293, fix
    round 1: the stamp census counts calls per symbol; the rung door and the latch clear door answer a typed refusal when
    the ladder line cannot be written; two cases through the real bindings. Review 3857 found nothing holding. Call
    1302: land; a second floors key accepted; ticket `sequence-b1-review-carries`.
  - **B2 (#3394), not landed.** Call 1219: I7 compares the two sides that Confirm the restore reads, through one
    exported read of the rows side; I18 and the message halves of I8 and I13 are deferred, their rows reading
    not-applicable with a reason that names a ticket (`invariant-i18-seal-predicate`, `invariant-message-predicates`).
    This departs from the sequence plan's questions 11 and 17. Call 1235: six floors keys, and the monitor is built in
    the composition root and handed to the watcher as one optional dependency. Call 1240: push as a draft with I5
    unmeasured, review that tip, and wire the kept line's read at one later merge once B1 and the timers are on main.
    Review 3843 found no defect on today's code and fifteen findings. Call 1286, fix round 1: a case that reaches the
    production arming binding and five smaller points; three predicates stay deferred by ruling; I7 reads "differs" when
    the term or the model class differs from the journal's, and the spec's row now says so; I5 takes B1's one baseline
    read. Its base was named at 22:25Z (main 4fa87d73f8): one merge, migration 129, both floors sets, I5 wired with its
    red case, a full CI run, then one narrow review.
- **The Overlord's timers (#3388, run 3796).** Call 1170 dispatched it and ruled the plan's questions 1, 4 and 8 as
  recommended. Call 1249: the PR's head stayed stale after a GitHub outage while the branch had moved, so the draft was
  closed and reopened once. Review 3841 found one important point: a held timer line claimed the bound session for the
  whole mail sweep, so an operator message to the Overlord could be turned away while the card was unread. Call 1275,
  fix round 1: the session is claimed only after the hold; three cases through the real bindings and the episode-line
  case; a fired row with no fire time answers unmeasured. Review 3860 found nothing holding. Call 1307: land. The note
  says its older-build measurement predates the last merge of main; no further reading was asked. Ticket
  `timers-review-carries`.
- **The capture lane's second recipe (another programme's run, this coordinator's packets).** Call 1131 set the
  design. Since then: call 1135 accepted the shared capture contract with four conditions. Call 1145 accepted the lane
  design with four changes, of which two were replaced by call 1148 after the worker's measurements: no recipe list on
  the box's status answer (the box's exact reader of the submission is the capability, and the reply echoes the recipe),
  and the recipe runs in even parts, the count derived as the smallest whose largest part fits every pairing inside the
  agent's deadline. Call 1159 kept the part count in the shared result file, held equal to the agent's derivation by a
  case. Call 1208 accepted the agent packet with one finding (the worst case omitted the driver's kill grace) and four
  conditions. Call 1253 accepted the lane packet with one change: a queued build that is not due does not hold delivery
  back. Call 1311 accepted its CI fix packet with one condition: the compiler pin compares the versions the two
  lockfiles resolve, not the declared ranges. The recipe uses a stand-in model and no account usage. Its landing is its
  own coordinator's.
- **Agreements with peers.** The Native Docs reader programme's coordinator asked that no PR touching the session
  gate's two files enter the queue until its #3369 was queued or merged; agreed, and finished when #3369 merged
  (3b6695cc8f). The Desktop polish programme's coordinator is mailed before the enqueue and on MERGED for every
  front-end PR of this programme.
- **The dead runs.** The operator ended runs 3296 and 3299 (items 662 and 663).
- **The operator's steer: the last task is a rebrand.** On 2026-11-25 the operator asked that the programme end by
  renaming and rebranding the product as Overlord: the application, the repository and the rest, with the logo. It is
  recorded as ticket `rebrand-to-overlord`. Its design is open with the operator. It runs last, on a spec and a plan of
  its own, and the rename of the repository, a domain or a registry name is confirmed with the operator before the act.
- **Two dispatches at 22:27Z.**
  - **Readiness (run 3866, call 1315).** Every "Needs first" of its plan is on main except two things on B2's branch
    that its last task uses. So it builds in two stages: now, everything that touches no file B2's worker holds; after
    B2 lands and one merge of main, the held files, the wiring and what the operator is told. Call 1319 ruled two
    differences between the plan and main. A turn fails "on its account" for every token the stop-failure
    classification puts in its account class (seven today), read through that one classifier, where the spec named
    three: one owner per fact, and more tokens can only lower the word. A retired outcome is a fourth class of the
    restart map, not a restart and not counted. The plan's edit of the designation plan's Restart section is not in its
    PR; it is this coordinator's.
  - **The `overlord-v1` plan (run 3867, call 1316).** A documents-only run writes the plan the W1 index lists as not
    yet written, with an inventory of every behaviour the word holds back, an entry checklist and what the merge arms.

#### The merged task notes, folded

- **The four console routes (`w1-quiet-four-routes.md`).** Departures: `question-door-marks-on-the-cores-200`,
  `picker-marks-when-the-reply-is-not-sent`, `picker-marks-a-pick-for-the-next-spawn`,
  `mark-throttle-admits-an-earlier-reading` and `marks-on-every-question-form`. Correction (review 3772 F7): four note
  lines are stale, carried in `quiet-routes-review-carries`.
- **Designation B (`w1-designation-b.md`).** Twenty-four departures by slug, in the note's own section; the ones a
  later piece leans on are `rebind-ends-the-old-generation-retired`, `restart-refuses-while-an-attempt-is-pending`,
  `restart-starts-nothing-while-a-stop-is-owed`, `rebind-stamps-its-designation-lines` and
  `retention-keeps-the-newest-live-designation-line` (superseded by B1's `kept-line-is-the-standing-binding`).
  Corrections. Review 3768: Restart's row writes are ending an overdue attempt and clearing a stop through the drain,
  not the first alone; a stop that keeps failing keeps Restart refused until its cause is fixed, so "a retry heals" is
  too strong. Review 3782: the note's three suite counts are from before its last merge (68, 15 and 396 after it); its
  floors sentence names one of main's three keys; "Rebind still opens" overstates, since an unforced Rebind still
  refuses a bound body that reads hibernated; the Restart decider has one caller today, the Restart door, and
  readiness is the second when it lands.
- **Authority B (`w1-authority-journal-b.md`).** Thirty departures by slug, in the note's own section. Corrections
  (review 3801): the note does not name its last merge, of main after #3346, nor the counts at landing (310 scanned, 307
  HTTP, 194 gated, 113 exempt); "46 others" is 47. Review 3787's wording points were taken in the last round. No case
  drives the real guard through the witness exchange and then the Rebind route (ticket `authority-b-round3-carries`).
- **The capture carries (`capture-runner-carries.md`).** Departures: `plain-path-set`, `desk-timings-parameter`,
  `late-limit-both-sides` and `pane-start-helpers`. Corrections (review 3789): "at every instant" does not hold in one
  signal window during the deliberate removal, which gives no new reach; the "empty directory" can hold the streamed
  build; the log strings still say "replaced" where the note says the line reports the check.
- **Renewal readings D (`w1-renewal-readings-d.md`).** Departures: `account-load-split-into-load-and-move`,
  `class-unservable-takes-the-lane-facts`, `account-readings-candidates-built-in-l1`,
  `rebind-reads-the-account-rows-false`, `designation-checked-before-the-pool-answer`,
  `account-reads-from-the-wiring-not-watch`, `pool-answer-composer-shared-with-the-body`,
  `watcher-port-gains-account-pool-edges`, `outside-set-leaves-its-own-account-out`,
  `account-reads-wait-for-the-designation` and `load-move-guards-the-unmeasured-other`. Armed on merge: the reads run
  on each pass of the generations lane, in shadow too, for a generation the designation binds; the renewal acts run only
  with the `continuity` row Live. Corrections (review 3817): "every tick" is every pass of the generations lane, about
  thirty seconds; the limits the second read sees may be the previous tick's, and none on the first tick; a simulation
  title says pending with no pending fixture.
- **Sequence B1 (`w1-sequence-b1.md`).** Departures: `message-lines-stamp-after-the-move`,
  `latch-lines-are-the-servers`, `recorded-creation-stamps-no-line`, `ladder-line-kind-from-the-writers-actor`,
  `kept-line-is-the-standing-binding`, `receipt-lifted-to-the-journal`, `ladder-latch-states-in-the-sequence-file`,
  `sequence-kinds-are-stamp-words` and `ladder-fixtures-carry-the-sequence-table`. Armed on merge: every rung or latch
  change, every Confirm that writes a ladder row and every operator-message move that changes its state word writes a
  line; retention keeps one designation line, the standing binding's; nothing reads the new lines until the monitor
  lands, in shadow. Corrections (review 3857): "only the hook writes a `picked-up` line" holds in W1 only, while the
  boot pass's citing adapter is a stub; Confirm's narrowed latch cap is a latch change that writes no line, so "every
  latch change writes a line" overstates; the floors file was red across two commits of the branch, not one. Carried
  in `sequence-b1-review-carries`: a different error at a ladder door still answers 500, with no case; one boot warning
  still carries a doubled prefix; the designation doors answer a bare 500 for a refused line.
- **The Overlord's timers (`w1-overlord-timers.md`).** Departures: `timer-doors-read-the-stores-designation`,
  `timer-doors-count-through-the-store`, `watcher-reads-the-existing-deps`, `timer-hold-notes-no-gate-word`,
  `exempt-reasons-unchanged`, `card-timers-unmeasured-under-an-unmeasured-designation`,
  `episode-logs-through-the-other-lanes-designation-read`, `overlords-day-is-a-named-case`,
  `task-notes-in-the-programme-note`, `refusal-counts-without-rowid` and `restore-generation-is-required-on-insert`.
  Armed on merge, on every box: migration 128; the three timer doors run the gate, and with nobody designated every
  caller is served as before; each set stamps the restore generation; refusals are counted; the mail door refuses the
  role word as a recipient. Inert until a session is designated: the role's path at the doors, every role timer and its
  mail, the `timer` fixed line and its card hold. Corrections (review 3860): "a row that types nothing claims nothing" holds for the two holds the
  comment names, not for a parked or refused send after the claim; the older-build measurement names a release that is
  no longer the newest and predates the last merge of main; the fix round added three cases that kill six mutants, not
  four cases. The console hides its "could not be read" sentence in one case (review 3841 A3, ticket
  `timers-review-carries`).

#### Spec and plan lines changed by these rulings

- **Table 6.4a, the row `stranded`.** The spec named three tokens for a turn that fails on its account. It now reads
  the stop-failure classification's account class (call 1319, slug `account-failure-reads-the-stopfailure-classes`).
- **Table 11.7a, I7.** The row adds that the term and the model class equal the journal's (calls 1219 and 1286).
- **The sequence plan.** Its PR B was built as B1 and B2 (call 1216); questions 6, 11 and 17 are departed from as the
  bullets above say; I5's baseline is the newest `live` designation line while a binding stands (call 1077).
- **Tickets that no PR can close.** `sandbox-surface-arm-pins`, `overlord-quiet-unmarked-operator-paths`,
  `sequence-a-review-carries` and `sequence-kept-line-after-rebind` were built inside PRs that closed another ticket
  (one PR closes one ticket). They are done in substance and are dropped at the next plan edit.

#### The W1 map of what is buildable (2026-11-25 22:45Z)

Merged since the last map: the four console routes, designation B, the capture carries, Authority B, renewal readings
D, Sequence B1 and the Overlord's timers. Building: Sequence B2, the monitor (run 3821, #3394, on its last merge);
readiness (run 3866, stage 1); the `overlord-v1` plan (run 3867, #3401). Waiting: Sequence C waits on B2; board B2,
home B, chat A and renewal readings H wait on readiness; renewal readings G, home C and chat B wait on home B; the
`overlord-v1` build is last. The capture's acceptance reading is open: the test box runs a release that carries the
wiring and its carries, and the build list is read only by a signed-in console, so this coordinator has no read of it.
The capture follow-up tickets share files with the capture lane's second recipe and are dispatched after it lands. The
quiz tickets still need the history programme's coordinator asked first.

### Since #3403 (2026-11-25 22:45Z to 2026-11-26 02:30Z)

The calls below are this coordinator's, from call 1340 to call 1374. All are routine. Where these bullets differ from
the subsections above, these are the rule now.

- **What landed, in merge order.** Each landed through the merge queue at its reviewed head, on its first pass.

  | PR | Piece | Merge | Reviews | Accepted by |
  |---|---|---|---|---|
  | #3403 | This ledger, to 2026-11-25 22:45Z | 9220429c2f, 23:36:49Z | none (documents) | the coordinator |
  | #3394 | Sequence B2, the invariant monitor, in shadow | ad35cf5538, 00:55:35Z | 3843, 3878 | call 1343 |
  | #3401 | The `overlord-v1` plan | 3b55d40019, 02:22:53Z | 3877, 3885, 3889 | call 1374 |

- **The monitor (#3394).** The second review (3878) read the fix round, two merges of main and the I5 wiring, and
  found no behaviour defect: one reader of the kept line, one span that writes nothing, both merges equal to the
  mechanical merge of their parents outside seven named files. It left two test gaps and five word or pin points,
  none holding the landing (call 1343). They are known limits in the PR body and ride sequence C as its first task
  (ticket `sequence-b2-review-carries`): the failed-resolve retry had no case; the lost-record retry case went blind
  once #3395 made every latch raise stamp a line; the I5 wiring at the composition root was pinned by the type only.
  **Read this before the `invariants` row is ever set Live:** in W1 no production writer stamps a non-designation line
  with a session actor, so on a real box I5 reads holds or unmeasured, never violated, and days in shadow carry no I5
  evidence either way. I7 is read in the shadow record first, as before.
- **The `overlord-v1` plan (#3401), three review rounds.**
  - Round 1 (3877, call 1340). The inventory's 23 rows hold on main and no hold was missed. Rulings: the `board` and
    `history` door-process tools ride board B2 and the `sequence` tool rides sequence C; the census holds every door
    of the word to a client row and a tool, both ways, the reader flag included; the merge of the word waits for chat B
    (replies would go unrecorded before their writer exists, a gap that can never be filled later); entry row E11 reads
    `continuity`, `launch-profile` and `anchor-slot` live, with new rows for sign-in armed, the agent's history word,
    the fleet box's build and doctor's skills check; the card's gatherer declares its own port and the notes port
    stays narrow; the messages field is optional on the card's facts (absent off the Overlord's card, so no other
    snapshot's id moves); the messages section has a named byte cap; timers stay off the never-empty list and the
    Overlord's card has its own nothing line.
  - Round 2 (3885, call 1358). The reader flag is an equality with a hand list of two readable doors; an absent
    messages field on the Overlord's renderer reads unmeasured; and entry row E3 means a reader can read through the
    tool: the census asks the read tool's own admission rule through one exported predicate of the door process. On
    main the history door is a write and its tool is fenced, which the read tool refuses, so E3 stays red until board
    B2 makes the history readable (ticket `history-readable-through-the-read-tool`).
  - Round 3 (3889, call 1374), the last the cap allows. Two findings needed a ruling. The plan's reason line would
    have put a raw store error into the Overlord's stored snapshot and its id, because main's snapshot keeps a fact
    whole: ruled that the messages fact carries one of two fixed noun phrases and nothing else, the store's reason goes
    to one server log line, and the card has no reason line. The census's two reader checks had no measured red:
    ruled that both are functions over a table passed in, with synthetic cases. The reviewed tip was landed, and the
    corrections were written into the plan by this ledger edit, with four small ones (five mutants, a dropped clause,
    the export's shape, the fixtures count). Asking for a lift of the review cap was rejected as an operator chore for a
    documents fix (ticket `overlord-v1-plan-corrections`, closed by this edit).
- **Readiness, in two stages (calls 1315, 1319, 1369).** Stage 1 touched no file the monitor's worker held. Stage 2
  opened when #3394 merged. Three other programmes' workers hold claims on the seam it edits (the session gate's two
  files and `CLAUDE.md`; the schema file and its two pins; the box-token census and the rings data file), so each
  hunk goes to its holder as an exact diff first. One holder was stopped on a model error and silent for thirty
  minutes: the worker applied its migration hunks locally and held the push until that holder's coordinator answered
  yes (call 1369). The readiness read's rows in the session gate were approved by diff: session-gated when armed, not
  exempt, no box token.
- **Sequence C, in two stages (call 1351).** Stage 1 is the review carries and every part of the doors that edits no
  file of the seam readiness is in: the two answers as pure deciders in a file of their own, the client verb, the
  `sequence` door tool (not readable). Stage 2 opens when the readiness door is on main. Rulings: the page limit is 1
  to 500 and a zero is refused, never read as one (slug `sequence-limit-is-positive`); the cursor read has a routes
  file of its own, like the inbox's and the history's; main already has the restore counter's one reader, so the read
  passes it and never a second (slug `restore-generation-read-live`); the I5 read is bound inside the monitor's
  factory, so a stand-in cannot be passed at the composition root.
- **Migration numbers, agreed among three coordinators (2026-11-26).** Three programmes had a `coord.db` migration in
  flight at once. A pull request takes its final migration number only at its last merge of main before the queue,
  the first free number then, and never while another migration pull request is in the queue; its coordinator mails
  the other two before the enqueue, with the number taken, and again at merge or dequeue. Until then every draft's
  number is provisional and the later lander renumbers once.
- **The capture lane's second recipe (another programme's #3400), fix round 1.** As the capture's owner this
  coordinator read the round's diff in every capture source file and answered yes: build trust reads what it read (the
  stand-in's request list is unchanged and the route list sits beside it); a fault of the box is never stored as a
  verdict; no door, op or exec is added; the shared readers refuse rather than fold. One log line was reworded to say
  what was measured.
- **Tickets added.** `sequence-b2-review-carries`, `w1-sequence-c`, `history-readable-through-the-read-tool`,
  `overlord-checkpoint-thread-reader`, `overlord-v1-plan-corrections`, `containment-loopback-curl-exit-code` (one
  containment case is red on clean main on the fleet box, where a newer curl exits with another status for the same
  refusal; CI is green).

#### The merged task note, folded

- **`w1-sequence-b2.md` (the invariant monitor).** Departures by slug: `i7-reads-confirms-two-sides`,
  `i7-latch-cap-compared`, `not-applicable-says-why`, `invariant-monitor-built-in-the-composition-root`,
  `designation-baseline-is-a-dependency`, `three-predicates-deferred-by-ruling` (I8, I13's message half and I18 read
  `not-applicable`; tickets `invariant-message-predicates` and `invariant-i18-seal-predicate`),
  `gather-reads-the-whole-window`, `ladder-row-case-in-the-monitor-suite`, `invariant-sets-apart` and
  `three-runner-deciders-in-l1`. What the merge armed: the watcher's `invariants` lane, once a minute, in shadow. A
  pass gathers only when the sequence head moved, the mode changed or ten minutes passed, inside one transaction that
  writes nothing; it records each new finding as a shadow row and raises no latch and no item. The write-locked span
  was measured on fixture databases only; the window on a real box is not measured. Corrections from review 3878: the
  note's mutant row that names the lost-record case as a killer is stale; "a designation line above the floor moves
  the kept line" holds only for a new live line, the retire of the bound body or, with no binding, any newer
  designation line.

#### Spec and plan lines changed by these rulings

- **The `overlord-v1` plan.** The five corrections of call 1374, in its interfaces, Task 1's Steps 5, 7 and 10, Task
  2's Files and Step 2, question 8, Review Focus, Table 5 and "Where things stand".
- **The W1 index.** The plan's index changes: the `overlord-v1` row's path, needs and census; the door tools' owners
  in the board's and the sequence's rows; `continuity-v1` merged; the Overlord clause merged as clause 24; question
  33's sentence on the Overlord's own doors; the `anchor-slot` lane and sign-in in "What a merge arms"; the
  checkpoint's reader of the Overlord's replies as later work with no owner.
- **Still owed, for the spec-fixes run.** §7.5 and §11.5's "the hook's card arm" becomes "the card door's Overlord
  renderer"; §3.3.3's "lists every unsettled message" becomes "lists every unsettled message's id and facts", and its
  never-empty rule names the Overlord's own nothing line; the W1 row of §14 names the `history`, `board` and
  `sequence` door tools.

#### The W1 map of what is buildable (2026-11-26 02:30Z)

Merged since the last map: Sequence B2 (the monitor) and the `overlord-v1` plan. Building: readiness (run 3866, stage
2); sequence C (run 3886, stage 1 built, stage 2 waits on the readiness door). Waiting: board B2, home B, chat A and
renewal readings H wait on readiness; renewal readings G, home C and chat B wait on home B; the `overlord-v1` build
is last, after chat B, board B2 and sequence C. The capture's acceptance reading is still open. The capture follow-up
tickets are dispatched after the capture lane's second recipe lands.

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
- **One licensed absorption, then ordinary merges on a base the coordinator names** (the operator's standing yes on
  item 615, 2026-11-24, and call 815). A worker's own skill licenses one absorption of main. Any further ordinary
  merge is made on a base the coordinator has named after measuring the conflict. It is a merge commit, never a
  rebase, a force-push or the PR page's update button. No second merge waits on the operator or on a keeper.
- **An Overlord PR is a draft until the coordinator accepts it** (call 923, 2026-11-24). At landing the coordinator
  marks it ready, runs the whole gate, then enqueues, with the enqueue as its own command.
- **Before enqueueing, probe the tip against every PR already in the queue,** not only against main. Two tips can
  conflict with each other while each is clean against main (Sandbox B and Inbox, in the composition root).
- **A ratchet row or an exact pin count is never raised.** A PR whose own test would push one up re-keys the test
  instead (Authority B's review 3679, F2). A file at its growth cap takes a replaced line, never an added one.
- **The gate's two files have no holder** (since Serviceability B landed, 2026-11-25). `server/src/auth/gate.ts` and
  `server/test/auth-gate.test.ts` are edited on the coordinator's ruling, and each merge of them is checked against the
  mechanical merge tree. Authority B and designation B conflict there and in the box-token and Overlord-doors censuses:
  whichever lands second merges those, with the counts re-derived.
- **A PR that touches the front end runs the browser suite on its exact tip before it is marked ready** (the queue
  ejected #3215 for its own browser red, 2026-11-25). That is any change under `pwa/src` or `ui/src`, or to a `shared/`
  file that `pwa/src` or `pwa/browser` imports and uses. A pull request's fast run skips the browser suite; the `full-ci`
  label or a dispatched full run gives it. A browser part cancelled at its job deadline with no failing case is not a red
  (call 1108).
- **`shared/api.ts` stands at its growth cap.** A PR that adds a code line there removes one; the coordinator reads that
  file's diff in every wave-done.

## Next-wave brief

State as of 2026-11-26 02:30Z, with main at 3b55d40019. #3394 merged at 00:55:35Z and #3401 at 02:22:53Z.

- **Where to start.** Read the spec's "In short", §14 (the build order) and "Where things stand". Then read the plan
  of the piece you take, and its task note if it has one. Each plan is self-contained.
- **Done.** W0 (#2632, #2711), the W1a foundations, and the W1a machine (the `continuity-v1` word is on main). The recall clause (#2919) and the Overlord
  clause, clause 24 (#3354), are merged. The weekly quiz line is merged through stage B (#3252, #3253, #3262, #3267).
  W1 is built through the vocabulary, the skill, the journal kernel and the authority journal's A, B (#3370) and C, the
  pool set, the push outbox and response record, the designation's A, B (#3346) and C, the gates, the ladder, the other
  write lanes, ccd's arms, serviceability A and B, the private store, the portfolio, the history op and the history
  door, the sandbox's A, A2 and B and its carried pins, the door process, renewal readings A to F (D is #3377), the
  operator mark's four more routes (#3373), the isolation word, the answer marks, the sequence's A, B1 (#3395) and B2
  (#3394, the monitor, in shadow), the Overlord's timers (#3388), the inbox and home A. Every W1 plan is merged, the
  `overlord-v1` plan (#3401) included. Capture PR 2, the wiring (#3347) and its carries (#3378) are merged.
  W2 has its plans and its first twelve pieces. The Waves table has each PR.
- **Open runs, and what each waits on.** Every PR below is a draft until the coordinator accepts it.
  - Readiness (run 3866, calls 1315, 1319 and 1369): stage 2 is building on main ad35cf5538. Its hunks in files
    other programmes hold went to their holders as packets, and every answer but the box-token census's is in. On its
    wave-done: verify (a clean tree; the front-end reach; a full CI run on the exact tip if a shared file the front
    end imports changed), one review, a ruling. At landing it takes its final migration number at its last merge of
    main, re-derives the session gate's count lines there, and the two other coordinators with a migration in flight
    are mailed before the enqueue.
  - Sequence C (run 3886, call 1351): stage 1 is built locally (3e4fc304ea) and its worker waits. When the readiness
    pull request is on main, mail it the main to merge once and the holders of the seam's files then; stage 2 is the
    two handlers, the door rows, the deps, every census of the plan's Task 7 and `CLAUDE.md`'s paragraph. Then
    verify, one review, a ruling and landing.
  - Run 3009 is a planned placeholder.
  - The capture runner: the test box runs a release that carries the wiring and its carries. The acceptance reading
    (a build recorded through the product) is open, because the build list is read only by a signed-in console.
    Decide a route for that reading, then dispatch ticket `testbox-admin-root-writes` and the other capture follow-ups
    after the capture lane's second recipe (another programme's draft #3400) lands, since they share files.
  - The weekly quiz line has no open run.
  - The rebrand (ticket `rebrand-to-overlord`): its design is open with the operator; it runs last.
- **Queue next, as dispatch slots, CI and the disk allow.** After readiness: board B2 (its brief carries the `board`
  and `history` door tools and tickets `history-door-process-row` and `history-readable-through-the-read-tool`), home B
  (carrying the case that ticket `home-a-review-carries` owes), chat A and renewal readings H. After home B: renewal
  readings G, home C and chat B. Then the `overlord-v1` build, last (after chat B, board B2 and sequence C; its plan's
  entry checklist is read at landing), and the W2 pieces that wait on these. The quiz
  tickets `quiz-repilot-kill-window` and `quiz-doctor-run-age` reach a history gate-code file, so the history
  programme's coordinator is asked before any brief. The follow-up tickets ride with the PR they name. D-8126's A10
  measurement is due about 30 days after A9's rollout mail. W1-5 is not built. Dispatch a review only with free space
  safely over the floor.
- **Owed on the next ledger PR, in other documents.** The quiz note's old timer lines are corrected. Plan sentences that
  say "nothing arms on merge" are checked against what each merged PR armed. The clause's plan and note: the sentence on
  the refusal word (today the client answers an unknown verb), D-9024's phrase, and the index row for the plan's dated
  path; W2 owes client rows for the relay acknowledge verb and the act read, and a client-row pin for clause 24. The
  board and history plan's lines that still read the history row as unfenced, and the door-process plan's reading of
  history against the read tool's rule (tickets `history-door-process-row` and
  `history-readable-through-the-read-tool`). The I5 plan text for the kept designation line (call 1077), and the
  readiness plan's index changes with its fix round 1, F5 (the Restart section of the designation plan). The spec
  fixes the `overlord-v1` plan lists (above, "Still owed, for the spec-fixes run"). The W2 entry step bumps the coordinator skill's
  rollout revision word with the first build that can send a coordinator a relay (call 1025, D-9024). The capture
  runner spec's as-built corrections (§2.2's copy steps, Figure 2's caption, §2.3's environment) were made in #3376;
  decision D3's "a new sub in the repair sub's phases" is left as the decision was worded.
- **What the operator has been asked.** Item 661 reports an account on which two workers failed every turn; it
  blocks nothing. The operator acted on items 662 and 663 and ended runs 3296 and 3299. The rebrand's design
  questions are asked in the coordinator's own turn text. The W3 autonomy clause (347 bytes) does not fit the 10 bytes left in the
  coordinator contract's budget; it is raised as an item, for a shortening or a budget decision, when W3 nears. The
  standing yes on item 615 stands. Big calls stand until the operator overturns them: Renewal F1 and Authority B's two
  (2026-11-23), calls 592, 633 and 734 (the quiz), 815 (merges), 813, 822, 865, 901 and 925 (Capture), 870
  (Serviceability B), 914 (Sequence A) and 959 (Authority B), and since then 996 and 1116 (Capture), 997 (the clause),
  1020 (readings E), 1021, 1077 and 1095 (designation B), 1063 (board B1), readings B's last fix round, and 1131 (the
  capture lane's second recipe). No big call was recorded between calls 1134 and 1374.
- **Standing rules a coordinator keeps.**
  - Land only through the merge queue, with the head pinned by the landing entry. Never an admin merge. Never touch the
    queue once a PR is in it. One re-enqueue after an unrelated timeout, then stop for the operator, or for that file's
    owner when the red is another programme's case.
  - An Overlord PR is a draft until the coordinator accepts it. At landing: mark it ready, run the whole gate, then
    enqueue as a command of its own. Before that, probe the tip against every PR already in the queue.
  - A PR that touches the front end, or a shared file the front end imports and uses, has the browser suite run on its
    exact tip before it is marked ready; a pull request's fast run does not run it. A browser part cancelled at its job
    deadline with no failing case is not a red.
  - One licensed absorption of main per PR, by the worker's own skill. Any further ordinary merge is made on a base the
    coordinator names after measuring the conflict (item 615's standing yes, call 815). Never a rebase, a force-push
    or the PR page's update button. A conflicting PR cannot be enqueued.
  - The session gate's two files are edited on the coordinator's ruling, by diff first, and each merge of them is
    checked against the mechanical merge tree. When another programme's claim holds them, the diff goes to that holder
    too, and a holder silent for thirty minutes is taken to its coordinator.
  - A migration pull request takes its final number at its last merge of main before the queue and never enters the
    queue behind another migration pull request; the other coordinators with one in flight are mailed before the
    enqueue and at merge or dequeue.
  - A ratchet row or an exact pin count is never raised. A file at its growth cap (`shared/api.ts` among them) takes a
    replaced line, never an added one. A full commit id in a mail is copied from command output.
  - Review in a separate worktree at an exact head, reported to the coordinator, who closes the review with the reviewer's
    measured tip. Three rounds is the cap, and a review that never ran counts. Lift it with `runs review-rounds` and a
    reason, decided before the round opens. At the cap, fix only a one-line, already-tested finding; the rest are Known
    limits in the PR body.
  - While a review reads, the branch does not move: a prepared merge stays uncommitted, since a local commit moves the
    ref the server measures and the review's close is refused as stale.
  - A reviewer that stalls on background lenses is closed failed and replaced by a review whose lenses run in the
    foreground of its turn, one at a time, sized to the round.
  - A review report is copied to the coordinator's own store before the reviewed work run closes, since the reviewer's
    folder is reclaimed with it.
  - A worker whose every turn fails is replaced by a fresh child on its workspace's work; the dead run waits for the
    operator's end, since a coordinator cannot abandon a working run.
  - Open the next wave's run before closing the last. After a MERGED mail, prove MERGED at the pinned head, mail the
    worker at once, then close the run final and require `released:true`.
  - A brief is at most 8,192 bytes with its prefix; measure bytes and keep it under 8,088. Keep saved server answers out
    of the scan folder, and name a report file by its name only, never a path, in any mail.
  - Peers share a file by their own hunks, and the second lander keeps both sides. A file held by another programme's
    claim takes a packet first, to the holder; the landing programme's coordinator answers packets for the README and
    the files its run holds, with the diff inline. Ask the history programme's coordinator before a brief edits a
    gate-code file.
- **What to report.** Each piece ends with its pull request merged through the queue, its note's departures recorded,
  and this ledger's row updated on a `ledger/overlord` branch. Fold each piece's note into this ledger as it lands.
