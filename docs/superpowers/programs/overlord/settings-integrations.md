# Settings › Integrations: notes

The operator's direction of 2026-11-22: the Linear settings are hard to read, they sit in Security where nobody looks
for them, and they should be a Settings section of their own, called Integrations, which is also where a GitHub key
will be stored. This pull request does the move and the redesign. It adds no server route and changes no write: every
control calls the route it called before, with the body it sent before.

The deviation this work is filed under is `D-8932`. The allocator was not reachable from the
session that wrote it; the number is issued and the placeholder replaced before this lands.

## What moved

- **A sixth Settings section, Integrations**, at `/settings/integrations`, after Security. It is one row in
  `SETTINGS_SECTIONS` (`pwa/src/lib/routes.ts`), so its route, its row on the Settings index, its "Go to Settings ›
  Integrations" palette command and its page title all come from that row. Its index line is the Linear keys' state
  from the frame's one Linear read, then how GitHub is reached today.
- **The Linear card and Project linking** left Security for Integrations, whole. Their card heads moved from
  `SETTINGS_CARDS.security` to `SETTINGS_CARDS.integrations`. Security keeps the sign-in gate, Your sign-in, This
  session, the box token, Approvals and Permission prompts.
- **Links.** `LINEAR_PROJECTS_SETTINGS_PATH` (`shared/ledgers.ts`), the one definition of the page that holds the
  project rows, now reads `/settings/integrations`. The Waiting on you item's link, the name sheets' "set it up"
  pointers and the Upkeep page's Back follow it.
- **An old link.** A Waiting on you item written before this change names `/settings/security` in its stored text.
  Security now has one line where the Linear card was, "Linear keys and project linking are now in Integrations", with
  a link that opens it.

## The one change a server reads

This is the one intended change of behaviour outside the console, and it is named here so that it does not ride
inside the move unseen. `LINEAR_PROJECTS_SETTINGS_PATH` is also written into the "Choose the Linear workspace of team
…" item's steps by `server/src/linear/inboundPolicy.ts`. So a new item's text says "Open /settings/integrations and,
on the row …", where it said `/settings/security`. Leaving it would send the operator to a page without the row.

- No route, no write and no decision changed. Every console call was compared old against new: the same routes, the
  same bodies.
- Items are matched by their verb and team, never by their text, so no second item is raised. An item that is
  already open keeps the old path in its text, and Security's pointer line (below) is how it lands.
- `server/test/plan-inbound.test.ts` and `server/test/single-definition/plan.test.ts` pin the new path.
- It belongs in a commit of its own (the constant and those two pins), named in the pull request under
  `D-8932`.

## What the Project linking list shows

One list, decided by `linkingList` (`pwa/src/fleet/linkingWords.ts`); the card draws the answer.

- **The counts are said once, at the head**: "3 need a decision · 6 linked · 21 not linked".
- **A row that waits for a decision comes first**, open and flagged "Needs a decision". Five reasons:
  1. a suggested team waits to be linked;
  2. the key exists in more than one Linear workspace and none is stored;
  3. two projects share a key in one workspace and neither is its owning project;
  4. a map waits for approval;
  5. inbound issues wait and the project has no live Linear owner.
- **Each reason has the one control that settles it directly under it**, and the rest of the row's form is behind
  "More settings". Which control belongs to which reason is decided in `linkingDecisions` (`LinkingDecision.control`):
  the key cell (field, Save, the workspace chooser, the suggested teams) for the first two, the Owning project box,
  the link to the map item, the Linear owner select. A shared-key row is three stops for the keyboard (its line, the
  box, "More settings"), where the whole form was eleven. A control is drawn once: under its reason, and not also in
  the form.
- **A row the operator settles stays where it is.** It keeps its place among the first rows, its control stays the
  same element under where its reason was, and its answer stays in view. Shut and opened again, it is the whole form.
