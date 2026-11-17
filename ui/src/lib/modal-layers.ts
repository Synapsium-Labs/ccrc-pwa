// WHAT THE PAGE HID ITSELF, AS EVERY MODAL LAYER SAW IT (Task C40, D-8698; reviews 2310 F1 and F2, 2334 F1 and F2;
// Task C42, D-8714, review 2343 F1).
//
// Each modal layer here (a `Sheet`, and the command palette's drawer) is a Radix dialog. Radix hides everything outside
// a modal's content with the `aria-hidden` package (`hideOthers`), which puts `aria-hidden` and its own
// `data-aria-hidden` mark on each node it hides. A node that was ALREADY hidden it marks as uncontrolled: it adds the mark,
// leaves the `aria-hidden` as it was, and its undo never removes that `aria-hidden`. So once any modal layer is mounted, a
// hidden node with a mark can be the page's own or a modal's, and nothing on the node tells them apart.
//
// This record tells them apart. As a layer's panel mounts, before its own Radix hiding marks anything, the layer records
// the elements the page hid itself:
// - every hidden node that no modal has marked;
// - every node a layer still mounted recorded as the page's own, because a page-hidden node a modal marked was recorded,
//   as the page's, by the first layer that saw it unmarked; but only while it still carries `aria-hidden="true"` (Task
//   C42, D-8714; review 2343 F1). A node the page has un-hidden since that record is the page's no longer: this layer's
//   Radix hides it afresh, and the earlier layer's mark leaves the package taking it as already hidden, so its undo never
//   removes that `aria-hidden`. Kept as the page's own, nothing would lift it, and it would stay hidden for good after
//   every layer had gone; left out, this layer lifts it as it closes, like any other mark.
//
// A sheet that lifts its marks as it closes (`sheet.tsx`'s `useHidingFollowsOpen`) leaves out what this answers, and
// lifts every other mark: the page's own stays hidden for good, whatever layer marked it, and another modal's mark is
// lifted, whether that modal is still closing (the palette, which never lifts its own) or was closed under this one.
// The answer does not depend on the order the layers come in the tree or on when the read runs, as long as it runs
// before this layer's own `hideOthers`. React's development-only StrictMode calls a mounted panel's ref a second time.
// React 19 does it in this order: it detaches the ref, disconnects the passive effects (Radix's undo runs here, so this
// layer's own marks are gone), re-attaches the ref (the second record), then reconnects the effects (Radix hides again).
// So the second record sees only other layers' marks, never this layer's own, and replaces the first under this panel.
//
// A layer is a key while its panel is in the document; a panel that has left it is forgotten at the next record (review
// 2343 F2: a forgotten layer's set would otherwise keep a node a later modal hides as the page's own).

const layers = new Map<Element, ReadonlySet<Element>>();

/** Record a modal layer whose `panel` has just mounted, before its own Radix hiding has run, and answer the elements the
 *  page hid itself (above). Called from the panel's callback ref. */
export function recordModalLayer(panel: Element): ReadonlySet<Element> {
  for (const known of [...layers.keys()]) if (!known.isConnected) layers.delete(known);
  const own = new Set<Element>(document.querySelectorAll('[aria-hidden="true"]:not([data-aria-hidden])'));
  for (const recorded of layers.values()) {
    for (const node of recorded) if (node.getAttribute('aria-hidden') === 'true') own.add(node);
  }
  layers.set(panel, own);
  return own;
}
