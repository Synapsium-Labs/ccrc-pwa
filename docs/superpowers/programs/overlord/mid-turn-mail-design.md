# Overlord wave 165, mid-turn mail design: notes for the ledger

This note records what wave 165 wrote and measured. The coordinator folds it into the programme ledger and mints any
numbers. No D-number is defined here.

## In short

- **Written:** `docs/superpowers/specs/2026-11-19-mid-turn-mail-design.md`, docs only. It recommends C, built as A + D:
  a hold in the session hook on push, commit, merge of main and `gh pr merge` while an urgent mail is unacked (A), and
  the urgent mail's nudge typed once into a busy pane (D). It defers B, the pull client.
- **Measured claims of the brief:** nothing on `main` marks a mail urgent, and the session hook has no mid-turn mail
  path. Both are confirmed on `ba2f67dac` (spec §1.2).
- **Not measurable through the API:** how long a delivered mail waited. `deliveredAt`, `ingestedAt` and `ackedAt` are
  stored but `MailSummary` serves none of them. The spec gives sampled lower bounds instead (§1.3) and names the read
  that would answer it.
- **Read, not run:** opencrawl-core at `ccb0b20d93bb9af2fccadebbf1bf08169b87e330`, through `gh` only (spec §2.2).

## 1. Findings for the ledger

| Slug | Finding | Where |
|---|---|---|
| `mail-wait-unserved` | The mail wire serves no delivery, ingest or ack time, so no read answers "how long did this mail wait" for a delivered row. The gate fields are cleared on delivery. | `shared/api.ts#MailSummary`, `server/src/coord/schema.ts` (`mail_deliveries`) |
| `envelope-no-client-stance` | `envelope.ts`'s "no client, no library and no MCP server on the other end" is reopened by the operator's direction of 2026-11-19. The spec weighs it and defers a client (D8). If B is ever built, that comment changes with it. | `server/src/coord/envelope.ts#renderEnvelope` |
| `busy-typed-text-unmeasured` | Whether the fleet's Claude Code build shows text typed during a running turn at the next tool boundary is unmeasured. D depends on it, and the spec asks for a test-box probe first. | spec §2.3, §5 |

## 2. Proposed follow-ups (for the coordinator to file)

1. Serve `deliveredAt`, `ingestedAt` and `ackedAt` on `MailSummary`, additive (the measurement read, spec D9).
2. The test-box probe for typed text during a running turn (spec §5).
3. The urgent flag, the urgent-sender decider and `GET /api/mail/hold` (spec §3.1, §3.2), with one `coord.db`
   migration slot.
4. The hook's hold arm, shadow first (spec §3.3).
5. D, the urgent nudge row in `mailTurnIdle` (spec §3.4), only after the probe.
6. Worker and coordinator skill clauses for urgent mail, as a wave of their own (the clauses are pinned verbatim).

## 3. Departures from the brief

- The brief's C paired A with B. The spec proposes D, an urgent nudge on the existing lane, as the reading half, and
  keeps B as the fallback if D's probe fails. Reason: D adds no second delivery mechanism, and B would need a
  "legitimately different" reason that D already covers (spec §3.5).