- **A linked project is one line**: its name, its team (key and name), how it was linked ("linked automatically",
  "set by hand", "linked by the Overlord"), who owns the team now ("owner: …", "owner: … (not live)", "no live
  owner") and where its migration stands. A few words follow where the row differs from a quiet one: "2 inbound issues
  waiting", "public", "visibility not read", "no PR template". The line is a native disclosure. It opens to every
  control the row had; nothing was removed.
- **Projects with no team and nothing to decide sit behind one control**, "N projects not linked to Linear". It opens
  to a plain list that says "Team key" once, above the rows. Each row is its name, its key field, Save and "More" on
  one line (on a phone the name sits over the other three). The field has no visible label of its own and is named
  for its project ("Team key for project-a"). The group starts open only when no project is linked at all.
- **A coordinator select is never a wall of ids.** The default is stated first. Up to eight live coordinators are
  listed, with the ones that are not live behind "Show N coordinators that are not live". With more than eight live,
  the select holds only the default and the stored owner, and one control, "Show all N coordinators", lists every
  one, the not-live ones in a group of their own. "Coordinator for every project" works the same way, and its act
  follows its select in the page, so the keyboard reaches it next.
- **Reshape in Linear** is unchanged: one confirm per team, with its consequence sentence.

Three things the list does that are not visible in a still picture:

- Every row is in one keyed list, the group's control among them. A row that a write moves across the group (a key
  saved in the group, a key cleared on a linked row) keeps its state: the lock its write needs and its result line.
- A row moved by its own write takes the operator with it: its line opens, or the group opens, and focus goes to it
  once its field is no longer locked. A row that a read moves is left alone, and so is one whose own write was
  refused, or saved without moving it.
- One key stored in two different Linear workspaces is two teams, as the server's owner rule reads it
  (`planPolicy.ts` `teamOwnerProject`): neither row is flagged for an owning project.

The name of a team linked by hand is not on the wire. The line looks it up in the connected workspaces' teams, in the
stored workspace when one is stored. When two workspaces name the key differently, or the list is unread, the line
shows the key alone.

Widths. The layout follows the card's width, not the window's. A line's columns (name, team, owner, state) start at
600 px of card, so both skins have them at a laptop's width and wider: the refined skin's card is about 700 px at
any window width, and a 760 px threshold would never have reached it. The flag and the notes take the line under the
columns. A row's form keeps its own two thresholds, 480 and 760.

## Decisions made in the review round

- **One word for a coordinator that is not running: "live".** The select already said "Default: none live" and
  "(not live)", and the Waiting item's controls say "live" too. The line now says "no live owner" and "owner: X (not
  live)", where the first draft said "no owner running". The operator's direction used "running"; saying it would
  mean changing the select and the other screen as well. Flip it there if "running" is wanted.
- **Inbound issues with no live owner are a fifth reason.** The count is on every line that has one. The row is
  flagged only when no live coordinator owns the team and the owner is this project's own to set; an owner that
  comes from the project owning a shared key is that project's row to settle, and an owner that could not be measured
  is not "none".
- **A shared key with no owning project stays flagged** until one is ticked, although the server has a default (the
  project that set the key first owns it). The reason line says so.
- **Two unreachable guards were treated differently.** Focus after a move waits for the row's lock: that is reachable
  through the card's own contract (a list whose rows land before its re-read settles), and a test now holds it. It
  also waited for the group to be shown: the card opens the group in the same update, so that guard could not be
  reached, and it was removed. A real Chrome case covers the path (a key cleared on a linked row).

## Known limits

- **The Settings index does not say that the page needs you.** Its Integrations line reads the Linear keys only. Rows
  flagged "Needs a decision" and a GitHub reading that was refused leave it calm, because the frame does not read
  the project list or the hierarchy. Giving it those reads is a follow-up (below).
- **Security carries a pointer line**, "Linear keys and project linking are now in Integrations", because an item
  written before this change names `/settings/security` in its stored text and there is nothing to redirect (the old
  link was the bare Security path). It goes when no open Waiting on you item names the old path: items raised after
  this lands name the new one, so that is when the last older `linear-team-workspace` item closes. The follow-up
  below removes it.
- **The GitHub card infers.** It reads the visibility readings, which can be a day old and say nothing for a fleet
  with no measured repository.

## The GitHub card

Read-only, with no control. It says three things:

