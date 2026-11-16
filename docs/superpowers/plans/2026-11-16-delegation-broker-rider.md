# The delegation broker's Rider: the case-fold guard for the forbidden ccd verbs, and the README card sentence

Programme: `delegation-broker` (ledger `docs/superpowers/programs/delegation-broker.md`), run 2237. The operator chose
on 2026-11-16 to fix these two of the items carried to the Rider, to hand the console's general items to the desktop
polish programme, and to drop the rest (the ledger's entry of that date).

## Goal

- A case-folded spelling of a verb no session may run (`FORBIDDEN_CCD_VERBS`, `server/src/coord/approvalguard.ts`)
  cannot run that verb through the installed `ccd`, even when the caller exported `nocasematch` in `BASHOPTS`. Today
  that holds only for the verbs on the installed direct entry's protected list.
- README's card paragraph stops saying the card shows every count, in the one state where it does not.

## What was read first

- Review 1665 N1 (PR8b) put `delegation-adopt` on the installed direct entry's protected list
  (`ccd/ccd-entry.py#is_protected`) and on the body's direct-entry guard, as `ws-lease-mark` is, so a case-folded
  spelling a child reaches through an inherited `nocasematch` matches no verb (`pr8b.md` in the wave 5 plan's
  directory). The ledger's 2026-11-09 Rider entry carries the rest: the hole stays open for `ws-rm`, `ws-reap` and
  `roll`. `FORBIDDEN_CCD_VERBS` also names `ws-gc --prune`, `ws-archive`, `ws-restore` and `claude`, and none of the
  seven is protected.
- The entry's comment, "WHAT IS PROTECTED": each protected token is matched without case, a deliberate superset; a
  case variant starts protected, `bash -p` drops the inherited option, and the body's dispatcher compares exactly
  again. "Protecting more than the body would is harmless: it only starts under `-p`."
- The child hook's deny arm matches the verb's text, so a case variant passes it; the entry is where a child's `ccd`
  call is decided.
- The body's direct-entry guard in `ccd/ccd` (the `entry-unprivileged` refusal) is a different rule. It refuses a
  protected verb that was started any other way, and it exists for the verbs only the server composes. The seven verbs
  here are the operator's, run by hand and by ccrc's own tooling, and their suites start the body directly (among
  them `ccd-ws-rm-attic`, `ccd-ws-reap`, `ccd-ws-gc`, `ccd-ws-archive-if-no-pane` and `ccd-ws-restore-supersede`).
- The owed README sentence is in the wave 5 plan's `pr8d.md`, under "Owed to README": in "The switch's card: Settings
  › Automation › Worktrees left behind", "with every count" becomes "with every count, but for the would-keep figure
  after a pass that could not read everything it needs, where it says the card cannot say how many until the next
  pass". Review 1727's D2 noted it may need a small reword.

## Deviations found

- **D-8666 (2026-11-16)** — the installed direct entry starts every verb of `FORBIDDEN_CCD_VERBS` it did not yet
  protect (`ws-rm`, `ws-reap`, `ws-gc`, `ws-archive`, `ws-restore`, `roll` and `claude`, each with any tail, matched
  without case as the others are) under `bash -p`, so an inherited `nocasematch` cannot fold a case variant into one of
  them. The body's direct-entry refusal is not extended to them: they were never server-only, and their callers start
  the body directly. Closes the item review 1665 N1 left open.

## Design

- `is_protected` gains the seven verbs, any tail. For `ws-gc` that is the whole verb, read-only form included: it loses
  nothing under `-p`, and one rule is simpler than a tail walk for `--prune`.
- "WHAT IS PROTECTED" names them as a group of their own: a protected start, with no refusal in the body.
- The body's direct-entry guard does not change. The shared table that runs one set of shapes against both halves
  (`agent/test/ccd-entry-exec.test.ts`, and any table that mirrors it) gains a class for "the entry protects, the body
  does not refuse", so the halves stay pinned where they agree and the new group is pinned where they differ.
- Every place that lists the entry's protected set says the same: README, `CLAUDE.md` if it lists the set, and ccd's
  own comments.
- README's card sentence lands as written, reworded only if the surrounding sentence needs it.

## Tasks

- [ ] T1. Census, before any edit. For each of the seven verbs, list every caller: server-composed argv, agent ops,
  `ccrc` and deploy scripts, timers and units, and tests. Record how each starts ccd: through the installed entry, or
  the body directly. A caller that starts the body directly is unaffected. A caller through the entry that depends on
  startup state `-p` drops (`BASH_ENV`, `ENV`, an exported function, inherited `SHELLOPTS` or `BASHOPTS`, `CDPATH`,
  `GLOBIGNORE`) is a stop: report it to the coordinator before changing anything.
- [ ] T2. Red rows first, in a fixture HOME. Through the real entry, with `BASHOPTS=nocasematch` exported, a case
  variant of each verb (for example `WS-RM`, `Roll`, `CLAUDE`, and a non-ASCII fold the entry's matcher covers) runs
  no verb: it is refused as unknown, and nothing in the fixture is removed or changed. The exact spelling still runs,
  and starts under `-p`. Watch the case-variant rows fail on `main` before the change.
- [ ] T3. Build: the tuple, the comment and the table class. Then the mutation table: deleting each new verb from the
  tuple reds that verb's row.
- [ ] T4. README: the owed card sentence, and the entry's protected set wherever it is listed.
- [ ] T5. Notes in `docs/superpowers/plans/2026-11-16-delegation-broker-rider/notes.md`: the census table, the rows,
  and the mutation table.

Every test and typecheck runs through `ccrc test -- <command>`.

## Review focus

- A caller of `roll` or `claude` that goes through the entry and relies on its inherited environment.
- Sessions that run `ccd ws-gc` without `--prune` to list: they must still work under `-p`.
- The agent's exec path for `ws-archive` and `ws-restore` (the server's archive route): through the entry or not, and
  what `-p` changes there.
- Non-ASCII folds for the new verbs: the same matcher as the existing ones.
- That no test runs a real `ws-rm`, `ws-reap`, `ws-gc --prune`, `roll` or `claude` against the live HOME.
