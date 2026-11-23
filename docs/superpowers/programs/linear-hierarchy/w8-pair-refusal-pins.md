# Run 3492 (`w8-pair-refusal-pins`): the nested and padded identity-key refusal is pinned

Linear hierarchy wave 8, D-8808 and D-8809. No new deviation, and no change to `ccd/ccrc-api`: this is a tests-only round.

## The gap, measured

On the linking and call doors, `ccd/ccrc-api` refuses a body that names its own `byId` or `byUuid` with a text test: a
substring match (`"byId":` or `"byUuid":`) over a copy of the body with all whitespace removed. So a key nested at any depth,
and a key padded with whitespace, both match and are refused `bad-body`, unsent. Fix round 2 of review 3271 corrected the
comment and the note to say so, but no test pinned the nested spelling on any door, and only one padded form (padded around
the colon) was pinned. Review 3494 measured that: deleting the whitespace strip already turned 11 older cases red, while
anchoring the match to the head of the body kept every existing case green. (Corrected on the coordinator's ledger PR; the
test file's comment still carries the broader wording.)

## What was built

`server/test/ccrc-api.test.ts` gains one describe, placed beside the call and remaining-work doors' cases. It runs over every
door that carries the text test, which is the append-last census of `ccrc-api-closed.test.ts` (eleven keys):

| Door | Row |
|---|---|
| linking suggest, linking confirm | `linking.suggest`, `linking.confirm` |
| call record | `calls.record` |
| note add, note close, note handover | `note.add`, `note.close`, `note.handover` |
| goals pin, goals modify, goals merged | `goals.pin`, `goals.modify`, `goals.merged` |
| probe answer | `probe.answer` |
| programme remaining | `programme.remaining` |

Three cases per door (thirty-three in all):

- Nine spellings are each refused `bad-body` with exit 2, and the server sees nothing: a nested `byId`, a nested `byUuid`, a
  `byId` two objects deep, a `byUuid` inside an array of objects, a `byId` padded around its colon, a `byUuid` padded with a tab
  and a newline, a `byId` and a `byUuid` padded inside their quotes, and a nested `byId` that is also padded. The nine are run
  and compared in one assertion, so a weakened test names every spelling it lets through, not only the first.
- A plain body still arrives, as itself with the pane's pair appended last (`byId` then `byUuid`), on the door's own route.
- Prose that merely mentions the two words, including an escaped quoted `byId` inside a string, is not refused.

## Red first

Two deliberately weakened copies of `ccd/ccrc-api` (each reverted with `git checkout` before any commit, so the file is
unchanged on this branch):

1. The text test matched on the unstripped body, in all six blocks that carry it: the refusal case went red on all eleven doors.
2. The text test anchored to the head of the body (`'{"byId":'*|'{"byUuid":'*` in place of the substring match), in the same
   six blocks: the refusal case went red on all eleven doors.

The plain-body and prose cases stay green under both, by design: they pin what must still pass, not the refusal. On the real
code the whole `ccrc-api` file is green (338 cases) and `ccrc-api-closed` is green (52).

## Doors that differ from the comment

None found. All eleven refuse a nested and a padded spelling alike. Two things worth knowing, neither a defect:

- A key padded **inside** its quotes (`"byId "`) is a different key to a JSON parser, yet the stripped copy reads it as `byId`,
  so it is refused. That is an over-refusal on the safe side and is pinned as refused, so a change to it is a decision.
- `runs allocate`'s `byId` fill uses the same stripped substring test but the opposite rule: a body that names `byId` keeps its
  own value and the fill is suppressed, where these eleven doors refuse. Its comment already says so. It is not one of the
  eleven and is not pinned here.

## Overlap

Open PR #3220 edits `ccd/ccrc-api` and both test files (the Overlord inbox rows). This round edits none of the client and adds its
describe mid-file in `ccrc-api.test.ts`, away from the end of the file where that PR appends, so the two do not touch the same
lines. No live claim held any of these files when the round started.