1. What ccrc uses today: it holds no GitHub key, and reaches GitHub through the GitHub CLI signed in on the fleet
   box. That sign-in reads pull requests, their checks and repository visibility, opens pull requests and merges
   them, so it has to be able to write to the repositories, and every session on the fleet box uses the same one.
   The write access is said as what follows from those uses, not as a reading.
2. What the readings say of that sign-in. No route reports it, and this pull request adds none. The card reads the
   visibility readings the project list already carries: each is one GitHub call the fleet box made. The newest reading
   that speaks to the sign-in decides: "GitHub answered the fleet box 3h ago, so its sign-in worked then", or, in amber,
   "GitHub refused the fleet box's sign-in 10m ago", with what to run there. With no such reading it says it does not
   know. It never says the box is signed in now, and never names an account or a scope.
3. That a GitHub key stored here is coming. Its design is
   `docs/superpowers/specs/2026-11-22-integrations-github-credential-design.md`.

The project list is now read once by the section (`useProjectList`) and handed to both cards, so the GitHub card costs
no second request.

## Tests

- New: `pwa/test/settings-integrations.test.tsx`, `pwa/test/linking-list-words.test.ts`,
  `pwa/test/github-words.test.ts`, `pwa/browser/settings-integrations.browser.test.ts`.
- Rewritten for the compact list: `pwa/browser/project-linking-card.browser.test.ts`. It measures the list as it
  opens (the order, the counts, each reason over its control, "More settings" shut and taking no room, the stops Tab
  reaches in each row, the notes on each line, the line's columns in both skins from 1280 up), every row opened, the
  keyboard (a waiting row's first stop is the control its reason names; the act for every project follows its
  select), and a key cleared on a linked row (the group opens and focus lands on the row's field).
- Extended: `pwa/test/project-linking-card.test.tsx` (each row state, each reason with its control, the group, the
  selects, a row moved by a write and by a read), `pwa/test/section-status.test.ts`,
  `pwa/test/settings-security.test.tsx`, `pwa/test/epic-screen.test.tsx`.
- **Each new rule was measured**: thirty-three mutations, one at a time, each restoring its file by checksum, over
  the four jsdom suites of this card. Every one turned a named test red. They include the three the review found
  unheld: a refused key write that still counted as this row's move, a saved write that was never spent, and focus
  that did not wait for the row's lock. An earlier line of this note claimed sixteen mutations were all red; three
  of that draft's guards were not held, and the claim was wrong.

## Not verified

- **The whole browser leg.** The browser files this change reaches were run in Chrome on the laptop. The others
  under `pwa/browser` were not.
- **`server/test/typecheck-tests.test.ts`.** Its `pwa` and `ui` arms pass. Its `server/test` and `agent/test` arms fail
  on the laptop because the worktree has no `agent` dependencies installed; no error names a file this change touches.
- **`pwa/test/app-icons.test.ts` and `pwa/test/parser-resolution.test.ts`** fail on the laptop with and without this
  change (the icon generator's output differs there; the worktree's `server/node_modules` is a link).
- **`server/test/dtbd.test.ts`** is red until the placeholder above is replaced, by design.
- **A real fleet's list.** The list was drawn from fixtures. Nobody has looked at it over a fleet's thirty projects and
  twenty-eight coordinators, and the share of coordinators that are live there is not measured. The select does not
  depend on it: past eight live it lists none until asked.

## Follow-ups this leaves

- The stored GitHub key itself, and where the card's status then comes from: the spec named above.
- A route that reports the fleet box's GitHub sign-in directly, so the card stops inferring it.
- The Settings index line for Integrations: give the frame the project list and the hierarchy, so the line can say
  "3 projects need a decision" and turn amber on a refused GitHub reading.
- Remove Security's pointer line once no open item names `/settings/security`.
- The Owning project box itself still shows for one key held in two workspaces (`sharesTeamKey` compares keys only,
  as it did before this change). It is no longer flagged; hiding the box there needs each row's workspace on the
  hierarchy answer.
- The direction's wider point, that a machine fact is measured and never typed, is not addressed here: the team key is
  still a field. The settings audit (`docs/superpowers/specs/2026-11-22-settings-audit.md`) holds that work.
