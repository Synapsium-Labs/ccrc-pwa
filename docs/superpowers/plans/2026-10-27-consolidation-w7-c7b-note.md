# W7 C7b note: the departures the shrunk form took (2026-10-28)

Task C7b of `2026-10-27-consolidation-w7-pwa.md` (D-7180; ARCH-28, #540), built in the shrunk form §Task C7b's first
paragraph gives after #1720 (coordinator call 3). Each departure below is named by its slug, in this note, in the
commit that took it and in the PR body. This note allocates no number.

## slug bad-second-poll-open-read

`pwa/test/accounts-screen.test.tsx`'s "a BAD second poll cannot undo a good first one" drove the store's read twice
itself (a good answer, then a malformed one) and counted two `api.accounts` calls. With Step 3 the screen's own read on
open is a call too, so the case saw three. The case now lets the screen's read on open land as its good first read
(one task turn) and drives the malformed second read itself, as before. Its three assertions are byte-identical: the
label shows after the good read, two calls ran, and the label survives the malformed answer. It is not one of the
plan's named re-point exceptions; it moves in Step 3's behaviour commit because that commit is what adds the call.

## slug accounts-open-browser-row

The plan asks for Step 3's before and after rows per width and skin "from the browser tests". The only browser case
that opened `/accounts` was `lanes-row.browser.test.ts`'s, at 1280 in the dark theme only. Step 3 adds
`pwa/browser/accounts-open.browser.test.ts`: phone 360 and 390, laptop 1280 and wide 1920, Refined and Instrument,
light and dark (16 views). Each opens the fleet, lets the store's first answer land, parks every `/api` request, opens
`/accounts`, and holds that the rows are drawn from the store while the screen's one request is parked, that exactly
one `/api/accounts` request left on open, and that the rows and the projection line stand once it is answered. Red in
every view on main's tree (no request on open), green after.

## slug request-polls-ratchet

The shrunk Step 2 names one ratchet (`api.accounts` held to `stores/fleet.ts`). The counted exit says both counts are
ratcheted, so the same new `pwa-one-owner.test.ts` block also holds `requestPolls()` at most 2, both in
`HotFilesStrip` and `useFleetHealth` (C7m's, which lowers it). Its mutant (a third request poll in `AccountsStrip`)
reds it.
