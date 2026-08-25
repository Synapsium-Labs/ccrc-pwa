# One deviation namespace — the reconciliation record

**Status:** enumerated and allocated (Task 30); the rewrite is pending.

Spec: `docs/superpowers/specs/2026-08-21-build9-provenance-peers-claims-design.md`, §1 D14.
Executed 2026-08-25, in an operator-announced quiet window,
as Wave 10 of the Build 9b plan — deliberately last, never concurrent with a wave.

The legacy build-scoped deviation families are renamed into the single global
sequence. Nothing is deleted: every rewrite preserves its original as an alias
— `D-<n> (was D-B<k>-<m>)` on the first occurrence per file, bare `D-<n>`
after — and this table, whose middle column is byte-for-byte the `title` each
allocation carries in `ledger_alloc` and `~/.ccrc/ledger-alloc.log`, is the
permanent mapping. One predicate is shared by the enumerator, the rewriter and
the standing scanner in `server/test/deviation-refs.test.ts`: a legacy ref
immediately preceded by `was ` is an alias and is licensed; any other spelling
is bare, and since this wave a bare spelling is a red suite.

## The mapping

| global | legacy (the allocator title) | occurrences | files |
|---|---|---|---|
| D-274 | was D-B4-1 | 15 | 6 |
| D-275 | was D-B4-2 | 6 | 4 |
| D-276 | was D-B4-3 | 7 | 4 |
| D-277 | was D-B4-4 | 12 | 4 |
| D-278 | was D-B4-5 | 5 | 3 |
| D-279 | was D-B4-6 | 3 | 2 |
| D-280 | was D-B4-7 | 14 | 8 |
| D-281 | was D-B4-8 | 9 | 4 |
| D-282 | was D-B4-9 | 24 | 11 |
| D-283 | was D-B4-10 | 21 | 5 |
| D-284 | was D-B4-11 | 8 | 4 |
| D-285 | was D-B4-12 | 6 | 4 |
| D-286 | was D-B4-13 | 10 | 4 |
| D-287 | was D-B4-14 | 13 | 7 |
| D-288 | was D-B4-15 | 4 | 3 |
| D-289 | was D-B4-16 | 18 | 6 |
| D-290 | was D-B4-17 | 11 | 4 |
| D-291 | was D-B4-18 | 34 | 4 |
| D-292 | was D-B4-19 | 20 | 4 |
| D-293 | was D-B4-20 | 2 | 2 |
| D-294 | was D-B4-21 | 3 | 2 |
| D-295 | was D-B4-22 | 3 | 2 |
| D-296 | was D-B4-23 | 12 | 7 |
| D-297 | was D-B8-1 | 20 | 4 |
| D-298 | was D-B8-2 | 3 | 2 |
| D-299 | was D-B8-3 | 8 | 4 |
| D-300 | was D-B8-4 | 4 | 3 |
| D-301 | was D-B8-5 | 1 | 1 |
| D-302 | was D-B8-6 | 1 | 1 |
| D-303 | was D-B8-7 | 10 | 4 |
| D-304 | was D-B8-8 | 1 | 1 |
| D-305 | was D-B8-9 | 8 | 3 |
| D-306 | was D-B8-10 | 12 | 5 |
| D-307 | was D-B8-11 | 6 | 4 |
| D-308 | was D-B8-12 | 22 | 10 |
| D-309 | was D-B8-13 | 24 | 15 |
| D-310 | was D-B8-14 | 35 | 9 |

## The work-list (the enumeration output, verbatim)

