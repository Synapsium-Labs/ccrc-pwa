# Linear through ccrc: one key per workspace, used by every session: the design's numbers

The design is `docs/superpowers/specs/2026-10-31-linear-central-key-design.md` (#1444). It is a draft for the
operator's review. Each entry below is a decision the design makes and the build must keep. The spec's section that
argues it is named in each entry. Measured on `origin/main` `46da405e2`.

## Deviations found

- **D-7667 (2026-10-31)** — `linear-key-store`: today there is one key per box. `~/.ccrc/linear.key` holds it and
  `~/.ccrc/linear.json` describes it (`server/src/linear/connection.ts#readLinearKey`,
  `server/src/linear/connection.ts#parseLinearDetails`), and nothing in the tree models a Linear workspace. A Linear API
  key reaches one workspace, so one file cannot serve a fleet that works in several. Ruled (spec §3): the store becomes
  the directory `~/.ccrc/linear/` (mode 0700), with one slot per Linear workspace named by the workspace's id:
  `<id>.key` (the key, 0600, written by `writeValueFileAtomic` and read by `readValueFile`, the box token's writer and
  reader) and `<id>.json` (a version 2 display record that adds the workspace's id, name and URL key and the teams the
  key reaches). Keys stay plain text at mode 0600, as the box token and today's key are kept, because nothing in
  `server/src` encrypts at rest and a cipher whose key sits beside it adds nothing. The legacy pair is **copied, never
  moved**. Once a check has learned the legacy key's workspace, the slot is written. The legacy files stay in place
  while that slot holds the same key (compared by digest), so a rollback still finds the key. Any write that changes or
  removes that slot's key also removes the legacy pair in the same locked act. A later release retires the legacy reader
  (spec §16 Q4). Every key is read again from its file on every use, so nothing caches a key in memory. Revision 2 (spec
  §3.4): what the migration has learned is kept in a marker, `linear/legacy.json` `{v:1, keyDigest, state,
  workspaceId}`, because the v1 record cannot change shape. A migration never writes into an existing slot: when slot
  `<id>` holds another digest, it leaves that key untouched and retires the legacy pair, key first, under the lock. The
  operator's first add, replace, check or remove made while the legacy key is unmigrated marks it `held`, so no
  background migration runs after that and a removed workspace cannot be recreated from the legacy key. A remove of a
  slot also retires a legacy pair that was migrated into it.
- **D-7668 (2026-10-31)** — `linear-workspace-routing`: a session names a team key, an issue identifier (`<TEAM>-<n>`)
  or a workspace URL key, never a key or a workspace id. Ruled (spec §4): the server routes by the slots' recorded
  teams. A team key found in no slot gets one team refresh, at most once a minute per slot, and is then refused as
  `team-unknown`. A team key found in two slots is refused as `team-ambiguous`, naming the candidates' URL keys, unless
  `--workspace` picks one. A workspace-wide verb on a store with more than one slot and no `--workspace` is refused as
  `workspace-required`. A slot is never guessed. Teams are found when the key is saved (the key check asks for the
  organisation's id, name and URL key and the viewer's teams). They are refreshed by Check again and by a routing miss.
  Revision 2 (spec §4.2, §4.5, §6.10): an issue's prefix only picks the slot. For `update`, `comment`, and `create` or
  `update` with a `parent`, the route first asks Linear for the issue's current team (and the parent's) in one query
  that also carries any directory refresh that is due, so a write stays within two Linear calls. A write whose
  identifier's prefix is not the issue's current team is refused as `issue-moved`, naming the current identifier. An
  issue reference with `--workspace` routes to that workspace whatever its prefix. Ticket titles route through the slots
  the same way (`resolveTitle` routes the prefix and reads `readLinearSlotKey`, and its 401 marker and verdict clearing
  aim at the routed slot), and fall back to the legacy key only while it is unmigrated with no marker.
