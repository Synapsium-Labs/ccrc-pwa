# Linear through ccrc: one key per workspace, used by every session through `ccrc-api` (design)

**Spec** · 2026-10-31 · Status: draft for the operator's review. It designs #1444. The operator raised it on
2026-10-25. On 2026-10-31 the operator ruled that sessions reach Linear through a server proxy and `ccrc-api linear …`
verbs, not through an MCP server. Docs only: no code ships with it. Every fact about today's tree was measured on
`origin/main` `46da405e2`. The numbers it needs, D-7667 to D-7675, are defined in
`docs/superpowers/plans/2026-10-31-linear-central-key-ruled.md`.

**Related:** #279 (the policy decision hook; not built, §8), `2026-10-20-named-workspaces-and-linear-tickets-design.md`
(§1.3, §4.2 and §5.1: today's key, client and card), `2026-08-10-architecture-ddd-clean-solid.md` (rings and contexts),
`2026-10-18-accounts-connect-design.md` §3.2 and §3.6 (the account gate and the account audit this design copies).

## In short

The operator wants one Linear mechanism that every fleet session uses: no sign-in per session or per account, no MCP
server, and no key in a session. Today ccrc holds one Linear key, and only the server uses it, to look up ticket
titles. Sessions reach Linear through their own MCP connections, and each needs its own sign-in.

This design makes four changes. The first is the store. Settings → Linear holds **one key per Linear workspace** (a key
reaches one workspace). Each key is verified when it is saved, and the card shows the workspace's name and the teams
the key reaches. The second is the proxy. Sessions call **twelve new `ccrc-api linear …` verbs**, the closed client
they already use for mail. The server routes each call to a workspace by team key or issue prefix, reads that
workspace's key from its file, and runs one operation from a fixed table. No session can send GraphQL. The third is
accountability. Every write is **journaled** with the calling session's id, and it passes **one policy decision
point**, the seam #279's authorizer will plug into. The fourth is removal. Removing a key in Settings stops access at
once, because nothing caches a key: every call reads it from its file.

A fresh session on any account, including one just added or swapped onto, needs nothing new. `ccrc-api`, the box token
and `agent.env` all belong to the box, and `ccrc account add` already installs the skills into the new account's home.

## 1. What is true on `main` today

### 1.1 The key and its record
- **One key per box**, at `~/.ccrc/linear.key` (`cfg.ccrcDir` is `~/.ccrc`, `server/src/config.ts`). It is written by
  `writeValueFileAtomic` (`server/src/token/files.ts`): a temp file opened exclusively at mode 0600, renamed over the
  target, and the directory fsynced. It is read by `readValueFile`, which answers `value`, `absent`, `unusable`,
  `placeholder` or `unreadable`. The environment is never consulted (`server/src/linear/connection.ts#readLinearKey`).
- **Plain text at rest.** Nothing in `server/src` encrypts anything at rest (measured: no cipher call in the tree). The
  box token is kept the same way.
- **The display record** is `~/.ccrc/linear.json`, `{v:1, org, user, keyTail, keyDigest, checkedAt, outcome}`.
  `connection.ts#parseLinearDetails` refuses any other shape. The key is written first and removed first, and every
  writer goes through `connection.ts#withConnectionLock`, which is never held across a call to Linear.
  `connection.ts#recordLinearCheck` writes only while the stored key's digest still equals the digest the check used.
- **Nothing models a workspace or a team.** `shared/linear.ts` is singular throughout (`LinearConnectionView` has nine
  states, one connection).

### 1.2 The client
`server/src/linear/client.ts` is the only outbound path. `callLinear` POSTs to Linear's API origin and GraphQL path,
which are two constants that are never written joined, because `topology-clean.test.ts` refuses that. It sends a bare
`authorization: <key>` header (no `Bearer`; `linear.test.ts` pins it) with `redirect: 'error'` and an eight-second
`AbortController` deadline (`LINEAR_TIMEOUT_MS`). A 401 maps to `unauthorised`, a 403 to `forbidden`, and any other
non-2xx, 429 included, to `unreachable`. Error text is never kept. Two operations exist: `lookupLinearIssue`
(`issue(id:) { identifier title }`) and `verifyLinearKey` (`viewer { name } organization { name }`). Nothing queries
teams.

### 1.3 Routes and the card
`server/src/linear/routes.ts#registerLinearRoutes` serves five session-gated routes: `GET /api/linear/resolve` and four
on `/api/linear/connection`. `PUT` and `DELETE` take the account gate (`server/src/accounts/gate.ts`) with `cap: null`
and a step-up (D-5511, D-5512). All five send `no-store`. Each request reads the key from disk again. The card is
`pwa/src/screens/LinearSection.tsx`, which reads through `pwa/src/fleet/useLinearConnection.ts`. It is mounted in
`pwa/src/screens/settings/SecuritySection.tsx` after Box token, and its copy is `SETTINGS_CARDS.security.linear` in
`pwa/src/fleet/settingsText.ts`. That copy's purpose line talks only about ticket titles.

### 1.4 How a session reaches the server
- **`ccd/ccrc-api`** is a closed bash client installed at `~/.local/bin/ccrc-api` by `deploy/deploy.sh`. Its `ROUTES`
  table has thirty-four rows, a count that `server/test/ccrc-api.test.ts` scans in prose. It takes no URL, host or path
  argument. Ids and query values must match `SAFE_RE` (`^[A-Za-z0-9_-]+$`), and only a `--json` body carries free text.
  The address comes from `~/.ccrc/agent.env`. The box token comes from `~/.cc-secrets/ccrc-mail.token` and rides
  curl's stdin as `x-ccrc-mail-token`, never its argv. Exit 0 means a response arrived, 2 a local refusal and 3 no
  response.
- **Identity is attribution.** `derive_identity` reads the session id from the tmux pane (`TMUX_PANE`, then the
  session name `cc-<id>`) and the uuid from `~/.cc-sessions/<id>.uuid`. Some rows splice these into the body
  (`runs.open`) or the query (`approvals.show`, `asks.list`).
- **The server's checks.** `auth/gate.ts`'s `EXEMPT` table lets the box-token lanes past the cookie gate, each with a
  written reason. The handlers then call `checkMailToken` (`server/src/coord/token.ts`), which answers `ok`, `legacy`,
  `bad` or `unconfigured`, and refuse anything but `ok`. Attribution is checked by `attributionVerdict`, a closure inside
  `registerCoordRoutes` (`server/src/coord/routes.ts`). It refuses an unknown sender or a stale uuid, and answers
  `registry-unmeasurable` when the registry cannot be read.

### 1.5 What a session can forge, and what it cannot
The token belongs to the box: every session runs as the same UNIX user and can read it
(`deploy/ccrc-mail.token.example` says so). A session can present a neighbour's id and uuid, because every `.uuid` is
readable, or set `TMUX_PANE` to another pane. A session cannot change the server address or the route, reach a route
that has no row, pass with a wrong or absent token, present a uuid the registry does not hold, or read the server's
`~/.ccrc` on a split deployment: the agent whitelist (`agent/src/whitelist.ts`) exposes neither `.ccrc` nor
`.cc-secrets`. So the session id in a journal row is **trusted attribution**, not proof of identity. That is the same
standing as the sender on a mail row.

### 1.6 The policy hook, the skills and the redactor
- **#279 is open and unbuilt.** The tree has no `CCRC_PDP_URL`, no verb-class table and no authorizer (measured). The
  coordinator-first approvals guard (`server/src/coord/approvalguard.ts`) rules on permission prompts, which is a
  different thing.
- **The skills never mention Linear.** In `ccd/coordinator-skill`, `ccd/worker-skill` and `ccd/reviewer-skill`, the
  only hits are the GitHub rule named "required linear history". The per-account Linear MCP entries live in each
  account's Claude Code configuration on the box. Nothing in this tree writes them.
- **The egress redactor** (`shared/redact.mjs`) has no Linear prefix in `KNOWN_TOKEN_PREFIX`. A Linear key is masked
  only by context (an authorization header, a `KEY=`/`TOKEN=` assignment, a `--key` or `--token` flag) or by the
  generic long-run rule.

## 2. Intent, goals, non-goals, anti-goals

**Intent.** The key the operator gives ccrc is how the whole fleet works with Linear: one place to set it, one place to
remove it, and no session ever holding it.

**Goals.**
1. Settings holds several keys, one per Linear workspace. Each is verified on save and shown with its workspace name
   and its teams.
2. Any session can list, search, read, create and update issues, comment, and read statuses, projects, labels, teams
   and users, through `ccrc-api linear …`, in every configured workspace, with no sign-in.
3. The server picks the workspace from a team key or an issue prefix. It refuses an ambiguous or unknown team and never
   guesses one.
4. The key never reaches a session, a response, a log line or a journal row.
5. Every write is journaled with the calling session's id and passes one policy decision point.
6. Removing a key stops access with the next call.
7. This survives restarts, account swaps and newly added accounts, with nothing installed per account.

**Non-goals.** Per-session credentials. The box token stays one per box, so attribution stays what it is today (§1.5).
Linear features beyond the twelve verbs (cycles, documents, attachments, initiatives, webhooks). A screen for reading
the journal (§16 Q3). Any change to claude.ai connectors, which the CLI cannot manage. OAuth applications.

**Anti-goals.** A raw GraphQL passthrough, or any verb that takes a query document. A session-side cache of a key or a
token. An MCP server, which the operator ruled out on 2026-10-31. A second fetch path beside `callLinear`. A second key
reader beside `readValueFile`. ccrc editing any account's MCP configuration.

## 3. The key store (D-7667)

### 3.1 Layout
`~/.ccrc/linear/` is created at mode 0700 by the first write. Each workspace has one **slot**, named by the Linear
workspace's id. The id is a UUID that Linear returns for `organization { id }`, and it is checked against a UUID pattern
before it becomes a file name.

| file | what it holds | written by | read by |
|---|---|---|---|
| `<id>.key` | the key, one line, mode 0600 | `writeValueFileAtomic` | `readValueFile`, on every use |
| `<id>.json` | the display record, version 2 (below) | `writeValueFileAtomic` | `parseLinearStoreRecord`, on every use |

The record is `{v:2, workspaceId, name, urlKey, user, teams:[{id, key, name}], teamsAt, keyTail, keyDigest, checkedAt,
outcome}`. `name`, `user` and team names pass through `cleanName`, which caps them at 80 characters. `urlKey` must match
`^[a-z0-9][a-z0-9-]{0,63}$`. A team key must match `^[A-Z][A-Z0-9_]{0,15}$` after it is uppercased. At most 500 teams are
kept. `outcome` keeps today's four words (`LINEAR_CHECK_OUTCOMES`). The record is never a credential, and of the key it
carries only the tail and the digest. The digest stays on the server's side of the wire, as it does today.

Only a `.key` file makes a slot. A `.key` with no `.json` beside it is `details-unknown`, as today. A `.json` with no
`.key` is no slot: it is shown nowhere, and the next locked write in the directory deletes it. That is how a crash
between a remove's two deletions finishes, the same rule as today's Disconnect.

### 3.2 Reading
- `readLinearStore(ccrcDir)` lists the directory and answers `{kind:'listed', slots}` or `{kind:'unreadable', code}`. A
  missing directory is an empty list. Each slot carries its key's read kind and digest, measured, never the key itself.
  It also carries its record's read, which is `details`, `absent`, `unreadable` or `malformed`, as today. The Settings
  list and the router use it.
- `readLinearSlotKey(ccrcDir, id)` returns a `LinearKeyRead` for one slot. The proxy calls it once per Linear call, at
  the moment it is needed. **No key is held in memory past the call that uses it.**
- `connection.ts#withConnectionLock` stays the one lock, for the whole directory and the legacy pair. It is held for
  file work only.

### 3.3 Writing
Add, replace, check and remove keep today's order and race rules, one slot at a time: the key is written first and
removed first. A check result is recorded only while the slot's key still has the digest that was checked. A Linear
401 marks the slot rejected through `markLinearRejected`'s rule, with the slot named. A success clears a stale verdict
through `clearLinearVerdict`'s rule. The functions take a slot id. They do not grow a second copy.

### 3.4 The existing key migrates without loss
The legacy pair (`linear.key`, `linear.json` v1) is **copied into a slot, never moved**:

1. **Trigger.** The legacy key is checked by Check again on its row, or by the first Settings list read that finds it
   with no slot holding the same digest. That second trigger is a background check, one at a time, that the read does
   not wait for.
2. **Check.** Outside the lock, the extended key check (§4.1) learns the workspace's id, name, URL key and teams.
3. **Write.** Inside the lock, the legacy key is read again. If its digest still matches, `linear/<id>.key` and then
   `linear/<id>.json` are written. **The legacy files are left in place.**
4. **Dedupe.** While a slot holds a key with the legacy key's digest, the store does not show the legacy pair. So a
   rollback to an older build still finds `linear.key`, and the same key is used either way.
5. **Writes keep them in step.** Inside the same lock, any replace or remove of a slot whose old digest equals the
   legacy key's digest also removes the legacy pair, key first. A key the operator removed can therefore never come
   back through the legacy file, on this build or an older one.
6. **Until it is checked.** A legacy key that cannot be checked yet (Linear unreachable, or the key rejected) stays a
   legacy row with today's v1 states. Title lookups keep using it exactly as today. The proxy does not route to it,
   because it has no teams: a call answers `not-configured`, whose detail says to open Settings → Linear.

A later release deletes the legacy reader, once the operator has seen every box migrate (§16 Q4).

### 3.5 At rest and on screen
- **At rest:** plain text, mode 0600 in a 0700 directory, owned by the server's user. This matches the box token and
  today's key. Encrypting the file with a key kept beside it would add no protection against the one reader who matters
  (the same user), and it would add a second secret to lose. No backup or snapshot in the tree names `linear.key`
  (measured: no hit outside `server/src/linear`). The build measures again that none copies `~/.ccrc/linear/`.
- **Masking:** the wire carries `keyTail` (the last four characters) and nothing else of a key. The digest never
  leaves the server. The PWA's field is `type=password`, held in component state only, and cleared on Connect and when
  the page is hidden, as today.

## 4. Workspace routing (D-7668)

### 4.1 Learning a workspace's teams
The key check becomes one query:
`viewer { name } organization { id name urlKey } teams(first: 250) { nodes { id key name } pageInfo { hasNextPage endCursor } }`.
It follows up to two more pages for a workspace with more teams. The `teams` connection answers only the teams the key's
user can reach, which is exactly what the card should show. The check runs on add, on replace, on Check again and on a
routing miss (below). `teamsAt` records when it last ran.

### 4.2 The routing rule (L1, `server/src/linear/route.ts`, pure)
The input is what the call names. An issue reference (`AAA-12`) gives its prefix as the team key. `--team` (or a body's
`team`) is a team key. `--workspace` (or a body's `workspace`) is a URL key. The output is one slot, or a refusal word:

| the call names | slots matching | answer |
|---|---|---|
| a team, or an issue prefix | exactly one | that slot |
| a team, and a workspace | the workspace's slot holds the team | that slot |
| a team, and a workspace | the workspace's slot lacks the team | `team-unknown` (404) |
| a team | two or more | `team-ambiguous` (409); the detail lists the candidates' URL keys |
| a team | none | a refresh (below), then `team-unknown` (404) |
| a workspace only | one | that slot |
| a workspace only | none | `workspace-unknown` (404) |
| neither (a workspace-wide verb) | the store has one slot | that slot |
| neither | the store has several | `workspace-required` (409) |
| anything | the store has none | `not-configured` (501) |

Team keys are compared after uppercasing. A team key can repeat across Linear workspaces, which is why the ambiguous
row exists. The router never picks the first match.

### 4.3 Refresh on a miss
When a team matches no slot, the route refreshes the teams of every slot whose `teamsAt` is more than sixty seconds old.
It runs one refresh per slot at a time, outside the lock, and records the result under the lock by the digest rule. Then
it routes once more. A team renamed in Linear, or added since the key was saved, is found this way. A miss that a refresh
does not cure is refused, and nothing is guessed. The budget in §6.7 limits how often a session can force a refresh.

### 4.4 Names inside a workspace
Sessions name states, labels, projects and users by their names, never by Linear's ids. The server resolves each name
from that workspace's directory. The directory holds the team's workflow states, the workspace's labels and projects,
and its active users. It is cached in memory for ten minutes, keyed by slot id and key digest, so a replaced key drops
the cache, and it is refreshed once on a miss. Names are matched without regard to case. A name that matches two
entries is refused as `name-ambiguous` (409), and the detail lists the matches. A name that matches nothing is refused
as `name-unknown` (404). `assignee: "me"` means the key's own user. The directory holds no secret, and it is the only
cache in this design.

## 5. The `ccrc-api linear` verbs (D-7669)

### 5.1 The rows
Twelve rows join `ROUTES`, so the table goes from thirty-four rows to forty-six:

| verb | row | id | query keys | class |
|---|---|---|---|---|
| `linear workspaces` | `GET /api/linear/proxy/workspaces` | no | `-` | read |
| `linear teams` | `GET /api/linear/proxy/teams` | no | `workspace` | read |
| `linear issue <REF>` | `GET /api/linear/proxy/issues/{id}` | yes | `-` | read |
| `linear search --json <f>` | `POST /api/linear/proxy/issues/search` | no | `-` | read |
| `linear comments <REF>` | `GET /api/linear/proxy/issues/{id}/comments` | yes | `limit,after` | read |
| `linear statuses` | `GET /api/linear/proxy/statuses` | no | `team,workspace` | read |
| `linear projects` | `GET /api/linear/proxy/projects` | no | `team,workspace,limit,after` | read |
| `linear labels` | `GET /api/linear/proxy/labels` | no | `team,workspace` | read |
| `linear users` | `GET /api/linear/proxy/users` | no | `workspace,limit,after` | read |
| `linear create --json <f>` | `POST /api/linear/proxy/issues` | no | `-` | write |
| `linear update <REF> --json <f>` | `POST /api/linear/proxy/issues/{id}` | yes | `-` | write |
| `linear comment <REF> --json <f>` | `POST /api/linear/proxy/issues/{id}/comments` | yes | `-` | write |

`<REF>` is an issue identifier such as `AAA-12`, which already satisfies `SAFE_RE`. The server checks it again against
`^[A-Za-z][A-Za-z0-9_]*-[0-9]{1,9}$`. **Free text never travels in a URL.** A search term, a title, a description or a
comment is refused by `SAFE_RE` as a query value, so it goes in the `--json` body. That is why `search` is a POST
although it writes nothing. Its class is read, and the server, not the method, decides the class (§6.4).

### 5.2 Identity on every row
On each `linear.*` row the client runs `derive_identity`. On a GET it appends `byId=<id>&byUuid=<uuid>` to the query,
as `approvals.show` builds `fromId`/`fromUuid`. On a POST it splices `byId` and `byUuid` into the body with
`splice_body_field`. **It refuses a body that already names `byId` or `byUuid`**: `bad-body`, exit 2, nothing sent.
This is the opposite of `ledger.allocate`, which honours a caller's `byId`. Here the caller may not choose whom a write
is attributed to through this client. Neither field is a declared query key, so `--byId` is refused as `unknown-query`.
A pane that cannot derive an identity is refused locally, as `runs.open` is today.

### 5.3 Bodies
Every body is a JSON object. The server's L1 validator (`LINEAR_OPS`, §6.4) refuses unknown fields by name, so a typo
is `bad-field`, never silently dropped.

- **search** `{workspace?, team?, text?, state?, assignee?, label?, project?, includeArchived?, limit?, after?}`. `text`
  is at most 256 characters. With no `team` and no `workspace`, the routing table's workspace-wide rows apply. `limit`
  runs from 1 to 50 and defaults to 25.
- **create** `{team, title, description?, state?, priority?, assignee?, labels?, project?, parent?, requestId?}`.
  `title` is 1 to 255 characters. `description` is markdown, at most 64 KiB. `priority` is 0 to 4. `labels` holds at
  most 20 names. `parent` is an issue reference in the same workspace. `requestId` is a UUID the caller chooses so that
  a retry cannot create the same issue twice (§6.6).
- **update** `{title?, description?, state?, priority?, assignee?, labels? | (addLabels?, removeLabels?), project?,
  parent?}`. At least one field is required. `labels` replaces the set and cannot be combined with
  `addLabels`/`removeLabels`. `assignee: null` unassigns. Moving an issue to another team is not in this version.
- **comment** `{body}`, markdown, 1 byte to 16 KiB.

### 5.4 Answers
The envelope is the one every route uses: `{ok:true, …}` or `{ok:false, error, detail}`.

- **An issue** is `{identifier, title, url, workspace, team, state:{name, type}, priority, assignee, labels:[name],
  project, parent, description, descriptionTruncated, createdAt, updatedAt}`. `workspace` is the URL key and `team` is
  the team key. `assignee`, `project` and `parent` are a name, a name and an identifier, or null. Descriptions longer
  than 64 KiB are cut at a character boundary and flagged.
- **A list** is `{ok:true, items:[…], next}`. `next` is an opaque cursor that the server encodes as base64url without
  padding, so it satisfies `SAFE_RE` and comes back as `--after`. It is null on the last page.
- **comments** items are `{author, body, createdAt}`. **users** items are `{name, displayName, active}`. Email addresses
  are not shaped in, so they never reach a transcript. **teams** items are `{workspace, key, name}`. **workspaces**
  items are `{workspace, name, teams:[key], state}`, where `state` is the slot's view state from §10.2.
- **A write** answers `{ok:true, issue}` (create and update) or `{ok:true, comment:{createdAt}}`, plus
  `masked:<n>` when the egress redactor changed the text sent (§13).

### 5.5 Exit codes
These are unchanged: 0 means a response arrived (read `ok`), 2 a local refusal, 3 no response. Every refusal is the
JSON envelope on stdout, and stderr ends `http <code>`, as today.

## 6. The server's proxy routes (D-7670)

### 6.1 Where they live
The twelve routes are registered by `registerLinearProxyRoutes(app, deps)` in a new `server/src/linear/proxyRoutes.ts`
(L4), wired in `server.ts` beside `registerLinearRoutes`. The decisions are L1 and pure: `server/src/linear/ops.ts`
(the operation table, validators and shapers), `route.ts` (the routing rule) and `budget.ts` (the rate decider). The
store and the journal are L3. `linear/**` is in C4 in the architecture table, and §16 Q5 asks whether it should stay
there.

### 6.2 Authentication, exactly as the mail path
Each route is an `auth/gate.ts` EXEMPT entry, with a reason in the box-token lanes' words: the caller is a session's
`ccrc-api`, which has no cookie jar. Each handler first calls `checkMailToken(deps.mailToken, req.headers[MAIL_TOKEN_HEADER],
route)` and refuses anything but `'ok'` with 401 `unauthenticated`. No legacy tolerance, and no cookie alternative: the
PWA never calls these routes.

The **calling session** is the `{byId, byUuid}` pair the client derived from the pane (§5.2). The server checks it
with `attributionVerdict`, so a session the registry does not know is refused `unknown-sender` (403), a uuid that does
not match is refused `stale-uuid` (403), and an unreadable registry is `registry-unmeasurable` (502). The journal records
only the id the registry vouched for. Because the token belongs to the box (§1.5), this is trusted attribution, not
proof of identity, and the journal says nothing stronger. **`attributionVerdict` moves** out of `registerCoordRoutes`
into an exported `server/src/coord/attribution.ts`, rather than being copied. A characterisation test of its four answers
lands green on `main` first. The move commit changes only imports.

### 6.3 The order of checks
1. Box token. 2. The identity fields' shape. 3. Attribution. 4. The session's budget (§6.7). 5. The body and query
   against the operation's validator. 6. Routing (§4.2). 7. For a write: the policy decision point (§8). 8. For a
   write: the journal's `pending` row (§7). 9. The workspace's budget. 10. The slot's key, read from its file. 11. Name
   resolution from the directory. 12. The Linear call or calls. 13. Shaping. 14. For a write: the journal's outcome.

A refusal at any step answers at once, and nothing after it runs. Steps 1 to 6 cost no Linear call. A write refused at
step 7, or at steps 9 to 11, still gets a journal row (§7). A refusal at step 8 means the journal itself failed.

### 6.4 An allow-list of operations, never a passthrough
`LINEAR_OPS` in `ops.ts` is one table with one row per verb: `{op, class:'read'|'write', document, variables(input,
directory) → vars, shape(data) → answer}`. `document` is a fixed GraphQL string written in this file. No route accepts a
query document, a field list, an operation name or a variable that a row does not build. So the key can run exactly the
operations in this table. A write row's document is a single mutation: `issueCreate`, `issueUpdate` or `commentCreate`.
A census test reads the table and holds two things. Every document is one of the table's own constants, and every
mutation appears only in a `write` row. A route's class comes from its row, never from its HTTP method.

### 6.5 Shaping
Each `shape` picks only the fields §5.4 names, from the shape asked for, and anything else is `malformed`. Linear's
text (titles, names, descriptions, comment bodies) is passed through, because it is what the session asked to read.
Control characters are stripped, and the bounds in §5.4 are applied. Nothing secret can be in a response, because the
key never enters the shaped data. The census in §13 checks that anyway.

### 6.6 Deadlines and retries
Each Linear call keeps `callLinear`'s eight-second deadline. A route makes at most two Linear calls (a directory refresh
and the operation) and stops before starting a second call when fewer than eight seconds of its twenty-second budget
remain. That keeps every answer inside `ccrc-api`'s thirty-second `curl -m 30`. A write that times out after it was sent
answers `timeout` (503), with a detail saying the change may have happened and the issue should be read before a retry.
Its journal row says `unknown`. For create, the server passes `requestId` as the new issue's id, so a retry with the same
`requestId` cannot make a second issue. The build checks against Linear's schema that the create input accepts a
caller-chosen id. If it does not, `requestId` is dropped from the body and the timeout's answer is the only guard.

### 6.7 Rate limits
Two budgets, decided by `budget.ts` (L1: token buckets as pure state transitions with an injected clock, held in a map
by the L4 route file):

- **Per session:** 60 calls a minute, of which at most 20 can be writes. Over budget, the answer is `rate-limited` (429)
  with `Retry-After`.
- **Per workspace:** 600 calls a minute across the fleet, under the hourly limits Linear sets for each key. A Linear 429
  is refused as `rate-limited` with Linear's `Retry-After` when it sends one.

The existing `@fastify/rate-limit` registration is global and constant-keyed by design (`server.ts`; it never reads
`req.ip`). It runs on `preHandler`, before the attributed session id has been checked, so it cannot key on that id.
The routes still opt into it, with `{max: 1200, timeWindow: '1 minute'}`, as an outer bound. The per-session budget is a
second mechanism for a recorded, legitimately different reason: its key is a fact that is only measured inside the
handler. **`callLinear` gains a `rate-limited` arm for a 429.** Today a 429 is `unreachable`. `lookupLinearIssue` and
`resolve.ts` read the new arm as they read `unreachable` (the offline title), and the PWA's `LOOKUP_NOTE` gets its
sentence. That intended behaviour change is a commit of its own, and it changes the 429 row in `linear.test.ts`.

### 6.8 Failure words
Every refusal is a fixed word from `shared/refusal.ts`, with its status in one place. A detail never carries Linear's
response text.

| word | status | when |
|---|---|---|
| `unauthenticated` | 401 | box token missing or wrong |
| `unknown-sender`, `stale-uuid` | 403 | attribution |
| `registry-unmeasurable` | 502 | attribution could not be measured |
| `bad-request`, `bad-field` (new) | 400 | the body or query fails its validator; the detail names the field |
| `team-unknown`, `workspace-unknown`, `name-unknown` (new) | 404 | §4 |
| `team-ambiguous`, `workspace-required`, `name-ambiguous` (new) | 409 | §4 |
| `not-found` | 404 | Linear has no such issue |
| `not-configured` | 501 | no slot, or the routed slot's key is absent, unusable, a placeholder or unreadable |
| `policy-denied` (new) | 403 | §8 |
| `policy-unavailable`, `journal-unavailable` (new) | 503 | §8, §7 |
| `linear-unauthorised` (new) | 502 | Linear answered 401: the stored key is bad, and the slot is marked rejected |
| `linear-forbidden` (new) | 403 | Linear answered 403, or refused the operation for the key's permissions |
| `linear-invalid` (new) | 422 | Linear refused the input; the detail names a field from the operation's closed list when Linear names one |
| `rate-limited` | 429 | §6.7 |
| `timeout`, `unreachable`, `malformed` | 503 | as today |

When Linear answers 200 with a GraphQL `errors` array, the server maps the error's code, from a closed table built from
recorded fixtures during the build, to `linear-forbidden`, `linear-invalid` or `not-found`. Anything else is
`unreachable`. Linear's message is never forwarded.

### 6.9 Known limits
- **A box that runs both roles.** On a `CCRC_ROLE=both` box, the server's `~/.ccrc` is the sessions' own home, so a
  session can read `~/.ccrc/linear/*.key` directly. The deny paths in §13 are an accident guard, not a wall. On the
  two-box deployment the agent whitelist keeps `.ccrc` out of reach.
- **A session holding the box token** can call these routes with any HTTP client, and can name a neighbour. That is
  §1.5's standing, unchanged by this design.

## 7. The write journal (D-7671)

A new coord.db migration adds `linear_events`. Its one writer is `LinearJournal` in `server/src/linear/journal.ts`,
modelled on `AccountAudit` (`server/src/accounts/audit.ts`): it is handed the process's one coord.db handle, checks
every value at run time, and answers a refused or failed write rather than throwing.

| column | grammar |
|---|---|
| `id`, `at` | integer key, epoch ms |
| `sessionId`, `sessionUuid` | the attributed pair (SAFE_RE); null on a key act |
| `actor` | `actorOf`'s device label and id-hash prefix on a key act; null on a session write |
| `workspaceId` | a slot id (UUID), or null when routing refused before a slot was chosen |
| `teamKey` | the team key grammar, or null |
| `op` | `create`, `update`, `comment`, `key-add`, `key-replace`, `key-remove` or `key-check` |
| `target` | an issue identifier, or null (before a create answers) |
| `result` | the created issue's identifier, or null |
| `fields` | the names of the changed fields, comma-separated, from the operation's closed list |
| `outcome` | `pending`, `ok`, `refused`, `denied`, `failed` or `unknown` |
| `code` | the refusal word when the outcome is not `ok` |
| `masked` | the count of spans the redactor masked (§13) |
| `decisionId` | the policy decision's id when the point returned one (§8), else null |

- **Before and after.** A write's row is inserted `pending` after the policy decision and before the key is read. Its
  outcome replaces `pending` when the route answers. A server that dies mid-call leaves `pending`, which reads as
  "outcome unknown", the truth. A journal insert that fails refuses the write with `journal-unavailable` (503), and
  Linear is never called. "Every write is journaled" is a precondition here, not a best effort.
- **Refusals too.** A write refused at the policy point (`denied`), or at steps 9 to 11 (`refused`), gets a row. A write
  refused before routing (steps 1 to 6) is answered and gets no row, because no workspace is involved and the request
  had not shown it was a well-formed write.
- **No free text.** The table has no column for a title, a body, a name, the key, its tail or its digest. The census in
  §13 reads every row the tests write.
- **Kept 365 days**, swept by `index.ts`'s existing daily beat beside `accountAudit.sweep`. Reads are not journaled. v1
  ships no screen for the journal (§16 Q3); on the box it is read with `sqlite3`.

## 8. The policy decision point on writes (D-7672)

#279 asks for a generic external-authorizer callout and is not built (§1.6). This design does not wait for it. It adds
the **decision point** for Linear writes, shaped so #279's authorizer plugs in without changes here.

```ts
// server/src/linear/policy.ts (L2, declared by its consumer, the proxy route file)
export interface LinearWriteAsk {
  actor: { kind: 'session'; id: string; uuid: string };
  verb: 'operate';
  route: string;                       // the matched route pattern
  resource: { workspaceId: string; teamKey: string; issue: string | null; op: 'create' | 'update' | 'comment' };
}
export type LinearWriteDecision =
  | { allow: true; decisionId: string | null }
  | { allow: false; why: 'denied' | 'unavailable'; decisionId: string | null };
export type LinearWritePolicy = (ask: LinearWriteAsk) => Promise<LinearWriteDecision>;
```

- **Where it runs:** step 7 of §6.3, after validation and routing (so the resource is known) and before the journal row
  and any Linear call.
- **Fails closed:** the route wraps the call in a two-second deadline. A deny is refused as `policy-denied` (403). A
  throw, a timeout or an answer of any other shape is `policy-unavailable` (503). Both refusals are journaled, with
  `decisionId` when one came back.
- **The default:** `index.ts` wires `allowAll`, which answers `{allow: true, decisionId: null}`. #279's own rule is that
  without the hook configured, behaviour is unchanged.
- **When #279 lands:** its authorizer client implements `LinearWritePolicy`, and its verb-class table classifies the
  twelve routes (the nine reads as `view`, the three writes as `operate`). #279's contract test, that every route is
  classified, then covers them. Reads get no decision point in this version. #279's resource filter for listings is its
  own work.
- **The key's own permissions are already a policy.** A Linear key can be created with read-only access, or for some
  teams only. A workspace whose key is read-only is read-only to the fleet: writes answer `linear-forbidden`.

## 9. Removing a key stops access at once

- `DELETE /api/linear/workspaces/:id` removes `<id>.key` first, inside the lock. The proxy reads the slot's key from
  its file at step 10 of every call, so the **next call after the delete returns** finds no key and answers
  `not-configured`. Routing still finds the team until `<id>.json` is gone a moment later, so that answer is
  `not-configured`, not a guess at another slot.
- **No copy of a key exists anywhere else.** It is not in a session, the agent, an environment variable, a module-level
  variable or a directory cache. The cache in §4.4 is keyed by digest and holds no key.
- **A call already in flight** may finish with the key it read before the delete. Its Linear call is at most eight
  seconds long. That is stated, not hidden: the delete stops every call that starts after it.
- Replacing a key behaves the same way: the next call reads the new key.

## 10. Settings → Linear (D-7673)

### 10.1 Routes
These are session-gated, not EXEMPT, take no box token, and send `no-store`. They are registered in `linear/routes.ts`,
replacing the four `/api/linear/connection` routes in the same release. `GET /api/linear/resolve` stays.

| route | gate | body | answer |
|---|---|---|---|
| `GET /api/linear/workspaces` | session | — | `{ok:true, store, workspaces:[LinearWorkspaceView], legacy}` |
| `POST /api/linear/workspaces` | account gate, `cap: null`, step-up | `{key, replace?}` | the list; `added` or `replaced` names the slot |
| `POST /api/linear/workspaces/:id/check` | session | — | the list |
| `DELETE /api/linear/workspaces/:id` | account gate, `cap: null`, step-up | — | the list |

- **Add verifies before it stores**, as Connect does today: the shape check (`isLinearKeyShape`), then the extended key
  check (§4.1), then the write under the lock. If the key's workspace already has a slot, the answer is
  `workspace-exists` (409), naming the workspace, unless `replace: true` is sent. The card then asks *Replace the key
  for **<name>**?* and sends the request again.
- The body limit (2048), the fixed-word body errors (`bodyError`), and the refusal words `bad-key`, `key-rejected`,
  `key-forbidden`, `timeout`, `unreachable`, `malformed` and `write-failed` are kept as today.
- `:id` must match the UUID pattern before anything reads the disk.
- A cached older PWA that asks for `/api/linear/connection` after the release gets a 404. Its card shows its "couldn't
  read" state until the service worker updates, which the update path already does.

### 10.2 What a row shows
`LinearWorkspaceView` is today's per-key view (§1.1's nine states), carried per slot: `{id, name, urlKey, user, teams:
[{key, name}], keyTail, checkedAt} & LinearConnectionView`. The `state` words are unchanged, so each state keeps its
sentence and its remedy. `store: 'ok' | 'unreadable'` covers a directory that cannot be listed (permissions), and
`legacy` is the unmigrated v1 view or null (§3.4).

