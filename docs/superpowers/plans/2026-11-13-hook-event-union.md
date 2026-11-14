# Hook events as one L0 union

- **D-8613 (2026-11-12)** — `hook-event-union`: the names of the hook events the session hook handles are one L0 vocabulary, `HookEvent` in `shared/hook-events.ts` (a map, its keys as `HOOK_EVENTS`, the guard `isHookEvent` and the compare `hookEventIs`), held as a set to the hook's `case "$event"` arms in both directions. Every consumer names an event through it; the hookstate's `event` field stays an open string.

This is the follow-up the ARCH-26 slice deferred (#533; `2026-10-20-arch-26-jq-ts-set-equality.md`, "Not done here"):
the `HookEvent` L0 union across its consumers, held until working-state Task 2 merged. Task 2 merged as #575
(`9d8680227`, D-5232), so the condition holds.

## The gap

`server/src/bus.ts`'s `HookEventName` is not this union: it is the bus channel `hook:<id>` that carries the watcher's
hookstate read, and it is unchanged. The hook event names had no shared home. Seven sites in five consumers spelled
them against a bare `string`, so a misspelt name compiled and never matched:

- `server/src/coord/stall.ts`: `STALL_PLUMBING_EVENTS`, a `readonly string[]`;
- `server/src/fleet.ts`: `BACKGROUND_CARRIER_EVENTS`, a `ReadonlySet<string>`;
- `server/src/coord/finished.ts` and `server/src/inject/send.ts`: `event === 'Stop'`;
- `server/src/watch.ts`: the mail lane's ingestion edge, `event === 'UserPromptSubmit'`;
- `shared/api.ts`: `sessionBucket`'s two `'SessionStart'` compares, and `DELEGATION_EVENT_KINDS`, untied to any wider list;
- `server/src/coord/delegation-ingest.ts`: its `Variant` union respelled five of the delegation kinds.

## Changes

- `shared/hook-events.ts` (new, imports nothing): `HOOK_EVENT_MAP`, twelve events, each with what it marks; `HookEvent`
  is its key type and `HOOK_EVENTS` its keys. `isHookEvent` is the guard, and `hookEventIs(event, name)` is the one
  compare of a raw event against a named one.
- The consumers: both lists are typed by the union and tested only once `isHookEvent` holds; the four compares go
  through `hookEventIs`; `DELEGATION_EVENT_KINDS` is `as const satisfies readonly HookEvent[]`; and `Variant` derives
  its lifecycle members from `DelegationEventKind`.
- `server/src/hookstate.ts`: `HookState.event` stays `string | null`, because Claude Code owns the set and grows it
  between builds. Its docstring now names the union as the way a consumer tests it.
- `shared/api.ts` gains one import line (`hookEventIs` and the type). The L0 pins in `peers-claims-l0.test.ts` and
  `collect-lane-l0.test.ts` list it, and `stall-vocabulary.test.ts` admits `shared/hook-events.ts` among stall.ts's L0
  value imports, with the guard alone. `measure-working-state.test.ts`'s carrier regex reads the new set type.

## Tests

- `server/test/single-definition/hook-events.test.ts` (new) pins:
  - one declaration each, and the derivation from the map;
  - L0, which means the file has no imports;
  - the guard's round trip;
  - the delegation kinds and the plumbing list are members;
  - a census that refuses a bare-literal compare against an `event` or `hookEvent` field and a hook event list typed
    as plain strings, with a CONTROL. On the base it was red and named all seven sites above.
- `server/test/install-session-hooks.test.ts`: `HOOK_EVENTS` equals the hook's handled set, as a set with no duplicate.
  That set is the one D-306's derivation reads from the `case` block, so it is also the set the installer wires.

## Mutation table

Each mutant was applied to the finished tree and then reverted.

| Mutant | Killed by |
|---|---|
| `hookEventIs(hook.event, 'Stopp')` in `finished.ts` | `tsc` (not assignable to `HookEvent`) |
| `Notification` added to the map | the set-equality case |
| `StopFailure` dropped from the map | the set-equality case |
| `BACKGROUND_CARRIER_EVENTS` back to `ReadonlySet<string>` | the census |
| the mail lane's `hs.event === 'UserPromptSubmit'` restored | the census |
| `HOOK_EVENTS` hand-written as an array | the derivation pin |

## Deviations found

- The task named `bus.ts`'s `HookEventName` as the only existing union. That type is the bus channel template
  (`hook:${string}`), not a set of hook event names, so it stays unchanged. Renaming it to avoid the near-name was not
  needed to land the union.
- The hookstate field is not narrowed to the union. The open-string rule in its docstring predates this change and
  still holds: a new Claude Code event must not fail a whole hookstate read. The union governs the names a consumer
  looks for, not the names a read may carry.
- No PWA or agent module names a hook event. The PWA reaches the union only through `sessionBucket` in `shared/api.ts`.

Issued and unused: none
