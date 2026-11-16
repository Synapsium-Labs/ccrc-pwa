# Named anchors for citations, and the single-definition guard split by area: Plan note

**Size:** M. **Deploy class:** test guards and comments only (`server/test/anchors.ts`, `server/test/anchors.test.ts`, `server/test/single-definition/`, `server/test/single-definition-pin.test.ts`, the census rows of `server/test/session-hook.test.ts`, the CI walk floor in `.github/ci/testmap.mjs`); `shared/api.ts`, `ccd/session-hook.sh`, `server/src/coord/schema.ts` and `pwa/src/session/HistoryTab.tsx` gain trailing `@anchor` comments only. No behaviour or wire change. PR #1528.

## Problem

Line citations conflict whenever anything above the cited line moves, and `session-hook.test.ts` cited `single-definition.test.ts` by line, so that guard could only be appended to: every new guard row landed in one hunk at the end of one file.

## Change

A citation names an anchor (`path#@name`, with `// @anchor name` or `# @anchor name` on the cited line); `anchors.test.ts` fails on a dangling or doubled anchor. README's compaction paragraph cites by anchor. `single-definition.test.ts` is split into `single-definition/<area>.test.ts` plus `helpers.ts`, move only, with a pin on its describe and test counts. The append-only rule and the end-of-file convention for derived lists are retired.

## Deviations found

- **D-6928** — `named-anchors`: citations into live code name an anchor (`path#@name`) instead of a line number, checked tree-wide by `server/test/anchors.test.ts`, and the single-definition guard is one file per area under `server/test/single-definition/`, so a new guard row goes in the area it belongs to rather than at the tail of one file. The compaction card's "references some quotation of theirs actually anchors" floor in `session-hook.test.ts` moves from 100 to 96, the measured value, because four frozen-doc references into the removed single file can no longer resolve. The sweep of the numeric citations left in `session-hook.test.ts` is a follow-up of its own.