```
was D-B4-1 -> D-274 :: docs/superpowers/plans/2026-08-11-build4-conversation-and-controls.md:6, docs/superpowers/programs/build4.md:2, docs/superpowers/specs/2026-08-11-build4-conversation-and-controls-design.md:3, pwa/src/fleet/AbandonSheet.tsx:1, server/src/coord/close.ts:2, server/test/coord-abandon.test.ts:1
was D-B4-2 -> D-275 :: docs/superpowers/plans/2026-08-11-build4-conversation-and-controls.md:3, docs/superpowers/specs/2026-08-11-build4-conversation-and-controls-design.md:1, server/src/coord/close.ts:1, server/test/coord-abandon.test.ts:1
was D-B4-3 -> D-276 :: docs/superpowers/plans/2026-08-11-build4-conversation-and-controls.md:4, docs/superpowers/specs/2026-08-11-build4-conversation-and-controls-design.md:1, server/src/coord/close.ts:1, server/test/coord-decide.test.ts:1
was D-B4-4 -> D-277 :: docs/superpowers/plans/2026-08-11-build4-conversation-and-controls.md:7, server/src/coord/dispatch.ts:1, server/src/coord/store.ts:2, server/test/run-routes.test.ts:2
was D-B4-5 -> D-278 :: docs/superpowers/plans/2026-08-11-build4-conversation-and-controls.md:3, server/src/coord/store.ts:1, server/test/coord-store.test.ts:1
was D-B4-6 -> D-279 :: docs/superpowers/plans/2026-08-11-build4-conversation-and-controls.md:2, server/src/coord/store.ts:1
was D-B4-7 -> D-280 :: docs/superpowers/plans/2026-08-11-build4-conversation-and-controls.md:5, docs/superpowers/plans/2026-08-15-fleet-robustness-build8.md:1, docs/superpowers/plans/2026-08-24-build9b-peers-claims-allocator.md:1, docs/superpowers/programs/build4.md:1, pwa/test/api.test.ts:1, server/src/coord/close.ts:2, server/src/coord/routes.ts:2, server/test/coord-abandon.test.ts:1
was D-B4-8 -> D-281 :: docs/superpowers/plans/2026-08-11-build4-conversation-and-controls.md:6, server/src/coord/close.ts:1, server/src/coord/store.ts:1, server/test/coord-abandon.test.ts:1
was D-B4-9 -> D-282 :: CLAUDE.md:1, agent/src/whitelist.ts:2, agent/test/types/bypasses/g9-coord-pause-without-state.ts:1, docs/superpowers/plans/2026-08-11-build4-conversation-and-controls.md:7, docs/superpowers/plans/2026-08-24-build9b-peers-claims-allocator.md:2, docs/superpowers/programs/build4.md:1, docs/superpowers/specs/2026-08-21-build9-provenance-peers-claims-design.md:1, server/src/auth/gate.ts:2, server/src/coord/routes.ts:3, server/test/coord-pause-route.test.ts:3, server/test/ledger.test.ts:1
was D-B4-10 -> D-283 :: agent/test/whitelist-structural.test.ts:1, docs/superpowers/plans/2026-08-11-build4-conversation-and-controls.md:13, server/src/registry.ts:2, server/src/watch.ts:4, server/test/registry.test.ts:1
was D-B4-11 -> D-284 :: docs/superpowers/plans/2026-08-11-build4-conversation-and-controls.md:3, pwa/src/fleet/StartProgramSheet.tsx:3, pwa/src/fleet/fleet.css:1, pwa/test/start-program.test.tsx:1
was D-B4-12 -> D-285 :: docs/superpowers/plans/2026-08-11-build4-conversation-and-controls.md:3, server/src/transcript/parse.ts:1, server/test/transcript-parse.test.ts:1, shared/api.ts:1
was D-B4-13 -> D-286 :: docs/superpowers/plans/2026-08-11-build4-conversation-and-controls.md:6, pwa/src/screens/SessionScreen.tsx:1, pwa/src/session/DialogSheet.tsx:2, pwa/test/ask-live.test.tsx:1
was D-B4-14 -> D-287 :: docs/superpowers/plans/2026-08-11-build4-conversation-and-controls.md:4, pwa/src/fleet/AbandonSheet.tsx:1, pwa/src/fleet/fleet.css:2, pwa/src/screens/RunsScreen.tsx:2, pwa/test/abandon-sheet.test.tsx:1, pwa/test/runs-screen.test.tsx:1, pwa/test/tap-targets.test.tsx:2
was D-B4-15 -> D-288 :: docs/superpowers/plans/2026-08-11-build4-conversation-and-controls.md:2, pwa/src/fleet/runWords.ts:1, pwa/test/runs-screen.test.tsx:1
was D-B4-16 -> D-289 :: docs/superpowers/plans/2026-08-11-build4-conversation-and-controls.md:12, server/src/coord/items.ts:1, server/src/coord/routes.ts:1, server/src/coord/store.ts:2, server/test/coord-items.test.ts:1, server/test/single-definition.test.ts:1
was D-B4-17 -> D-290 :: docs/superpowers/plans/2026-08-11-build4-conversation-and-controls.md:8, docs/superpowers/programs/build4.md:1, server/src/coord/close.ts:1, server/test/coord-abandon.test.ts:1
was D-B4-18 -> D-291 :: docs/superpowers/plans/2026-08-11-build4-conversation-and-controls.md:9, pwa/src/fleet/StartProgramSheet.tsx:11, pwa/src/fleet/fleet.css:2, pwa/test/start-program.test.tsx:12
was D-B4-19 -> D-292 :: docs/superpowers/plans/2026-08-11-build4-conversation-and-controls.md:5, pwa/src/fleet/StartProgramSheet.tsx:7, pwa/src/fleet/fleet.css:1, pwa/test/start-program.test.tsx:7
was D-B4-20 -> D-293 :: docs/superpowers/plans/2026-08-11-build4-conversation-and-controls.md:1, pwa/test/ask-live.test.tsx:1
was D-B4-21 -> D-294 :: docs/superpowers/plans/2026-08-11-build4-conversation-and-controls.md:2, docs/superpowers/programs/build4.md:1
was D-B4-22 -> D-295 :: docs/superpowers/plans/2026-08-11-build4-conversation-and-controls.md:2, docs/superpowers/programs/build4.md:1
was D-B4-23 -> D-296 :: docs/superpowers/plans/2026-08-11-build4-conversation-and-controls.md:2, docs/superpowers/plans/2026-08-15-fleet-robustness-build8.md:1, docs/superpowers/programs/build4.md:3, pwa/src/session/ChatList.tsx:3, pwa/src/session/MailCard.tsx:1, pwa/test/mail-card.test.tsx:1, shared/api.ts:1
was D-B8-1 -> D-297 :: docs/superpowers/plans/2026-08-15-fleet-robustness-build8.md:10, server/test/ccd-die-containment.test.ts:6, server/test/ccd-start-id.test.ts:2, server/test/ccd-supervised-start.test.ts:2
was D-B8-2 -> D-298 :: docs/superpowers/plans/2026-08-15-fleet-robustness-build8.md:2, server/test/ccd-die-containment.test.ts:1
was D-B8-3 -> D-299 :: docs/superpowers/plans/2026-08-15-fleet-robustness-build8.md:4, docs/superpowers/plans/2026-08-20-regset-atomic-write.md:1, server/test/ccd-arith-containment.test.ts:2, server/test/ccd-start-id.test.ts:1
was D-B8-4 -> D-300 :: ccd/ccd:1, docs/superpowers/plans/2026-08-15-fleet-robustness-build8.md:2, server/test/ccd-arith-containment.test.ts:1
was D-B8-5 -> D-301 :: docs/superpowers/plans/2026-08-15-fleet-robustness-build8.md:1
was D-B8-6 -> D-302 :: docs/superpowers/plans/2026-08-15-fleet-robustness-build8.md:1
was D-B8-7 -> D-303 :: ccd/ccd-cap-scopes:1, deploy/deploy.sh:1, docs/superpowers/plans/2026-08-15-fleet-robustness-build8.md:5, server/test/ccd-tmux-server.test.ts:3
was D-B8-8 -> D-304 :: docs/superpowers/plans/2026-08-15-fleet-robustness-build8.md:1
was D-B8-9 -> D-305 :: ccd/ccd:1, docs/superpowers/plans/2026-08-15-fleet-robustness-build8.md:6, server/test/ccd-tmux-server.test.ts:1
was D-B8-10 -> D-306 :: ccd/install-session-hooks.sh:1, ccd/session-hook.sh:1, docs/superpowers/plans/2026-08-15-fleet-robustness-build8.md:3, server/test/install-session-hooks.test.ts:4, server/test/session-hook.test.ts:3
was D-B8-11 -> D-307 :: ccd/ccd:1, ccd/ccd-cap-scopes:1, docs/superpowers/plans/2026-08-15-fleet-robustness-build8.md:3, server/test/ccd-tmux-server.test.ts:1
was D-B8-12 -> D-308 :: ccd/ccd:3, docs/superpowers/plans/2026-08-15-fleet-robustness-build8.md:4, docs/superpowers/plans/2026-08-20-substrate-unreachable.md:2, docs/superpowers/specs/2026-08-19-substrate-unreachable-design.md:3, server/src/exec.ts:2, server/src/watch.ts:1, server/test/ccd-archive.test.ts:1, server/test/exec.test.ts:2, server/test/pr-sweep.test.ts:2, server/test/sessionVerdictFixture.ts:2
was D-B8-13 -> D-309 :: docs/superpowers/plans/2026-08-15-fleet-robustness-build8.md:1, docs/superpowers/plans/2026-08-20-substrate-unreachable.md:1, docs/superpowers/plans/2026-08-24-build9b-peers-claims-allocator.md:1, docs/superpowers/specs/2026-08-19-substrate-unreachable-design.md:4, docs/superpowers/specs/2026-08-21-build9-provenance-peers-claims-design.md:1, server/src/exec.ts:2, server/src/fleet.ts:2, server/src/sessionws.ts:1, server/src/watch.ts:2, server/test/ccd-session-verdict.test.ts:1, server/test/exec.test.ts:2, server/test/ledger.test.ts:1, server/test/mail-sweep.test.ts:2, server/test/pr-sweep.test.ts:1, server/test/sessionVerdictFixture.ts:2
was D-B8-14 -> D-310 :: ccd/ccd:3, docs/superpowers/plans/2026-08-15-fleet-robustness-build8.md:1, docs/superpowers/plans/2026-08-20-substrate-unreachable.md:20, server/src/registry.ts:3, server/test/ccd-session-state.test.ts:2, server/test/ccd-substrate.test.ts:1, server/test/ccd-supervised-start.test.ts:1, server/test/fleet-lifecycle.test.ts:1, server/test/registry.test.ts:3
```

