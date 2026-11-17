# Account organization, PR A: the builder's notes

**Run** 2241 (programme `overlord`, #2491) · **Plan** `docs/superpowers/plans/2026-11-16-account-organization.md`
(#2909), Tasks A1 to A3 · **Spec delta** #2910

These notes are for the coordinator's ledger. They name departures by slug. No D-number is used or invented.

## In short

PR A gives each account an optional organization label, `org`, shaped like `pool`. It is never the organization's
id. The roster, its bare-Node mirror, `accounts.sh` (`_ccrc_org`) and the wire carry it. `shared/accountOrg.ts` and
ccd's `_org_rel` relate two accounts by it, and one fixture holds the two equal. The operator sets the label through
the account set door and `ccrc account set --org <label>|none`, both through the account script's `set-facts` op.

## What was built

| Task | What | Where |
|---|---|---|
| A1 | `AccountDef.org`, `ACCOUNT_KEYS`, the parse gate, `ORG_ID_SHAPES`, `ORG_CLEAR_WORD`, `orgLabelVerdict` | `shared/roster.ts` |
| A1 | The mirror's gate and `org` on its answer | `shared/roster-json.mjs`, `.d.mts` |
| A1 | `_ccrc_org`, always emitted, arms only for a label the gate admits | `shared/generate.mjs` |
| A1 | `RosterFactsWire.org` (absent when unset), `RosterFactsChange.org` | `shared/rosterFacts.ts` |
| A2 | `orgRelation`, `orgSpread`, their derived lists | `shared/accountOrg.ts` (new, L0, imports nothing) |
| A2 | `_acct_org` (guarded by `declare -F`), `_org_rel`, `_ccrc_org` in `_CCD_ROSTER_FNS` | `ccd/ccd`, `ccd/contexts.tsv` |
| A3 | `set-facts --org <label>\|none` | the account script |
| A3 | `--org` passed through to `set-facts` | `ccd/ccrc` (`_acct_set`) |
| A3 | `org` on the set sub, gated by `orgLabelVerdict` | `shared/account-argv.ts` |
| A3 | `{ org }` on `POST /api/accounts/:id/set`, no step-up, `org-looks-like-an-id` before any op | `server/src/accounts/routes.ts` |

## The step-up

The label widens no authority. It is a preference that only breaks ties (PR C) and makes a renewal due (PR D).
So `factsChangeWidens` stays false for it, and neither a label nor a clear takes the step-up. A test pins both, and a
mutant that makes `org` widen reds it.

## Departures, by slug

- `org-clear-word-none`: the plan gives the verb `--org <label>|none`. The door's body and the argv builder use the
  same word, `none`, to clear, so one vocabulary runs from the PWA to the op. So the parsers refuse `none` as a
  label (`ORG_CLEAR_WORD`), or a label named `none` could never be set or told apart from a clear.
- `org-route-refusal-word`: the door answers a new route refusal, `org-looks-like-an-id` (400), added to
  `ACCOUNT_WRITE_REFUSALS` and `REFUSAL_STATUS`, so PR B can word it. An off-shape label stays `bad-request`. The
  op refuses the same word for the operator's shell, and the route relays it as the same word if it ever arrives.
- `org-argv-builder-gate`: the plan's file list for A3 does not name `shared/account-argv.ts`, but the door's fields
  reach the verb only through that builder, which the agent runs again. It gains `org`, gated by the roster's own
  `orgLabelVerdict`, never a copy.
- `org-shape-owned-by-the-op`: the verb (`ccd/ccrc`) checks only that `--org` has a value and passes it through.
  The op owns the shape, so bash holds no third copy of the id shapes. An empty `--org=` answers
  `unknown-argument`, not `missing-value`.
- `org-wire-needs-no-server-edit`: the plan estimated `server/src/server.ts` +1. `rosterWireOf` already spreads
  `rosterFactsWireOf(a)`, so `org` reaches the wire with no edit there.
- `org-verdict-type-not-exported`: `orgLabelVerdict` returns an inline union, not an exported alias, because the
  wire-totality guard would require a runtime list for an exported literal union in `shared/*.ts`.

## Tests and mutation

The plan's lists for A1 to A3 run green, with the roster suites, `account-deny`, the must-allow fixtures, the
account script's suites, `ccd-split-pin`, `ccd-contexts`, `single-definition/*`, `rings/*`, `sim/mutation-floors`,
`growth-check` armed, both type checks and `deviation-refs`.

`mutation-run.py` mutates Python modules only, so the mutants were applied by hand, each restored from a saved copy.
All 20 mutants were killed:

| Mutant | Killed by |
|---|---|
| drop the id-shape refusal (parser, mirror) | `roster-org` |
| accept a written `null` (parser, mirror) | `roster-org` |
| emit no `_ccrc_org` when no account is labelled | `roster-org` |
| emit an arm for an unvalidated label | `roster-org` |
| carry `org` on the wire when unset | `roster-org` |
| two unlabelled distinct accounts read `same` (TS, bash) | `org-relation` |
| one account against itself reads `unknown` (TS, bash) | `org-relation` |
| an unmeasured C56 figure reads `none` | `org-relation` |
| `_acct_org` without its `declare -F` guard | `org-relation` |
| the route skips the shape check, or the id check | `account-routes-write` |
| `org` widens | `account-routes-write` |
| the op skips the shape check, or `none` writes a label | `account-op-set-facts` |
| the argv builder takes any label | `account-argv` (agent) |
| the verb drops `--org` | `ccrc-account-set` |

The `gen-accounts` parity rows and the verb's cases were written after their code, not before; the mutants above
are what measures them.

## Peer grants

- `ccd/ccrc` (claim 4509, run 2216): co-edit of `_acct_set`'s argument loop and its `set-facts` call only.
- `README.md` (claim 4532, run 1850): `org` in the account-entry key list and one row in the mirror table, and,
  in a second grant, the one token `_ccrc_org` in the projection paragraph's list of emitted functions.
- `shared/refusal.ts` (claim 4521, run 2222, which the coordinator granted): the one status `'org-looks-like-an-id': 400`
  on the write routes' line of `REFUSAL_STATUS`.

## Growth

Net code lines against `main`, all within the 40-line limit with no waiver: `shared/roster.ts` +26,
`shared/accountOrg.ts` +49 (new, not a listed file), `shared/generate.mjs` +16, `shared/roster-json.mjs` +16,
`deploy/account-op.mjs` +11, `server/src/accounts/routes.ts` +10, `shared/rosterFacts.ts` +6, `ccd/ccd` +5,
`shared/account-argv.ts` +3, `ccd/ccrc` +2. `growth-check` runs green armed.
