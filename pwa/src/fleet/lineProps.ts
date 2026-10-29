// The fleet list's two memo gates (C9, D-6441). `SessionLine` and `ProjectCard` are `memo`'d, and each takes ONE prop
// its parent builds afresh on every render: a line's `childRun` (`childRunContext` returns a new object per call) and
// a card's `placement` (`placementOfRow` does the same). Those compare by `sameJson`, the one equality (C6); every
// other prop compares by identity, key for key, as React's own shallow compare does, so a new callback or a new row
// object is still a change. A second equality here would be a second opinion on what "unchanged" means.
import { sameJson } from '../lib/sameJson';

type Props = Readonly<Record<string, unknown>>;

/** Props compared by identity, except `structural`, compared by `sameJson`. A key on one side only is a change. */
const sameExcept = (structural: string) => (a: Props, b: Props): boolean => {
  const keys = Object.keys(a);
  if (keys.length !== Object.keys(b).length) return false;
  for (const k of keys) {
    if (!Object.prototype.hasOwnProperty.call(b, k)) return false;
    if (k === structural ? !sameJson(a[k], b[k]) : !Object.is(a[k], b[k])) return false;
  }
  return true;
};

/** `SessionLine`'s gate: `childRun` by value. */
export const sameLineProps = sameExcept('childRun');

/** `ProjectCard`'s gate: `placement` by value. */
export const sameCardProps = sameExcept('placement');