| row state | sentence (shortened) | controls |
|---|---|---|
| connected | **<name>** as **<user>** · key ending `…4f2c` · checked 3 min ago · teams `AAA` `BBB` … | Check again, Remove |
| key rejected | Linear rejected this key; sessions can't use **<name>** until it is replaced | Replace key, Remove |
| key forbidden | Linear refused the last check; the key may lack access | Check again, Replace key, Remove |
| unreachable | Couldn't reach Linear at the last check | Check again, Remove |
| details unknown / unreadable / unusable / placeholder | today's sentences | today's controls |
| legacy, not yet checked | A key saved before workspaces; checking it… | Check again, Remove |

The card's foot always has **Add a workspace**: a password field, then Add. The card's purpose line changes to: *Linear
keys let every session on this fleet read and write Linear through ccrc, and show real ticket titles. Add one key for
each Linear workspace. Sessions never see a key.* The scope stays `SETTINGS_SCOPE.box`. The note about read access in
the old not-connected sentence becomes: *A read-only key lets sessions read but not write.*

### 10.3 Every width
These are judged in a new `pwa/browser/linear-workspaces.browser.test.ts` at the widths `accounts-open.browser.test.ts`
uses (360, 390, 1280 and 1920), in both skins, in light and dark, with one, three and twelve workspaces and with a
workspace of forty teams.

