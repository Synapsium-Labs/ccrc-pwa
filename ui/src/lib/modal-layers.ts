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
  // A handed node visible as a new layer mounts was lifted by its modal's close: it is no longer handed (X6 XR fix round 2,
  // review M1). A node still hidden stays: its modal is open, or it is the stranded case the set exists for.
  for (const node of [...handed]) if (!node.isConnected || node.getAttribute('aria-hidden') !== 'true') handed.delete(node);
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

// THE CONSOLE HIDDEN AS THE PAGE'S OWN (reader mode, X6 XR1.2; spec 2026-11-20 §4.1).
//
// Reader mode draws the Docs reading container over the console and suspends the console: everything outside the container is
// `inert` and hidden from assistive technology. That hiding is the PAGE'S OWN, which no closing modal lifts. A node hidden
// with `aria-hidden="true"` and no `data-aria-hidden` mark is exactly what `recordModalLayer` records as the page's, and a
// sheet's `useHidingFollowsOpen` lifts every mark but the page's own, so a sheet opened and closed inside reader mode (the
// external-link or copy sheet) leaves the console hidden. A hiding made through Radix's `hideOthers` would write the mark, and
// the closing sheet would lift it with its own. So these two functions are the one owner of that hiding, and neither writes a
// `data-aria-hidden` mark.
//
// A node the page had already hidden (it carries `aria-hidden="true"`) is made inert but its `aria-hidden` is not touched, and
// it is not in `hidden`: it is the page's before reader mode and after it. The one exception is a node an earlier reader mode
// left held (below), still hidden: it is adopted into `hidden`, so this hiding's release gives it back (review 4052 A1). A node
// that was already `inert` is not recorded either, so leaving never makes it focusable.
//
// LEAVING reader mode while a modal is open: a node in `hidden` that a modal marked (`data-aria-hidden`) while a
// `[role="dialog"][data-state="open"]` stands (the open-modal test `sheet.tsx` uses) keeps its `aria-hidden`: the console stays
// hidden behind the open modal. It is deleted from every layer's record, so it is no longer the page's own and that modal's
// close lifts it like any other mark. A marked node with no open dialog (a sheet still animating closed, `data-state="closed"`,
// has already made its one lift) is un-hidden at once, so the console is announced and focusable from the moment reader mode
// ends. A modal that UNMOUNTS while still open is no close and lifts nothing, and the command palette lifts none of its marks
// even as it closes, so `releaseAsPage` also remembers each node it left hidden, and `liftHeld` (a sheet's unmount and the
// palette's close or unmount; X6 XR fix round 2, review 4043 F1, and review 4052 A1) gives it back once no open dialog stands.
//
// TWO PRECONDITIONS. The hiding is entered with no modal layer in the document (reader mode is not offered while any
// `[role="dialog"]` is mounted, open or closing): under one, a node a modal hid would read as the page's own and never be
// recorded, so that modal's close would announce the console behind reader mode. And there is ONE live hiding: a second
// `hideAsPage` before its `releaseAsPage` answers the live record itself, never a new one that recorded nothing (everything
// being inert and hidden already) and so would release nothing. The hiding is a snapshot taken at entry: a node mounted
// outside `keep` afterwards (a toast host that appears) is neither inert nor hidden (spec §4.1 accepts that toasts draw behind
// reader mode).
let live: PageHiding | null = null;

// WHAT `releaseAsPage` LEFT HIDDEN FOR AN OPEN MODAL (X6 XR fix round 2, review 4043 F1). The nodes above that stay
// `aria-hidden` for the modal's close to lift are kept here. Only `releaseAsPage` adds a node; `hideAsPage` only takes nodes
// out or puts back nodes that were in it, so the set is empty while reader mode is never used. A modal that UNMOUNTS while open
// is no close: Radix's undo takes the node's mark but never the `aria-hidden` it found already set, so the node would stay
// hidden for good (a sheet in the Docs body unmounts open when the body remounts or the route leaves, after reader mode ended
// behind it), and the palette's close lifts nothing of its own (a Docs sheet that unmounts under it). `liftHeld` is the lift of
// both. `hideAsPage` takes every node out of the set as it starts: one still held and hidden that its walk meets is adopted
// into the hiding (a hiding is entered with no modal in the document, so that node's modal is gone; review 4052 A1), and one
// it does not reach is put back, held for a later lift. The set outlives a modal's normal close (that close lifts the node, and
// it stays here), so `recordModalLayer` drops every node that is visible or gone when a new layer mounts: a layer's own hiding
// is then never taken for a handed one (X6 XR fix round 2, review M1).
const handed = new Set<Element>();

