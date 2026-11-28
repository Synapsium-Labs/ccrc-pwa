// The fiber walk: whether a secret is held in React props or hook state anywhere in a rendered tree (Overlord W2 Settings, review
// 4139 A1; one copy for every file that asks, review 4167 F5).
//
// It walks every fiber of the tree an element is in, and every value reachable from each fiber's props and hook state. It skips what
// is not data: the fiber's own links, a DOM node and a FUNCTION. So a value mirrored into a hook's state, or passed as a controlled
// `value`, is found, and a value kept only inside a function's closure is NOT: no walk of objects can see a closure's captured
// variables. What a closure may capture is pinned by source instead, in `settings-retry-census.test.ts` (review 4167 F1, F6).

const SKIP = new Set(['return', 'child', 'sibling', 'alternate', 'stateNode', '_owner', '_debugOwner', '_debugStack', '_debugTask', '_debugInfo', '_store']);

/** Whether `needle` is in a string or a key reachable from `root`, through plain values only (never a DOM node or a function). */
function holds(root: unknown, needle: string, seen = new WeakSet<object>()): boolean {
  if (typeof root === 'string') return root.includes(needle);
  if (typeof root !== 'object' || root === null || seen.has(root)) return false;
  if (typeof Node !== 'undefined' && root instanceof Node) return false;
  seen.add(root);
  try {
    for (const k of Object.keys(root)) {
      if (SKIP.has(k)) continue;
      if (k.includes(needle)) return true;
      if (holds((root as Record<string, unknown>)[k], needle, seen)) return true;
    }
  } catch { /* a getter that throws holds nothing */ }
  return false;
}

interface FiberLike { return: FiberLike | null; child: FiberLike | null; sibling: FiberLike | null; memoizedProps: unknown; memoizedState: unknown }

function fiberOf(el: Element): FiberLike {
  const key = Object.keys(el).find((k) => k.startsWith('__reactFiber'));
  if (key === undefined) throw new Error('no React fiber on the element');
  return (el as unknown as Record<string, FiberLike>)[key]!;
}

/** Every fiber of the tree the element is in: up to the root, then down through every child and sibling. */
export function allFibers(el: Element): readonly FiberLike[] {
  let root = fiberOf(el);
  while (root.return !== null) root = root.return;
  const out: FiberLike[] = [];
  const stack: FiberLike[] = [root];
  while (stack.length > 0) {
    const f = stack.pop()!;
    out.push(f);
    if (f.sibling !== null) stack.push(f.sibling);
    if (f.child !== null) stack.push(f.child);
  }
  return out;
}

/** Whether any fiber of the element's tree holds `needle` in its props or its hook state (closures excepted, as above). */
export const fiberHolds = (el: Element, needle: string): boolean =>
  allFibers(el).some((f) => holds(f.memoizedProps, needle) || holds(f.memoizedState, needle));