## Appendix A — reconcile-enum.mjs, verbatim

````js
#!/usr/bin/env node
// reconcile-enum.mjs — Build 9b Wave 10, Task 30. Transient tool: its source
// is preserved verbatim as Appendix A of the reconciliation record, and the
// file itself is deleted before the wave's final commit (Task 32).
//
//   node reconcile-enum.mjs --dry   # enumerate and print the work-list; no POSTs, no doc
//   node reconcile-enum.mjs         # enumerate, allocate, write the record
//
// THE ONE PREDICATE, shared verbatim with reconcile-rewrite.mjs and the
// standing scanner in server/test/deviation-refs.test.ts: a legacy ref
// immediately preceded by `was ` is an alias (already-reconciled prose) and
// is neither enumerated nor rewritten; any other spelling is bare.
import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const root = process.cwd(); // run from the worktree root
const DOC = 'docs/superpowers/specs/2026-08-21-deviation-namespace-reconciliation.md';
// Crash-resume file: a death between a POST and the doc write must not
// re-allocate on the next run. A burnt number is harmless (skipped, never
// reissued — D13); a duplicate `was <legacy>` title would muddy the record.
const PARTIAL = 'reconcile-alloc.partial';
const BARE = /(?<!was )\bD-B\d+-\d+\b/g;
const BINARY_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.ico', '.webp', '.avif',
  '.woff', '.woff2', '.ttf', '.otf', '.db', '.sqlite', '.pdf', '.zip', '.gz', '.tgz', '.wasm']);

