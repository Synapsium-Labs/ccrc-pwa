// WHAT THE PAGE HID ITSELF, AS EVERY MODAL LAYER SAW IT (Task C40, D-8698; reviews 2310 F1 and F2, 2334 F1 and F2;
// Task C42, D-8714, reviews 2343 F1 and 2353 F1 to F3).
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
//   as the page's, by the first layer that saw it unmarked.
//
// A node in a mounted layer's record that no longer carries `aria-hidden="true"` was un-hidden by the page (Task C42,
// D-8714). It is the page's own no longer, so it is DELETED from that layer's record, which the layer's sheet holds by
// reference: neither this layer nor that one keeps it, and whichever closes last lifts it like any other mark. Kept, it
// would stay hidden for good: this layer's Radix hides it afresh, the earlier layer's mark leaves the package taking it as
// already hidden, and no undo removes that `aria-hidden`. The rule this keeps: the page's UN-hide during a layer is
// honoured; a hide the page makes DURING a layer cannot be told from a modal's mark (the page's `aria-hidden` lands on
// one a layer already set), so it is lost and the node ends announced, as it does in other shapes on every build. The
// palette never lifts its own marks, so a node it hides as the outer layer stays hidden after the page un-hid it.
//
// A sheet that lifts its marks as it closes (`sheet.tsx`'s `useHidingFollowsOpen`) leaves out what this answers, and
// lifts every other mark: the page's own stays hidden for good, whatever layer marked it, and another modal's mark is
// lifted, whether that modal is still closing (the palette, which never lifts its own) or was closed under this one.
// The answer does not depend on the order the layers come in the tree or on when the read runs, as long as it runs
// before this layer's own `hideOthers`. React's development-only StrictMode calls a mounted panel's ref a second time.
// React 19 does it in this order: it detaches the ref, disconnects the passive effects (Radix's undo runs here), re-attaches
// the ref (the second record), then reconnects the effects (Radix hides again). The undo removes an `aria-hidden` only
// when no other layer still counts the node, so this layer's own `aria-hidden` on a node another layer marks survives it,
// and the second record finds that node hidden (review 2353 F8). It does not take it in as the page's own because the
// first record already deleted it from the other layer's record, the page having un-hidden it.
//
// A layer is a key while its panel is in the document; a panel that has left it is forgotten at the next record, so the
// record does not keep a gone panel and its set. Since the delete above, that is a bound on what the record retains and
// no answer depends on it (reviews 2343 F2 and 2353 F4): the delete takes a node the page un-hid out of every set, a gone
// layer's included, at the first record that sees it un-hidden.

const layers = new Map<Element, Set<Element>>();

/** Record a modal layer whose `panel` has just mounted, before its own Radix hiding has run, and answer the elements the
 *  page hid itself (above). Called from the panel's callback ref. */
export function recordModalLayer(panel: Element): ReadonlySet<Element> {
  for (const known of [...layers.keys()]) if (!known.isConnected) layers.delete(known);
  const own = new Set<Element>(document.querySelectorAll('[aria-hidden="true"]:not([data-aria-hidden])'));
  for (const recorded of layers.values()) {
    for (const node of [...recorded]) {
      if (node.getAttribute('aria-hidden') === 'true') own.add(node);
      else recorded.delete(node);
    }
  }
  layers.set(panel, own);
  return own;
}
