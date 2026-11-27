# x2-p6-2-loader: the in-walls page loader (wave 57, run 4059)

The task note for wave 57 of the native Docs reader programme, Task P6.2 of the parity plan
(`docs/superpowers/plans/2026-11-18-native-docs-parity.md`), for the coordinator to fold into the ledger. The plan's
Results carry the detail under "Wave P6.2".

## What landed

An HTML page in the Docs reader now runs its sibling modules, its import map and its fetches of planned siblings, inside
the walls it had. P6.1 (Print) is not in this wave (the coordinator's split).

- **The scan** (`pwa/src/docs/mockup/modules.ts`, new, L1): a bounded lexer over one script's text that finds its static
  import specifiers, the dynamic imports it cannot follow and its string literals, skipping comments, strings, templates
  and regular expressions. Bounds: `MOCKUP_SCRIPT_SCAN_BYTES` (2 MiB), `MOCKUP_SCRIPT_MAX_REFS` (256 a script),
  `MOCKUP_MODULE_MAX_DEPTH` (8), `MOCKUP_IMPORT_MAP_MAX_ENTRIES` (256), each with a case at the bound.
- **The planner**: a specifier or map value names only a sibling or an `https` URL; a dynamic import, an escaped
  specifier, an unmapped bare name and what lies past a bound are "not loaded"; a fetched sibling above 2 MiB is read by
  range and reserved in full.
- **The build**: each module inlined once, bottom up, behind an import map name (D-9150); a cycle reported; the fetch
  shim (`pwa/src/docs/mockup/shim.ts`, new) as the head's first script; both written through `scriptJson`.
- **The viewer**: a page whose modules or fetched files do not fit the budget shows the reason with Source and
  Download.
- The walls are unchanged and pinned: `MOCKUP_SANDBOX_SCRIPTED`, `MOCKUP_CSP`, the click guard, the budgets,
  `MOCKUP_MAX_SRCDOC_CHARS`. The shim is no wall: the policy's `connect-src` fallback is.

## For the ledger

- **Departures.** Both issued numbers are spent:
  - D-9150, modules-behind-one-import-map: each module once behind an import map name, instead of each specifier
    rewritten to its child's nested `data:` URL;
  - D-9151, loader-files-past-the-row: `modules.ts`, `ports.ts`, `census.ts` and `docsText.ts` beyond the task's Files
    line, and one `MockupView.tsx` hunk past the over-budget answer (the view's observing reader passes the range read
    on).
- **Mutation rows.** M11.31, M11.32 and M11.33 measured red, and one row for each new guard (the plan's Results list
  them).
- **An existing fixture changed.** `pwa/test/mockup-load.test.ts`'s element-table fixture held an empty import map,
  which is now read rather than refused; the fixture now names a `data:` entry, so it stays a refused map and the case's
  expectation is unchanged.
- **Carries, not done here:**
  - Export does not carry the loader: an exported page with modules or fetches does not run them.
  - `XMLHttpRequest`, a URL built from `import.meta.url`, a glTF's own external buffers and textures, and JSON module
    imports are not answered.
  - Phones and Firefox are acceptance's, unmeasured here.