const tracked = execFileSync('git', ['ls-files', '-z'], { cwd: root, maxBuffer: 64 * 1024 * 1024 })
  .toString('utf8').split('\0').filter(Boolean)
  .filter((f) => !BINARY_EXT.has(path.extname(f)));

// ── enumerate ────────────────────────────────────────────────────────────
const occ = new Map(); // legacy id -> Map<file, count>; git ls-files order is stable
for (const f of tracked) {
  let text;
  try { text = readFileSync(path.join(root, f), 'utf8'); } catch { continue; }
  if (text.includes('\0')) continue;
  for (const m of text.matchAll(BARE)) {
    if (!occ.has(m[0])) occ.set(m[0], new Map());
    const files = occ.get(m[0]);
    files.set(f, (files.get(f) ?? 0) + 1);
  }
}
// Stable order: numeric by build, then by member — D-B<k>-<m> sorts on (k, m).
const ids = [...occ.keys()].sort((a, b) => {
  const A = a.match(/^D-B(\d+)-(\d+)$/).slice(1).map(Number);
  const B = b.match(/^D-B(\d+)-(\d+)$/).slice(1).map(Number);
  return A[0] - B[0] || A[1] - B[1];
});
const workLine = (id, tail) => {
  const files = [...occ.get(id)].map(([f, n]) => `${f}:${n}`).join(', ');
  return `was ${id} -> ${tail} :: ${files}`;
};
const totalOcc = [...occ.values()]
  .reduce((s, m) => s + [...m.values()].reduce((a, b) => a + b, 0), 0);
