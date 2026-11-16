# A lane's context window follows the provider's promise

**Ruling (operator, 2026-11-13).** A non-Anthropic lane's context window follows the provider's promise, as a Claude
lane's does, and compaction keeps sessions below it. Before this change, a class model with no measured window put the
whole lane on `min(catalogue context, 200000)`. So when a codex lane's opus class advanced to a model nobody had
measured, every session on the lane dropped to 200000, although the catalogue promised 500000 for that model and the
lane's other models were measured at 400000.

**The rule (D-8564).** `contextWindowFor` in `shared/modelenv.mjs` is the rule's one owner. `modelEnvBlock` (the eighth
key, `CLAUDE_CODE_MAX_CONTEXT_TOKENS`, which Claude Code compacts against), `ccrc models <id> show` and `lanes`, the
doctor's `models` row (through `windowNotices`) and `lower-windows` all read its answer.

- Each class model's window is one of three:
  - its **measured** window (`set-window`, or `lower-windows` after a refusal), never above `windowCeiling`;
  - else the **provider's promise**, the fresh catalogue's `context` for that model (today 500000 for the 6.1 sol and
    terra models, 272000 for the others);
  - else **unknown**.
- The lane's window is the **smallest** class model's window, because Claude Code applies the one value to every model
  in the session, subagents included. The measured rule already chose the smallest for the same reason.
- While any class model is unknown, the lane never runs above the client's own 200000, which is what Claude Code assumes
  for an id it does not know. When every class model is unknown, the key is omitted, as before.
- A **stale** catalogue yields no promise, so it never raises a lane. Every class model with no measured window counts
  as unknown. A lane with some measured models then runs at the smaller of its smallest measured window and the
  client's 200000 (`source` `client`); a lane with none writes no key. Before this change a partly measured lane on a
  stale catalogue wrote no key, which left it on that same client 200000, so the key it now writes can only lower it.
- `windowCeiling(catalogue, model)` is the catalogue's `maxContext` for the model, never above `WINDOW_MAX`. Only a
  codex catalogue's `maxContext` counts: the OpenRouter probe fills that field from `max_completion_tokens`, which is an
  output limit. A stale catalogue's ceiling still applies, because a ceiling only ever lowers a window.
  `set-window` refuses a window above the ceiling with `above-max-context`, and `contextWindowFor` counts a measured
  window only up to it. `lower-windows` caps the window it records at the same ceiling, so the windows file holds only
  windows the rule honours.
- `windowNotices` (the doctor's `models` WARN, through `unmeasuredMoves` in `shared/model-advance.mjs`) names a class
  that moved to an unmeasured model only when the move lowered the lane: the window now in force is below the old
  model's measured window, or no key is written. A move to a model whose provider promise is at least that window
  lowered nothing and is quiet.
- `contextWindowFor` also answers `model` (the class model whose window decided `tokens`) and `source` (`measured`,
  `provider` or `client`). `show` prints the provider-default line from them: "N tokens, by the provider default (the
  catalogue context of M)". It no longer prints "by the default rule ... capped at 200000".

**Test fixtures.** The codex rows in `server/test/fixtures/modelCases.ts` and `advanceCases.ts` now carry
`maxContext: 872000`, the ceiling the catalogue advertises today. A ceiling of 272000 would refuse every measured window
those suites set. The recorded raw catalogue `codex-raw-2026-09-08.json` keeps its 272000 ceilings, because it records
what the catalogue said that day.

## Deviations found

- **D-8564 (2026-11-13)** — `lane-window-provider-default`: a lane's context window follows the provider's promise.
  This **replaces** the 2026-09-08 model-class-registry rule in
  `2026-09-08-model-class-registry-1-registry-probes-materialiser.md` (Task 16c, spec §6.1 as amended that day). That
  rule said the key "never raises the client's own 200k default on an advertised number alone", wrote
  `min(row.context, CLIENT_DEFAULT_CONTEXT_TOKENS)` for `ANTHROPIC_MODEL`'s model, and left raising a window to a
  measured one (codex-bridge spec §2.7).
  - **Now:** a class model with no measured window counts at its fresh catalogue `context`, and the lane takes the
    smallest window across its class models.
  - **Still capped at 200000:** only a lane where some class model has no known window at all.
  - **New bound:** a measured window may not exceed the codex catalogue's `maxContext` for its model. `set-window`
    refuses one above it (`above-max-context`); before, the only bound was the flat `WINDOW_MAX`.
  - **Unchanged:** a stale catalogue never raises a lane, and `lower-windows` still lowers a model's window after a
    refusal.
  - **Risk:** the 2026-09-08 cap was argued from a "196k wall" that the 2026-10-15 whole-fleet scan withdrew
    (codex-bridge spec §1.2). If a model turns out to accept less than its catalogue promises, the bridge's overflow
    refusal and `lower-windows` record the smaller window, and the lane follows it.