| | phone (360, 390) | laptop (1280) | wide (1920) |
|---|---|---|---|
| card | the Settings column's full width | the Settings column | the same column; the card does not stretch |
| row head | the name on its own line, the state sentence below | name and state on one line, controls right-aligned on that line | as laptop |
| teams | chips wrap under the head; the first eight, then *+N more*, which expands | chips wrap; the first sixteen, then *+N more* | one line when they fit, else wrap; *+N more* past twenty-four |
| key tail and checked time | one line, which wraps at a word | one line | one line |
| controls | a full-width row of buttons under the row; each at least 44 px tall | inline buttons | inline buttons |
| add a workspace | the field full-width, Add below it | the field and Add on one line | as laptop |
| replace confirm | a sheet | a dialog | a dialog |

No text is truncated with an ellipsis. A long workspace name wraps. The test checks that no horizontal scroll appears at
any of the widths, that every control is reachable by keyboard, and that the key field is empty after Add and after the
page is hidden.

## 11. Skills, docs and the MCP switch-over (D-7674)

- **`ccd/coordinator-skill/references/linear.md`** (new) gives the verbs, their bodies, the answers, every refusal word
  with what to do about it, and four worked examples: read an issue, search a team, create an issue with labels, and
  move an issue's state and comment on it. It is added to `REQUIRED_REFS` in `ccd/install-coordinator-skill.sh`. The
  worker skill points at it, as it already points at the coordinator's other references.