const totalFiles = new Set([...occ.values()].flatMap((m) => [...m.keys()])).size;
console.log(`work-list: ${ids.length} unique legacy refs, ${totalOcc} bare occurrences, ${totalFiles} files`);
for (const id of ids) console.log(workLine(id, '?'));
if (process.argv.includes('--dry')) process.exit(0);

// ── allocate (resumable) ─────────────────────────────────────────────────
// EXECUTOR DRIFT (9b W10, noted in the commit body): this checkout runs on
// the fleet box — the server's :7788 is loopback-bound on the SERVER box and
// the token lives there (~/.ccrc/mail.token, a comment-preamble file whose
// value line is extracted remotely and never leaves that box, never printed).
// Each allocation therefore rides one ssh-routed curl using the deploy
// coordinates (~/.ccrc/deploy.env), the smallest structural change to the
// plan's single-POST loop; the request grammar and every check are unchanged.
const post = (json) => execFileSync('bash', ['-c',
  'set -a; . ~/.ccrc/deploy.env; set +a; ' +
  'exec ssh -p "${CCRC_SSH_PORT:-22}" -i "$CCRC_SSH_KEY" -o BatchMode=yes "$CCRC_BOX" ' +
  '\'T=$(grep -vE "^[[:space:]]*(#|$)" ~/.ccrc/mail.token | head -1 | tr -d "[:space:]"); ' +
  'curl -sS -w "\\n%{http_code}" -H "content-type: application/json" -H "x-ccrc-mail-token: $T" ' +
  '--data-binary @- http://127.0.0.1:7788/api/ledger/deviations\''],
  { input: json }).toString('utf8');
const mapping = new Map();
if (existsSync(path.join(root, PARTIAL))) {
  for (const line of readFileSync(path.join(root, PARTIAL), 'utf8').split('\n').filter(Boolean)) {
    const m = line.match(/^was (D-B\d+-\d+) -> D-(\d+)$/);
    if (m) mapping.set(m[1], Number(m[2]));
  }
  console.log(`resuming: ${mapping.size} allocations already recorded in ${PARTIAL}`);
}
for (const id of ids) {
  if (mapping.has(id)) continue;
  const out = post(JSON.stringify({ project: 'ccrc-pwa', count: 1, title: `was ${id}` }));
  const nl = out.lastIndexOf('\n');
  const status = Number(out.slice(nl + 1).trim());
  const bodyText = out.slice(0, nl);
  if (status !== 201) throw new Error(`allocating for ${id}: ${status} ${bodyText}`);
  const body = JSON.parse(bodyText);
  const n = Array.isArray(body.numbers) ? body.numbers[0] : undefined;
  if (!Number.isInteger(n)) throw new Error(`201 without numbers[0] for ${id}: ${JSON.stringify(body)}`);
  mapping.set(id, n);
  appendFileSync(path.join(root, PARTIAL), `was ${id} -> D-${n}\n`);
  console.log(`allocated D-${n}  (title: was ${id})`);
}

// ── write the record ─────────────────────────────────────────────────────
const F3 = '```'; // the fence marker, held out of literal position so the
                  // appendix embedding (four-backtick fences) nests cleanly
