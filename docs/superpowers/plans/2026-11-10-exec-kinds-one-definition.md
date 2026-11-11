# Exec kinds: one definition

## Goal

The closed set of exec kinds (how ccrc reaches an account's binary: `upstream`, `generated`, `external`, `codex`) has one definition, `EXEC_KINDS` in `shared/roster.ts`. Every TypeScript reader imports it, the bare-Node validator keeps the one mirror it needs, and a test pins that mirror equal to the definition in order. Behaviour does not change: both parsers accept and refuse the same rosters, with the same words.

## What was read first

- `shared/roster.ts` declared a private `EXEC_KINDS` Set and spelled the list three more times in the words of two refusals.
- `shared/roster-json.mjs` declared its own Set and spelled the list once more in its refusal. It runs under bare Node (`gen-wrappers`, `account-op`, `gen-accounts`), so it cannot import TypeScript and keeps a mirror.
- `server/test/roster-exec-parity.test.ts` compared the two Sets as sorted sets, not in order.
- `server/test/roster.test.ts` and `server/test/gen-accounts.test.ts` each declared a `TOOLCHAIN_EXEC_KINDS` list, and `server/test/ccrc-doctorFixture.ts` spelled the kinds as a union.
- `ccd/ccd-account-auth`'s gate has one `case` arm per kind, not a list. X4 in `server/test/ccd-account-auth.test.ts` already runs every kind through it, reading the mirror's source text.
- `ccd/ccrc-doctor-checks` (`generated|codex`) and `ccd/ccrc-adopt` (three arms) name subsets for other questions (which kinds ccrc writes, what adopt infers from disk). They are not copies of the set and are unchanged.
- Nothing under `ccd/history` reads the set; `ccd/history/lib.mjs` is untouched.

## Deviations found

- **D-8192 (2026-11-10)** — exec kinds have one definition: `EXEC_KINDS` in `shared/roster.ts`, exported with `ExecKind`, imported by every TypeScript reader; the `.mjs` mirror is pinned to it in order, and the refusals are built from it.

## Design

- `shared/roster.ts` exports `EXEC_KINDS` as an `as const` array in the order the refusals name the kinds, and `ExecKind`. A compile-time pin holds `ExecKind` and `ExecSpec['kind']` to the same members. The parser's Set and its refusal words are built from the array, so the refusal text is unchanged.
- `shared/roster-json.mjs` keeps an ordered array mirror and builds its refusal from it.
- `roster-exec-parity.test.ts` compares the mirror's declaration with the imported definition in order, checks that `shared/roster.ts` declares it once, and checks that both parsers name every kind in the definition's order when they refuse one.
- `server/test/single-definition/exec-kinds.test.ts` refuses a third list: three or more quoted kinds joined by commas or `|` appear only in the definition and its mirror, once each, and in no server test.
- The two test lists and the fixture union import `EXEC_KINDS` and `ExecKind`. X4 reads the definition rather than the mirror's text.

## Tasks

- [x] T1. Tests first, red: the in-order parity, the one-declaration check, the refusal words built from the definition, and the single-definition scan.
- [x] T2. Build: export the definition, build the refusals from it, make the mirror an ordered array, and point the tests and the fixture at the definition.
- [x] T3. Run the named suites, the single-definition suite, `ccd-account-auth.test.ts` and both typechecks; mutate the mirror's order and add a list under `server/src` to see the pins go red.