- **The coordinator and worker `SKILL.md`** each get a short *Linear* section. It says: use `~/.local/bin/ccrc-api linear
  …` for all Linear work. Never use a Linear MCP tool, a connector or `curl` for Linear. On `not-configured`, tell the
  operator which workspace is missing a key in Settings → Linear; never start a sign-in. On `team-ambiguous`, pass
  `--workspace`. On `rate-limited`, wait for `Retry-After`.
- **The reviewer skill** names the read verbs only: `issue`, `comments` and `search`.
- **The closed-table parity test** (`ccrc-api-closed.test.ts`) reads every executable command in the corpora, so each
  example in the new text must map to a row. That is the check that the docs and the table agree.
- **README:** the `ccrc-api` passage gains one paragraph on the `linear` group and one line on Settings → Linear. The
  README has no Linear passage today (measured).
- **The MCP entries.** ccrc never wrote the per-account Linear MCP server entries and does not remove them. Removing
  them is a step in the rollout (§15), done by the operator in each account's configuration once the verbs are verified.
  claude.ai connectors are left alone (§16 Q2). With the skills switched, a session that still sees a Linear MCP tool is
  told not to use it.

## 12. Account add, swap and restart

- **A just-added account** needs nothing new. `ccrc-api` is installed once per box at `~/.local/bin`. The box token and
  `~/.ccrc/agent.env` are in the one UNIX user's home, not in any account's `CLAUDE_CONFIG_DIR`. `ccrc account add`
  already installs the coordinator, worker and reviewer skills into the new home (`_acct_provision` in `ccd/ccrc`), and
  doctor's `skills` check converges any home that missed them.
