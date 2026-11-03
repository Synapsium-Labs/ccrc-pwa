# W7 C7l: build note (one storage port)

**Task:** `docs/superpowers/plans/2026-10-27-consolidation-w7-pwa.md` §Task C7l (`D-7190`; ARCH-75 #810, PR 3; spec K14).
**Status:** written by the builder of C7l, 2026-10-28. It records where the build departs from the plan's sketch. It does
not edit the plan or its §Deviations, and it allocates no D-number. Each departure has a slug; a tracked file that has to
cite one uses `D-TBD-<slug>` until the coordinator rules on it.

## Measured count change (not a behaviour change)

The plan counts 10 storage owners. `origin/main` has 12: C7a's REAL row `storageOwners()` holds 12, and
`pwa/test/w7-storage-keys.test.ts` drives 12. The two owners the plan does not list are `pwa/src/fleet/stripExpanded.ts`
(key `ccrc-accounts-strip`) and `pwa/src/inspector/inspectorShown.ts` (key `ccrc-inspector`). Both move onto the port the
same way as the other ten, so the counted exit is 12 -> 0, not 10 -> 0.

## Departures

- **slug `port-unreadable-arm`.** The plan names three functions: `readKey`, `writeKey` and `removeKey`. Two owners need to
  tell "the read threw" apart from "nothing is stored". `releaseDismissal.ts#readStored` never writes over unreadable
  storage, and `stripExpanded.ts#readExpanded` falls back to the page value. A plain `null` would lose that difference.
  So `readKey` has a second overload, `readKey(key, from, unreadable)`, and the module exports the `UNREADABLE` symbol
  that those two owners pass. The module also exports three seams the moved code needs. `pageStorage` is the default
  source. It returns `null` where naming the store throws, which is what `itemHeight.ts`'s deleted `store()` did.
  `StorageSource` is the getter type that drawerView and TerminalDrawer inject. `memoryStorage` is the in-memory test
  instance that `test/setup.ts` installs. `writeKey` and `removeKey` answer `true` or `false`, so a refused write can be
  seen; `stripExpanded.ts#writeRefused` reads that answer. No key or value changes.
- **slug `real-rows-outside-port`.** Adding the port raises the raw `storageOwners()` count by one: `lib/storage.ts`
  names `window.localStorage`. It also raises `storageTypes()` by two: `StoragePort#getItem`, plus `memoryStorage`'s
  `getItem` property, because the census counts a `getItem:` object member as a type. A raw REAL row would therefore go
  up. Step 1 re-scopes the two REAL rows in `census-w7/pwa.test.ts`. Each row now holds the port's own sites exactly, by
  symbol (`['pageStorage']`, `['(module)', 'memoryStorage']`), and the base count (12 and 1) applies outside the port.
  Each owner commit then lowers the outside count (exception 3), down to 0 and 0. No assertion is weakened: the port's
  sites are pinned by name, and the outside counts are the plan's counted exit. The census module is not edited.
- **slug `drawer-one-commit`.** The plan lists `session/TerminalDrawer.tsx` as its own owner commit, and the move of
  `session/drawerView.ts#StorageLike` to `StoragePort` as a separate item. They land in one commit. TerminalDrawer
  imports the `StorageLike` type that the commit deletes, and its `window.localStorage` default is that type's only page
  reader. The two test re-points (`drawer-view.test.tsx` and `drawer-paste.test.tsx`, which import `StoragePort` from
  `lib/storage.ts`) land in the same commit. The owner series is therefore 11 commits for 12 owners.
- **slug `storage-keys-stale-title`.** The plan's rule says a test title that names a deleted symbol is reworded in the
  commit that deletes it. One title in `pwa/test/w7-storage-keys.test.ts` names `StorageLike` (its TerminalDrawer row).
  The brief requires that file to stay byte-unchanged through C7l, so the title is not reworded. The follow-up is to
  reword that one title (`StorageLike` -> `StoragePort`) in a later W7 commit that is allowed to touch the pin. No
  assertion depends on the title.

## Not departures (recorded for review)

- **Bare `localStorage` -> `window.localStorage`.** Five owners named the bare global: `inspectorShown`, `notifymark`,
  `seen`, `skin` and `theme`. `itemHeight` named it too, through `typeof localStorage`. The port always uses
  `window.localStorage`. In a page, the two are the same object. Under vitest's jsdom environment, `window` is
  `globalThis` (measured), so every suite that stubs the global (`vi.stubGlobal('localStorage', …)` or
  `Object.defineProperty(globalThis, 'localStorage', …)`) reaches the port unchanged. The full PWA unit suite is green.
- **Rings.** `lib/storage.ts` is L3 by `pwaRing` (it names `window.`), a lib adapter. Some owners no longer name a browser
  I/O global and may now read as L1, for example `seen.ts`, `theme.ts`, `drawerView.ts` and `itemHeight.ts`. An L1 module
  may import `lib/storage.ts`, because only a `.tsx` file, a store or `lib/api.ts` is forbidden. `PWA_L1_EXEMPTIONS` gains
  no row, and `pwa-rings.test.ts` is green.
