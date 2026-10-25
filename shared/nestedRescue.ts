// DISK RETENTION DR-21 (D-6633; spec 2026-10-23 §2.7.1). What the server reads of rung 9's nested-repository rescue
// before the arm is live: the audit document's `nestedRescue.wouldRescue`, as a COUNT (ccd's paths stay on the box), and
// the words of the one shadow feed row that count earns. L0: no `node:` module, so both lanes' parsers (L1) and the
// recorder (L2) read one definition.

/** How many nested repositories an audit document's `nestedRescue.wouldRescue` names: 0 for any other shape. */
export function nestedWouldRescueCount(doc: Record<string, unknown>): number {
  const n = doc.nestedRescue;
  if (typeof n !== 'object' || n === null) return 0;
  const would = (n as { wouldRescue?: unknown }).wouldRescue;
  return Array.isArray(would) ? would.filter((p) => typeof p === 'string' && p !== '').length : 0;
}

/** The paths themselves, for the durable shadow journal (D-TBD-shadow-journal): the same filter as the count. */
export function nestedWouldRescuePaths(doc: Record<string, unknown>): string[] {
  const n = doc.nestedRescue;
  if (typeof n !== 'object' || n === null) return [];
  const would = (n as { wouldRescue?: unknown }).wouldRescue;
  return Array.isArray(would) ? would.filter((p): p is string => typeof p === 'string' && p !== '') : [];
}

/** The title of the one shadow row a child (or archive) earns. */
export const NESTED_RESCUE_SHADOW_TITLE = 'a nested repository would be rescued';

/** The row's body: `who` is the lane's own subject; the count is said in words, and no path is. */
export function nestedRescueShadowBody(who: string, n: number): string {
  return `${who}: ${n} nested ${n === 1 ? 'repository' : 'repositories'} would be rescued into the attic before this tree is `
    + 'removed — the rescue is not armed (shadow), so it was refused and nothing was removed.';
}