- **A swap** keeps the session's id and pane. `ccrc-api` derives the identity again on every call, so a uuid rotated by
  `/clear` is read fresh, and nothing is cached across the swap.
- **A restart** loses only the directory cache and the budgets' buckets. Keys and teams are read from disk, and the
  journal is in coord.db.

## 13. Keeping the key out of everything (D-7675)

1. **One path out.** The key goes from `<id>.key` through `readValueFile` to `callLinear`'s `authorization` header, and
   nowhere else. No route returns it or its digest. No log line prints it: the server runs with `logger: false`, and the
   Linear modules warn with fixed words only. No journal column can hold it.
2. **The redactor learns its shape.** `lin_api_` joins `KNOWN_TOKEN_PREFIX` in `shared/redact.mjs`, in the `egress` and
   `docs` profiles, with its python `REDACT_RULES` row (`docs-parity.test.ts` pins the parity). A key a session pastes
   anywhere the redactor runs is masked by its shape and not only by its context.
3. **The deny file refuses the store.** `~/.ccrc/linear/**` and `~/.ccrc/linear.key` join `ACCOUNT_SECRET_PATHS`
   (`shared/api.ts`), so every session's deny file refuses to `Read` them. This matters on a box that runs both roles
   (§6.9). It is an accident guard, like the rest of that list. `must-allow.json` gains no entry, because no allowed
   command reads those paths.