/** How many nodes are held now (read only, for the suite's proof that the set stays empty while reader mode is never used). */
export function heldNodeCount(): number {
  return handed.size;
}

/** What `hideAsPage` set, for `releaseAsPage` to undo: the nodes it made `inert` and the nodes it gave `aria-hidden`. */
export interface PageHiding {
  readonly inerted: readonly Element[];
  readonly hidden: readonly Element[];
}

const NOT_CONTENT = new Set(['SCRIPT', 'STYLE', 'TEMPLATE']);

/** Hide everything outside `keep` as the page's own: each sibling of `keep` and of each ancestor of `keep` up to `body` is made
 *  `inert` and, when it is not hidden already, `aria-hidden="true"`, with no `data-aria-hidden` mark. Scripts, styles,
 *  templates and any node that contains `keep` are left alone. While a hiding is live, it is answered again (above). */
export function hideAsPage(keep: Element): PageHiding {
  if (live !== null) return live;
  // A node an earlier hiding left held and still hidden (its modal went without lifting it) is ADOPTED: this hiding takes it as one
  // it hid, so its release gives it back. Skipped as already hidden, as before review 4052 A1, it was in neither `hidden` nor the
  // set, and every later layer recorded it as the page's own, hidden for good. A held node this hiding does not reach stays held,
  // for a later lift: nothing is un-hidden here.
  const leftover = new Set([...handed].filter((node) => node.isConnected && node.getAttribute('aria-hidden') === 'true'));
  handed.clear();
  const inerted: Element[] = [];
  const hidden: Element[] = [];
  for (let at: Element | null = keep; at !== null && at !== document.body && at.parentElement !== null; at = at.parentElement) {
    for (const sibling of [...at.parentElement.children]) {
      if (sibling === at || NOT_CONTENT.has(sibling.tagName) || sibling.contains(keep)) continue;
      if (!sibling.hasAttribute('inert')) {
        sibling.setAttribute('inert', '');
        inerted.push(sibling);
      }
      if (sibling.getAttribute('aria-hidden') !== 'true') {
        sibling.setAttribute('aria-hidden', 'true');
        hidden.push(sibling);
      } else if (leftover.delete(sibling)) {
        hidden.push(sibling);
      }
    }
  }
  for (const node of leftover) handed.add(node);
  live = { inerted, hidden };
  return live;
}

/** Undo `hideAsPage` (above): remove `inert` from every node it made inert, and `aria-hidden` from every node it hid, except a
 *  node a modal marks while a modal is open, which that modal's close lifts. */
export function releaseAsPage(h: PageHiding): void {
  if (h === live) live = null;
  for (const node of h.inerted) node.removeAttribute('inert');
  const modalOpen = document.querySelector('[role="dialog"][data-state="open"]') !== null;
  for (const node of h.hidden) {
    if (modalOpen && node.hasAttribute('data-aria-hidden')) {
      for (const recorded of layers.values()) recorded.delete(node);
      handed.add(node);
    } else {
      node.removeAttribute('aria-hidden');
    }
  }
}

/** A modal layer closed or unmounted: give back each node `releaseAsPage` left hidden for an open modal, when no
 *  `[role="dialog"][data-state="open"]` stands in the document any more, so the LAST dialog over it to go gives it back, whichever
 *  layer that is. Called by a sheet's unmount (`sheet.tsx`, passive cleanup, after the DOM removal; a sheet's close lifts the
 *  node with its own marks) and by the command palette's close and unmount (`command-palette.tsx`, which lifts none of its own
 *  marks: a Docs sheet that unmounts under the open palette, the palette's "Go to" path, left the node to it; review 4052 A1).
 *  With another open dialog the node stays hidden and in the set, for that dialog's own close or unmount. A node that is no
 *  longer hidden, or has left the document, is dropped; so is one visible when a new layer mounts (`recordModalLayer`, review
 *  M1), and one still held when the next reader mode starts is adopted by it (`hideAsPage`). A no-op while the set is empty,
 *  which is every layer while reader mode is never used. */
export function liftHeld(): void {
  if (handed.size === 0) return;
  const modalOpen = document.querySelector('[role="dialog"][data-state="open"]') !== null;
  for (const node of [...handed]) {
    if (!node.isConnected || node.getAttribute('aria-hidden') !== 'true') {
      handed.delete(node);
    } else if (!modalOpen) {
      node.removeAttribute('aria-hidden');
      handed.delete(node);
    }
  }
}
