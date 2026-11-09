# Link every fleet PR to its Linear ticket, from the Linear side

- **D-8141 (2026-11-09)** — every PR a fleet session opens is linked to its Linear ticket from the Linear side, in every Synapsium Labs repository, so Linear's GitHub integration (installed organisation-wide) tracks it and the team's Git automations act on merge, with no tracker id in the public repository. The link is made by a new `ccrc-api linear link` verb through the server's Linear proxy and the key ccrc holds; the PR body cites the ticket's GitHub mirror issue (`Closes #n` when the merge meets the ticket's acceptance, `Refs #n` when a live check is owed), never the tracker id.

## What was read first

- `server/src/linear/ops.ts` is the one home of the operation table: `LINEAR_VERBS`, `LINEAR_DOCUMENTS` (every document the key can run, each a constant, each with a fixture), `BODIES` (the closed body validators), `LINEAR_OPS` (one row per verb) and `validateLinearCall`.
- `server/src/linear/proxyRoutes.ts` registers one box-token route per verb. The handler is generic: attribution, validation with `linear-egress`, routing, the rate take, the resolve (a write resolves the issue first, so a moved issue is refused), the policy point, the journal's pending row, the one mutation, shaping, the journal's settle. A new write verb is a new row plus a route; the handler does not change.
- `server/src/linear/journal.ts` has a closed op list, a closed field list per write op, and a closed rule for what `result` may hold.
- `ccd/ccrc-api` holds the closed route table; the client tests pin its count, its rows and the corpus commands.

## Design

**Verb `link`, a fourth write.** `POST /api/linear/proxy/issues/{id}/links`, body `{url, title?}`, query `workspace` and the pane identity as every Linear row.

- `url` is held to `https://github.com/<owner>/<repo>/pull/<n>` or `/issues/<n>`: https only, host exactly `github.com`, no credentials, port, query or fragment, at most 200 characters. Anything else is `bad-field` (400) with the detail `url`, and nothing reaches Linear. `title` is 1 to 255 characters. The title passes `linear-egress` with every other outbound text; the URL is too narrow to carry a secret.
- The document is `mutation AttachmentLinkURL($issueId: String!, $url: String!, $title: String) { attachmentLinkURL(...) { success attachment { id } } }`. Linear's integration recognises a GitHub PR URL attached to an issue and tracks it. The mutation takes the resolve's issue UUID, never the identifier.
- The answer is `{ok: true, linked: true}`; the journal row holds op `link`, fields `url[,title]`, target the issue's current identifier, and the attachment UUID as `result`.
- The policy point sees `op: 'link'`; the port's type widens by one literal.
- Refusals are the existing words: `not-found` (no such issue), `issue-moved`, `not-configured` (no key for the workspace), `linear-invalid`, `unreachable` for an `errors` answer outside the closed table, the rate and policy words.

**No migration.** `linear_events.op` has no CHECK constraint.

**One recorded-fixture exception.** The repository's rule is that a changed document is re-captured before it lands, and this session may not call Linear. `mutation-attachment-link-url-constructed.json` is built from the schema and labelled constructed, as the 429 answer is. `linear-fixtures.test.ts` names it as the one document awaiting a recording and fails the day a recorded `mutation-attachment-link-url.json` exists beside it. The README of the fixtures says what is to be re-captured.

**Skills.** The coordinator skill's Linear section states the rule; `references/wave-lifecycle.md` §5 states it at the landing steps; the `ccrc-linear` skill carries the verb, its body and a worked example. No tracker id appears in any of them.

## Counts that move

Thirteen Linear verbs and routes (were twelve); thirteen proxy box-token lanes; sixty-three machine lanes in all (was sixty-two); sixty in the box-token lane list of gate reason 2 (was fifty-nine); 191 scanned routes, 188 HTTP, 71 exempt-HTTP; fifty-nine `ccrc-api` rows (was fifty-eight); thirty-three fixture files, two constructed.

## Tasks

- [x] T1. Tests first, red: the operation table, validator, variables, shape and resolve plan for `link`; the journal's op, fields, target and result; the route's happy path, bad URL, non-GitHub URL, missing key and upstream error; the `ccrc-api` row and its census; the skill pins.
- [x] T2. Build: `ops.ts`, `journal.ts`, `policy.ts`, `proxyRoutes.ts`, `gate.ts`, `ccd/ccrc-api`, the constructed fixture and its README, the three skills.
- [x] T3. Move the count pins and prose deliberately (listed above), then run the Linear, gate, census, client and skill suites green.