4. **Outbound session text is redacted.** A write's `title`, `description` and `body` go through the egress profile
   before they are sent to Linear, so a secret a session pastes into a ticket does not leave the fleet. The answer
   carries `masked`, and so does the journal row.
5. **The census** (`server/test/linear-key-containment.test.ts`) is the mechanism behind all of this. It drives every
   Linear route (the Settings routes and the twelve proxy routes) through every success and failure arm, with a fixture
   key of the shape `lin_api_fixture…`. It captures each response body and header, everything written to
   `console.warn` and `console.error`, every `linear_events` row, and every `.json` record. It asserts that none contains
   the key, any eight-character run of the key, or the key's digest. The one file allowed to hold the key is the slot's
   `.key`.

## 14. Tests

Each row starts red: written before the code, it fails on `main`, and a mutation of the guard turns it red again.

| # | file | what it holds | its mutation |
|---|---|---|---|
| 1 | `linear-store.test.ts` | slot layout, modes 0700 and 0600, record v2 parse and refusals, the orphan `.json` sweep | write a record with mode 0644; accept an unknown field |
| 2 | `linear-store-migrate.test.ts` | copy, never move; dedupe by digest; replace or remove of the matching slot removes the legacy pair; an unverifiable legacy key keeps title lookups working | `rm` the legacy file in step 3; skip the dedupe |
| 3 | `linear-route.test.ts` | every row of §4.2's table; uppercase compare; the refresh happens once a minute at most | pick the first match; refresh on every miss |
| 4 | `linear-ops.test.ts` | every op's validator and shaper; unknown field gives `bad-field`; documents are table constants; mutations only in write rows | accept a `query` field; mark `issueCreate` read |
| 5 | `linear-proxy-auth.test.ts` | each of the twelve routes refuses without the token, with a wrong one, with an unknown sender and with a stale uuid, before any Linear call (the fetch seam records none) | drop the token check on one route |
| 6 | `linear-proxy-routes.test.ts` | each verb's happy path against recorded fixtures; failure words and statuses (§6.8) | map a Linear 401 to `not-found` |
| 7 | `linear-proxy-deadline.test.ts` | eight seconds a call, twenty a route; no second call when less than eight seconds remain; a write timeout answers `unknown` in the journal | raise the route budget past thirty |
| 8 | `linear-budget.test.ts` | per-session and per-workspace buckets, `Retry-After`, writes capped inside reads | share one bucket across sessions |
| 9 | `linear-journal.test.ts` | pending, then outcome; a journal failure refuses with no Linear call; denial and refusal rows; no free-text column; the 365-day sweep | call Linear before the insert |
| 10 | `linear-policy.test.ts` | allow-all default; deny gives 403 and a row; throw, timeout or a bad shape give 503 and a row; reads skip it | fail open on throw |
| 11 | `linear-remove-stops.test.ts` | a delete, then the next call answers `not-configured`; no other slot is chosen; a replace takes effect on the next call | cache the key for one call |
| 12 | `linear-key-containment.test.ts` | §13.5's census | log the header on a 401 |
| 13 | `linear.test.ts` (changed) | the 429 row becomes `rate-limited`; the title lookup reads it as offline | map 429 to `unreachable` again |
| 14 | `linear-workspaces-routes.test.ts` | the four Settings routes: posture, `workspace-exists` and `replace`, race and digest rules carried over from `linear-connection-routes.test.ts` | drop the step-up on DELETE |
| 15 | `ccrc-api.test.ts`, `ccrc-api-closed.test.ts` | forty-six rows; identity in the query on GETs and spliced on POSTs; a body naming `byId` or `byUuid` is refused; free text has no query key | honour a caller's `byId` |
| 16 | `coord-attribution.test.ts` | characterisation of `attributionVerdict`'s four answers, green on `main` before the move | — (a characterisation) |
| 17 | `pwa/test/linear-section.test.tsx` (rewritten) | list states, the add, replace and remove flows, the field cleared on hide | keep the key after Add |
| 18 | `pwa/browser/linear-workspaces.browser.test.ts` | §10.3's table at four widths, two skins, two themes | a fixed-width chip row |
| 19 | redactor tests and `docs-parity.test.ts` | `lin_api_` is masked in egress and docs, with python parity | remove the prefix from python only |
| 20 | account deny fixtures | `Read(~/.ccrc/linear/x.key)` is refused; nothing in must-allow is refused | drop the path |

