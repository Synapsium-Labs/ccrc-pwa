# The held-out review panel — every handoff review, three Opus lenses, a Sonnet refute pass, majority deciding

Invoked by coordinator clause 13 at the handoff review (SKILL.md step 5), on the wave's handoff
commit range, before the ledger is updated and before the next wave's run is opened. It is the
quality gate of the routing design (spec §2): the one measurement that must not move when a
worker's class or effort is changed, so it is **unroutable** — its model and effort are literal in
the script below, it reads no routing field, and no escalation or demotion reaches it. A wave is
never accepted on the coordinator's own reading alone.

**The three lenses**, each a fresh context on `opus` at `high`:

- **correctness** — does the code do what its own comments and tests say, at every seam the diff
  touches; a guard that cannot red for the thing it claims to guard is a finding.
- **spec conformance** — does the diff do what the plan's tasks and the spec's sections it cites
  require, no more and no less; a plan step skipped, a constraint weakened, a deviation not
  ledgered is a finding.
- **does-it-reproduce** — for every claim the handoff makes (a suite green, a measurement, a
  mutation red), can it be reproduced from the tree as committed; a claim that cannot is a
  finding, whatever the commit message says.

**The refute pass.** Every finding goes to three fresh `sonnet` `high` refuters, each told to
refute it and to default to refuted when uncertain; the **majority** decides. A finding two or
three refuters kill is dropped, with the refutations kept. A finding that survives is a finding;
its refuters' proposed remedy is advice, never a mandate (a survived finding is not a mandate for
its own remedy).

**Unverified is never approval.** A lens that dies, times out or returns nothing counts as
unverified, never as approval, and is recorded as
`unverifiedLenses` and the review is incomplete: re-run that lens before accepting the wave. A
finding whose refuters ALL died is `unexamined`, never `refuted` — it is reported beside the
confirmed findings and blocks acceptance until examined.

**What the coordinator does with the result.** Confirmed findings go back to the worker as a
`finding` mail with the file, the line and the claim, and the run stays where it is; the ledger's
"Decisions & deviations" records the panel's verdict and the count of findings per lens for the
wave, which is what spec §6's quality signal reads. Nothing in this file changes routing: a wave
with findings is a fix round on the spend side, and the routing decision for the NEXT wave is
clause 12's, made on the evidence, not here.

**Run it as a Workflow**, passing the range and the documents as `args`. The script is complete;
copy it verbatim. `agent`, `pipeline`, `parallel`, `phase` and `args` are the Workflow tool's
globals.

```js
export const meta = {
  name: 'ccrc-review-panel',
  description: 'Held-out handoff review: three Opus lenses, three Sonnet refuters per finding, majority deciding',
  phases: [{ title: 'Lenses' }, { title: 'Refute' }],
}
// args: { repo, base, tip, plan, spec, wave } — repo is the WORKER's worktree (read-only for
// every agent), base..tip the handoff commit range, plan and spec the documents the wave is
// measured against, wave the ledger's wave number (for labels only).
const A = args
const RANGE = `${A.base}..${A.tip}`
const READ_ONLY = `Work in ${A.repo}. Read only: never edit, commit, stash, checkout or run a build there. Cite every claim as file:line at ${A.tip}.`
const LENSES = [
  { key: 'correctness', prompt: `${READ_ONLY}\nReview the diff ${RANGE} (git -C ${A.repo} diff ${RANGE}) for CORRECTNESS: does the code do what its own comments and tests say at every seam the diff touches? A guard that cannot red for the thing it claims to guard is a finding. Return only findings you can point at.` },
  { key: 'spec', prompt: `${READ_ONLY}\nReview the diff ${RANGE} for SPEC CONFORMANCE against the plan at ${A.plan} (its tasks for wave ${A.wave}) and the spec at ${A.spec}: a plan step skipped, a constraint weakened, a deviation not ledgered in the plan's Deviations section is a finding. Return only findings you can point at.` },
  { key: 'reproduce', prompt: `${READ_ONLY}\nFor every claim the commits in ${RANGE} make (git -C ${A.repo} log ${RANGE}): a suite green, a measurement, a mutation red — attempt to REPRODUCE it from the tree at ${A.tip} without modifying it (read the test files and the commands the messages name; you may run read-only commands and the named vitest suites from inside their package with ./node_modules/.bin/vitest run, foreground). A claim that does not reproduce is a finding, whatever the message says.` },
]
const FINDINGS = {
  type: 'object',
  properties: { findings: { type: 'array', items: { type: 'object',
    properties: { file: { type: 'string' }, line: { type: 'integer' }, claim: { type: 'string' },
      severity: { type: 'string', enum: ['critical', 'important', 'minor'] } },
    required: ['file', 'claim', 'severity'] } } },
  required: ['findings'],
}
const VERDICT = {
  type: 'object',
  properties: { refuted: { type: 'boolean' }, why: { type: 'string' } },
  required: ['refuted', 'why'],
}
const unverifiedLenses = []
const results = await pipeline(
  LENSES,
  (l) => agent(l.prompt, { label: `lens:${l.key}`, phase: 'Lenses', model: 'opus', effort: 'high', schema: FINDINGS })
    .then((r) => { if (r === null) unverifiedLenses.push(l.key); return r }),
  (found, l) => found === null ? [] : parallel((found.findings ?? []).map((f) => () =>
    parallel([0, 1, 2].map((i) => () =>
      agent(`${READ_ONLY}\nA ${l.key} reviewer of ${RANGE} claims: ${JSON.stringify(f)}. Try to REFUTE it from the tree at ${A.tip}. Default to refuted=true when uncertain. Answer with why either way.`,
        { label: `refute:${l.key}:${i}`, phase: 'Refute', model: 'sonnet', effort: 'high', schema: VERDICT })))
      .then((votes) => ({ lens: l.key, finding: f, votes: votes.filter(Boolean) })))),
)
const judged = results.filter(Boolean).flat()
const confirmed = judged.filter((j) => j.votes.length > 0 && j.votes.filter((v) => v.refuted).length < 2)
const refuted = judged.filter((j) => j.votes.length > 0 && j.votes.filter((v) => v.refuted).length >= 2)
const unexamined = judged.filter((j) => j.votes.length === 0)
log(`${confirmed.length} confirmed, ${refuted.length} refuted, ${unexamined.length} unexamined, lenses unverified: ${unverifiedLenses.join(', ') || 'none'}`)
return { confirmed, refuted, unexamined, unverifiedLenses }
```

A refuter that dies is not a vote (`filter(Boolean)`); a finding with no surviving vote is
`unexamined`, never `refuted` — the `votes.length > 0` guard on both buckets is what keeps a
dead refuter from counting as a kill.