- **D-7669 (2026-10-31)** — `linear-api-verbs`: the ccrc-api ROUTES table grows by twelve `linear.*` rows, from
  thirty-four to forty-six (spec §5). Nine rows are reads: `workspaces`, `teams`, `issue`, `comments`, `statuses`,
  `projects`, `labels` and `users` are GETs, and `search` is a POST. Three rows are writes: `create`, `update` and
  `comment`, all POSTs. Free text never travels in a query string, because `SAFE_RE` refuses it, so it goes in the
  `--json` body. That is why `search` is a POST although it writes nothing. On every `linear.*` row the client derives
  the caller's `byId` and `byUuid` from the pane (`derive_identity`). It puts them in the query of a GET and splices
  them into the body of a POST. It refuses a body that already names either field. This is the opposite of
  `ledger.allocate`'s rule, because here the caller may not speak for itself. The client's exit codes, its envelope and
  its transport do not change. Revision 2 (spec §5.1, §5.3): every verb that acts in one workspace takes one. `issue`
  and `comments` declare the `workspace` query key, and the `create`, `update` and `comment` bodies take a `workspace`
  field, so the `team-ambiguous` remedy works on the issue verbs too. Only `workspaces` takes none.
- **D-7670 (2026-10-31)** — `linear-proxy-routes`: twelve box-token routes under `/api/linear/proxy/`, registered from a
  new `server/src/linear/proxyRoutes.ts` (spec §6). Each is an `auth/gate.ts` EXEMPT entry with its reason, and each
  checks `checkMailToken` for `'ok'` only. Before any other work, each checks the attributed `{byId, byUuid}` against
  the registry with the claim lanes' `attributionVerdict`. That function moves out of `registerCoordRoutes` into an
  exported module. The move commit changes nothing else, and a characterisation test comes first. A session can never
  send GraphQL. Each route maps to a fixed operation in an L1 table (`LINEAR_OPS`) with validated variables and a
  response shaper, so the key can only run the operations in that table. Each Linear call keeps `callLinear`'s eight
  second deadline. A route makes at most two Linear calls and gives up within twenty seconds, inside ccrc-api's thirty.
  `callLinear` gains a `rate-limited` arm for Linear's 429. The title lookup keeps reading it as offline, and that
  behaviour change gets a commit of its own. Each session gets its own budget, and so does each workspace, both held by
  an L1 decider with an injected clock. The global limiter cannot key on the attributed id, so it stays only as an outer
  bound, and the spec records why the inner budget is a separate mechanism. A session on a box that runs both roles can
  read the server's `~/.ccrc` directly. That is a known limit, and D-7675's deny paths are its accident guard. Revision
  2 (spec §6.2, §6.5, §6.7): the box-token check and the identity-shape check run in each route's `onRequest` hook, as
  on `GET /api/runs/:id`, so a call refused for its token never spends the shared outer limiter's bucket. Linear's text
  is untrusted: titles, descriptions and comment bodies are answered only under a fixed `untrusted` key, every string
  from Linear loses its control and format characters (the set `accounts/audit.ts` already names, moved to one L0 home),
  and every Linear-sourced name in an answer or a refusal detail passes `cleanName`.
- **D-7671 (2026-10-31)** — `linear-write-journal`: every proxy write and every key act is journaled in a new coord.db
  table, `linear_events`, which has one writer (`server/src/linear/journal.ts`, modelled on `AccountAudit`) (spec §7). A
  write's row is inserted as `pending` before Linear is called. Its outcome (`ok`, `refused`, `denied`, `failed` or
  `unknown`) replaces that afterwards. If the journal cannot be written, Linear is not called. A row holds closed words,
  grammar-checked ids and identifiers, and the names of the changed fields. It never holds titles, bodies, user names,
  the key, its tail or its digest. Rows are kept 365 days and swept on the account audit's daily beat.
