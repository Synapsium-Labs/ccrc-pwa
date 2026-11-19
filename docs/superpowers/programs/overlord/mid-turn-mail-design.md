# Overlord wave 165, mid-turn mail design: notes for the ledger

This note records what wave 165 wrote and measured, and how fix round 1 changed it. The coordinator folds it into the
programme ledger and mints any numbers. No D-number is defined here.

## In short

- **Written:** `docs/superpowers/specs/2026-11-19-mid-turn-mail-design.md`, docs only. It recommends C, built as A + E:
  a lane-only route field, `mailhold`, written by the server over `CCD_ARGV.routeSet` as `precompact` is, and two hook
  arms that read it with a builtin. One arm refuses push, commit, a merge of main and `gh pr merge` while urgent mail is
  unread (A). The other adds a fixed notice line to the main thread's tool calls (E). Nothing is typed into a pane, and
  nothing on the tool path reaches the network.
- **Fix round 1 (review 2688, the coordinator's rulings of 2026-11-19):** D, the urgent nudge typed into a busy pane, is
  ruled out, because the rate-limit menu opens by itself mid-turn. E replaces it as the reading half, and B, the pull
  client, is its fallback, with a stated trigger. The hold is defined over the rows `mail inbox` prints (F1). The
  subagent test is the registry join (F4). Acking forms of mail are refused in a joined subagent. Urgent mail is one
  outstanding per sender and recipient. The roll order is server first.
- **Measured claims of the brief:** nothing on `main` marks a mail urgent, and the session hook has no mid-turn mail
  path. Both are confirmed on `ba2f67dac` (spec §1.2).
- **Not measurable through the API:** how long a delivered mail waited. `deliveredAt`, `ingestedAt` and `ackedAt` are
  stored, but `MailSummary` serves none of them. The spec gives sampled lower bounds instead (§1.3: 52 minutes, 18
  deliveries; four mails from a coordinator to a busy worker each waited at least 9 minutes, three of them more than 9)
  and names the read that would answer it.
- **Read, not run:** opencrawl-core at `ccb0b20d93bb9af2fccadebbf1bf08169b87e330`, through `gh` only (spec §2.2).

## 1. Findings for the ledger

| Slug | Finding | Where |
|---|---|---|
| `mail-wait-unserved` | The mail wire serves no delivery, ingest or ack time, so no read answers "how long did this mail wait" for a delivered row. The gate fields are cleared on delivery. | `shared/api.ts#MailSummary`, `server/src/coord/schema.ts` (`mail_deliveries`) |
| `envelope-no-client-stance` | `envelope.ts`'s "no client, no library and no MCP server on the other end" is reopened by the operator's direction of 2026-11-19. The spec weighs it and defers a client. If B is ever built, that comment changes with it. | `server/src/coord/envelope.ts#renderEnvelope` |
| `route-field-carrier` | A lane-only route field is an existing carrier for a server fact the session hook must read without the network: `precompact` already does it. `mailhold` would be the second. | `ccd/ccd` (`ROUTE_FIELDS`, `_route_valid`), `server/src/continuity/renewalWiring.ts` |
| `pretooluse-context-unmeasured` | Whether the fleet's Claude Code build shows a `PreToolUse` `additionalContext` to the model inside the turn is assumed by the hook's existing advice arms and by E, and is not measured. It is B's trigger. | spec §2.3, §5 |

## 2. Proposed follow-ups (for the coordinator to file)

1. Serve `deliveredAt`, `ingestedAt` and `ackedAt` on `MailSummary`, additive (the measurement read, spec D12).
2. The test-box check that a `PreToolUse` `additionalContext` line reaches the model mid-turn (spec §5).
3. The urgent flag, its sender rule and `urgent-outstanding` (spec §3.1), with one `coord.db` migration slot.
4. The hold's derivation over `inboxFor`'s predicate and the `mailhold` writer lane (spec §3.2, §3.3), with the
   `route-mailhold-v1` cap and the field's rows in ccd.
5. The hook's three arms in a `ccd/lib` file, shadow first (spec §3.4).
6. Worker and coordinator skill clauses for urgent mail, as a wave of their own (the clauses are pinned verbatim).

## 3. Departures from the brief

- The brief's C paired A with B. After fix round 1 the spec pairs A with E, a fixed hook line from a local marker, and
  keeps B as the fallback. D, proposed in the first draft, is ruled out (spec §2.4).
- The brief named a hook gate that reads the server. The spec's hook reads a local marker instead (ruling 2 of fix
  round 1). The server read stays as the fallback if the carrier is refused (spec §3.3).