const rows = ids.map((id) => {
  const files = occ.get(id);
  const total = [...files.values()].reduce((a, b) => a + b, 0);
  return `| D-${mapping.get(id)} | was ${id} | ${total} | ${files.size} |`;
});
const doc = [
  '# One deviation namespace — the reconciliation record',
  '',
  '**Status:** enumerated and allocated (Task 30); the rewrite is pending.',
  '',
  'Spec: `docs/superpowers/specs/2026-08-21-build9-provenance-peers-claims-design.md`, §1 D14.',
  `Executed ${new Date().toISOString().slice(0, 10)}, in an operator-announced quiet window,`,
  'as Wave 10 of the Build 9b plan — deliberately last, never concurrent with a wave.',
  '',
  'The legacy build-scoped deviation families are renamed into the single global',
  'sequence. Nothing is deleted: every rewrite preserves its original as an alias',
  '— `D-<n> (was D-B<k>-<m>)` on the first occurrence per file, bare `D-<n>`',
  'after — and this table, whose middle column is byte-for-byte the `title` each',
  'allocation carries in `ledger_alloc` and `~/.ccrc/ledger-alloc.log`, is the',
  'permanent mapping. One predicate is shared by the enumerator, the rewriter and',
  'the standing scanner in `server/test/deviation-refs.test.ts`: a legacy ref',
  'immediately preceded by `was ` is an alias and is licensed; any other spelling',
  'is bare, and since this wave a bare spelling is a red suite.',
  '',
  '## The mapping',
  '',
  '| global | legacy (the allocator title) | occurrences | files |',
  '|---|---|---|---|',
  ...rows,
  '',
  '## The work-list (the enumeration output, verbatim)',
  '',
  F3,
  ...ids.map((id) => workLine(id, `D-${mapping.get(id)}`)),
  F3,
  '',
].join('\n');
writeFileSync(path.join(root, DOC), doc);
console.log(`wrote ${DOC}: ${ids.length} mapping rows`);
````

## Appendix B — reconcile-rewrite.mjs, verbatim

````js
#!/usr/bin/env node
// reconcile-rewrite.mjs — Build 9b Wave 10, Tasks 31 and 32. Transient tool:
// preserved verbatim as Appendix B of the reconciliation record, deleted
// before the wave's final commit (Task 32).
//
//   node reconcile-rewrite.mjs docs/superpowers   # Task 31: the docs half
//   node reconcile-rewrite.mjs                    # Task 32: everything left
//
// Reads the committed mapping (the record's own table — the doc is the single
// source of truth, not a side file) and rewrites every BARE legacy ref: the
// first occurrence of a given legacy id in a file becomes `D-<n> (was <legacy>)`;
// every later occurrence in the same file, bare `D-<n>`. An unmapped legacy
// ref is a THROW, not a skip — it means the enumeration and the tree have
// diverged, and the answer is Task 30's dry run again, never a guess.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const root = process.cwd(); // run from the worktree root
const DOC = 'docs/superpowers/specs/2026-08-21-deviation-namespace-reconciliation.md';
// THE predicate — identical in reconcile-enum.mjs and the standing scanner.
// The record's own spellings are all `was `-guarded, so the doc (and the
// design spec's sentence about the allocator titles) pass through untouched.
const BARE = /(?<!was )\bD-B\d+-\d+\b/g;
const BINARY_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.ico', '.webp', '.avif',
  '.woff', '.woff2', '.ttf', '.otf', '.db', '.sqlite', '.pdf', '.zip', '.gz', '.tgz', '.wasm']);

const mapping = new Map();
for (const m of readFileSync(path.join(root, DOC), 'utf8')
  .matchAll(/^\| D-(\d+) \| was (D-B\d+-\d+) \| /gm)) {
  mapping.set(m[2], Number(m[1]));
}
if (mapping.size === 0) throw new Error(`no mapping rows parsed from ${DOC}`);

const prefixes = process.argv.slice(2);
const inScope = (f) => prefixes.length === 0
  || prefixes.some((p) => f === p || f.startsWith(p.endsWith('/') ? p : `${p}/`));

const tracked = execFileSync('git', ['ls-files', '-z'], { cwd: root, maxBuffer: 64 * 1024 * 1024 })
  .toString('utf8').split('\0').filter(Boolean)
  .filter((f) => !BINARY_EXT.has(path.extname(f)) && inScope(f));

let filesChanged = 0;
let refs = 0;
for (const f of tracked) {
  let text;
  try { text = readFileSync(path.join(root, f), 'utf8'); } catch { continue; }
  if (text.includes('\0')) continue;
  const seen = new Set();
  const next = text.replace(BARE, (legacy) => {
    const n = mapping.get(legacy);
    if (n === undefined) throw new Error(`${f}: unmapped legacy ref ${legacy}`);
    refs += 1;
    if (seen.has(legacy)) return `D-${n}`;
    seen.add(legacy);
    return `D-${n} (was ${legacy})`;
  });
  if (next !== text) { writeFileSync(path.join(root, f), next); filesChanged += 1; }
}
console.log(`${filesChanged} files changed, ${refs} refs rewritten`);
````