**Census updates** in the same PRs as the code they count:
- `ccd/ccrc-api`: the two prose sites say forty-six. `ccrc-api.test.ts`'s `WORDS` map is extended to forty-six.
- `auth/gate.ts`: twelve EXEMPT entries with reasons. The comment's counts go from "thirty-eight box-token machine
  lanes" to fifty and from "All forty-one" to fifty-three. `box-token-census.test.ts` reads `linear/proxyRoutes.ts` as a
  lane source.
- `auth-gate.test.ts`: the files that register routes become seven (`linear/proxyRoutes.ts` joins). `linear/routes.ts`
  stays five routes, with new names. The total route count rises by twelve, and the set is checked both ways.
- `secret-mask.test.ts`: entries for `/api/linear/workspaces` and the twelve proxy routes; the `/api/linear/connection`
  entry is removed.
- `refusal-status.test.ts`: the new words (§6.8) and `workspace-exists`.
- The coord schema migration count. `single-definition`: `LINEAR_OPS`, the verb list and the refusal words are each
  defined once. The rings table: the new files' rings, and their context (§16 Q5).

## 15. Rollout and verification on the box

The work ships in five PRs, each green on its own. 1: the attribution move and the store, with migration. 2: routing,
the ops table and the proxy routes, with the journal, the policy point and the budgets. 3: the `ccrc-api` rows. 4: the
Settings routes and card. 5: the skills, the README and the redactor and deny-path changes. A release ships agent-first,
as every release does: the fleet box gets `ccrc-api` and the skills, then the server.