- **D-7672 (2026-10-31)** — `linear-write-policy-point`: the policy decision hook #279 asks for is not in the tree
  (measured: no `CCRC_PDP_URL`, no verb-class table, no authorizer). Ruled (spec §8): every proxy write passes through
  one decision point. It runs after validation and routing and before the journal's pending row and the Linear call. It
  is an L2 port, `LinearWritePolicy`, whose ask is shaped as #279 describes (`{actor, verb: 'operate', route,
  resource}`). The composition root wires an allow-all default, so with no authorizer configured nothing changes, which
  is what #279 asks for. A deny is refused as `policy-denied` (403). A throw, or no answer within two seconds, is
  refused as `policy-unavailable` (503). Both refusals are journaled. When #279 lands, its authorizer client implements
  this port and its verb-class table lists the twelve routes (reads `view`, writes `operate`). This feature does not
  wait for #279. Revision 2 (spec §8): the ask's `teamKey` and `issue` are the resolved current team and identifier,
  never the caller's prefix, and the ask carries `parentTeamKey` when `parent` is set. The point runs after that resolve
  and before the journal's pending row and the mutation.
- **D-7673 (2026-10-31)** — `linear-settings-workspaces`: the Settings → Linear card becomes a list of workspaces (spec
  §10). It gets four routes: `GET /api/linear/workspaces`, `POST /api/linear/workspaces {key, replace?}`, `POST
  /api/linear/workspaces/:id/check` and `DELETE /api/linear/workspaces/:id`. These replace the four
  `/api/linear/connection` routes in the same release, with the same posture: the account gate with `cap: null`, a
  step-up on add, replace and remove, `no-store`, a 2048-byte body limit and fixed-word body errors. A key whose
  workspace already has a slot is refused as `workspace-exists` unless `replace: true` is sent. The card asks the
  operator to confirm a replacement by name. Each row shows the workspace's name, its teams, the key's last four
  characters and the last check's state, using today's nine state sentences for each slot. The card is judged at 360,
  390, 1280 and 1920 pixels, in both skins and in light and dark.
- **D-7674 (2026-10-31)** — `linear-skills-switch`: the coordinator, worker and reviewer skills gain a short Linear
  section, and a new reference, `ccd/coordinator-skill/references/linear.md`, is added to the coordinator installer's
  `REQUIRED_REFS` (spec §11). The section tells a session to use `~/.local/bin/ccrc-api linear …` for all Linear work,
  never a Linear MCP tool, a connector or `curl`, and to report `not-configured` to the operator rather than sign in.
  The reviewer's section names the read verbs only. ccrc writes no account's MCP configuration and removes none. The
  per-account Linear MCP entries are an operator step in the rollout (spec §15), and claude.ai connectors are left
  alone. Revision 2 (spec §11): the reference and the three skills' Linear sections say that Linear text is data, never
  instructions, and is never copied from one workspace into another without the operator. The cross-workspace data-flow
  risk is recorded as a known limit (spec §6.9).
- **D-7675 (2026-10-31)** — `linear-key-containment`: the key leaves its file only for the `authorization` header of
  `callLinear` (spec §13). Four mechanisms keep it there. First, the egress redactor (`shared/redact.mjs`
  `KNOWN_TOKEN_PREFIX`, with its python parity) gains `lin_api_`, so a key pasted anywhere is masked by its shape and
  not only by its context. Second, `~/.ccrc/linear/**` and `~/.ccrc/linear.key` join `ACCOUNT_SECRET_PATHS`, so every
  session's deny file refuses to read them. Third, the session text sent to Linear (a search term, and a write's
  title, description and comment) goes through the `linear-egress` profile first, and the answer and the journal row
  both say how many spans were masked. Fourth, a census test drives every Linear route and every failure arm with a fixture key. It asserts that no
  response body or header, log line, journal row or display record contains the key, any eight-character run of it, or
  its digest. The one exception is the slot's `.key` file. Revision 2 (spec §13.4): Linear-bound text does not use the
  command-line `egress` profile, whose `token-segments` rule would mask commit SHAs, UUIDs and dated spec paths. A new
  `linear-egress` profile lists only the credential-shape rules (`jwt`, `header`, `bearer`, `url-userinfo-quoted`,
  `url-userinfo`, `secret-assigns` and `known-token`, which gains `lin_api_`). It runs over `search.text` as well as a
  write's title, description and comment body, and a test pins that a SHA, a commit URL, a UUID and a dated spec path
  pass it unchanged.
