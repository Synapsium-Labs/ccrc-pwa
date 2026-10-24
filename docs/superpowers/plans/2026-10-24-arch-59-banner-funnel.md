# ARCH-59 (#794): the notify.sh banner goes through the notice funnel

ARCH-59 (#794, epic #770) closes the last notice writer outside `server/src/notice.ts` on the `POST /api/notify`
path. Before it, the route called `PushService.notify` directly for a model-class `push: true` line (D-6237, from
the model-class auto-advance plan's Task 12) and emitted the banner's two bus frames itself. After it, the route
only authenticates, parses, runs `modelsPushDecision` and calls the funnel: `notifyPushOnly` for the push and
`noticeBanner` for the frames. Behaviour is unchanged: the same payload and tag, the same rejection log line, and
the same two frames, byte for byte.

**Counted exit.** `server/src` has two direct `PushService.notify` callers, `{notice.ts:1, watch.ts:1}`, and one
file that emits a `notice` frame, `{notice.ts:2}` (both censuses in `server/test/notify-push.test.ts`).

**Not done here.** The banner stays a transient bus frame to open sockets, with no ring or archive row. Making it a
ring/feed record needs a new `NotifyEvent` kind and PWA per-kind table edits, which are held until W7. A models push
having no feed record is a residual of W2 that D-5211 states; this plan does not change it.

## Deviations found

- **D-6732** — The funnel gains a push-only entry, `notifyPushOnly(deps, payload, failed)`, and a banner entry,
  `noticeBanner(deps, message)`, rather than routing the banner through `notify()`. The model-class push is no
  `NotifyEvent` (no kind fits it, and adding one widens `shared/api.ts`'s union and the PWA's tables), so it takes
  neither the presence gate, the ring nor the archive: the caller's policy (`modelsPushDecision`) has already
  decided it is pushable, and the funnel only sends it. Both it and `raise` go through one private `sendPush`, so
  the one `PushService.notify` call for a notice stays in `notice.ts`; a rejected send is logged under the caller's
  sentence and never thrown. The banner is one global `notice` frame plus, for a `cc swap: <id> moved ...` line, the
  moved session's own frame after it, with no ring row and no gate. This supersedes D-6237's direct call. Pins:
  `notice.test.ts` "sends the payload to the push service unchanged, and touches neither the ring nor the archive",
  "a rejected push is logged under the caller's sentence, and never thrown or left unhandled", "a cc swap: line adds
  the moved session's own frame after the global one"; `notify-push.test.ts` "are the funnel and the watcher's
  release sender, once each, and no others" and "the banner's bus frames have one writer, notice.ts: no other file
  emits a `notice` event or a `type: 'notice'` session frame (ARCH-59, #794)".