**Verify on the box**, after the release:
1. Settings → Linear shows the old key as one workspace row, migrated, with its name and teams. `~/.ccrc/linear.key`
   is still present.
2. Add a second workspace's key. The row shows its name and teams.
3. From a fresh session on each account (one just added, and one just swapped onto), run
   `~/.local/bin/ccrc-api linear workspaces`, `linear issue <REF>` in each workspace, `linear create` in a test team, and
   `linear comment` on that issue. Each succeeds with no sign-in prompt.
4. In coord.db, `linear_events` holds one `ok` row for each write, naming the calling session, and no text.
5. Remove one workspace's key in Settings. The next `linear issue <REF>` in that workspace answers `not-configured`,
   and the other workspace still answers.
6. Grep the server's journal output, the session transcripts and the `linear_events` rows for the key's first twelve
   characters. Nothing is found.
7. Then, by hand, remove the per-account Linear MCP entries from each account's configuration, and start a new session
   to confirm it uses the verbs. claude.ai connectors are not touched.

## 16. Open questions

- **Q1. Where the key list lives.** The card stays in Settings → Security after Box token. *Recommended:* yes. It is a
  box credential, and moving it would move the reserved slots the copy comments describe.
- **Q2. The per-account MCP entries.** ccrc could remove them itself through ccd, which owns Claude Code's on-disk
  layout, or the operator could remove them by hand once. *Recommended:* by hand, once, as §15 step 7. A sweep that edits
  each account's `.claude.json` would be a second writer of a file Claude Code owns, for a one-time cleanup.
- **Q3. A screen for the journal.** *Recommended:* not in this version. Record now, as the account audit does, and read
  with `sqlite3`. A "Recent session writes" list on the card can follow once the operator has seen the volume.
- **Q4. When to retire the legacy `linear.key` reader.** *Recommended:* in the second release after this one, once every
  box has shown a migrated row. A rollback inside that window keeps title lookups.
- **Q5. The bounded context.** `linear/**` is in C4, Workspace Lifecycle, because its first use was ticket titles for
  new workspaces. With the proxy, Linear becomes a fleet-wide integration. *Recommended:* keep it in C4 for this work,
  where the glob already matches the new files and no table changes, and say so in the PRs. Moving it to its own context
  is a separate consolidation decision.
- **Q6. A local "read-only" switch per workspace before #279.** *Recommended:* no. A read-only Linear key already makes
  a workspace read-only (§8), and #279 is the general door.

## 17. Rejected

- **A fleet-wide MCP server installed into every account.** The operator ruled it out on 2026-10-31. It needs per-account
  installation, and it would be a second protocol beside `ccrc-api`.
- **A raw GraphQL verb, or a query-document field.** That would let any session use the key for any operation, which
  is exactly what §6.4 exists to prevent.
- **Handing the key to the agent or to sessions for direct calls.** That breaks goal 4, and the agent has no HTTP client
  by design (`client.ts`'s header comment).
- **One JSON file holding every key.** A single file would need its own parser and partial-write rules, while a key per
  file keeps `readValueFile` and `writeValueFileAtomic` as the one reader and writer.
- **Moving the legacy key.** A rollback would lose title lookups. Copying costs one file (§3.4).
- **Routing by "the first workspace that has this team".** A team key can repeat across workspaces, and a guess would
  write into the wrong one.
- **Encrypting the key files.** See §3.5.
- **Journaling reads.** Reads change nothing in Linear, and journaling them would multiply rows without making anything
  more accountable. The budgets bound reads instead.
