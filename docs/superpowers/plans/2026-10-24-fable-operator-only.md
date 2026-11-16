# Fable runs only when the operator selects it

Operator ruling 2026-10-24: Fable is never used unless the operator selects it by hand. A coordinator, a worker, an agent, a lane default and an automatic path must never select it. The operator's own paths stay as they are: the PWA picker, the new-session sheet and new workspaces (all behind the cookie session), and `/model fable` typed into a pane.

Measured 2026-10-24 by a 7-day census of the fleet's transcripts:
- No Fable turn has run since 2026-09-29.
- Every earlier Fable turn traces to an operator `/model fable`. Claude Code then saved that as the account default, so revived and new sessions on the account started on Fable.
- The GPT lanes' `model: fable` maps through `ANTHROPIC_DEFAULT_FABLE_MODEL` to a GPT model and never reaches Anthropic Fable.

The non-operator paths found on origin/main, and the guard on each:
1. **The box-token doors.** These are POST /api/runs/:id/route (the manual field/value write and a ladder result) and the route a dispatch sends. They now refuse a Fable class.
2. **The ladder's main-scope reverse-demotion.** It is clamped at MAIN_CLASS_CEILING.
3. **A session's own `ccd route --set class=fable` and `--route class=fable`.** `_route_valid` now refuses them.
4. **An Agent/Task/Workflow call that names a Fable model.** The session hook now denies it.
5. **A spawn whose record names no class, on an Anthropic lane whose settings default resolves to Fable.** It now runs Opus.

## Deviations found

The ledger issued D-6790 to D-6793 for this work.

- **D-6790** — `fable-operator-only-doors`: every route write that reaches the server on the box token refuses a class of `fable`, answering `409 fable-operator-only`. This covers POST /api/runs/:id/route, both its manual field/value arm and any ladder result, and the route a dispatch carries. Only the cookie-session routes the operator's PWA uses may still write `fable`. `shared/routing-ladder.ts`'s main-scope reverse-demotion is clamped at `MAIN_CLASS_CEILING`, so no automatic step ever restores a class above `opus`.
- **D-6791** — `fable-not-from-a-session-shell`: `ccd`'s route validation refuses `class=fable` when the caller is a Claude Code session, which it detects by `CLAUDECODE` being set. This covers `ccd route --set` and every `--route` parse (ws-add, start, enable). The server's calls for the PWA and the operator's own shell do not carry `CLAUDECODE`, so they still pass.
- **D-6792** — `fable-agents-denied`: the session hook's PreToolUse arm, the account-mode arm that runs on every session, denies an Agent or Task call whose `model` names Fable. It also denies a Workflow call whose script or input names a Fable model for an agent. It is an accident guard and fails open like the arm it sits in.
- **D-6793** — `fable-never-a-lane-default`: a spawn on an Anthropic lane whose `settings.json` default model resolves to Fable composes `--model opus` when the session's record names no class, or names `default`. It reuses the resolver doctor's `model-default` check already uses. A class the operator chose is never overridden.
