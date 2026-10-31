// Structural equality over plain JSON values: the ONE equality the fleet store's row keeper (`keepRows`, C6) and
// the later change gates (C8, C9) import. A second copy would be a second opinion on what "unchanged" means.
//
// Values are null, booleans, numbers, strings, arrays (element by element, same length, order matters) and plain
// objects (the same key SET, every value equal; key order is irrelevant). An EXTRA KEY IS A CHANGE: a snapshot row
// revived by `reviveFleetSession` carries a key the live frame may not, and it must then take the live object, as it
// does today. A key present with an `undefined` value is still a key.
export function sameJson(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  const aList = Array.isArray(a);
  if (aList !== Array.isArray(b)) return false;
  if (aList) {
    const x = a as unknown[];
    const y = b as unknown[];
    if (x.length !== y.length) return false;
    for (let i = 0; i < x.length; i++) if (!sameJson(x[i], y[i])) return false;
    return true;
  }
  const x = a as Record<string, unknown>;
  const y = b as Record<string, unknown>;
  const keys = Object.keys(x);
  if (keys.length !== Object.keys(y).length) return false;
  for (const k of keys) {
    if (!Object.prototype.hasOwnProperty.call(y, k) || !sameJson(x[k], y[k])) return false;
  }
  return true;
}
